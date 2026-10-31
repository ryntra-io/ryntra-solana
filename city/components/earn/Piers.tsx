'use client';

import { HARBOR_OPEN } from '@/city/lib/districts/harbor/flag';
import { usd, VENUE_NAME, type HarborPool } from '@/city/lib/districts/harbor/pools';
import { ownHoldings, useHarbor } from '@/city/lib/districts/harbor/store';
import { closeEarn } from '@/city/lib/earn/open';
import { useEarnData } from '@/city/lib/earn/store';
import type { Words } from '@/city/lib/earn/words';
import { useWallet } from '@/city/lib/trade/wallet';
import { Coin, Line, Notify } from './bits';
import s from './earn.module.css';

/**
 * The Piers, thin for now (the full rework is CITY-93): the Harbor's own pools read-only, in the window's style. Where
 * the Harbor's switch is open, «Add liquidity» opens the Harbor's own flow on that pool — its Review, its signature;
 * where it is closed, the one switch «tell me when it opens».
 */
export function Piers({ words }: { words: Words }) {
  const w = words.piers;
  const piers = useEarnData((st) => st.piers);
  const holdings = useWallet((st) => ownHoldings(st.connection, st.holdings));

  const add = (pool: HarborPool) => {
    closeEarn();
    const harbor = useHarbor.getState();
    harbor.show();
    harbor.choose(pool, holdings);
  };

  if (piers.status === 'error') {
    return (
      <section className={s.tabBody}>
        <p className={s.empty}>{words.unavailable}</p>
        <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => void useEarnData.getState().loadPiers()}>
          {words.tryAgain}
        </button>
      </section>
    );
  }
  if (piers.status !== 'ready') {
    return (
      <div className={s.bones} aria-busy="true">
        <span />
        <span />
        <span />
      </div>
    );
  }
  const pools = piers.value.pools;
  return (
    <section className={s.tabBody} aria-label={words.tabs.piers}>
      {!pools.length ? <p className={s.empty}>{w.empty}</p> : null}
      <ul className={s.rows}>
        {pools.map((pool) => (
          <li key={pool.address} className={s.pierRow}>
            <span className={s.pierCoins} aria-hidden="true">
              <Coin mint={pool.x.mint} size={26} />
              <Coin mint={pool.y.mint} size={26} />
            </span>
            <span className={s.names}>
              <b>{pool.pair}</b>
              <span>
                {VENUE_NAME[pool.kind]} · {w.liquidity} {usd(pool.tvlUsd)}
              </span>
            </span>
            <span className={s.figures}>
              <b>{usd(pool.lpFees24hUsd)}</b>
              <span>{w.fees24h}</span>
            </span>
            {HARBOR_OPEN ? (
              <button type="button" className={`${s.display} ${s.secondary} ${s.pierAdd}`} onClick={() => add(pool)}>
                {w.add}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <Line label={words.details} line={w.read}>
        <p className={s.fine}>{w.fine}</p>
      </Line>
      {HARBOR_OPEN ? null : <Notify product="pier" words={words} />}
    </section>
  );
}
