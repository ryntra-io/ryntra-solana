'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { BUSY, useInstruct } from '@/city/lib/instruct/store';
import { INSTRUCT } from '@/city/lib/instruct/words';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { useCityWindow } from '../window/useCityWindow';
import { AgentGlyph, ListGlyph } from './glyphs';
import s from './instruct.module.css';

// The card's and the list's contents load the first time either opens: the city's first frame carries none of them.
const AgentCard = dynamic(() => import('./AgentCard'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });
const Instructions = dynamic(() => import('./Instructions'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });

const renderCard = () => <AgentCard />;
const renderList = () => <Instructions />;
const closeCard = () => useInstruct.getState().close();
const closeList = () => useInstruct.getState().closeList();

/**
 * The agent's one-sentence instructions in the city's one window frame (CITY-176): the card — what the agent will set,
 * the fee in a line, «Sign» — and «My instructions». Both open from the command line and «Ask Ryntra»; a run owns the
 * whole screen and a clip being filmed keeps the frame clean, unless a signature is mid-way, which the frame holds.
 */
export function InstructLayer() {
  const open = useInstruct((st) => st.open);
  const listOpen = useInstruct((st) => st.listOpen);
  const busy = useInstruct((st) => BUSY.has(st.phase));
  const cancelling = useInstruct((st) => st.cancelling !== null);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const w = useWords(INSTRUCT);
  const quiet = running || filming;

  // Escape closes the card first, then the list — unless something heard it first or the wallet is mid-way.
  useEffect(() => {
    if (!open && !listOpen) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const state = useInstruct.getState();
      if (state.open) state.close();
      else state.closeList();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, listOpen]);

  const card = useMemo(
    () => ({ id: 'agent', title: w.title, icon: <AgentGlyph />, render: renderCard, fit: true, size: { width: 440, height: 560 }, min: { width: 360, height: 420 }, held: busy, onClose: closeCard }),
    [w.title, busy],
  );
  const list = useMemo(
    () => ({ id: 'instructions', title: w.listTitle, icon: <ListGlyph />, render: renderList, size: { width: 460, height: 600 }, min: { width: 360, height: 420 }, held: cancelling, onClose: closeList }),
    [w.listTitle, cancelling],
  );
  useCityWindow(open && (!quiet || busy), card);
  useCityWindow(listOpen && (!quiet || cancelling), list);
  return null;
}
