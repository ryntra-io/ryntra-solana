import type { Bar, ChartSource, DataStatus, HistoryPage, LiveEvent, PriceBasis, TickResolution } from '@ryntra/core/adapters';
import type { TokenTrade } from './tape-view.ts';

/**
 * «Tick»: the coin's chart a bar a trade, as rxn.gg's desk has it beside the intervals. The bars are the
 * trades the desk already reads (`/api/spot/token?part=trades`, the coin's busiest pool on GeckoTerminal): each trade
 * its own bar at its price, the newest coming in as the read comes. The candles of every interval stay the base
 * source's; this source only adds the one resolution of a trade a bar and serves it.
 *
 * Pure but for its listeners: the screen puts the trades, the core chart reads the bars.
 */

/** A bar a trade. */
export const TICK: TickResolution = { kind: 'tick', trades: 1 };

const isTick = (resolution: { kind: string }) => resolution.kind === 'tick';

/** A number as a bar takes it: a plain decimal, no exponent — on `step` where one is given, as the candles stand on it. */
const decimal = (value: number, step?: string) => {
  const places = step ? (step.split('.')[1]?.length ?? 0) : null;
  return places === null ? value.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 10 }) : value.toFixed(places);
};

/**
 * The trades as bars, oldest first: a trade's price open, high, low and close alike, its tokens the volume, its dollars
 * the turnover. Two trades of one second keep their order a millisecond apart, so no bar stands on another. In the
 * market cap a trade's capitalisation is the trade's own (GeckoTerminal's), else its price times the supply `cap`.
 */
export function tickBars(trades: readonly TokenTrade[], measure: 'price' | 'market_cap', cap: number | null, step?: string): Bar[] {
  const ordered = [...trades].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const bars: Bar[] = [];
  let last = -Infinity;
  for (const trade of ordered) {
    const price = trade.priceUsd;
    const at = Date.parse(trade.at);
    if (price === null || !(price > 0) || !Number.isFinite(at)) continue;
    const value = measure === 'price' ? price : (trade.capUsd ?? (cap !== null && cap > 0 ? price * cap : null));
    if (value === null || !(value > 0)) continue;
    const t = Math.max(at, last + 1);
    last = t;
    const c = decimal(value, step);
    bars.push({ t, o: c, h: c, l: c, c, v: decimal(trade.tokenAmount), turnover: trade.usd !== null ? decimal(trade.usd) : null, trades: 1 });
  }
  return bars;
}

type Listener = Readonly<{ basis: PriceBasis; emit: (event: LiveEvent) => void }>;

/** How often the trades are read: their numbers are this late at most. */
export const TICK_DELAY_MS = 8_000;

/**
 * A chart source over `base`: every request of a time interval goes to the base as it is; a bar-a-trade one is served
 * from the trades put in. `step` is the price step the base draws on now (the same for the ticks), `cap` the supply the
 * market cap is counted on.
 */
export class TickSource {
  readonly source: ChartSource;
  readonly #base: ChartSource;
  readonly #step: () => string;
  readonly #now: () => number;
  #cap: number | null = null;
  #trades: readonly TokenTrade[] = [];
  #observed = 0;
  readonly #listeners = new Set<Listener>();
  /** Per listener: the time of the newest bar it was sent. */
  readonly #sent = new WeakMap<Listener, number>();

  constructor(base: ChartSource, step: () => string, now: () => number = Date.now) {
    this.#base = base;
    this.#step = step;
    this.#now = now;
    this.source = this.#make();
  }

  /** The supply the market cap is counted on, as it is read. */
  setCap(cap: number | null): void {
    this.#cap = cap;
  }

  /** The trades as the desk holds them now (newest first or not): the new ones go out to the chart. */
  put(trades: readonly TokenTrade[]): void {
    this.#trades = trades;
    this.#observed = this.#now();
    for (const listener of this.#listeners) this.#push(listener);
  }

  #bars(basis: PriceBasis): Bar[] {
    const cap = basis.measure === 'market_cap';
    return tickBars(this.#trades, cap ? 'market_cap' : 'price', this.#cap, cap ? '1' : this.#step());
  }

  #status(basis: PriceBasis): DataStatus {
    const now = this.#now();
    const newest = this.#trades.reduce((most, trade) => Math.max(most, Date.parse(trade.at) || 0), 0);
    const at = Math.min(now, newest || this.#observed || now);
    return {
      state: this.#trades.length ? 'delayed' : 'gap',
      market: 'open',
      source: { id: 'geckoterminal', label: 'GeckoTerminal', rights: 'display', attribution: null },
      at,
      gateway_at: now,
      age_ms: Math.max(0, now - at),
      delay_ms: TICK_DELAY_MS,
      derived: basis.measure === 'market_cap',
    };
  }

  #push(listener: Listener): void {
    const bars = this.#bars(listener.basis);
    const since = this.#sent.get(listener) ?? -Infinity;
    const fresh = bars.filter((bar) => bar.t > since);
    if (!fresh.length) return;
    const status = this.#status(listener.basis);
    for (const bar of fresh) listener.emit({ type: 'bar', bar, status });
    this.#sent.set(listener, fresh.at(-1)!.t);
  }

  #make(): ChartSource {
    const base = this.#base;
    return {
      contract: base.contract,
      instrument: async (id, options) => {
        const instrument = await base.instrument(id, options);
        return { ...instrument, resolutions: [...instrument.resolutions.filter((r) => !isTick(r)), TICK] };
      },
      history: async (request, options): Promise<HistoryPage> => {
        if (!isTick(request.resolution)) return base.history(request, options);
        const all = this.#bars(request.basis);
        const status = this.#status(request.basis);
        const step = request.basis.measure === 'market_cap' ? '1' : this.#step();
        const page = (bars: Bar[], more: { forward: boolean; backward: boolean }): HistoryPage => ({ bars, more, gaps: [], display_step: step, multiplier_version: null, status });
        if (request.load === 'init') {
          const bars = all.slice(-request.limit);
          return page(bars, { forward: bars.length > 0 && all.length > bars.length, backward: false });
        }
        const at = request.timestamp ?? 0;
        if (request.load === 'forward') {
          const older = all.filter((bar) => bar.t < at);
          const bars = older.slice(-request.limit);
          return page(bars, { forward: bars.length > 0 && older.length > bars.length, backward: false });
        }
        const newer = all.filter((bar) => bar.t > at);
        const bars = newer.slice(0, request.limit);
        return page(bars, { forward: false, backward: bars.length > 0 && newer.length > bars.length });
      },
      subscribe: (request, emit) => {
        if (!isTick(request.resolution)) return base.subscribe(request, emit);
        const listener: Listener = { basis: request.basis, emit };
        // What history gave is on screen: only what comes after it goes out live.
        const shown = this.#bars(request.basis).at(-1);
        if (shown) this.#sent.set(listener, shown.t);
        this.#listeners.add(listener);
        return () => {
          this.#listeners.delete(listener);
        };
      },
      series: (instrument, options) => base.series(instrument, options),
      seriesHistory: (request, options) => base.seriesHistory(request, options),
      marks: (instrument, from, to, options) => base.marks(instrument, from, to, options),
      book: (instrument, step, options) => base.book(instrument, step, options),
    };
  }
}
