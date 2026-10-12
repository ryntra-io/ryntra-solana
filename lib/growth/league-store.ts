import { resolveInternalWallets } from "../admin/internal-wallets.ts";
import type { GuardStore } from "../guard/store.ts";
import { RewardEntrySchema, type RewardEntry } from "../rewards/model.ts";
import { rankStanding, RankEventSchema, type RankEvent } from "../rewards/rank.ts";
import { mayStartRewardRules } from "../rewards/rank-store.ts";
import type { RewardRank } from "../rewards/rules.ts";
import { SolanaWalletActionSchema, type SolanaWalletAction } from "../solana/action-ledger.ts";
import { entriesByRecipient, uniqueRankEvents, weekMetrics, type WeekMetrics } from "./leaderboard.ts";
import { peopleArrivedAt, seasonProgress, SEASON_START_WALLETS, tasksDone } from "./seasons.ts";
import { DAY_MS, isWeekStart, seasonRange, weekRange, weekStartOf, type SeasonRange, type WeekRange } from "./weeks.ts";

/**
 * The durable half of leaderboards and seasons: when the first season
 * began, who chose to be hidden, and each week's figures kept so a board is
 * not recomputed from every ledger on every read.
 *
 * ## Read whole, at most once in a while
 *
 * A board compares wallets, so somewhere every wallet's rows are read. That
 * happens here and only here: the week's figures are computed from the
 * reward rows, the settled swaps and the launch events, then kept in
 * `growthBoards`. A week still running is recomputed when its figures are
 * more than {@link LIVE_REFRESH_MS} old; a week that ended more than
 * {@link FINAL_AFTER_MS} ago is final and never computed again. Inside one
 * process the whole read is shared for {@link INPUTS_TTL_MS}. At this
 * product's volume that is right; when it stops being right, the figures
 * move to real tables — the shape of what a board
 * reads does not change.
 *
 * ## Who decides who is shown
 *
 * Nobody but the wallet itself: `growthPrefs` holds one row per wallet that
 * chose to be hidden, written only behind its own proof. The owner's and
 * test wallets come from the admin's internal list. Both are applied when a
 * board is read, so a change shows on the next read.
 */

const BOARDS = "growthBoards" as const;
const SEASONS = "growthSeasons" as const;
const PREFS = "growthPrefs" as const;

/** A running week's figures are recomputed when older than this. */
export const LIVE_REFRESH_MS = 10 * 60 * 1000;
/** A week is final this long after it ended — time for late settlements to land. */
export const FINAL_AFTER_MS = DAY_MS;
/** One process shares one whole read for this long. */
export const INPUTS_TTL_MS = 60 * 1000;

const NETWORK_PREFIX = "solana:mainnet:";

/* ---------------------------------------------------------------- seasons */

type SeasonsRecord = Readonly<{ firstStart: string; setAt: string; setBy: string; peopleAt?: string; need?: number }>;

/**
 * Where the first season's start is written. Seasons begin once people have
 * come; the key `first` beside it held a start taken from the first read of
 * the boards, before anyone had come, and nothing reads it any more.
 */
const FIRST_SEASON_KEY = "firstWithPeople";

/**
 * When the first season began on this store: the Monday of the week in which
 * a build that may start it (production, a store of its own, or
 * `RYNTRA_REWARDS_RULES_START=1` — the same rule as rules 2.0.0) first sees
 * that {@link SEASON_START_WALLETS} outside wallets have traded through Ryntra
 * ({@link peopleArrivedAt}). With people reading Rewards that is the week the
 * tenth one came; it is never earlier, so no season opens in the past — not
 * even when the tenth came long before anyone asked.
 *
 * Written once: a wallet put on the internal list later never moves a season
 * that has begun. Null until then, and always null for a preview that finds
 * nothing written. Without the internal list — unreadable, or empty — nothing
 * begins: a store that cannot tell the owner's trades from people's must not
 * open a season.
 */
export async function seasonsBegan(store: GuardStore, now: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const collection = store.collection<SeasonsRecord>(SEASONS);
  const existing = await collection.get(FIRST_SEASON_KEY);
  if (existing) return existing.firstStart;
  if (!mayStartRewardRules(env)) return null;
  const internal = await resolveInternalWallets(store, env);
  if (internal.store !== "measured" || internal.wallets.size === 0) return null;
  const inputs = await readLeagueInputs(store);
  const peopleAt = peopleArrivedAt({ entries: inputs.entries, internal: internal.wallets, at: now });
  if (!peopleAt) return null;
  return beginSeasons(store, { firstStart: now, peopleAt, now, setBy: env.VERCEL_DEPLOYMENT_ID ?? env.VERCEL_URL ?? "local" });
}

/**
 * Write the first season's start once — the Monday of `firstStart`'s week —
 * and read back what holds: the one write {@link seasonsBegan} makes, and the
 * way a stand sets a season of its own without seeding a crowd.
 */
export async function beginSeasons(
  store: GuardStore,
  args: Readonly<{ firstStart: string; now: string; setBy: string; peopleAt?: string }>,
): Promise<string | null> {
  const collection = store.collection<SeasonsRecord>(SEASONS);
  await collection.insertIfAbsent(FIRST_SEASON_KEY, {
    firstStart: weekStartOf(args.firstStart),
    setAt: new Date(Date.parse(args.now)).toISOString(),
    setBy: args.setBy.slice(0, 120),
    ...(args.peopleAt ? { peopleAt: args.peopleAt, need: SEASON_START_WALLETS } : {}),
  });
  return (await collection.get(FIRST_SEASON_KEY))?.firstStart ?? null;
}

/* ---------------------------------------------------------------- privacy */

type PrefRecord = Readonly<{ wallet: string; hidden: boolean; updatedAt: string }>;

export async function readHiddenWallets(store: GuardStore): Promise<ReadonlySet<string>> {
  const rows = await store.collection<PrefRecord>(PREFS).valuesWithPrefix("");
  return new Set(rows.filter((row) => row && row.hidden === true && typeof row.wallet === "string").map((row) => row.wallet));
}

export async function isHiddenWallet(store: GuardStore, wallet: string): Promise<boolean> {
  return (await store.collection<PrefRecord>(PREFS).get(wallet))?.hidden === true;
}

/** Hide this wallet from every board, or show it again. The caller has checked its proof. */
export async function setBoardVisibility(store: GuardStore, args: Readonly<{ wallet: string; hidden: boolean; now: string }>): Promise<void> {
  await store.collection<PrefRecord>(PREFS).set(args.wallet, { wallet: args.wallet, hidden: args.hidden, updatedAt: args.now });
}

/** Never on a board: the owner's and test wallets, and the hidden. */
export async function boardExclusions(
  store: GuardStore,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Readonly<{ wallets: ReadonlySet<string>; internal: ReadonlySet<string>; hidden: ReadonlySet<string> }>> {
  const [internal, hidden] = await Promise.all([resolveInternalWallets(store, env), readHiddenWallets(store)]);
  /* Without the internal list the owner's own test trades would top the
     boards; a board that cannot say who is internal is unavailable. */
  if (internal.store !== "measured") throw new Error("The internal wallets could not be read.");
  return { wallets: new Set([...internal.wallets, ...hidden]), internal: internal.wallets, hidden };
}

/**
 * Whether any launch has ever left its curve for a DEX. Until one has, the
 * creators' board is not offered — launches are not yet open to everyone, and
 * a board nobody can be on would be a promise, not a status. A cheap read:
 * only the mints' own claims, never the wallet-led copies.
 */
export async function launchesReachedDex(store: GuardStore): Promise<boolean> {
  const claims = await store.collection<unknown>("rankEvents").valuesWithPrefix("LAUNCH_GRADUATED:");
  return claims.some((row) => RankEventSchema.safeParse(row).success);
}

/* ----------------------------------------------------------------- inputs */

export type LeagueInputs = Readonly<{
  entries: ReadonlyMap<string, readonly RewardEntry[]>;
  actions: ReadonlyMap<string, readonly SolanaWalletAction[]>;
  events: readonly RankEvent[];
  readAt: number;
}>;

const shared = new WeakMap<GuardStore, Promise<LeagueInputs>>();

/** Every reward row, settled swap and launch event — malformed rows dropped, never guessed at. */
async function readInputsNow(store: GuardStore): Promise<LeagueInputs> {
  const [rawEntries, rawActions, rawEvents] = await Promise.all([
    store.collection<unknown>("rewardEntries").valuesWithPrefix(""),
    store.collection<unknown>("solanaWalletActions").valuesWithPrefix(NETWORK_PREFIX),
    store.collection<unknown>("rankEvents").valuesWithPrefix(""),
  ]);
  const entries: RewardEntry[] = [];
  for (const row of rawEntries) {
    const parsed = RewardEntrySchema.safeParse(row);
    if (parsed.success) entries.push(parsed.data);
  }
  const actions = new Map<string, SolanaWalletAction[]>();
  for (const row of rawActions) {
    const parsed = SolanaWalletActionSchema.safeParse(row);
    if (!parsed.success || parsed.data.lane !== "SWAP") continue;
    const list = actions.get(parsed.data.wallet);
    if (list) list.push(parsed.data);
    else actions.set(parsed.data.wallet, [parsed.data]);
  }
  const events: RankEvent[] = [];
  for (const row of rawEvents) {
    const parsed = RankEventSchema.safeParse(row);
    if (parsed.success) events.push(parsed.data);
  }
  return { entries: entriesByRecipient(entries), actions, events: uniqueRankEvents(events), readAt: Date.now() };
}

export async function readLeagueInputs(store: GuardStore): Promise<LeagueInputs> {
  const cached = shared.get(store);
  if (cached) {
    const inputs = await cached.catch(() => null);
    if (inputs && Date.now() - inputs.readAt < INPUTS_TTL_MS) return inputs;
  }
  const fresh = readInputsNow(store);
  shared.set(store, fresh);
  fresh.catch(() => shared.delete(store));
  return fresh;
}

/** Forget this process's shared read — for a stand that has just reseeded. */
export function forgetLeagueInputs(store: GuardStore): void {
  shared.delete(store);
}

function ranksOf(inputs: LeagueInputs, wallets: Iterable<string>, at: string): Record<string, RewardRank> {
  const out: Record<string, RewardRank> = {};
  for (const wallet of new Set(wallets)) {
    try {
      out[wallet] = rankStanding({
        wallet,
        entries: inputs.entries.get(wallet) ?? [],
        events: inputs.events.filter((event) => event.wallet === wallet),
        at,
      }).rank;
    } catch {
      /* A rank that cannot be read draws no frame. */
    }
  }
  return out;
}

/* ------------------------------------------------------------------ weeks */

export type WeekSnapshot = Readonly<{
  metrics: WeekMetrics;
  /** The rank each wallet on the week held when the figures were computed — its frame on the board. */
  ranks: Readonly<Record<string, RewardRank>>;
  computedAt: string;
  final: boolean;
}>;

type WeekRecord = WeekSnapshot & Readonly<{ kind: "week" }>;

/** One week's figures, from the kept copy while it is fresh or final, else computed and kept. */
export async function readWeek(store: GuardStore, week: WeekRange, now: string): Promise<WeekSnapshot> {
  if (!isWeekStart(week.start)) throw new Error("Not a week.");
  const nowMs = Date.parse(now);
  if (Date.parse(week.start) > nowMs) throw new Error("A week that has not begun has no board.");
  const key = `week:${week.start}`;
  const kept = await store.collection<WeekRecord>(BOARDS).get(key).catch(() => undefined);
  if (kept && kept.kind === "week" && (kept.final || nowMs - Date.parse(kept.computedAt) < LIVE_REFRESH_MS)) return kept;
  const inputs = await readLeagueInputs(store);
  const metrics = weekMetrics({ week: weekRange(week.start), entries: inputs.entries, actions: inputs.actions, events: inputs.events });
  const wallets = [...metrics.traders, ...metrics.friends, ...metrics.creators].map((row) => row.wallet);
  const record: WeekRecord = {
    kind: "week",
    metrics,
    ranks: ranksOf(inputs, wallets, now),
    computedAt: new Date(nowMs).toISOString(),
    final: nowMs >= Date.parse(week.end) + FINAL_AFTER_MS,
  };
  /* Two instances may compute the same week at once; both write the same
     figures, so the last write winning loses nothing. */
  await store.collection<WeekRecord>(BOARDS).set(key, record).catch(() => undefined);
  return record;
}

/* ---------------------------------------------------------------- seasons */

export type SeasonCounts = Readonly<{
  /** Wallets that did at least one task, and all of them — the owner's and test wallets left out. */
  participants: number;
  complete: number;
  computedAt: string;
  final: boolean;
}>;

type SeasonRecord = SeasonCounts & Readonly<{ kind: "season"; number: number }>;

/** How many took part in a season, kept like a week's figures. */
export async function readSeasonCounts(
  store: GuardStore,
  season: SeasonRange,
  now: string,
  internal: ReadonlySet<string>,
): Promise<SeasonCounts> {
  const nowMs = Date.parse(now);
  const key = `season:${season.start}`;
  const kept = await store.collection<SeasonRecord>(BOARDS).get(key).catch(() => undefined);
  if (kept && kept.kind === "season" && (kept.final || nowMs - Date.parse(kept.computedAt) < LIVE_REFRESH_MS)) return kept;
  const inputs = await readLeagueInputs(store);
  let participants = 0;
  let complete = 0;
  for (const [wallet, entries] of inputs.entries) {
    if (internal.has(wallet)) continue;
    const progress = seasonProgress({ wallet, entries, season, at: now });
    const done = tasksDone(progress);
    if (done > 0) participants += 1;
    if (progress.complete) complete += 1;
  }
  const record: SeasonRecord = {
    kind: "season",
    number: season.number,
    participants,
    complete,
    computedAt: new Date(nowMs).toISOString(),
    final: nowMs >= Date.parse(season.end) + FINAL_AFTER_MS,
  };
  await store.collection<SeasonRecord>(BOARDS).set(key, record).catch(() => undefined);
  return record;
}

/** The season `number` if it has begun by `now`. */
export function seasonIfBegun(firstStart: string, number: number, now: string): SeasonRange | null {
  const season = seasonRange(firstStart, number);
  return Date.parse(season.start) <= Date.parse(now) ? season : null;
}
