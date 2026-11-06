'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { GUARD_OPEN } from '@/city/lib/guard/flag';
import { useGuard } from '@/city/lib/guard/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { useCityWindow } from '../window/useCityWindow';
import { ShieldGlyph } from './glyphs';
import { GUARD } from './words';
import s from './guard.module.css';

// The window's contents load the first time it opens: the city's first frame carries none of them.
const GuardWindow = dynamic(() => import('./GuardWindow'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });

const renderGuard = () => <GuardWindow />;
const closeGuard = () => useGuard.getState().close();

/**
 * «Охорона» in the city (CITY-152), in the city's one window frame (CITY-65): the Deck's Guard place opens it while
 * the deployment's switch is open. A run owns the whole screen and a clip being filmed keeps the frame clean.
 */
export function GuardLayer() {
  const open = useGuard((st) => st.open);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const w = useWords(GUARD);
  const title = w.title;
  const shown = GUARD_OPEN && open && !(running || filming);

  // Escape closes the window unless something heard it first (the whole screen given back, another window's own key).
  useEffect(() => {
    if (!shown) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      useGuard.getState().close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shown]);

  const spec = useMemo(
    () => ({
      id: 'guard',
      title,
      icon: <ShieldGlyph />,
      render: renderGuard,
      fit: true,
      size: { width: 460, height: 640 },
      min: { width: 380, height: 440 },
      onClose: closeGuard,
    }),
    // A new language is a new title: the open window's head follows it.
    [title],
  );
  useCityWindow(shown, spec);
  return null;
}
