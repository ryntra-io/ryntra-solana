/**
 * The demo terminal's candles as the core chart's source (contract `ryntra.chart/2.2`, SOL-T4): Arcus's public market
 * data — the REST read the terminal makes when a market or an interval is chosen, and the candles of its WebSocket.
 * The terminal puts each read in (`put`) and each live candle (`tick`); the chart asks history and listens through
 * `source`. Nothing here is fetched and nothing is sent.
 *
 * The state under the chart is the stream's: `live` while frames keep coming (any frame — the best bid and ask arrive
 * many times a second), `delayed` while only the REST read stands (the terminal polls it every 30 s when the stream
 * refuses an interval), `stale` past that. The same rules as the spot feed (`core-chart-source.ts`): an older bar only
 * as a correction, one update of a bar a second.
 */
import type { Bar, BarCorrection, ChartSource, DataStatus, HistoryPage, Instrument, LiveEvent, PriceBasis, Resolution, TimeResolution } from "@ryntra/core/adapters";

export const CHART_CONTRACT_VERSION = "ryntra.chart/2.2";

export const PRICE_BASIS: PriceBasis = { kind: "last", measure: "price", in: "USD", adjustment: "raw", outcome: null };

export const ARCUS_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type ArcusTimeframe = (typeof ARCUS_TIMEFRAMES)[number];

const RESOLUTION: Readonly<Record<ArcusTimeframe, TimeResolution>> = {
  "1m": { kind: "time", unit: "minute", span: 1 },
  "5m": { kind: "time", unit: "minute", span: 5 },
  "15m": { kind: "time", unit: "minute", span: 15 },
  "1h": { kind: "time", unit: "hour", span: 1 },
  "4h": { kind: "time", unit: "hour", span: 4 },
  "1d": { kind: "time", unit: "day", span: 1 },
};

export const resolutionOf = (timeframe: ArcusTimeframe): TimeResolution => RESOLUTION[timeframe];

/** A resolution as the terminal's interval; null for one Arcus does not serve. */
export function timeframeOf(resolution: Resolution): ArcusTimeframe | null {
  if (resolution.kind !== "time") return null;
  return ARCUS_TIMEFRAMES.find((tf) => RESOLUTION[tf].unit === resolution.unit && RESOLUTION[tf].span === resolution.span) ?? null;
}

/** A candle as Arcus sends it: `openTime` in microseconds, prices and volume as decimal strings. */
export type ArcusCandle = Readonly<{ openTime: number; open: string; high: string; low: string; close: string; volume?: string; isFinal?: boolean }>;

export type ArcusChartMarket = Readonly<{
  /** The venue's market name, «BTC-USD»: the instrument's id and its symbol. */
  market: string;
  /** The venue's price step and size step, as it lists them. */
  tick: string;
  lot: string;
  minNotional: string | null;
}>;

/** How long the stream may say nothing before the chart stops calling it live. */
export const STREAM_SILENT_MS = 15_000;
/** How long a REST read stands as `delayed`: twice the terminal's poll. */
export const READ_FRESH_MS = 60_000;
/** The REST read's own delay: the terminal polls every 30 s. */
const POLL_MS = 30_000;
/** How often a quiet but working stream says so. */
const HEARTBEAT_MS = 5_000;

const decimalsOfStep = (step: string): number => (step.includes(".") ? step.length - step.indexOf(".") - 1 : 0);

/** A step the contract takes: a positive decimal with no exponent; anything else is read as one cent. */
export function stepOf(value: string | null | undefined, fallback = "0.01"): string {
  return typeof value === "string" && /^\d+(\.\d+)?$/.test(value) && Number(value) > 0 ? value : fallback;
}

/** A number on the step, as the contract's decimal string: never an exponent, never more digits than the step. */
export function onTick(value: number, step: string): string {
  const unit = Number(step);
  return (Math.round(value / unit) * unit).toFixed(decimalsOfStep(step));
}

const ohlc = (bar: Bar): string => `${bar.o}|${bar.h}|${bar.l}|${bar.c}|${bar.v}`;

const sameBasis = (a: PriceBasis, b: PriceBasis): boolean => a.kind === b.kind && a.measure === b.measure && a.in === b.in && a.adjustment === b.adjustment && a.outcome === b.outcome;

type Waiter = Readonly<{ resolve: () => void; reject: (error: Error) => void }>;

type Listener = {
  readonly timeframe: ArcusTimeframe;
  readonly emit: (event: LiveEvent) => void;
  shown: { t: number; sentAt: number; key: string } | null;
  held: ReturnType<typeof setTimeout> | null;
};

/** How long history waits for the terminal's read of an interval it has not read yet. */
const WAIT_MS = 25_000;

/**
 * One market's chart feed. `now` is the page's clock in ms of the epoch — the bars' own clock (a test passes one that
 * stands).
 */
export class ArcusChartFeed {
  #market: ArcusChartMarket;
  readonly #now: () => number;
  readonly #bars = new Map<ArcusTimeframe, Map<number, Bar>>();
  readonly #readAt = new Map<ArcusTimeframe, number>();
  readonly #newestAtInit = new Map<ArcusTimeframe, number>();
  readonly #waiters = new Map<ArcusTimeframe, Waiter[]>();
  readonly #listeners = new Set<Listener>();
  #stream: "connecting" | "live" | "down" = "connecting";
  #frameAt: number | null = null;
  #saidAt = 0;
  #disposed = false;
  readonly source: ChartSource;

  constructor(market: ArcusChartMarket, now: () => number = Date.now) {
    this.#market = { ...market, tick: stepOf(market.tick), lot: stepOf(market.lot, "0.0001") };
    this.#now = now;
    this.source = this.#makeSource();
  }

  /** The market as the venue lists it now: its steps arrive with the market list, after the chart may have opened. */
  describe(update: Readonly<Partial<Omit<ArcusChartMarket, "market">>>): void {
    this.#market = {
      ...this.#market,
      ...(update.tick !== undefined ? { tick: stepOf(update.tick, this.#market.tick) } : {}),
      ...(update.lot !== undefined ? { lot: stepOf(update.lot, this.#market.lot) } : {}),
      ...(update.minNotional !== undefined ? { minNotional: update.minNotional } : {}),
    };
  }

  /** The instrument as the chart and the trading layer see it now. */
  get instrument(): Instrument {
    const market = this.#market;
    const [base] = market.market.split("-");
    return {
      id: market.market,
      symbol: market.market,
      network: "robinhood",
      venue: "arcus",
      kind: "perp",
      base: base || market.market,
      quote: "USD",
      tick: market.tick,
      price_rule: null,
      lot: market.lot,
      min_notional: market.minNotional && /^\d+(\.\d+)?$/.test(market.minNotional) ? market.minNotional : null,
      price_band: null,
      multiplier: "1",
      multiplier_version: null,
      session: { timezone: "UTC", windows: [], holidays: [] },
      reference_session: null,
      scale: "price",
      outcomes: [],
      min_resolution: RESOLUTION["1m"],
      resolutions: ARCUS_TIMEFRAMES.map((tf) => RESOLUTION[tf]),
      bases: [PRICE_BASIS],
      trading_basis: PRICE_BASIS,
    };
  }

  /** Whether the chart's numbers are live now: the trading layer moves a draft only on live data. */
  get live(): boolean {
    return this.#status(null).state === "live";
  }

  /** A whole read of an interval — the REST answer or the stream's snapshot. A bar the screen holds that changed is a correction. */
  put(timeframe: ArcusTimeframe, candles: readonly ArcusCandle[], at: number = this.#now()): void {
    if (this.#disposed) return;
    const before = this.#bars.get(timeframe);
    const next = new Map<number, Bar>();
    for (const candle of candles) {
      const bar = this.#bar(candle);
      if (bar) next.set(bar.t, bar);
    }
    this.#bars.set(timeframe, next);
    this.#readAt.set(timeframe, at);
    for (const waiter of this.#waiters.get(timeframe) ?? []) waiter.resolve();
    this.#waiters.delete(timeframe);
    const sorted = [...next.values()].sort((a, b) => a.t - b.t);
    for (const listener of this.#listeners) {
      if (listener.timeframe !== timeframe || !listener.shown) continue;
      const shownAt = listener.shown.t;
      const changed = sorted.find((bar) => bar.t < shownAt && before?.get(bar.t) !== undefined && ohlc(before.get(bar.t) as Bar) !== ohlc(bar));
      if (changed) this.#correct(listener, changed.t);
      for (const bar of sorted) if (bar.t >= shownAt) this.#send(listener, bar);
    }
  }

  /** One live candle from the stream. */
  tick(timeframe: ArcusTimeframe, candle: ArcusCandle, at: number = this.#now()): void {
    if (this.#disposed) return;
    const bar = this.#bar(candle);
    if (!bar) return;
    this.alive(at, false);
    const bars = this.#bars.get(timeframe) ?? new Map<number, Bar>();
    const before = bars.get(bar.t);
    bars.set(bar.t, bar);
    this.#bars.set(timeframe, bars);
    for (const listener of this.#listeners) {
      if (listener.timeframe !== timeframe || !listener.shown) continue;
      if (bar.t >= listener.shown.t) this.#send(listener, bar);
      else if (before === undefined || ohlc(before) !== ohlc(bar)) this.#correct(listener, bar.t);
    }
  }

  /** A frame from the stream — any frame: the connection works. Says so to a quiet chart every few seconds. */
  alive(at: number = this.#now(), say = true): void {
    if (this.#disposed) return;
    const was = this.live;
    this.#stream = "live";
    this.#frameAt = at;
    if (say && (!was || at - this.#saidAt >= HEARTBEAT_MS)) this.#sayStatus();
  }

  /** The stream closed: the chart says the numbers are no longer live. */
  down(): void {
    if (this.#disposed) return;
    this.#stream = "down";
    this.#sayStatus();
  }

  /** Stops every wait and stream: the market left the terminal. */
  dispose(): void {
    this.#disposed = true;
    for (const list of this.#waiters.values()) for (const waiter of list) waiter.reject(new Error("the market left the terminal"));
    this.#waiters.clear();
    for (const listener of this.#listeners) if (listener.held) clearTimeout(listener.held);
    this.#listeners.clear();
  }

  #bar(candle: ArcusCandle): Bar | null {
    const step = this.#market.tick;
    const t = Math.floor(Number(candle.openTime) / 1_000);
    const values = [candle.open, candle.high, candle.low, candle.close].map(Number);
    if (!Number.isFinite(t) || t <= 0 || values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
    const [o, h, l, c] = values.map((value) => onTick(value as number, step)) as [string, string, string, string];
    const volume = candle.volume !== undefined ? Number(candle.volume) : Number.NaN;
    return {
      t,
      o,
      /* Snapping to the step may pull a high under the open or the close (or a low over them): the bar keeps its shape. */
      h: [h, o, c].reduce((top, value) => (Number(value) > Number(top) ? value : top)),
      l: [l, o, c].reduce((bottom, value) => (Number(value) < Number(bottom) ? value : bottom)),
      c,
      v: Number.isFinite(volume) && volume >= 0 ? onTick(volume, this.#market.lot) : null,
      turnover: null,
      trades: null,
    };
  }

  #status(timeframe: ArcusTimeframe | null): DataStatus {
    const now = this.#now();
    const streaming = this.#stream === "live" && this.#frameAt !== null && now - this.#frameAt < STREAM_SILENT_MS;
    const readAt = timeframe ? this.#readAt.get(timeframe) : Math.max(0, ...this.#readAt.values());
    const at = Math.min(now, streaming ? (this.#frameAt as number) : readAt || this.#frameAt || now);
    const state = streaming ? "live" : now - at < READ_FRESH_MS ? "delayed" : "stale";
    return {
      state,
      market: "open",
      source: { id: "arcus", label: "Arcus", rights: "display", attribution: null },
      at,
      gateway_at: now,
      age_ms: Math.max(0, now - at),
      delay_ms: state === "delayed" ? POLL_MS : null,
      derived: false,
    };
  }

  #sayStatus(): void {
    this.#saidAt = this.#now();
    for (const listener of this.#listeners) listener.emit({ type: "status", status: this.#status(listener.timeframe) });
  }

  #correct(listener: Listener, from: number): void {
    if (!listener.shown) return;
    const correction: BarCorrection = { instrument: this.#market.market, from, to: listener.shown.t, reason: "late_trade", at: this.#now() };
    listener.emit({ type: "corrected", correction });
  }

  /** One bar to one listener: a later open at once; the same open at most once a second — the newest state wins. */
  #send(listener: Listener, bar: Bar): void {
    const key = ohlc(bar);
    const shown = listener.shown;
    const emit = () => {
      listener.held = null;
      const newest = this.#bars.get(listener.timeframe)?.get(bar.t) ?? bar;
      listener.shown = { t: newest.t, sentAt: this.#now(), key: ohlc(newest) };
      listener.emit({ type: "bar", bar: newest, status: this.#status(listener.timeframe) });
    };
    if (!shown || bar.t > shown.t) {
      if (listener.held) {
        clearTimeout(listener.held);
        listener.held = null;
        /* The bar before closes at its last state before the new one opens. */
        const last = this.#bars.get(listener.timeframe)?.get(shown?.t ?? -1);
        if (last && shown && ohlc(last) !== shown.key) {
          listener.shown = { t: last.t, sentAt: this.#now(), key: ohlc(last) };
          listener.emit({ type: "bar", bar: last, status: this.#status(listener.timeframe) });
        }
      }
      emit();
      return;
    }
    if (bar.t !== shown.t || key === shown.key || listener.held) return;
    const wait = 1_000 - (this.#now() - shown.sentAt);
    if (wait <= 0) emit();
    else listener.held = setTimeout(emit, wait);
  }

  /** History waits for a whole read of the interval (`put`): a live candle alone is no history. */
  #wait(timeframe: ArcusTimeframe, signal?: AbortSignal): Promise<void> {
    if (this.#readAt.has(timeframe)) return Promise.resolve();
    if (this.#disposed) return Promise.reject(new Error("the market left the terminal"));
    return new Promise<void>((resolve, reject) => {
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
      const waiter: Waiter = { resolve: () => done(resolve), reject: (error) => done(() => reject(error)) };
      this.#waiters.set(timeframe, [...(this.#waiters.get(timeframe) ?? []), waiter]);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  #makeSource(): ChartSource {
    return {
      contract: CHART_CONTRACT_VERSION,
      instrument: async (id) => {
        if (id !== this.#market.market) throw new Error(`unknown instrument ${id}`);
        return this.instrument;
      },
      history: async (request, options): Promise<HistoryPage> => {
        const timeframe = timeframeOf(request.resolution);
        if (!timeframe) throw new Error("Arcus serves 1 m, 5 m, 15 m, 1 h, 4 h and 1 d");
        if (!sameBasis(request.basis, PRICE_BASIS)) throw new Error("this basis is not drawn here");
        await this.#wait(timeframe, options?.signal);
        const all = [...(this.#bars.get(timeframe)?.values() ?? [])].sort((a, b) => a.t - b.t);
        const page = (bars: Bar[], more: { forward: boolean; backward: boolean }): HistoryPage => ({ bars, more, gaps: [], display_step: this.#market.tick, multiplier_version: null, status: this.#status(timeframe) });
        if (request.load === "init") {
          const bars = all.slice(-request.limit);
          const newest = bars.at(-1);
          if (newest) this.#newestAtInit.set(timeframe, newest.t);
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
        if (!timeframe || this.#disposed) return () => {};
        const newest = this.#newestAtInit.get(timeframe);
        const bar = newest === undefined ? undefined : this.#bars.get(timeframe)?.get(newest);
        const listener: Listener = { timeframe, emit, shown: bar ? { t: bar.t, sentAt: this.#now(), key: ohlc(bar) } : null, held: null };
        this.#listeners.add(listener);
        /* Whatever arrived between the history and this subscription goes out now, newest state first in order. */
        const all = [...(this.#bars.get(timeframe)?.values() ?? [])].sort((a, b) => a.t - b.t);
        for (const next of all) if (listener.shown && next.t >= listener.shown.t) this.#send(listener, next);
        return () => {
          if (listener.held) clearTimeout(listener.held);
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
