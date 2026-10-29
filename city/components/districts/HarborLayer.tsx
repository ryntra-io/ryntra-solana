'use client';

import { useEffect } from 'react';
import { useCity } from '@/city/lib/city/store';
import { HARBOR_OPEN } from '@/city/lib/districts/harbor/flag';
import { useQuarter } from '@/city/lib/quarter/store';
import { BUSY, keyOf, ownHoldings, setHarborEnv, useHarbor } from '@/city/lib/districts/harbor/store';
import { useRun } from '@/city/lib/run/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { HarborSheet } from './HarborSheet';
import s from './harbor.module.css';

/** A wallet is here and the engine admits the add: the exact Review follows after this pause, once per choice. */
const AUTO_REVIEW_MS = 450;
/** The positions are read again this often while the Harbor is open. */
const POSITIONS_MS = 60_000;

/**
 * The Harbor in the city: closed for people until the flag says `open`. Open, it reads what the connected wallet may
 * do and its positions (which light their towers), builds the exact Review of the card's amount while the person reads
 * it, and stands over the HUD while it is open.
 */
export function HarborLayer() {
  if (!HARBOR_OPEN) return null;
  return <OpenHarbor />;
}

function OpenHarbor() {
  const open = useHarbor((st) => st.open);
  const view = useHarbor((st) => st.view);
  const pool = useHarbor((st) => st.pool);
  const tile = useHarbor((st) => st.tile);
  const phase = useHarbor((st) => st.phase);
  const reviewed = useHarbor((st) => st.reviewed);
  const notice = useHarbor((st) => st.notice);
  const target = useHarbor((st) => st.target);
  const states = useHarbor((st) => st.states);
  const connection = useWallet((st) => st.connection);
  const address = connection?.address ?? null;
  const running = useRun((st) => st.phase !== 'off');
  const building = useQuarter((st) => st.mode !== 'city');

  useEffect(() => setHarborEnv({ refreshHoldings: (delays) => useWallet.getState().refreshHoldings(delays) }), []);

  // Another wallet: what the last one could do and held is not this one's.
  useEffect(() => {
    useHarbor.getState().forget();
    if (!address) return;
    void useHarbor.getState().loadStates(address);
    void useHarbor.getState().loadPositions(address);
  }, [address]);

  // While the Harbor is open, the positions stay a recent read.
  useEffect(() => {
    if (!open || !address) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !BUSY.has(useHarbor.getState().phase)) void useHarbor.getState().loadPositions(address);
    }, POSITIONS_MS);
    return () => clearInterval(timer);
  }, [open, address]);

  // With a wallet the engine admits, the exact Review of the card's amount is built while the person reads the card.
  const addOn = Boolean(address && states?.owner === address && states.value.add.status === 'on');
  useEffect(() => {
    if (!open || view !== 'add' || !pool || !connection || !addOn || phase !== 'idle' || notice) return;
    if (target?.kind !== 'add') return;
    if (reviewed?.key === keyOf(connection.address, target, pool, tile)) return;
    // Only the coins read for this wallet: another wallet's balances never size a Review.
    const timer = setTimeout(() => void useHarbor.getState().prepare(connection, target, ownHoldings(connection, useWallet.getState().holdings)), AUTO_REVIEW_MS);
    return () => clearTimeout(timer);
  }, [open, view, pool, tile, connection, addOn, phase, reviewed, notice, target]);

  // The Harbor and a tower card never stand together: opening one lets the other go, unless an action is mid-way.
  useEffect(() => {
    if (open) useCity.getState().select(null);
  }, [open]);
  useEffect(
    () =>
      useCity.subscribe((city, before) => {
        if (city.selectedId && city.selectedId !== before.selectedId) useHarbor.getState().hide();
      }),
    [],
  );

  // Escape closes the Harbor, never under a signature (`hide` holds only while the wallet signs or bytes go out).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useHarbor.getState().hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // A run or building your quarter owns the screen, unless an action is mid-way.
  if (!open || ((running || building) && !BUSY.has(phase))) return null;
  return (
    <div className={s.layer}>
      <HarborSheet />
    </div>
  );
}
