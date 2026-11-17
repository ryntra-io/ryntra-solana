'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { Cell, Icon, Quiet, Table, TableHead, TableRow, cx } from '@/terminal/ui';
import { useDismiss } from '../shell/useDismiss';
import { Pair } from './bits';
import {
  BASE_BANDS,
  FEE_TVL_STEPS,
  FEES_STEPS,
  START_FILTERS,
  STEP_BANDS,
  STRATEGIES,
  STRATEGY_SORT,
  TVL_STEPS,
  VOLUME_STEPS,
  ageText,
  dayPctText,
  floorText,
  strategyFilters,
  type BaseBand,
  type ChooseRow,
  type Filters,
  type PoolType,
  type Sort,
  type SortKey,
  type StepBand,
  type Strategy,
} from './choose';
import { feeText, shortUsd } from './rows';
import { EARN } from './words';
import e from './earn.module.css';

type W = (typeof EARN)['en'];

export const TYPE_NAME: Readonly<Record<PoolType, string>> = { dlmm: 'DLMM', 'damm-v2': 'DAMM v2', pro: 'DLMM Pro' };

const STEP_NAME: Readonly<Record<Exclude<StepBand, 'any'>, string>> = { tight: '1–5', mid: '6–20', wide: '21–100', wider: '100+' };
const BASE_NAME: Readonly<Record<Exclude<BaseBand, 'any'>, string>> = { low: '≤ 0.05%', mid: '0.05–0.3%', high: '> 0.3%' };

/** A row's second line: the type, and in the plain look its step. */
export function rowCaption(row: ChooseRow, w: W, lang: Lang): string {
  const step = row.step === null ? '—' : digits(String(row.step), lang);
  return `${TYPE_NAME[row.type]} · ${w.stepOf(step)}`;
}

/* ── one filter: a chip that opens its choices under it ─────────────────────────────────────────────────────────── */

type Option<T> = Readonly<{ id: T; label: string }>;

function Pick<T extends string | number>({ name, value, options, current, onPick, on, end = false, children }: { name: string; value: string; options?: readonly Option<T>[]; current?: T; onPick?: (id: T) => void; on: boolean; end?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useDismiss(open, box, () => setOpen(false));
  return (
    <div ref={box} className={e.pickBox}>
      <button type="button" className={cx(e.chip, on && e.chipOn)} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((was) => !was)}>
        <span className={e.chipName}>{name}</span>
        <span className={e.chipValue}>{value}</span>
        <Icon name="chevron" size="s" />
      </button>
      {open ? (
        <div id={id} className={cx(e.menu, end && e.menuEnd)} role="menu">
          {options?.map((option) => (
            <button
              key={String(option.id)}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === current}
              className={e.menuItem}
              onClick={() => {
                onPick?.(option.id);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** The strategies the screen draws as cards above the filters (EarnScreen's `cards`). */
const CARD_STRATEGIES: ReadonlySet<Strategy> = new Set<Strategy>(['stable', 'high']);

const usdOptions = (steps: readonly number[], any: string, lang: Lang): Option<number>[] => steps.map((step) => ({ id: step, label: step === 0 ? any : floorText(step, 'usd', lang) }));

/**
 * The filter row: each figure a person picks a pool by, as a chip. The ones used every day stand in sight; the rare
 * ones — the day's fees, fees over depth, the price step, the base fee — open with «+ Filters», and stay open (the
 * control held) while one of them is set. `columns` is the table's own «Columns» control, beside the order.
 */
export function FilterBar({ filters, onFilters, sort, onSort, more, onMore, every, compact, hasPro, coins, columns }: { filters: Filters; onFilters: (next: Filters) => void; sort: Sort; onSort: (next: Sort) => void; more: boolean; onMore: () => void; every: boolean; compact: boolean; hasPro: boolean; coins: readonly string[]; columns?: ReactNode }) {
  // A phone keeps the type, the coin and the order in reach; the floors stand as they are.
  const floors = !compact;
  const rareSet = filters.minFees > 0 || filters.minFeeTvl > 0 || filters.step !== 'any' || filters.base !== 'any';
  const rare = (more || rareSet) && !compact;
  const w = useWords(EARN);
  const lang = useLang();
  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });
  const types: Option<Filters['type']>[] = [
    { id: 'all', label: w.fAll },
    { id: 'dlmm', label: 'DLMM' },
    { id: 'damm-v2', label: 'DAMM v2' },
    ...(hasPro ? [{ id: 'pro' as const, label: 'DLMM Pro' }] : []),
  ];
  const sortNames: Readonly<Record<SortKey, string>> = { fees: w.sortFees, feeTvl: w.sortFeeTvl, tvl: w.sortTvl, volume: w.sortVolume, age: w.sortAge, step: w.sortStep, base: w.sortBase };
  const sorts: SortKey[] = every ? ['fees', 'feeTvl', 'tvl', 'volume', 'age', 'step', 'base'] : ['fees', 'feeTvl', 'tvl', 'volume', 'age'];
  const changed = JSON.stringify(filters) !== JSON.stringify(START_FILTERS);
  return (
    <div className={e.filtersWrap}>
    <div className={e.filters} role="group" aria-label={w.filters}>
      {/* A desk says a strategy once: the two with a card stand as cards above the row, the third as its chip here. */}
      {compact ? null : (
        <div className={e.strats} role="group" aria-label={w.strategies}>
          {STRATEGIES.filter((strategy) => !CARD_STRATEGIES.has(strategy)).map((strategy) => (
            <button
              key={strategy}
              type="button"
              className={cx(e.chip, filters.strategy === strategy && e.chipOn)}
              aria-pressed={filters.strategy === strategy}
              onClick={() => {
                onFilters(filters.strategy === strategy ? START_FILTERS : strategyFilters(strategy));
                onSort(filters.strategy === strategy ? sort : STRATEGY_SORT[strategy]);
              }}
            >
              {strategyName(strategy, w)}
            </button>
          ))}
          <span className={e.stratSep} aria-hidden="true" />
        </div>
      )}
      <Pick name={w.fType} value={types.find((t) => t.id === filters.type)?.label ?? w.fAll} options={types} current={filters.type} onPick={(type) => set({ type })} on={filters.type !== 'all'} />
      <Pick name={w.fCoin} value={filters.coin.trim() || w.fAnyCoin} on={filters.coin.trim() !== ''} options={[{ id: '', label: w.fAnyCoin }, ...coins.map((coin) => ({ id: coin, label: coin }))]} current={filters.coin} onPick={(coin) => set({ coin })}>
        <input className={e.menuInput} type="search" inputMode="search" autoComplete="off" spellCheck={false} placeholder={w.fCoinHint} aria-label={w.fCoinHint} value={filters.coin} onChange={(event) => set({ coin: event.target.value.slice(0, 44) })} />
      </Pick>
      {floors ? (
        <>
          <Pick name={w.fTvl} value={filters.minTvl ? floorText(filters.minTvl, 'usd', lang) : w.fAny} options={usdOptions(TVL_STEPS, w.fAny, lang)} current={filters.minTvl} onPick={(minTvl) => set({ minTvl })} on={filters.minTvl > 0} />
      <Pick name={w.fVolume} value={filters.minVolume ? floorText(filters.minVolume, 'usd', lang) : w.fAny} options={usdOptions(VOLUME_STEPS, w.fAny, lang)} current={filters.minVolume} onPick={(minVolume) => set({ minVolume })} on={filters.minVolume > 0} />
      {rare ? <Pick name={w.fFees} value={filters.minFees ? floorText(filters.minFees, 'usd', lang) : w.fAny} options={usdOptions(FEES_STEPS, w.fAny, lang)} current={filters.minFees} onPick={(minFees) => set({ minFees })} on={filters.minFees > 0} /> : null}
      {rare ? <Pick
        name={w.fFeeTvl}
        value={filters.minFeeTvl ? floorText(filters.minFeeTvl, 'pct', lang) : w.fAny}
        options={FEE_TVL_STEPS.map((step) => ({ id: step, label: step === 0 ? w.fAny : floorText(step, 'pct', lang) }))}
        current={filters.minFeeTvl}
        onPick={(minFeeTvl) => set({ minFeeTvl })}
        on={filters.minFeeTvl > 0}
      /> : null}
        </>
      ) : null}
      {rare ? (
        <>
          <Pick name={w.fStep} value={filters.step === 'any' ? w.fAny : STEP_NAME[filters.step]} options={STEP_BANDS.map((band) => ({ id: band, label: band === 'any' ? w.fAny : STEP_NAME[band] }))} current={filters.step} onPick={(step) => set({ step })} on={filters.step !== 'any'} />
          <Pick name={w.fBase} value={filters.base === 'any' ? w.fAny : digits(BASE_NAME[filters.base], lang)} options={BASE_BANDS.map((band) => ({ id: band, label: band === 'any' ? w.fAny : digits(BASE_NAME[band], lang) }))} current={filters.base} onPick={(base) => set({ base })} on={filters.base !== 'any'} />
        </>
      ) : null}
      <button type="button" className={cx(e.chip, filters.verified && e.chipOn)} aria-pressed={filters.verified} onClick={() => set({ verified: !filters.verified })}>
        {w.fVerified}
      </button>
      {compact ? null : (
        <button type="button" className={cx(e.chip, rare && e.chipOn)} aria-expanded={rare} aria-disabled={rareSet || undefined} data-earn="more-filters" onClick={rareSet ? undefined : onMore}>
          {`+ ${w.filters}`}
        </button>
      )}
      {changed ? (
        <Quiet size="s" onClick={() => onFilters(START_FILTERS)}>
          {w.fReset}
        </Quiet>
      ) : null}
      <div className={e.grow} />
      {columns}
      <Pick end name={w.sortBy} value={`${sortNames[sort.key]} ${sort.dir === 'desc' ? '↓' : '↑'}`} options={sorts.map((key) => ({ id: key, label: sortNames[key] }))} current={sort.key} onPick={(key) => onSort({ key, dir: 'desc' })} on={false} />
    </div>
    </div>
  );
}

export function strategyName(strategy: Strategy, w: W): string {
  return strategy === 'stable' ? w.sStable : strategy === 'high' ? w.sHigh : w.sSol;
}

/* ── the table ───────────────────────────────────────────────────────────────────────────────────────────────────── */

const COLUMNS_MAIN = 'minmax(160px, 1.8fr) repeat(3, minmax(80px, 1fr)) minmax(88px, 1fr) 84px';
const COLUMNS_ALL = 'minmax(190px, 1.6fr) 44px 56px repeat(3, minmax(72px, 1fr)) 60px 48px 76px';

function SortHead({ id, sort, onSort, children }: { id: SortKey; sort: Sort; onSort: (next: Sort) => void; children: ReactNode }) {
  const on = sort.key === id;
  return (
    <Cell head end className={on ? e.sortOn : undefined}>
      <button type="button" className={e.sortBtn} onClick={() => onSort({ key: id, dir: on && sort.dir === 'desc' ? 'asc' : 'desc' })}>
        {children}
        {on ? <span aria-hidden="true">{sort.dir === 'desc' ? ' ↓' : ' ↑'}</span> : null}
      </button>
    </Cell>
  );
}

export function PoolsTable({ rows, every, sort, onSort, frontKey, held, onPick, nowMs }: { rows: readonly ChooseRow[]; every: boolean; sort: Sort; onSort: (next: Sort) => void; frontKey: string | null; held: boolean; onPick: (row: ChooseRow) => void; nowMs: number }) {
  const w = useWords(EARN);
  const lang = useLang();
  return (
    <Table columns={every ? COLUMNS_ALL : COLUMNS_MAIN} minWidth={every ? 740 : 640} label={w.pools}>
      <TableHead>
        <Cell head>{w.cPool}</Cell>
        {every ? (
          <>
            <SortHead id="step" sort={sort} onSort={onSort}>
              {w.cStep}
            </SortHead>
            <SortHead id="base" sort={sort} onSort={onSort}>
              {w.cBase}
            </SortHead>
          </>
        ) : null}
        <SortHead id="tvl" sort={sort} onSort={onSort}>
          {w.inPool}
        </SortHead>
        <SortHead id="volume" sort={sort} onSort={onSort}>
          {w.volume24}
        </SortHead>
        <SortHead id="fees" sort={sort} onSort={onSort}>
          {w.fees24}
        </SortHead>
        <SortHead id="feeTvl" sort={sort} onSort={onSort}>
          {every ? w.cFeeTvl : w.cFeeTvlA}
        </SortHead>
        {every ? (
          <SortHead id="age" sort={sort} onSort={onSort}>
            {w.cAge}
          </SortHead>
        ) : null}
        <Cell head />
      </TableHead>
      {rows.map((row) => {
        const front = frontKey === pickKey(row);
        return (
          <TableRow key={row.key} current={front}>
            <span role="cell" className={e.cellPair}>
              <Pair coins={row.coins} />
              <span className={e.cellWords}>
                <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => onPick(row)}>
                  {row.name}
                </button>
                <span className={e.cap}>{every ? TYPE_NAME[row.type] : rowCaption(row, w, lang)}</span>
              </span>
            </span>
            {every ? (
              <>
                <Cell end>{row.step === null ? '—' : digits(String(row.step), lang)}</Cell>
                <Cell end>{feeText(row.baseFeePct, lang)}</Cell>
              </>
            ) : null}
            <Cell end>{shortUsd(row.tvlUsd, lang)}</Cell>
            <Cell end tone="dim">
              {shortUsd(row.volume24hUsd, lang)}
            </Cell>
            <Cell end>{shortUsd(row.fees24hUsd, lang)}</Cell>
            <Cell end tone={row.feeTvlPct !== null && row.feeTvlPct > 0 ? 'up' : undefined}>
              {dayPctText(row.feeTvlPct, lang)}
            </Cell>
            {every ? (
              <Cell end tone="dim">
                {ageText(row.createdAt, lang, nowMs)}
              </Cell>
            ) : null}
            <span role="cell" className={e.cellEnd}>
              <Quiet size="s" disabled={held} onClick={() => onPick(row)} className={row.act === 'view' ? e.viewBtn : undefined}>
                {row.act === 'view' ? w.view : w.add}
              </Quiet>
            </span>
          </TableRow>
        );
      })}
    </Table>
  );
}

/** The ticket a row opens: the city's add, DLMM Pro's, or the pool's own figures. */
export function pickKey(row: ChooseRow): string {
  return row.act === 'add' ? `pool:${row.address}` : row.act === 'pro' ? `pro:${row.address}` : `view:${row.address}`;
}

/** The phone's list: the pair and its type, a day's fees over the depth and in dollars. */
export function PhoneRows({ rows, held, onPick }: { rows: readonly ChooseRow[]; held: boolean; onPick: (row: ChooseRow) => void }) {
  const lang = useLang();
  return (
    <div className={e.pList}>
      {rows.map((row) => (
        <div key={row.key} className={e.pRow}>
          <Pair coins={row.coins} />
          <span className={e.pMain}>
            <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => onPick(row)}>
              {row.name}
            </button>
            <span className={e.cap}>{`${TYPE_NAME[row.type]} · ${shortUsd(row.tvlUsd, lang)}`}</span>
          </span>
          <span className={e.pSide}>
            <span className={cx(row.feeTvlPct !== null && row.feeTvlPct > 0 && e.up)}>{dayPctText(row.feeTvlPct, lang)}</span>
            <span className={e.cap}>{shortUsd(row.fees24hUsd, lang)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── the ready strategies (the plain look) and the rates strip (Pro) ───────────────────────────────────────────── */

export type StrategyCard = Readonly<{ id: string; title: string; line: string; figure: string; on: boolean; act: () => void }>;

export function StrategyCards({ cards }: { cards: readonly StrategyCard[] }) {
  const w = useWords(EARN);
  if (!cards.length) return null;
  return (
    <div className={e.cards} role="group" aria-label={w.strategies}>
      {cards.map((card) => (
        <button key={card.id} type="button" className={cx(e.card, card.on && e.cardOn)} aria-pressed={card.on} onClick={card.act}>
          <span className={e.cardTitle}>{card.title}</span>
          <span className={e.cardLine}>{card.line}</span>
          <span className={e.cardFigure}>{card.figure}</span>
        </button>
      ))}
    </div>
  );
}
