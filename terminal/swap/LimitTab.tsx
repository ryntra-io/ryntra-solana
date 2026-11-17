'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useTrade } from '@/city/lib/trade/store';
import { Ticket } from '@/terminal/coin/Ticket';
import { coinHref } from '@/terminal/shell/shelves';
import { useSwapScreen } from './state';

/**
 * The Swap screen's Limit tab: the coin ticket's own limit — Jupiter's, as the coin's page has it — drawn into
 * the card, one order type, on the side the swap left. A placed order stands with the coin's other orders on the coin's
 * own page: «My orders» opens it — a press the person makes after placing one, never a tab that leaves the screen.
 */
export function LimitTab({ onTopUp }: { onTopUp?: () => void }) {
  const coin = useSwapScreen((st) => st.limit);
  const side = useSwapScreen((st) => st.limitSide);
  const router = useRouter();
  useLimitPay(coin.id);
  return <Ticket coin={coin} side={side} only="limit" framed={false} onTopUp={onTopUp} onOrders={() => router.push(`${coinHref(coin.id, 'live')}#orders`)} />;
}

/**
 * What pays on the limit — the swap's other coin — written once the card stands on the limit's coin, through the card's
 * own setter, as the person's tap would; then the card's choice is the person's.
 */
function useLimitPay(mint: string): void {
  useEffect(() => {
    const put = (): boolean => {
      const pay = useSwapScreen.getState().limitPay;
      if (!pay) return true;
      const card = useTrade.getState();
      if (!card.open || card.view === 'swap' || card.tower?.mint !== mint || card.phase !== 'idle' || card.held) return false;
      useSwapScreen.setState({ limitPay: null });
      if (card.pay !== pay) card.setPay(pay);
      return true;
    };
    if (put()) return;
    const off = useTrade.subscribe(() => {
      if (put()) off();
    });
    return off;
  }, [mint]);
}
