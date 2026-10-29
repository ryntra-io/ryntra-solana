'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { useScouts } from '@/city/lib/scouts/store';
import { startWallets, useWallet } from '@/city/lib/trade/wallet';
import { useCityWindow } from '../window/useCityWindow';
import { FlagGlyph } from './glyphs';
import s from './scouts.module.css';

// The window's contents load the first time it opens: the city's first frame carries none of them.
const ScoutsWindow = dynamic(() => import('./ScoutsWindow'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });

const renderScouts = () => <ScoutsWindow />;
const closeScouts = () => useScouts.getState().close();

/**
 * «Scouts» (CITY-8) in the city's one window frame (CITY-65): your link, the people you brought and your share, from
 * the Growth engine. Opened from the menu and from «Mine» (`openScouts`). It also keeps the wallet's scouts read once
 * the wallet is connected, so the flags on the towers your friends trade stand without the window open — a read only,
 * never a signature: a wallet that has not proved itself to Ryntra simply has no flags until it signs in here.
 */
export function ScoutsLayer() {
  const open = useScouts((st) => st.open);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();

  useEffect(() => {
    if (open) startWallets();
  }, [open]);

  // Another wallet, or none: the last one's figures and flags go; a connected one is read, quietly.
  useEffect(() => {
    useScouts.getState().reset();
    if (owner) void useScouts.getState().read(owner);
  }, [owner]);

  // Opening the window reads again when the last answer is old.
  useEffect(() => {
    if (open && owner) void useScouts.getState().read(owner);
  }, [open, owner]);

  const shown = open && !(running || filming);
  useEffect(() => {
    if (!shown) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      useScouts.getState().close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shown]);

  const spec = useMemo(
    () => ({
      id: 'scouts',
      title: 'Scouts',
      icon: <FlagGlyph />,
      render: renderScouts,
      size: { width: 440, height: 660 },
      min: { width: 360, height: 460 },
      onClose: closeScouts,
    }),
    [],
  );
  useCityWindow(shown, spec);
  return null;
}
