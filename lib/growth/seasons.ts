import { effectiveRewardEntries } from "../rewards/ledger.ts";
import type { RewardEntry } from "../rewards/model.ts";
import { weekStartOf, within, type SeasonRange } from "./weeks.ts";

/**
 * A season: its theme, its tasks, and what one wallet has done of them.
 *
 * ## Tasks a person does, never volume
 *
 * Three tasks, one of each kind — begin, habit, together — and
 * none of them "make N trades" or "trade $N": a first trade of the season, a
 * trade in three different weeks of it, and a friend you invited trading in
 * it. Each is a fact of rows the ledger already holds — the wallet's own
 * cashback rows say it traded and Ryntra received a fee, its level-1 rows say
 * a friend did — so nothing new is stored and nothing can drift.
 *
 * ## What a season gives
 *
 * Status and badges only. All three tasks earn the season's badge; a place in
 * the top three of any weekly board earns its podium badge. No points toward
 * a rank, no money, no prize: a season's count starts again from nothing, and
 * ranks and rewards carry on untouched.
 */

export const SEASON_TASK_IDS = ["FIRST_TRADE", "THREE_WEEKS", "FRIEND_TRADES"] as const;
export type SeasonTaskId = (typeof SEASON_TASK_IDS)[number];

/** The kind of each task: begin, habit or together. */
export const SEASON_TASK_KIND: Readonly<Record<SeasonTaskId, "BEGIN" | "HABIT" | "TOGETHER">> = {
  FIRST_TRADE: "BEGIN",
  THREE_WEEKS: "HABIT",
  FRIEND_TRADES: "TOGETHER",
};

/** How many of something each task asks for. */
export const SEASON_TASK_NEED: Readonly<Record<SeasonTaskId, number>> = {
  FIRST_TRADE: 1,
  THREE_WEEKS: 3,
  FRIEND_TRADES: 1,
};

/** Themes, one per season, in turn. The page names them in its own language. */
export const SEASON_THEMES = ["FIRST_STEPS", "TOGETHER", "HABIT"] as const;
export type SeasonTheme = (typeof SEASON_THEMES)[number];

export function seasonTheme(number: number): SeasonTheme {
  return SEASON_THEMES[(Math.max(1, number) - 1) % SEASON_THEMES.length];
}

export type SeasonTaskState = Readonly<{
  id: SeasonTaskId;
  done: boolean;
  /** How far: weeks with a trade, or 0/1 — never more than the need. */
  have: number;
  need: number;
  /** When it was done, or null. */
  at: string | null;
}>;

export type SeasonProgress = Readonly<{
  tasks: readonly SeasonTaskState[];
  /** All tasks done: the season's badge, and when. */
  complete: boolean;
  completedAt: string | null;
}>;

/**
 * What `wallet` has done of the season's tasks, from its own reward rows
 * (rows where it is the recipient — its cashback and its friends' level-1).
 * Rows after `at` do not count yet, so a season read mid-way is that day's
 * truth.
 */
export function seasonProgress(
  args: Readonly<{ wallet: string; entries: readonly RewardEntry[]; season: Pick<SeasonRange, "start" | "end">; at: string }>,
): SeasonProgress {
  const atMs = Date.parse(args.at);
  const end = Math.min(Date.parse(args.season.end), Number.isFinite(atMs) ? atMs + 1 : Date.parse(args.season.end));
  const range = { start: args.season.start, end: new Date(end).toISOString() };
  const own: string[] = [];
  const friends: string[] = [];
  for (const entry of effectiveRewardEntries(args.entries)) {
    if (entry.recipient !== args.wallet || !entry.source || !within(entry.source.settledAt, range)) continue;
    if (entry.type === "CASHBACK" && entry.source.trader === args.wallet) own.push(entry.source.settledAt);
    if (entry.type === "REFERRAL_L1" && entry.source.trader !== args.wallet) friends.push(entry.source.settledAt);
  }
  own.sort();
  friends.sort();

  const firstTrade = own[0] ?? null;
  /* The week each trade fell in; the third distinct one is when the habit was made. */
  const weeks: string[] = [];
  let habitAt: string | null = null;
  for (const at of own) {
    const week = weekStartOf(at);
    if (!weeks.includes(week)) {
      weeks.push(week);
      if (weeks.length === SEASON_TASK_NEED.THREE_WEEKS) habitAt = at;
    }
  }
  const friendAt = friends[0] ?? null;

  const tasks: SeasonTaskState[] = [
    { id: "FIRST_TRADE", done: firstTrade !== null, have: firstTrade ? 1 : 0, need: 1, at: firstTrade },
    { id: "THREE_WEEKS", done: habitAt !== null, have: Math.min(weeks.length, SEASON_TASK_NEED.THREE_WEEKS), need: SEASON_TASK_NEED.THREE_WEEKS, at: habitAt },
    { id: "FRIEND_TRADES", done: friendAt !== null, have: friendAt ? 1 : 0, need: 1, at: friendAt },
  ];
  const complete = tasks.every((task) => task.done);
  const completedAt = complete ? tasks.map((task) => task.at!).sort().at(-1)! : null;
  return { tasks, complete, completedAt };
}

/** How many tasks a progress holds — the season's own count, which starts again each season. */
export function tasksDone(progress: SeasonProgress): number {
  return progress.tasks.filter((task) => task.done).length;
}

/* ------------------------------------------------------- when seasons begin */

/** Outside wallets that must have traded through Ryntra before the first season begins. */
export const SEASON_START_WALLETS = 10;

/**
 * When people came: the moment the `need`-th outside wallet made its first
 * trade through Ryntra — a cashback row of its own, the same fact the "first
 * trade of the season" task reads — settled by `at`; null while fewer have.
 *
 * Wallets in `internal` (the owner's, test and Ryntra's own) never count, so
 * the owner trying the product cannot open a season with nobody in it. A
 * wallet hidden from the boards does count: it is a person all the same.
 * Only a moment comes out — never which wallets they were. The rows are read
 * as written: a later valuation changes a row's dollars, never that it was a
 * trade or when it settled.
 */
export function peopleArrivedAt(
  args: Readonly<{ entries: ReadonlyMap<string, readonly RewardEntry[]>; internal: ReadonlySet<string>; at: string; need?: number }>,
): string | null {
  const need = args.need ?? SEASON_START_WALLETS;
  const atMs = Date.parse(args.at);
  if (!Number.isInteger(need) || need < 1 || !Number.isFinite(atMs)) return null;
  const firsts: number[] = [];
  for (const [wallet, entries] of args.entries) {
    if (args.internal.has(wallet)) continue;
    let first = Infinity;
    for (const entry of entries) {
      if (entry.type !== "CASHBACK" || entry.recipient !== wallet || !entry.source || entry.source.trader !== wallet) continue;
      const settled = Date.parse(entry.source.settledAt);
      if (Number.isFinite(settled) && settled <= atMs && settled < first) first = settled;
    }
    if (first !== Infinity) firsts.push(first);
  }
  if (firsts.length < need) return null;
  firsts.sort((a, b) => a - b);
  return new Date(firsts[need - 1]).toISOString();
}
