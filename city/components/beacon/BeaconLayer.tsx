'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { subscribeWalletFact, unknownWalletFact, walletFact } from '@/lib/account/wallet-proof-store.client';
import { refreshGlow, useBeacons } from '@/city/lib/beacon/store';
import { BEACONS } from '@/city/lib/beacon/switch';
import { useCity } from '@/city/lib/city/store';
import { useRun } from '@/city/lib/run/store';
import { BeaconSheet } from './BeaconSheet';
import s from './beacon.module.css';

/** A lit beacon fades back to its quiet mark without a new read. */
const GLOW_REFRESH_MS = 60_000;

/**
 * Beacons in the city (CITY-72): the device's beacons load at once, the account's follow a wallet sign-in, every
 * market read of the city checks them, and the editor stands over the tower card while it is open. A run owns the
 * whole screen. Escape closes the editor before anything else.
 */
export function BeaconLayer() {
  return BEACONS === 'closed' ? null : <BeaconLayerOpen />;
}

function BeaconLayerOpen() {
  const openFor = useBeacons((st) => st.openFor);
  const snapshot = useCity((st) => st.snapshot);
  const selectedId = useCity((st) => st.selectedId);
  const running = useRun((st) => st.phase !== 'off');
  const signedIn = useSyncExternalStore(subscribeWalletFact, () => walletFact().signedIn, () => unknownWalletFact().signedIn);
  const tower = useMemo(() => (openFor ? (snapshot.towers.find((t) => t.id === openFor) ?? null) : null), [openFor, snapshot]);

  useEffect(() => useBeacons.getState().load(), []);

  // The account's beacons after a sign-in, and again when the tab comes back (Telegram may have been connected).
  useEffect(() => {
    void useBeacons.getState().pull(signedIn);
    if (!signedIn) return;
    const again = () => {
      if (document.visibilityState === 'visible') void useBeacons.getState().pull(true);
    };
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [signedIn]);

  // Every market read the city makes checks every beacon.
  useEffect(() => useBeacons.getState().check(snapshot), [snapshot]);

  useEffect(() => {
    const timer = setInterval(refreshGlow, GLOW_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  // Another tower picked, or the card closed: the editor goes with it.
  useEffect(() => {
    if (openFor && selectedId !== openFor) useBeacons.getState().close();
  }, [selectedId, openFor]);

  // Escape closes the editor first; the tower card stays.
  useEffect(() => {
    if (!openFor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      useBeacons.getState().close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [openFor]);

  if (!tower || running) return null;
  return (
    <div className={s.layer}>
      <BeaconSheet key={tower.id} tower={tower} />
    </div>
  );
}
