'use client';

import { useEffect, useMemo } from 'react';
import { useProPier } from '@/city/lib/earn/pro-store';
import { rangeMark } from '@/city/lib/earn/pier';
import { useEarnData } from '@/city/lib/earn/store';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { ledgersOf, useLedgerTurn, watchLedger } from '@/terminal/earn/ledger';
import { dayText, ResultFacts } from '@/terminal/earn/ResultFacts';
import { lamportsUsd, proPositionRow, resultTone, sumText } from '@/terminal/earn/rows';
import { EARN } from '@/terminal/earn/words';
import { Info } from '@/terminal/ui';
import type { DeskPool } from './desk-pool';
import { mineEntryOfPro, mineEntryOfView, type MineEntry } from './mine';
import { POOL } from './words';
import e from '@/terminal/earn/earn.module.css';
import p from './pool.module.css';

/**
 * The person's own positions in this pool, read once for the page: a DLMM Pro position from the engine's
 * piers (`useProPier`), a DLMM or DAMM v2 position from the wallet's positions (`/api/liquidity/positions`). The card over
 * the ticket says them, and «Liquidity by price» draws their ranges. Nothing without a wallet or a position here.
 */
export function useMineHere(pool: DeskPool, solUsd: number | null): readonly MineEntry[] {
  const owner = useWallet((st) => st.connection?.address ?? null);
  const list = useProPier((st) => st.list);
  const boatsFor = useProPier((st) => st.boats);
  const positions = useEarnData((st) => st.positions);
  const turn = useLedgerTurn();
  const pro = pool.venue === 'pro';
  useEffect(() => watchLedger(), []);
  const listReady = list.status === 'ready';
  useEffect(() => {
    if (!owner) return;
    if (pro && listReady) void useProPier.getState().loadBoats(owner);
    if (!pro) void useEarnData.getState().loadPositions(owner);
  }, [owner, pro, listReady]);
  return useMemo(() => {
    if (!owner) return [];
    if (pro) {
      if (list.status !== 'ready' || boatsFor?.owner !== owner || boatsFor.value.status !== 'ready') return [];
      const pier = list.value.piers.find((entry) => entry.address === pool.address);
      if (!pier) return [];
      const ledgers = ledgersOf(owner);
      return boatsFor.value.value
        .filter((boat) => boat.pool === pool.address && !boat.empty)
        .map((boat) => {
          const ledger = ledgers.get(boat.nftMint) ?? null;
          return mineEntryOfPro(boat, proPositionRow(boat, pier, solUsd, ledger), ledger, (lamports) => lamportsUsd(lamports, solUsd), rangeMark);
        });
    }
    if (positions?.owner !== owner || positions.value.status !== 'ready') return [];
    return positions.value.value.filter((view) => view.pool === pool.address).map((view) => mineEntryOfView(view, rangeMark));
    // `turn` — an entry moved on this device: the result is read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, pro, list, boatsFor, positions, pool.address, solUsd, turn]);
}

/**
 * The person's own positions in this pool, over the pool's ticket: in range or not, what each is worth now and the fees
 * it holds to collect; a DLMM Pro position opened here — its result against holding (what went in, the fees, the price's
 * move, the costs) and its history behind «i», as this device saw it. Nothing at all without one: the ticket below is the
 * way in.
 */
export function MineHere({ entries, solUsd }: { entries: readonly MineEntry[]; solUsd: number | null }) {
  const q = useWords(POOL);
  const w = useWords(EARN);
  const lang = useLang();
  if (!entries.length) return null;
  return (
    <>
      {entries.map((entry) => (
        <section key={entry.key} className={p.mineHere} aria-label={q.mine} data-pool-mine="">
          <div className={p.mineHead}>
            <span>{entry.mark ? `${q.mine} · ${digits(entry.mark, lang)}` : q.mine}</span>
            <span className={p.mineTools}>
              {entry.inRange === null ? null : (
                <span className={p.mineState} data-out={entry.inRange ? undefined : ''}>
                  {entry.inRange ? w.inRange : w.outOfRange}
                </span>
              )}
              {entry.history ? (
                <Info label={q.history} word={q.history}>
                  <dl className={`${e.kv} ${p.mineHistory}`} data-pool-history="">
                    <dt>{q.histOpened}</dt>
                    <dd>{dayText(entry.history.openedAt, lang)}</dd>
                    <dt>{q.histIn}</dt>
                    <dd>{sumText(entry.history.inUsd, lang)}</dd>
                    <dt>{q.histCollected}</dt>
                    <dd>{sumText(entry.history.collectedUsd, lang)}</dd>
                    <dt>{q.histAdded}</dt>
                    <dd>{sumText(entry.history.addedUsd, lang)}</dd>
                  </dl>
                  <span className={p.mineWhy}>{q.histWhy}</span>
                </Info>
              ) : null}
            </span>
          </div>
          <dl className={e.kv}>
            <dt>{w.now}</dt>
            <dd>{sumText(entry.nowUsd, lang)}</dd>
            <dt>{q.unclaimed}</dt>
            <dd data-tone={resultTone(entry.unclaimedUsd)}>{sumText(entry.unclaimedUsd, lang, true)}</dd>
          </dl>
          {entry.result ? <ResultFacts result={entry.result} solPriceUsd={solUsd} /> : null}
        </section>
      ))}
    </>
  );
}
