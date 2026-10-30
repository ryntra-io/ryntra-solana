'use client';

import { useEffect } from 'react';
import { phoenixHolds } from '@/city/lib/exchange/account';
import { EXCHANGE_SHOWN } from '@/city/lib/exchange/flag';
import { DEFAULT_SYMBOL, useExchange } from '@/city/lib/exchange/store';
import { useWords } from '@/city/lib/i18n/dict';
import { formatUsd } from '@/city/lib/money/assets';
import { useMoney } from '@/city/lib/money/open';
import { useWallet } from '@/city/lib/trade/wallet';
import { MONEY } from './words';
import s from './money.module.css';

/**
 * Futures are off: a wallet that still holds something on Phoenix — a position,
 * an order or collateral — sees one quiet row in Money, and one tap opens the Exchange in closing-out only: cut, close,
 * cancel, withdraw. Nothing for a wallet with nothing there, and nothing where the Exchange is shut.
 */
export function PhoenixLeft() {
  const w = useWords(MONEY);
  const address = useWallet((st) => st.connection?.address ?? null);
  const account = useExchange((st) => (address && st.owner === address && st.account.value?.wallet === address ? st.account.value : null));
  useEffect(() => {
    if (!EXCHANGE_SHOWN || !address) return;
    useExchange.getState().follow(address);
    void useExchange.getState().loadAccount();
  }, [address]);
  if (!EXCHANGE_SHOWN || !account || !phoenixHolds(account)) return null;
  return (
    <button
      type="button"
      className={s.phoenixLeft}
      data-phoenix-left=""
      onClick={() => {
        useMoney.getState().close();
        useExchange.getState().show(DEFAULT_SYMBOL);
      }}
    >
      <span>
        <b>{w.phoenixLeft}</b>
        <span>{formatUsd(account.collateralUsd ?? null)}</span>
      </span>
      <span className={s.phoenixOut}>{w.phoenixOut}</span>
    </button>
  );
}
