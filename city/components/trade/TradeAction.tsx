'use client';

import type { Tower } from '@/city/lib/market/types';
import { ticker } from '@/city/lib/trade/format';
import { TRADE_OPEN } from '@/city/lib/trade/gates';
import { useTrade } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';

/**
 * The tower card's one action: buy this coin, or trade it when the wallet already holds it. Trading from a tower is
 * open to everyone since a live signed buy and sell on production passed; `NEXT_PUBLIC_RYNTRA_CITY_TRADE=closed`
 * (`gates.ts`) puts the card back to its quiet "soon" without a code change.
 */
export function TradeAction({ tower, className }: { tower: Tower; className?: string }) {
  const openFor = useTrade((st) => st.openFor);
  const held = useWallet((st) => Boolean(st.holdings?.tokens.get(tower.id)));
  if (!TRADE_OPEN) {
    return (
      <button className={className} disabled>
        Trade · soon
      </button>
    );
  }
  return (
    <button className={className} onClick={() => openFor(tower)}>
      {held ? 'Trade' : 'Buy'} {ticker(tower.symbol)}
    </button>
  );
}
