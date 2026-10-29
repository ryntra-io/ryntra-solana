import { z } from "zod";

import type { GuardStore } from "../guard/store.ts";
import { PARTNER_NETWORKS, type PartnerNetwork, type PoolPartner, POOL_PARTNER_COLLECTION, PoolPartnerSchema, poolPartnerKey } from "./partner.ts";
import {
  caseOf,
  type CaseView,
  moneyEffect,
  type MoneyEffect,
  parseSubject,
  poolSubject,
  REVIEW_EVENT_COLLECTION,
  type ReviewDecision,
  type ReviewEvent,
  ReviewEventSchema,
  reviewEventKey,
  unseenSignals,
  walletSubject,
} from "./review.ts";
import { DAY_MS, FUNDING_STATES, type FundingGraph, type FundingNode, PROTECT_RULES, SIGNAL_CODES, SIGNAL_HASH, type SignalCode, type SignalKind } from "./protect.ts";

/**
 * The store side of protection: the review log, the hashed evidence and the
 * facts the rules read — funding nodes, devices, the reviewer's hubs and each
 * launch's activation.
 *
 * Every write is append-only or write-once except the activation's last check
 * (a figure the reviewer reads, never a reason for money) — and nothing here
 * pays, signs or moves money.
 */

export const SIGNAL_EVIDENCE_COLLECTION = "growthSignals" as const;
export const FUNDING_HUB_COLLECTION = "growthFundingHubs" as const;
export const FUNDING_NODE_COLLECTION = "growthFunding" as const;
export const DEVICE_COLLECTION = "growthDevices" as const;
export const ACTIVATION_COLLECTION = "growthActivations" as const;

const MAX_ROUNDS = 5;
const AT = z.string().datetime({ offset: true });
const HASH = z.string().regex(SIGNAL_HASH);

const retentionEnd = (at: string) => new Date(Date.parse(at) + PROTECT_RULES.retentionDays * DAY_MS).toISOString();
const live = (row: { expiresAt: string }, now: string) => Date.parse(row.expiresAt) > Date.parse(now);

/* ------------------------------------------------------------------------------------------------
 * The review log
 * --------------------------------------------------------------------------------------------- */

/** A subject's events, and whether one could not be read — a log with a hole is decided by nobody. */
export async function readSubjectEvents(store: GuardStore, subject: string): Promise<Readonly<{ events: ReviewEvent[]; unreadable: number }>> {
  const rows = await store.collection<unknown>(REVIEW_EVENT_COLLECTION).valuesWithPrefix(`${subject}:`);
  const events: ReviewEvent[] = [];
  let unreadable = 0;
  for (const row of rows) {
    const parsed = ReviewEventSchema.safeParse(row);
    if (parsed.success && parsed.data.subject === subject) events.push(parsed.data);
    else if (!parsed.success) unreadable += 1;
  }
  return { events: events.sort((a, b) => a.seq - b.seq), unreadable };
}

/** Every event of every subject, grouped; unreadable rows are counted per subject they claim, or as a whole. */
export async function readAllEvents(store: GuardStore): Promise<Readonly<{ bySubject: Map<string, ReviewEvent[]>; unreadable: Map<string, number> }>> {
  const rows = await store.collection<unknown>(REVIEW_EVENT_COLLECTION).valuesWithPrefix("");
  const bySubject = new Map<string, ReviewEvent[]>();
  const unreadable = new Map<string, number>();
  for (const row of rows) {
    const parsed = ReviewEventSchema.safeParse(row);
    if (parsed.success) {
      bySubject.set(parsed.data.subject, [...(bySubject.get(parsed.data.subject) ?? []), parsed.data]);
      continue;
    }
    const claimed = row && typeof row === "object" && typeof (row as { subject?: unknown }).subject === "string" ? (row as { subject: string }).subject : "*";
    unreadable.set(claimed, (unreadable.get(claimed) ?? 0) + 1);
  }
  for (const list of bySubject.values()) list.sort((a, b) => a.seq - b.seq);
  return { bySubject, unreadable };
}

/**
 * What the case does to the subject's money. A log with an unreadable event holds the money — it is never read as
 * "no case".
 */
export function effectOf(subject: string, events: readonly ReviewEvent[], unreadable: number, now: string): Readonly<{ view: CaseView; effect: MoneyEffect }> {
  const view = caseOf(subject, events, now);
  if (unreadable > 0) return { view, effect: view.decision?.kind === "CANCEL" ? { kind: "CANCEL" } : { kind: "HOLD" } };
  return { view, effect: moneyEffect(view) };
}

type Draft = Omit<ReviewEvent, "schema" | "subject" | "seq" | "rulesVersion">;

/**
 * Append an event as the next of the subject's log. `decide` sees the case as it stands and returns the event to
 * write, or null for nothing — re-read and asked again if another writer took the number meanwhile.
 */
async function appendEvent(
  store: GuardStore,
  subject: string,
  now: string,
  decide: (view: CaseView, events: readonly ReviewEvent[]) => Draft | null,
): Promise<Readonly<{ written: ReviewEvent | null; view: CaseView }> | null> {
  const collection = store.collection<ReviewEvent>(REVIEW_EVENT_COLLECTION);
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const read = await readSubjectEvents(store, subject);
    if (read.unreadable) return null;
    const view = caseOf(subject, read.events, now);
    const draft = decide(view, read.events);
    if (!draft) return { written: null, view };
    const seq = read.events.length ? read.events[read.events.length - 1]!.seq + 1 : 0;
    const event = ReviewEventSchema.parse({ schema: 1, subject, seq, rulesVersion: PROTECT_RULES.version, ...draft });
    if (await collection.insertIfAbsent(reviewEventKey(subject, seq), event)) return { written: event, view: caseOf(subject, [...read.events, event], now) };
  }
  return null;
}

/** The rules found signals on a subject: open its case, or add the codes it does not hold. A repeat writes nothing. */
export async function raiseSignals(store: GuardStore, args: Readonly<{ subject: string; codes: readonly SignalCode[]; renewed?: readonly SignalCode[]; now: string }>) {
  return appendEvent(store, args.subject, args.now, (view) => {
    const fresh = unseenSignals(view, args.codes, args.renewed ?? []);
    if (!fresh.length) return null;
    return { kind: view.events.some((event) => event.kind === "OPENED") ? "SIGNALS" : "OPENED", at: args.now, by: "system", signals: fresh };
  });
}

export type ReviewAction =
  /** `seen` — the last event of the case the reviewer saw: a case that moved on since is not decided blind. */
  | Readonly<{ kind: "DECIDE"; decision: ReviewDecision; ceilingUsdMicros?: string; note: string; seen: number }>
  | Readonly<{ kind: "FREEZE"; note: string }>
  | Readonly<{ kind: "UNFREEZE"; note: string }>
  | Readonly<{ kind: "APPEAL"; note: string }>;

export type ReviewActionOutcome =
  | Readonly<{ ok: true; event: ReviewEvent; view: CaseView }>
  | Readonly<{ ok: false; code: "INVALID" | "NO_CASE" | "NOT_OPEN" | "NOT_FROZEN" | "ALREADY_FROZEN" | "STALE" | "ALREADY_APPEALED" | "UNAVAILABLE" }>;

/**
 * A person's step on a case: the reviewer decides, freezes or lifts a freeze; the subject appeals. `by` is who —
 * the admin identity, or `person` for an appeal. Every step says why. Only an open case is decided; an appeal reopens
 * a decided case and starts a new due time.
 */
export async function actOnCase(store: GuardStore, args: Readonly<{ subject: string; action: ReviewAction; by: string; now: string }>): Promise<ReviewActionOutcome> {
  const { action } = args;
  const note = action.note?.trim().slice(0, 1000) ?? "";
  if (!parseSubject(args.subject) || !note || !args.by.trim()) return { ok: false, code: "INVALID" };
  if (action.kind === "DECIDE" && action.decision === "ADJUST" && !/^(?:0|[1-9][0-9]*)$/.test(action.ceilingUsdMicros ?? "")) return { ok: false, code: "INVALID" };
  /* An amount is a pool's: a wallet's case is cleared, cancelled or frozen, never adjusted. */
  if (action.kind === "DECIDE" && action.decision === "ADJUST" && parseSubject(args.subject)?.kind !== "pool") return { ok: false, code: "INVALID" };
  let refusal: Exclude<ReviewActionOutcome, { ok: true }>["code"] | null = null;
  const result = await appendEvent(store, args.subject, args.now, (view) => {
    refusal = null;
    const by = args.by.trim().slice(0, 120);
    switch (action.kind) {
      case "DECIDE":
        /* An open case is decided — and so is a freeze: the reviewer may stop or lower what a freeze holds without
           waiting for the person to appeal. */
        if (view.state !== "OPEN" && !view.frozen) {
          refusal = view.events.length ? "NOT_OPEN" : "NO_CASE";
          return null;
        }
        /* Signals the run added after the reviewer opened the case are not decided by a click that never saw them. */
        if ((view.events[view.events.length - 1]?.seq ?? -1) !== action.seen) {
          refusal = "STALE";
          return null;
        }
        return { kind: "DECIDED", at: args.now, by, decision: action.decision, ...(action.decision === "ADJUST" ? { ceilingUsdMicros: action.ceilingUsdMicros! } : {}), note };
      case "FREEZE":
        if (view.frozen) {
          refusal = "ALREADY_FROZEN";
          return null;
        }
        return { kind: "FROZEN", at: args.now, by, note };
      case "UNFREEZE":
        if (!view.frozen) {
          refusal = "NOT_FROZEN";
          return null;
        }
        return { kind: "UNFROZEN", at: args.now, by, note };
      case "APPEAL":
        /* A wallet with nothing held has nothing to appeal: no case is opened for it (a cheap wallet must not fill the queue). */
        if (parseSubject(args.subject)?.kind === "wallet" && view.state === "NONE" && !view.frozen) {
          refusal = "NO_CASE";
          return null;
        }
        /* An appeal is heard on anything that holds or took money — and opens a case of its own where there is none (a
           pool held for a reason found at the launch, or not yet counted): the reviewer reads it. A cleared case has
           nothing to appeal. */
        if (view.state === "DECIDED" && view.decision?.kind === "CLEAR" && !view.frozen) {
          refusal = "NOT_OPEN";
          return null;
        }
        /* One appeal until it is answered: the words are kept once, the due time is not pushed on by repeating them. */
        if (view.appealed) {
          refusal = "ALREADY_APPEALED";
          return null;
        }
        return { kind: "APPEALED", at: args.now, by: "person", note };
    }
  });
  if (!result) return { ok: false, code: "UNAVAILABLE" };
  if (!result.written) return { ok: false, code: refusal ?? "INVALID" };
  return { ok: true, event: result.written, view: result.view };
}

/** What holds a wallet's payouts: nothing, a review (a freeze, an open case, a log with a hole), or a decision that stopped them. */
export async function walletHold(store: GuardStore, wallet: string, now: string): Promise<"NONE" | "REVIEW" | "STOPPED"> {
  const subject = walletSubject(wallet);
  const read = await readSubjectEvents(store, subject);
  const { view, effect } = effectOf(subject, read.events, read.unreadable, now);
  if (effect.kind === "PAY") return "NONE";
  return effect.kind === "CANCEL" && view.state === "DECIDED" && !view.frozen ? "STOPPED" : "REVIEW";
}

/** Is a wallet frozen (or its log unreadable)? For the payout of every reward of that wallet. */
export async function walletHeld(store: GuardStore, wallet: string, now: string): Promise<boolean> {
  const subject = walletSubject(wallet);
  const read = await readSubjectEvents(store, subject);
  /* A freeze, an open case or a cancellation on the wallet holds its payout; a log with a hole holds it too. */
  return effectOf(subject, read.events, read.unreadable, now).effect.kind !== "PAY";
}

/**
 * What protection does to one pool's money, from the review log of the pool and of its partner's wallet and from
 * the launch's activation:
 * - `effect` — the most restrictive of the two logs: `CANCEL` (nothing paid, what was earned goes back), `HOLD`
 *   (a case open or a freeze: earned, never available), `CEILING` (paid up to the reviewer's amount), `PAY`;
 * - `activated` — the creator counts: until then nothing becomes available and no point is counted;
 * - `payableFrom` — the latest moment the pool's money was let go (its activation, a decision, a freeze lifted):
 *   no rank point counts before it.
 * A wallet's case cannot adjust: an amount is a pool's, so a wallet's `ADJUST` holds.
 */
export type PoolProtection = Readonly<{
  effect: MoneyEffect;
  activated: boolean;
  payable: boolean;
  payableFrom: string | null;
  pool: CaseView;
  wallet: CaseView;
}>;

const RESTRICTION: Readonly<Record<MoneyEffect["kind"], number>> = { CANCEL: 3, HOLD: 2, CEILING: 1, PAY: 0 };

export function protectionOf(
  binding: PoolPartner,
  logs: Readonly<{ pool: Readonly<{ events: readonly ReviewEvent[]; unreadable: number }>; wallet: Readonly<{ events: readonly ReviewEvent[]; unreadable: number }> }>,
  activation: ActivationRecord | null,
  now: string,
): PoolProtection {
  const pool = effectOf(poolSubject(binding.network, binding.pool), logs.pool.events, logs.pool.unreadable, now);
  const wallet = effectOf(walletSubject(binding.partner!), logs.wallet.events, logs.wallet.unreadable, now);
  const walletEffect: MoneyEffect = wallet.effect.kind === "CEILING" ? { kind: "HOLD" } : wallet.effect;
  const effect = RESTRICTION[walletEffect.kind] > RESTRICTION[pool.effect.kind] ? walletEffect : pool.effect;
  const activated = Boolean(activation?.activatedAt && activation.recordedAt);
  const released = [...logs.pool.events, ...logs.wallet.events].filter((event) => event.kind === "DECIDED" || event.kind === "UNFROZEN").map((event) => event.at);
  const moments = [...(activation?.recordedAt ? [activation.recordedAt] : []), ...released].sort();
  return {
    effect,
    activated,
    payable: activated && (effect.kind === "PAY" || effect.kind === "CEILING"),
    payableFrom: moments.length ? moments[moments.length - 1]! : null,
    pool: pool.view,
    wallet: wallet.view,
  };
}

/** One pool's protection from the store; null when a log or the activation cannot be read — nothing is decided then. */
export async function readProtection(store: GuardStore, binding: PoolPartner, now: string): Promise<PoolProtection | null> {
  try {
    const [pool, wallet, activation] = await Promise.all([
      readSubjectEvents(store, poolSubject(binding.network, binding.pool)),
      readSubjectEvents(store, walletSubject(binding.partner!)),
      readActivation(store, binding.network, binding.pool),
    ]);
    return protectionOf(binding, { pool, wallet }, activation, now);
  } catch {
    return null;
  }
}

/**
 * The partner's pools whose money a review holds or took back now — a case open, a freeze, a cancellation, or a
 * log that cannot be read. Their rank points do not count meanwhile (`listCountedRankEvents`): a base written before
 * the case never lifts the rank — and with it a friend's share — while the case looks at it.
 */
export async function heldPartnerPools(
  store: GuardStore,
  partner: string,
  now: string,
  /** Only these pools, read by key — a wallet's own read names the pools its points came from, never every binding. */
  only?: readonly Readonly<{ network: string; pool: string }>[],
): Promise<Set<string>> {
  const bindings = store.collection<unknown>(POOL_PARTNER_COLLECTION);
  const rows = only
    ? (await Promise.all([...new Set(only.flatMap((item) => (PARTNER_NETWORKS.includes(item.network as PartnerNetwork) ? [poolPartnerKey(item.network as PartnerNetwork, item.pool)] : [])))].map((key) => bindings.get(key)))).filter((row) => row !== undefined)
    : await bindings.valuesWithPrefix("pool:");
  const out = new Set<string>();
  const wallet = await readSubjectEvents(store, walletSubject(partner));
  for (const row of rows) {
    const parsed = PoolPartnerSchema.safeParse(row);
    if (!parsed.success || parsed.data.partner !== partner) continue;
    const binding = parsed.data;
    const pool = await readSubjectEvents(store, poolSubject(binding.network, binding.pool));
    const { effect } = protectionOf(binding, { pool, wallet }, null, now);
    if (effect.kind === "HOLD" || effect.kind === "CANCEL") out.add(`${binding.network}:${binding.pool}:`);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Hashed evidence — kept for the retention period
 * --------------------------------------------------------------------------------------------- */

/** `afterSeq` — the last event of the case's log when the hash was first kept: the order evidence and raises are compared by. */
const EvidenceSchema = z.object({ subject: z.string(), code: z.enum(SIGNAL_CODES), hash: HASH, afterSeq: z.number().int().min(-1), at: AT, expiresAt: AT }).strict();
export type SignalEvidence = z.output<typeof EvidenceSchema>;

/**
 * Keep a signal's evidence: a hash seen again has its retention renewed from now (evidence lives as long as it keeps
 * appearing, and 90 days after); a hash not held — new, or gone for the whole period — is returned: new evidence.
 */
export async function recordEvidence(store: GuardStore, args: Readonly<{ subject: string; code: SignalCode; hashes: readonly string[]; afterSeq: number; now: string }>): Promise<string[]> {
  const collection = store.collection<SignalEvidence>(SIGNAL_EVIDENCE_COLLECTION);
  const fresh: string[] = [];
  for (const hash of new Set(args.hashes)) {
    if (!SIGNAL_HASH.test(hash)) continue;
    const key = `${args.subject}:${args.code}:${hash}`;
    const held = EvidenceSchema.safeParse(await collection.get(key));
    const live = held.success && Date.parse(held.data.expiresAt) > Date.parse(args.now);
    await collection.set(key, { subject: args.subject, code: args.code, hash, afterSeq: live ? held.data.afterSeq : args.afterSeq, at: live ? held.data.at : args.now, expiresAt: retentionEnd(args.now) });
    if (!live) fresh.push(hash);
  }
  return fresh;
}

export async function readEvidence(store: GuardStore, subject: string, now: string): Promise<SignalEvidence[]> {
  const rows = await store.collection<unknown>(SIGNAL_EVIDENCE_COLLECTION).valuesWithPrefix(`${subject}:`);
  return rows.map((row) => EvidenceSchema.safeParse(row)).flatMap((parsed) => (parsed.success && live(parsed.data, now) ? [parsed.data] : []));
}

/**
 * The retention period kept, not just read past: hashed evidence, funding facts and device sightings older than
 * `PROTECT_RULES.retentionDays` are removed. The review log stays — it holds codes and reasons, never a hash.
 */
export async function purgeExpired(store: GuardStore, now: string): Promise<Readonly<{ removed: number }>> {
  let removed = 0;
  for (const name of [SIGNAL_EVIDENCE_COLLECTION, FUNDING_NODE_COLLECTION] as const) {
    const collection = store.collection<{ expiresAt?: unknown }>(name);
    for (const key of await keysOf(store, name)) {
      const row = await collection.get(key);
      if (row && typeof row.expiresAt === "string" && Date.parse(row.expiresAt) <= Date.parse(now)) {
        await collection.delete(key);
        removed += 1;
      }
    }
  }
  const devices = store.collection<{ expiresAt?: unknown }>(DEVICE_COLLECTION);
  for (const key of await keysOf(store, DEVICE_COLLECTION)) {
    const row = await devices.get(key);
    if (row && typeof row.expiresAt === "string" && Date.parse(row.expiresAt) <= Date.parse(now)) {
      await devices.delete(key);
      removed += 1;
    }
  }
  /* An activation keeps its moment for good; the hashes of its last read leave with the retention period. */
  const activations = store.versioned<ActivationRecord>(ACTIVATION_COLLECTION);
  for (const row of await store.collection<unknown>(ACTIVATION_COLLECTION).valuesWithPrefix("pool:")) {
    const parsed = ActivationRecordSchema.safeParse(row);
    if (!parsed.success || !parsed.data.last.sharedSources.length) continue;
    if (Date.parse(parsed.data.last.at) + PROTECT_RULES.retentionDays * DAY_MS > Date.parse(now)) continue;
    const next = { ...parsed.data, version: parsed.data.version + 1, last: { ...parsed.data.last, sharedSources: [] } };
    if (await activations.compareAndSet(activationKey(parsed.data.network, parsed.data.pool), parsed.data.version, next)) removed += 1;
  }
  return { removed };
}

/** The keys of a collection, from its rows: evidence, funding and device rows each name what their key is made of. */
async function keysOf(store: GuardStore, name: typeof SIGNAL_EVIDENCE_COLLECTION | typeof FUNDING_NODE_COLLECTION | typeof DEVICE_COLLECTION): Promise<string[]> {
  const rows = await store.collection<Record<string, unknown>>(name).valuesWithPrefix("");
  const keys: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (name === SIGNAL_EVIDENCE_COLLECTION) keys.push(`${row.subject}:${row.code}:${row.hash}`);
    else if (name === FUNDING_NODE_COLLECTION) keys.push(String(row.hash));
    else keys.push(`d:${row.kind}:${row.hash}:${row.wallet}`, `w:${row.wallet}:${row.kind}:${row.hash}`);
  }
  return [...new Set(keys)];
}

/* ------------------------------------------------------------------------------------------------
 * Hubs — sources the reviewer marked as an exchange, a bridge or a programme
 * --------------------------------------------------------------------------------------------- */

/** The reviewer's word on a source, as a log: marked a hub, or the mark lifted — each with who, when and why. */
const HubEventSchema = z
  .object({ hash: HASH, seq: z.number().int().nonnegative(), kind: z.enum(["MARKED", "UNMARKED", "VIEWED"]), note: z.string().min(1).max(200), by: z.string().min(1).max(120), at: AT })
  .strict();
type HubEvent = z.output<typeof HubEventSchema>;

async function hubEvents(store: GuardStore, hash?: string): Promise<HubEvent[]> {
  const rows = await store.collection<unknown>(FUNDING_HUB_COLLECTION).valuesWithPrefix(hash ? `${hash}:` : "");
  return rows.map((row) => HubEventSchema.safeParse(row)).flatMap((parsed) => (parsed.success ? [parsed.data] : [])).sort((a, b) => a.seq - b.seq);
}

/** Mark a source a hub (`marked` true) or lift the mark. A step that changes nothing writes nothing. */
export async function markHub(store: GuardStore, args: Readonly<{ hash: string; note: string; by: string; now: string; marked?: boolean }>): Promise<Readonly<{ ok: boolean; created: boolean }>> {
  const kind = args.marked === false ? "UNMARKED" : "MARKED";
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const events = await hubEvents(store, args.hash);
    const last = events[events.length - 1];
    const state = [...events].reverse().find((event) => event.kind !== "VIEWED")?.kind ?? "UNMARKED";
    if (state === kind) return { ok: true, created: false };
    const parsed = HubEventSchema.safeParse({ hash: args.hash, seq: (last?.seq ?? -1) + 1, kind, note: args.note.trim().slice(0, 200), by: args.by.trim().slice(0, 120), at: args.now });
    if (!parsed.success) return { ok: false, created: false };
    if (await store.collection<HubEvent>(FUNDING_HUB_COLLECTION).insertIfAbsent(`${args.hash}:${String(parsed.data.seq).padStart(6, "0")}`, parsed.data)) return { ok: true, created: true };
  }
  return { ok: false, created: false };
}

/** The reviewer looked at the address behind a source: who and when, in the same log. */
export async function noteHubViewed(store: GuardStore, args: Readonly<{ hash: string; by: string; now: string }>): Promise<void> {
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const events = await hubEvents(store, args.hash);
    const seq = (events[events.length - 1]?.seq ?? -1) + 1;
    const parsed = HubEventSchema.safeParse({ hash: args.hash, seq, kind: "VIEWED", note: "address shown", by: args.by.trim().slice(0, 120) || "admin", at: args.now });
    if (!parsed.success) return;
    if (await store.collection<HubEvent>(FUNDING_HUB_COLLECTION).insertIfAbsent(`${args.hash}:${String(seq).padStart(6, "0")}`, parsed.data)) return;
  }
}

/** The sources marked a hub now. A row that cannot be read marks nothing: an unread mark joins wallets, never frees them. */
export async function readHubs(store: GuardStore): Promise<Set<string>> {
  const latest = new Map<string, HubEvent>();
  for (const event of await hubEvents(store)) if (event.kind !== "VIEWED") latest.set(event.hash, event);
  return new Set([...latest.values()].filter((event) => event.kind === "MARKED").map((event) => event.hash));
}

/** Every mark and lift, for the reviewer's record. */
export type { HubEvent };
export async function readHubLog(store: GuardStore): Promise<HubEvent[]> {
  return hubEvents(store);
}

/* ------------------------------------------------------------------------------------------------
 * Funding nodes — a cache of what the chain said, by hash, for the retention period
 * --------------------------------------------------------------------------------------------- */

const NodeSchema = z
  .object({ hash: HASH, state: z.enum(FUNDING_STATES), funder: HASH.nullable(), firstAt: AT.nullable(), lastAt: AT.nullable(), readAt: AT, expiresAt: AT })
  .strict();
type StoredNode = z.output<typeof NodeSchema>;

export async function readFundingNodes(store: GuardStore, hashes: readonly string[], now: string): Promise<Map<string, FundingNode>> {
  const collection = store.collection<unknown>(FUNDING_NODE_COLLECTION);
  const out = new Map<string, FundingNode>();
  for (const hash of new Set(hashes)) {
    const parsed = NodeSchema.safeParse(await collection.get(hash));
    if (parsed.success && live(parsed.data, now) && parsed.data.state !== "UNAVAILABLE") out.set(hash, { state: parsed.data.state, funder: parsed.data.funder, firstAt: parsed.data.firstAt, lastAt: parsed.data.lastAt });
  }
  return out;
}

/** Keep what a read found — a failed read is never kept, so the next run reads again. */
export async function writeFundingNode(store: GuardStore, hash: string, node: FundingNode, now: string): Promise<void> {
  /* A failed read and a history not yet read are never kept: the next run reads again. */
  if (node.state === "UNAVAILABLE" || node.state === "EMPTY") return;
  const row: StoredNode = { hash, ...node, readAt: now, expiresAt: retentionEnd(now) };
  if (!NodeSchema.safeParse(row).success) return;
  await store.collection<StoredNode>(FUNDING_NODE_COLLECTION).set(hash, row);
}

export function mergeGraph(...graphs: readonly FundingGraph[]): Map<string, FundingNode> {
  const out = new Map<string, FundingNode>();
  for (const graph of graphs) for (const [hash, node] of graph) out.set(hash, node);
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Devices — S4, hashes of a device and of an IP /24 seen with a proven wallet
 * --------------------------------------------------------------------------------------------- */

const DeviceSchema = z.object({ wallet: z.string().min(32).max(44), kind: z.enum(["ip24", "device"]), hash: HASH, at: AT, expiresAt: AT }).strict();
type DeviceRow = z.output<typeof DeviceSchema>;

/** A proven wallet was seen with these hashes. Seen again, the sighting's retention starts anew. */
export async function recordDevice(store: GuardStore, args: Readonly<{ wallet: string; signals: readonly Readonly<{ kind: Extract<SignalKind, "ip24" | "device">; hash: string }>[]; now: string }>): Promise<void> {
  const collection = store.collection<DeviceRow>(DEVICE_COLLECTION);
  for (const signal of args.signals) {
    /* Kept from the last sighting: each sighting renews the retention period. */
    const row: DeviceRow = { wallet: args.wallet, kind: signal.kind, hash: signal.hash, at: args.now, expiresAt: retentionEnd(args.now) };
    if (!DeviceSchema.safeParse(row).success) continue;
    await collection.set(`d:${signal.kind}:${signal.hash}:${args.wallet}`, row);
    await collection.set(`w:${args.wallet}:${signal.kind}:${signal.hash}`, row);
  }
}

/** The hashes seen with a wallet, and how many wallets each was seen with — live rows only. */
export async function readDevices(store: GuardStore, wallet: string, now: string): Promise<Readonly<{ hashes: string[]; crowd: number; crowds: Readonly<{ hash: string; wallets: number; members: readonly string[] }>[] }>> {
  const collection = store.collection<unknown>(DEVICE_COLLECTION);
  const own = (await collection.valuesWithPrefix(`w:${wallet}:`)).map((row) => DeviceSchema.safeParse(row)).flatMap((parsed) => (parsed.success && live(parsed.data, now) ? [parsed.data] : []));
  const hashes = [...new Set(own.map((row) => `${row.kind}:${row.hash}`))];
  let crowd = 0;
  const crowds: Array<{ hash: string; wallets: number; members: string[] }> = [];
  for (const kindHash of hashes) {
    const [kind, hash] = [kindHash.slice(0, kindHash.indexOf(":")), kindHash.slice(kindHash.indexOf(":") + 1)];
    /* The crowd is a device's alone: a shared IP /24 (a carrier, an office) carries many people by nature. */
    if (kind !== "device") continue;
    const rows = (await collection.valuesWithPrefix(`d:${kind}:${hash}:`)).map((row) => DeviceSchema.safeParse(row)).flatMap((parsed) => (parsed.success && live(parsed.data, now) ? [parsed.data] : []));
    const members = [...new Set(rows.map((row) => row.wallet))].sort();
    crowd = Math.max(crowd, members.length);
    crowds.push({ hash, wallets: members.length, members });
  }
  return { hashes: hashes.map((kindHash) => kindHash.slice(kindHash.indexOf(":") + 1)), crowd, crowds };
}

/* ------------------------------------------------------------------------------------------------
 * Activations — the moment a launch's creator became activated, written once
 * --------------------------------------------------------------------------------------------- */

export const ActivationRecordSchema = z
  .object({
    version: z.number().int().positive(),
    network: z.enum(["solana", "arc"]),
    pool: z.string().min(32).max(66),
    creator: z.string().min(32).max(64),
    /** The trade that made the third independent address; null — not yet. Once set, never changed. */
    activatedAt: AT.nullable(),
    /** When a run first found it activated — the moment the partner's money may follow. */
    recordedAt: AT.nullable(),
    /* Any version of the rules: a newer build's record is still read, never turned into "not activated". */
    rulesVersion: z.string().regex(/^protect-[0-9]+\.[0-9]+\.[0-9]+$/),
    /** The latest run's figures — for the reviewer only. */
    last: z
      .object({
        at: AT,
        independent: z.number().int().nonnegative(),
        external: z.number().int().nonnegative(),
        unknown: z.number().int().nonnegative(),
        volumeUsdMicros: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
        teamVolumeUsdMicros: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
        insiderVolumeUsdMicros: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
        roundTripVolumeUsdMicros: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
        unvaluedTrades: z.number().int().nonnegative(),
        tradesComplete: z.boolean(),
        /** The two parties' funding and transfers were read whole — without it no activation is written. */
        partiesComplete: z.boolean(),
        /** Sources several active external addresses share, by hash — for the reviewer to judge (an exchange?). */
        sharedSources: z.array(z.object({ hash: HASH, wallets: z.number().int().positive() }).strict()).max(5),
      })
      .strict(),
  })
  .strict()
  .refine((row) => (row.activatedAt === null) === (row.recordedAt === null), "activated and recorded come together");
export type ActivationRecord = z.output<typeof ActivationRecordSchema>;

export function activationKey(network: string, pool: string): string {
  return `pool:${network}:${pool}`;
}

/** The record of one launch; a row that cannot be read throws — never read as "not activated" and rewritten. */
export async function readActivation(store: GuardStore, network: string, pool: string): Promise<ActivationRecord | null> {
  const raw = await store.versioned<ActivationRecord>(ACTIVATION_COLLECTION).get(activationKey(network, pool));
  if (raw === undefined || raw === null) return null;
  return ActivationRecordSchema.parse(raw);
}

/** Every record, by key; unreadable ones by key too, so a read can hold their pools. */
export async function readActivations(store: GuardStore): Promise<Readonly<{ records: Map<string, ActivationRecord>; unreadable: number }>> {
  const rows = await store.collection<unknown>(ACTIVATION_COLLECTION).valuesWithPrefix("pool:");
  const records = new Map<string, ActivationRecord>();
  let unreadable = 0;
  for (const row of rows) {
    const parsed = ActivationRecordSchema.safeParse(row);
    if (parsed.success) records.set(activationKey(parsed.data.network, parsed.data.pool), parsed.data);
    else unreadable += 1;
  }
  return { records, unreadable };
}

/** A check that failed is still a check tried: its moment moves the pool to the back of the next run's order. */
export async function touchActivation(store: GuardStore, args: Readonly<{ network: "solana" | "arc"; pool: string; creator: string; now: string }>): Promise<void> {
  const current = await readActivation(store, args.network, args.pool);
  const last: ActivationRecord["last"] = current?.last ?? {
    at: args.now, independent: 0, external: 0, unknown: 0, volumeUsdMicros: "0", teamVolumeUsdMicros: "0", insiderVolumeUsdMicros: "0",
    roundTripVolumeUsdMicros: "0", unvaluedTrades: 0, tradesComplete: false, partiesComplete: false, sharedSources: [],
  };
  await writeActivation(store, { network: args.network, pool: args.pool, creator: args.creator, activatedAt: null, last: { ...last, at: args.now }, now: args.now });
}

/** Write a run's figures; the activation moment only once — a later run never moves or clears it. */
export async function writeActivation(
  store: GuardStore,
  args: Readonly<{ network: "solana" | "arc"; pool: string; creator: string; activatedAt: string | null; last: ActivationRecord["last"]; now: string }>,
): Promise<ActivationRecord | null> {
  const collection = store.versioned<ActivationRecord>(ACTIVATION_COLLECTION);
  const key = activationKey(args.network, args.pool);
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const current = await readActivation(store, args.network, args.pool);
    const activatedAt = current?.activatedAt ?? args.activatedAt;
    const next: ActivationRecord = ActivationRecordSchema.parse({
      version: (current?.version ?? 0) + 1,
      network: args.network,
      pool: args.pool,
      creator: args.creator,
      activatedAt,
      recordedAt: current?.recordedAt ?? (activatedAt ? args.now : null),
      rulesVersion: PROTECT_RULES.version,
      last: args.last,
    });
    if (await collection.compareAndSet(key, current?.version ?? null, next)) return next;
  }
  return null;
}
