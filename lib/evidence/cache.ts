/**
 * The snapshot cache — one copy of an observation per (provider, network,
 * mint, window), shared between instances, held no longer than the rights
 * map allows, and fetched at most once at a time.
 *
 * Three things a cache for licensed data must do that a memo does not:
 *
 * - **Expire by the provider's rule, not ours.** An entry carries the
 *   snapshot's own `expiresAt` (Ryntra's freshness rule) and a `holdUntil`
 *   (the longest the rights map lets a stale copy be served when the provider
 *   does not answer); after `holdUntil` the entry is dropped unread.
 * - **Remember failures briefly.** A provider that answered 5xx or timed out
 *   is not asked again by every reader for the next minute; the failure is
 *   cached with its reason, so a storm of opens costs one failed call, not
 *   fifty.
 * - **Single-flight.** Within one instance, concurrent readers of the same
 *   key await the same promise; the provider is called once. Across
 *   instances the store is the second line: the winner writes, the others
 *   read it on their next miss.
 *
 * The key names no person: the same asset and window is the same entry for
 * everyone, because the data is the same for everyone — an aggregate about a
 * token. The address evidence a recipient check reads
 * is keyed by the address alone for the same reason: what the source says
 * about an address is the same whoever asks, and the copy is held an hour
 * so ten people sending to one exchange deposit address cost one read.
 *
 * One implementation, two collections: the snapshot cache and the address
 * cache differ only in what they hold and where.
 */

import type { GuardCollectionName, GuardStore } from "../guard/store.ts";
import type { AddressEvidence } from "./address.ts";
import type { EvidenceProvider, EvidenceWindow } from "./metrics.ts";
import { EVIDENCE_NETWORK, type MarketEvidenceSnapshot } from "./snapshot.ts";

export type EvidenceCacheEntry<T = MarketEvidenceSnapshot> = Readonly<{
  key: string;
  snapshot: T | null;
  /** A remembered failure: served as UNAVAILABLE until `failureUntil`, so a storm costs one call. */
  failure: Readonly<{ state: "UNAVAILABLE" | "UNKNOWN"; reason: string; until: string }> | null;
  storedAt: string;
  /** After this the snapshot is stale; it may still be served, marked, until `holdUntil`. */
  expiresAt: string | null;
  holdUntil: string | null;
}>;

export const FAILURE_CACHE_SECONDS = 60;

export function evidenceCacheKey(provider: EvidenceProvider, mint: string, window: EvidenceWindow): string {
  return `${provider}:${EVIDENCE_NETWORK}:${mint}:${window}`;
}

export function addressEvidenceCacheKey(provider: EvidenceProvider, address: string): string {
  return `${provider}:${EVIDENCE_NETWORK}:address:${address}`;
}

export type EvidenceCacheLookup<T = MarketEvidenceSnapshot> =
  | Readonly<{ hit: "fresh"; snapshot: T }>
  | Readonly<{ hit: "stale"; snapshot: T }>
  /** A remembered failure; `snapshot` is the stale copy still held with it, if any — served marked, never refreshed inside the minute. */
  | Readonly<{ hit: "failure"; state: "UNAVAILABLE" | "UNKNOWN"; reason: string; snapshot: T | null }>
  | Readonly<{ hit: "miss" }>;

export type EvidenceCache<T = MarketEvidenceSnapshot> = Readonly<{
  lookup(key: string, nowMs: number): Promise<EvidenceCacheLookup<T>>;
  put(key: string, snapshot: T, holdSeconds: number, nowMs: number): Promise<void>;
  /** Remember a failure for a minute; a stale copy already held stays served, marked, until its own hold ends. */
  putFailure(key: string, state: "UNAVAILABLE" | "UNKNOWN", reason: string, nowMs: number): Promise<void>;
  /** Run `fetch` once per key at a time within this instance; concurrent callers share the result. */
  singleFlight<R>(key: string, fetch: () => Promise<R>): Promise<R>;
}>;

export type AddressEvidenceCache = EvidenceCache<AddressEvidence>;

const inFlight = new Map<string, Promise<unknown>>();

/** The snapshot cache — one copy per (provider, network, mint, window). */
export function createEvidenceCache(store: GuardStore): EvidenceCache {
  return createExpiringCache<MarketEvidenceSnapshot>(store, "evidenceSnapshots");
}

/** The address cache — one copy per (provider, network, address), for the recipient check. */
export function createAddressEvidenceCache(store: GuardStore): AddressEvidenceCache {
  return createExpiringCache<AddressEvidence>(store, "evidenceAddresses");
}

function createExpiringCache<T extends Readonly<{ expiresAt: string }>>(store: GuardStore, name: GuardCollectionName): EvidenceCache<T> {
  const collection = () => store.collection<EvidenceCacheEntry<T>>(name);

  return {
    async lookup(key, nowMs) {
      let entry: EvidenceCacheEntry<T> | undefined;
      try {
        entry = await collection().get(key);
      } catch {
        return { hit: "miss" };
      }
      if (!entry) return { hit: "miss" };
      const now = nowMs;
      if (entry.failure && Date.parse(entry.failure.until) > now) {
        /* A remembered failure still carries the stale copy it was kept with. */
        const held = entry.snapshot && entry.holdUntil && Date.parse(entry.holdUntil) > now ? entry.snapshot : null;
        return { hit: "failure", state: entry.failure.state, reason: entry.failure.reason, snapshot: held };
      }
      if (!entry.snapshot || !entry.expiresAt || !entry.holdUntil) return { hit: "miss" };
      if (Date.parse(entry.holdUntil) <= now) {
        /* Past the hold: the copy is dropped, not served. Best effort — a
           failed delete only means the next reader drops it. */
        collection().delete(key).catch(() => undefined);
        return { hit: "miss" };
      }
      if (Date.parse(entry.expiresAt) > now) return { hit: "fresh", snapshot: entry.snapshot };
      return { hit: "stale", snapshot: entry.snapshot };
    },

    async put(key, snapshot, holdSeconds, nowMs) {
      const entry: EvidenceCacheEntry<T> = {
        key,
        snapshot,
        failure: null,
        storedAt: new Date(nowMs).toISOString(),
        expiresAt: snapshot.expiresAt,
        holdUntil: new Date(Date.parse(snapshot.expiresAt) + holdSeconds * 1000).toISOString(),
      };
      try {
        await collection().set(key, entry);
      } catch (error) {
        console.error(`evidence cache: snapshot not stored for ${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async putFailure(key, state, reason, nowMs) {
      let previous: EvidenceCacheEntry<T> | undefined;
      try {
        previous = await collection().get(key);
      } catch {
        previous = undefined;
      }
      const held = previous?.snapshot && previous.holdUntil && Date.parse(previous.holdUntil) > nowMs ? previous : null;
      const entry: EvidenceCacheEntry<T> = {
        key,
        snapshot: held?.snapshot ?? null,
        failure: { state, reason, until: new Date(nowMs + FAILURE_CACHE_SECONDS * 1000).toISOString() },
        storedAt: new Date(nowMs).toISOString(),
        expiresAt: held?.expiresAt ?? null,
        holdUntil: held?.holdUntil ?? null,
      };
      try {
        await collection().set(key, entry);
      } catch {
        /* A failure that could not be remembered costs at most one more call. */
      }
    },

    singleFlight<R>(key: string, fetch: () => Promise<R>): Promise<R> {
      const running = inFlight.get(key) as Promise<R> | undefined;
      if (running) return running;
      const started = fetch().finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, started);
      return started;
    },
  };
}
