'use client';

import { rateText } from '@/city/lib/earn/dollar';
import { percentText } from '@/city/lib/earn/lst';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { EarnLendRate } from '@/lib/earn-pools/model';
import { Cell, CoinLogo, Panel, Quiet, Table, TableHead, TableRow, cx } from '@/terminal/ui';
import { PanelHead, iconOf } from './bits';
import { shortUsd, type StakeRow } from './rows';
import { EARN } from './words';
import e from './earn.module.css';

const STAKE_COLUMNS = 'minmax(180px, 1.6fr) minmax(100px, 1fr) minmax(110px, 1fr) 120px';
const LEND_COLUMNS = 'minmax(180px, 1.6fr) minmax(110px, 1fr) minmax(110px, 1fr) 120px';

/** Staking: the staked SOL coins the city buys, each with its rate now; a tap opens its ticket. */
export function StakingList({ stakes, frontKey, held, reading, onStake, phone = false }: { stakes: readonly StakeRow[]; frontKey: string | null; held: boolean; reading: boolean; onStake: (row: StakeRow) => void; phone?: boolean }) {
  const w = useWords(EARN);
  const lang = useLang();
  if (!stakes.length) return <p className={e.blankLine}>{reading ? '' : w.stakeEmpty}</p>;
  if (phone) {
    return (
      <div className={e.pList}>
        {stakes.map((row) => (
          <div key={row.lst.id} className={e.pRow}>
            <CoinLogo src={iconOf(row.lst.mint)} symbol={row.lst.symbol} />
            <span className={e.pMain}>
              <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => onStake(row)}>
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
      <PanelHead sign="staking" title={w.staking} hintLabel={w.stakingInfo} hint={w.stakingText} />
      <Table columns={STAKE_COLUMNS} minWidth={560} label={w.staking}>
        <TableHead>
          <Cell head>{w.cCoin}</Cell>
          <Cell head>{w.cBy}</Cell>
          <Cell head end sorted>
            {w.rate}
          </Cell>
          <Cell head />
        </TableHead>
        {stakes.map((row) => (
          <TableRow key={row.lst.id} current={frontKey === `stake:${row.lst.id}`}>
            <span role="cell" className={e.cellPair}>
              <CoinLogo src={iconOf(row.lst.mint)} symbol={row.lst.symbol} />
              <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => onStake(row)}>
                {row.lst.symbol}
              </button>
            </span>
            <Cell tone="dim">{row.lst.maker}</Cell>
            <Cell end tone="up">
              {digits(percentText(row.apyPct), lang)}
            </Cell>
            <span role="cell" className={e.cellEnd}>
              <Quiet size="s" disabled={held} onClick={() => onStake(row)}>
                {w.stake}
              </Quiet>
            </span>
          </TableRow>
        ))}
      </Table>
    </Panel>
  );
}

/** Lending: Jupiter Lend's markets with their rates now; USDC and SOL open the city's lending ticket. */
export function LendingList({ rates, assetOf, frontKey, held, reading, actsOn, onLend, phone = false }: { rates: readonly EarnLendRate[]; assetOf: (rate: EarnLendRate) => string | null; frontKey: string | null; held: boolean; reading: boolean; actsOn: (rate: EarnLendRate) => boolean; onLend: (rate: EarnLendRate) => void; phone?: boolean }) {
  const w = useWords(EARN);
  const lang = useLang();
  if (!rates.length) return <p className={e.blankLine}>{reading ? '' : w.lendFailed}</p>;
  if (phone) {
    return (
      <div className={e.pList}>
        {rates.map((rate) => (
          <div key={rate.mint} className={e.pRow}>
            <CoinLogo src={iconOf(rate.mint)} symbol={rate.symbol} />
            <span className={e.pMain}>
              {actsOn(rate) ? (
                <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => onLend(rate)}>
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
      <PanelHead sign="lending" title={w.lendingVenue} hintLabel={w.lendingInfo} hint={w.lendingText} />
      <Table columns={LEND_COLUMNS} minWidth={560} label={w.lending}>
        <TableHead>
          <Cell head>{w.cCoin}</Cell>
          <Cell head end sorted>
            {w.rate}
          </Cell>
          <Cell head end>
            {w.cSupplied}
          </Cell>
          <Cell head />
        </TableHead>
        {rates.map((rate) => (
          <TableRow key={rate.mint} current={assetOf(rate) !== null && frontKey === `lend:${assetOf(rate)}`}>
            <span role="cell" className={e.cellPair}>
              <CoinLogo src={iconOf(rate.mint)} symbol={rate.symbol} />
              <span className={e.sym}>{rate.symbol}</span>
            </span>
            <Cell end tone="up">
              {digits(rateText(rate.ratePct), lang)}
            </Cell>
            <Cell end tone="dim">
              {shortUsd(rate.suppliedUsd, lang)}
            </Cell>
            <span role="cell" className={e.cellEnd}>
              {actsOn(rate) ? (
                <Quiet size="s" disabled={held} onClick={() => onLend(rate)}>
                  {w.lend}
                </Quiet>
              ) : null}
            </span>
          </TableRow>
        ))}
      </Table>
    </Panel>
  );
}
