'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useLearn } from '@/city/lib/learn/store';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { useCityWindow } from '../window/useCityWindow';
import { LearnGlyph } from './glyphs';
import l from './learn.module.css';
import { LEARN_WORDS } from './words';

// The guide loads the first time the window opens: the city's first frame carries none of it.
const LearnBody = dynamic(() => import('./LearnBody'), { ssr: false, loading: () => <div className={l.pending} aria-busy="true" /> });

const renderLearn = () => <LearnBody />;
const closeLearn = () => useLearn.getState().hide();

/**
 * «Learn» (CITY-202) in the city's one window frame (CITY-65): a window on a computer, the bottom sheet on a phone.
 * Opened from the menu (☰) and from the command line («how does the agent work»); Escape and «Close» close it.
 */
export function LearnLayer() {
  const open = useLearn((st) => st.open);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const title = useWords(LEARN_WORDS).title;
  const shown = open && !(running || filming);

  useEffect(() => {
    if (!shown) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      useLearn.getState().hide();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shown]);

  const spec = useMemo(
    () => ({ id: 'learn', title, icon: <LearnGlyph />, render: renderLearn, size: { width: 900, height: 720 }, min: { width: 340, height: 460 }, onClose: closeLearn }),
    // A new language is a new title: the open window's head follows it.
    [title],
  );
  useCityWindow(shown, spec);
  return null;
}
