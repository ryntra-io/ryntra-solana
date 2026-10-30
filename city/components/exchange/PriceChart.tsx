'use client';

import dynamic from 'next/dynamic';
import { useExchange } from '@/city/lib/exchange/store';
import s from './exchange.module.css';

/** Our chart, loaded with the window that shows it: the city never carries the chart's code before the Exchange opens. */
const FuturesCoreChart = dynamic(() => import('./CoreChart').then((m) => m.FuturesCoreChart), {
  ssr: false,
  loading: () => <div className={`${s.coreChart} ${s.coreWait}`} aria-busy="true" />,
});

/**
 * The open market's price in the window: our chart (the core chart, CH-17's line) on Phoenix's bars — moved and zoomed
 * by hand, its own intervals, indicators and drawings. Phoenix
 * silent with nothing ever read: no empty frame on screen.
 */
export function PriceChart() {
  const read = useExchange((st) => st.candles);
  if (!read.value && read.status === 'failed') return null;
  return <FuturesCoreChart />;
}
