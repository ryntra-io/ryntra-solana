'use client';

import type { Tower } from '@/city/lib/market/types';
import { useTowerChart } from '@/city/lib/chart/store';
import { useWords } from '@/city/lib/i18n/dict';
import { CandlesGlyph } from './glyphs';
import { CHART } from './words';
import c from './chart.module.css';

export { chartOpen } from '@/city/lib/chart/store';

/** Whether a tower's chart is open: it stands in the tower card's place while it is. */
export const useChartOpen = (): boolean => useTowerChart((st) => st.mint !== null);

/** The window's code, fetched as soon as a pointer comes near the chip, so the chart opens without a wait. */
const preload = () => void import('./ChartWindow').catch(() => {});

/** The tower card's «Chart»: the tower's live chart opens in the card's place; closing it brings the card back. */
export function ChartAction({ tower }: { tower: Pick<Tower, 'id'> }) {
  const w = useWords(CHART);
  return (
    <button
      type="button"
      className={c.action}
      onPointerEnter={preload}
      onFocus={preload}
      onClick={() => useTowerChart.getState().open(tower.id)}
    >
      <CandlesGlyph />
      {w.chart}
    </button>
  );
}
