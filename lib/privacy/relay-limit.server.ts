/**
 * The relay's limit shared by every instance: calls per minute, counted in the Guard store — the same durable,
 * multi-writer store the payouts, the agent quotas and the send-once records stand on (`lib/guard/`).
 *
 * Why: the relay spends Ryntra's Helius key. Counted in one warm instance's memory, the limit is a limit per instance —
 * N instances hand an address N times the calls, and a cold start hands the window back. Here one record per network,
 * minute and subject holds that minute's count, stepped by the store in one atomic operation (`countStep` — in Postgres
 * one `INSERT … ON CONFLICT DO UPDATE … WHERE used < limit`), so calls racing on the same window — two instances, or
 * one person's page sending several at once — are each counted once, never retried and never refused for contention,
 * and none passes the limit. The subject is kept as its sha256, never in the clear.
 *
 * **What a mainnet call is counted against** — `relayBuckets`: its address, an IPv6 one by its
 * /64 (the handler reduces it), and the wallet its session names, each with `RELAY_LIMIT`; a proof, the prover's own work
 * of up to a minute, besides against `RELAY_PROVE_LIMIT` on both. A proven wallet costs nothing to make, so the wallet
 * alone would be no limit; the address alone, shared by many people behind one network, would be one for them all. Both
 * hold: a call passes only when every count it is counted against has room (`consumeRelayQuotas`) — and a call one count
 * refuses is taken back from the others it was counted in (`releaseRelayQuota`), so a person whose wallet's
 * minute is spent does not spend the minute of everyone behind the same address.
 *
 * **A limit that cannot be counted is not a limit.** When the store does not answer, the call is refused (503) rather
 * than let through: an unhealthy store is exactly when an unbounded caller
 * spends most. Off the test network the store must be shared between instances, or every call is refused
 * (`NOT_SHARED`); on devnet a store that is not shared leaves the instance's own limit in charge, as before.
 *
 * No migration: `GUARD_COLLECTIONS` gained `privacyRelayQuotas`, a value in the generic table's existing column.
 *
 * **Rows go without a scan.** A record's key leads with its minute —
 * `<network>:<window start>:<sha256>` — so the rows of a minute are exactly the rows under that minute's prefix. Before a
 * minute's first row is counted, the minute is named in the network's ledger — a row of its own,
 * `<network>:minute:<start>`, written once by whichever instance comes first (`insertIfAbsent`; once per instance and
 * minute) — so every row's minute is named there and no record is raced for. A sweep reads the ledger, takes the minutes in it that have
 * been over for `RELAY_QUOTA_STALE_MS`, removes each minute's rows by its prefix in one step (`deleteWithPrefix` — in
 * Postgres one `DELETE … WHERE key LIKE '<prefix>%'`) and takes the minute off the ledger. So a sweep reads no
 * row at all, removes a minute whole however many rows it holds — no ceiling of rows a minute per instance — and never
 * looks at a minute nobody called in: after a quiet hour the next sweep takes the minutes that hold rows, not sixty empty
 * ones. Two instances sweeping the same minute at once remove each row once between them. At most `RELAY_SWEEP_WINDOWS`
 * minutes at a time, so a call that sweeps stays quick. Sweeps ride on the moment a row opens — the only moment the table
 * grows — at most once per `RELAY_SWEEP_EVERY_MS` per instance, and every `RELAY_SWEEP_BEHIND_MS` while one is behind
 * (more minutes over than one sweep takes), never on every new row. A row is written only for a call the relay has
 * already checked (`relay-handler.server.ts`).
 *
 * In Postgres the prefix is a `key LIKE '<prefix>%'` on the table's primary key `(collection, key)`: the index finds the
 * collection, and the key's prefix narrows it within the index only where the database's collation is `C`; elsewhere the
 * rows of `privacyRelayQuotas` are filtered — which, swept like this, are the last few minutes' subjects.
 */

import { createHash } from 'node:crypto';

import { storeSupportsConcurrentInstances, type GuardStore } from '../guard/store.ts';
import type { RateLimitDecision } from '../http-control.ts';
import type { PrivateNetwork } from './network.ts';

/** Calls per address (and on mainnet per wallet) per minute: a balance read and a proof take a few dozen. */
export const RELAY_LIMIT = Object.freeze({ limit: 300, windowMs: 60_000 });
/** Proofs per address and per wallet per minute: the prover's enclave works up to a minute on each; a step asks a few. */
export const RELAY_PROVE_LIMIT = Object.freeze({ limit: 12, windowMs: RELAY_LIMIT.windowMs });

export const RELAY_COLLECTION = 'privacyRelayQuotas';

/** A minute's rows go once the minute has been over this long — room for the clock difference between instances. */
export const RELAY_QUOTA_STALE_MS = 60_000;
/** How often one instance sweeps, at most, while the sweeps keep up. */
export const RELAY_SWEEP_EVERY_MS = 60_000;
/** How soon the next sweep comes while one is behind: soon, but never on every new row. */
export const RELAY_SWEEP_BEHIND_MS = 5_000;
/** The most minutes one sweep removes — each one step, whatever it holds; more over than this, and another sweep follows. */
export const RELAY_SWEEP_WINDOWS = 30;

export type RelayQuotaRecord = Readonly<{ version: number; windowStartMs: number; used: number; key?: string }>;
/** A minute's place in a network's ledger of minutes that hold rows. */
export type RelayMinute = Readonly<{ minute: number }>;

/** One count a call is counted against: a subject (`address:…`, `wallet:…`, `prove:…`) and its ceiling. */
export type RelayBucket = Readonly<{ subject: string; limit: number }>;

/** Why a call could not be counted: the store did not answer, or the store is not shared. */
export type RelayLimitRefusal = 'UNAVAILABLE' | 'NOT_SHARED';

export type RelayLimitAnswer =
  | Readonly<{ kind: 'counted'; decision: RateLimitDecision }>
  /** The store is per instance and the network allows it (devnet): the instance's own limit decides. */
  | Readonly<{ kind: 'local' }>
  | Readonly<{ kind: 'refused'; refusal: RelayLimitRefusal }>;

/** The prefix of one minute's rows on a network. */
export function relayWindowPrefix(network: PrivateNetwork, windowStartMs: number): string {
  return `${network}:${windowStartMs}:`;
}

/** The record's key: the network, the minute and the subject's sha256 — no address and no wallet in the clear. */
export function relayQuotaKey(network: PrivateNetwork, address: string, windowStartMs: number): string {
  const digest = createHash('sha256').update(`ryntra/privacy-relay/v1:${address}`).digest('hex');
  return `${relayWindowPrefix(network, windowStartMs)}${digest}`;
}

/** The key of a minute's place in a network's ledger of minutes; it shares no prefix with any minute's rows. */
export function relayMinuteKey(network: PrivateNetwork, minute: number): string {
  return `${relayMinutePrefix(network)}${minute}`;
}

/** The prefix of a network's ledger of minutes. */
export function relayMinutePrefix(network: PrivateNetwork): string {
  return `${network}:minute:`;
}

/**
 * What a mainnet call is counted against: its address (the caller passes an IPv6 one by its /64) and the wallet its
 * session names, each with `RELAY_LIMIT`; a proof besides against `RELAY_PROVE_LIMIT` on both.
 */
export function relayBuckets(input: Readonly<{ address: string; wallet: string | null; proof: boolean }>): readonly RelayBucket[] {
  const subjects = [`address:${input.address}`, ...(input.wallet ? [`wallet:${input.wallet}`] : [])];
  const calls = subjects.map((subject) => ({ subject, limit: RELAY_LIMIT.limit }));
  return input.proof ? [...calls, ...subjects.map((subject) => ({ subject: `prove:${subject}`, limit: RELAY_PROVE_LIMIT.limit }))] : calls;
}

function decisionOf(used: number, windowStartMs: number, nowMs: number, allowed: boolean, limit: number, windowMs: number): RateLimitDecision {
  const resetAfterSeconds = Math.max(1, Math.ceil((windowStartMs + windowMs - nowMs) / 1_000));
  return { allowed, limit, remaining: Math.max(0, limit - used), resetAfterSeconds, retryAfterSeconds: resetAfterSeconds };
}

/* The minute each store last named in each network's ledger, in this instance — or the naming still under way, which every
   call of that minute waits on rather than naming it again. */
const noted = new WeakMap<GuardStore, Map<PrivateNetwork, Readonly<{ minute: number; done: Promise<void> }>>>();

/**
 * Names `minute` in the network's ledger of minutes that hold rows — before any row of it is counted, so every row's
 * minute is named there and a sweep needs nothing else to find it. One row per minute (`<network>:minute:<start>`),
 * written once by whichever instance comes first (`insertIfAbsent`): no record many instances race to change, so the
 * first calls of a minute never contend. Once per instance and minute; calls of the same minute in parallel
 * wait on one naming. Throws when the store does not answer: the call is then refused, never counted in a minute no sweep
 * would find.
 */
export async function noteRelayMinute(store: GuardStore, network: PrivateNetwork, minute: number): Promise<void> {
  let mine = noted.get(store);
  if (!mine) {
    mine = new Map();
    noted.set(store, mine);
  }
  const held = mine.get(network);
  if (held?.minute === minute) return held.done;
  const table = mine;
  const done = store
    .collection<RelayMinute>(RELAY_COLLECTION)
    .insertIfAbsent(relayMinuteKey(network, minute), { minute })
    .then(() => undefined);
  table.set(network, { minute, done });
  // A naming that failed is asked again by the next call of the minute.
  done.catch(() => {
    if (table.get(network)?.done === done) table.delete(network);
  });
  return done;
}

export type RelaySweep = Readonly<{
  /** Rows removed. */
  removed: number;
  /** Minutes removed — each in one step by its prefix, never the whole table, never a minute that holds no row. */
  windows: number;
  /** Whether every minute that is over was swept; false — another sweep should follow soon. */
  caughtUp: boolean;
}>;

/**
 * Removes the rows of `network`'s minutes that are over, as the ledger names them: each minute whole, in one step by its
 * prefix (`deleteWithPrefix`), so no count is read and no minute is too full for one sweep. At most `windows`
 * minutes; a minute leaves the ledger once its rows are gone. Two instances sweeping at once remove each row once.
 */
export async function sweepRelayQuotas(
  store: GuardStore,
  input: Readonly<{ network: PrivateNetwork; nowMs: number; windows?: number; windowMs?: number; staleMs?: number }>,
): Promise<RelaySweep> {
  const { network, nowMs } = input;
  const budget = input.windows ?? RELAY_SWEEP_WINDOWS;
  const windowMs = input.windowMs ?? RELAY_LIMIT.windowMs;
  const staleMs = input.staleMs ?? RELAY_QUOTA_STALE_MS;
  const quotas = store.versioned<RelayQuotaRecord>(RELAY_COLLECTION);
  const ledger = store.collection<RelayMinute>(RELAY_COLLECTION);
  // The last minute that is over by `staleMs`: its start + a minute + `staleMs` is now or earlier.
  const last = Math.floor((nowMs - staleMs - windowMs) / windowMs) * windowMs;
  const named = (await ledger.valuesWithPrefix(relayMinutePrefix(network))).map((row) => row?.minute).filter((minute): minute is number => Number.isSafeInteger(minute));
  const due = [...new Set(named)].filter((minute) => minute <= last).sort((a, b) => a - b);
  let removed = 0;
  let windows = 0;
  for (const minute of due.slice(0, budget)) {
    // A minute that is over is never written again: all of it goes at once, then its place in the ledger.
    removed += await quotas.deleteWithPrefix(relayWindowPrefix(network, minute));
    await ledger.delete(relayMinuteKey(network, minute));
    windows += 1;
  }
  return { removed, windows, caughtUp: windows === due.length };
}

/* When each store may next sweep each network, in this instance. */
const nextSweep = new WeakMap<GuardStore, Map<PrivateNetwork, number>>();

async function sweepNow(store: GuardStore, network: PrivateNetwork, nowMs: number, windowMs: number): Promise<void> {
  let next = nextSweep.get(store);
  if (!next) {
    next = new Map();
    nextSweep.set(store, next);
  }
  const at = next.get(network);
  // Not yet — unless the clock went back further than an interval.
  if (at !== undefined && nowMs < at && at - nowMs <= RELAY_SWEEP_EVERY_MS) return;
  next.set(network, nowMs + RELAY_SWEEP_EVERY_MS);
  try {
    const sweep = await sweepRelayQuotas(store, { network, nowMs, windowMs });
    if (!sweep.caughtUp) next.set(network, nowMs + RELAY_SWEEP_BEHIND_MS);
  } catch {
    // A sweep that fails is tried again at the next interval; the call it rode on is already counted.
  }
}

/**
 * Count one call of `address` (any subject) on `network` against the shared window: one atomic step of the store
 * (`countStep`), so calls in parallel — a person's page sends several at once — are each counted once, with no retry and
 * no refusal for contention, and none past the limit. Never throws: a store that fails is a refusal.
 */
export async function consumeRelayQuota(
  store: GuardStore,
  input: Readonly<{ network: PrivateNetwork; address: string; nowMs: number; limit?: number; windowMs?: number }>,
): Promise<RelayLimitAnswer> {
  const { network, address, nowMs } = input;
  const limit = input.limit ?? RELAY_LIMIT.limit;
  const windowMs = input.windowMs ?? RELAY_LIMIT.windowMs;
  /* Devnet keeps the instance's own window, as before the shared one (the lead's review of #1984): the test network never
     waits on the database, nor fails with it; the shared window is mainnet's, where the key is a paid one. */
  if (network === 'devnet') return { kind: 'local' };
  if (!storeSupportsConcurrentInstances(store)) return { kind: 'refused', refusal: 'NOT_SHARED' };
  const start = Math.floor(nowMs / windowMs) * windowMs;
  try {
    // The minute is in the ledger before any of its rows: no row a sweep cannot find.
    await noteRelayMinute(store, network, start);
    const used = await store.versioned<RelayQuotaRecord>(RELAY_COLLECTION).countStep(relayQuotaKey(network, address, start), { by: 1, windowStartMs: start, limit });
    if (used === null) return { kind: 'counted', decision: decisionOf(limit, start, nowMs, false, limit, windowMs) };
    // A count of one opened its row — the only moment the table grows: the moment to sweep the minutes that are over.
    if (used === 1) await sweepNow(store, network, nowMs, windowMs);
    return { kind: 'counted', decision: decisionOf(used, start, nowMs, true, limit, windowMs) };
  } catch {
    return { kind: 'refused', refusal: 'UNAVAILABLE' };
  }
}

/**
 * Takes one call back from a subject's count in the minute of `nowMs` — a call another of its counts refused
 * (`consumeRelayQuotas`). One atomic step, as it was counted: never below zero, never another minute's record. Never
 * throws: a count that cannot be taken back stays — the limit errs toward refusing, never toward letting through.
 */
export async function releaseRelayQuota(
  store: GuardStore,
  input: Readonly<{ network: PrivateNetwork; address: string; nowMs: number; windowMs?: number }>,
): Promise<void> {
  const { network, address, nowMs } = input;
  if (network === 'devnet') return;
  const windowMs = input.windowMs ?? RELAY_LIMIT.windowMs;
  const start = Math.floor(nowMs / windowMs) * windowMs;
  await store
    .versioned<RelayQuotaRecord>(RELAY_COLLECTION)
    .countStep(relayQuotaKey(network, address, start), { by: -1, windowStartMs: start })
    .catch(() => null);
}

/**
 * Count one call against every bucket it is counted against (`relayBuckets`). It passes only when each has room; the
 * tightest one speaks for it. A bucket that cannot be counted refuses the call. A refused call is taken back from every
 * bucket that did count it: the call never reached Helius, so it spends nobody's minute — not the address's,
 * which a whole network behind one address or one /64 shares, when it was the wallet's own minute that was spent. Devnet
 * keeps the instance's own window.
 *
 * Counted first, taken back after, rather than asked first and counted after: each count stays one atomic step that
 * refuses past its ceiling, so no call can slip through between an ask and a count. For the moment between, a count
 * stands one higher than it will be — a neighbour's call at that very edge may be refused once; none is ever let past.
 */
export async function consumeRelayQuotas(
  store: GuardStore,
  input: Readonly<{ network: PrivateNetwork; buckets: readonly RelayBucket[]; nowMs: number; windowMs?: number }>,
): Promise<RelayLimitAnswer> {
  const { network, buckets, nowMs, windowMs } = input;
  if (network === 'devnet') return { kind: 'local' };
  if (buckets.length === 0) return { kind: 'refused', refusal: 'UNAVAILABLE' };
  const answers = await Promise.all(buckets.map((bucket) => consumeRelayQuota(store, { network, address: bucket.subject, nowMs, limit: bucket.limit, windowMs })));
  const counted = buckets.filter((_, i) => {
    const answer = answers[i];
    return answer.kind === 'counted' && answer.decision.allowed;
  });
  const refused = answers.find((answer) => answer.kind !== 'counted');
  const shut = answers.find((answer) => answer.kind === 'counted' && !answer.decision.allowed);
  if (refused || shut) {
    await Promise.all(counted.map((bucket) => releaseRelayQuota(store, { network, address: bucket.subject, nowMs, windowMs })));
    if (refused) return refused.kind === 'local' ? { kind: 'refused', refusal: 'NOT_SHARED' } : refused;
    return shut!;
  }
  const decisions = answers.map((answer) => (answer as Extract<RelayLimitAnswer, { kind: 'counted' }>).decision);
  return { kind: 'counted', decision: decisions.reduce((tightest, next) => (next.remaining < tightest.remaining ? next : tightest)) };
}
