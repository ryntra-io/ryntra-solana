'use client';

import { useEffect, useMemo } from 'react';
import type { PositionView } from '@/lib/liquidity/catalog/positions';
import { formatPrice } from '@/city/lib/districts/harbor/pools';
import { depthSol, feesSol24h, pierOf, solPiers, solShort, solUsd } from '@/city/lib/earn/pier';
import { PIER_MODE } from '@/city/lib/earn/pier-gate';
import { usePier } from '@/city/lib/earn/pier-store';
import { useEarnData } from '@/city/lib/earn/store';
import type { Words } from '@/city/lib/earn/words';
import type { PierRow } from '@/city/lib/earn/mine';
import { digits } from '@/city/lib/i18n/dict';
import { useWallet } from '@/city/lib/trade/wallet';
import { Boat, BoatCard } from './Boat';
import { Coin, Line, Notify } from './bits';
import { PierCard } from './PierCard';
import s from './earn.module.css';

/** Positions are read again this often while the Piers are on screen. */
const POSITIONS_MS = 60_000;

/**
 * The Piers (CITY-93): the Harbor inside the Earn window. Your positions moored as boats — lit while they earn, dim
 * out of range — and the SOL piers, Meteora DLMM pools of SOL against an LST or USDC, with what they paid in a day in
 * SOL. A tap opens the pier's card (amount, style, the month gone, one line, one signature) or the boat's.
 */
export function Piers({ words, owner, piers: rows }: { words: Words; owner: string | null; piers: readonly PierRow[] }) {
  const w = words.pier;
  const list = useEarnData((st) => st.piers);
  const positions = useEarnData((st) => st.positions);
  const pool = usePier((st) => st.pool);
  const boat = usePier((st) => st.boat);
  // A copy of «Like the Captain» stands on the Shelf; here the Piers stay a list.
  const copying = usePier((st) => st.copy !== null);
  const states = usePier((st) => st.states);
  const connection = useWallet((st) => st.connection);

  // Another wallet: what the last one could do is not this one's; what this one may do is asked once the Harbor is
  // not closed in this build.
  useEffect(() => {
    usePier.getState().forget();
    if (owner && PIER_MODE !== 'closed') void usePier.getState().loadStates(owner);
  }, [owner]);
  useEffect(() => {
    if (!owner) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && usePier.getState().phase === 'idle') void useEarnData.getState().loadPositions(owner);
    }, POSITIONS_MS);
    return () => clearInterval(timer);
  }, [owner]);

  const piers = useMemo(() => (list.status === 'ready' ? solPiers(list.value.pools) : []), [list]);
  const views: readonly PositionView[] = positions && positions.owner === owner && positions.value.status === 'ready' ? positions.value.value : [];

  if (pool && pierOf(pool) && !copying) return <PierCard words={words} pier={pierOf(pool)!} />;
  if (boat) return <BoatCard words={words} view={boat} row={rows.find((r) => r.address === boat.address) ?? null} />;

  if (list.status === 'error') {
    return (
      <section className={s.tabBody}>
        <p className={s.empty}>{words.unavailable}</p>
        <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => void useEarnData.getState().loadPiers()}>
          {words.tryAgain}
        </button>
      </section>
    );
  }
  if (list.status !== 'ready') {
    return (
      <div className={s.bones} aria-busy="true">
        <span />
        <span />
        <span />
      </div>
    );
  }
  const stopped = Boolean(connection && states?.owner === connection.address && states.value.stopped);
  return (
    <section className={s.tabBody} aria-label={words.tabs.piers}>
      {views.length ? (
        <div className={s.dock}>
          <span className={s.kicker}>{w.boats}</span>
          <ul className={s.boats}>
            {views.map((view) => {
              const row = rows.find((r) => r.address === view.address) ?? null;
              const lit = view.rangeState === 'in_range';
              return (
                <li key={view.address}>
                  <button type="button" className={`${s.boatTile} ${lit ? s.boatLit : ''}`} onClick={() => usePier.getState().openBoat(view)} aria-label={`${view.name} · ${lit ? w.inRange : w.outOfRange}`}>
                    <Boat lit={lit} size={72} />
                    <b>{view.name}</b>
                    {row?.feesLamports != null && row.feesLamports > 0n ? <span className={s.gain}>+{digits(solShort(row.feesLamports))} SOL</span> : <span>{lit ? w.inRange : w.outOfRange}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {stopped ? <p className={`${s.note} ${s.noteWarn}`}>{w.stopped}</p> : null}
      <span className={s.kicker}>{w.piers}</span>
      {!piers.length ? <p className={s.empty}>{words.piers.empty}</p> : null}
      <ul className={s.rows}>
        {piers.map((pier) => {
          const fees = feesSol24h(pier);
          const depth = depthSol(pier);
          return (
            <li key={pier.pool.address}>
              <button type="button" className={`${s.pierRow} ${s.pierHit}`} onClick={() => usePier.getState().openPier(pier.pool)}>
                <span className={s.pierCoins} aria-hidden="true">
                  <Coin mint={pier.other.mint} size={28} symbol={pier.other.symbol} />
                  <Coin mint={pier.sol.mint} size={28} symbol="SOL" />
                </span>
                <span className={s.names}>
                  <b>{pier.lst ? `${pier.lst.symbol} · SOL` : `SOL · ${pier.other.symbol}`}</b>
                  <span>
                    {w.depth} {depth !== null ? `${digits(compact(depth))} SOL` : '—'}
                    {pier.pool.feePct !== null ? ` · ${w.tradeFee} ${digits(`${Number(pier.pool.feePct.toFixed(3))}%`)}` : ''}
                  </span>
                </span>
                <span className={s.figures}>
                  <b className={s.gain}>{fees !== null ? `${digits(solShort(fees))}` : '—'}</b>
                  <span>{w.fees24h} · SOL</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Line label={words.details} line={words.piers.read}>
        <p className={s.fine}>{w.fine}</p>
        {piers[0] && solUsd(piers[0]) !== null ? <p className={s.fine}>SOL ${formatPrice(solUsd(piers[0])!)}</p> : null}
      </Line>
      {PIER_MODE === 'open' ? null : <Notify product="pier" words={words} />}
    </section>
  );
}

/** A depth in SOL, short: 23.9K, 1.2M. */
function compact(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e4) return `${Math.round(value / 1e3)}K`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}
