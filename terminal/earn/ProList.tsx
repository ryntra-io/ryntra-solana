'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { coinPriceIn, coinSideOf, pairOf, tickerOf, type ProPoolRow } from '@/lib/pro-pools/model';
import { Distribution } from '@/terminal/pool/Distribution';
import { pctOfBps, proInvites, quoteFigure } from '@/terminal/pool/pool-view';
import { POOL } from '@/terminal/pool/words';
import { Action, Cell, Figure, Info, Kick, Quiet, Table, TableHead, TableRow, cx, priceText, stepFigure, usdText } from '@/terminal/ui';
import { Pair } from './bits';
import { useBins } from './range/useBins';
import { SHAPE_OPEN } from './shape/model';
import { SHAPE } from './shape/words';
import { EARN } from './words';
import e from './earn.module.css';
import p from '@/terminal/pool/pool.module.css';

/**
 * Meteora DLMM Pro as a tab of «Earn», on the same layout as the pools: every pool of it on Solana, read
 * from the program, deepest first, as wide as the desk — the pair, the coin's price, the liquidity, the fee a
 * swap pays now, the price's step, and what a limit order earns on top, the row's bright figure. The pair leads to the
 * pool's own desk; the row's action opens the pool's ticket beside the list.
 */

/* The pair with its type and price step, then four figures and the action — the row fits a 1280 px window beside the
   ticket without scrolling sideways. */
const COLUMNS = 'minmax(200px, 1.4fr) repeat(4, minmax(84px, 1fr)) 104px';

export const proHref = (row: ProPoolRow): string => `/pool/${row.address}`;

/** A pair's name as every row of «Earn» says it: «MET · SOL». */
export const proName = (row: ProPoolRow): string => {
  const pair = pairOf(row);
  return `${tickerOf(pair.coin)} · ${tickerOf(pair.quote)}`;
};

const coinsOf = (row: ProPoolRow) => {
  const pair = pairOf(row);
  return [
    { mint: pair.coin.mint, symbol: tickerOf(pair.coin) },
    { mint: pair.quote.mint, symbol: tickerOf(pair.quote) },
  ] as const;
};

/** The coin's price: in dollars where it has one, else in the coin it is priced in — as the pool's own head says it. */
function priceOf(row: ProPoolRow, lang: Lang): string {
  const pair = pairOf(row);
  // A price under a tenth of a cent folds its zeros as the chart does ($0.0₅9698), as the pool's own head says it.
  if (pair.coin.usd !== null) return pair.coin.usd < 0.001 ? digits(`$${stepFigure(pair.coin.usd, null)}`, lang) : priceText(pair.coin.usd, lang);
  return `${digits(quoteFigure(coinPriceIn(row), row.stepBps), lang)} ${tickerOf(pair.quote)}`;
}

/**
 * A row's line under the pair: the kind and the step — or, on one of the city's own pools that holds nothing yet, the
 * invitation to its first position, with the person's own shape where it is open.
 */
function useRowLine(): (row: ProPoolRow, invites: boolean) => ReactNode {
  const w = useWords(EARN);
  const q = useWords(POOL);
  const sw = useWords(SHAPE);
  const lang = useLang();
  // The tab itself is DLMM Pro's: a row names only a launch pool's kind, and its step — whole on a laptop.
  // The invitation keeps one line: its «· My shape» stands where the row has room for it.
  return function rowLine(row: ProPoolRow, invites: boolean): ReactNode {
    if (!invites) return `${row.kind === 'launch' ? `${q.launch} · ` : ''}${w.stepOf(digits(pctOfBps(row.stepBps), lang))}`;
    return (
      <>
        {w.beFirst}
        {SHAPE_OPEN ? <span className={e.inviteMore}>{` · ${sw.goal}`}</span> : null}
      </>
    );
  };
}

export function ProTable({ rows, frontKey, held, adds, deepUsd, onPick }: { rows: readonly ProPoolRow[]; frontKey: string | null; held: boolean; adds: (row: ProPoolRow) => boolean; deepUsd: number; onPick: (row: ProPoolRow) => void }) {
  const w = useWords(EARN);
  const q = useWords(POOL);
  const lang = useLang();
  const lineOf = useRowLine();
  return (
    <Table columns={COLUMNS} minWidth={700} label={q.tableLabel}>
      <TableHead>
        <Cell head>{q.colPool}</Cell>
        <Cell head end>
          {q.colPrice}
        </Cell>
        <Cell head end>
          {q.colLiquidity}
        </Cell>
        <Cell head end>
          {w.feeNow}
        </Cell>
        <Cell head end>
          {q.colBonus}
        </Cell>
        <Cell head />
      </TableHead>
      {rows.map((row) => (
          <TableRow key={row.address} current={frontKey === `pro-pool:${row.address}`}>
            <span role="cell" className={e.cellPair}>
              <Pair coins={coinsOf(row)} />
              <span className={e.cellWords}>
                {/* The pair leads to the pool's own desk — never while a signature is out: the ticket stays in front. */}
                {held ? (
                  <span className={e.sym}>{proName(row)}</span>
                ) : (
                  <Link href={proHref(row)} className={cx(e.sym, e.rowHit)}>
                    {proName(row)}
                  </Link>
                )}
                <span className={cx(e.cap, proInvites(row, { adds, deepUsd }) && e.invite)}>{lineOf(row, proInvites(row, { adds, deepUsd }))}</span>
              </span>
            </span>
            <Cell end>{priceOf(row, lang)}</Cell>
            <Cell end>{row.tvlUsd !== null ? usdText(row.tvlUsd, lang) : '—'}</Cell>
            <Cell end tone="dim">
              {digits(pctOfBps(row.fee.totalBps), lang)}
            </Cell>
            <Cell end tone="up" className={e.lead}>
              {`+${digits(pctOfBps(row.bonusBps), lang)}`}
            </Cell>
            <span role="cell" className={e.cellEnd}>
              <Quiet size="s" disabled={held} onClick={() => onPick(row)} className={e.rowAct} aria-label={`${adds(row) ? w.add : w.limitAct} · ${proName(row)}`} data-earn-pick="">
                {adds(row) ? w.add : w.limitAct}
              </Quiet>
            </span>
          </TableRow>
      ))}
    </Table>
  );
}

/** A phone's rows of DLMM Pro: the pair, its liquidity, the limit bonus; a tap opens the pool's ticket as a sheet. */
export function ProPhoneRows({ rows, held, adds, deepUsd, onPick }: { rows: readonly ProPoolRow[]; held: boolean; adds: (row: ProPoolRow) => boolean; deepUsd: number; onPick: (row: ProPoolRow) => void }) {
  const q = useWords(POOL);
  const lang = useLang();
  const lineOf = useRowLine();
  return (
    <div className={e.pList}>
      {rows.map((row) => (
        <div key={row.address} className={e.pRow}>
          <Pair coins={coinsOf(row)} />
          <span className={e.pMain}>
            <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => onPick(row)} data-earn-pick="">
              {proName(row)}
            </button>
            {proInvites(row, { adds, deepUsd }) ? (
              <span className={cx(e.cap, e.invite)}>{lineOf(row, true)}</span>
            ) : (
              <span className={e.cap}>{`${q.proShort} · ${row.tvlUsd !== null ? usdText(row.tvlUsd, lang) : '—'}`}</span>
            )}
          </span>
          <span className={e.pSide}>
            <span className={e.up}>{`+${digits(pctOfBps(row.bonusBps), lang)}`}</span>
            <span className={e.cap}>{q.colBonus}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The ticket of a DLMM Pro pool the city does not add to from here: what a limit order earns in it — the pool's own
 * feature — as its one figure, the pool's four figures, its liquidity by price as Meteora draws it, and one action: a
 * limit order on the pool's own desk, where the chart and the ticket's Limit tab stand.
 */
export function ProPoolTicket({ row, held }: { row: ProPoolRow; held: boolean }) {
  const w = useWords(EARN);
  const q = useWords(POOL);
  const lang = useLang();
  const router = useRouter();
  const pair = pairOf(row);
  const bins = useBins('pro', row.address);
  const quote = tickerOf(pair.quote);
  return (
    <div className={e.view} data-earn-ticket="pro-pool">
      <div className={e.ticketHead}>
        <Pair coins={coinsOf(row)} size="l" />
        <span className={e.cellWords}>
          <span className={cx(e.sym, e.symL)}>{proName(row)}</span>
          <span className={e.cap}>{row.kind === 'launch' ? q.launch : (pair.coin.name ?? tickerOf(pair.coin))}</span>
        </span>
        <span className={cx(p.badge, e.push)}>{q.proShort}</span>
      </div>
      <div className={e.viewDay}>
        <Kick>{q.colBonus}</Kick>
        <span className={e.bonusFig}>
          <Figure value={`+${digits(pctOfBps(row.bonusBps), lang)}`} size="l" tone="up" />
          <Info label={q.bonusTitle}>{q.bonusWhy}</Info>
        </span>
      </div>
      <dl className={e.kv}>
        <dt>{w.priceOf}</dt>
        <dd>{priceOf(row, lang)}</dd>
        <dt>{q.colLiquidity}</dt>
        <dd>{row.tvlUsd !== null ? usdText(row.tvlUsd, lang) : '—'}</dd>
        <dt>{w.feeNow}</dt>
        <dd>{digits(pctOfBps(row.fee.totalBps), lang)}</dd>
        <dt>{w.stepPct}</dt>
        <dd>{digits(pctOfBps(row.stepBps), lang)}</dd>
      </dl>
      <div className={e.distBox}>
        <Kick>{w.byPrice}</Kick>
        <Distribution bins={bins} side={coinSideOf(row)} coin={tickerOf(pair.coin)} quote={quote} />
      </div>
      <Action disabled={held} onClick={() => router.push(proHref(row))} data-earn-act="limit">
        {w.placeLimit}
      </Action>
    </div>
  );
}

/** Under the city's own add to a DLMM Pro pool: the way to the pool's own desk. */
export function ProPoolLink({ row }: { row: ProPoolRow }) {
  const w = useWords(EARN);
  return (
    <Link className={e.venue} href={proHref(row)}>
      {w.openPool}
    </Link>
  );
}
