'use client';

import { useEffect } from 'react';
import { useTowerChart } from '@/city/lib/chart/store';
import { useCity } from '@/city/lib/city/store';
import { EXCHANGE_OPEN } from '@/city/lib/exchange/flag';
import { useExchange } from '@/city/lib/exchange/store';
import { isNamed } from '@/city/lib/market/types';
import { openMoney } from '@/city/lib/money/open';
import { windowsDemo } from '@/city/lib/window/demo';
import { layout, useWindows } from '@/city/lib/window/store';

/**
 * The windows' stand (`?windows=demo`, development builds only): the city's own windows, as a person opens them — the
 * chart of the first named tower, the Exchange (where its switch is open) and Money — stuck into one grid (macet M2);
 * `&full=<id>` puts one on the whole screen (macet M3). It opens them through their own stores, exactly as the tower
 * card, the dock and «Mine» do: nothing is read or signed that a person's tap would not.
 */
export function WindowDemo() {
  useEffect(() => {
    const asked = windowsDemo();
    const tower = useCity.getState().layout.towers.find((t) => isNamed(t.tower))?.tower;
    if (tower) useTowerChart.getState().open(tower.id);
    if (EXCHANGE_OPEN) useExchange.getState().show();
    openMoney('portfolio');
    // The windows open with their layers' next render: the grid waits until every one asked for stands in the frame.
    const expected = (tower ? 1 : 0) + (EXCHANGE_OPEN ? 1 : 0) + 1;
    let done = false;
    const arrange = () => {
      if (done || useWindows.getState().layout.windows.length < expected) return;
      done = true;
      layout('grid');
      if (asked?.full) useWindows.getState().full(asked.full);
    };
    const stop = useWindows.subscribe(arrange);
    arrange();
    return stop;
  }, []);
  return null;
}
