import { EARN_PERIODS, type EarnLendRate, type EarnPeriod, type EarnPeriodFigures, type EarnPool } from '../../lib/earn-pools/model.ts';
import type { HarborPool } from '../../city/lib/districts/harbor/pools.ts';
import { LSTS, SOL_MINT } from '../../city/lib/earn/lst.ts';
import { proReward, type ProPier } from '../../city/lib/earn/pro.ts';
import { digits } from '../../city/lib/i18n/dict.ts';
import type { Lang } from '../../city/lib/i18n/langs.ts';
import { shortUsd, type Coin, type PoolRow, type StakeRow } from './rows.ts';

/**
 * Choosing a pool: every Meteora pool the engine reads (DLMM and DAMM v2, and DLMM Pro where the server
 * serves it) as one row, the filters and the orders a person picks by, and the ready strategies. A row is one of three:
 * a pool the city's own flow adds to (`add`), a DLMM Pro pool that takes deposits (`pro`), or a pool shown to compare —
 * its figures and its page (`view`). Which pools take money from here is the city's gate, not this file's.
 *
 * Pure: the screen and the tests read it alike.
 */

export type PoolType = 'dlmm' | 'damm-v2' | 'pro';
export type RowAct = 'add' | 'pro' | 'view';

export type ChooseRow = Readonly<{
  key: string;
  type: PoolType;
  address: string;
  /** «SOL · USDC» in the venue's order. */
  name: string;
  coins: readonly [Coin, Coin];
  verified: boolean;
  tvlUsd: number | null;
  volume24hUsd: number | null;
  fees24hUsd: number | null;
  /** A day's fees over what the pool holds, per cent. */
  feeTvlPct: number | null;
  baseFeePct: number | null;
  feePct: number | null;
  /** DLMM's price step (bps), DLMM Pro's tick spacing; null for DAMM v2. */
  step: number | null;
  createdAt: string | null;
  page: string | null;
  act: RowAct;
  /** The pool's own reward, a second line of income beside its fees: so much a day of a coin of its own (DLMM Pro's liquidity mining). */
  reward?: Readonly<{ perDay: string; symbol: string }> | null;
  /** A DLMM Pro pool whose day was read only in part: its volume and fees are a floor of the day's, said with «≥». */
  dayFloor?: boolean;
  /** The venue's shorter windows: volume and fees over the last 30 minutes, hour and two hours, where read. */
  periods?: Readonly<Partial<Record<EarnPeriod, EarnPeriodFigures>>>;
}>;

const pairName = (x: Readonly<{ symbol: string }>, y: Readonly<{ symbol: string }>) => `${x.symbol} · ${y.symbol}`;

function fromPool(pool: EarnPool, addable: boolean): ChooseRow {
  return {
    key: `${pool.kind}:${pool.address}`,
    type: pool.kind,
    address: pool.address,
    name: pairName(pool.x, pool.y),
    coins: [
      { mint: pool.x.mint, symbol: pool.x.symbol },
      { mint: pool.y.mint, symbol: pool.y.symbol },
    ],
    verified: pool.x.verified && pool.y.verified,
    tvlUsd: pool.tvlUsd,
    volume24hUsd: pool.volume24hUsd,
    fees24hUsd: pool.fees24hUsd,
    feeTvlPct: pool.feeTvl24hPct,
    baseFeePct: pool.baseFeePct,
    feePct: pool.feePct,
    step: pool.binStepBps,
    createdAt: pool.createdAt,
    page: pool.page,
    act: addable ? 'add' : 'view',
  };
}

/** A day's fees over what the pool holds, per cent; null where either was not read. */
const feeTvlOf = (fees24hUsd: number | null, tvlUsd: number): number | null => (fees24hUsd !== null && tvlUsd > 0 ? (fees24hUsd / tvlUsd) * 100 : null);

/**
 * A pool the city adds to, as the catalogue lists it, with the figures of the city's own read: the ticket
 * that opens from the row stands on that read, so the row and the ticket say one figure of one moment — never the
 * catalogue's of a minute ago beside the ticket's of now.
 */
function withHarbor(row: ChooseRow, pool: HarborPool): ChooseRow {
  return { ...row, tvlUsd: pool.tvlUsd, volume24hUsd: pool.volume24hUsd, fees24hUsd: pool.fees24hUsd, feeTvlPct: feeTvlOf(pool.fees24hUsd, pool.tvlUsd), feePct: pool.feePct };
}

/** A city pool the catalogue did not carry (an LST pair read by its own look-up): the Harbor's figures. */
function fromHarbor(pool: HarborPool): ChooseRow {
  const feeTvl = feeTvlOf(pool.fees24hUsd, pool.tvlUsd);
  return {
    key: `${pool.kind}:${pool.address}`,
    type: pool.kind,
    address: pool.address,
    name: pairName(pool.x, pool.y),
    coins: [
      { mint: pool.x.mint, symbol: pool.x.symbol },
      { mint: pool.y.mint, symbol: pool.y.symbol },
    ],
    verified: true,
    tvlUsd: pool.tvlUsd,
    volume24hUsd: pool.volume24hUsd,
    fees24hUsd: pool.fees24hUsd,
    feeTvlPct: feeTvl,
    baseFeePct: null,
    feePct: pool.feePct,
    step: pool.binStepBps,
    createdAt: null,
    page: null,
    act: 'add',
  };
}

function fromPro(pier: ProPier, row: PoolRow | undefined): ChooseRow {
  return {
    key: `pro:${pier.address}`,
    type: 'pro',
    address: pier.address,
    name: pairName(pier.x, pier.y),
    coins: [
      { mint: pier.x.mint, symbol: pier.x.symbol },
      { mint: pier.y.mint, symbol: pier.y.symbol },
    ],
    verified: true,
    tvlUsd: row?.depthUsd ?? null,
    volume24hUsd: null,
    fees24hUsd: null,
    feeTvlPct: null,
    baseFeePct: pier.feeBps / 100,
    feePct: pier.feeBps / 100,
    step: pier.tickSpacing,
    createdAt: null,
    page: null,
    act: pier.takesDeposits ? 'pro' : 'view',
    reward: proReward(pier),
  };
}

/** What a DLMM Pro pool's day says, from the program's own trades (`terminal/pool/pro-tape.ts`). */
export type ProDayFigures = Readonly<{ volumeUsd: number | null; lpFeesUsd: number | null; whole: boolean }>;

/**
 * DLMM Pro's rows with their day, where it was read: the volume, what the swaps paid the pool's liquidity — the figure a
 * depositor earns from, as the other pools' «Fees 24h» —, and the day's fees over the depth only for a whole day. A pool
 * whose day was not read keeps its places empty.
 */
export function withProDays(rows: readonly ChooseRow[], days: ReadonlyMap<string, ProDayFigures>): ChooseRow[] {
  return rows.map((row) => {
    const day = row.type === 'pro' ? days.get(row.address) : undefined;
    if (!day) return row;
    const feeTvlPct = day.whole && row.tvlUsd !== null ? feeTvlOf(day.lpFeesUsd, row.tvlUsd) : null;
    return { ...row, volume24hUsd: day.volumeUsd, fees24hUsd: day.lpFeesUsd, feeTvlPct, dayFloor: !day.whole };
  });
}

export type ChooseInput = Readonly<{
  /** The engine's catalogue, as `/api/v1/earn/pools` answered; empty when it did not. */
  catalog: readonly EarnPool[];
  /** The city's own pools, which its flow adds to. */
  harbor: readonly HarborPool[];
  /** Whether this wallet (or a guest) is offered the city's add. */
  addOpen: boolean;
  proPiers: readonly ProPier[];
  /** The screen's rows of the same pools, for the Pro pools' depth in dollars. */
  rows: readonly PoolRow[];
}>;

/** Every pool as one row: the catalogue's, the city's pools it did not carry, and DLMM Pro's. */
export function chooseRows(input: ChooseInput): ChooseRow[] {
  const city = new Map(input.harbor.map((pool) => [pool.address, pool]));
  const out = input.catalog.map((pool) => {
    const own = city.get(pool.address);
    return own ? withHarbor(fromPool(pool, input.addOpen), own) : fromPool(pool, false);
  });
  const listed = new Set(out.map((row) => row.address));
  for (const pool of input.harbor) if (!listed.has(pool.address)) out.push(input.addOpen ? fromHarbor(pool) : { ...fromHarbor(pool), act: 'view' });
  for (const pier of input.proPiers) out.push(fromPro(pier, input.rows.find((row) => row.kind === 'pro' && row.address === pier.address)));
  return out;
}

/* ── the window the table reads ───────────────────────────────────────────────────────────────────────── */

/** The windows of the pools' table: the venue's own, the shortest half an hour; a day is where the table starts. */
export const PERIODS = EARN_PERIODS;
export type Period = EarnPeriod;
export const START_PERIOD: Period = '24h';

/** What a row says in a window: volume, fees, and those fees over what the pool holds now (per cent of the window). */
export type PeriodFigures = Readonly<{ volumeUsd: number | null; feesUsd: number | null; feeTvlPct: number | null; floor: boolean }>;

/**
 * A row's figures in a window. The day is the row's own (the catalogue's, the city's read, DLMM Pro's from its trades);
 * a shorter window is the venue's where it stated one, else empty — DLMM Pro's pools are counted by the day alone, and
 * an empty place is never a zero. Fees over the depth are those fees over what the pool holds now: a fact of the window
 * gone, never a rate promised.
 */
export function figuresOf(row: ChooseRow, period: Period): PeriodFigures {
  if (period === '24h') return { volumeUsd: row.volume24hUsd, feesUsd: row.fees24hUsd, feeTvlPct: row.feeTvlPct, floor: row.dayFloor === true };
  const read = row.type === 'pro' ? undefined : row.periods?.[period];
  const feesUsd = read?.feesUsd ?? null;
  return { volumeUsd: read?.volumeUsd ?? null, feesUsd, feeTvlPct: row.tvlUsd !== null ? feeTvlOf(feesUsd, row.tvlUsd) : null, floor: false };
}

/** The rows with the venue's windows, by pool; a pool the answer did not carry keeps its day alone. */
export function withPeriods(rows: readonly ChooseRow[], periods: ReadonlyMap<string, Readonly<Partial<Record<Period, EarnPeriodFigures>>>>): ChooseRow[] {
  if (!periods.size) return [...rows];
  return rows.map((row) => {
    const read = row.type === 'pro' ? undefined : periods.get(row.address);
    return read ? { ...row, periods: read } : row;
  });
}

/* ── the person's own pools ───────────────────────────────────────────────────────────────────────────── */

/** «Saved»: the pools a person starred, every one of them — the person chose them, no filter hides one. */
export function savedRows(rows: readonly ChooseRow[], saved: readonly string[]): ChooseRow[] {
  const kept = new Set(saved);
  return rows.filter((row) => kept.has(row.address));
}

/* ── filters ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

export const STEP_BANDS = ['any', 'tight', 'mid', 'wide', 'wider'] as const;
export type StepBand = (typeof STEP_BANDS)[number];
const STEP_RANGE: Readonly<Record<Exclude<StepBand, 'any'>, readonly [number, number]>> = { tight: [1, 5], mid: [6, 20], wide: [21, 100], wider: [101, Infinity] };

export const BASE_BANDS = ['any', 'low', 'mid', 'high'] as const;
export type BaseBand = (typeof BASE_BANDS)[number];
const BASE_RANGE: Readonly<Record<Exclude<BaseBand, 'any'>, readonly [number, number]>> = { low: [0, 0.05], mid: [0.0500001, 0.3], high: [0.3000001, Infinity] };

export const STRATEGIES = ['stable', 'high', 'sol', 'reward'] as const;
export type Strategy = (typeof STRATEGIES)[number];

export type Filters = Readonly<{
  type: 'all' | PoolType;
  /** A coin's symbol or mint; empty — any. */
  coin: string;
  minTvl: number;
  minVolume: number;
  minFees: number;
  /** Per cent of a day. */
  minFeeTvl: number;
  step: StepBand;
  base: BaseBand;
  verified: boolean;
  strategy: Strategy | null;
}>;

/** The approved design's start: deep, traded, verified pools. */
export const START_FILTERS: Filters = { type: 'all', coin: '', minTvl: 50_000, minVolume: 50_000, minFees: 0, minFeeTvl: 0, step: 'any', base: 'any', verified: true, strategy: null };

export const TVL_STEPS = [0, 50_000, 100_000, 1_000_000, 10_000_000] as const;
export const VOLUME_STEPS = [0, 50_000, 1_000_000, 10_000_000] as const;
export const FEES_STEPS = [0, 1_000, 10_000] as const;
export const FEE_TVL_STEPS = [0, 0.1, 0.5, 1] as const;

/** Big, liquid coins and dollars: a pair of two of them moves least. */
const STABLE_SYMBOLS = new Set(['SOL', 'USDC', 'USDT', 'JUPUSD', 'PYUSD', 'USDS', 'USDG', 'EURC', 'JUPSOL', 'JITOSOL', 'INF', 'MSOL', 'BSOL', 'DSOL', 'HSOL', 'CBBTC', 'WBTC', 'ETH', 'WETH']);
const STABLE_MINTS = new Set(LSTS.map((lst) => lst.mint));
const stableCoin = (coin: Coin) => STABLE_MINTS.has(coin.mint) || STABLE_SYMBOLS.has(coin.symbol.toUpperCase());

/** Whether a row belongs to a strategy. «High» is a depth and an order, not a set. */
export function inStrategy(row: ChooseRow, strategy: Strategy): boolean {
  if (strategy === 'stable') return stableCoin(row.coins[0]) && stableCoin(row.coins[1]);
  if (strategy === 'sol') return row.coins.some((coin) => coin.mint === SOL_MINT);
  // «Pool reward»: the pools of DLMM Pro that take a deposit from here — one position the agent can look after, and the pool's own reward beside its fees.
  if (strategy === 'reward') return row.type === 'pro' && row.act !== 'view';
  return (row.tvlUsd ?? 0) >= HIGH_MIN_TVL_USD;
}

/** «High income» counts a pool from this deep: below it a day's luck tops the list (the catalogue's own line). */
export const HIGH_MIN_TVL_USD = 100_000;

/**
 * A floor: a figure under it fails. A figure the venue did not state fails too — except on a pool that takes a deposit
 * from here (the city's own, DLMM Pro, read from the chain with no day's volume): those are never hidden for a figure
 * nobody can give.
 */
const atLeast = (row: ChooseRow, value: number | null, floor: number) => floor <= 0 || (value === null ? row.act !== 'view' : value >= floor);
const inBand = (value: number | null, band: readonly [number, number]) => value !== null && value >= band[0] && value <= band[1];

/** Whether a search matches: a coin's address or the pool's own exactly, or a coin's symbol from its start. */
export function coinMatch(row: ChooseRow, coin: string): boolean {
  const needle = coin.trim().toLowerCase();
  if (!needle) return true;
  if (row.address.toLowerCase() === needle) return true;
  return row.coins.some((entry) => entry.mint.toLowerCase() === needle || entry.symbol.toLowerCase().startsWith(needle));
}

/** The rows a filter lets through. A figure nobody stated never passes a floor above zero. */
export function filterRows(rows: readonly ChooseRow[], f: Filters): ChooseRow[] {
  return rows.filter(
    (row) =>
      (f.type === 'all' || row.type === f.type) &&
      coinMatch(row, f.coin) &&
      atLeast(row, row.tvlUsd, f.minTvl) &&
      atLeast(row, row.volume24hUsd, f.minVolume) &&
      atLeast(row, row.fees24hUsd, f.minFees) &&
      atLeast(row, row.feeTvlPct, f.minFeeTvl) &&
      (f.step === 'any' || inBand(row.step, STEP_RANGE[f.step])) &&
      (f.base === 'any' || inBand(row.baseFeePct, BASE_RANGE[f.base])) &&
      (!f.verified || row.verified) &&
      (f.strategy === null || inStrategy(row, f.strategy)),
  );
}

/* ── orders ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

export const SORT_KEYS = ['fees', 'feeTvl', 'tvl', 'volume', 'age', 'step', 'base'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type Sort = Readonly<{ key: SortKey; dir: 'desc' | 'asc' }>;
export const START_SORT: Sort = { key: 'fees', dir: 'desc' };

const sortValue = (row: ChooseRow, key: SortKey, period: Period): number | null => {
  switch (key) {
    case 'fees':
      return figuresOf(row, period).feesUsd;
    case 'feeTvl':
      return figuresOf(row, period).feeTvlPct;
    case 'tvl':
      return row.tvlUsd;
    case 'volume':
      return figuresOf(row, period).volumeUsd;
    case 'age': {
      const at = row.createdAt ? Date.parse(row.createdAt) : NaN;
      // Newest first reads «desc»: a later date is a younger pool.
      return Number.isFinite(at) ? at : null;
    }
    case 'step':
      return row.step;
    case 'base':
      return row.baseFeePct;
  }
};

/**
 * Rows in an order, by the window the table reads (the day by default); a figure nobody stated goes last either way; ties
 * fall to the depth, then to the address.
 */
export function sortRows(rows: readonly ChooseRow[], sort: Sort, period: Period = START_PERIOD): ChooseRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const va = sortValue(a, sort.key, period);
    const vb = sortValue(b, sort.key, period);
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1;
    } else if (va !== vb) return sign * (va - vb);
    const depth = (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1);
    return depth !== 0 ? depth : a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
  });
}

/** A strategy's own order: «High income» by a day's fees over the depth; the others by a day's fees. */
export const STRATEGY_SORT: Readonly<Record<Strategy, Sort>> = { stable: { key: 'fees', dir: 'desc' }, high: { key: 'feeTvl', dir: 'desc' }, sol: { key: 'fees', dir: 'desc' }, reward: { key: 'tvl', dir: 'desc' } };

/** A strategy's filter: the start's floors, its own set. */
export function strategyFilters(strategy: Strategy): Filters {
  // The chain gives a DLMM Pro pool its depth but no day's volume: «Pool reward» keeps no floor a young pool cannot meet.
  if (strategy === 'reward') return { ...START_FILTERS, minTvl: 0, minVolume: 0, strategy };
  return { ...START_FILTERS, minTvl: strategy === 'high' ? HIGH_MIN_TVL_USD : START_FILTERS.minTvl, strategy };
}

/**
 * The pool a strategy's card names: «High income» its top pool, whatever it is; the others the first that takes a
 * deposit from here, else the first.
 */
export function strategyPick(rows: readonly ChooseRow[], strategy: Strategy): ChooseRow | null {
  const ranked = sortRows(filterRows(rows, strategyFilters(strategy)), STRATEGY_SORT[strategy]);
  if (strategy === 'high') return ranked[0] ?? null;
  // A pool whose reward runs names the card first.
  if (strategy === 'reward') return ranked.find((row) => row.reward) ?? ranked[0] ?? null;
  return ranked.find((row) => row.act !== 'view') ?? ranked[0] ?? null;
}

/** The staked SOL coin with the highest rate now. */
export function bestStake(stakes: readonly StakeRow[]): StakeRow | null {
  return stakes.reduce<StakeRow | null>((best, row) => (best === null || row.apyPct > best.apyPct ? row : best), null);
}

/** A lending market by its coin. */
export function lendOf(rates: readonly EarnLendRate[], symbol: string): EarnLendRate | null {
  return rates.find((rate) => rate.symbol.toUpperCase() === symbol.toUpperCase()) ?? null;
}

/* ── words of figures ────────────────────────────────────────────────────────────────────────────────────────────── */

/** A day's fees over the depth: «0.32%», a third place under a tenth. */
export function dayPctText(pct: number | null, lang: Lang): string {
  if (pct === null || !Number.isFinite(pct)) return '—';
  return digits(`${pct.toFixed(pct > 0 && pct < 0.1 ? 3 : 2)}%`, lang);
}

const AGE_WORDS: Readonly<Record<Lang, Readonly<{ d: string; m: string; y: string; new: string }>>> = {
  en: { d: 'd', m: 'mo', y: 'y', new: 'new' },
  uk: { d: 'дн', m: 'міс', y: 'р', new: 'нов.' },
} as Readonly<Record<Lang, Readonly<{ d: string; m: string; y: string; new: string }>>>;

/** A pool's age, short: «32 d», «13 mo», «3 y»; «—» when the venue did not state it. */
export function ageText(createdAt: string | null, lang: Lang, nowMs: number): string {
  const at = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(at) || !(nowMs > 0)) return '—';
  const days = Math.max(0, Math.floor((nowMs - at) / 86_400_000));
  const w = AGE_WORDS[lang] ?? AGE_WORDS.en;
  if (days < 1) return w.new;
  if (days < 60) return digits(`${days} ${w.d}`, lang);
  if (days < 730) return digits(`${Math.floor(days / 30.44)} ${w.m}`, lang);
  return digits(`${Math.floor(days / 365.25)} ${w.y}`, lang);
}

/**
 * A day's dollars as a row of the pools says them: a DLMM Pro pool whose day was not read stays empty — the read is
 * that pool's own and never a zero — and a day read only in part is a floor, «≥ $1.2K».
 */
export function dayUsdText(row: Pick<ChooseRow, 'type' | 'dayFloor'>, usd: number | null, lang: Lang): string {
  if (usd === null) return row.type === 'pro' ? '' : shortUsd(null, lang);
  return row.dayFloor ? `≥ ${shortUsd(usd, lang)}` : shortUsd(usd, lang);
}

/** A floor as the chip says it: «> $50K», «> 0.1%». */
export function floorText(value: number, kind: 'usd' | 'pct', lang: Lang): string {
  if (kind === 'pct') return digits(`> ${value}%`, lang);
  const short = value >= 1e6 ? `$${value / 1e6}M` : value >= 1e3 ? `$${value / 1e3}K` : `$${value}`;
  return digits(`> ${short}`, lang);
}
