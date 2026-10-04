/**
 * Spot watchlist — one row per proven wallet, in the Guard store.
 *
 * The cabinet belongs to the wallet, not the browser, so a star
 * pressed on a laptop is a star on the phone. The row is keyed by the wallet
 * and written only through proof of the wallet — the `rw` cookie in a browser,
 * the native bearer session on a phone — the same gate the receipt archive
 * uses, because a connected wallet proves nothing and anyone can type an
 * address. Each client keeps a copy so the list is instant and survives a lost
 * network; the server row is the truth the copy is reconciled to.
 *
 * ## Removals are remembered
 *
 * A device that kept its own list before it could sign in merges it once after
 * sign-in. Without a memory of removals, a mint the person removed on the web
 * would come back from the phone's older copy, and a mint removed on the
 * phone while offline would come back from the server — "deleted things
 * return" is the failure this schema version exists to close. So a write that
 * drops a mint records a tombstone with the moment, and the merge lets the
 * later of the two facts win: a device addition older than the server's
 * removal is not re-added; a device removal drops the server's row. Tombstones
 * are pruned when a mint returns and capped so the row stays small.
 */

import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";

const COLLECTION = "spotWatchlists" as const;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const SPOT_WATCHLIST_LIMIT = 200;
/** Removals remembered per wallet; the oldest fall off first. */
export const SPOT_WATCHLIST_TOMBSTONES = 200;

const RemovalSchema = z.object({ mint: z.string().regex(BASE58), removedAt: z.string().datetime({ offset: true }) }).strict();

/** Rows written before removals were remembered still parse; `removed` is simply absent. */
export const SpotWatchlistSchema = z
  .object({
    schema: z.literal("ryntra.spot.watchlist"),
    schemaVersion: z.enum(["1.0.0", "1.1.0"]),
    version: z.number().int().min(0),
    network: z.literal("mainnet"),
    wallet: z.string().regex(BASE58),
    /** Newest star last, so the list reads in the order it was built. */
    mints: z.array(z.string().regex(BASE58)).max(SPOT_WATCHLIST_LIMIT),
    removed: z.array(RemovalSchema).max(SPOT_WATCHLIST_TOMBSTONES).optional(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type SpotWatchlist = z.output<typeof SpotWatchlistSchema>;

export function spotWatchlistKey(wallet: string): string {
  return `mainnet:${wallet}`;
}

export type SpotWatchlistRow = Readonly<{ mints: readonly string[]; version: number | null; updatedAt: string | null; removed: readonly z.output<typeof RemovalSchema>[] }>;

/** The whole row — mints, version, removals — or the empty row for a wallet that has none. */
export async function readSpotWatchlistRow(store: GuardStore, wallet: string): Promise<SpotWatchlistRow> {
  const empty: SpotWatchlistRow = { mints: [], version: null, updatedAt: null, removed: [] };
  if (!BASE58.test(wallet)) return empty;
  try {
    const raw = await store.collection<unknown>(COLLECTION).get(spotWatchlistKey(wallet));
    if (raw === undefined || raw === null) return empty;
    const parsed = SpotWatchlistSchema.safeParse(raw);
    if (!parsed.success) return empty;
    return { mints: parsed.data.mints, version: parsed.data.version, updatedAt: parsed.data.updatedAt, removed: parsed.data.removed ?? [] };
  } catch {
    return empty;
  }
}

export async function readSpotWatchlist(store: GuardStore, wallet: string): Promise<readonly string[]> {
  return (await readSpotWatchlistRow(store, wallet)).mints;
}

export type SpotWatchlistWrite =
  | Readonly<{ ok: true; mints: readonly string[]; version: number }>
  | Readonly<{ ok: false; reason: "WATCHLIST_INVALID" | "WATCHLIST_UNAVAILABLE" | "WATCHLIST_CONFLICT" }>;

/** The removals to keep after a write: what left the list, newest first, capped; a mint that returned loses its tombstone. */
export function nextRemovals(
  previous: readonly z.output<typeof RemovalSchema>[],
  before: readonly string[],
  after: readonly string[],
  now: string,
): readonly z.output<typeof RemovalSchema>[] {
  const kept = new Set(after);
  const dropped = before.filter((mint) => !kept.has(mint));
  const fresh = dropped.map((mint) => ({ mint, removedAt: now }));
  const older = previous.filter((entry) => !kept.has(entry.mint) && !dropped.includes(entry.mint));
  return [...fresh, ...older].slice(0, SPOT_WATCHLIST_TOMBSTONES);
}

/**
 * Replace the list. The client sends the whole list rather than a toggle so
 * two devices editing at once converge on whichever wrote last, with the
 * version guarding against a lost update in between; a caller that names the
 * version it read (`ifVersion`) is refused `WATCHLIST_CONFLICT` when the row
 * moved on, instead of overwriting another device's stars.
 */
export async function writeSpotWatchlist(
  store: GuardStore,
  wallet: string,
  mints: readonly string[],
  now: string,
  options: Readonly<{ ifVersion?: number }> = {},
): Promise<SpotWatchlistWrite> {
  if (!BASE58.test(wallet)) return { ok: false, reason: "WATCHLIST_INVALID" };
  if (mints.some((mint) => !BASE58.test(mint))) return { ok: false, reason: "WATCHLIST_INVALID" };
  /* The same mint twice is one star; past the cap the newest stars are kept,
     because the list reads oldest first and the cap trims what was starred
     longest ago. */
  const unique = [...new Set(mints)].slice(-SPOT_WATCHLIST_LIMIT);
  return writeRow(store, wallet, now, options.ifVersion, () => unique);
}

async function writeRow(
  store: GuardStore,
  wallet: string,
  now: string,
  ifVersion: number | undefined,
  compute: (existing: SpotWatchlist | null) => readonly string[],
): Promise<SpotWatchlistWrite> {
  const key = spotWatchlistKey(wallet);
  const collection = store.versioned<SpotWatchlist>(COLLECTION);
  try {
    return await withBoundedCasRetry(async () => {
      const raw = await collection.get(key);
      const current = raw === undefined ? null : SpotWatchlistSchema.safeParse(raw);
      const existing = current && current.success ? current.data : null;
      if (ifVersion !== undefined && (existing ? existing.version : null) !== ifVersion) {
        return { ok: false as const, reason: "WATCHLIST_CONFLICT" as const };
      }
      const next = compute(existing);
      const record = SpotWatchlistSchema.parse({
        schema: "ryntra.spot.watchlist",
        schemaVersion: "1.1.0",
        version: existing ? existing.version + 1 : 0,
        network: "mainnet",
        wallet,
        mints: next,
        removed: nextRemovals(existing?.removed ?? [], existing?.mints ?? [], next, now),
        updatedAt: now,
      });
      const wrote = await collection.compareAndSet(key, existing ? existing.version : null, record);
      if (!wrote) return false;
      return { ok: true as const, mints: record.mints, version: record.version };
    });
  } catch {
    return { ok: false, reason: "WATCHLIST_UNAVAILABLE" };
  }
}

/* ------------------------------------------------------------ merge */

export type SpotWatchlistMergeInput = Readonly<{
  /** The device's list, oldest first. */
  mints: readonly string[];
  /** Mints the device removed since it last took the server's answer. */
  removed: readonly string[];
  /** When the device last took the server's answer; null on a first sign-in. */
  syncedAt: string | null;
}>;

export type SpotWatchlistMergeResult = Readonly<{
  mints: readonly string[];
  /** Device mints that did not fit under the limit — named, never silently dropped. */
  notKept: readonly string[];
  /** Device mints the server removed after the device last synced — not re-added, named. */
  droppedByServer: readonly string[];
}>;

/**
 * One list from two, pure.
 *
 * The server's order first (it is the order every device already agreed on),
 * then the device's additions in the device's order. The device's removals
 * leave. A device addition the server removed *after* the device last synced
 * is a removal the device has not seen yet and stays removed; on a first
 * sign-in (`syncedAt` null) the device never held the server's copy, so its
 * list is a genuine local list and nothing in it is treated as stale. Past
 * the limit the overflow is returned by name, so the device keeps those as its
 * own and says so instead of losing them.
 */
export function mergeSpotWatchlist(server: SpotWatchlistRow, device: SpotWatchlistMergeInput): SpotWatchlistMergeResult {
  const removedByDevice = new Set(device.removed);
  const syncedMs = device.syncedAt === null ? null : Date.parse(device.syncedAt);
  const staleOnDevice = new Set<string>();
  if (syncedMs !== null && Number.isFinite(syncedMs)) {
    for (const entry of server.removed) {
      if (Date.parse(entry.removedAt) > syncedMs) staleOnDevice.add(entry.mint);
    }
  }
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const mint of server.mints) {
    if (removedByDevice.has(mint) || seen.has(mint)) continue;
    seen.add(mint);
    merged.push(mint);
  }
  const droppedByServer: string[] = [];
  const additions: string[] = [];
  for (const mint of device.mints) {
    if (seen.has(mint) || removedByDevice.has(mint)) continue;
    if (staleOnDevice.has(mint)) {
      droppedByServer.push(mint);
      continue;
    }
    seen.add(mint);
    additions.push(mint);
  }
  const room = Math.max(0, SPOT_WATCHLIST_LIMIT - merged.length);
  return {
    mints: [...merged, ...additions.slice(0, room)],
    notKept: additions.slice(room),
    droppedByServer,
  };
}

export type SpotWatchlistMergeWrite =
  | Readonly<{ ok: true; result: SpotWatchlistMergeResult; version: number }>
  | Readonly<{ ok: false; reason: "WATCHLIST_INVALID" | "WATCHLIST_UNAVAILABLE" }>;

/** Merge the device's list into the wallet's row and write the result, once. */
export async function mergeSpotWatchlistRow(store: GuardStore, wallet: string, device: SpotWatchlistMergeInput, now: string): Promise<SpotWatchlistMergeWrite> {
  if (!BASE58.test(wallet)) return { ok: false, reason: "WATCHLIST_INVALID" };
  if ([...device.mints, ...device.removed].some((mint) => !BASE58.test(mint))) return { ok: false, reason: "WATCHLIST_INVALID" };
  let result: SpotWatchlistMergeResult = { mints: [], notKept: [], droppedByServer: [] };
  const wrote = await writeRow(store, wallet, now, undefined, (existing) => {
    result = mergeSpotWatchlist(
      { mints: existing?.mints ?? [], version: existing?.version ?? null, updatedAt: existing?.updatedAt ?? null, removed: existing?.removed ?? [] },
      device,
    );
    return result.mints;
  });
  if (!wrote.ok) return { ok: false, reason: wrote.reason === "WATCHLIST_INVALID" ? "WATCHLIST_INVALID" : "WATCHLIST_UNAVAILABLE" };
  return { ok: true, result, version: wrote.version };
}
