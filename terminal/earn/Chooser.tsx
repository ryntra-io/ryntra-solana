'use client';

import Link from 'next/link';
import { useId, useRef, useState, type ReactNode } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { KNOWN_STOCKS } from '@/lib/stocks/known-stocks';
import { Cell, Icon, Quiet, Table, TableHead, TableRow, cx, type FoldStep } from '@/terminal/ui';
import { DLMM_STOCKS_SCREEN } from '@/terminal/stocks/dlmm/flag';
import { useDismiss } from '../shell/useDismiss';
import { Pair } from './bits';
import {
  BASE_BANDS,
  FEE_TVL_STEPS,
  FEES_STEPS,
  HIGH_MIN_TVL_USD,
  PERIODS,
  START_FILTERS,
  STEP_BANDS,
  STRATEGIES,
  STRATEGY_SORT,
  TVL_STEPS,
  VOLUME_STEPS,
  ageText,
  dayPctText,
  dayUsdText,
  figuresOf,
  floorText,
  strategyFilters,
  type BaseBand,
  type ChooseRow,
  type Filters,
  type Period,
  type PeriodFigures,
  type PoolType,
  type Sort,
  type SortKey,
  type StepBand,
  type Strategy,
} from './choose';
import { feeText, shortUsd, tightUsd } from './rows';
import { toggleSavedPool, useSavedPools } from './saved-pools';
import { EARN } from './words';
import e from './earn.module.css';

type W = (typeof EARN)['en'];

export const TYPE_NAME: Readonly<Record<PoolType, string>> = { dlmm: 'DLMM', 'damm-v2': 'DAMM v2', pro: 'DLMM Pro' };

const STEP_NAME: Readonly<Record<Exclude<StepBand, 'any'>, string>> = { tight: '1–5', mid: '6–20', wide: '21–100', wider: '100+' };
const BASE_NAME: Readonly<Record<Exclude<BaseBand, 'any'>, string>> = { low: '≤ 0.05%', mid: '0.05–0.3%', high: '> 0.3%' };

/** A row's second line: the type and the fee a trade pays now (the price step is a column of «All»). */
export function rowCaption(row: ChooseRow, w: W, lang: Lang, short = false): string {
  const parts = [TYPE_NAME[row.type]];
  // On a desk's row the fee stands bare beside the kind — «DLMM · 0,10%» whole on a laptop; its word is the
  // row's title.
  if (row.feePct !== null) parts.push(short ? feeText(row.feePct, lang) : w.feeOf(feeText(row.feePct, lang)));
  else if (row.step !== null) parts.push(w.stepOf(digits(String(row.step), lang)));
  return parts.join(' · ');
}

/**
 * A phone row's second line (G6, fault 39 — three «ANT · USDC» in a row said only what was in them): the type, the fee a
 * trade pays now — what a pool is chosen by — and a DLMM pool's price step; what is in the pool has its own column.
 */
export function phoneCaption(row: ChooseRow, w: W, lang: Lang): string {
  const parts = [TYPE_NAME[row.type], feeText(row.feePct, lang)];
  if (row.type === 'dlmm' && row.step !== null) parts.push(w.stepOf(digits(String(row.step), lang)));
  return parts.join(' · ');
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** A listed company's share or a fund the book knows — the stocks a DLMM pool takes two coins of (never a private token). */
const LISTED_STOCKS: ReadonlySet<string> = new Set(KNOWN_STOCKS.filter((stock) => stock.kind !== 'private').map((stock) => stock.mint));

/**
 * Whether a pool's position opens on its own page (G6, fault 40 — «View» on ANT · USDC read as «you cannot add here»): a
 * DLMM pool of a known stock against USDC or SOL, while the terminal offers those positions to everyone. The
 * page's own read decides the rest — a stock its issuer paused, a wallet the server does not admit.
 */
export function addsOnPage(row: Pick<ChooseRow, 'type' | 'coins' | 'act'>): boolean {
  if (DLMM_STOCKS_SCREEN !== 'open' || row.type !== 'dlmm' || row.act !== 'view') return false;
  const [x, y] = row.coins;
  const quote = (mint: string) => mint === SOL_MINT || mint === USDC_MINT;
  return (LISTED_STOCKS.has(x.mint) && quote(y.mint)) || (LISTED_STOCKS.has(y.mint) && quote(x.mint));
}

/** A row's action word: «Add» where a deposit opens — here, or on the pool's own page; else «View». */
export const actWord = (row: ChooseRow, w: W): string => (row.act !== 'view' || addsOnPage(row) ? w.add : w.view);

/**
 * A pool's own page in the terminal: every pool of Meteora has its desk — the chart, its trades and its
 * swap; a DLMM and a DLMM Pro pool its liquidity by price too. A page offers a position only where one
 * opens, so a DAMM v2 pool's page is a desk like any.
 */
export const poolPage = (row: ChooseRow): string => `/pool/${row.address}`;

/* ── one filter: a chip that opens its choices under it ─────────────────────────────────────────────────────────── */

type Option<T> = Readonly<{ id: T; label: string }>;

function Pick<T extends string | number>({ name, value, options, current, onPick, on, end = false, short = false, nameless = false, children }: { name: string; value: string; options?: readonly Option<T>[]; current?: T; onPick?: (id: T) => void; on: boolean; end?: boolean; short?: boolean; nameless?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useDismiss(open, box, () => setOpen(false));
  return (
    <div ref={box} className={e.pickBox}>
      {/* `short` — a laptop's bar says the chip's value alone; its name stays the chip's label. */}
      <button type="button" className={cx(e.chip, on && e.chipOn)} aria-expanded={open} aria-controls={open ? id : undefined} aria-label={short || nameless ? `${name}: ${value}` : undefined} data-short={short || undefined} onClick={() => setOpen((was) => !was)}>
        <span className={cx(e.chipName, nameless && e.chipNameOff)}>{name}</span>
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
const CARD_STRATEGIES: ReadonlySet<Strategy> = new Set<Strategy>(['stable', 'reward']);

const usdOptions = (steps: readonly number[], any: string, lang: Lang): Option<number>[] => steps.map((step) => ({ id: step, label: step === 0 ? any : floorText(step, 'usd', lang) }));

/**
 * The filter row: each figure a person picks a pool by, as a chip. The ones used every day stand in sight; the rare
 * ones — the day's fees, fees over depth, the price step, the base fee — open with «+ Filters», and stay open (the
 * control held) while one of them is set. `columns` is the table's own «Columns» control, beside the order.
 */
export function FilterBar({ filters, onFilters, sort, onSort, more, onMore, every, compact, hasPro, coins, columns, period, onPeriod, saved, onSaved }: { filters: Filters; onFilters: (next: Filters) => void; sort: Sort; onSort: (next: Sort) => void; more: boolean; onMore: () => void; every: boolean; compact: boolean; hasPro: boolean; coins: readonly string[]; columns?: ReactNode; period: Period; onPeriod: (next: Period) => void; saved: boolean; onSaved: () => void }) {
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
  // The orders the table's own heads give: «Main» has no column of age.
  const headSorted = every || sort.key !== 'age';
  const changed = JSON.stringify(filters) !== JSON.stringify(START_FILTERS);
  // The window the table reads: a chip like the filters' own, the venue's four windows; how it is counted —
  // in its menu, one line.
  const periodPick = (
    <Pick short name={w.period} value={w.periodName(period)} options={PERIODS.map((id) => ({ id, label: w.periodName(id) }))} current={period} onPick={onPeriod} on={period !== '24h'}>
      <p className={e.menuNote}>{w.periodWhy}</p>
    </Pick>
  );
  // «Saved»: the pools the person starred, every one of them — a pressed chip, like a strategy.
  const savedChip = (
    <button type="button" className={cx(e.chip, saved && e.chipOn)} aria-pressed={saved} aria-label={w.saved} title={w.saved} onClick={onSaved} data-earn="saved" data-short="">
      <Icon name="star" size="s" />
      <span className={e.chipName}>{w.saved}</span>
    </button>
  );
  const reset = (
    <Quiet size="s" onClick={() => onFilters(START_FILTERS)}>
      {w.fReset}
    </Quiet>
  );
  return (
    <div className={e.filtersWrap}>
    <div className={e.filters} role="group" aria-label={w.filters}>
      {/* A desk says a strategy once: the two with a card stand as cards above the row, the third as its chip here. */}
      {compact ? savedChip : null}
      {compact ? null : (
        <div className={e.strats} role="group" aria-label={w.strategies}>
          {savedChip}
          {STRATEGIES.filter((strategy) => !CARD_STRATEGIES.has(strategy)).map((strategy) => (
            <button
              key={strategy}
              type="button"
              className={cx(e.chip, filters.strategy === strategy && e.chipOn)}
              aria-pressed={filters.strategy === strategy}
              title={strategy === 'high' ? w.sHighRule(floorText(HIGH_MIN_TVL_USD, 'usd', lang).replace(/^> /, '')) : undefined}
              onClick={() => {
                onFilters(filters.strategy === strategy ? START_FILTERS : strategyFilters(strategy));
                onSort(filters.strategy === strategy ? sort : STRATEGY_SORT[strategy]);
              }}
            >
              {strategyName(strategy, w)}
              {/* «High income» counts a pool from its depth: said on the chip itself, before it is pressed (a
                  pool with a higher figure but less in it was left out by a rule nobody saw). */}
              {strategy === 'high' ? <span className={e.chipFloor}>{w.sHighFrom(floorText(HIGH_MIN_TVL_USD, 'usd', lang).replace(/^> /, ''))}</span> : null}
            </button>
          ))}
          <span className={e.stratSep} aria-hidden="true" />
        </div>
      )}
      <Pick name={w.fType} value={types.find((t) => t.id === filters.type)?.label ?? w.fAll} options={types} current={filters.type} onPick={(type) => set({ type })} on={filters.type !== 'all'} />
      {periodPick}
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
      {compact && changed ? reset : null}
      <div className={e.grow} />
      {/* A desk sorts by the table's own heads; a phone's rows have none, so its order is a chip — and a desk keeps the chip
          while the order is by a column «Main» does not show (the newest first). */}
      {compact || !headSorted ? <Pick end nameless={compact} name={w.sortBy} value={`${sortNames[sort.key]} ${sort.dir === 'desc' ? '↓' : '↑'}`} options={sorts.map((key) => ({ id: key, label: sortNames[key] }))} current={sort.key} onPick={(key) => onSort({ key, dir: 'desc' })} on={false} /> : null}
    </div>
    {/* «+ Filters», the reset and the table's own «Columns» stand at the bar's end, outside the filters: the filters wrap
        onto a second line on a laptop's desk, these stay whole and in reach. */}
    {compact ? null : (
      <div className={e.filtersEnd}>
        {changed ? reset : null}
        <button type="button" className={cx(e.chip, rare && e.chipOn)} aria-expanded={rare} aria-disabled={rareSet || undefined} data-earn="more-filters" onClick={rareSet ? undefined : onMore}>
          {`+ ${w.filters}`}
        </button>
        {columns}
      </div>
    )}
    </div>
  );
}

export function strategyName(strategy: Strategy, w: W): string {
  return strategy === 'stable' ? w.sStable : strategy === 'high' ? w.sHigh : strategy === 'reward' ? w.sReward : w.sSol;
}

/* ── the table ───────────────────────────────────────────────────────────────────────────────────────────────────── */

/* «всі пули… має бути ширше, де більше інформації, все розписано, все чітко». The
   list runs the desk's whole width, as Meteora's and DexScreener's do: by default the pool — its pair, type, step and
   fee — what is in it, the day's volume, the day's fees and those fees against what is in it, the row's one bright
   figure; «All» adds the step and the base fee as columns of their own and the pool's age. */
/* The pair's cell — its star, two logos and the pair — takes what the figures do not need: «SOL · USDC», «JitoSOL · SOL»
   stand whole on 1440 beside the ticket (G6 — they ended in «…»). */
const COLUMNS_MAIN = 'minmax(240px, 2fr) repeat(4, minmax(76px, 1fr)) 96px';
const COLUMNS_ALL = 'minmax(240px, 2fr) minmax(48px, 0.5fr) minmax(56px, 0.6fr) repeat(4, minmax(76px, 1fr)) minmax(56px, 0.6fr) 96px';
/**
 * On a narrower panel the quieter columns go a step at a time and the row's action stays whole:
 * the main set lets the volume go, then the fees; «All» first its step and age, then the base fee and the volume, then
 * the fees. The pool, what is in it, its fees to TVL and the action always stand.
 */
const FOLD_MAIN = ['minmax(240px, 2fr) repeat(3, minmax(76px, 1fr)) 96px', 'minmax(240px, 2fr) repeat(2, minmax(76px, 1fr)) 96px'] as const;
const FOLD_ALL = ['minmax(240px, 2fr) minmax(56px, 0.6fr) repeat(4, minmax(76px, 1fr)) 96px', 'minmax(240px, 2fr) repeat(3, minmax(76px, 1fr)) 96px', 'minmax(240px, 2fr) repeat(2, minmax(76px, 1fr)) 96px'] as const;

function SortHead({ id, sort, onSort, fixed = false, fold, children }: { id: SortKey; sort: Sort; onSort: (next: Sort) => void; fixed?: boolean; fold?: FoldStep; children: ReactNode }) {
  const on = sort.key === id;
  // A short list in its own fixed order (the pools under staking and lending) names its columns and sorts nothing.
  if (fixed) {
    return (
      <Cell head end fold={fold}>
        {children}
      </Cell>
    );
  }
  return (
    <Cell head end fold={fold} className={on ? e.sortOn : undefined}>
      <button type="button" className={e.sortBtn} onClick={() => onSort({ key: id, dir: on && sort.dir === 'desc' ? 'asc' : 'desc' })}>
        {children}
        {on ? <span aria-hidden="true">{sort.dir === 'desc' ? ' ↓' : ' ↑'}</span> : null}
      </button>
    </Cell>
  );
}

export function PoolsTable({ rows, every, sort, onSort, frontKey, held, onPick, nowMs, period, fixed = false }: { rows: readonly ChooseRow[]; every: boolean; sort: Sort; onSort: (next: Sort) => void; frontKey: string | null; held: boolean; onPick: (row: ChooseRow) => void; nowMs: number; period: Period; fixed?: boolean }) {
  const w = useWords(EARN);
  const lang = useLang();
  const saved = useSavedPools((st) => st.pools);
  // The step from which each quieter column goes (`FOLD_MAIN`, `FOLD_ALL`).
  const volumeFold: FoldStep = every ? 2 : 1;
  const feesFold: FoldStep = every ? 3 : 2;
  return (
    <Table columns={every ? COLUMNS_ALL : COLUMNS_MAIN} fold={every ? FOLD_ALL : FOLD_MAIN} minWidth={every ? 900 : 700} label={w.pools}>
      <TableHead>
        <Cell head>{w.cPool}</Cell>
        {every ? (
          <>
            <SortHead id="step" sort={sort} onSort={onSort} fold={1}>
              {w.cStep}
            </SortHead>
            <SortHead id="base" sort={sort} onSort={onSort} fold={2}>
              {w.cBase}
            </SortHead>
          </>
        ) : null}
        <SortHead id="tvl" sort={sort} onSort={onSort} fixed={fixed}>
          {w.inPool}
        </SortHead>
        {/* The window stands once, on the bar's own control: the heads name the figures. */}
        <SortHead id="volume" sort={sort} onSort={onSort} fixed={fixed} fold={volumeFold}>
          {w.cVolume}
        </SortHead>
        <SortHead id="fees" sort={sort} onSort={onSort} fixed={fixed} fold={feesFold}>
          {w.cFees}
        </SortHead>
        <SortHead id="feeTvl" sort={sort} onSort={onSort} fixed={fixed}>
          {w.cFeeTvlDay}
        </SortHead>
        {every ? (
          <SortHead id="age" sort={sort} onSort={onSort} fold={1}>
            {w.cAge}
          </SortHead>
        ) : null}
        <Cell head />
      </TableHead>
      {rows.map((row) => {
        const front = frontKey === pickKey(row);
        const page = poolPage(row);
        const fig = figuresOf(row, period);
        return (
          <TableRow key={row.key} current={front}>
            <span role="cell" className={e.cellPair}>
              <PoolStar row={row} on={saved.includes(row.address)} />
              <Pair coins={row.coins} />
              <span className={e.cellWords}>
                {/* The pair is the row's way to the pool's own page — never while a signature is out, when the ticket stays
                    in front. */}
                {!held ? (
                  <Link href={page} className={cx(e.sym, e.rowHit)}>
                    {row.name}
                  </Link>
                ) : (
                  <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => onPick(row)}>
                    {row.name}
                  </button>
                )}
                <span className={e.cap} title={every ? undefined : rowCaption(row, w, lang)}>{every ? TYPE_NAME[row.type] : rowCaption(row, w, lang, true)}</span>
              </span>
            </span>
            {every ? (
              <>
                <Cell end tone="dim" fold={1}>
                  {row.step === null ? '—' : digits(String(row.step), lang)}
                </Cell>
                <Cell end tone="dim" fold={2}>
                  {feeText(row.baseFeePct, lang)}
                </Cell>
              </>
            ) : null}
            <Cell end>{shortUsd(row.tvlUsd, lang)}</Cell>
            <Cell end fold={volumeFold}>
              {periodUsdText(row, fig, fig.volumeUsd, lang)}
            </Cell>
            <Cell end fold={feesFold}>
              {periodUsdText(row, fig, fig.feesUsd, lang)}
              {row.reward ? <span className={e.rewardLine}>{w.rewardDay(digits(row.reward.perDay, lang), row.reward.symbol)}</span> : null}
            </Cell>
            {/* The row's one bold figure is a fact of the window gone, in the text's own colour — never a green promise. */}
            <Cell end className={e.lead}>
              {periodPctText(row, fig, lang)}
            </Cell>
            {every ? (
              <Cell end tone="dim" fold={1}>
                {ageText(row.createdAt, lang, nowMs)}
              </Cell>
            ) : null}
            <span role="cell" className={e.cellEnd}>
              <Quiet size="s" disabled={held} onClick={() => onPick(row)} className={cx(e.rowAct, actWord(row, w) === w.view && e.viewBtn)} aria-label={`${actWord(row, w)} · ${row.name}`} data-earn-pick="">
                {actWord(row, w)}
              </Quiet>
            </span>
          </TableRow>
        );
      })}
    </Table>
  );
}

/** A window's dollars on a row: a DLMM Pro pool with no read of the window stays empty, a day read in part is «≥». */
function periodUsdText(row: ChooseRow, fig: PeriodFigures, usd: number | null, lang: Lang): string {
  return dayUsdText({ type: row.type, dayFloor: fig.floor }, usd, lang);
}

/** A window's fees over the depth on a row: a DLMM Pro pool not counted for the window stays empty, never «—» beside its day. */
function periodPctText(row: ChooseRow, fig: PeriodFigures, lang: Lang): string {
  return fig.feeTvlPct === null && row.type === 'pro' ? '' : dayPctText(fig.feeTvlPct, lang);
}

/** A row's star: the pool joins the person's «Saved», kept in this browser. Over the row's own link. */
function PoolStar({ row, on }: { row: ChooseRow; on: boolean }) {
  const w = useWords(EARN);
  return (
    <button
      type="button"
      className={e.star}
      aria-pressed={on}
      aria-label={`${on ? w.unsave : w.save} · ${row.name}`}
      title={on ? w.unsave : w.save}
      onClick={(event) => {
        event.stopPropagation();
        toggleSavedPool(row.address);
      }}
      data-earn-star=""
    >
      <Icon name="star" size="s" />
    </button>
  );
}

/** The ticket a row opens: the city's add, DLMM Pro's, or the pool's own figures. */
export function pickKey(row: ChooseRow): string {
  return row.act === 'add' ? `pool:${row.address}` : row.act === 'pro' ? `pro:${row.address}` : `view:${row.address}`;
}

/**
 * The phone's list: the pair with its type, fee and step, what is in the pool in its own column, and a day's fees over
 * the depth and in dollars — under one quiet head that says what each column is, as a table's head does on a desk
 * (two numbers stood on the right with no name; G6, fault 39: the fee was not in sight).
 */
export function PhoneRows({ rows, held, onPick, period }: { rows: readonly ChooseRow[]; held: boolean; onPick: (row: ChooseRow) => void; period: Period }) {
  const w = useWords(EARN);
  const lang = useLang();
  const saved = useSavedPools((st) => st.pools);
  return (
    <div className={e.pList}>
      <div className={cx(e.pListHead, e.pHeadGrid)} aria-hidden="true">
        <span className={e.grow}>{w.cPool}</span>
        <span className={e.pMid}>{w.inPool}</span>
        <span className={e.pSideHead}>{w.phoneFees}</span>
      </div>
      {rows.map((row) => {
        const fig = figuresOf(row, period);
        return (
        <div key={row.key} className={cx(e.pRow, e.pRowGrid)}>
          <PoolStar row={row} on={saved.includes(row.address)} />
          <Pair coins={row.coins} />
          <span className={e.pMain}>
            <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => onPick(row)} data-earn-pick="">
              {row.name}
            </button>
            <span className={e.cap}>{phoneCaption(row, w, lang)}</span>
          </span>
          <span className={e.pMid}>{tightUsd(row.tvlUsd, lang)}</span>
          {/* The desk's own measure, in the same words and the text's own colour. */}
          <span className={e.pSide}>
            <span>{periodPctText(row, fig, lang)}</span>
            <span className={e.cap}>{periodUsdText(row, fig, fig.feesUsd, lang)}</span>
            {row.reward ? <span className={e.rewardLine}>{w.rewardDay(digits(row.reward.perDay, lang), row.reward.symbol)}</span> : null}
          </span>
        </div>
        );
      })}
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
