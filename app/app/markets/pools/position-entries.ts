"use client";

/**
 * What went into each position, kept in this browser per wallet (SOL-2b): the
 * chain holds no record of a deposit, so the page keeps the one the person
 * signed through Ryntra, or the one they type for a position opened elsewhere.
 * Another browser or a cleared one has none, and the page says so — it never
 * guesses an entry. The arithmetic is `lib/liquidity/catalog/track.ts`.
 */

import { useCallback, useEffect, useState } from "react";

import type { PositionView } from "@/lib/liquidity/catalog/positions";
import { entryAfterAdd, entryAfterClaim, entryAfterRemove, readEntry, settleEntry, type AddedAmounts, type PositionEntry } from "@/lib/liquidity/catalog/track";

const KEY = "ryntra.pools.entries.v1:";
/** The same tab hears its own writes through this event; other tabs through `storage`. */
const CHANGED = "ryntra:pool-entries";

type Entries = Readonly<Record<string, PositionEntry>>;

function readAll(owner: string): Entries {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY + owner) ?? "null") as unknown;
    if (!raw || typeof raw !== "object") return {};
    const entries: Record<string, PositionEntry> = {};
    for (const [position, value] of Object.entries(raw as Record<string, unknown>)) {
      const entry = readEntry(value);
      if (entry) entries[position] = entry;
    }
    return entries;
  } catch {
    return {};
  }
}

function change(owner: string, position: string, next: (entry: PositionEntry | null) => PositionEntry | null): void {
  try {
    const all: Record<string, PositionEntry> = { ...readAll(owner) };
    const entry = next(all[position] ?? null);
    if (entry) all[position] = entry;
    else delete all[position];
    window.localStorage.setItem(KEY + owner, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent(CHANGED, { detail: owner }));
  } catch {
    /* No storage (a private window, blocked site data): the page shows no entry, as for any position opened elsewhere. */
  }
}

/** A deposit landed: a new position starts its entry; a known one adds to it. */
export function recordAdd(owner: string, position: string, added: AddedAmounts, opensPosition: boolean): void {
  change(owner, position, (entry) => entryAfterAdd(entry, added, opensPosition));
}

/** A withdrawal landed; the share is of the part that may be withdrawn. */
export function recordRemove(owner: string, position: string, shareBps: number, closes: boolean, lockedBps: number): void {
  change(owner, position, (entry) => entryAfterRemove(entry, shareBps, closes, lockedBps));
}

/** A claim landed. */
export function recordClaim(owner: string, position: string, claimedUsd: number | null): void {
  change(owner, position, (entry) => entryAfterClaim(entry, claimedUsd));
}

/** The person's own figure, or none. */
export function saveEntry(owner: string, position: string, entry: PositionEntry | null): void {
  change(owner, position, () => entry);
}

/**
 * The wallet's entries, kept current as this tab or another one changes them; empty until the browser has read them.
 * `positions` — the chain's read: an entry still waiting on its deposit's amounts takes them from it.
 */
export function usePositionEntries(owner: string | null, positions?: readonly PositionView[] | null): Entries {
  const [entries, setEntries] = useState<Entries>({});
  const refresh = useCallback(() => setEntries(owner ? readAll(owner) : {}), [owner]);
  useEffect(() => {
    refresh();
    if (!owner) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === KEY + owner) refresh();
    };
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === owner) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGED, onChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGED, onChanged);
    };
  }, [owner, refresh]);
  useEffect(() => {
    if (!owner || !positions) return;
    for (const view of positions) {
      const entry = entries[view.address];
      if (entry?.pending) change(owner, view.address, (current) => (current ? settleEntry(current, view) : null));
    }
  }, [owner, positions, entries]);
  return entries;
}
