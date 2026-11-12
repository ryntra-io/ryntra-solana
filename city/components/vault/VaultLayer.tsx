'use client';

import { useEffect } from 'react';
import { subscribeWalletFact, walletFact } from '@/lib/account/wallet-proof-store.client';
import { useCity } from '@/city/lib/city/store';
import { quarterStore } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';
import { VAULT_OPEN } from '@/city/lib/vault/flag';
import { useVault, vaultStore } from '@/city/lib/vault/store';
import { VaultRoom } from './VaultRoom';

/** The feed is read again this often while the room is open. */
const FEED_MS = 6_000;

/**
 * The Vault's room over the city, once its flag is open. It closes with Escape, and gives way when the city takes the
 * screen for something else: a tower picked, a run, my quarter. While it is open the feed stays live, and a sign-in or
 * a sign-out reads the vaults again under the person now in the chair (a guest's cracks go with them to the wallet).
 */
export function VaultLayer() {
  if (!VAULT_OPEN) return null;
  return <Layer />;
}

function Layer() {
  const open = useVault((st) => st.open);
  const running = useRun((st) => st.phase !== 'off');

  useEffect(() => {
    if (!open) return;
    const leave = () => vaultStore.getState().leave();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) leave();
    };
    window.addEventListener('keydown', onKey);
    const offCity = useCity.subscribe((st, before) => {
      if (st.selectedId && st.selectedId !== before.selectedId) leave();
    });
    const offQuarter = quarterStore.subscribe((st) => {
      if (st.mode !== 'city') leave();
    });
    const feed = setInterval(() => void vaultStore.getState().readFeed(), FEED_MS);
    const who = () => {
      const fact = walletFact();
      return fact.status === 'known' ? `${fact.signedIn}:${fact.walletAddress ?? ''}` : null;
    };
    let seen = who();
    const offAccount = subscribeWalletFact(() => {
      const now = who();
      if (now === null || now === seen) return;
      seen = now;
      void vaultStore.getState().refresh();
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      offCity();
      offQuarter();
      offAccount();
      clearInterval(feed);
    };
  }, [open]);

  useEffect(() => {
    if (running) vaultStore.getState().leave();
  }, [running]);

  if (!open || running) return null;
  return <VaultRoom />;
}
