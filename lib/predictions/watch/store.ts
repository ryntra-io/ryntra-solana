/**
 * The durable side of a watch: the rules a person set, and the signals their
 * rules raised.
 *
 * Both live in the line's own Guard collection under keys of their own
 * (`watch:rule:…`, `watch:signal:…`), beside the profiles and the
 * notification rows — the store's list of collections is not this line's to
 * extend.
 *
 * Two identities do the work that would otherwise need locks:
 *
 * - **a rule is its own shape.** The same watch set twice — from the market
 *   page and from the portfolio, or by pressing twice — lands on the same
 *   key, so a person ends with one rule that rings once.
 * - **a signal is the happening it is about.** The key is the rule and the
 *   engine's identity for the event (the news item, the bar, the level), so a
 *   pass that ran twice, two instances at once, or a retry after a crash
 *   leave one signal. The same thing again inside the grouping window raises
 *   its count rather than writing a second row — the same discipline the
 *   notification channel keeps, for the same reason.
 *
 * A signal moves through the states a person sees: **detected** when the
 * engine first saw it, **confirmed** when a later read still showed it,
 * **stale** when the market no longer does or the figures have aged past
 * acting on, **unavailable** when the market could not be read, and **read**
 * once the person has seen it. The move to confirmed or stale sends nothing:
 * one happening is told once.
 *
 * Nothing here trades, quotes, signs or spends, and no row is permission to.
 *
 * Server only.
 */

import { createHash } from "node:crypto";

import { withBoundedCasRetry, type GuardStore } from "../../guard/store.ts";
import { WATCH_SIGNAL_FRESH_MS, type WatchFacts, type WatchObservation, type WatchOutcome } from "./engine.ts";
import { ruleIdentity, WATCH_RULES_LIMIT, type WatchRuleInput, type WatchRuleKind, type WatchSubject } from "./rules.ts";

export const WATCH_COLLECTION = "predictionWatchlists" as const;

const RULE_PREFIX = "watch:rule:";
const SIGNAL_PREFIX = "watch:signal:";

/** The same happening again inside this window raises one signal's count instead of writing a second. */
export const WATCH_SIGNAL_GROUP_MS = 6 * 3_600_000;
/** How many of a wallet's signals are kept; older ones go. */
export const WATCH_SIGNALS_KEPT = 80;

export type WatchSignalState = "detected" | "confirmed" | "stale" | "unavailable" | "read";

export type WatchRuleRecord = Readonly<{
  version: number;
  kind: "watch-rule";
  id: string;
  wallet: string;
  rule: WatchRuleInput;
  /** False and the engine does not judge it: the watch is off, the rule is kept. */
  on: boolean;
  /** What the rule saw last time; null until a pass has read it once. */
  observation: WatchObservation | null;
  lastOutcome: WatchOutcome | null;
  /** Ryntra's own code for the last verdict, for the record; never a sentence. */
  lastReason: string | null;
  lastCheckedAt: string | null;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type WatchSignalRecord = Readonly<{
  version: number;
  kind: "watch-signal";
  id: string;
  wallet: string;
  ruleId: string;
  ruleKind: WatchRuleKind;
  subject: WatchSubject;
  /** The engine's identity for the happening, kept so a reader can see why two signals are not one. */
  event: string;
  facts: WatchFacts;
  state: WatchSignalState;
  /** Why it is no longer current, where it is not; Ryntra's own code. */
  reason: string | null;
  /** The sentence a model added, already held to the figures; null when none was kept. */
  explanation: string | null;
  count: number;
  paper: boolean;
  confirmedAt: string | null;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

const digest = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 24);

/** A rule's id: its own shape, so the same watch set twice is one rule. */
export const watchRuleId = (wallet: string, input: WatchRuleInput) => digest(`${wallet}:${ruleIdentity(input)}`);
/** A signal's id: the rule and the happening, so the same happening read twice is one signal. */
export const watchSignalId = (wallet: string, ruleId: string, event: string) => digest(`${wallet}:${ruleId}:${event}`);

const ruleKey = (wallet: string, id: string) => `${RULE_PREFIX}${wallet}:${id}`;
const signalKey = (wallet: string, id: string) => `${SIGNAL_PREFIX}${wallet}:${id}`;

const rules = (store: GuardStore) => store.versioned<WatchRuleRecord>(WATCH_COLLECTION);
const signals = (store: GuardStore) => store.versioned<WatchSignalRecord>(WATCH_COLLECTION);

const isRule = (row: unknown): row is WatchRuleRecord => typeof row === "object" && row !== null && (row as WatchRuleRecord).kind === "watch-rule";
const isSignal = (row: unknown): row is WatchSignalRecord => typeof row === "object" && row !== null && (row as WatchSignalRecord).kind === "watch-signal";

/* ------------------------------------------------------------------ rules */

export async function listWatchRules(store: GuardStore, wallet: string): Promise<readonly WatchRuleRecord[]> {
  const rows: readonly WatchRuleRecord[] = await rules(store).valuesWithPrefix(`${RULE_PREFIX}${wallet}:`).catch(() => []);
  return rows.filter((row) => isRule(row) && row.wallet === wallet).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function readWatchRule(store: GuardStore, wallet: string, id: string): Promise<WatchRuleRecord | null> {
  const row = await rules(store).get(ruleKey(wallet, id)).catch(() => undefined);
  return isRule(row) && row.wallet === wallet ? row : null;
}

export type PutRuleOutcome = Readonly<{ ok: true; record: WatchRuleRecord; fresh: boolean }> | Readonly<{ ok: false; code: "limit" | "store" }>;

/**
 * Take a rule, or find the one already there. A rule arriving again carries
 * the person's own note and turns the watch back on. What the engine saw is
 * left alone while the watch was running, so re-saving a rule does not make
 * it announce a level it had already passed; a rule that was off starts over.
 */
export async function putWatchRule(store: GuardStore, wallet: string, input: WatchRuleInput, nowMs: number = Date.now()): Promise<PutRuleOutcome> {
  const id = watchRuleId(wallet, input);
  const key = ruleKey(wallet, id);
  const stamp = new Date(nowMs).toISOString();
  const fresh: WatchRuleRecord = {
    version: 1,
    kind: "watch-rule",
    id,
    wallet,
    rule: input,
    on: true,
    observation: null,
    lastOutcome: null,
    lastReason: null,
    lastCheckedAt: null,
    lastFiredAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const existing = await rules(store).get(key).catch(() => undefined);
  if (!isRule(existing)) {
    const held = await listWatchRules(store, wallet);
    if (held.length >= WATCH_RULES_LIMIT) return { ok: false, code: "limit" };
    if (await rules(store).insertIfAbsent(key, fresh).catch(() => false)) return { ok: true, record: fresh, fresh: true };
  }
  /* A rule set again while it was off starts over too: the pause is a gap in the watching like any other. */
  const updated = await patchRule(store, wallet, id, (current) => ({ rule: { ...input, note: input.note ?? current.rule.note }, on: true, ...(current.on ? {} : { observation: null, lastOutcome: null, lastReason: null }) }), nowMs);
  return updated ? { ok: true, record: updated, fresh: false } : { ok: false, code: "store" };
}

async function patchRule(store: GuardStore, wallet: string, id: string, change: (current: WatchRuleRecord) => Partial<WatchRuleRecord>, nowMs: number): Promise<WatchRuleRecord | null> {
  const key = ruleKey(wallet, id);
  try {
    return await withBoundedCasRetry(async () => {
      const current = await rules(store).get(key);
      if (!isRule(current) || current.wallet !== wallet) return null as never;
      const next: WatchRuleRecord = { ...current, ...change(current), version: current.version + 1, updatedAt: new Date(nowMs).toISOString() };
      return (await rules(store).compareAndSet(key, current.version, next)) ? next : false;
    });
  } catch {
    return null;
  }
}

/**
 * The watch on one rule, on or off. The rule and its signals stay either way.
 *
 * Turning one back on forgets what it last saw: nothing was watched while it
 * was off, so the next pass writes down where the market stands instead of
 * announcing a level it crossed in the meantime.
 */
export async function setWatchRuleOn(store: GuardStore, wallet: string, id: string, on: boolean, nowMs: number = Date.now()): Promise<WatchRuleRecord | null> {
  return patchRule(store, wallet, id, (current) => (on && !current.on ? { on, observation: null, lastOutcome: null, lastReason: null } : { on }), nowMs);
}

/** One touch: every rule of the wallet off. Nothing is deleted, so turning the watch back on needs no setting up again. */
export async function stopEveryWatchRule(store: GuardStore, wallet: string, nowMs: number = Date.now()): Promise<number> {
  let stopped = 0;
  for (const record of await listWatchRules(store, wallet)) {
    if (!record.on) continue;
    if (await patchRule(store, wallet, record.id, () => ({ on: false }), nowMs)) stopped += 1;
  }
  return stopped;
}

export async function removeWatchRule(store: GuardStore, wallet: string, id: string): Promise<boolean> {
  const found = await readWatchRule(store, wallet, id);
  if (!found) return false;
  await rules(store).delete(ruleKey(wallet, id)).catch(() => undefined);
  return true;
}

/** What a pass saw, written on the rule: the observation the next pass compares against, and the last verdict. */
export async function recordVerdict(
  store: GuardStore,
  wallet: string,
  id: string,
  seen: Readonly<{ observation: WatchObservation; outcome: WatchOutcome; reason: string; fired: boolean }>,
  nowMs: number = Date.now(),
): Promise<WatchRuleRecord | null> {
  return patchRule(
    store,
    wallet,
    id,
    (current) => ({
      observation: seen.observation,
      lastOutcome: seen.outcome,
      lastReason: seen.reason,
      lastCheckedAt: new Date(nowMs).toISOString(),
      lastFiredAt: seen.fired ? new Date(nowMs).toISOString() : current.lastFiredAt,
    }),
    nowMs,
  );
}

/* ------------------------------------------------------------------ signals */

export async function listWatchSignals(store: GuardStore, wallet: string, limit = 40): Promise<readonly WatchSignalRecord[]> {
  const rows: readonly WatchSignalRecord[] = await signals(store).valuesWithPrefix(`${SIGNAL_PREFIX}${wallet}:`).catch(() => []);
  return rows
    .filter((row) => isSignal(row) && row.wallet === wallet)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
}

export type SignalOutcome = Readonly<{ signal: WatchSignalRecord; fresh: boolean }>;

/**
 * Write the signal for a happening, or raise the count of the one already
 * there. A happening is only ever written once: the identity is the rule and
 * the engine's own name for the event, so two passes at once leave one row.
 * Past the grouping window the same identity starts the signal over, because
 * it is news again.
 */
export async function raiseSignal(
  store: GuardStore,
  wallet: string,
  input: Readonly<{ ruleId: string; ruleKind: WatchRuleKind; subject: WatchSubject; event: string; facts: WatchFacts; paper: boolean; explanation: string | null }>,
  nowMs: number = Date.now(),
): Promise<SignalOutcome> {
  const id = watchSignalId(wallet, input.ruleId, input.event);
  const key = signalKey(wallet, id);
  const stamp = new Date(nowMs).toISOString();
  const fresh: WatchSignalRecord = {
    version: 1,
    kind: "watch-signal",
    id,
    wallet,
    ruleId: input.ruleId,
    ruleKind: input.ruleKind,
    subject: input.subject,
    event: input.event,
    facts: input.facts,
    state: "detected",
    reason: null,
    explanation: input.explanation,
    count: 1,
    paper: input.paper,
    confirmedAt: null,
    readAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  if (await signals(store).insertIfAbsent(key, fresh).catch(() => false)) return { signal: fresh, fresh: true };
  try {
    let restarted = false;
    const raised = await withBoundedCasRetry(async () => {
      const current = await signals(store).get(key);
      if (!isSignal(current)) return fresh;
      /* Past the grouping window the same identity is news again, so the signal starts over rather than carrying a count from last week. */
      const over = nowMs - Date.parse(current.createdAt) >= WATCH_SIGNAL_GROUP_MS;
      const next: WatchSignalRecord = over
        ? { ...fresh, version: current.version + 1 }
        : { ...current, facts: input.facts, explanation: input.explanation ?? current.explanation, count: current.count + 1, updatedAt: stamp, version: current.version + 1 };
      const written = await signals(store).compareAndSet(key, current.version, next);
      if (!written) return false;
      restarted = over;
      return next;
    });
    return { signal: raised, fresh: restarted };
  } catch {
    const current = await signals(store).get(key).catch(() => null);
    return { signal: isSignal(current) ? current : fresh, fresh: false };
  }
}

async function patchSignal(store: GuardStore, wallet: string, id: string, change: (current: WatchSignalRecord) => Partial<WatchSignalRecord>, nowMs: number): Promise<WatchSignalRecord | null> {
  const key = signalKey(wallet, id);
  try {
    return await withBoundedCasRetry(async () => {
      const current = await signals(store).get(key);
      if (!isSignal(current) || current.wallet !== wallet) return null as never;
      const next: WatchSignalRecord = { ...current, ...change(current), version: current.version + 1, updatedAt: new Date(nowMs).toISOString() };
      return (await signals(store).compareAndSet(key, current.version, next)) ? next : false;
    });
  } catch {
    return null;
  }
}

/** Only a signal still being followed moves on its own; a read one is where the person left it. */
export const signalOpen = (signal: WatchSignalRecord) => signal.state === "detected" || signal.state === "confirmed" || signal.state === "unavailable";

/**
 * A later read's word on a signal. Confirming and going stale send nothing —
 * one happening is told once — and a signal the person has read is left as
 * they left it.
 */
export async function settleSignal(store: GuardStore, wallet: string, id: string, state: Exclude<WatchSignalState, "detected" | "read">, reason: string, nowMs: number = Date.now()): Promise<WatchSignalRecord | null> {
  return patchSignal(
    store,
    wallet,
    id,
    (current) => ({
      state: current.state === "read" ? current.state : state,
      reason: state === "confirmed" ? null : reason,
      confirmedAt: state === "confirmed" ? (current.confirmedAt ?? new Date(nowMs).toISOString()) : current.confirmedAt,
    }),
    nowMs,
  );
}

/** A signal whose figures have aged past acting on, wherever it stands. */
export const signalAged = (signal: WatchSignalRecord, nowMs: number) => nowMs - Date.parse(signal.createdAt) >= WATCH_SIGNAL_FRESH_MS;

export async function markSignalsRead(store: GuardStore, wallet: string, ids: readonly string[] | null, nowMs: number = Date.now()): Promise<number> {
  const wanted = ids === null ? null : new Set(ids);
  let marked = 0;
  for (const signal of await listWatchSignals(store, wallet, WATCH_SIGNALS_KEPT)) {
    if (signal.readAt !== null || (wanted && !wanted.has(signal.id))) continue;
    if (await patchSignal(store, wallet, signal.id, () => ({ state: "read", readAt: new Date(nowMs).toISOString() }), nowMs)) marked += 1;
  }
  return marked;
}

/** The signals past what is kept go; a rule removed takes its own with it. */
export async function pruneSignals(store: GuardStore, wallet: string, keptRuleIds: ReadonlySet<string> | null = null): Promise<void> {
  const all = await listWatchSignals(store, wallet, Number.MAX_SAFE_INTEGER);
  for (const [at, signal] of all.entries()) {
    const orphan = keptRuleIds !== null && !keptRuleIds.has(signal.ruleId);
    if (!orphan && at < WATCH_SIGNALS_KEPT) continue;
    await signals(store).delete(signalKey(wallet, signal.id)).catch(() => undefined);
  }
}

/**
 * The wallets a pass has anything to watch for: the ones that set a rule.
 * A wallet that only ever read markets is waiting for nothing, and a wallet
 * whose every rule is off is read without being judged — the pass sees that
 * for itself.
 */
export async function watchWallets(store: GuardStore, limit = 50): Promise<readonly string[]> {
  const rows: readonly WatchRuleRecord[] = await rules(store).valuesWithPrefix(RULE_PREFIX).catch(() => []);
  const wallets = new Set<string>();
  for (const row of rows) {
    if (!isRule(row) || typeof row.wallet !== "string" || row.wallet.length === 0) continue;
    wallets.add(row.wallet);
    if (wallets.size >= limit) break;
  }
  return [...wallets];
}
