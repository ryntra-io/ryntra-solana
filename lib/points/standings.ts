import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { groupByWallet, listAllPointsEntries, listPointsEntries, pointsSummary, rankOrder, type PointsRanking } from "./ledger.ts";
import { POINTS_POLICY_V1, type PointsPolicy } from "./policy.ts";
import type { PointsEntry } from "./model.ts";

/**
 * Where every wallet stands on Points, kept as one small record so the Rewards read never scans the ledger
 * (Ріст 3: «читання `/api/rewards` без сканування цілих колекцій»).
 *
 * ## What it holds
 *
 * Per wallet, the two figures the rank orders by — its points and the moment of its first row — and nothing else.
 * Internal wallets are kept like any other and left out when the order is read (`rankFromStandings`), so a wallet
 * put on the internal list later leaves the rank at once, without a rebuild.
 *
 * ## How it stays true
 *
 * - **Every write of points** moves its wallets' figures right after it commits (`notePointsStandings`), from the
 *   wallet's own rows — one prefix read, never the whole ledger.
 * - **Every Rewards read** compares the reader's own figures, already read from its rows, with the record and mends
 *   them if they differ (`mendPointsStanding`). A note lost to contention is therefore one short only for a wallet
 *   that has neither traded nor opened «Винагороди» since; its own rank is always exact.
 * - **The first read on a store without the record** builds it once from the whole ledger (`ensurePointsStandings`)
 *   — the only scan, once in the store's life; afterwards the record is moved, never rebuilt.
 *
 * The record grows by one short line per wallet that ever earned points: at a thousand wallets about 80 KB, read by
 * each Rewards read and rewritten whole by each write of points (one key, so writers queue on it; one that loses five
 * times leaves its figure to be mended as above). When it
 * stops being small the rank moves to buckets; that is written here so it is not mistaken for a design.
 */

export const POINTS_STANDINGS_COLLECTION = "pointsStandings" as const;
const KEY = "all" as const;
const MOVE_ATTEMPTS = 25;

const StandingSchema = z.tuple([z.string().regex(/^(?:0|-?[1-9][0-9]*)$/), z.string()]);
export const PointsStandingsSchema = z
  .object({
    schema: z.literal(1),
    version: z.number().int().nonnegative(),
    policyVersion: z.string().min(1).max(20),
    builtAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    /** wallet → [points, first row's moment ("" for a wallet without rows)]. */
    rows: z.record(z.string().min(32).max(64), StandingSchema),
  })
  .strict();
export type PointsStandings = z.output<typeof PointsStandingsSchema>;

type Figure = readonly [points: string, first: string];

function figureOf(entries: readonly PointsEntry[], policy: PointsPolicy): Figure {
  const summary = pointsSummary(entries, policy);
  return [summary.points.toString(), summary.firstEarnedAt ?? ""];
}

/** The rank among external wallets, from the record: the same order `rankPoints` gives over the ledger. */
export function rankFromStandings(standings: PointsStandings, internalWallets: ReadonlySet<string>): PointsRanking {
  return rankOrder(
    Object.entries(standings.rows)
      .filter(([wallet]) => !internalWallets.has(wallet))
      .map(([wallet, [points, first]]) => ({ wallet, points: BigInt(points), first })),
  );
}

export async function readPointsStandings(store: GuardStore): Promise<PointsStandings | null> {
  const parsed = PointsStandingsSchema.safeParse(await store.versioned<PointsStandings>(POINTS_STANDINGS_COLLECTION).get(KEY));
  return parsed.success ? parsed.data : null;
}

/** The record built from the whole ledger. The script's rebuild and the first read on a store use it; nothing else. */
export async function buildPointsStandings(store: GuardStore, now: string, policy: PointsPolicy = POINTS_POLICY_V1): Promise<PointsStandings> {
  const rows: Record<string, Figure> = {};
  for (const [wallet, entries] of groupByWallet(await listAllPointsEntries(store))) rows[wallet] = figureOf(entries, policy);
  return PointsStandingsSchema.parse({ schema: 1, version: 0, policyVersion: policy.version, builtAt: now, updatedAt: now, rows });
}

/** The record, built once if the store has none. A record of another policy is rebuilt: its figures mean other things. */
export async function ensurePointsStandings(store: GuardStore, now: string, policy: PointsPolicy = POINTS_POLICY_V1): Promise<PointsStandings> {
  /* A record that is there but cannot be read is not rebuilt on every read (a scan each time): the rank is unavailable. */
  const stored = await store.versioned<PointsStandings>(POINTS_STANDINGS_COLLECTION).get(KEY);
  if (stored !== undefined && !PointsStandingsSchema.safeParse(stored).success) throw new Error("The points standings record cannot be read.");
  const existing = await readPointsStandings(store);
  if (existing && existing.policyVersion === policy.version) return existing;
  const built = await buildPointsStandings(store, now, policy);
  const collection = store.versioned<PointsStandings>(POINTS_STANDINGS_COLLECTION);
  const next = { ...built, version: existing ? existing.version + 1 : 0 };
  /* Two first reads at once: one record wins, the other reads it. */
  if (await collection.compareAndSet(KEY, existing ? existing.version : null, next)) return next;
  return (await readPointsStandings(store)) ?? next;
}

/**
 * Put these wallets' figures in the record, if they changed — each figure read from the wallet's rows *after* the
 * record's version, inside the compare-and-set: a slower writer whose rows are older than the record it would replace
 * loses the race and reads again, so a newer figure is never put back by an older one. Nothing when the record does
 * not exist yet.
 */
async function moveFigures(store: GuardStore, wallets: ReadonlySet<string>, now: string, policy: PointsPolicy): Promise<void> {
  if (wallets.size === 0) return;
  const collection = store.versioned<PointsStandings>(POINTS_STANDINGS_COLLECTION);
  await withBoundedCasRetry(async () => {
    const current = await readPointsStandings(store);
    if (!current || current.policyVersion !== policy.version) return true;
    const changed: [string, Figure][] = [];
    for (const wallet of wallets) {
      const figure = figureOf(await listPointsEntries(store, wallet), policy);
      const kept = current.rows[wallet];
      if (figure[0] === "0" && figure[1] === "" && !kept) continue;
      if (!kept || kept[0] !== figure[0] || kept[1] !== figure[1]) changed.push([wallet, figure]);
    }
    if (changed.length === 0) return true;
    const next = PointsStandingsSchema.parse({ ...current, version: current.version + 1, updatedAt: now, rows: { ...current.rows, ...Object.fromEntries(changed) } });
    return (await collection.compareAndSet(KEY, current.version, next)) ? true : false;
    /* Not money: more tries than a money write, so a burst of trades at once settles rather than leaves figures behind. */
  }, MOVE_ATTEMPTS);
}

/**
 * After a write of points: these wallets' figures, from their own rows. Non-fatal by contract — the points are
 * written; a figure that did not move waits for the wallet's next write or Rewards read.
 */
export async function notePointsStandings(store: GuardStore, wallets: Iterable<string>, now: string, policy: PointsPolicy = POINTS_POLICY_V1): Promise<void> {
  try {
    await moveFigures(store, new Set(wallets), now, policy);
  } catch (failure) {
    console.warn(`points: standings not moved: ${failure instanceof Error ? failure.message : String(failure)}`);
  }
}

/**
 * The Rewards read: the rank among external wallets without reading anybody else's rows. The reader's own figures
 * (from `mine`, already read) are the truth for the reader: mended in the record when they differ, and ranked as
 * they are even if mending loses a race.
 */
export async function readPointsRanking(
  store: GuardStore,
  args: Readonly<{ wallet: string; mine: readonly PointsEntry[]; internalWallets: ReadonlySet<string>; now: string; policy?: PointsPolicy }>,
): Promise<PointsRanking> {
  const policy = args.policy ?? POINTS_POLICY_V1;
  const standings = await ensurePointsStandings(store, args.now, policy);
  const own = figureOf(args.mine, policy);
  const kept = standings.rows[args.wallet];
  const hasRows = args.mine.length > 0;
  if (hasRows && (!kept || kept[0] !== own[0] || kept[1] !== own[1])) {
    await moveFigures(store, new Set([args.wallet]), args.now, policy).catch(() => undefined);
  }
  const rows = { ...standings.rows };
  if (hasRows) rows[args.wallet] = [...own];
  return rankFromStandings({ ...standings, rows }, args.internalWallets);
}
