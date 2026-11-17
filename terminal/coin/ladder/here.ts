'use client';

import { useEffect, useRef } from 'react';
import { LADDER_OPEN, takeLadderAsk, useLadder } from '@/city/lib/trade/pro-store';
import type { Market } from '@/city/lib/trade/pro-ladder';
import { useWallet } from '@/city/lib/trade/wallet';
export { setLimitTab, useLimitTab } from './tab';

/**
 * The ticket's Limit tab on the coin's ladders (`city/lib/trade/pro-store.ts`, the engine's DLMM Pro orders): the coin's
 * market is read once the ticket shows it, and the wallet's orders follow the wallet. Nothing here asks the wallet for
 * anything. Whether the tab is on — `tab.ts`.
 */

/**
 * The coin's ladder market, read for a ticket that offers limits: null where ladders are shut here, the coin has no
 * pool for one, or the read has not come yet. `coin` null — the ticket offers none, and nothing is read.
 */
export function useLadderHere(coin: Readonly<{ mint: string; symbol: string }> | null): Market | null {
  const mint = coin?.mint ?? null;
  const symbol = coin?.symbol ?? '';
  useEffect(() => {
    if (!LADDER_OPEN || !mint) return;
    useLadder.getState().open({ mint, symbol }, takeLadderAsk(mint));
  }, [mint, symbol]);
  const market = useLadder((st) => (mint && st.mint === mint && st.market.status === 'ready' ? st.market.value : null));
  // The wallet's orders of the coin: read with the market (`open`), and again for another wallet.
  const owner = useWallet((st) => st.connection?.address ?? null);
  // A screen that comes back to a coin already open reads them again too: the wallet may have changed meanwhile.
  const reader = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (reader.current !== undefined && reader.current === owner) return;
    reader.current = owner;
    const state = useLadder.getState();
    if (mint && state.mint === mint && state.market.status === 'ready' && state.market.value) void state.loadOrders();
  }, [owner, mint]);
  return LADDER_OPEN ? market : null;
}
