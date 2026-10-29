/**
 * The rules of an event's markets over time. The provider gives only the
 * current text, so Ryntra keeps what it read: one record per event, a
 * fingerprint per venue market, and — once the text or a date changes — the
 * version before and the version after. The records sit in the line's own
 * Guard collection under their own key (`rules:event:<id>`), clear of the
 * wallets' rows (`solana:mainnet:<wallet>`, `profile:<wallet>`), until the
 * store has a collection of their own. A
 * market seen for the first time has no history; a change is dated by when
 * Ryntra first read it, not when the venue made it.
 *
 * Reading never waits on the store for long and never fails the page: a store
 * that is slow or down answers with no history.
 *
 * Server only.
 */

import { getGuardRuntime } from "../guard/runtime.ts";
import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import type { PredictionMarket } from "./model.ts";
import { rulesDiff, rulesEmpty, rulesFingerprint, rulesSnapshot, type RulesChange, type RulesSnapshot } from "./resolution.ts";

type MarketTrack = Readonly<{
  venue: string;
  fingerprint: string;
  firstSeen: string;
  /** The current version as read, kept so the next change can show what it replaced. */
  current: RulesSnapshot;
  /** Each change as what it removed, added and moved — not the two whole versions. */
  changes: readonly RulesChange[];
}>;

export type RulesHistoryRecord = Readonly<{ version: number; eventId: string; markets: Readonly<Record<string, MarketTrack>>; updatedAt: string }>;

/** The changes kept per venue market, newest first; older ones fall off. */
export const RULES_CHANGES_KEPT = 3;
/** The venue markets tracked per event — an event of hundreds of markets keeps its first ones. */
export const RULES_MARKETS_KEPT = 120;
/** How long a page waits for the store before it draws without history. */
export const RULES_HISTORY_WAIT_MS = 1200;

export type RulesHistory = Readonly<Record<string, readonly RulesChange[]>>;

function collection(store: GuardStore) {
  return store.versioned<RulesHistoryRecord>("predictionWatchlists");
}

/** Every venue market of the event — each anchor and each matched one — with what Ryntra keeps of its rules. */
export function venueMarketsOf(markets: readonly PredictionMarket[]): readonly Readonly<{ id: string; venue: string; snapshot: RulesSnapshot }>[] {
  const out: { id: string; venue: string; snapshot: RulesSnapshot }[] = [];
  const seen = new Set<string>();
  for (const m of markets) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      out.push({ id: m.id, venue: m.venue, snapshot: rulesSnapshot(m) });
    }
    for (const v of m.matched) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      out.push({ id: v.id, venue: v.venue, snapshot: rulesSnapshot(v) });
    }
  }
  return out.slice(0, RULES_MARKETS_KEPT);
}

/**
 * The record after reading the event once more: a new market is tracked from
 * now, a changed one gets a dated change; `null` when nothing is new and
 * nothing needs writing.
 */
export function nextRulesRecord(current: RulesHistoryRecord | null, eventId: string, markets: readonly PredictionMarket[], nowMs: number): RulesHistoryRecord | null {
  const at = new Date(nowMs).toISOString();
  const tracks: Record<string, MarketTrack> = { ...(current?.markets ?? {}) };
  let dirty = false;
  for (const vm of venueMarketsOf(markets)) {
    const fingerprint = rulesFingerprint(vm.snapshot);
    const was = tracks[vm.id];
    if (!was) {
      if (Object.keys(tracks).length >= RULES_MARKETS_KEPT) continue;
      tracks[vm.id] = { venue: vm.venue, fingerprint, firstSeen: at, current: vm.snapshot, changes: [] };
      dirty = true;
      continue;
    }
    if (was.fingerprint === fingerprint) continue;
    /* A read that came back with no text is the provider's gap, not new rules; a first read without text is not a version to compare against. */
    if (rulesEmpty(vm.snapshot) && !rulesEmpty(was.current)) continue;
    const diff = rulesDiff(was.current, vm.snapshot);
    /* After a read without text the sentences are no comparison — but a moved date still is. */
    if (rulesEmpty(was.current) && !diff.closes && !diff.resolves) {
      tracks[vm.id] = { ...was, fingerprint, current: vm.snapshot };
      dirty = true;
      continue;
    }
    const change: RulesChange = { at, venue: vm.venue, venueMarketId: vm.id, diff: rulesEmpty(was.current) ? { ...diff, removed: [], added: [] } : diff };
    tracks[vm.id] = { ...was, fingerprint, current: vm.snapshot, changes: [change, ...was.changes].slice(0, RULES_CHANGES_KEPT) };
    dirty = true;
  }
  if (!dirty) return null;
  return { version: (current?.version ?? 0) + 1, eventId, markets: tracks, updatedAt: at };
}

export function historyOf(record: RulesHistoryRecord | null): RulesHistory {
  const out: Record<string, readonly RulesChange[]> = {};
  for (const [id, track] of Object.entries(record?.markets ?? {})) if (track.changes.length > 0) out[id] = track.changes;
  return out;
}

/**
 * Read the event's rules history and record what is new; on any store
 * trouble, no history. An event whose every market has its result is read,
 * never written: its rules no longer matter to a buyer.
 */
export async function observeRules(store: GuardStore, eventId: string, markets: readonly PredictionMarket[], nowMs: number = Date.now()): Promise<RulesHistory> {
  const key = `rules:event:${eventId}`;
  const settled = markets.length > 0 && markets.every((m) => m.status === "resolved");
  const work = (async () => {
    let seen: RulesHistoryRecord | null = null;
    try {
      await withBoundedCasRetry(async () => {
        const current = (await collection(store).get(key)) ?? null;
        seen = current;
        const next = settled ? null : nextRulesRecord(current, eventId, markets, nowMs);
        if (!next) return true;
        const ok = current ? await collection(store).compareAndSet(key, current.version, next) : await collection(store).insertIfAbsent(key, next);
        if (ok) seen = next;
        return ok;
      });
    } catch {
      /* A lost race or a failed write still has the history it read. */
    }
    return historyOf(seen);
  })();
  const timeout = new Promise<RulesHistory>((resolve) => {
    const timer = setTimeout(() => resolve({}), RULES_HISTORY_WAIT_MS);
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.race([work.catch(() => ({})), timeout]);
}

/** The page's read: the shared store's history for the event; no store, no history. */
export async function readRulesHistory(eventId: string, markets: readonly PredictionMarket[]): Promise<RulesHistory> {
  try {
    return await observeRules(getGuardRuntime().store, eventId, markets);
  } catch {
    return {};
  }
}
