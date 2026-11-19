'use client';

import { rateText } from '@/city/lib/earn/dollar';
import { percentText } from '@/city/lib/earn/lst';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { plainFigure } from '@/city/lib/i18n/figures';
import { useLang } from '@/city/lib/i18n/lang';
import type { EarnLendRate } from '@/lib/earn-pools/model';
import { Cell, CoinLogo, Panel, Quiet, Table, TableHead, TableRow, cx } from '@/terminal/ui';
import { iconOf, iconsAfter } from './bits';
import { shortUsd, type StakeRow } from './rows';
import { EARN } from './words';
import e from './earn.module.css';

/** A staked coin's own facts beside its rate: its worth in SOL and the pool's share of the rewards. */
export type StakeFacts = Readonly<{ worthSol: number | null; keepsPct: number | null }>;

const STAKE_COLUMNS = 'minmax(200px, 1.4fr) repeat(3, minmax(84px, 1fr)) 120px';

/**
 * Staking: the staked SOL coins the city buys, best rate first, as wide as the desk — the coin and whose it
 * is, its worth in SOL, the pool's share of the rewards, and the rate a year now, the row's bright figure. A tap on the
 * row's action opens the coin's ticket beside the list.
 */
export function StakingList({ stakes, facts, frontKey, held, reading, onStake, phone = false }: { stakes: readonly StakeRow[]; facts: (row: StakeRow) => StakeFacts; frontKey: string | null; held: boolean; reading: boolean; onStake: (row: StakeRow) => void; phone?: boolean }) {
  const w = useWords(EARN);
  const lang = useLang();
  if (!stakes.length) return <Blank line={reading ? '' : w.stakeEmpty} busy={reading} />;
  if (phone) {
    return (
      <div className={e.pList}>
        {stakes.map((row) => (
          <div key={row.lst.id} className={e.pRow}>
            <CoinLogo src={iconOf(row.lst.mint)} also={iconsAfter(row.lst.mint)} symbol={row.lst.symbol} />
            <span className={e.pMain}>
              <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => onStake(row)} data-earn-pick="">
                {row.lst.symbol}
              </button>
              <span className={e.cap}>{row.lst.maker}</span>
            </span>
            <span className={e.pSide}>
              <span className={e.up}>{digits(percentText(row.apyPct), lang)}</span>
              <span className={e.cap}>{w.rate}</span>
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <Panel pad="none" label={w.staking}>
      <Table columns={STAKE_COLUMNS} minWidth={640} label={w.staking}>
        <TableHead>
          <Cell head>{w.cCoin}</Cell>
          <Cell head end>
            {w.cWorth}
          </Cell>
          <Cell head end>
            {w.cPoolKeeps}
          </Cell>
          <Cell head end sorted>
            {w.rate}
          </Cell>
          <Cell head />
        </TableHead>
        {stakes.map((row) => {
          const { worthSol, keepsPct } = facts(row);
          return (
            <TableRow key={row.lst.id} current={frontKey === `stake:${row.lst.id}`}>
              <span role="cell" className={e.cellPair}>
                <CoinLogo src={iconOf(row.lst.mint)} also={iconsAfter(row.lst.mint)} symbol={row.lst.symbol} />
                <span className={e.cellWords}>
                  <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => onStake(row)}>
                    {row.lst.symbol}
                  </button>
                  <span className={e.cap}>{row.lst.maker}</span>
                </span>
              </span>
              <Cell end>{worthSol === null ? '—' : `${digits(plainFigure(worthSol, { places: 4, significant: 5 }), lang)} SOL`}</Cell>
              <Cell end tone="dim">
                {keepsPct === null ? '—' : digits(percentText(keepsPct), lang)}
              </Cell>
              <Cell end tone="up" className={e.lead}>
                {digits(percentText(row.apyPct), lang)}
              </Cell>
              <span role="cell" className={e.cellEnd}>
                <Quiet size="s" disabled={held} onClick={() => onStake(row)} className={e.rowAct} data-earn-pick="">
                  {w.stake}
                </Quiet>
              </span>
            </TableRow>
          );
        })}
      </Table>
    </Panel>
  );
}

const LEND_COLUMNS = 'minmax(200px, 1.4fr) repeat(4, minmax(80px, 1fr)) 112px';
const LEND_COLUMNS_GUEST = 'minmax(200px, 1.4fr) repeat(3, minmax(84px, 1fr)) 112px';

/**
 * Lending: the markets of Jupiter Lend the city's own ticket puts coins in — only those, every row with its
 * action — as wide as the desk: the coin, its rate a year now (the row's bright figure), what is supplied to it, what it
 * can pay out right now, and with a wallet what is yours in it.
 */
export function LendingList({
  rates,
  assetOf,
  frontKey,
  held,
  reading,
  available,
  yours,
  actsOn,
  onLend,
  phone = false,
}: {
  rates: readonly EarnLendRate[];
  assetOf: (rate: EarnLendRate) => string | null;
  frontKey: string | null;
  held: boolean;
  reading: boolean;
  available: (rate: EarnLendRate) => number | null;
  /** Whether the row opens the city's ticket; a market listed only for its rate (lending closed here) has no action. */
  actsOn: (rate: EarnLendRate) => boolean;
  /** What the wallet has in the market, dollars; null without a wallet. */
  yours: ((rate: EarnLendRate) => number | null) | null;
  onLend: (rate: EarnLendRate) => void;
  phone?: boolean;
}) {
  const w = useWords(EARN);
  const lang = useLang();
  if (!rates.length) return <Blank line={reading ? '' : w.lendFailed} busy={reading} />;
  if (phone) {
    return (
      <div className={e.pList}>
        {rates.map((rate) => (
          <div key={rate.mint} className={e.pRow}>
            <CoinLogo src={iconOf(rate.mint)} also={iconsAfter(rate.mint)} symbol={rate.symbol} />
            <span className={e.pMain}>
              {actsOn(rate) ? (
                <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => onLend(rate)} data-earn-pick="">
                  {rate.symbol}
                </button>
              ) : (
                <span className={e.sym}>{rate.symbol}</span>
              )}
              <span className={e.cap}>{shortUsd(rate.suppliedUsd, lang)}</span>
            </span>
            <span className={e.pSide}>
              <span className={e.up}>{digits(rateText(rate.ratePct), lang)}</span>
              <span className={e.cap}>{w.rate}</span>
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <Panel pad="none" label={w.lending}>
      <Table columns={yours ? LEND_COLUMNS : LEND_COLUMNS_GUEST} minWidth={yours ? 700 : 640} label={w.lending}>
        <TableHead>
          <Cell head>{w.cCoin}</Cell>
          <Cell head end>
            {w.cSupplied}
          </Cell>
          <Cell head end>
            {w.cAvailable}
          </Cell>
          {yours ? (
            <Cell head end>
              {w.cYours}
            </Cell>
          ) : null}
          <Cell head end sorted>
            {w.rate}
          </Cell>
          <Cell head />
        </TableHead>
        {rates.map((rate) => {
          const mine = yours?.(rate) ?? null;
          return (
            <TableRow key={rate.mint} current={assetOf(rate) !== null && frontKey === `lend:${assetOf(rate)}`}>
              <span role="cell" className={e.cellPair}>
                <CoinLogo src={iconOf(rate.mint)} also={iconsAfter(rate.mint)} symbol={rate.symbol} />
                {actsOn(rate) ? (
                  <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => onLend(rate)}>
                    {rate.symbol}
                  </button>
                ) : (
                  <span className={e.sym}>{rate.symbol}</span>
                )}
              </span>
              <Cell end>{shortUsd(rate.suppliedUsd, lang)}</Cell>
              <Cell end tone="dim">
                {shortUsd(available(rate), lang)}
              </Cell>
              {yours ? <Cell end>{mine === null ? '—' : shortUsd(mine, lang)}</Cell> : null}
              <Cell end tone="up" className={e.lead}>
                {digits(rateText(rate.ratePct), lang)}
              </Cell>
              <span role="cell" className={e.cellEnd}>
                {actsOn(rate) ? (
                  <Quiet size="s" disabled={held} onClick={() => onLend(rate)} className={e.rowAct} data-earn-pick="">
                    {w.lend}
                  </Quiet>
                ) : null}
              </span>
            </TableRow>
          );
        })}
      </Table>
    </Panel>
  );
}

function Blank({ line, busy }: { line: string; busy: boolean }) {
  return busy ? (
    <div className={e.bones} aria-busy="true">
      {Array.from({ length: 3 }, (_, at) => (
        <span key={at} />
      ))}
    </div>
  ) : (
    <p className={e.blankLine}>{line}</p>
  );
}
