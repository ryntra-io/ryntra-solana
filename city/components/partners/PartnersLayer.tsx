'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { devAskOf } from '@/city/lib/partners/landing';
import { usePartners } from '@/city/lib/partners/store';
import { useRun } from '@/city/lib/run/store';
import { startWallets, useWallet } from '@/city/lib/trade/wallet';
import { useCityWindow } from '../window/useCityWindow';
import { PartnersGlyph } from './glyphs';
import s from './partners.module.css';
import { PARTNERS } from './words';

// The window's contents load the first time it opens: the city's first frame carries none of them.
const PartnersWindow = dynamic(() => import('./PartnersWindow'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });
const Landing = dynamic(() => import('./Landing'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });

const renderPartners = () => <PartnersWindow />;
const renderLanding = () => <Landing />;
const closePartners = () => usePartners.getState().close();
const closeLanding = () => usePartners.getState().enter();

/**
 * «Ryntra Partners» (CITY-126, CITY-127) in the city's one window frame: the partner page and «Мій район», opened from
 * the menu and from «Scouts»; and the friend's landing, which greets a browser that carries an invitation. A connected
 * wallet that carries one is read by the engine on its proven read, which binds it — never a signature asked for here.
 */
export function PartnersLayer() {
  const open = usePartners((st) => st.open);
  const landing = usePartners((st) => st.landing);
  const w = useWords(PARTNERS);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();

  // Once: the development asks (`?partners=`), and the friend's greeting.
  useEffect(() => {
    const ask = process.env.NODE_ENV === 'production' ? { open: null, demo: false } : devAskOf(window.location.search);
    usePartners.getState().setup({ demo: ask.demo });
    if (ask.open === 'landing') void usePartners.getState().greet(true);
    else if (ask.open === 'district') usePartners.getState().show({ district: true });
    else if (ask.open) usePartners.getState().show({ tab: ask.open, district: false });
    else void usePartners.getState().greet();
  }, []);

  useEffect(() => {
    if (open) startWallets();
  }, [open]);

  // Another wallet, or none: the last one's figures go.
  useEffect(() => {
    usePartners.getState().reset();
  }, [owner]);

  // A connected wallet with an invitation in this browser: the engine's proven read binds it (no prompt here).
  const invited = usePartners((st) => st.invitation !== null);
  useEffect(() => {
    if (owner && invited) void usePartners.getState().bind(owner);
  }, [owner, invited]);

  const shown = open && !(running || filming);
  const greeting = landing && !open && !(running || filming);
  useEffect(() => {
    if (!shown && !greeting) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (shown) usePartners.getState().close();
      else usePartners.getState().enter();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shown, greeting]);

  const spec = useMemo(
    // A new language is a new title: the open window's head follows it.
    () => ({ id: 'partners', title: w.title, icon: <PartnersGlyph />, render: renderPartners, size: { width: 520, height: 760 }, min: { width: 360, height: 480 }, onClose: closePartners }),
    [w.title],
  );
  const landingSpec = useMemo(
    () => ({ id: 'partners-landing', title: w.kicker, icon: <PartnersGlyph />, render: renderLanding, size: { width: 440, height: 600 }, min: { width: 340, height: 460 }, onClose: closeLanding }),
    [w.kicker],
  );
  useCityWindow(shown, spec);
  useCityWindow(greeting, landingSpec);
  return null;
}
