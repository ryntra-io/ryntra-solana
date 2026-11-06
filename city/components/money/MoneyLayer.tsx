'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useMoney } from '@/city/lib/money/open';
import { useRun } from '@/city/lib/run/store';
import { startWallets } from '@/city/lib/trade/wallet';
import { useCityWindow } from '../window/useCityWindow';
import { TabGlyph } from './bits';
import { MONEY } from './words';
import s from './money.module.css';

// The window's contents and their flows load the first time it opens: the city's first frame carries none of them.
const MoneyWindow = dynamic(() => import('./MoneyWindow'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });

const renderMoney = () => <MoneyWindow />;
const closeMoney = () => useMoney.getState().close();

/**
 * Money in the city (CITY-63), in the city's one window frame (CITY-65). Any window opens it with `openMoney(tab)` from
 * `city/lib/money/open`. A run owns the whole screen, and a clip being filmed keeps the frame clean — unless money is
 * mid-way, which always stays in view, and which the frame holds open.
 */
export function MoneyLayer() {
  const open = useMoney((st) => st.open);
  const busy = useMoney((st) => st.busy);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const w = useWords(MONEY);
  const title = w.money;

  useEffect(() => {
    if (open) startWallets();
  }, [open]);

  const shown = open && (!(running || filming) || busy);
  // Escape closes the window — from its first frame, before its code has arrived — unless something heard it first (the
  // whole screen given back, another window's own Escape) or money is mid-way (`close` waits then).
  useEffect(() => {
    if (!shown) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      useMoney.getState().close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shown]);

  const spec = useMemo(
    () => ({
      id: 'money',
      title,
      icon: <TabGlyph tab="portfolio" />,
      render: renderMoney,
      size: { width: 520, height: 720 },
      min: { width: 400, height: 460 },
      held: busy,
      onClose: closeMoney,
    }),
    // A new language is a new title: the open window's head follows it.
    [busy, title],
  );
  useCityWindow(shown, spec);
  return null;
}
