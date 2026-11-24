import { POINTS_POLICY_V1 } from '../../lib/points/policy.ts';
import { rankThresholdsOf, REWARD_RANKS, REWARD_RULES_CURRENT, type RewardRank } from '../../lib/rewards/rules.ts';
import { digits } from '../../city/lib/i18n/dict.ts';
import type { Lang } from '../../city/lib/i18n/langs.ts';
import { scoutsOf, type ScoutRow, type ScoutsView } from '../../city/lib/scouts/view.ts';

/**
 * «Rewards» as the terminal reads it: points, level, place and rank, cashback, the link to share, who came and what they
 * brought — all from the Growth line's one read (`/api/rewards`, the same answer the city's «Scouts» and the
 * portfolio's rewards read). The friends' part is the city's own projection (`scoutsOf`); this file adds what the screen
 * needs beside it: the level's span, the place and the rank's ladder. Nothing is counted here, nothing is paid, no rule
 * is changed. Rewards are counted in dollars and paid in SOL, so an earned figure reads in SOL at the market's price.
 *
 * No React here: the tests run it in Node.
 */

export type RankId = RewardRank;
export const RANK_IDS: readonly RankId[] = REWARD_RANKS;

/** Ryntra Points of a proven wallet: the total, the level and its span, the place among wallets, what earned them. */
export type PointsRead = Readonly<{
  total: number;
  level: number;
  /** Where the current level began and where the next begins; null at the top. */
  levelFrom: number;
  nextAt: number | null;
  /** The place among the wallets that have points, or null where the wallet has none (a team wallet, nothing yet). */
  place: number | null;
  ranked: number;
  /** Lifetime volume in dollars; null when the engine did not say. */
  volume: number | null;
  trades: number;
  activeDays: number;
}>;

/** One rung of the rank's ladder: where it begins over the last 30 days and the share of a friend's trade it pays. */
export type Rung = Readonly<{ id: RankId; from: number; share: number }>;

/** The rank over the last 30 days: which, how far up, and what it pays on a friend's trade. */
export type RankRead = Readonly<{
  id: RankId;
  /** The rank's own points over the window, and where this rank began. */
  score: number;
  from: number;
  next: Readonly<{ id: RankId; at: number }> | null;
  share: number;
  ladder: readonly Rung[];
}>;

export type RewardsRead = Readonly<{
  points: PointsRead | null;
  rank: RankRead | null;
  friends: ScoutsView;
}>;

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const whole = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);
const isRank = (value: unknown): value is RankId => typeof value === 'string' && (RANK_IDS as readonly string[]).includes(value);

/** A count the engine grouped for reading — `12 480` — as a number; null when it is not one. */
export function groupedOf(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const bare = text.replace(/[\s  ,]/g, '');
  if (!/^\d{1,15}$/.test(bare)) return null;
  return Number(bare);
}

/** Dollars as the engine groups them — `$48 210.55` — as a number; null when it is not one. */
export function dollarsOf(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const bare = text.replace(/^\$/, '').replace(/[\s  ,]/g, '');
  if (!/^\d{1,15}(?:\.\d{1,2})?$/.test(bare)) return null;
  return Number(bare);
}

/** The points part of the answer; null when the ledger was not read — unavailable, never zero. */
export function pointsOf(body: unknown): PointsRead | null {
  const points = record(record(body).points);
  const total = groupedOf(points.points);
  const level = typeof points.level === 'number' && Number.isInteger(points.level) && points.level > 0 ? points.level : null;
  if (total === null || level === null) return null;
  return {
    total,
    level,
    levelFrom: groupedOf(points.levelFrom) ?? 0,
    nextAt: groupedOf(points.nextLevelAt),
    place: typeof points.rank === 'number' && Number.isInteger(points.rank) && points.rank > 0 ? points.rank : null,
    ranked: whole(points.ranked),
    volume: dollarsOf(points.volume),
    trades: whole(points.trades),
    activeDays: whole(points.activeDays),
  };
}

/** The rank's ladder by the rules in force: what anyone can know before a wallet is connected. */
export function rulesLadder(): readonly Rung[] {
  const from = rankThresholdsOf(REWARD_RULES_CURRENT);
  return RANK_IDS.map((id) => ({ id, from: Number(from[id]), share: REWARD_RULES_CURRENT.referralL1BpsByRank[id] / 100 }));
}

/** The rank part of the answer; null when the engine could not read it — unavailable, not Bronze. */
export function rankOf(body: unknown): RankRead | null {
  const rank = record(body).rank;
  if (rank === null || rank === undefined) return null;
  const read = record(rank);
  const share = typeof read.friendShare === 'number' && Number.isFinite(read.friendShare) ? read.friendShare : null;
  if (!isRank(read.rank) || share === null) return null;
  const next = record(read.next);
  const ladder: Rung[] = [];
  for (const raw of Array.isArray(read.ladder) ? read.ladder : []) {
    const rung = record(raw);
    const from = groupedOf(rung.from);
    if (isRank(rung.rank) && from !== null && typeof rung.friendShare === 'number') ladder.push({ id: rung.rank, from, share: rung.friendShare });
  }
  const at = groupedOf(next.at);
  return {
    id: read.rank,
    score: groupedOf(read.points) ?? 0,
    from: groupedOf(read.rankFrom) ?? 0,
    next: isRank(next.rank) && at !== null ? { id: next.rank, at } : null,
    share,
    ladder: ladder.length === RANK_IDS.length ? ladder : rulesLadder(),
  };
}

/** The whole answer of a proven wallet; null when it is not one. */
export function rewardsOf(body: unknown): RewardsRead | null {
  const friends = scoutsOf(body);
  if (!friends) return null;
  return { points: pointsOf(body), rank: rankOf(body), friends };
}

/** How far along a span a figure stands, 0 … 1: the level's bar, the rank's bar. At the top the bar is full. */
export function along(value: number, from: number, to: number | null): number {
  if (to === null) return 1;
  if (!(to > from)) return 0;
  return Math.min(1, Math.max(0, (value - from) / (to - from)));
}

/* ------------------------------------------------------------------------------------------------ figures */

const USD = /^(?:<0\.01|\d+\.\d{2})$/;

/** An engine dollar figure (`12.40`, `<0.01`) as the eye reads it: `$12.40`, `<$0.01`, a dash when it is no figure. */
export function usdShown(text: string, lang: Lang): string {
  if (!USD.test(text)) return '—';
  if (text === '<0.01') return digits('<$0.01', lang);
  const [whole, cents] = text.split('.') as [string, string];
  return digits(`$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`, lang);
}

/**
 * An engine dollar figure in SOL at the market's price, as the eye reads it: three significant figures, whole SOL
 * grouped — `0.0689`, `12.4`, `1,240`; nothing yet is `0`. Null without a price, or below a cent: never a guessed SOL.
 */
export function solShown(text: string, solUsd: number | null, lang: Lang): string | null {
  if (!USD.test(text) || text === '<0.01') return null;
  if (solUsd === null || !Number.isFinite(solUsd) || solUsd <= 0) return null;
  const [whole, cents] = text.split('.') as [string, string];
  const micros = BigInt(whole) * 1_000_000n + BigInt(cents) * 10_000n;
  if (micros === 0n) return '0';
  const sol = Number(micros) / 1_000_000 / solUsd;
  if (sol >= 1_000) return digits(Math.round(sol).toLocaleString('en-US'), lang);
  if (sol < 0.0001) return digits('<0.0001', lang);
  return digits(String(Number(sol.toPrecision(3))), lang);
}

/** A whole count grouped the language's way: `12,480` and `12 480`. */
export function countShown(value: number, lang: Lang): string {
  return digits(Math.round(value).toLocaleString('en-US'), lang);
}

/** A share in per cent the language's way, straight after its number as the kit writes it (`terminal/ui/figures.ts`): `15%`, `0,5%`. */
export function shareShown(value: number, lang: Lang): string {
  const text = String(Number(value.toFixed(2)));
  return `${lang === 'uk' ? text.replace('.', ',') : text}%`;
}

/** The link as the screen shows it: no scheme, `ryntra.io/r/K7Q2…`. The whole link is what is copied. */
export function linkShown(link: string): string {
  return link.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/* --------------------------------------------------------------------------------------------- what earns */

/** What earns points, by the points policy in force: a trade's dollar, an active day, a friend who trades. */
export type Earning = Readonly<{ perDollar: number; activeDay: number; friend: number; dayCap: number }>;

export function earning(): Earning {
  const first = POINTS_POLICY_V1.volumeTiers[0]!;
  return {
    perDollar: Number(first.pointsPerThousandUsd) / 1_000,
    activeDay: Number(POINTS_POLICY_V1.activeDay.points),
    friend: Number(POINTS_POLICY_V1.qualifiedReferral.points),
    dayCap: Number(POINTS_POLICY_V1.dailyVolumePointsCap),
  };
}

/** The shares a friend's trade pays by the rules in force: at the lowest rank, in the friend's first days, a level down. */
export type Shares = Readonly<{ friend: number; firstDays: Readonly<{ share: number; days: number }> | null; second: number; cashback: number }>;

export function rulesShares(): Shares {
  const window = REWARD_RULES_CURRENT.inviterWindow;
  return {
    friend: REWARD_RULES_CURRENT.referralL1BpsByRank.BRONZE / 100,
    firstDays: window ? { share: window.bps / 100, days: window.days } : null,
    second: REWARD_RULES_CURRENT.referralL2Bps / 100,
    cashback: REWARD_RULES_CURRENT.cashbackBps / 100,
  };
}

/** The shares as this wallet meets them: its rank's share, and the rest from the same answer. */
export function sharesOf(friends: ScoutsView): Shares {
  const rules = rulesShares();
  return { friend: friends.friendShare ?? rules.friend, firstDays: friends.firstDays ?? rules.firstDays, second: friends.secondShare, cashback: friends.cashbackShare };
}

/* ------------------------------------------------------------------------------------------------ history */

/** The latest rows a tab shows: the friends' shares on «Invite», the cashback on «Points»; newest first. */
export function latest(rows: readonly ScoutRow[], kinds: readonly ScoutRow['kind'][], count = 6): ScoutRow[] {
  return rows
    .filter((row) => kinds.includes(row.kind))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, count);
}

/* ---------------------------------------------------------------------------------------------- the screen */

export type RewardsStatus = 'none' | 'reading' | 'proof' | 'proving' | 'ready' | 'failed';

/** What a tab shows: ask for a wallet, ask for its one signature, read, the figures, or a read that failed. */
export type RewardsScreen = 'connect' | 'prove' | 'reading' | 'ready' | 'failed';

export function screenOf(owner: string | null, status: RewardsStatus, view: RewardsRead | null): RewardsScreen {
  if (!owner) return 'connect';
  if (status === 'proof' || status === 'proving') return 'prove';
  if (view) return 'ready';
  if (status === 'failed') return 'failed';
  return 'reading';
}

export const TAB_IDS = ['points', 'invite', 'partners'] as const;
export type RewardsTab = (typeof TAB_IDS)[number];

/** The tabs a person sees: «Partners» only while the partner programme is open. */
export function tabsShown(partnersOpen: boolean): readonly RewardsTab[] {
  return TAB_IDS.filter((tab) => tab !== 'partners' || partnersOpen);
}
