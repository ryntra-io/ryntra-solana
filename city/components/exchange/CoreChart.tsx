'use client';

import '@ryntra/core/tokens.css';
import '@ryntra/core/ui.css';
import '@ryntra/core/chart.css';

import { useEffect, useMemo, useState } from 'react';
import { RyntraChart } from '@ryntra/core/chart';
import { CHART_MS, withLiveMark } from '@/city/lib/exchange/candles';
import { FuturesChartFeed, LAST_BASIS, resolutionOf, timeframeOf } from '@/city/lib/exchange/core-feed';
import { marketFacts } from '@/city/lib/exchange/markets';
import { currentMarket, useExchange } from '@/city/lib/exchange/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { lotUnits, tickUsd } from '@/lib/phoenix/market-data';
import { EX } from './words';
import s from './exchange.module.css';

/** The indicators are counted in the city's own worker, as on the tower's chart. */
const indicatorWorker = () => new Worker(new URL('../chart/indicator-worker.ts', import.meta.url), { type: 'module' });

/**
 * The open market on our chart: Phoenix's bars from
 * the engine as the futures feed reads them (B7), the forming bar at the live mark, moved and zoomed by hand, with the
 * chart's own intervals, styles, scales, indicators and drawings (kept in this browser). Nothing here is sent.
 */
export function FuturesCoreChart() {
  const symbol = useExchange((st) => st.symbol);
  const market = useExchange((st) => currentMarket(st));
  const read = useExchange((st) => st.candles);
  const timeframe = useExchange((st) => st.chartTimeframe);
  const setTimeframe = useExchange((st) => st.setChartTimeframe);
  const lang = useLang();
  const w = useWords(EX);
  const tick = market ? tickUsd(market) : null;
  const lot = market ? lotUnits(market) : null;
  const mark = market ? marketFacts(market, null).mark : null;

  // One feed per market and its units; the step from a price is the fallback only.
  const [feed, setFeed] = useState<FuturesChartFeed | null>(null);
  useEffect(() => {
    if (!symbol) return;
    const next = new FuturesChartFeed(symbol, { tick, lot, price: mark });
    setFeed(next);
    return () => next.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tick, lot]);

  // The bars are read while the chart is on screen; the markets' own beat brings the mark between the reads.
  useEffect(() => {
    if (!symbol) return;
    const load = () => void useExchange.getState().loadCandles();
    load();
    const every = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, CHART_MS);
    return () => window.clearInterval(every);
  }, [symbol, timeframe]);

  // Each read goes to the feed with its newest bar at the live mark: the chart moves with the price on screen.
  const live = useMemo(() => (read.value ? withLiveMark(read.value, mark) : null), [read.value, mark]);
  useEffect(() => {
    if (feed && live && symbol && live.symbol.toUpperCase() === symbol.toUpperCase()) feed.put(live);
  }, [feed, live, symbol]);
  useEffect(() => {
    if (feed && read.status === 'failed' && !read.value) feed.fail(timeframe);
  }, [feed, read.status, read.value, timeframe]);

  if (!feed || !symbol) return <div className={`${s.coreChart} ${s.coreWait}`} aria-busy="true" />;
  return (
    <div className={s.coreChart} data-exchange-chart="">
      <RyntraChart
        key={symbol}
        source={feed.source}
        instrument={symbol}
        resolution={resolutionOf(timeframe)}
        onResolutionChange={(next) => {
          const picked = timeframeOf(next);
          if (picked) setTimeframe(picked);
        }}
        basis={LAST_BASIS}
        lang={lang}
        symbol={<span className={s.coreSymbol}>{w.perp(symbol)}</span>}
        label={w.perp(symbol)}
        drawings={{ profile: null }}
        indicatorWorker={indicatorWorker}
        className={s.core}
      />
    </div>
  );
}
