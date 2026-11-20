'use client';

/* The core chart (`@ryntra/core` 0.14.0, the one rxn.gg draws) is the coin's chart: its tokens, base styles and chart
   styles so the canvas lays out. Its own bar stands as it is — the drawing tools down the left, «Indicators», the
   open, high, low, close and volume of the bar under the pointer, «Live» — with the terminal's intervals and the price
   or market cap switch in its slot. */
import '@ryntra/core/tokens.css';
import '@ryntra/core/ui.css';
import '@ryntra/core/chart.css';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RyntraChart } from '@ryntra/core/chart';
import type { ChartMark, PriceBasis } from '@ryntra/core/adapters';
import { headPrice, saysUnavailable, type ChartData, type Timeframe } from '@/city/lib/chart/candles';
import { marketOf, PRICE_BASIS, resolutionOf, timeframeOf, TowerFeed, type Feed } from '@/city/lib/chart/feed';
import { useCandles, useTimeframe } from '@/city/lib/chart/use-chart';
import { useScrollThrough } from '@/city/lib/chart/use-gesture';
import { isStale } from '@/city/lib/city/events';
import { useCity } from '@/city/lib/city/store';
import { digits, useWords, type TextKey } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import { Chip, Icon, usdText } from '@/terminal/ui';
import { badgeOf, decimalOf, linesOf, useChartLayer, type LayerLine } from './chart-layer';
import { DESK } from './desk-words';
import { useOffEdge } from './off-edge';
import { agoText } from './Tape';
import { agoOf, bigTrades, liveOf, type TokenTrade } from './tape-view';
import { useNow } from './useCoinMarket';
import { TICK, TickSource } from './tick-source';
import { usePoolLayer, type PoolPin } from './usePoolLayer';
import { COIN } from './words';
import c from './chart.module.css';

/** The intervals the chart offers, finest first — every one the engine reads. */
const FRAMES: readonly Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
/** A phone keeps the four of the approved design, so the bar stands on one line. */
const PHONE_FRAMES: readonly Timeframe[] = ['15m', '1h', '4h', '1d'];
const FRAME_WORDS: Readonly<Record<Timeframe, TextKey<typeof COIN>>> = { '1m': 'tf1m', '5m': 'tf5m', '15m': 'tf15m', '1h': 'tf1h', '4h': 'tf4h', '1d': 'tf1d' };

/** The market cap the engine's candles are drawn in when the person asks for it: the price times today's supply. */
const CAP_BASIS: PriceBasis = { ...PRICE_BASIS, measure: 'market_cap' };
const BASIS_KEY = 'ryntra.coin.basis';
/** Whether the person left the chart on «Tick», on this device. */
const TICK_KEY = 'ryntra.coin.tick';

/** The core's indicator worker, from the city's own file: counted off the page's thread (the page allows no blob worker). */
const indicatorWorker = () => new Worker(new URL('../../city/components/chart/indicator-worker.ts', import.meta.url), { type: 'module' });

/** Drawings stay in this browser until there is a profile on a server to keep them. */
const DRAWINGS = { profile: null };

/** A line's colour over the candles, in the terminal's tokens. */
const TONE: Readonly<Record<LayerLine['tone'], string>> = { draft: 'var(--amber)', resting: 'var(--lilac)', held: 'var(--mint)', depth: 'var(--lilac)' };

/** A strip of the pool's liquidity by the price scale: this long at the deepest price, never shorter than its floor, px. */
const STRIP_LONG = 84;
const STRIP_FLOOR = 6;

/**
 * The layer's lines as the core chart's levels, and the sheet that colours them and writes their tags. The core draws
 * a level as a dotted rule with its name at the left; here the name gives way to the price's tag at the right, as the
 * approved design draws a ladder. Rows are found by their price, which is the line's own.
 */
function levelsOf(lines: readonly LayerLine[]) {
  const levels = [];
  const rules: string[] = [];
  const seen = new Set<string>();
  /** The strips that carry a name so far, in the core's order of rows. */
  const named: string[] = [];
  for (const line of lines) {
    const price = decimalOf(line.price);
    if (!price || seen.has(price)) continue;
    seen.add(price);
    levels.push({ id: line.id, kind: 'level' as const, price, basis: PRICE_BASIS, label: line.weight === undefined ? (line.tag ?? price) : price });
    const cell = `.ryntra-trade__row--level[data-price="${price}"]`;
    const row = `[data-coin-layer] ${cell}`;
    rules.push(`${row}{--tone:${TONE[line.tone]}}`);
    if (line.weight !== undefined) {
      // Not a rule across the plot: a strip at its right end, by the scale, as long as what lies at the price.
      const long = Math.round(STRIP_FLOOR + Math.min(1, Math.max(0, line.weight)) * (STRIP_LONG - STRIP_FLOOR));
      rules.push(`${row} .ryntra-trade__rule{left:calc(var(--plot-left) + var(--plot-width) - ${long}px);width:${long}px;border-top:3px solid var(--tone);opacity:.42;transform:translateY(-50%)}`);
      // The strips' name, said once: just left of the first strip in sight, quiet, in its own colour. A strip
      // past the prices on screen is `data-off` to the core; one with a strip in sight before it says nothing.
      if (line.tag) {
        rules.push(`${row}:not([data-off])::after{content:${JSON.stringify(line.tag)};position:absolute;top:0;right:calc(100% - var(--plot-left) - var(--plot-width) + ${long + 8}px);transform:translateY(-50%);font:600 var(--type-caption)/1 var(--ui);color:var(--tone);opacity:.8;white-space:nowrap;pointer-events:none}`);
        if (named.length) rules.push(`[data-coin-layer] :is(${named.join(',')}):not([data-off]) ~ ${cell}::after{content:none}`);
        named.push(cell);
      }
      continue;
    }
    if (line.tag) rules.push(`${row}::after{content:${JSON.stringify(line.tag)}}`);
  }
  return { levels, sheet: rules.join('\n') };
}

/** A moment between the core's «did not load» and its fresh start, so the two never flicker. */
const HEAL_MS = 1_200;

/**
 * A coin's chart: the core chart on the engine's candles of the coin's deepest pool (`/api/spot/candles`), exactly as
 * the city's Spot window draws them (`city/lib/chart/**`) — every interval the engine reads, the last bar closed at the
 * market's live price, in dollars of the price or of the market cap. The core's own tools stand as they are on rxn.gg:
 * drawings down the left, indicators counted in a worker, the bar's open, high, low, close and volume under the
 * pointer. The market's largest trades of the trades read stand on their candles as marks; the screen's lines (the
 * ticket's ladder, the pool's liquidity, the person's own pool edges) stand across them.
 *
 * `cap` is the supply the market cap is counted on (Jupiter's: the capitalisation over the price); without it there is
 * no cap switch. `onHead` gets the price the chart's head should say — the live price, else the engine's newest close.
 * `phone` lets the page scroll over the candles and keeps the full screen to itself.
 */
export function CoinChart({
  coin,
  sym,
  cap,
  trades,
  tradesStale = false,
  onHead,
  phone = false,
  aside,
  pool = null,
}: {
  coin: Tower;
  sym: string;
  cap: number | null;
  trades: readonly TokenTrade[];
  /** The last read of the trades failed: those on screen are the last good ones. */
  tradesStale?: boolean;
  onHead?: (price: number | null) => void;
  phone?: boolean;
  aside?: ReactNode;
  /** The pool whose liquidity stands by the price scale, where the screen names one (a pool's own page): else the coin's deepest DLMM pool. */
  pool?: PoolPin | null;
}) {
  const w = useWords(COIN);
  const d = useWords(DESK);
  const lang = useLang();
  const [timeframe, setTimeframe] = useTimeframe();
  // The price on screen: a refusal of the engine is followed by the browser's own read, drawn only if it agrees.
  const data = useCandles(coin.id, timeframe, Number.isFinite(coin.price) && coin.price > 0 ? coin.price : null);
  const fresh = useCity((st) => st.snapshot.source === 'live' && !isStale(st.snapshot.fetchedAt));
  const livePrice = fresh && Number.isFinite(coin.price) && coin.price > 0 ? coin.price : null;
  const now = useNow(5_000);
  const feed = useFeed(coin, data, livePrice, cap);
  const [basis, setBasis] = useBasis(cap !== null);
  const [tickKept, setTicks] = useKept(TICK_KEY);
  /* A phone's bar keeps the approved four intervals on one line («Tick» pushed the pool's button off it). */
  const ticks = tickKept && !phone;
  const tick = useTicks(feed, trades, cap);
  const [full, setFull] = useState(false);
  const pane = useRef<HTMLDivElement | null>(null);
  const heal = useHeal(pane, data);
  // On a phone, up or down over the candles scrolls the page the chart stands in; across and a pinch stay the chart's.
  useScrollThrough(phone ? pane : NO_PANE);

  const head = headPrice(livePrice, data, coin.id);
  useEffect(() => onHead?.(head), [head, onHead]);

  // The whole screen is left with Escape, as it was taken with a tap.
  useEffect(() => {
    if (!full) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setFull(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [full]);

  // «Live» only while the market's newest trade is recent — and, over candles, their read is fresh with the live
  // price closing the newest bar; else the newest trade's time, quietly; else «Delayed».
  const chip = liveOf({ ticks, candlesFresh: fresh && data.status === 'ready' && !data.last?.stale, newestTradeAt: trades[0]?.at ?? null, tradesStale, now });
  const ago = chip.kind === 'trade' ? agoOf(chip.at, now) : null;
  const poolLayer = usePoolLayer(coin.id, head, lang, pool);
  const overlay = useChartLayer();
  const lines = useMemo(() => linesOf(overlay, coin.id), [overlay, coin.id]);
  const layer = useMemo(() => levelsOf(lines), [lines]);
  // Lines past the prices on screen are counted at that edge, as a trading screen says its orders.
  const edge = useOffEdge(pane, basis === 'price' ? lines : [], head);
  const badge = badgeOf(overlay, coin.id);
  const marks = useTradeMarks(trades, d);
  const cover = useMemo(() => ({ view: PRICE_BASIS, marks, levels: layer.levels }), [marks, layer.levels]);

  const bar = (
    <>
      <div className={c.frames} role="radiogroup" aria-label={d.intervals}>
        {phone ? null : (
          <button type="button" role="radio" aria-checked={ticks} className={c.frame} onClick={() => setTicks(true)}>
            {d.tick}
          </button>
        )}
        {(phone ? PHONE_FRAMES : FRAMES).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={!ticks && timeframe === id}
            className={c.frame}
            onClick={() => {
              setTicks(false);
              setTimeframe(id);
            }}
          >
            {w[FRAME_WORDS[id]]}
          </button>
        ))}
      </div>
      {cap !== null && !phone ? (
        <div className={c.basis} role="radiogroup" aria-label={d.basis}>
          {(['price', 'cap'] as const).map((id) => (
            <button key={id} type="button" role="radio" aria-checked={basis === id} className={c.frame} onClick={() => setBasis(id)}>
              {id === 'price' ? d.basisPrice : d.basisCap}
            </button>
          ))}
        </div>
      ) : null}
      {badge ? <span className={c.badge}>{badge}</span> : null}
      <span className={c.live}>
        {chip.kind === 'live' ? (
          <Chip tone="ok" dot>
            {w.live}
          </Chip>
        ) : chip.kind === 'trade' && ago ? (
          <Chip tone="plain">{digits(d.lastTrade(agoText(ago, d)), lang)}</Chip>
        ) : (
          <Chip tone="warn" dot>
            {w.delayed}
          </Chip>
        )}
      </span>
      {poolLayer.there ? (
        <button type="button" className={c.round} aria-label={w.poolLayer} title={w.poolLayer} aria-pressed={poolLayer.on} onClick={() => poolLayer.setOn(!poolLayer.on)} data-coin="pool-layer">
          <Icon name="depth" size="s" />
        </button>
      ) : null}
      {phone ? null : (
        <button type="button" className={c.round} aria-label={full ? w.exitFull : w.full} title={full ? w.exitFull : w.full} aria-pressed={full} onClick={() => setFull((was) => !was)}>
          <Icon name="expand" size="s" />
        </button>
      )}
    </>
  );

  return (
    <div className={c.wrap} data-full={full ? '' : undefined} data-phone={phone ? '' : undefined}>
      <div className={c.pane} ref={pane} data-coin-layer="">
        {layer.sheet ? <style>{layer.sheet}</style> : null}
        {edge.above ? (
          <span className={c.edge} style={{ top: edge.top + 8, right: edge.right + 8 }} data-coin-edge="above" role="img" aria-label={d.linesAbove(String(edge.above))}>
            {`↑ ${edge.above}`}
          </span>
        ) : null}
        {edge.below ? (
          <span className={c.edge} style={{ top: edge.bottom - 32, right: edge.right + 8 }} data-coin-edge="below" role="img" aria-label={d.linesBelow(String(edge.below))}>
            {`↓ ${edge.below}`}
          </span>
        ) : null}
        {ticks && !trades.length ? (
          <Bare bar={bar}>
            <div className={c.wait} aria-busy="true" />
          </Bare>
        ) : (
          <ChartBody key={`${coin.id}:${basis}:${ticks}`} coin={coin} sym={sym} data={data} feed={feed} tick={ticks ? tick : null} timeframe={timeframe} onTimeframe={setTimeframe} heal={heal} lang={lang} cover={cover} bar={bar} basis={basis === 'cap' && cap !== null ? CAP_BASIS : PRICE_BASIS} />
        )}
      </div>
      {aside}
    </div>
  );
}

const NO_PANE: Readonly<{ current: HTMLElement | null }> = { current: null };

/** Where the core chart does not stand (on its way, or none), its bar still does: the person can always pick another view. */
function Bare({ bar, children }: { bar: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className={c.ownBar}>{bar}</div>
      {children}
    </>
  );
}

/** The chart, or why there is none in one line: the wrong chart is worse than none; the ticket works from the live price. */
function ChartBody({
  coin,
  sym,
  data,
  feed,
  tick,
  timeframe,
  onTimeframe,
  heal,
  lang,
  cover,
  bar,
  basis,
}: {
  coin: Tower;
  sym: string;
  data: ChartData;
  feed: Feed | null;
  /** «Tick»: the trades' source over the candles' — a bar a trade. */
  tick: TickSource | null;
  timeframe: Timeframe;
  onTimeframe: (next: Timeframe) => void;
  /** Bumped when bars arrive after the core chart gave up waiting: it starts again on them. */
  heal: number;
  lang: ReturnType<typeof useLang>;
  cover: Readonly<{ view: PriceBasis; marks: readonly ChartMark[]; levels: ReturnType<typeof levelsOf>['levels'] }>;
  bar: ReactNode;
  basis: PriceBasis;
}) {
  const w = useWords(COIN);
  if (tick) {
    return (
      <RyntraChart
        source={tick.source}
        instrument={coin.id}
        resolution={TICK}
        onResolutionChange={(next) => {
          const picked = timeframeOf(next);
          if (picked) onTimeframe(picked);
        }}
        basis={basis}
        lang={lang}
        symbol={bar}
        label={w.chartOf(sym)}
        marks={cover}
        drawings={DRAWINGS}
        indicatorWorker={indicatorWorker}
        candleType="line"
        className={c.core}
      />
    );
  }
  if (data.status === 'none') {
    return (
      <Bare bar={bar}>
        <p className={c.state} role="status">
          {w.noChart(sym)}
        </p>
      </Bare>
    );
  }
  if (saysUnavailable(data)) {
    return (
      <Bare bar={bar}>
        <p className={c.state} role="status">
          {w.chartUnavailable}
        </p>
      </Bare>
    );
  }
  /* The first tries that failed are quiet: the frame waits, as for a first read, while the chart asks again — after a
     refusal (the source's own limit, shared by every person) it says «Chart in a moment», never an empty box. */
  if ((data.status === 'unavailable' && !data.last) || !feed) {
    const soon = !data.last && data.misses > 0;
    return (
      <Bare bar={bar}>
        <div className={c.wait} aria-busy="true" data-soon={soon ? '' : undefined} data-coin-chart-wait="">
          {soon ? (
            <span className={c.soon} role="status">
              {w.chartSoon}
            </span>
          ) : null}
        </div>
      </Bare>
    );
  }
  return (
    <RyntraChart
      key={`${coin.id}:${heal}`}
      source={feed.source}
      instrument={coin.id}
      resolution={resolutionOf(timeframe)}
      onResolutionChange={(next) => {
        const picked = timeframeOf(next);
        if (picked) onTimeframe(picked);
      }}
      basis={basis}
      lang={lang}
      symbol={bar}
      label={w.chartOf(sym)}
      marks={cover}
      drawings={DRAWINGS}
      indicatorWorker={indicatorWorker}
      className={c.core}
    />
  );
}

/** The market's largest trades of the read, as the core chart's marks on their candles: green a buy, red a sale. */
function useTradeMarks(trades: readonly TokenTrade[], d: (typeof DESK)['en']): readonly ChartMark[] {
  const lang = useLang();
  const shown = useRef<readonly ChartMark[]>([]);
  return useMemo(() => {
    const next: ChartMark[] = bigTrades(trades).map((mark) => {
      const usd = usdText(mark.usd, lang);
      return { id: mark.id, kind: 'trade', t: mark.t, price: decimalOf(mark.price), side: mark.side, label: mark.side === 'buy' ? d.bigBuy(usd) : d.bigSell(usd), own: false };
    });
    const prev = shown.current;
    // The same marks keep the same list, so the chart is not handed its marks again for nothing.
    if (prev.length === next.length && prev.every((m, i) => m.id === next[i]!.id && m.label === next[i]!.label)) return prev;
    shown.current = next;
    return next;
  }, [trades, d, lang]);
}

/** A yes or no the person left on this device (false until read, and in a browser that keeps nothing). */
function useKept(key: string): [boolean, (next: boolean) => void] {
  // The chart is drawn in the browser only: the choice is read before its first draw, so it is drawn once.
  const [on, setOn] = useState(() => {
    try {
      return window.localStorage.getItem(key) === '1';
    } catch {
      // Nothing kept: no, for this visit.
      return false;
    }
  });
  const set = (next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(key, next ? '1' : '0');
    } catch {
      // As above.
    }
  };
  return [on, set];
}

/** The «Tick» source over a market's feed: the trades the desk reads go in as they come, a bar a trade. */
function useTicks(feed: Feed | null, trades: readonly TokenTrade[], cap: number | null): TickSource | null {
  const tick = useMemo(() => (feed ? new TickSource(feed.source, () => feed.tick) : null), [feed]);
  useEffect(() => {
    tick?.setCap(cap);
  }, [tick, cap]);
  useEffect(() => {
    tick?.put(trades);
  }, [tick, trades]);
  return tick;
}

/** Price or market cap, as the person left it on this device; no cap to count — the price. */
function useBasis(capKnown: boolean): ['price' | 'cap', (next: 'price' | 'cap') => void] {
  // Read before the chart's first draw (the chart is the browser's only), so it is drawn once.
  const [basis, setBasis] = useState<'price' | 'cap'>(() => {
    try {
      return window.localStorage.getItem(BASIS_KEY) === 'cap' ? 'cap' : 'price';
    } catch {
      // A browser that keeps nothing: the price, for this visit.
      return 'price';
    }
  });
  const set = (next: 'price' | 'cap') => {
    setBasis(next);
    try {
      window.localStorage.setItem(BASIS_KEY, next);
    } catch {
      // As above.
    }
  };
  return [capKnown ? basis : 'price', set];
}

/**
 * The core chart waits a while for its bars, then gives up and shows its retry. Bars the engine has — a read that came
 * after it gave up — start it again by itself, once for each read, so the person never has to.
 */
function useHeal(pane: Readonly<{ current: HTMLElement | null }>, data: ChartData): number {
  const [heal, setHeal] = useState(0);
  const healedFor = useRef<number | null>(null);
  const observed = data.last?.observedAt ?? null;
  useEffect(() => {
    const root = pane.current;
    if (!root || observed === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (healedFor.current === observed || !root.querySelector('.ryntra-chart[data-phase="error"]')) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        healedFor.current = observed;
        setHeal((n) => n + 1);
      }, HEAL_MS);
    };
    check();
    const watch = new MutationObserver(check);
    watch.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-phase'] });
    return () => {
      watch.disconnect();
      clearTimeout(timer);
    };
  }, [pane, observed]);
  return heal;
}

/**
 * One feed a market, made with it — the city's own (`city/lib/chart/feed.ts`): the reads go in as they come, a read that
 * failed keeps the time of the last good one, and the live price closes the newest bar. The supply the market cap is
 * counted on goes in as it is read.
 */
function useFeed(coin: Tower, data: ChartData, livePrice: number | null, cap: number | null): Feed | null {
  const [held, setHeld] = useState<Readonly<{ mint: string; feed: Feed }> | null>(null);
  useEffect(() => {
    const feed = new TowerFeed(marketOf(coin));
    setHeld({ mint: coin.id, feed });
    return () => feed.dispose();
    // A market's feed lives while the market is on the chart; the price seeds its first step only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin.id]);
  const feed = held && held.mint === coin.id ? held.feed : null;
  useEffect(() => {
    feed?.describe({ capFactor: cap });
  }, [feed, cap]);
  useEffect(() => {
    const read = data.last;
    if (!feed || data.mint !== coin.id || !read) return;
    feed.put(read.timeframe, read.candles, data.status === 'ready' ? read.observedAt : null, read.stale, read.pool);
  }, [feed, data, coin.id]);
  useEffect(() => {
    feed?.live(livePrice);
  }, [feed, livePrice]);
  return feed;
}
