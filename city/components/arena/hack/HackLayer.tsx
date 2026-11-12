'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef } from 'react';
import { HACK_OPEN } from '@/city/lib/arena/hack/view/flag';
import { hackStore, useHack } from '@/city/lib/arena/hack/view/live';
import { HACK } from '@/city/lib/arena/hack/words';
import { useWords } from '@/city/lib/i18n/dict';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { HackGlyph } from '../../deck/glyphs';
import { useCityWindow } from '../../window/useCityWindow';
import s from './hack.module.css';

// The window's contents load the first time it opens: the city's first frame carries none of Hack.
const HackWindow = dynamic(() => import('./HackWindow'), { ssr: false, loading: () => <div className={s.pendingWindow} aria-busy="true" /> });

const renderHack = () => <HackWindow />;
const closeHack = () => hackStore.getState().close();

/**
 * The Arena's third door, Hack (CITY-227), in the city's one window frame (CITY-65): the Arena's «Hack» door opens it.
 * Only where the deployment's switch is open (`HACK_OPEN`); otherwise nothing mounts and the door is not shown. A run
 * owns the whole screen and a clip being filmed keeps the frame clean.
 */
export function HackLayer() {
  return HACK_OPEN ? <Hack /> : null;
}

function Hack() {
  const open = useHack((st) => st.open);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const h = useWords(HACK);
  const title = h.hack;
  const shown = open && !(running || filming);

  // Whose order is whose: the wallet on screen — and nobody's once the wallet is gone, so no «your order» stays behind.
  const address = useWallet((st) => st.connection?.address ?? null);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (address) hackStore.getState().setMe(address);
    else if (seen.current) hackStore.getState().setMe(null);
    seen.current = address;
  }, [address]);

  // Escape closes the window unless something heard it first (the whole screen given back, another window's own key).
  useEffect(() => {
    if (!shown) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      hackStore.getState().close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shown]);

  const spec = useMemo(
    () => ({ id: 'hack', title, icon: <HackGlyph />, render: renderHack, size: { width: 600, height: 760 }, min: { width: 380, height: 520 }, onClose: closeHack }),
    // A new language is a new title: the open window's head follows it.
    [title],
  );
  useCityWindow(shown, spec);
  return null;
}
