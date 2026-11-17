import type { LaunchMarketRow, LaunchPresetView } from '../../lib/api/v1/contract.ts';
import type { FieldProblem, FormCheck } from '../../lib/launch/form.ts';
import { bookOf, parse, type Command } from '../../city/lib/command/parse.ts';
import { wordsNow, type Same } from '../../city/lib/i18n/dict.ts';
import { POOL_FEE, POOL_LADDER, POOL_SPLIT, phaseAt, poolChoiceOf, type PoolChoice, type PoolListed } from '../../city/lib/launch/pool.ts';
import { poolAskOf, withoutPoolWords } from '../../city/lib/launch/pool-ask.ts';
import { readRefusal, type LaunchFailure, type Refusal } from '../../city/lib/launch/refusal.ts';
import { sameOriginImage } from '../../city/lib/launch/towers.ts';
import { REFUSAL_WORDS } from '../../city/lib/launch/words.ts';
import type { Tower } from '../../city/lib/market/types.ts';
import { listed } from '../market/market-view.ts';
import type { LAUNCH_SCREEN } from './words.ts';

/**
 * The Launch screen's rules, over the city's own launch logic (`city/lib/launch/**`): which way a launch goes, what its
 * tiles and its one line say, what people will see on its card, which launches are new on the market and which are the
 * creator's, and how a stopped launch is said in the terminal's words. Every figure is the engine's — its presets, its
 * format's terms, its lists; nothing here counts a fee, builds or signs.
 *
 * Pure: the screen and the tests read it as it is.
 */

type W = Same<(typeof LAUNCH_SCREEN)['en']>;

/** The two ways a coin starts: on its curve (the launch every deployment serves), or straight into its own pool. */
export type Format = 'curve' | 'pool';

/** The way the launch goes: into a pool while that door is open here and the creator chose it; on its curve otherwise. */
export function formatOf(choice: PoolChoice | null, poolOpen: boolean): Format {
  return poolOpen && choice !== null ? 'pool' : 'curve';
}

/** How many times the creator's wallet signs: once on the curve; the coin, the pool and the supply for a pool. */
export function signaturesOf(format: Format): number {
  return format === 'pool' ? 3 : 1;
}

/**
 * The creator's part of the fees, in basis points: the locked liquidity's split for a pool, the part of every trading
 * fee on the curve — the engine's own figures. Null where the engine did not say it.
 */
export function shareBpsOf(format: Format, preset: Pick<LaunchPresetView, 'terms'> | null): number | null {
  if (format === 'pool') return POOL_SPLIT.creatorBps;
  return preset?.terms?.curveSplit.creatorBps ?? null;
}

/** The creator's part of a fee paid through Ryntra, as the line before the signature says it (the city's own line). */
export function lineShareBpsOf(preset: Pick<LaunchPresetView, 'terms'> | null): number | null {
  return preset?.terms?.curveSplitThroughRyntra.creatorBps ?? preset?.terms?.curveSplit.creatorBps ?? null;
}

/** What the first buyers pay: a fee that falls over the first seconds on the curve, or as the price grows in a pool. */
export type Sniper = Readonly<{ startBps: number; endBps: number; seconds: number | null; multiple: number | null }>;

export function sniperOf(format: Format, preset: Pick<LaunchPresetView, 'sniperFee'> | null): Sniper | null {
  if (format === 'pool') return { startBps: POOL_FEE.startBps, endBps: POOL_FEE.endBps, seconds: null, multiple: POOL_FEE.priceMultiple };
  return preset ? { startBps: preset.sniperFee.startBps, endBps: preset.sniperFee.endBps, seconds: preset.sniperFee.seconds, multiple: null } : null;
}

/** The ladder's share of the supply and where it sells, as multiples of the first price — the format's own terms. */
export const LADDER = POOL_LADDER;

/** Who earns the locked liquidity's fees in a pool, basis points — the format's own split. */
export const POOL_SPLIT_BPS = { creator: POOL_SPLIT.creatorBps, ryntra: POOL_SPLIT.ryntraBps } as const;

/**
 * About what a launch into a pool leaves with the network before its first step is built: the city's figure, measured
 * on the program (rent of the pool and the locked positions). The step's own figure replaces it at the first build.
 */
export const POOL_COST_ABOUT_LAMPORTS = '100000000';

/** The network deposit a tile shows: the pool's step figure (or about it), the curve's simulated cost — null until said. */
export function costOf(format: Format, curve: string | null, pool: string | null): string | null {
  if (format === 'pool') return pool !== null && /^\d+$/.test(pool) ? pool : POOL_COST_ABOUT_LAMPORTS;
  return curve !== null && /^\d+$/.test(curve) ? curve : null;
}

/** Lamports as a figure of SOL, rounded up so it is never less than the network takes: two places, four below 0.01. */
export function solOf(lamports: string): number {
  const value = Number(lamports);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 10_000_000 ? Math.ceil(value / 10_000_000) / 100 : Math.ceil(value / 100_000) / 10_000;
}

/** A wait as a clock: «03:51:20», hours unbounded; never negative. */
export function clockLeft(seconds: number): string {
  const left = Math.max(0, Math.floor(seconds));
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(Math.floor(left / 3_600))}:${two(Math.floor((left % 3_600) / 60))}:${two(left % 60)}`;
}

/** Which day a moment falls on, as the creator's own clock reads it: today, tomorrow, or later. */
export function dayOf(at: number, now: number): 'today' | 'tomorrow' | 'later' {
  const day = new Date(at * 1000);
  const today = new Date(now * 1000);
  if (day.toDateString() === today.toDateString()) return 'today';
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  return day.toDateString() === tomorrow.toDateString() ? 'tomorrow' : 'later';
}

/* ------------------------------------------------------------------ the form */

export type Field = 'name' | 'symbol' | 'picture';
export type Shown = Readonly<{ field: Field; words: string }>;

/**
 * The first thing to fix, in one line — the city's own order: a bad or borrowed name at once, an empty field only after
 * the first press, then the picture, then the engine's own refusal of the stored picture or name.
 */
export function problemOf(w: W, check: Pick<FormCheck, 'problems' | 'hits'>, picture: Readonly<{ has: boolean; bad: boolean }>, attempted: boolean, refused: Shown | null): Shown | null {
  const words = (field: 'name' | 'symbol', problem: FieldProblem): string => {
    if (problem === 'BORROWED') return w.readsAs(check.hits.find((hit) => hit.field === field)?.label ?? w.aKnownName);
    if (problem === 'OFFENSIVE') return field === 'name' ? w.anotherName : w.anotherTicker;
    if (problem === 'TOO_LONG') return field === 'name' ? w.nameLong : w.tickerLong;
    if (problem === 'SYMBOL_CHARS') return w.tickerChars;
    return field === 'name' ? w.nameIt : w.tickerIt;
  };
  for (const field of ['name', 'symbol'] as const) {
    const problem = check.problems[field];
    if (problem && (problem !== 'REQUIRED' || attempted)) return { field, words: words(field, problem) };
  }
  if (picture.bad) return { field: 'picture', words: w.pictureKind };
  if (attempted && !picture.has) return { field: 'picture', words: w.pictureNeeded };
  return refused;
}

/* ------------------------------------------------------------------ the agent's sentence */

/** The command line reads whether a pool was asked for, never when (the city's own epoch for it). */
const POOL_EPOCH = new Date(0);

/**
 * A sentence handed from the agent's line, read again for the pool's words: «… в пул о 20:00» keeps its name and ticker
 * clean — a coin's name is written on chain for ever — and, where the pool's door is open, its time and pair go to the
 * form. Where that door is shut the launch goes on its curve, without the pool's words in its name.
 */
export function launchCommandOf(said: string, command: Command, towers: readonly Tower[], poolOpen: boolean): Command {
  if (command.kind !== 'launch' || !poolAskOf(said, POOL_EPOCH).asked) return command;
  if (poolOpen) {
    const again = parse(said, bookOf(towers), { subject: null, pools: true });
    return again.kind === 'launch' ? again : command;
  }
  const plain = withoutPoolWords(said);
  const again = plain ? parse(plain, bookOf(towers), { subject: null }) : null;
  return again?.kind === 'launch' ? again : command;
}

/** What a sentence writes into the form: the ticker and the name it said, and the pool's choice where its door is open. */
export type Fill = Readonly<{ symbol: string | null; name: string | null; pool: PoolChoice | null }>;

export function fillOf(draft: Readonly<{ symbol: string | null; name: string | null; pool?: string }>, poolOpen: boolean, now: Date): Fill {
  return { symbol: draft.symbol, name: draft.name, pool: draft.pool && poolOpen ? poolChoiceOf(draft.pool, now) : null };
}

/* ------------------------------------------------------------------ a stopped launch */

/**
 * A stopped launch in the terminal's words: the city's reading of the engine's code — one sentence, the money, one
 * way on — with the few sentences that name the city said plainly, and the pool's «the whole launch needs more SOL».
 */
export function refusalOf(w: W, failure: LaunchFailure, wallet: string | null, at: Date | null): Refusal {
  const base = readRefusal(failure, wallet, at);
  // A pool's later step refused for SOL stops the launch half-way: it waits for «Continue», and says what it needs.
  const lowHalfWay = failure.code === 'POOL_HALF_WAY' && /^LAUNCH_BALANCE_LOW\b/.test(failure.message);
  const said =
    failure.code === 'LAUNCH_BALANCE_LOW'
      ? { ...base, kind: 'lowSol' as const, what: w.lowSol, action: 'topUp' as const, act: wordsNow(REFUSAL_WORDS).actTopUp }
      : lowHalfWay
        ? { ...base, what: w.lowSol }
        : base.kind === 'closed'
          ? { ...base, what: w.closed }
          : base;
  if (said.moneyKind === 'maybeLanded') return { ...said, money: w.maybeLanded };
  if (said.moneyKind === 'landing') return { ...said, money: w.landing };
  return said;
}

/* ------------------------------------------------------------------ the lists */

/** The launches new on the market, newest first: the market's own «New» launches (the coins launched in the last hours). */
export function freshLaunches(towers: readonly Tower[], max = Number.POSITIVE_INFINITY): Tower[] {
  return listed(towers)
    .filter((tower) => tower.district === 'docks')
    .sort((a, b) => (Date.parse(b.launchedAt ?? '') || 0) - (Date.parse(a.launchedAt ?? '') || 0))
    .slice(0, max);
}

/** A figure of a tower the market measured, or null — an unmeasured figure is never shown as zero. */
export function measured(tower: Tower, figure: 'holders' | 'mcap'): number | null {
  if (tower.unread?.includes(figure)) return null;
  const value = tower[figure];
  return Number.isFinite(value) && value > 0 ? value : null;
}

export type Age = Readonly<{ unit: 'now' | 'min' | 'hour' | 'day'; n: number }>;

/** How long ago a coin launched: «just now» in its first two minutes, then minutes, hours, days. */
export function ageOf(launchedAt: string | null, now: number): Age | null {
  const at = Date.parse(launchedAt ?? '');
  if (!Number.isFinite(at)) return null;
  const seconds = Math.max(0, (now - at) / 1000);
  if (seconds < 120) return { unit: 'now', n: 0 };
  if (seconds < 3_600) return { unit: 'min', n: Math.floor(seconds / 60) };
  if (seconds < 86_400) return { unit: 'hour', n: Math.floor(seconds / 3_600) };
  return { unit: 'day', n: Math.floor(seconds / 86_400) };
}

export function ageText(w: W, age: Age | null): string | null {
  if (!age) return null;
  if (age.unit === 'now') return w.justNow;
  return age.unit === 'min' ? w.minutesAgo(age.n) : age.unit === 'hour' ? w.hoursAgo(age.n) : w.daysAgo(age.n);
}

/** A coin the creator launched: on its curve — its way to the pool —, or in its own pool — its opening. */
export type Mine = Readonly<{
  token: string;
  symbol: string;
  name: string;
  image: string | null;
  kind: 'curve' | 'pool';
  /** The curve's way to the pool, 0…10 000; null when not read. */
  progressBps: number | null;
  migrated: boolean;
  /** When a pool's trading opens, unix seconds. */
  opensAt: number | null;
  phase: 'BUILDING' | 'COUNTDOWN' | 'OPEN' | null;
  at: number;
}>;

/** The creator's coins: the engine's list of launches on the curve and of launches into a pool, newest first. */
export function mineOf(rows: readonly LaunchMarketRow[] | null, pools: readonly PoolListed[], creator: string | null, now: number): Mine[] {
  if (!creator) return [];
  const curve: Mine[] = (rows ?? [])
    .filter((row) => row.creator === creator)
    .map((row) => ({
      token: row.token,
      symbol: row.symbol,
      name: row.name,
      image: row.hidden ? null : sameOriginImage(row.image),
      kind: 'curve',
      progressBps: row.progress?.bps ?? null,
      migrated: row.progress?.migrated === true,
      opensAt: null,
      phase: null,
      at: Date.parse(row.launchedAt) || 0,
    }));
  const pooled: Mine[] = pools
    .filter((launch) => launch.creator === creator)
    .map((launch) => ({
      token: launch.mint,
      symbol: launch.symbol,
      name: launch.name,
      image: null,
      kind: 'pool',
      progressBps: null,
      migrated: false,
      opensAt: launch.opensAt,
      phase: phaseAt(launch, Math.floor(now / 1000)),
      at: Date.parse(launch.createdAt) || 0,
    }));
  const seen = new Set<string>();
  return [...pooled, ...curve]
    .filter((mine) => (seen.has(mine.token) ? false : (seen.add(mine.token), true)))
    .sort((a, b) => b.at - a.at);
}
