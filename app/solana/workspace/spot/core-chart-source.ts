/**
 * The candles Solana already has, as the core chart's source (contract `ryntra.chart/2.2`, CH-17): GeckoTerminal's
 * OHLCV of the market's deepest pool, read by the spot page (`useSpotCandles`), its last bar closed at the page's one
 * last price — the header's and the ticket's (B15). Seconds and history from Ryntra's own gateway come with CH-17a.
 *
 * The page puts each read in (`put`) and the live price (`live`); the chart asks history and listens through
 * `source`. A timeframe the page has not read yet is waited for: the chart's interval switch is the page's, so the
 * read follows it. Nothing here is fetched and nothing is sent.
 *
 * Why not the core's `chartSourceFromV1`: it ships in `@ryntra/core/adapters/testing`, which imports `node:test` and
 * `node:assert` and cannot go into a browser bundle; the same rules — no `live` state for numbers an old feed does
 * not date, an older bar only as a correction, one update of a bar a second — are kept here.
 *
 * Volume: GeckoTerminal states a bar's volume in dollars (`currency=usd`), so `turnover` carries it exactly and `v`
 * — the base asset, as the contract counts it — is that dollar volume at the bar's typical price, (H + L + C) / 3.
 */
import type { Bar, BarCorrection, ChartSource, DataStatus, HistoryPage, Instrument, LiveEvent, PriceBasis, Resolution, TimeResolution } from "@ryntra/core/adapters";

import type { NormalizedCandle } from "../../../../lib/chart/types.ts";
import { TIMEFRAME_SOURCE, TIMEFRAME_TTL_MS, withLivePrice, type SpotTimeframe } from "../../../../lib/spot/candles.ts";
import { priceDecimals } from "./spot-format.ts";

export const CHART_CONTRACT_VERSION = "ryntra.chart/2.2";

export const PRICE_BASIS: PriceBasis = { kind: "last", measure: "price", in: "USD", adjustment: "raw", outcome: null };
export const CAP_BASIS: PriceBasis = { kind: "last", measure: "market_cap", in: "USD", adjustment: "raw", outcome: null };

const RESOLUTION: Readonly<Record<SpotTimeframe, TimeResolution>> = {
  "1m": { kind: "time", unit: "minute", span: 1 },
  "5m": { kind: "time", unit: "minute", span: 5 },
  "15m": { kind: "time", unit: "minute", span: 15 },
  "1h": { kind: "time", unit: "hour", span: 1 },
  "4h": { kind: "time", unit: "hour", span: 4 },
  "1d": { kind: "time", unit: "day", span: 1 },
};
const TIMEFRAMES = Object.keys(RESOLUTION) as SpotTimeframe[];

export const resolutionOf = (timeframe: SpotTimeframe): TimeResolution => RESOLUTION[timeframe];

/** A resolution as the spot page's timeframe; null for one the source does not draw. */
export function timeframeOf(resolution: Resolution): SpotTimeframe | null {
  if (resolution.kind !== "time") return null;
  return TIMEFRAMES.find((tf) => RESOLUTION[tf].unit === resolution.unit && RESOLUTION[tf].span === resolution.span) ?? null;
}

/** A price step from the price's own size (the header's decimals, B15): $104 → 0.01, $0.000003 → 1e-9. */
export function tickFor(reference: number | null): string {
  const decimals = priceDecimals(reference);
  return decimals === 0 ? "1" : `0.${"0".repeat(decimals - 1)}1`;
}

const decimalsOfStep = (step: string): number => (step.includes(".") ? step.length - step.indexOf(".") - 1 : 0);

/** A number on the step, as the contract's decimal string: never an exponent, never more digits than the step. */
export function onTick(value: number, step: string): string {
  const decimals = decimalsOfStep(step);
  const unit = Number(step);
  const snapped = Math.round(value / unit) * unit;
  return snapped.toFixed(decimals);
}

/**
 * The state of the spot candles' numbers, for the big chart and the compact ones alike: `delayed` by as long as
 * Ryntra's server keeps a timeframe's read (`TIMEFRAME_TTL_MS`, 20 s for a minute's bars up to 10 min for a day's),
 * `stale` when the source stopped answering and the last good read is shown — aged from that read. GeckoTerminal is
 * named with the pool it read, and Jupiter beside it when Jupiter's price closes the last bar. `derived` — the numbers
 * are ours, counted from the source's: the market cap (price × today's supply), a line anchored to the live price.
 */
export function candlesStatus(
  read: Readonly<{ observedAt: number | null; stale: boolean; pool: string | null; live?: boolean; derived?: boolean }>,
  timeframe: SpotTimeframe,
  now: number = Date.now(),
): DataStatus {
  const at = Math.min(now, read.observedAt ?? now);
  return {
    state: read.stale ? "stale" : "delayed",
    market: "open",
    source: { id: "geckoterminal", label: `GeckoTerminal${read.pool ? ` · ${read.pool}` : ""}${read.live ? " · Jupiter" : ""}`, rights: "display", attribution: null },
    at,
    gateway_at: now,
    age_ms: Math.max(0, now - at),
    delay_ms: read.stale ? null : TIMEFRAME_TTL_MS[timeframe],
    derived: read.derived ?? false,
  };
}

export type SpotChartMarket = Readonly<{
  mint: string;
  symbol: string;
  /** A tokenized stock is a `stock` on the chart; everything else trades as `spot`. */
  stock: boolean;
  /** The supply the market cap is counted on (`capFactorOf`); null — no capitalisation basis. */
  capFactor: number | null;
  /** A price the first step is read from (the page's live price); null — the reads alone set it. */
  reference: number | null;
}>;

type Read = Readonly<{ candles: readonly NormalizedCandle[]; observedAt: number; stale: boolean; pool: string | null }>;

type Waiter = Readonly<{ resolve: (read: Read) => void; reject: (error: Error) => void }>;

type Listener = Readonly<{ timeframe: SpotTimeframe; basis: PriceBasis; emit: (event: LiveEvent) => void }>;

/** How long history waits for the page's read of a timeframe it has not read yet. */
const WAIT_MS = 25_000;

const sameBasis = (a: PriceBasis, b: PriceBasis): boolean => a.kind === b.kind && a.measure === b.measure && a.in === b.in && a.adjustment === b.adjustment && a.outcome === b.outcome;

const ohlc = (bar: Bar): string => `${bar.o}|${bar.h}|${bar.l}|${bar.c}`;

/** The finest step the chart takes: past it a float prints noise, and a wick that far is a broken print. */
const FINEST_STEP = "0.000000000001";

/** The finer of two steps, never past `FINEST_STEP`: a token that fell keeps every bar it ever drew. */
const finer = (a: string, b: string): string => (Number(b) < Number(a) && Number(b) >= Number(FINEST_STEP) ? b : a);

/**
 * One market's chart feed: the reads the page made, per timeframe, and the live price. `now` is the page's clock in
 * ms of the epoch — the bars' own clock (a test passes one that stands).
 */
export class SpotChartFeed {
  #market: SpotChartMarket;
  readonly #now: () => number;
  readonly #reads = new Map<SpotTimeframe, Read>();
  readonly #waiters = new Map<SpotTimeframe, Waiter[]>();
  readonly #listeners = new Set<Listener>();
  /** Per timeframe and basis: the newest bar the screen holds, and when it last went out. */
  readonly #shown = new Map<string, { t: number; sentAt: number; bar: Bar }>();
  /** Per timeframe and basis: an update of the newest bar waiting for the rest of its second. */
  readonly #held = new Map<string, { timer: ReturnType<typeof setTimeout>; send: () => void }>();
  /** What the screen holds per timeframe and basis, by open: to tell a bar that changed under it. */
  readonly #screen = new Map<string, Map<number, string>>();
  #live: Readonly<{ price: number; at: number }> | null = null;
  /** The price step: from the reference, then as fine as the smallest price any read or the live price brought. */
  #tick: string;
  readonly #capTick = "1";
  #disposed = false;
  readonly source: ChartSource;

  constructor(market: SpotChartMarket, now: () => number = Date.now) {
    this.#market = market;
    this.#now = now;
    this.#tick = tickFor(market.reference);
    this.source = this.#makeSource();
  }

  /** The price step the feed draws on now: the levels on the chart go on it too. */
  get tick(): string {
    return this.#tick;
  }

  /** The market as the page reads it now: its symbol, whether it is a stock, and the supply its cap is counted on. */
  describe(update: Readonly<Partial<Pick<SpotChartMarket, "symbol" | "stock" | "capFactor">>>): void {
    const before = this.#market.capFactor;
    const next = update.capFactor === undefined ? before : update.capFactor;
    /* The supply moves by a hair with every read of the market; the cap's bars change only when it truly moved (0.1 %),
       or every bar on screen would read as corrected. */
    const capFactor = before !== null && next !== null && Math.abs(next / before - 1) < 0.001 ? before : next;
    this.#market = { ...this.#market, ...update, capFactor };
  }

  /**
   * The page's read of a timeframe: its candles (oldest first, unix seconds), when it was made, and whether the source
   * is behind. A stale read keeps the time of the last good one: the age under the chart counts from it.
   */
  put(timeframe: SpotTimeframe, candles: readonly NormalizedCandle[], observedAt: number | null, stale: boolean, pool: string | null = null): void {
    if (this.#disposed) return;
    const before = this.#reads.get(timeframe);
    const when = stale && before ? before.observedAt : (observedAt ?? before?.observedAt ?? this.#now());
    const read: Read = { candles, observedAt: when, stale, pool: pool ?? before?.pool ?? null };
    /* From the opens and closes, not the wicks: one broken print of a wick must not make every price print ten zeros. */
    let low = Infinity;
    for (const candle of candles) for (const price of [candle.open, candle.close]) if (price > 0 && price < low) low = price;
    if (Number.isFinite(low)) this.#tick = finer(this.#tick, tickFor(low));
    this.#reads.set(timeframe, read);
    for (const waiter of this.#waiters.get(timeframe) ?? []) waiter.resolve(read);
    this.#waiters.delete(timeframe);
    this.#push(timeframe);
  }

  /** The page's one last price, while it is fresh; null when there is none. */
  live(price: number | null, at: number = this.#now()): void {
    if (this.#disposed) return;
    const next = price !== null && Number.isFinite(price) && price > 0 ? { price, at } : null;
    if (next !== null && next.price === this.#live?.price) return;
    this.#live = next;
    if (next) this.#tick = finer(this.#tick, tickFor(next.price));
    for (const timeframe of new Set([...this.#listeners].map((listener) => listener.timeframe))) this.#push(timeframe);
  }

  /** Stops every wait and stream: the market left the page. */
  dispose(): void {
    this.#disposed = true;
    for (const list of this.#waiters.values()) for (const waiter of list) waiter.reject(new Error("the market left the page"));
    this.#waiters.clear();
    for (const pending of this.#held.values()) clearTimeout(pending.timer);
    this.#held.clear();
    this.#listeners.clear();
  }

  #instrument(): Instrument {
    const market = this.#market;
    return {
      id: market.mint,
      symbol: market.symbol,
      network: "solana",
      venue: "geckoterminal",
      kind: market.stock ? "stock" : "spot",
      base: market.mint,
      quote: "USD",
      tick: this.#tick,
      price_rule: null,
      lot: "0.000000001",
      min_notional: null,
      price_band: null,
      multiplier: "1",
      multiplier_version: null,
      session: { timezone: "UTC", windows: [], holidays: [] },
      reference_session: null,
      scale: "price",
      outcomes: [],
      min_resolution: RESOLUTION["1m"],
      resolutions: TIMEFRAMES.map((tf) => RESOLUTION[tf]),
      bases: market.capFactor === null ? [PRICE_BASIS] : [PRICE_BASIS, CAP_BASIS],
      trading_basis: PRICE_BASIS,
    };
  }

  #wait(timeframe: SpotTimeframe, signal?: AbortSignal): Promise<Read> {
    const read = this.#reads.get(timeframe);
    if (read) return Promise.resolve(read);
    if (this.#disposed) return Promise.reject(new Error("the market left the page"));
    return new Promise<Read>((resolve, reject) => {
      const timer = setTimeout(() => done(() => reject(new Error(`no candles for ${timeframe} yet`))), WAIT_MS);
      const done = (then: () => void) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const list = (this.#waiters.get(timeframe) ?? []).filter((entry) => entry !== waiter);
        if (list.length) this.#waiters.set(timeframe, list);
        else this.#waiters.delete(timeframe);
        then();
      };
      const onAbort = () => done(() => reject(new DOMException("aborted", "AbortError")));
      const waiter: Waiter = { resolve: (value) => done(() => resolve(value)), reject: (error) => done(() => reject(error)) };
      this.#waiters.set(timeframe, [...(this.#waiters.get(timeframe) ?? []), waiter]);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * A read's bars in a basis: the live price closes the bar of the moment, then each price goes onto the basis' step.
   * A bar the live price opened before the source has one carries no volume: it is not known yet, not zero.
   */
  #bars(timeframe: SpotTimeframe, read: Read, basis: PriceBasis): Bar[] {
    const seconds = TIMEFRAME_SOURCE[timeframe].seconds;
    const candles = withLivePrice(read.candles, this.#live?.price ?? null, this.#now() / 1000, seconds);
    /* The source's own bars by open: their volume is counted at their own prices, not at the live price closing the last. */
    const fromSource = new Map(read.candles.map((candle) => [candle.time, candle]));
    const cap = basis.measure === "market_cap" ? this.#market.capFactor : null;
    const step = cap === null ? this.#tick : this.#capTick;
    const factor = cap ?? 1;
    const out: Bar[] = [];
    for (const candle of candles) {
      const o = onTick(candle.open * factor, step);
      const h = onTick(candle.high * factor, step);
      const l = onTick(candle.low * factor, step);
      const c = onTick(candle.close * factor, step);
      /* The step follows the smallest price read, so only a broken price rounds to nothing; such a bar is left out. */
      if (Number(l) <= 0) continue;
      const own = fromSource.get(candle.time);
      const usd = own && own.volume !== undefined && Number.isFinite(own.volume) && own.volume >= 0 ? own.volume : null;
      const typical = own ? (own.high + own.low + own.close) / 3 : 1;
      out.push({
        t: candle.time * 1000,
        o,
        /* Rounding to the step may pull a high under the open or the close (or a low over them): the bar keeps its shape. */
        h: [h, o, c].reduce((top, value) => (Number(value) > Number(top) ? value : top)),
        l: [l, o, c].reduce((bottom, value) => (Number(value) < Number(bottom) ? value : bottom)),
        c,
        v: usd === null ? null : (usd / typical).toFixed(9),
        turnover: usd === null ? null : usd.toFixed(2),
        trades: null,
      });
    }
    return out;
  }

  #status(read: Read | null, timeframe: SpotTimeframe, basis: PriceBasis = PRICE_BASIS): DataStatus {
    /* The newest number is the later of the read and the live price that closes its last bar. */
    const live = this.#live !== null && !(read?.stale ?? false);
    const observed = Math.max(read?.observedAt ?? 0, live ? (this.#live?.at ?? 0) : 0);
    return candlesStatus({ observedAt: observed || null, stale: read?.stale ?? false, pool: read?.pool ?? null, live, derived: basis.measure === "market_cap" }, timeframe, this.#now());
  }

  /** The newest state of a timeframe to everyone who listens to it: the newest bar replaced, new bars in order, an older change as a correction. */
  #push(timeframe: SpotTimeframe): void {
    const read = this.#reads.get(timeframe);
    if (!read) return;
    for (const listener of this.#listeners) {
      if (listener.timeframe !== timeframe) continue;
      const key = `${timeframe}|${listener.basis.measure}`;
      const shown = this.#shown.get(key);
      if (!shown) continue;
      const bars = this.#bars(timeframe, read, listener.basis);
      /* A bar the screen already holds that changed under it — the source's own bar, read again after the moment's
         bar opened — is a correction: the screen reloads it, never a silent change. */
      const changed = bars.find((bar) => bar.t < shown.t && this.#differs(key, bar));
      if (changed) {
        const correction: BarCorrection = { instrument: this.#market.mint, from: changed.t, to: shown.t, reason: "late_trade", at: this.#now() };
        listener.emit({ type: "corrected", correction });
      }
      /* When a newer bar opens, the newest bar on screen closes at the last state the screen was sent or held — the
         live price — not at the source's older close; the update held for its second goes out first (`#send`). */
      const opens = bars.some((bar) => bar.t > shown.t);
      for (const bar of bars) {
        if (bar.t < shown.t) continue;
        if (bar.t === shown.t && opens) continue;
        this.#send(key, listener, bar, () => this.#status(read, timeframe, listener.basis));
      }
      if (read.stale) listener.emit({ type: "status", status: this.#status(read, timeframe, listener.basis) });
    }
  }

  #remember(key: string, bars: readonly Bar[]): void {
    this.#screen.set(key, new Map(bars.map((bar) => [bar.t, ohlc(bar)])));
  }

  #differs(key: string, bar: Bar): boolean {
    const held = this.#screen.get(key)?.get(bar.t);
    return held !== undefined && held !== ohlc(bar);
  }

  /**
   * One bar to one listener: the same open at most once a second; a later open at once, after the last state of the
   * bar before it — an update still waiting for its second goes out first, so the closing state is never lost.
   */
  #send(key: string, listener: Listener, bar: Bar, status: () => DataStatus): void {
    const emit = (value: Bar) => {
      this.#shown.set(key, { t: value.t, sentAt: this.#now(), bar: value });
      this.#screen.get(key)?.set(value.t, ohlc(value));
      listener.emit({ type: "bar", bar: value, status: status() });
    };
    const flush = () => {
      const pending = this.#held.get(key);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#held.delete(key);
      pending.send();
    };
    const shown = this.#shown.get(key);
    if (!shown || bar.t > shown.t) {
      flush();
      emit(bar);
      return;
    }
    if (bar.t !== shown.t || `${ohlc(bar)}|${bar.v}` === `${ohlc(shown.bar)}|${shown.bar.v}`) return;
    const wait = 1_000 - (this.#now() - shown.sentAt);
    const pending = this.#held.get(key);
    if (pending) clearTimeout(pending.timer);
    this.#held.delete(key);
    if (wait <= 0) {
      emit(bar);
      return;
    }
    const send = () => {
      if (this.#listeners.has(listener)) emit(bar);
    };
    this.#held.set(key, {
      send,
      timer: setTimeout(() => {
        this.#held.delete(key);
        send();
      }, wait),
    });
  }

  #makeSource(): ChartSource {
    return {
      contract: CHART_CONTRACT_VERSION,
      instrument: async (id) => {
        if (id !== this.#market.mint) throw new Error(`unknown instrument ${id}`);
        return this.#instrument();
      },
      history: async (request, options): Promise<HistoryPage> => {
        const timeframe = timeframeOf(request.resolution);
        if (!timeframe) throw new Error("this source draws 1 m, 5 m, 15 m, 1 h, 4 h and 1 d");
        const basis = this.#instrument().bases.find((entry) => sameBasis(entry, request.basis));
        if (!basis) throw new Error("this basis is not drawn here");
        const read = await this.#wait(timeframe, options?.signal);
        const all = this.#bars(timeframe, read, basis);
        const key = `${timeframe}|${basis.measure}`;
        const step = basis.measure === "market_cap" ? this.#capTick : this.#tick;
        const status = this.#status(read, timeframe, basis);
        const page = (bars: Bar[], more: { forward: boolean; backward: boolean }): HistoryPage => ({ bars, more, gaps: [], display_step: step, multiplier_version: null, status });
        if (request.load === "init") {
          const bars = all.slice(-request.limit);
          this.#remember(key, all);
          const newest = bars.at(-1);
          if (newest) this.#shown.set(key, { t: newest.t, sentAt: this.#now(), bar: newest });
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
        if (!timeframe) return () => {};
        const listener: Listener = { timeframe, basis: request.basis, emit };
        this.#listeners.add(listener);
        return () => {
          this.#listeners.delete(listener);
          const key = `${timeframe}|${request.basis.measure}`;
          const pending = this.#held.get(key);
          if (pending && ![...this.#listeners].some((other) => other.timeframe === timeframe && other.basis.measure === request.basis.measure)) {
            clearTimeout(pending.timer);
            this.#held.delete(key);
          }
        };
      },
      series: async () => [],
      seriesHistory: async (request) => {
        throw new Error(`no series here (${request.series})`);
      },
      marks: async () => {
        /* The market's marks and the person's own come with the chart's `marks`, from the page's own reads. */
        const [timeframe, read] = this.#reads.entries().next().value ?? ["1h", null];
        return { marks: [], status: this.#status(read, timeframe) };
      },
      book: async () => null,
    };
  }
}
