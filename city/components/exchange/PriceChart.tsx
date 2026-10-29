'use client';

import { useEffect, useMemo } from 'react';
import { CHART_MS, CHART_TIMEFRAMES, chartView } from '@/city/lib/exchange/candles';
import { price } from '@/city/lib/exchange/format';
import { useExchange } from '@/city/lib/exchange/store';
import s from './exchange.module.css';

/** The drawing's own box: wide and low, stretched to the frame; the strokes keep their width at any size. */
const W = 1000;
const H = 300;
/** Air above the highest wick and under the lowest, of the box. */
const PAD = 0.06;
const y = (at: number): number => H * (1 - PAD - at * (1 - PAD * 2));

/**
 * The open market's price in the window's wide view: Phoenix's traded-price bars as the engine reads them, read while
 * the chart is on screen, an interval picked from four. Nothing but the bars, the newest price and the range: the
 * details live on the market's «i». A read that never came leaves no frame behind — the chart only stands with bars.
 */
export function PriceChart() {
  const symbol = useExchange((st) => st.symbol);
  const read = useExchange((st) => st.candles);
  const timeframe = useExchange((st) => st.chartTimeframe);
  const setTimeframe = useExchange((st) => st.setChartTimeframe);
  const view = useMemo(() => chartView(read.value, symbol, timeframe), [read.value, symbol, timeframe]);

  useEffect(() => {
    if (!symbol) return;
    const load = () => void useExchange.getState().loadCandles();
    load();
    const every = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, CHART_MS);
    return () => window.clearInterval(every);
  }, [symbol, timeframe]);

  // Phoenix silent with nothing drawn: no empty frame on screen.
  if (!view && read.status === 'failed') return null;
  return (
    <div className={s.chart}>
      <div className={s.chartFrame} aria-busy={!view}>
        {view ? (
          <>
            <svg className={s.chartSvg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${symbol ?? ''}-PERP price, ${timeframe} bars, last ${price(view.last)}`}>
              <line className={s.chartLast} x1={0} x2={W} y1={y(view.lastAt)} y2={y(view.lastAt)} vectorEffect="non-scaling-stroke" />
              {view.candles.map((bar, index) => {
                const top = y(Math.max(bar.open, bar.close));
                const body = Math.max(1.5, y(Math.min(bar.open, bar.close)) - top);
                return (
                  <g key={index} className={bar.up ? s.chartUp : s.chartDown}>
                    <line x1={bar.x * W} x2={bar.x * W} y1={y(bar.high)} y2={y(bar.low)} vectorEffect="non-scaling-stroke" />
                    <rect x={(bar.x - view.width / 2) * W} width={view.width * W} y={top} height={body} />
                  </g>
                );
              })}
            </svg>
            <span className={`${s.chartScale} ${s.chartHigh}`}>{price(view.high)}</span>
            <span className={`${s.chartScale} ${s.chartLow}`}>{price(view.low)}</span>
            <span className={s.chartTag} style={{ top: `${(y(view.lastAt) / H) * 100}%` }}>
              {price(view.last)}
            </span>
          </>
        ) : (
          <span className={s.chartWait} />
        )}
      </div>
      <div className={s.chartTimes} role="radiogroup" aria-label="Chart interval">
        {CHART_TIMEFRAMES.map((tf) => (
          <button key={tf} role="radio" aria-checked={timeframe === tf} className={`${s.chartTime} ${timeframe === tf ? s.chartTimeOn : ''}`} onClick={() => setTimeframe(tf)}>
            {tf}
          </button>
        ))}
      </div>
    </div>
  );
}
