'use client';

/* The core chart is the engine that draws the candles: its tokens, base styles and chart styles so the canvas lays
   out. Everything around the candles is the terminal's own — its periods, its «Live» light, its two quiet controls. */
import '@ryntra/core/tokens.css';
import '@ryntra/core/ui.css';
import '@ryntra/core/chart.css';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RyntraChart } from '@ryntra/core/chart';
import { delayLine, headPrice, saysUnavailable, type ChartData, type Timeframe } from '@/city/lib/chart/candles';
import { marketOf, PRICE_BASIS, resolutionOf, timeframeOf, TowerFeed, type Feed } from '@/city/lib/chart/feed';
import { crosshairChannel, readoutOf, readoutTime } from '@/city/lib/chart/readout';
import { useCandles, useTimeframe } from '@/city/lib/chart/use-chart';
import { useScrollThrough } from '@/city/lib/chart/use-gesture';
import { isStale } from '@/city/lib/city/events';
import { useCity } from '@/city/lib/city/store';
import { useWords, type TextKey } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import { formatPct } from '@/city/lib/trade/mine';
import { Chip, Icon, Panel, Tabs, priceText } from '@/terminal/ui';
import { badgeOf, decimalOf, linesOf, useChartLayer, type LayerLine } from './chart-layer';
import { usePoolLayer } from './usePoolLayer';
import { COIN } from './words';
import c from './chart.module.css';

/** The periods a desk offers, finest first — every one the engine reads; a phone keeps the four of the approved design. */
const DESK_FRAMES: readonly Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
const PHONE_FRAMES: readonly Timeframe[] = ['15m', '1h', '4h', '1d'];
const FRAME_WORDS: Readonly<Record<Timeframe, TextKey<typeof COIN>>> = { '1m': 'tf1m', '5m': 'tf5m', '15m': 'tf15m', '1h': 'tf1h', '4h': 'tf4h', '1d': 'tf1d' };

/** The core's indicator worker, from the city's own file: counted off the page's thread. */
const indicatorWorker = () => new Worker(new URL('../../city/components/chart/indicator-worker.ts', import.meta.url), { type: 'module' });

/** The plain chart draws candles and volume only: no indicator set carried over from another chart of this browser. */
const NO_INDICATORS: readonly [] = [];
/** No marks over the candles: the engine gives none for a coin's screen yet. Levels are the screen's own lines (`chart-layer.ts`). */
const NO_MARK_LIST: readonly [] = [];

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
    levels.push({ id: line.id, kind: 'level' as const, price, basis: PRICE_BASIS, label: line.tag ?? price });
    const row = `[data-coin-layer] .ryntra-trade__row--level[data-price="${price}"]`;
    rules.push(`${row}{--tone:${TONE[line.tone]}}`);
    if (line.weight !== undefined) {
      // Not a rule across the plot: a strip at its right end, by the scale, as long as what lies at the price.
      const long = Math.round(STRIP_FLOOR + Math.min(1, Math.max(0, line.weight)) * (STRIP_LONG - STRIP_FLOOR));
      rules.push(`${row} .ryntra-trade__rule{left:calc(var(--plot-left) + var(--plot-width) - ${long}px);width:${long}px;border-top:3px solid var(--tone);opacity:.42;transform:translateY(-50%)}`);
      continue;
    }
    if (line.tag) rules.push(`${row}::after{content:${JSON.stringify(line.tag)}}`);
  }
  return { levels, sheet: rules.join('\n') };
}

/** A moment between the core's «did not load» and its fresh start, so the two never flicker. */
const HEAL_MS = 1_200;

/**
 * A coin's chart: the core chart (`@ryntra/core/chart`) on the engine's candles of the coin's deepest pool
 * (`/api/spot/candles`), exactly as the city's Spot window draws them (`city/lib/chart/**`) — every period the engine
 * reads, the last bar closed at the market's live price. Around it stand the terminal's own period tabs, the «Live»
 * light, and two quiet controls: the chart's own tools (indicators and drawings, kept in this browser) and the whole
 * screen. `onHead` gets the price the chart's head should say — the live price, else the engine's newest close — so the
 * screen's head and the last bar never say two prices.
 */
export function CoinChart({ coin, sym, aside, onHead }: { coin: Tower; sym: string; aside?: ReactNode; onHead?: (price: number | null) => void }) {
  const w = useWords(COIN);
  const lang = useLang();
  const [timeframe, setTimeframe] = useTimeframe();
  const data = useCandles(coin.id, timeframe);
  const fresh = useCity((st) => st.snapshot.source === 'live' && !isStale(st.snapshot.fetchedAt));
  const livePrice = fresh && Number.isFinite(coin.price) && coin.price > 0 ? coin.price : null;
  const feed = useFeed(coin, data, livePrice);
  const [tools, setTools] = useState(false);
  const [full, setFull] = useState(false);
  const pane = useRef<HTMLDivElement | null>(null);
  const heal = useHeal(pane, data);
  // Up or down over the candles scrolls the page the chart stands in; across and a pinch stay the chart's.
  useScrollThrough(pane);

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

  const live = fresh && data.status === 'ready' && !data.last?.stale;
  // The lines over the candles: the store changes only when a part writes its slot.
  const pool = usePoolLayer(coin.id, head, lang);
  const overlay = useChartLayer();
  const layer = useMemo(() => levelsOf(linesOf(overlay, coin.id)), [overlay, coin.id]);
  const badge = badgeOf(overlay, coin.id);
  const periods = (frames: readonly Timeframe[]) => frames.map((id) => ({ id, label: w[FRAME_WORDS[id]] }));
  // The core chart's «Delayed» badge says how long; the pane's sheet writes it in.
  const delay = { ['--chart-delay' as string]: JSON.stringify(delayLine(timeframe)) };

  return (
    <div className={c.wrap} data-full={full ? '' : undefined} data-tools={tools ? '' : undefined}>
      <Panel pad="none" label={w.chart} className={c.panel}>
        <div className={c.head}>
          <Tabs bare label={w.period} value={timeframe} onChange={setTimeframe} items={periods(DESK_FRAMES)} />
          <span className={c.grow} />
          {badge ? <span className={c.badge}>{badge}</span> : null}
          <Chip tone={live ? 'ok' : 'warn'} dot>
            {live ? w.live : w.delayed}
          </Chip>
          {pool.there ? (
            <button type="button" className={c.round} aria-label={w.poolLayer} aria-pressed={pool.on} onClick={() => pool.setOn(!pool.on)} data-coin="pool-layer">
              <Icon name="depth" size="s" />
            </button>
          ) : null}
          <button type="button" className={c.round} aria-label={w.tools} aria-pressed={tools} onClick={() => setTools((was) => !was)}>
            <Icon name="tools" size="s" />
          </button>
          <button type="button" className={c.round} aria-label={full ? w.exitFull : w.full} aria-pressed={full} onClick={() => setFull((was) => !was)}>
            <Icon name="expand" size="s" />
          </button>
        </div>
        <div className={c.pane} ref={pane} style={delay} data-coin-layer="">
          {layer.sheet ? <style>{layer.sheet}</style> : null}
          <ChartBody key={`${coin.id}:${tools}`} coin={coin} sym={sym} data={data} feed={feed} timeframe={timeframe} onTimeframe={setTimeframe} livePrice={livePrice} heal={heal} tools={tools} lang={lang} levels={layer.levels} />
        </div>
      </Panel>
      <div className={c.under}>
        <Tabs fill label={w.period} value={timeframe} onChange={setTimeframe} items={periods(PHONE_FRAMES)} className={c.underTabs} />
        {aside}
      </div>
    </div>
  );
}

/** The chart, or why there is none in one line: the wrong chart is worse than none; the ticket works from the live price. */
function ChartBody({
  coin,
  sym,
  data,
  feed,
  timeframe,
  onTimeframe,
  livePrice,
  heal,
  tools,
  lang,
  levels,
}: {
  coin: Tower;
  sym: string;
  data: ChartData;
  feed: Feed | null;
  timeframe: Timeframe;
  onTimeframe: (next: Timeframe) => void;
  livePrice: number | null;
  /** Bumped when bars arrive after the core chart gave up waiting: it starts again on them. */
  heal: number;
  /** The chart's own tools: indicators as this browser drew them last, and drawings. */
  tools: boolean;
  lang: ReturnType<typeof useLang>;
  /** The screen's lines over the candles (`chart-layer.ts`), as the core chart's levels. */
  levels: ReturnType<typeof levelsOf>['levels'];
}) {
  const w = useWords(COIN);
  // The core chart says where its crosshair stands on a channel of its own; the readout follows it.
  const [crosshair] = useState(() => ({ channel: crosshairChannel(), id: 'coin' }));
  const hover = useHover(crosshair.channel);
  const marks = useMemo(() => ({ view: PRICE_BASIS, marks: NO_MARK_LIST, levels }), [levels]);
  if (data.status === 'none') {
    return (
      <p className={c.state} role="status">
        {w.noChart(sym)}
      </p>
    );
  }
  if (saysUnavailable(data)) {
    return (
      <p className={c.state} role="status">
        {w.chartUnavailable}
      </p>
    );
  }
  // The first tries that failed are quiet: the frame waits, as for a first read, while the chart asks again.
  if ((data.status === 'unavailable' && !data.last) || !feed) return <div className={c.wait} aria-busy="true" />;
  const readout = !tools && data.last ? readoutOf(data.last.candles, hover, livePrice) : null;
  return (
    <>
      <RyntraChart
        key={`${coin.id}:${heal}`}
        source={feed.source}
        instrument={coin.id}
        resolution={resolutionOf(timeframe)}
        onResolutionChange={(next) => {
          const picked = timeframeOf(next);
          if (picked) onTimeframe(picked);
        }}
        basis={PRICE_BASIS}
        lang={lang}
        symbol={<span className="ryntra-visually-hidden">{sym}</span>}
        label={w.chartOf(sym)}
        marks={marks}
        indicators={tools ? undefined : NO_INDICATORS}
        drawings={tools ? { profile: null } : null}
        indicatorWorker={indicatorWorker}
        crosshair={crosshair}
        className={c.core}
      />
      {readout ? (
        <p className={c.readout} aria-hidden="true">
          <span>{readoutTime(readout.t, timeframe === '1d')}</span>
          <b>{priceText(readout.close, lang)}</b>
          <span data-tone={readout.move >= 0 ? 'up' : 'down'}>{formatPct(readout.move)}</span>
        </p>
      ) : null}
    </>
  );
}

/** The bar under the pointer (its open, ms), told at most once a frame; null when the pointer is off the candles. */
function useHover(channel: ReturnType<typeof crosshairChannel>): number | null {
  const [t, setT] = useState<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const stop = channel.subscribe((at) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setT(at?.t ?? null));
    });
    return () => {
      cancelAnimationFrame(raf);
      stop();
    };
  }, [channel]);
  return t;
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
 * failed keeps the time of the last good one, and the live price closes the newest bar.
 */
function useFeed(coin: Tower, data: ChartData, livePrice: number | null): Feed | null {
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
    const read = data.last;
    if (!feed || data.mint !== coin.id || !read) return;
    feed.put(read.timeframe, read.candles, data.status === 'ready' ? read.observedAt : null, read.stale, read.pool);
  }, [feed, data, coin.id]);
  useEffect(() => {
    feed?.live(livePrice);
  }, [feed, livePrice]);
  return feed;
}
