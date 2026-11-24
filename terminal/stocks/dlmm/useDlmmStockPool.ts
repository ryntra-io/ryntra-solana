'use client';

import { useEffect } from 'react';
import { useWallet } from '@/city/lib/trade/wallet';
import type { DlmmStockRead } from '@/lib/earn-dlmm/stocks';
import { DLMM_STOCKS_SCREEN, stockTicketShown } from './flag';
import { useDlmmStock } from './store';

/**
 * The stock's read of a DLMM pool for the connected wallet, when the terminal offers it: the read that
 * stands the ticket in the pool's «Position» tab, or null — the switch off, another venue, not a stock's pool, or not read
 * yet. `waiting` — the read is under way, so the tab holds a quiet box rather than a «soon» that would jump away.
 */
export function useDlmmStockPool(pool: Readonly<{ venue: string; address: string }>): Readonly<{ read: DlmmStockRead | null; waiting: boolean }> {
  const owner = useWallet((st) => st.connection?.address ?? null);
  const on = DLMM_STOCKS_SCREEN !== 'off' && pool.venue === 'dlmm';
  const state = useDlmmStock((st) => st.read);
  useEffect(() => {
    if (on) void useDlmmStock.getState().load(pool.address, owner);
  }, [on, pool.address, owner]);
  if (!on) return { read: null, waiting: false };
  const mine = state.status !== 'idle' && state.pool === pool.address && state.owner === owner;
  const read = mine && state.status === 'ready' ? state.value : null;
  return { read: stockTicketShown(DLMM_STOCKS_SCREEN, read) ? read : null, waiting: !mine || state.status === 'loading' };
}
