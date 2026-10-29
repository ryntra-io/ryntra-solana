/**
 * Phoenix's bars as the core chart's source (contract `ryntra.chart/2.2`, B7): the reads «Ф'ючерси» makes of Ryntra's
 * `/api/solana/futures/candles` — the traded price's bars and the mark price's from one read. The page puts each read
 * in (`put`); the chart asks history and listens through `source`. Nothing here is fetched and nothing is sent.
 *
 * The state under the chart is the reads': `delayed` while the newest read is younger than three of the page's polls,
 * `stale` past that or when a read failed and the last good one stands; every read says so, a quiet market included.
 * A read is as old as it waited in the edge's cache (the page passes its `Age`), then ages on this page's clock — never
 * the server's time against the visitor's. The same rules as the spot and demo feeds
 * (`spot/core-chart-source.ts`, `app/demo/arcus-chart-source.ts`): an older bar that changed goes out as a correction,
 * the newest bar is replaced, new bars follow in order.
 */
import type { Bar, BarCorrection, ChartSource, DataStatus, HistoryPage, Instrument, LiveEvent, PriceBasis, Resolution, TimeResolution } from "@ryntra/core/adapters";

import { FUTURES_TIMEFRAMES, candlesCacheSeconds, type FuturesCandle, type FuturesCandles, type FuturesTimeframe } from "../../../../lib/phoenix/market-data.ts";

export const CHART_CONTRACT_VERSION = "ryntra.chart/2.2";

/** The traded price — what the chart opens on. */
export const LAST_BASIS: PriceBasis = { kind: "last", measure: "price", in: "USD", adjustment: "raw", outcome: null };
/** The mark price — what Phoenix's margin and liquidation are counted on. */
export const MARK_BASIS: PriceBasis = { kind: "mark", measure: "price", in: "USD", adjustment: "raw", outcome: null };

const RESOLUTION: Readonly<Record<FuturesTimeframe, TimeResolution>> = {
  "1m": { kind: "time", unit: "minute", span: 1 },
  "5m": { kind: "time", unit: "minute", span: 5 },
  "15m": { kind: "time", unit: "minute", span: 15 },
  "1h": { kind: "time", unit: "hour", span: 1 },
  "4h": { kind: "time", unit: "hour", span: 4 },
  "1d": { kind: "time", unit: "day", span: 1 },
};

export const resolutionOf = (timeframe: FuturesTimeframe): TimeResolution => RESOLUTION[timeframe];

/** A resolution as the page's timeframe; null for one Phoenix's reads do not serve here. */
export function timeframeOf(resolution: Resolution): FuturesTimeframe | null {
  if (resolution.kind !== "time") return null;
  return FUTURES_TIMEFRAMES.find((tf) => RESOLUTION[tf].unit === resolution.unit && RESOLUTION[tf].span === resolution.span) ?? null;
}

/** How often the page reads the bars. */
export const CANDLES_POLL_MS = 10_000;

/**
 * How long a read stands as `delayed` before the chart calls it stale: the oldest copy the edge may serve (its life and
 * as long again while it refetches) and two of the page's polls — a healthy market never flips to stale.
 */
export function readFreshMs(timeframe: FuturesTimeframe): number {
  return candlesCacheSeconds(timeframe) * 2_000 + CANDLES_POLL_MS * 2;
}

/** How long history waits for the page's read of a timeframe it has not read yet. */
const WAIT_MS = 25_000;

/** A positive number as the contract's decimal string: never an exponent, at most twelve places; null for anything else. */
export function decimalOf(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  const places = Math.min(12, Math.max(0, Math.ceil(-Math.log10(value)) + 2));
  const text = value.toFixed(places).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return Number(text) > 0 ? text : null;
}

/** A price step from the price's own size when Phoenix's own is not known: five significant digits, never finer than a billionth. */
export function stepFor(price: number | null): string {
  if (price === null || !Number.isFinite(price) || price <= 0) return "0.01";
  const decimals = Math.min(9, Math.max(0, 4 - Math.floor(Math.log10(price))));
  return decimals === 0 ? "1" : `0.${"0".repeat(decimals - 1)}1`;
}

const decimalsOfStep = (step: string): number => (step.includes(".") ? step.length - step.indexOf(".") - 1 : 0);

/** A number on the step, as the contract's decimal string: never an exponent, never more digits than the step. */
export function onTick(value: number, step: string): string {
  const unit = Number(step);
  return (Math.round(value / unit) * unit).toFixed(decimalsOfStep(step));
}

const sameBasis = (a: PriceBasis, b: PriceBasis): boolean => a.kind === b.kind && a.measure === b.measure && a.in === b.in && a.adjustment === b.adjustment && a.outcome === b.outcome;

const ohlc = (bar: Bar): string => `${bar.o}|${bar.h}|${bar.l}|${bar.c}|${bar.v}`;

type Basis = "last" | "mark";

type Read = Readonly<{ last: ReadonlyMap<number, Bar>; mark: ReadonlyMap<number, Bar>; at: number }>;

type Listener = {
  readonly timeframe: FuturesTimeframe;
  readonly basis: Basis;
  readonly emit: (event: LiveEvent) => void;
  shown: number | null;
};

type Waiter = Readonly<{ resolve: () => void; reject: (error: Error) => void }>;

/**
 * One market's chart feed. `now` is the page's clock in ms of the epoch (a test passes one that stands).
 */
export type FuturesInstrumentUnits = Readonly<{
  /** Phoenix's price step in dollars (`tickUsd`); null — counted from the price. */
  tick: number | null;
  /** Phoenix's size step in the base asset (`lotUnits`). */
  lot: number | null;
  /** A price to count the step from when Phoenix's own is not known. */
  price: number | null;
}>;

export class FuturesChartFeed {
  readonly #symbol: string;
  #step: string;
  /** Phoenix's own step: a read never replaces it. */
  readonly #fixedStep: boolean;
  readonly #lot: string;
  readonly #now: () => number;
  readonly #reads = new Map<FuturesTimeframe, Read>();
  /** Set when the newest read of a timeframe failed: the last good one stands, and the chart says it is stale. */
  readonly #failed = new Set<FuturesTimeframe>();
  readonly #waiters = new Map<FuturesTimeframe, Waiter[]>();
  readonly #listeners = new Set<Listener>();
  #disposed = false;
  readonly source: ChartSource;

  constructor(symbol: string, units: FuturesInstrumentUnits, now: () => number = Date.now) {
    this.#symbol = symbol;
    const tick = decimalOf(units.tick);
    this.#fixedStep = tick !== null;
    this.#step = tick ?? stepFor(units.price);
    this.#lot = decimalOf(units.lot) ?? "0.000001";
    this.#now = now;
    this.source = this.#makeSource();
  }

  get instrument(): Instrument {
    return {
      id: this.#symbol,
      symbol: `${this.#symbol}-PERP`,
      network: "solana",
      venue: "phoenix",
      kind: "perp",
      base: this.#symbol,
      quote: "USD",
      tick: this.#step,
      price_rule: null,
      lot: this.#lot,
      min_notional: null,
      price_band: null,
      multiplier: "1",
      multiplier_version: null,
      session: { timezone: "UTC", windows: [], holidays: [] },
      reference_session: null,
      scale: "price",
      outcomes: [],
      min_resolution: RESOLUTION["1m"],
      resolutions: FUTURES_TIMEFRAMES.map((tf) => RESOLUTION[tf]),
      bases: [LAST_BASIS, MARK_BASIS],
      trading_basis: LAST_BASIS,
    };
  }

  /**
   * A whole read of a timeframe, `ageMs` old on arrival (the edge cache's `Age`). A bar the screen already holds that
   * changed goes out as a correction; a read that changed nothing still tells the chart how fresh it is.
   */
  put(candles: FuturesCandles, ageMs = 0): void {
    if (this.#disposed) return;
    const timeframe = candles.timeframe;
    const before = this.#reads.get(timeframe);
    const newest = candles.last.at(-1)?.c ?? candles.mark.at(-1)?.c ?? null;
    if (!before && !this.#fixedStep && newest !== null) this.#step = stepFor(newest);
    const read: Read = { last: this.#bars(candles.last), mark: this.#bars(candles.mark), at: this.#now() - Math.max(0, ageMs) };
    this.#reads.set(timeframe, read);
    this.#failed.delete(timeframe);
    for (const waiter of this.#waiters.get(timeframe) ?? []) waiter.resolve();
    this.#waiters.delete(timeframe);
    for (const listener of this.#listeners) {
      if (listener.timeframe !== timeframe) continue;
      const was = before?.[listener.basis];
      const bars = [...read[listener.basis].values()].sort((a, b) => a.t - b.t);
      if (listener.shown === null) {
        /* A chart that listened before the first read: the newest bar opens its stream. */
        const first = bars.at(-1);
        if (first) {
          listener.shown = first.t;
          listener.emit({ type: "bar", bar: first, status: this.#status(timeframe) });
        }
        continue;
      }
      const shownAt = listener.shown;
      let sent = false;
      const changed = bars.find((bar) => bar.t < shownAt && was?.get(bar.t) !== undefined && ohlc(was.get(bar.t) as Bar) !== ohlc(bar));
      if (changed) {
        const correction: BarCorrection = { instrument: this.#symbol, from: changed.t, to: shownAt, reason: "late_trade", at: this.#now() };
        listener.emit({ type: "corrected", correction });
      }
      for (const bar of bars) {
        if (bar.t < shownAt) continue;
        if (bar.t === shownAt && was?.get(bar.t) !== undefined && ohlc(was.get(bar.t) as Bar) === ohlc(bar)) continue;
        listener.shown = bar.t;
        sent = true;
        listener.emit({ type: "bar", bar, status: this.#status(timeframe) });
      }
      if (!sent) listener.emit({ type: "status", status: this.#status(timeframe) });
    }
  }

  /** A read that failed: the last good bars stay, and the chart says they are stale. */
  fail(timeframe: FuturesTimeframe): void {
    if (this.#disposed) return;
    this.#failed.add(timeframe);
    for (const listener of this.#listeners) if (listener.timeframe === timeframe) listener.emit({ type: "status", status: this.#status(timeframe) });
  }

  dispose(): void {
    this.#disposed = true;
    for (const list of this.#waiters.values()) for (const waiter of list) waiter.reject(new Error("the market left the page"));
    this.#waiters.clear();
    this.#listeners.clear();
  }

  #bars(candles: readonly FuturesCandle[]): Map<number, Bar> {
    const step = this.#step;
    const out = new Map<number, Bar>();
    for (const candle of candles) {
      const [o, h, l, c] = [candle.o, candle.h, candle.l, candle.c].map((value) => onTick(value, step)) as [string, string, string, string];
      /* The step follows the price, so only a broken price rounds to nothing; such a bar is left out. */
      if (Number(l) <= 0) continue;
      out.set(candle.t, {
        t: candle.t,
        o,
        /* Snapping to the step may pull a high under the open or the close (or a low over them): the bar keeps its shape. */
        h: [h, o, c].reduce((top, value) => (Number(value) > Number(top) ? value : top)),
        l: [l, o, c].reduce((bottom, value) => (Number(value) < Number(bottom) ? value : bottom)),
        c,
        v: candle.v === null ? null : candle.v.toFixed(6),
        turnover: null,
        trades: null,
      });
    }
    return out;
  }

  #status(timeframe: FuturesTimeframe | null): DataStatus {
    const now = this.#now();
    const read = timeframe ? this.#reads.get(timeframe) : undefined;
    const at = Math.min(now, read?.at ?? now);
    const fresh = read !== undefined && timeframe !== null && !this.#failed.has(timeframe) && now - at < readFreshMs(timeframe);
    return {
      state: fresh ? "delayed" : "stale",
      market: "open",
      source: { id: "phoenix", label: "Phoenix", rights: "display", attribution: null },
      at,
      gateway_at: now,
      age_ms: Math.max(0, now - at),
      delay_ms: fresh ? CANDLES_POLL_MS : null,
      derived: false,
    };
  }

  #wait(timeframe: FuturesTimeframe, signal?: AbortSignal): Promise<void> {
    if (this.#reads.has(timeframe)) return Promise.resolve();
    if (this.#disposed) return Promise.reject(new Error("the market left the page"));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => done(() => reject(new Error(`no bars for ${timeframe} yet`))), WAIT_MS);
      const done = (then: () => void) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const list = (this.#waiters.get(timeframe) ?? []).filter((entry) => entry !== waiter);
        if (list.length) this.#waiters.set(timeframe, list);
        else this.#waiters.delete(timeframe);
        then();
      };
      const onAbort = () => done(() => reject(new DOMException("aborted", "AbortError")));
      const waiter: Waiter = { resolve: () => done(resolve), reject: (error) => done(() => reject(error)) };
      this.#waiters.set(timeframe, [...(this.#waiters.get(timeframe) ?? []), waiter]);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  #basisOf(basis: PriceBasis): Basis | null {
    if (sameBasis(basis, LAST_BASIS)) return "last";
    if (sameBasis(basis, MARK_BASIS)) return "mark";
    return null;
  }

  #makeSource(): ChartSource {
    return {
      contract: CHART_CONTRACT_VERSION,
      instrument: async (id) => {
        if (id !== this.#symbol) throw new Error(`unknown instrument ${id}`);
        return this.instrument;
      },
      history: async (request, options): Promise<HistoryPage> => {
        const timeframe = timeframeOf(request.resolution);
        if (!timeframe) throw new Error("Phoenix's bars here are 1 m, 5 m, 15 m, 1 h, 4 h and 1 d");
        const basis = this.#basisOf(request.basis);
        if (!basis) throw new Error("this basis is not drawn here");
        await this.#wait(timeframe, options?.signal);
        const all = [...(this.#reads.get(timeframe)?.[basis].values() ?? [])].sort((a, b) => a.t - b.t);
        const page = (bars: Bar[], more: { forward: boolean; backward: boolean }): HistoryPage => ({ bars, more, gaps: [], display_step: this.#step, multiplier_version: null, status: this.#status(timeframe) });
        if (request.load === "init") {
          const bars = all.slice(-request.limit);
          return page(bars, { forward: bars.length > 0 && all.length > bars.length, backward: false });
        }
        const at = request.timestamp ?? 0;
        if (request.load === "forward") {
          const older = all.filter((bar) => bar.t < at);
          const bars = older.slice(-request.limit);
          return page(bars, { forward: bars.length > 0 && older.length > bars.length, backward: false });
        }
        const newer = all.filter((bar) => bar.t > at);
        const bars = newer.slice(0, request.limit);
        return page(bars, { forward: false, backward: bars.length > 0 && newer.length > bars.length });
      },
      subscribe: (request, emit) => {
        const timeframe = timeframeOf(request.resolution);
        const basis = this.#basisOf(request.basis);
        if (!timeframe || !basis || this.#disposed) return () => {};
        const bars = [...(this.#reads.get(timeframe)?.[basis].values() ?? [])];
        const newest = bars.reduce<number | null>((top, bar) => (top === null || bar.t > top ? bar.t : top), null);
        const listener: Listener = { timeframe, basis, emit, shown: newest };
        this.#listeners.add(listener);
        return () => {
          this.#listeners.delete(listener);
        };
      },
      series: async () => [],
      seriesHistory: async (request) => {
        throw new Error(`no series here (${request.series})`);
      },
      marks: async () => ({ marks: [], status: this.#status(null) }),
      book: async () => null,
    };
  }
}
