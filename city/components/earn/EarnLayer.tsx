'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { EARN_OPEN } from '@/city/lib/earn/flag';
import { useEarn } from '@/city/lib/earn/open';
import { earnWords } from '@/city/lib/earn/words';
import { useLang } from '@/city/lib/i18n/lang';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { startWallets } from '@/city/lib/trade/wallet';
import { useCityWindow } from '../window/useCityWindow';
import { EarnGlyph } from './bits';
import s from './earn.module.css';

// The window's contents load the first time it opens: the city's first frame carries none of them.
const EarnWindow = dynamic(() => import('./EarnWindow'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });

const renderEarn = () => <EarnWindow />;
const closeEarn = () => useEarn.getState().close();

/**
 * Earn in the city (CITY-92), in the city's one window frame (CITY-65): closed until `NEXT_PUBLIC_RYNTRA_CITY_EARN`
 * says `open`. Any entry opens it with `openEarn(tab)` from `city/lib/earn/open` — the menu, the Harbor, the Helm's
 * «Earn» (CITY-89). A run owns the whole screen and a clip being filmed keeps the frame clean, unless a signature is
 * out, which always stays in view and which the frame holds open.
 */
export function EarnLayer() {
  if (!EARN_OPEN) return null;
  return <OpenEarn />;
}

function OpenEarn() {
  const open = useEarn((st) => st.open);
  const busy = useEarn((st) => st.busy);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const lang = useLang();

  useEffect(() => {
    if (open) startWallets();
  }, [open]);

  const shown = open && (!(running || filming) || busy);
  useEffect(() => {
    if (!shown) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      useEarn.getState().close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shown]);

  const spec = useMemo(
    () => ({
      id: 'earn',
      title: earnWords(lang).title,
      icon: <EarnGlyph />,
      render: renderEarn,
      size: { width: 680, height: 740 },
      min: { width: 380, height: 480 },
      held: busy,
      onClose: closeEarn,
    }),
    [busy, lang],
  );
  useCityWindow(shown, spec);
  return null;
}
