import "server-only";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { deskOf, type ScoutDesk } from "./desk.ts";
import { appendHour, emptyHour, hourOf, type JournalEntry, type JournalHour } from "./journal.ts";
import type { ThesisMeter } from "./pass.ts";
import { SCOUT_JOURNAL } from "./rules.ts";

/**
 * Where the Scout keeps its desk and its journal: the store every instance shares (the Guard store, compare-and-set), in
 * its own collection `agentScout` — public data only, a value in the same column, no new table:
 *
 *   desk:<network>              the desk (`./desk.ts`), versioned
 *   journal:<network>:<hour>    one hour of the journal (`./journal.ts`), versioned
 *   pass:<network>:<slot>       one claim per five-minute slot, so two instances never run the same pass
 *
 * The day's counters — the model's calls and the chain reads — live beside the assistant's and the sentence's in
 * `agentBudget`, under their own keys, never in theirs.
 */

const COLLECTION = "agentScout" as const;
const COUNTERS = "agentBudget" as const;

export const PASS_SLOT_MS = 5 * 60_000;

export type ScoutNetwork = "mainnet";

export const deskKey = (network: ScoutNetwork) => `desk:${network}`;
export const journalKey = (network: ScoutNetwork, hour: string) => `journal:${network}:${hour}`;

export async function loadDesk(store: GuardStore, network: ScoutNetwork): Promise<ScoutDesk> {
  const key = deskKey(network);
  return deskOf(await store.versioned<ScoutDesk>(COLLECTION).get(key), key);
}

/** Writes the desk only over the version it was read at: a pass that lost the race leaves the winner's desk as it is. */
export async function saveDesk(store: GuardStore, before: ScoutDesk, next: ScoutDesk): Promise<boolean> {
  /* A desk never stored reads as version 0; a stored one is 1 or more. */
  return store.versioned<ScoutDesk>(COLLECTION).compareAndSet(next.key, before.version === 0 ? null : before.version, { ...next, version: before.version + 1 });
}

/** One claim per slot: true — this instance runs the pass. */
export async function claimPass(store: GuardStore, network: ScoutNetwork, now: number): Promise<boolean> {
  const slot = Math.floor(now / PASS_SLOT_MS);
  return store.collection<{ at: number }>(COLLECTION).insertIfAbsent(`pass:${network}:${slot}`, { at: now });
}

/** The pass's news into the journal, by the hour each was decided in. */
export async function appendJournal(store: GuardStore, network: ScoutNetwork, entries: readonly JournalEntry[]): Promise<void> {
  const byHour = new Map<string, JournalEntry[]>();
  for (const entry of entries) {
    const hour = hourOf(entry.at);
    byHour.set(hour, [...(byHour.get(hour) ?? []), entry]);
  }
  const hours = store.versioned<JournalHour>(COLLECTION);
  for (const [hour, list] of byHour) {
    const key = journalKey(network, hour);
    await withBoundedCasRetry(async () => {
      const current = (await hours.get(key)) ?? null;
      const base = current ?? emptyHour(key, hour);
      const next = appendHour(base, list);
      return (await hours.compareAndSet(key, current ? current.version : null, next)) ? true : false;
    });
  }
}

/** The journal's hours, the newest first, as far back as `hoursBack` (a week at most). */
export async function readJournal(store: GuardStore, network: ScoutNetwork, now: number, hoursBack: number): Promise<JournalHour[]> {
  const span = Math.max(1, Math.min(SCOUT_JOURNAL.keepHours, Math.floor(hoursBack)));
  const keys = Array.from({ length: span }, (_, index) => journalKey(network, hourOf(now - index * 3_600_000)));
  const hours = store.versioned<JournalHour>(COLLECTION);
  const read = await Promise.all(keys.map((key) => hours.get(key).catch(() => undefined)));
  return read.filter((hour): hour is JournalHour => Boolean(hour));
}

/* ------------------------------------------------------------ the day's counters */

type Counter = { version: number; key: string; count: number; updatedAt: string };

const dayOf = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

function isCounter(value: unknown): value is Counter {
  const v = value as Partial<Counter> | null;
  return typeof v === "object" && v !== null && Number.isInteger(v.version) && typeof v.key === "string" && Number.isInteger(v.count) && (v.count ?? -1) >= 0;
}

async function advance(store: GuardStore, key: string, delta: number, nowMs: number): Promise<number> {
  const counters = store.versioned<Counter>(COUNTERS);
  return withBoundedCasRetry(async () => {
    const raw = await counters.get(key);
    const current = isCounter(raw) ? raw : null;
    const count = Math.max(0, (current?.count ?? 0) + delta);
    const next: Counter = { version: (current?.version ?? 0) + 1, key, count, updatedAt: new Date(nowMs).toISOString() };
    return (await counters.compareAndSet(key, current?.version ?? null, next)) ? count : false;
  });
}

async function countOf(store: GuardStore, key: string): Promise<number> {
  const raw = await store.versioned<Counter>(COUNTERS).get(key);
  return isCounter(raw) ? raw.count : 0;
}

/** The model's calls today, everyone's together: counted first, judged after; one past the day's calls gives it back. */
export function scoutThesisMeter(store: GuardStore, dayCalls: number): ThesisMeter {
  return {
    async take(nowMs) {
      const key = `scout:thesis:day:${dayOf(nowMs)}`;
      try {
        const count = await advance(store, key, 1, nowMs);
        if (count > dayCalls) {
          await advance(store, key, -1, nowMs).catch(() => 0);
          return { ok: false, reason: "limit" };
        }
        return { ok: true, give: async () => void (await advance(store, key, -1, nowMs).catch(() => 0)) };
      } catch {
        return { ok: false, reason: "down" };
      }
    },
  };
}

/** The chain reads left today. */
export async function chainReadsLeft(store: GuardStore, nowMs: number, perDay: number): Promise<number> {
  return Math.max(0, perDay - (await countOf(store, `scout:chain:day:${dayOf(nowMs)}`)));
}

export async function countChainReads(store: GuardStore, nowMs: number, reads: number): Promise<void> {
  if (reads > 0) await advance(store, `scout:chain:day:${dayOf(nowMs)}`, reads, nowMs);
}

/** The model's calls made today. */
export async function thesisCallsToday(store: GuardStore, nowMs: number): Promise<number> {
  return countOf(store, `scout:thesis:day:${dayOf(nowMs)}`);
}
