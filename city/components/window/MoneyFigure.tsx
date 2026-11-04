'use client';

import { formatUsd, portfolioOf } from '@/city/lib/money/assets';
import { useMoneyStore } from '@/city/lib/money/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { FRESH_MS } from './fresh';
import s from './window.module.css';

/**
 * Money's chip in the tray (CITY-84): what the wallet's priced coins are worth, from the window's own read — only a
 * whole, recent read of the wallet connected now: a chain that answered by halves, an old read or another wallet's
 * gives the title instead.
 */
export default function MoneyFigure({ title }: { title: string }) {
  const address = useWallet((st) => st.connection?.address ?? null);
  const total = useMoneyStore((st) =>
    st.wallet?.complete && st.wallet.owner === address && Date.now() - st.wallet.at <= FRESH_MS ? portfolioOf(st.wallet.assets).totalUsd : null,
  );
  return total === null ? <span className={s.chipTitle}>{title}</span> : <span className={s.chipValue}>{formatUsd(total)}</span>;
}
