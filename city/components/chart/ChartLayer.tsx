'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import { howStore } from '@/city/lib/art/how';
import { useTowerChart } from '@/city/lib/chart/store';
import { useCity } from '@/city/lib/city/store';
import { useHarbor } from '@/city/lib/districts/harbor/store';
import { useWords } from '@/city/lib/i18n/dict';
import { isNamed } from '@/city/lib/market/types';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useMoments } from '@/city/lib/moments/stage';
import { useMoney } from '@/city/lib/money/open';
import { quarterStore } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';
import { useMine } from '@/city/lib/trade/mine-store';
import { useTrade } from '@/city/lib/trade/store';
import { useWindows } from '@/city/lib/window/store';
import { useCityWindow } from '../window/useCityWindow';
import { CandlesGlyph } from './glyphs';
import { CHART } from './words';
import c from './chart.module.css';

/**
 * The window's contents and the core chart come with the first open, never with the city's first frame; until they
 * arrive, the frame stands at once where the window will, the glass inside it a quiet light sweeping across — and says
 * so if the code could not be fetched. The frame's «Close» is the way back.
 */
const ChartWindow = dynamic(() => import('./ChartWindow').then((m) => m.ChartWindow), {
  ssr: false,
  loading: ({ error }) => <PendingPane failed={Boolean(error)} />,
});

function PendingPane({ failed }: { failed: boolean }) {
  const w = useWords(CHART);
  return (
    <div className={`${c.pending} ${failed ? c.artEmpty : c.artLoading}`} role="status" aria-label={failed ? w.couldNotLoad : w.loading}>
      {failed ? (
        <span className={c.state}>
          <b>{w.unavailable}</b>
        </span>
      ) : null}
    </div>
  );
}

const closeChart = () => useTowerChart.getState().close();

/**
 * A tower's chart over the city (CITY-5a), in the city's one window frame (CITY-65). It opens from the tower card's
 * «Chart», follows the picked tower while it is open — another tower picked, its chart, in the same window — and closes
 * with the card, at home, in the quarter, during a run and while a clip is filmed. Escape closes it first; the trade
 * card, when open over it, closes before it.
 */
export function ChartLayer() {
  const w = useWords(CHART);
  const mint = useTowerChart((st) => st.mint);
  const layout = useCity((st) => st.layout);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const inCity = useStore(quarterStore, (st) => st.mode === 'city');
  const tower = useMemo(() => (mint ? (layout.towers.find((t) => t.tower.id === mint)?.tower ?? null) : null), [layout, mint]);

  // The picked tower leads: another named tower brings its chart, none (or a pool without a name) closes it.
  useEffect(
    () =>
      useCity.subscribe((city, before) => {
        if (city.selectedId === before.selectedId) return;
        const chart = useTowerChart.getState();
        if (!chart.mint) return;
        const next = city.selectedId ? city.layout.towers.find((t) => t.tower.id === city.selectedId)?.tower : null;
        if (next && isNamed(next)) chart.open(next.id);
        // A chart out on another screen stays there when the tower card closes: only another tower changes it.
        else if (!useWindows.getState().out.chart) chart.close();
      }),
    [],
  );

  // A tower that left the city's read, a run, or the quarter: the chart goes.
  const shown = Boolean(mint && tower && isNamed(tower) && !running && inCity);
  useEffect(() => {
    if (mint && !shown && (running || !inCity || (layout.towers.length > 0 && !tower))) useTowerChart.getState().close();
  }, [mint, shown, running, inCity, layout, tower]);

  // One panel per press: a panel over the chart (the trade card, «Mine», Money, the Harbor, a moment's sheet, «How the
  // city works») closes first, and the press that closes the chart closes nothing under it (the HUD reads
  // `defaultPrevented`, whichever of the two heard the key first).
  useEffect(() => {
    if (!mint) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const over = [useTrade.getState().open, useMine.getState().open, useMoney.getState().open, useHarbor.getState().open, Boolean(useMoments.getState().sheet), howStore.getState().open];
      if (over.some(Boolean)) return;
      event.preventDefault();
      useTowerChart.getState().close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mint]);

  // The frame follows the tower: its contents change with it, the window keeps its place — in the city or out on
  // another screen (CITY-75), where its own page opens on the same tower. Its title follows the language (CITY-79).
  const render = useCallback(() => (tower ? <ChartWindow tower={tower} /> : null), [tower]);
  const towerId = tower?.id ?? null;
  const title = w.chart;
  const spec = useMemo(
    () => ({
      id: 'chart',
      title,
      icon: <CandlesGlyph />,
      render,
      size: { width: 720, height: 600 },
      min: { width: 480, height: 420 },
      onClose: closeChart,
      detach: towerId ? { tower: towerId } : undefined,
    }),
    [render, towerId, title],
  );
  // A clip being filmed hides the windows over the city; a chart out on another screen is not in the clip and stays.
  const out = useWindows((st) => Boolean(st.out.chart));
  useCityWindow(shown && (!filming || out) && Boolean(tower), spec);
  return null;
}
