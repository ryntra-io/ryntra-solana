'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatAmount, formatUsd, portfolioOf, readAge } from '@/city/lib/money/assets';
import { useMoney } from '@/city/lib/money/open';
import { useMoneyStore } from '@/city/lib/money/store';
import { CoinIcon, Refresh } from './bits';
import s from './money.module.css';

/** Read the balances again when the last read is older than this. */
const STALE_MS = 60_000;

/**
 * Portfolio: every coin the wallet holds, as the engine read it, worth what Ryntra's catalogue prices it at, and the
 * sum. A coin without a price is listed and left out of the sum, and the window says so; a read by halves says the
 * list may be short.
 */
export function Portfolio() {
  const wallet = useMoneyStore((st) => st.wallet);
  const walletRead = useMoneyStore((st) => st.walletRead);
  const portfolio = useMemo(() => (wallet ? portfolioOf(wallet.assets) : null), [wallet]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const at = useMoneyStore.getState().wallet?.at;
    if (at && Date.now() - at > STALE_MS) useMoneyStore.getState().readWallet();
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  if (!wallet || !portfolio) {
    return walletRead === 'failed' ? (
      <p className={s.empty}>
        Your balances are unavailable right now.{' '}
        <button type="button" className={s.link} onClick={() => useMoneyStore.getState().readWallet()}>
          Try again
        </button>
      </p>
    ) : (
      <div className={s.bones} aria-label="Reading your wallet">
        <span />
        <span />
        <span />
      </div>
    );
  }

  return (
    <section className={s.tabBody} aria-label="Portfolio">
      <div className={s.bar}>
        <div className={s.total}>
          <span className={`${s.display} ${s.kicker}`}>Total</span>
          <b className={`${s.display} ${s.figure}`}>{formatUsd(portfolio.totalUsd)}</b>
        </div>
        <Refresh onClick={() => useMoneyStore.getState().readWallet()} title={`Read ${readAge(wallet.at, now)}`} />
      </div>
      <div className={s.quick}>
        <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoney.getState().setTab('topup')}>
          Top up
        </button>
        <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoney.getState().setTab('send')}>
          Send
        </button>
      </div>
      <ul className={s.rows}>
        {portfolio.rows.map((row) => (
          <li key={row.asset.id} className={s.row}>
            <CoinIcon mint={row.asset.mint} />
            <span className={s.names}>
              <b>{row.asset.symbol}</b>
              <span>{row.asset.name ?? (row.asset.verified ? '' : 'Not verified')}</span>
            </span>
            <span className={s.figures}>
              <b>{formatUsd(row.valueUsd)}</b>
              <span>
                {formatAmount(row.asset.amountRaw, row.asset.decimals)} {row.asset.symbol}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {!wallet.complete ? <p className={s.note}>Some coins could not be read.</p> : null}
      {portfolio.unpriced > 0 ? <p className={s.note}>{portfolio.unpriced} without a price · not in the total</p> : null}
    </section>
  );
}
