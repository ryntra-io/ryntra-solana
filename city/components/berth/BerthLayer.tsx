'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useBerth } from '@/city/lib/launch/berth-store';
import { BERTH } from '@/city/lib/launch/words';
import { useWords } from '@/city/lib/i18n/dict';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { useCityWindow } from '../window/useCityWindow';
import { BerthGlyph } from './glyphs';
import s from './berth.module.css';

// The window's contents and the claim's flow load the first time it opens: the city's first frame carries none of them.
const BerthWindow = dynamic(() => import('./BerthWindow'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });

const renderBerth = () => <BerthWindow />;
const closeBerth = () => useBerth.getState().close();

/**
 * «Мій причал» (L4 · CITY-141) in the city's one window frame (CITY-65): the creator's launches, their three streams,
 * «Забрати», the days and the two cards. Opened from the launch sheet's head and from the creator's own tower
 * (`openBerth`). A run owns the whole screen and a clip being filmed keeps the frame clean — unless a claim is mid-way,
 * which always stays in view, and which the frame holds open.
 */
export function BerthLayer() {
  const open = useBerth((st) => st.open);
  const busy = useBerth((st) => st.busy);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const w = useWords(BERTH);
  const title = w.title;

  const shown = open && (!(running || filming) || busy);
  // Escape closes the window unless something heard it first, or a claim is mid-way (`close` waits then).
  useEffect(() => {
    if (!shown) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      useBerth.getState().close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shown]);

  const spec = useMemo(
    () => ({
      id: 'berth',
      title,
      icon: <BerthGlyph />,
      render: renderBerth,
      // CITY-242: as tall as what is inside, up to its place — no empty glass under the cards on a large desk.
      fit: true,
      size: { width: 760, height: 900 },
      min: { width: 380, height: 520 },
      held: busy,
      onClose: closeBerth,
    }),
    // A new language is a new title: the open window's head follows it.
    [busy, title],
  );
  useCityWindow(shown, spec);
  return null;
}
