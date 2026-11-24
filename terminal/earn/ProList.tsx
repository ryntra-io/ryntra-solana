'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { coinPriceIn, coinSideOf, pairOf, tickerOf, type ProPoolRow } from '@/lib/pro-pools/model';
import { Distribution } from '@/terminal/pool/Distribution';
import { sortProRows, type ProDay, type ProSort, type ProSortKey } from '@/terminal/pool/pro-tape';
import { pctOfBps, proInvites, quoteFigure } from '@/terminal/pool/pool-view';
import { POOL } from '@/terminal/pool/words';
import { Action, Cell, Figure, Info, Kick, Quiet, Table, TableHead, TableRow, cx, priceText, stepFigure, usdText, type FoldStep } from '@/terminal/ui';
import { Pair } from './bits';
import { shortUsd, tightUsd } from './rows';
import { useBins } from './range/useBins';
import { EARN } from './words';
import e from './earn.module.css';
import p from '@/terminal/pool/pool.module.css';

/**
 * Meteora DLMM Pro as a tab of «Earn», on the same layout as the pools: every pool of it on Solana, read
 * from the program, deepest first, as wide as the desk — the pair with its price step, the liquidity, the fee
 * a swap pays now, the day's volume and fees, and what a limit order earns on top, the row's bright figure. The pair
 * leads to the pool's own desk; the row's action opens the pool's ticket beside the list, with the coin's price.
 */

/* The pair with its price step, then five figures and the action — the row fits a 1280 px window beside the ticket
   without scrolling sideways, and the pair's name stands whole on a laptop («ANTHROPIC · USDC», «DacityCoin · SOL» were
   cut on 1440). G6 (faults 44, 118): the fee has its own column — it was the line under the pair and was
   cut («Launch pool · fee 0…»), and two pools of one pair read alike; the line says the step, which tells them apart.
   The coin's price is the ticket's and the pool page's. */
const COLUMNS = 'minmax(220px, 3fr) repeat(4, minmax(60px, 1fr)) minmax(92px, 1fr) 84px';
/** On a narrower panel the day's volume goes first, then its fees: the pair, its liquidity, fee and bonus and the
 *  row's action stay, as on a phone. */
const FOLD = ['minmax(220px, 3fr) repeat(3, minmax(60px, 1fr)) minmax(92px, 1fr) 84px', 'minmax(220px, 3fr) repeat(2, minmax(60px, 1fr)) minmax(92px, 1fr) 84px'] as const;

/** A day's dollars in a cell: empty while the pool's day is not read, a floor «≥» where it was read in part. */
function dayCell(day: ProDay | undefined, usd: number | null | undefined, lang: Lang): string {
  if (!day || usd === null || usd === undefined) return '';
  return day.whole ? shortUsd(usd, lang) : `≥ ${shortUsd(usd, lang)}`;
}

/** A coin's name as a line under its pair: a tokenised stock's own name, without its issuer's tail («… - Backed»). */
const nameLine = (name: string): string => name.split(/\s+-\s+/u)[0]!.trim() || name;

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
 * A row's line under the pair on a desk: the price step, a launch pool's kind before it — or, on one of the city's own
 * pools that holds nothing yet, the invitation to its first position (G6, fault 51: «· My shape» beside it
 * said nothing to a person — the shape is the ticket's).
 */
function useRowLine(): (row: ProPoolRow, invites: boolean) => ReactNode {
  const w = useWords(EARN);
  const q = useWords(POOL);
  const lang = useLang();
  return function rowLine(row: ProPoolRow, invites: boolean): ReactNode {
    if (invites) return w.beFirst;
    const step = w.stepOf(digits(pctOfBps(row.stepBps), lang));
    return row.kind === 'launch' ? `${q.launch} · ${step}` : step;
  };
}

/**
 * A phone row's line (G6, fault 39 — two MET · SOL said only what was in them): the fee a swap pays now, what a pool is
 * chosen by, and its step; a launch pool its kind and fee. What is in the pool has its own column.
 */
function usePhoneLine(): (row: ProPoolRow) => string {
  const w = useWords(EARN);
  const q = useWords(POOL);
  const lang = useLang();
  return (row) => {
    const fee = digits(pctOfBps(row.fee.totalBps), lang);
    return row.kind === 'launch' ? `${q.launch} · ${fee}` : `${w.feeOf(fee)} · ${w.stepOf(digits(pctOfBps(row.stepBps), lang))}`;
  };
}

export function ProTable({ rows: listed, days, frontKey, held, adds, deepUsd, onPick }: { rows: readonly ProPoolRow[]; days: ReadonlyMap<string, ProDay>; frontKey: string | null; held: boolean; adds: (row: ProPoolRow) => boolean; deepUsd: number; onPick: (row: ProPoolRow) => void }) {
  const w = useWords(EARN);
  const q = useWords(POOL);
  const lang = useLang();
  const lineOf = useRowLine();
  const [sort, setSort] = useState<ProSort>(null);
  const rows = useMemo(() => sortProRows(listed, sort, days), [listed, sort, days]);
  // A head turns its order: down, up, and back to the list's own.
  const turn = (key: ProSortKey) => setSort((was) => (was?.key !== key ? { key, dir: 'desc' } : was.dir === 'desc' ? { key, dir: 'asc' } : null));
  const head = (key: ProSortKey, label: string, fold?: FoldStep) => (
    <Cell head end fold={fold} className={sort?.key === key ? e.sortOn : undefined}>
      <button type="button" className={e.sortBtn} onClick={() => turn(key)} aria-pressed={sort?.key === key}>
        {label}
        {sort?.key === key ? <span aria-hidden="true">{sort.dir === 'desc' ? ' ↓' : ' ↑'}</span> : null}
      </button>
    </Cell>
  );
  return (
    <Table columns={COLUMNS} fold={FOLD} minWidth={700} label={q.tableLabel}>
      <TableHead>
        <Cell head>{q.colPool}</Cell>
        {head('tvl', q.colLiquidity)}
        <Cell head end>
          {w.cFee}
        </Cell>
        {/* The window is the bar's («Last 24h»): the heads name the figures, as the pools' table does (fault 42). */}
        {head('volume', w.cVolume, 1)}
        {head('fees', w.cFees, 2)}
        <Cell head end>
          {w.cBonus}
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
            <Cell end>{row.tvlUsd !== null ? usdText(row.tvlUsd, lang) : '—'}</Cell>
            <Cell end>{digits(pctOfBps(row.fee.totalBps), lang)}</Cell>
            {/* One tone for the row's figures, the bonus its one bright one (fault 52 — the grey volume striped the rows). */}
            <Cell end fold={1}>
              {dayCell(days.get(row.address), days.get(row.address)?.volumeUsd, lang)}
            </Cell>
            <Cell end fold={2}>
              {dayCell(days.get(row.address), days.get(row.address)?.lpFeesUsd, lang)}
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

/**
 * A phone's rows of DLMM Pro: the pair with its fee and step, its liquidity in its own column, the limit bonus; a tap
 * opens the pool's ticket as a sheet.
 */
export function ProPhoneRows({ rows, held, adds, deepUsd, onPick }: { rows: readonly ProPoolRow[]; held: boolean; adds: (row: ProPoolRow) => boolean; deepUsd: number; onPick: (row: ProPoolRow) => void }) {
  const w = useWords(EARN);
  const q = useWords(POOL);
  const lang = useLang();
  const lineOf = useRowLine();
  const phoneLine = usePhoneLine();
  return (
    <div className={e.pList}>
      <div className={cx(e.pListHead, e.pHeadGrid, e.pHeadBare)} aria-hidden="true">
        <span className={e.grow}>{q.colPool}</span>
        <span className={e.pMid}>{q.colLiquidity}</span>
        <span className={e.pSideHead}>{w.cBonus}</span>
      </div>
      {rows.map((row) => (
        <div key={row.address} className={cx(e.pRow, e.pRowGrid, e.pRowBare)}>
          <Pair coins={coinsOf(row)} />
          <span className={e.pMain}>
            <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => onPick(row)} data-earn-pick="">
              {proName(row)}
            </button>
            {proInvites(row, { adds, deepUsd }) ? <span className={cx(e.cap, e.invite)}>{lineOf(row, true)}</span> : <span className={e.cap}>{phoneLine(row)}</span>}
          </span>
          <span className={e.pMid}>{tightUsd(row.tvlUsd, lang)}</span>
          <span className={e.pSide}>
            <span className={e.up}>{`+${digits(pctOfBps(row.bonusBps), lang)}`}</span>
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
          <span className={cx(e.cap, e.capWrap)}>{row.kind === 'launch' ? q.launch : nameLine(pair.coin.name ?? tickerOf(pair.coin))}</span>
        </span>
        <span className={cx(p.badge, e.push)}>{q.proShort}</span>
      </div>
      <div className={e.viewDay}>
        <Kick>{w.cBonus}</Kick>
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
