'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef } from 'react';
import { useBackPanel } from '@/city/lib/back/panels';
import { useCity } from '@/city/lib/city/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useNewLaunches } from '@/city/lib/lens/new-store';
import { useLens } from '@/city/lib/lens/store';
import { NEW_WORDS } from '@/city/lib/lens/words';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { useTrade } from '@/city/lib/trade/store';
import { useCityWindow } from '../window/useCityWindow';
import { RingsGlyph } from './glyphs';
import s from './new.module.css';

// The terminal loads the first time the window opens: the city's first frame carries none of it.
const NewLaunchesWindow = dynamic(() => import('./NewLaunchesWindow'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });

const renderList = () => <NewLaunchesWindow />;
const closeList = () => useNewLaunches.getState().setList(false);

/**
 * «New» as a list (CITY-142) in the city's one window frame since CITY-191: «New launches on Solana» stretches by every
 * edge and corner, takes the whole screen, docks, folds into the tray and closes like every other window; on a phone
 * it is the bottom sheet. Opened by the toggle beside the «New» chip. It belongs to «New»: another chip, a run, the
 * trade card opening or a tower picked in the city puts it away; Escape and «Back» close it.
 */
export function NewList() {
  const list = useNewLaunches((st) => st.list);
  const lens = useLens((st) => st.lens);
  const running = useRun((st) => st.phase !== 'off');
  const tradeOpen = useTrade((st) => st.open);
  const selectedId = useCity((st) => st.selectedId);
  const filming = useFilming();
  const w = useWords(NEW_WORDS);
  // Short enough for a phone's sheet head beside its four buttons; the «New» chip already says it is Solana's.
  const title = w.windowTitle;
  const open = list && lens === 'new' && !running;
  useBackPanel('lens-new-list', open, closeList);

  useEffect(() => {
    if (list && (lens !== 'new' || running)) closeList();
  }, [list, lens, running]);

  // The trade card or a tower's card opening takes the person on: the list steps aside (a card already open stays).
  const wasTrade = useRef(tradeOpen);
  useEffect(() => {
    if (tradeOpen && !wasTrade.current) closeList();
    wasTrade.current = tradeOpen;
  }, [tradeOpen]);
  useEffect(() => {
    if (selectedId) closeList();
  }, [selectedId]);

  // Escape closes the window unless something heard it first (the whole screen gives itself back first).
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      closeList();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);

  const spec = useMemo(
    () => ({
      id: NEW_WINDOW,
      title,
      icon: <RingsGlyph />,
      render: renderList,
      size: { width: 1080, height: 660 },
      min: { width: 340, height: 420 },
      onClose: closeList,
    }),
    // A new language is a new title: the open window's head follows it.
    [title],
  );
  useCityWindow(open && !filming, spec);
  return null;
}

/** The window's id in the frame, its tray chip and its opener. */
export const NEW_WINDOW = 'new-launches';
