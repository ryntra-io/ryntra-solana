'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useCity } from '@/city/lib/city/store';
import { launchOpenHere, launchTowerIn, startDistrict, useLaunch } from '@/city/lib/launch/district';
import { LaunchTowerCard } from './LaunchTowerCard';
import s from './launch.module.css';

/* The sheet and its wallet code load on the first tap of Launch, never with the city's first frame. */
const LaunchSheet = dynamic(() => import('./LaunchSheet').then((m) => m.LaunchSheet), {
  ssr: false,
  loading: () => <div className={`${s.sheet} ${s.sheetLoading}`} aria-busy="true" />,
});

/**
 * The Launch district for the HUD: whether the dock's Launch opens here, whether the district owns the card slot now —
 * its sheet is open, or a launch's tower is picked — and the tap that opens it.
 */
export function useLaunchDistrict(): Readonly<{ open: boolean; showing: boolean; start: () => void }> {
  useEffect(() => startDistrict(), []);
  const open = useLaunch(launchOpenHere);
  const sheet = useLaunch((st) => st.sheet);
  const selectedId = useCity((st) => st.selectedId);
  const picked = useLaunch((st) => launchTowerIn(st, selectedId) !== null);
  return { open, showing: sheet || picked, start: useLaunch.getState().openSheet };
}

/** What the district shows in the card slot: its sheet, or the card of the launch tower that is picked. */
export function LaunchSlot() {
  const sheet = useLaunch((st) => st.sheet);
  const selectedId = useCity((st) => st.selectedId);
  if (sheet) return <LaunchSheet />;
  return selectedId ? <LaunchTowerCard token={selectedId} /> : null;
}
