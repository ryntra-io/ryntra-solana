'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import type { Gone, Intent } from '@/city/lib/intent/check';
import { BUSY_PHASES, useIntent, type CoinLook } from '@/city/lib/intent/store';
import { INTENT } from '@/city/lib/intent/words';
import { startWallets } from '@/city/lib/trade/wallet';
import { useCityWindow } from '../window/useCityWindow';
import s from './intent.module.css';

// The sheet's contents and their flows load with the sheet: the city's first frame carries none of them.
const IntentSheet = dynamic(() => import('./IntentSheet'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });

const renderIntent = () => <IntentSheet />;
const closeIntent = () => useIntent.getState().close();

/** The sheet's glyph in the window's head: a seal with a check — something to confirm. */
function SealGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.8l2.2 1.6 2.7-.2.9 2.6 2.2 1.6-.8 2.6.8 2.6-2.2 1.6-.9 2.6-2.7-.2L12 19.4l-2.2-1.6-2.7.2-.9-2.6L4 13.8l.8-2.6L4 8.6l2.2-1.6.9-2.6 2.7.2z" />
      <path d="M8.6 11.4l2.3 2.3 4.5-4.6" />
    </svg>
  );
}

/**
 * `ryntra.io/i/<id>` (CITY-161): the city with one window — the confirm sheet of an action an agent, a chat or a partner
 * prepared. The page reads the intent on the server and hands it here; the window opens over the city at once, held
 * while the wallet or a transaction is mid-way, and closing it leaves just the city.
 */
export function IntentLayer({ id, view, gone, coin }: { id: string; view: Intent | null; gone: Gone | null; coin: CoinLook | null }) {
  const w = useWords(INTENT);
  const open = useIntent((st) => st.open);
  const busy = useIntent((st) => BUSY_PHASES.has(st.phase));

  useEffect(() => {
    startWallets();
    useIntent.getState().start({ id, view, gone, coin });
  }, [id, view, gone, coin]);

  // Escape closes the sheet, unless something heard it first or the wallet is mid-way (`close` waits then).
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      useIntent.getState().close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);

  const spec = useMemo(
    () => ({ id: 'intent', title: w.title, icon: <SealGlyph />, render: renderIntent, size: { width: 460, height: 660 }, min: { width: 380, height: 480 }, held: busy, onClose: closeIntent }),
    [w.title, busy],
  );
  useCityWindow(open, spec);
  return null;
}
