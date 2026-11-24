'use client';

/* The core chart (`@ryntra/core` 0.14.0, the one rxn.gg draws) is the coin's chart: its tokens, base styles and chart
   styles so the canvas lays out. Its own bar stands as it is — the drawing tools down the left, «Indicators», the
   open, high, low, close and volume of the bar under the pointer, «Live» — with the terminal's intervals and the price
   or market cap switch in its slot. */
import '@ryntra/core/tokens.css';
import '@ryntra/core/ui.css';
import '@ryntra/core/chart.css';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { chartWords, RyntraChart } from '@ryntra/core/chart';
import type { ChartMark, PriceBasis } from '@ryntra/core/adapters';
import { headPrice, isDelayed, saysUnavailable, type ChartData, type Ready, type Timeframe } from '@/city/lib/chart/candles';
import { coinMarks, mergeMarks, sameMarks } from '@/city/lib/chart/coin-marks';
import { marketOf, PRICE_BASIS, resolutionOf, timeframeOf, TowerFeed, type Feed } from '@/city/lib/chart/feed';
import { useCandles, useEntry, useTimeframe, useTokenMarks } from '@/city/lib/chart/use-chart';
import { useScrollThrough } from '@/city/lib/chart/use-gesture';
import { chartRead, YOUNG_TIMEFRAME } from '@/city/lib/chart/young';
import { isStale } from '@/city/lib/city/events';
import { useCity } from '@/city/lib/city/store';
import { digits, useWords, type TextKey } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import type { TokenMark } from '@/lib/spot/token-page';
import { useWallet } from '@/city/lib/trade/wallet';
import { Chip, Icon, Quiet, usdText } from '@/terminal/ui';
import { badgeOf, decimalOf, linesOf, useChartLayer, type LayerLine } from './chart-layer';
import { stuckOf, tooYoungFor } from './chart-wait';
import { CHART } from './chart-words';
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
/** A coin drawn from its own trades on a phone: its minutes in place of the day it has not lived yet. */
const YOUNG_PHONE_FRAMES: readonly Timeframe[] = ['1m', '15m', '1h', '4h'];
const FRAME_WORDS: Readonly<Record<Timeframe, TextKey<typeof COIN>>> = { '1m': 'tf1m', '5m': 'tf5m', '15m': 'tf15m', '1h': 'tf1h', '4h': 'tf4h', '1d': 'tf1d' };

/** The market cap the engine's candles are drawn in when the person asks for it: the price times today's supply. */
const CAP_BASIS: PriceBasis = { ...PRICE_BASIS, measure: 'market_cap' };
const BASIS_KEY = 'ryntra.coin.basis';
/** Whether the person left the chart on «Tick», on this device. */
const TICK_KEY = 'ryntra.coin.tick';
/** Whether the person left the trade marks on, on this device (on until they turn them off). */
const MARKS_KEY = 'ryntra.coin.marks';

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
  for (const line of lines) {
    const price = decimalOf(line.price);
    if (!price || seen.has(price)) continue;
    seen.add(price);
    levels.push({ id: line.id, kind: 'level' as const, price, basis: PRICE_BASIS, label: line.weight === undefined ? (line.name ?? line.tag ?? price) : price });
    const cell = `.ryntra-trade__row--level[data-price="${price}"]`;
    const row = `[data-coin-layer] ${cell}`;
    rules.push(`${row}{--tone:${TONE[line.tone]}}`);
    if (line.name && line.weight === undefined) {
      // A named line (the person's average entry): its name at the left in its colour — the screen's own words, never the
      // core's «Level: …» — and its price's tag at the right.
      rules.push(`${row}::before{content:${JSON.stringify(line.name)};position:absolute;top:0;left:calc(var(--plot-left) + 8px);transform:translateY(-100%);padding:0 4px;font:600 var(--type-caption)/1.4 var(--ui);color:var(--tone);background:var(--panel);white-space:nowrap;pointer-events:none}`);
      continue;
    }
    if (line.weight !== undefined) {
      // Not a rule across the plot: a strip at its right end, by the scale, as long as what lies at the price.
      const long = Math.round(STRIP_FLOOR + Math.min(1, Math.max(0, line.weight)) * (STRIP_LONG - STRIP_FLOOR));
      rules.push(`${row} .ryntra-trade__rule{left:calc(var(--plot-left) + var(--plot-width) - ${long}px);width:${long}px;border-top:3px solid var(--tone);opacity:.42;transform:translateY(-50%)}`);
      // The strips carry no words over the candles (flaw 65: «Pool liquidity» lay over the bars and the price's
      // tag): what they are is said in the layers' menu, by a strip of the same colour.
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
export function CoinChart(props: ChartProps) {
  // «Try again» starts the chart afresh: its reads, its waits and its count of failures (the young coin's
  // endless «Chart in a moment»). The person's interval, basis and layers are kept where they live.
  const [round, setRound] = useState(0);
  return <ChartRound key={`${props.coin.id}:${round}`} {...props} onRetry={() => setRound((n) => n + 1)} />;
}

type ChartProps = {
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
};

function ChartRound({ coin, sym, cap, trades, tradesStale = false, onHead, phone = false, aside, pool = null, onRetry }: ChartProps & { onRetry: () => void }) {
  const w = useWords(COIN);
  const d = useWords(DESK);
  const cw = useWords(CHART);
  const lang = useLang();
  const [timeframe, setTimeframe] = useTimeframe();
  const now = useNow(5_000);
  /* A coin whose chart stands on its own trades (the source has no bar of it yet), and one whose chart opened on the
     finest interval for them — until the person picks another. Kept by coin: another coin starts afresh. */
  const [young, setYoung] = useState<string | null>(null);
  const [auto, setAuto] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const frame = auto === coin.id ? YOUNG_TIMEFRAME : timeframe;
  const latched = young === coin.id;
  // The price on screen: a refusal of the engine is followed by the browser's own read, drawn only if it agrees.
  const read = useCandles(coin.id, frame, Number.isFinite(coin.price) && coin.price > 0 ? coin.price : null);
  // A wait that does not end is said, not shown: the source's limit (429) keeps the core waiting for ever, so after a
  // few refusals or `STUCK_MS` with no bar the chart is «unavailable» — drawn from the coin's own trades where it has
  // any, else one line with «Try again» («Chart in a moment» hung on coins a minute old).
  const waited = useWaited(read.status === 'unavailable' && !read.last, now);
  const data = useMemo(() => stuckOf(read, waited), [read, waited]);
  // What the chart draws: the engine's bars; the coin's own trades while the engine has none; then both, joined.
  const shown = useMemo(
    () => chartRead({ data, mint: coin.id, timeframe: frame, trades, drawing: latched, joined: latched, stale: tradesStale, now }),
    [data, coin.id, frame, trades, latched, tradesStale, now],
  );
  const fromTrades = shown !== null && shown !== data.last && !data.last;
  // Drawn from trades once: the chart stays on them until the source wakes, and opens on a minute's bars — set while
  // rendering, so the chart never draws the person's coarser interval of two trades first.
  if (fromTrades && !latched) setYoung(coin.id);
  if (fromTrades && auto !== coin.id && picked !== coin.id && frame !== YOUNG_TIMEFRAME) setAuto(coin.id);
  // A coin younger than its interval can show opens on a minute's bars too, not as one candle at the edge (flaw 68).
  const engineBars = data.status === 'ready' && data.mint === coin.id && data.timeframe === frame ? data.last : null;
  if (engineBars && auto !== coin.id && picked !== coin.id && tooYoungFor(engineBars.candles, frame, now)) setAuto(coin.id);
  const pick = (next: Timeframe) => {
    setPicked(coin.id);
    setAuto(null);
    setTimeframe(next);
  };
  const fresh = useCity((st) => st.snapshot.source === 'live' && !isStale(st.snapshot.fetchedAt));
  const livePrice = fresh && Number.isFinite(coin.price) && coin.price > 0 ? coin.price : null;
  const feed = useFeed(coin, shown, shown !== null && (shown !== data.last || data.status === 'ready'), livePrice, cap);
  const grow = useGrow(coin.id, frame, shown);
  const [basis, setBasis] = useBasis(cap !== null);
  const [tickKept, setTicks] = useKept(TICK_KEY);
  /* A phone's bar keeps the approved four intervals on one line («Tick» pushed the pool's button off it). */
  const ticks = tickKept && !phone;
  const tick = useTicks(feed, trades, cap);
  const [full, setFull] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const [marksOn, setMarksOn] = useKept(MARKS_KEY, true);
  const pane = useRef<HTMLDivElement | null>(null);
  const heal = useHeal(pane, data);
  // On a phone, up or down over the candles scrolls the page the chart stands in; across and a pinch stay the chart's.
  useScrollThrough(phone ? pane : NO_PANE);
  useNoEmptyVolume(pane, lang);

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
  // price closing the newest bar; else the newest trade's time, quietly; else «Delayed». A chart of trades is as live as they are.
  // Bars a few seconds past fresh are not «Delayed»: only bars really behind their interval are.
  const chip = liveOf({ ticks: ticks || fromTrades, candlesFresh: fresh && data.status === 'ready' && data.last !== null && !isDelayed(data.last, now), newestTradeAt: trades[0]?.at ?? null, tradesStale, now });
  const ago = chip.kind === 'trade' ? agoOf(chip.at, now) : null;
  // «Delayed» says how old the bars are, and what it means under the pointer.
  const lag = chip.kind === 'delayed' && data.last ? agoOf(new Date(data.last.observedAt).toISOString(), now) : null;
  const delayedWords = lag && lag.unit !== 's' ? digits(d.delayedBy(agoText(lag, d)), lang) : w.delayed;
  const chipWords = chip.kind === 'live' ? w.live : chip.kind === 'trade' && ago ? digits(d.lastTrade(agoText(ago, d)), lang) : `${delayedWords} · ${d.delayedWhy}`;
  const poolLayer = usePoolLayer(coin.id, head, lang, pool);
  const overlay = useChartLayer();
  const entry = useEntry(coin);
  const lines = useMemo(() => {
    const drawn = linesOf(overlay, coin.id);
    // The person's average entry, a line in their colour, with the marks: it goes and comes with them.
    return marksOn && entry !== null ? [...drawn, { id: 'entry:average', price: entry, tone: 'held' as const, tag: null, name: cw.entry }] : drawn;
  }, [overlay, coin.id, marksOn, entry, cw.entry]);
  const layer = useMemo(() => levelsOf(lines), [lines]);
  // Lines past the prices on screen are counted at that edge, as a trading screen says its orders.
  const edge = useOffEdge(pane, basis === 'price' ? lines : [], head);
  const badge = badgeOf(overlay, coin.id);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const engineMarks = useTokenMarks(coin.id, marksOn);
  const marks = useTradeMarks(trades, d, { on: marksOn, owner, engine: engineMarks, phone, words: cw });
  const cover = useMemo(() => ({ view: PRICE_BASIS, marks, levels: layer.levels }), [marks, layer.levels]);

  const bar = (
    <>
      <div className={c.frames} role="radiogroup" aria-label={d.intervals}>
        {phone ? null : (
          <button type="button" role="radio" aria-checked={ticks} className={c.frame} onClick={() => setTicks(true)}>
            {d.tick}
          </button>
        )}
        {(phone ? (latched || auto === coin.id ? YOUNG_PHONE_FRAMES : PHONE_FRAMES) : FRAMES).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={!ticks && frame === id}
            className={c.frame}
            onClick={() => {
              setTicks(false);
              pick(id);
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
      {/* On a narrow chart the chip keeps its light alone, or the trade's age alone: never an empty box (QA 20.11). */}
      {/* A state, not a button: the trade's age says «ago» on every width, so it never reads as one more interval, and
          «Delayed» keeps its word on a phone. */}
      <span className={c.live} title={chipWords} role="status" data-dot={chip.kind === 'live' ? '' : undefined}>
        {chip.kind === 'live' ? (
          <Chip tone="ok" dot>
            <span className={c.word}>{w.live}</span>
          </Chip>
        ) : chip.kind === 'trade' && ago ? (
          <Chip tone="plain">
            <span className={c.word}>{chipWords}</span>
            <span className={c.short} aria-hidden="true">
              {digits(d.lastTradeShort(agoText(ago, d)), lang)}
            </span>
          </Chip>
        ) : (
          <Chip tone="warn" dot>
            <span className={c.word}>{delayedWords}</span>
            <span className={c.short} aria-hidden="true">
              {d.delayedShort}
            </span>
          </Chip>
        )}
      </span>
      <button
        ref={menuButton}
        type="button"
        className={c.round}
        aria-label={cw.layers}
        title={cw.layers}
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-pressed={(poolLayer.there && poolLayer.on) || marksOn}
        onClick={() => setMenu((was) => !was)}
        data-coin="layers"
      >
        <Icon name="depth" size="s" />
      </button>
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
          <span className={c.edge} style={{ top: edge.top + 8, right: edge.right + 8 }} data-coin-edge="above" role="img" aria-label={d.linesAbove(String(edge.above))} title={d.linesAbove(String(edge.above))}>
            {`↑ ${edge.above}`}
          </span>
        ) : null}
        {edge.below ? (
          <span className={c.edge} style={{ top: edge.bottom - 32, right: edge.right + 8 }} data-coin-edge="below" role="img" aria-label={d.linesBelow(String(edge.below))} title={d.linesBelow(String(edge.below))}>
            {`↓ ${edge.below}`}
          </span>
        ) : null}
        {menu ? (
          <LayersMenu label={cw.layers} button={menuButton} onClose={() => setMenu(false)}>
            {poolLayer.there ? (
              <LayerItem on={poolLayer.on} onChange={poolLayer.setOn} coin="pool-layer" swatch>
                {cw.liquidity}
              </LayerItem>
            ) : null}
            <LayerItem on={marksOn} onChange={setMarksOn} coin="marks-layer">
              {cw.marks}
            </LayerItem>
          </LayersMenu>
        ) : null}
        {ticks && !trades.length ? (
          <Bare bar={bar}>
            <div className={c.wait} aria-busy="true" />
          </Bare>
        ) : (
          <ChartBody key={`${coin.id}:${basis}:${ticks}`} coin={coin} sym={sym} data={data} shown={shown} feed={feed} tick={ticks ? tick : null} timeframe={frame} onTimeframe={pick} heal={heal} grow={grow} lang={lang} cover={cover} bar={bar} basis={basis === 'cap' && cap !== null ? CAP_BASIS : PRICE_BASIS} onRetry={onRetry} />
        )}
      </div>
      {aside}
    </div>
  );
}

/**
 * The chart's layers, in one quiet menu under its button: the pool's liquidity where there is a pool, and the trade
 * marks — the person's own buys and sales, their average entry, the creator's trades, the move to a DEX, the largest
 * trades. Escape or a tap past it closes it; the button takes the focus back.
 */
function LayersMenu({ label, button, onClose, children }: { label: string; button: Readonly<{ current: HTMLButtonElement | null }>; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[role="menuitemcheckbox"]')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Before the full screen's own Escape: the menu goes first, the full screen stays.
      event.preventDefault();
      onClose();
      button.current?.focus();
    };
    const away = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (box.current?.contains(target) || button.current?.contains(target))) return;
      onClose();
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', away, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('pointerdown', away, true);
    };
  }, [button, onClose]);
  return (
    <div ref={box} className={c.layers} role="menu" aria-label={label} data-coin="layers-menu">
      {children}
    </div>
  );
}

/** One layer in the menu: its name — the pool's after a strip as the chart draws it (`swatch`) — and a check while it is on. */
function LayerItem({ on, onChange, coin, swatch = false, children }: { on: boolean; onChange: (on: boolean) => void; coin: string; swatch?: boolean; children: ReactNode }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={on} className={c.layer} onClick={() => onChange(!on)} data-coin={coin}>
      <span className={c.layerName}>
        {swatch ? <span className={c.swatch} aria-hidden="true" /> : null}
        {children}
      </span>
      <span className={c.check} aria-hidden="true">
        <Icon name="check" size="s" />
      </span>
    </button>
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
  shown,
  feed,
  tick,
  timeframe,
  onTimeframe,
  heal,
  grow,
  lang,
  cover,
  bar,
  basis,
  onRetry,
}: {
  coin: Tower;
  sym: string;
  data: ChartData;
  /** What the chart draws now — the engine's bars, the coin's own trades, or both; null while there is nothing yet. */
  shown: Ready | null;
  feed: Feed | null;
  /** «Tick»: the trades' source over the candles' — a bar a trade. */
  tick: TickSource | null;
  timeframe: Timeframe;
  onTimeframe: (next: Timeframe) => void;
  /** Bumped when bars arrive after the core chart gave up waiting: it starts again on them. */
  heal: number;
  /** Bumped when the bars reach further back than the chart on screen (the source woke under a chart of trades). */
  grow: number;
  lang: ReturnType<typeof useLang>;
  cover: Readonly<{ view: PriceBasis; marks: readonly ChartMark[]; levels: ReturnType<typeof levelsOf>['levels'] }>;
  bar: ReactNode;
  basis: PriceBasis;
  /** Starts the chart afresh: a state that says why there is no chart offers it, quietly. */
  onRetry: () => void;
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
  // «No chart» only while there is not one trade: a coin that trades has its chart from its trades (`young.ts`).
  // No chart, said in one line with a quiet «Try again» that reads it afresh: none for the coin yet (no pool prices it —
  // a coin a minute old), or the source does not answer.
  if ((data.status === 'none' || saysUnavailable(data)) && !shown) {
    return (
      <Bare bar={bar}>
        <div className={c.state} role="status" data-coin-chart-state={data.status}>
          <span>{data.status === 'none' ? w.noChart(sym) : w.chartUnavailable}</span>
          <Quiet size="s" onClick={onRetry} data-coin="chart-retry">
            {w.again}
          </Quiet>
        </div>
      </Bare>
    );
  }
  /* The first tries that failed are quiet: the frame waits, as for a first read, while the chart asks again — after a
     refusal (the source's own limit, shared by every person) it says «Chart in a moment», never an empty box. */
  if ((data.status === 'unavailable' && !data.last && !shown) || !feed) {
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
      key={`${coin.id}:${heal}:${grow}`}
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

/** How long the chart has waited with no bar: from the first moment `waiting` held, counted on the screen's clock. */
function useWaited(waiting: boolean, now: number): number {
  const since = useRef<number | null>(null);
  if (!waiting) since.current = null;
  else if (since.current === null) since.current = now;
  return since.current === null ? 0 : now - since.current;
}

/**
 * The marks on the candles, while the person keeps them on: their own buys and sales, the creator's trades and the
 * move to a DEX (`coin-marks.ts`), then the market's largest trades of the read — green a buy, red a sale. On a phone no
 * mark carries a price, so the chart stands them along the foot of the plot, never over the candles.
 */
function useTradeMarks(
  trades: readonly TokenTrade[],
  d: (typeof DESK)['en'],
  opts: Readonly<{ on: boolean; owner: string | null; engine: readonly TokenMark[]; phone: boolean; words: (typeof CHART)['en'] }>,
): readonly ChartMark[] {
  const lang = useLang();
  const shown = useRef<readonly ChartMark[]>([]);
  const { on, owner, engine, phone, words } = opts;
  return useMemo(() => {
    const usd = (value: number) => usdText(value, lang);
    const big: ChartMark[] = bigTrades(trades).map((mark) => ({
      id: mark.id,
      kind: 'trade',
      t: mark.t,
      price: phone ? null : decimalOf(mark.price),
      side: mark.side,
      label: mark.side === 'buy' ? d.bigBuy(usd(mark.usd)) : d.bigSell(usd(mark.usd)),
      own: false,
    }));
    const next = on ? mergeMarks(coinMarks({ trades, owner, engine, phone, words, usd }), big) : [];
    // The same marks keep the same list, so the chart is not handed its marks again for nothing.
    if (sameMarks(shown.current, next)) return shown.current;
    shown.current = next;
    return next;
  }, [trades, d, lang, on, owner, engine, phone, words]);
}

/**
 * The core's line of the bar under the pointer names the volume even on a bar that has none — «V no volume» on the
 * forming bar, beside the volume bars (flaw 66; the city's window does the same). Such a figure is
 * marked and steps aside (chart.module.css); a bar with volume shows it as before. Only the chart's own pane is watched.
 */
function useNoEmptyVolume(pane: Readonly<{ current: HTMLElement | null }>, lang: ReturnType<typeof useLang>): void {
  useEffect(() => {
    const root = pane.current;
    if (!root) return;
    const none = chartWords(lang).noVolume;
    const mark = () => {
      for (const figure of root.querySelectorAll('.ryntra-chart__ohlc-row .ryntra-chart__figure')) {
        const value = figure.querySelector('.ryntra-chart__value')?.textContent?.trim() ?? '';
        figure.toggleAttribute('data-coin-empty', value === none);
      }
    };
    mark();
    const watch = new MutationObserver(mark);
    watch.observe(root, { subtree: true, childList: true, characterData: true });
    return () => watch.disconnect();
  }, [pane, lang]);
}

/** A yes or no the person left on this device (`fallback` until they choose, and in a browser that keeps nothing). */
function useKept(key: string, fallback = false): [boolean, (next: boolean) => void] {
  // The chart is drawn in the browser only: the choice is read before its first draw, so it is drawn once.
  const [on, setOn] = useState(() => {
    try {
      const kept = window.localStorage.getItem(key);
      return kept === '1' ? true : kept === '0' ? false : fallback;
    } catch {
      // Nothing kept: the default, for this visit.
      return fallback;
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
 * One feed a market, made with it — the city's own (`city/lib/chart/feed.ts`): what the chart draws goes in as it comes
 * (the engine's reads, or the coin's own trades as bars while the engine has none), a read that failed keeps the time of
 * the last good one (`observed` false), and the live price closes the newest bar. The supply the market cap is counted
 * on goes in as it is read.
 */
function useFeed(coin: Tower, shown: Ready | null, observed: boolean, livePrice: number | null, cap: number | null): Feed | null {
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
    if (!feed || !shown) return;
    feed.put(shown.timeframe, shown.candles, observed ? shown.observedAt : null, shown.stale, shown.pool);
  }, [feed, shown, observed]);
  useEffect(() => {
    feed?.live(livePrice);
  }, [feed, livePrice]);
  return feed;
}

/**
 * The chart starts again on its bars when they reach further back than those it drew for this market and interval —
 * the source woke under a chart of the coin's trades and brought the minutes before them. The feed already holds the
 * bars, so the chart is drawn again at once; newer bars and corrections go in live, without a new start.
 */
function useGrow(mint: string, timeframe: Timeframe, shown: Ready | null): number {
  const [grow, setGrow] = useState(0);
  const first = useRef<Readonly<{ key: string; time: number }> | null>(null);
  const key = `${mint}:${timeframe}`;
  const time = shown?.candles[0]?.time ?? null;
  useEffect(() => {
    if (time === null) return;
    const held = first.current;
    if (held && held.key === key && time < held.time) setGrow((n) => n + 1);
    if (!held || held.key !== key || time < held.time) first.current = { key, time };
  }, [key, time]);
  return grow;
}
