'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useCity } from '@/city/lib/city/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useLaunched } from '@/city/lib/launch/launched-store';
import { LAUNCHED } from '@/city/lib/launch/words';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { LaunchGlyph } from '../hud/glyphs';
import { useCityWindow } from '../window/useCityWindow';
import s from './launched.module.css';

// The list loads the first time the window opens: the city's first frame carries none of it.
const LaunchedWindow = dynamic(() => import('./LaunchedWindow'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });

const renderLaunched = () => <LaunchedWindow />;
const closeLaunched = () => useLaunched.getState().close();

/**
 * «Launched on Ryntra» (CITY-185) in the city's one window frame (CITY-65): every coin launched on the launchpad. Opened
 * by its own address, `/launches`, and by `/?open=launches`. A run owns the whole screen and a clip being filmed keeps
 * the frame clean; a tower picked in the city takes the screen, and the window steps aside.
 */
export function LaunchedLayer() {
  const open = useLaunched((st) => st.open);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const selectedId = useCity((st) => st.selectedId);
  const w = useWords(LAUNCHED);
  const title = w.title;
  const shown = open && !(running || filming);

  useEffect(() => {
    if (selectedId) useLaunched.getState().close();
  }, [selectedId]);

  // Escape closes the window unless something heard it first.
  useEffect(() => {
    if (!shown) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      useLaunched.getState().close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shown]);

  const spec = useMemo(
    () => ({
      id: 'launched',
      title,
      icon: <LaunchGlyph />,
      render: renderLaunched,
      size: { width: 880, height: 680 },
      min: { width: 380, height: 480 },
      onClose: closeLaunched,
    }),
    // A new language is a new title: the open window's head follows it.
    [title],
  );
  useCityWindow(shown, spec);
  return null;
}
