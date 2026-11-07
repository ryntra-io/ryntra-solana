'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useLang } from '@/city/lib/i18n/lang';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { RING_DUELS_OPEN, useDuels } from '@/city/lib/ring/duels';
import { useRun } from '@/city/lib/run/store';
import { RingGlyph } from '../../game/glyphs';
import { useCityWindow } from '../../window/useCityWindow';
import { DUEL_UI } from './words';
import s from './duel.module.css';

// The window's contents load the first time it opens: the city's first frame carries none of the Ring.
const DuelsWindow = dynamic(() => import('./DuelsWindow'), { ssr: false, loading: () => <div className={s.pendingWindow} aria-busy="true" /> });

const renderDuels = () => <DuelsWindow />;
const closeDuels = () => useDuels.getState().close();

/**
 * The Ring's duels (CITY-51) in the city's one window frame (CITY-65), opened by the Arena's «Ring» door. Only where
 * both switches are open (`RING_DUELS_OPEN`); otherwise nothing mounts and the door is not shown.
 */
export function DuelsLayer() {
  return RING_DUELS_OPEN ? <Duels /> : null;
}

function Duels() {
  const open = useDuels((st) => st.open);
  const lang = useLang();
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const shown = open && !running && !filming;

  useEffect(() => {
    if (!shown) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      useDuels.getState().close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shown]);

  const spec = useMemo(
    () => ({ id: 'ring', title: DUEL_UI[lang].title, icon: <RingGlyph />, render: renderDuels, size: { width: 980, height: 760 }, min: { width: 380, height: 560 }, onClose: closeDuels }),
    [lang],
  );
  useCityWindow(shown, spec);
  return null;
}
