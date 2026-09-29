/**
 * The person's watchlist of events (`RYN-PREDICTIONS-001`): one row per
 * proven wallet in Guard `predictionWatchlists`, compare-and-set. Each entry
 * remembers the leading probability at the moment it was watched, so *what
 * changed since you watched it* is a fact the store holds, not a guess.
 *
 * Server only.
 */

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { failure } from "./failure.ts";
import type { Result } from "./provider.ts";

export type WatchEntry = Readonly<{
  eventId: string;
  watchedAt: string;
  venueMarketId: string | null;
  outcomeLabel: string | null;
  probabilityAtWatch: number | null;
}>;

export type WatchlistRecord = Readonly<{ version: number; wallet: string; entries: readonly WatchEntry[]; updatedAt: string }>;

export const WATCHLIST_LIMIT = 100;
const KEY_PREFIX = "solana:mainnet:";

function collection(store: GuardStore) {
  return store.versioned<WatchlistRecord>("predictionWatchlists");
}

export async function readWatchlist(store: GuardStore, wallet: string): Promise<readonly WatchEntry[]> {
  const row = await collection(store).get(`${KEY_PREFIX}${wallet}`);
  return row?.entries ?? [];
}

export async function setWatch(store: GuardStore, wallet: string, entry: Omit<WatchEntry, "watchedAt">, watched: boolean, nowMs: number = Date.now()): Promise<Result<readonly WatchEntry[]>> {
  const key = `${KEY_PREFIX}${wallet}`;
  const at = new Date(nowMs).toISOString();
  try {
    const result = await withBoundedCasRetry(async () => {
      const current = await collection(store).get(key);
      const entries = current?.entries ?? [];
      const without = entries.filter((e) => e.eventId !== entry.eventId);
      const next: readonly WatchEntry[] = watched ? [{ ...entry, watchedAt: at }, ...without].slice(0, WATCHLIST_LIMIT) : without;
      const record: WatchlistRecord = { version: (current?.version ?? 0) + 1, wallet, entries: next, updatedAt: at };
      const ok = current ? await collection(store).compareAndSet(key, current.version, record) : await collection(store).insertIfAbsent(key, record);
      return ok ? next : false;
    });
    return { ok: true, value: result };
  } catch {
    return failure("UNAVAILABLE", "The watchlist could not be written; try again.");
  }
}
