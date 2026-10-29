/**
 * The action ledger's records (EXE-2; spec §3.2–§3.3, §14.1–§14.2, §17.3 PR-2).
 *
 * One action — a trade, a team's spend, an agent's act under a mandate, a payment — is one `actionId` and one
 * canonical record. Every surface reads that record and none keeps its own: a trader sees a deal, a team a spend from
 * its budget, Agent Control an act under a mandate, the SDK an Outcome Receipt — all name the same `actionId`, the same
 * `actionDigest`, `policyVersion`, signer, signatures, effects and reconciliation.
 *
 * ## Where it lives (the logical model of spec §14.1, mapped to the schema that exists)
 *
 * The durable store is the one table every money path already writes, `guard_objects` (collection, key, JSON value),
 * through the Guard store port (`lib/guard/store.ts`). No table of §14.1 is duplicated:
 *
 * | spec §14.1            | here                                                                    |
 * | --------------------- | ----------------------------------------------------------------------- |
 * | `action_intents`      | `actionIntents` — the head, one per `actionId`, version-checked          |
 * | `action_events`       | `actionEvents` — `<actionId>:<seq>`, inserted once, never rewritten      |
 * | idempotency           | `actionIdempotency` — `<scope>:<key>` → the `actionId`, inserted once    |
 * | `market_budgets` etc. | `actionBudgets` — a budget in one mint's base units, version-checked     |
 * | `budget_reservations` | `actionReservations` — one per action, version-checked                   |
 * | `transaction_attempts`| `actionTransactions` — `<cluster>:<signature>` → the `actionId`, once    |
 * | `receipts`            | not copied: the receipt stays where its lane keeps it; the head and the  |
 * |                       | event hold its id, content hash and the verdict                          |
 *
 * Every write of one step — the head's new version, its event, the budget and the reservation — is one
 * `compareAndSetMany`: a single database transaction on Postgres, so a step lands whole or not at all. The migration
 * `supabase/prepared/20261025_exe_2_action_ledger_v1.sql` (the operator applies it) adds what the code alone cannot
 * promise: the database refuses an UPDATE or DELETE of an event, an idempotency claim or a signature claim, and a
 * budget whose reserved and spent exceed its limit.
 *
 * ## Money
 *
 * Every amount is an integer of the mint's base units, a decimal string — never a float. SOL is named by its wrapped
 * mint (`So111…112`, 9 decimals), so one rule covers every asset. Arithmetic is `BigInt`.
 *
 * Nothing here moves money. The ledger records, reserves and checks; signing and sending stay with the person's wallet
 * (and, for a bounded signer, with EXE-3 after the operator's D3).
 */

import { randomBytes } from "node:crypto";

import { z } from "zod";

import { hashCanonical } from "../../guard/canonical.ts";

/* ------------------------------------------------------------------ names */

export const ACTION_COLLECTIONS = {
  intents: "actionIntents",
  events: "actionEvents",
  idempotency: "actionIdempotency",
  budgets: "actionBudgets",
  reservations: "actionReservations",
  transactions: "actionTransactions",
} as const;

/** The collections whose rows are written once and never changed (the migration's trigger names the same). */
export const APPEND_ONLY_ACTION_COLLECTIONS = [
  ACTION_COLLECTIONS.events,
  ACTION_COLLECTIONS.idempotency,
  ACTION_COLLECTIONS.transactions,
] as const;

export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

export const ACTION_CLUSTERS = ["mainnet", "devnet"] as const;
export type ActionCluster = (typeof ACTION_CLUSTERS)[number];

export const ACTION_CHAIN_IDS: Readonly<Record<ActionCluster, string>> = Object.freeze({
  mainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
});

export const ACTOR_KINDS = ["PERSON", "TEAM_MEMBER", "AGENT", "BOT", "RYNTRA"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/** `OPENED` — made through this ledger before anything was signed; `ADOPTED` — an action a lane recorded first. */
export const ACTION_ORIGINS = ["OPENED", "ADOPTED"] as const;

export const ACTION_STATUSES = [
  "OPENED",
  "RESERVED",
  "HANDED_OFF",
  "SUBMITTED",
  "OBSERVED",
  "RECONCILED",
  "REFUSED",
  "RELEASED",
  "FAILED",
  "RECOVERY",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/** No step leaves these. A retry is a new action with a new idempotency key. */
export const TERMINAL_ACTION_STATUSES: readonly ActionStatus[] = ["RECONCILED", "REFUSED", "RELEASED", "FAILED"];

export const ACTION_EVENT_TYPES = [
  "OPENED",
  "ADOPTED",
  "BUDGET_RESERVED",
  "BUDGET_REFUSED",
  "HANDOFF_ISSUED",
  "SUBMITTED",
  "OBSERVED",
  "FAILED",
  "CANCELLED",
  "RECOVERY_REQUIRED",
  "OVERSPEND_DETECTED",
  "RECEIPT_VERIFIED",
  "RECEIPT_REFUSED",
  "SIGNATURE_SEEN",
] as const;
export type ActionEventType = (typeof ACTION_EVENT_TYPES)[number];

/* --------------------------------------------------------------- patterns */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const HEX_DIGEST = /^0x[0-9a-f]{64}$/;
const RAW = /^(0|[1-9][0-9]*)$/;
const SIGNED_RAW = /^(0|-?[1-9][0-9]*)$/;
const ACTION_ID = /^act_[0-9a-f]{32}$/;
const AUTHORITY_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
/** Printable, bounded, and no `:` — the key's separator — so one scope's key can never read as another's. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._~+/=@-]{8,128}$/;
const timestamp = z.string().datetime({ offset: true });

export const ActionIdSchema = z.string().regex(ACTION_ID);
export const SignatureSchema = z.string().regex(SIGNATURE);
export const IdempotencyKeySchema = z.string().regex(IDEMPOTENCY_KEY);

/* ---------------------------------------------------------------- amounts */

/** An amount of one mint, in its base units. */
export const AmountSchema = z
  .object({
    mint: z.string().regex(BASE58),
    decimals: z.number().int().min(0).max(18),
    amountRaw: z.string().regex(RAW).max(40),
  })
  .strict();
export type Amount = z.output<typeof AmountSchema>;

/** A balance change the chain shows for one owner and one mint: negative left the owner. */
export const ObservedDeltaSchema = z
  .object({
    owner: z.string().regex(BASE58),
    mint: z.string().regex(BASE58),
    decimals: z.number().int().min(0).max(18),
    deltaRaw: z.string().regex(SIGNED_RAW).max(41),
  })
  .strict();
export type ObservedDelta = z.output<typeof ObservedDeltaSchema>;

export const FeeLineSchema = z
  .object({
    kind: z.enum(["NETWORK", "PRIORITY", "RYNTRA", "VENUE", "RENT"]),
    mint: z.string().regex(BASE58),
    amountRaw: z.string().regex(RAW).max(40),
    /** Who paid it, as the transaction read shows — the fee payer for NETWORK and PRIORITY; null when not read. */
    payer: z.string().regex(BASE58).nullable().default(null),
  })
  .strict();
export type FeeLine = z.output<typeof FeeLineSchema>;

export function raw(value: string): bigint {
  if (!SIGNED_RAW.test(value)) throw new TypeError(`Not an integer of base units: ${value}`);
  return BigInt(value);
}

export function rawString(value: bigint): string {
  return value.toString(10);
}

/* ---------------------------------------------------------------- records */

export const ActorSchema = z
  .object({
    kind: z.enum(ACTOR_KINDS),
    /** A wallet for a person, a team member and Ryntra; the registry id for an agent or a bot. */
    id: z.string().min(3).max(128),
  })
  .strict();
export type Actor = z.output<typeof ActorSchema>;

export const ReceiptRefSchema = z
  .object({
    receiptId: z.string().min(3).max(128),
    contentHash: z.string().regex(HEX_DIGEST),
    transactionHash: z.string().min(3).max(256),
  })
  .strict();
export type ReceiptRef = z.output<typeof ReceiptRefSchema>;

/** Where else this action is drawn: the lanes' own records, which this ledger reads and never rewrites. */
export const ProjectionRefSchema = z
  .object({
    kind: z.enum(["HISTORY_ROW", "PAY_REQUEST", "LAUNCH_TRADE"]),
    key: z.string().min(3).max(256),
  })
  .strict();
export type ProjectionRef = z.output<typeof ProjectionRefSchema>;

/** The signer handoff as the ledger keeps it (`handoff.ts` explains it): every one issued, sealed, in the head. */
export const SignerHandoffSchema = z
  .object({
    schema: z.literal("ryntra.action.signer-handoff"),
    schemaVersion: z.literal("1.0.0"),
    handoffId: z.string().min(8).max(160),
    actionId: ActionIdSchema,
    actionDigest: z.string().regex(HEX_DIGEST),
    cluster: z.enum(ACTION_CLUSTERS),
    chainId: z.string().min(3).max(64),
    signer: z.object({ kind: z.enum(["PERSON_WALLET", "BOUNDED_SIGNER"]), ref: z.string().min(3).max(120) }).strict(),
    messageHash: z.string().regex(HEX_DIGEST),
    recipient: z.string().regex(BASE58).nullable(),
    spend: AmountSchema.nullable(),
    programIds: z.array(z.string().regex(BASE58)).max(16),
    reservation: z.object({ budgetId: z.string().min(3).max(160), amountRaw: z.string().regex(RAW) }).strict().nullable(),
    policyVersion: z.string().min(1).max(64).nullable(),
    mandateId: z.string().min(3).max(128).nullable(),
    lastValidBlockHeight: z.number().int().min(0),
    issuedAt: timestamp,
    expiresAt: timestamp,
    handoffDigest: z.string().regex(HEX_DIGEST),
  })
  .strict();
export type SignerHandoff = z.output<typeof SignerHandoffSchema>;

export const ActionIntentSchema = z
  .object({
    schema: z.literal("ryntra.action.intent"),
    schemaVersion: z.literal("1.0.0"),
    version: z.number().int().min(1),
    actionId: ActionIdSchema,
    origin: z.enum(ACTION_ORIGINS),
    cluster: z.enum(ACTION_CLUSTERS),
    chainId: z.string().min(3).max(64),
    /** The authority matrix row (EXE-1, `venue.action`) this action acts under. */
    authorityId: z.string().regex(AUTHORITY_ID),
    mode: z.enum(["MANUAL", "ASSISTED", "AUTONOMOUS"]),
    orgId: z.string().min(3).max(128).nullable(),
    actor: ActorSchema,
    mandateId: z.string().min(3).max(128).nullable(),
    policyVersion: z.string().min(1).max(64).nullable(),
    venue: z.string().min(2).max(64),
    programIds: z.array(z.string().regex(BASE58)).max(16),
    /** The most this action may spend, of one mint. Null for an action that spends nothing it budgets. */
    spend: AmountSchema.nullable(),
    /** The wallet whose money the spend is: what the chain's balance changes are read against. Null without a spend. */
    payer: z.string().regex(BASE58).nullable(),
    recipient: z.string().regex(BASE58).nullable(),
    quoteId: z.string().min(1).max(128).nullable(),
    idempotencyKey: IdempotencyKeySchema,
    actionDigest: z.string().regex(HEX_DIGEST),
    status: z.enum(ACTION_STATUSES),
    lastSeq: z.number().int().min(1),
    lastEventHash: z.string().regex(HEX_DIGEST),
    reservation: z.object({ budgetId: z.string().min(3).max(160), amountRaw: z.string().regex(RAW) }).strict().nullable(),
    /** Every handoff issued, oldest first; at most one is live at a time (`issueSignerHandoff`). */
    handoffs: z.array(SignerHandoffSchema).max(8),
    /** Signatures this action holds the claim on (`actionTransactions`) — a receipt binds to these only. */
    signatures: z.array(SignatureSchema).max(8),
    receipt: ReceiptRefSchema.nullable(),
    projections: z.array(ProjectionRefSchema).max(8),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();
export type ActionIntent = z.output<typeof ActionIntentSchema>;

/** The fields of spec §14.2, on every event; `status` moves only by an event. */
export const ActionEventSchema = z
  .object({
    schema: z.literal("ryntra.action.event"),
    schemaVersion: z.literal("1.0.0"),
    /** Constant: an event is inserted once and never versioned on. */
    version: z.literal(1),
    eventId: z.string().min(8).max(160),
    actionId: ActionIdSchema,
    seq: z.number().int().min(1),
    type: z.enum(ACTION_EVENT_TYPES),
    statusAfter: z.enum(ACTION_STATUSES),
    orgId: z.string().min(3).max(128).nullable(),
    actorId: z.string().min(3).max(128),
    mandateId: z.string().min(3).max(128).nullable(),
    policyVersion: z.string().min(1).max(64).nullable(),
    idempotencyKey: IdempotencyKeySchema,
    actionDigest: z.string().regex(HEX_DIGEST),
    chainId: z.string().min(3).max(64),
    venue: z.string().min(2).max(64),
    programId: z.string().regex(BASE58).nullable(),
    signerRef: z.string().min(3).max(128).nullable(),
    quoteId: z.string().min(1).max(128).nullable(),
    slot: z.number().int().min(0).nullable(),
    txSignature: SignatureSchema.nullable(),
    observedDeltas: z.array(ObservedDeltaSchema).max(32),
    feeBreakdown: z.array(FeeLineSchema).max(16).nullable(),
    /** Base units this step reserved, committed, released or found overspent — of the action's spend mint. */
    amountRaw: z.string().regex(RAW).nullable(),
    reasonCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/)).max(16),
    eventAt: timestamp,
    observer: z.string().min(3).max(64),
    receiptRef: ReceiptRefSchema.nullable(),
    prevEventHash: z.string().regex(HEX_DIGEST).nullable(),
    eventHash: z.string().regex(HEX_DIGEST),
  })
  .strict();
export type ActionEvent = z.output<typeof ActionEventSchema>;

export const IdempotencyClaimSchema = z
  .object({
    schema: z.literal("ryntra.action.idempotency"),
    version: z.literal(1),
    scope: z.string().min(3).max(160),
    idempotencyKey: IdempotencyKeySchema,
    actionId: ActionIdSchema,
    /** The `actionDigest` the key was first used for: the same key with another action is a conflict, never a replay. */
    actionDigest: z.string().regex(HEX_DIGEST),
    claimedAt: timestamp,
  })
  .strict();
export type IdempotencyClaim = z.output<typeof IdempotencyClaimSchema>;

export const BudgetSchema = z
  .object({
    schema: z.literal("ryntra.action.budget"),
    schemaVersion: z.literal("1.0.0"),
    version: z.number().int().min(1),
    budgetId: z.string().regex(/^[a-z0-9][a-z0-9:._-]{2,159}$/),
    orgId: z.string().min(3).max(128).nullable(),
    ownerId: z.string().min(3).max(128),
    mint: z.string().regex(BASE58),
    decimals: z.number().int().min(0).max(18),
    limitRaw: z.string().regex(RAW).max(40),
    /** Held for actions not yet settled. */
    reservedRaw: z.string().regex(RAW).max(40),
    /** Settled, up to what each action reserved. Invariant: reserved + spent ≤ limit. */
    spentRaw: z.string().regex(RAW).max(40),
    /** What settled actions spent beyond their reservation — an incident, outside the limit's arithmetic. */
    overspentRaw: z.string().regex(RAW).max(40),
    /** Set by an overspend; a frozen budget reserves nothing until a person looks. */
    frozen: z.boolean(),
    startsAt: timestamp.nullable(),
    endsAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();
export type Budget = z.output<typeof BudgetSchema>;

export const ReservationSchema = z
  .object({
    schema: z.literal("ryntra.action.reservation"),
    version: z.number().int().min(1),
    actionId: ActionIdSchema,
    budgetId: z.string().min(3).max(160),
    mint: z.string().regex(BASE58),
    amountRaw: z.string().regex(RAW).max(40),
    state: z.enum(["RESERVED", "COMMITTED", "RELEASED"]),
    committedRaw: z.string().regex(RAW).max(40).nullable(),
    reservedAt: timestamp,
    settledAt: timestamp.nullable(),
  })
  .strict();
export type Reservation = z.output<typeof ReservationSchema>;

export const TransactionClaimSchema = z
  .object({
    schema: z.literal("ryntra.action.transaction"),
    version: z.literal(1),
    cluster: z.enum(ACTION_CLUSTERS),
    signature: SignatureSchema,
    actionId: ActionIdSchema,
    messageHash: z.string().regex(HEX_DIGEST).nullable(),
    claimedAt: timestamp,
  })
  .strict();
export type TransactionClaim = z.output<typeof TransactionClaimSchema>;

/* ------------------------------------------------------------------- keys */

export function eventKey(actionId: string, seq: number): string {
  /* Zero-padded, so a prefix scan returns the events in their order whatever the store sorts by. */
  return `${actionId}:${String(seq).padStart(6, "0")}`;
}

export function eventPrefix(actionId: string): string {
  return `${actionId}:`;
}

export function idempotencyScopeKey(scope: string, key: string): string {
  return `${scope}:${key}`;
}

export function transactionKey(cluster: ActionCluster, signature: string): string {
  return `${cluster}:${signature}`;
}

/* ---------------------------------------------------------------- digests */

/** A fresh `actionId`, before anything is signed. */
export function newActionId(random: (size: number) => Uint8Array = randomBytes): string {
  return `act_${Buffer.from(random(16)).toString("hex")}`;
}

/**
 * The `actionId` of an action a lane recorded first — a function of the lane's own key, so the History row, the
 * receipt and the ledger name the same action without any of them storing the others' ids.
 */
export function adoptedActionId(args: Readonly<{ cluster: ActionCluster; lane: string; wallet: string; legacyId: string }>): string {
  const digest = hashCanonical({ domain: "ryntra.action.adopted.v1", cluster: args.cluster, lane: args.lane, wallet: args.wallet, legacyId: args.legacyId });
  return `act_${digest.slice(2, 34)}`;
}

export type ActionDigestInput = Readonly<{
  cluster: ActionCluster;
  authorityId: string;
  mode: string;
  orgId: string | null;
  actor: Actor;
  mandateId: string | null;
  policyVersion: string | null;
  venue: string;
  programIds: readonly string[];
  spend: Amount | null;
  payer: string | null;
  recipient: string | null;
  quoteId: string | null;
}>;

/** What the action is, exactly — the same bytes whoever asks, so a signer can refuse anything else. */
export function actionDigestOf(input: ActionDigestInput): string {
  return hashCanonical({
    domain: "ryntra.action.digest.v1",
    cluster: input.cluster,
    authorityId: input.authorityId,
    mode: input.mode,
    orgId: input.orgId,
    actor: input.actor,
    mandateId: input.mandateId,
    policyVersion: input.policyVersion,
    venue: input.venue,
    programIds: [...input.programIds].sort(),
    spend: input.spend,
    payer: input.payer,
    recipient: input.recipient,
    quoteId: input.quoteId,
  });
}

/** The hash an event carries over its own fields and the hash of the one before it. */
export function eventHashOf(event: Omit<ActionEvent, "eventHash">): string {
  return hashCanonical({ domain: "ryntra.action.event.v1", ...event });
}
