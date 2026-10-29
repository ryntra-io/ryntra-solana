'use client';

/* The core chart is the rendering engine only (decision 75): its tokens, base styles and chart styles so the canvas
   lays out, every rule scoped to the core's own classes. Everything around the candles is the city's own — the window
   hides the core's toolbar, legend, mark and status line, and redraws its colours and type in the city's. */
import '@ryntra/core/tokens.css';
import '@ryntra/core/ui.css';
import '@ryntra/core/chart.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import { RyntraChart } from '@ryntra/core/chart';
import { detailsOf, headPrice, TIMEFRAMES, whyNoChart, type ChartData, type Timeframe } from '@/city/lib/chart/candles';
import { entryLayer, entryMove } from '@/city/lib/chart/entry';
import { riskFacts } from '@/city/lib/chart/facts';
import { marketOf, PRICE_BASIS, resolutionOf, tickFor, timeframeOf, TowerFeed, type Feed } from '@/city/lib/chart/feed';
import { layersOf, mergeLayers, toggleChartLayer, useChartLayers, type ChartLayer } from '@/city/lib/chart/layers';
import { marketLayer } from '@/city/lib/chart/marks';
import { crosshairChannel, readoutOf, readoutTime } from '@/city/lib/chart/readout';
import { useCandles, useEntry, useMarketMarks, useTimeframe } from '@/city/lib/chart/use-chart';
import { isStale } from '@/city/lib/city/events';
import { useCity } from '@/city/lib/city/store';
import type { Tower } from '@/city/lib/market/types';
import { formatPct } from '@/city/lib/trade/mine';
// The tower card's own switch (`NEXT_PUBLIC_RYNTRA_CITY_TRADE`): `closed` puts Buy back to «soon» without a code change.
import { TRADE_OPEN } from '@/city/lib/trade/gates';
import { useTrade } from '@/city/lib/trade/store';
import { useWindows } from '@/city/lib/window/store';
import { formatPrice, sym } from '../hud/bits';
import { CoinIcon } from './CoinIcon';
import c from './chart.module.css';

/** The core's indicator worker, from this site's own file (none are drawn; a set kept from elsewhere still has one). */
const indicatorWorker = () => new Worker(new URL('./indicator-worker.ts', import.meta.url), { type: 'module' });

/** The tower chart draws candles and volume only: no indicator set carried over from another chart of this browser. */
const NO_INDICATORS: readonly [] = [];

/**
 * A tower's live chart (CITY-5a): the core chart (`@ryntra/core/chart`, CH-17) on the engine's candles of the coin —
 * candles and volume at every interval the engine reads, the last bar closed at the tower's live price — with the
 * person's entry when the wallet holds the coin, the coin's market marks, and any layer a district adds
 * (`city/lib/chart/layers.ts`). Under it the risk facts the engine already gives, and one amber action: Buy, which
 * opens the trade card the tower card opens. The city's one window frame (CITY-65) brings the head with «Chart», the
 * moving, the sticking and the whole screen on a desk, and the bottom sheet on a phone; these are its contents.
 */
export function ChartWindow({ tower }: { tower: Tower }) {
  const sheet = !useWindows((st) => st.desk);
  const [timeframe, setTimeframe] = useTimeframe();
  const data = useCandles(tower.id, timeframe);
  const fresh = useCity((st) => st.snapshot.source === 'live' && !isStale(st.snapshot.fetchedAt));
  const livePrice = fresh && Number.isFinite(tower.price) && tower.price > 0 ? tower.price : null;
  const feed = useFeed(tower, data, livePrice);
  const market = useMarketMarks(tower.id);
  const entry = useEntry(tower);
  const added = useChartLayers((st) => st.layers);
  const hidden = useChartLayers((st) => st.hidden);

  const layers = useMemo(
    () => [marketLayer(tower.id, market), entryLayer(tower.id, entry), ...layersOf(added, tower.id)].filter((layer): layer is ChartLayer => layer !== null),
    [tower.id, market, entry, added],
  );
  // The step follows the reads (a coin that fell draws finer prices): the levels are put on it again with each read.
  const tick = feed?.tick ?? tickFor(livePrice);
  const drawn = useMemo(() => {
    const merged = mergeLayers(layers, hidden, tick);
    return { view: PRICE_BASIS, marks: merged.marks, levels: merged.levels };
  }, [layers, hidden, tick]);

  // Where the bars come from and how old they are stay one quiet tap away (the clean interface, 28.10).
  const [details, setDetails] = useState(false);
  const now = useClock(details);
  const frame = useRef<HTMLElement | null>(null);
  const pane = useRef<HTMLDivElement | null>(null);
  const heal = useHeal(pane, data);
  const up = tower.change24h >= 0;
  // The price in the head is the chart's own: the city's live price, else the engine's newest close, so the head and the
  // last bar never say two prices while the city's read is a held snapshot.
  const price = headPrice(livePrice, data, tower.id) ?? tower.price;
  const move = entryMove(entry, price);
  const facts = riskFacts(tower, Date.now());

  // Focus comes to the window when it opens, and goes back to where it was when it closes.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    frame.current?.focus({ preventScroll: true });
    return () => before?.focus?.({ preventScroll: true });
  }, []);

  const label = `${sym(tower)} chart`;

  return (
    <section
      ref={frame}
      className={`${c.frame} ${c.framed} ${sheet ? c.compact : ''}`}
      role="region"
      aria-label={label}
      tabIndex={-1}
      data-city-chart={sheet ? 'sheet' : 'window'}
      data-details={details ? '' : undefined}
    >
      <header className={c.head}>
        <CoinIcon tower={tower} />
        <div className={c.title}>
          <div className={`${c.display} ${c.symbol}`}>{sym(tower)}</div>
          <div className={c.name}>{tower.name}</div>
        </div>
        <div className={c.quote}>
          <span className={`${c.display} ${c.price}`}>{formatPrice(price)}</span>
          <span className={`${c.change} ${up ? c.up : c.down}`}>
            {up ? '+' : '−'}
            {Math.abs(tower.change24h).toFixed(1)}% <small>24H</small>
          </span>
        </div>
        <button type="button" className={c.info} aria-label="Details" title="Details" aria-pressed={details} onClick={() => setDetails((on) => !on)}>
          i
        </button>
      </header>

      <div className={c.frames} role="radiogroup" aria-label="Interval">
        {TIMEFRAMES.map((entry) => (
          <button key={entry} type="button" role="radio" className={c.frameChip} aria-checked={entry === timeframe} onClick={() => setTimeframe(entry)}>
            {frameLabel(entry)}
          </button>
        ))}
      </div>

      <div className={c.chart} ref={pane}>
        <ChartBody tower={tower} data={data} feed={feed} timeframe={timeframe} onTimeframe={setTimeframe} drawn={drawn} livePrice={livePrice} heal={heal} />
      </div>

      {details && data.last ? <p className={c.details}>{detailsOf(data, now).join(' · ')}</p> : null}

      <dl className={c.facts}>
        {facts.map((fact) => (
          <div key={fact.key} className={c.fact}>
            <dt>{fact.label}</dt>
            <dd>
              {fact.value}
              {fact.risk ? <span className={c.risk}>{fact.risk}</span> : null}
            </dd>
          </div>
        ))}
        {entry !== null ? (
          <div className={`${c.fact} ${c.entry}`}>
            <dt>Your entry</dt>
            <dd>
              {formatPrice(entry)}
              {move !== null ? <span className={move >= 0 ? c.up : c.down}>{formatPct(move)}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className={c.foot}>
        {layers.length && charted(data) ? (
          <div className={c.layers} role="group" aria-label="Chart layers">
            {layers.map((layer) => (
              <button key={layer.id} type="button" className={c.layer} aria-pressed={!hidden.has(layer.id)} onClick={() => toggleChartLayer(layer.id)}>
                {layer.label}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        {TRADE_OPEN ? (
          <button type="button" className={`${c.display} ${c.buy}`} onClick={() => useTrade.getState().openFor(tower, 'buy')}>
            Buy {sym(tower)}
          </button>
        ) : (
          <button type="button" className={`${c.display} ${c.buy}`} disabled>
            Trade · soon
          </button>
        )}
      </div>

    </section>
  );
}

/** An interval as a chart writes it: minutes and hours small (1m is a minute, never a month), the day 1D. */
const frameLabel = (timeframe: Timeframe): string => (timeframe === '1d' ? '1D' : timeframe);

/** Whether there are candles to draw on: no chip for a layer that has no chart under it. */
const charted = (data: ChartData) => data.status !== 'none' && !(data.status === 'unavailable' && !data.last);

/** The chart, or why there is none in one line: the wrong chart is worse than none; Buy below works from the live price. */
function ChartBody({
  tower,
  data,
  feed,
  timeframe,
  onTimeframe,
  drawn,
  livePrice,
  heal,
}: {
  tower: Tower;
  data: ChartData;
  feed: Feed | null;
  timeframe: Timeframe;
  onTimeframe: (next: Timeframe) => void;
  /** The layers on screen, in the core chart's own form: one object while nothing in them changed. */
  drawn: Readonly<{ view: typeof PRICE_BASIS; marks: ReturnType<typeof mergeLayers>['marks']; levels: ReturnType<typeof mergeLayers>['levels'] }>;
  livePrice: number | null;
  /** Bumped when bars arrive after the core chart gave up waiting: it starts again on them. */
  heal: number;
}) {
  // The core chart says where its crosshair stands on the city's own channel; the readout below follows it.
  const [crosshair] = useState(() => ({ channel: crosshairChannel(), id: 'tower' }));
  const hover = useHover(crosshair.channel);
  if (data.status === 'none') {
    return (
      <div className={`${c.state} ${c.artEmpty}`} role="status">
        <b>No chart for {sym(tower)}</b>
        {/* Why, in the engine's words, only behind «Details»: the screen says what is, not why. Another interval may
            still have bars: the row above stays. */}
        <span className={c.why}>{whyNoChart(data.code)}</span>
      </div>
    );
  }
  if (data.status === 'unavailable' && !data.last) {
    return (
      <div className={`${c.state} ${c.artEmpty}`} role="status">
        {/* It is read again on its own: nothing for the person to do, so nothing more to say. */}
        <b>Chart unavailable</b>
      </div>
    );
  }
  if (!feed) return <div className={`${c.state} ${c.artLoading}`} aria-busy="true" />;
  const readout = data.last ? readoutOf(data.last.candles, hover, livePrice) : null;
  return (
    <>
      <RyntraChart
        key={`${tower.id}:${heal}`}
        source={feed.source}
        instrument={tower.id}
        resolution={resolutionOf(timeframe)}
        onResolutionChange={(next) => {
          const picked = timeframeOf(next);
          if (picked) onTimeframe(picked);
        }}
        basis={PRICE_BASIS}
        lang="en"
        symbol={<span className="ryntra-visually-hidden">{sym(tower)}</span>}
        label={`${sym(tower)} price`}
        marks={drawn}
        indicators={NO_INDICATORS}
        indicatorWorker={indicatorWorker}
        crosshair={crosshair}
        className={c.core}
      />
      {readout ? (
        <p className={c.readout} aria-hidden="true">
          <span>{readoutTime(readout.t, timeframe === '1d')}</span>
          <b>{formatPrice(readout.close)}</b>
          <span className={readout.move >= 0 ? c.up : c.down}>{formatPct(readout.move)}</span>
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
 * after it gave up, or one it gave up beside — start it again by itself, so the person never has to: once for each
 * read, so a chart that keeps failing on the same bars waits for the next read instead of trying in a loop.
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

/** A moment between the core's «did not load» and its fresh start, so the two never flicker. */
const HEAL_MS = 1_200;

/** Now, ticking each second while the details are open: the age they say counts on. */
function useClock(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

/**
 * One feed a market, made with it: its first price step from the tower's price, finer as the reads bring smaller
 * prices. The reads go in as they come — a read that failed keeps the time of the last good one, so the age under the
 * chart counts from it — and the live price closes the newest bar.
 */
function useFeed(tower: Tower, data: ChartData, livePrice: number | null): Feed | null {
  const [held, setHeld] = useState<Readonly<{ mint: string; feed: Feed }> | null>(null);
  useEffect(() => {
    const feed = new TowerFeed(marketOf(tower));
    setHeld({ mint: tower.id, feed });
    return () => feed.dispose();
    // A market's feed lives while the market is on the chart; the price seeds its first step only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tower.id]);
  const feed = held && held.mint === tower.id ? held.feed : null;
  useEffect(() => {
    const read = data.last;
    if (!feed || data.mint !== tower.id || !read) return;
    feed.put(read.timeframe, read.candles, data.status === 'ready' ? read.observedAt : null, read.stale, read.pool);
  }, [feed, data, tower.id]);
  useEffect(() => {
    feed?.live(livePrice);
  }, [feed, livePrice]);
  return feed;
}
