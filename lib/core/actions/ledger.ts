/**
 * The action and budget ledger (EXE-2; spec §3.2–§3.3, §14.1–§14.2, §17.3 PR-2).
 *
 * Every step of an action is one call here and one atomic write: the head moves to its next version, one event is
 * inserted at the next sequence number, and — where the step touches money — the budget and the reservation move in
 * the same `compareAndSetMany`. Two callers racing on one action, one budget or one idempotency key cannot both win:
 * the loser re-reads (bounded, `withBoundedCasRetry`) and decides again on what the winner wrote. A step that changed
 * nothing — the same reservation, the same signature, the same receipt asked for twice — is a replay: it returns what
 * is recorded and writes nothing.
 *
 * The events are written only by insert: no function here sets or deletes one (a test reads this file for it), and
 * the migration makes the database refuse it as well. `status` changes only by an event, with the history kept.
 *
 * What the ledger never does: sign, send, or hold a key. It refuses a bounded signer (`BOUNDED_SIGNER_OPEN`) and an
 * autonomous action under a row the authority matrix does not call automatic — so until EXE-3 and EXE-4, every action
 * it records is signed by the person's own wallet.
 */

import { ZodError } from "zod";

import { GuardCasExhaustedError, withBoundedCasRetry, type GuardAtomicVersionedWrite, type GuardStore } from "../../guard/store.ts";
import { findAuthority, isAutomatic } from "../authority-matrix.ts";
import { BOUNDED_SIGNER_OPEN, MAX_HANDOFF_LIFE_MS, handoffMayLand, sealHandoff, type SignerKind } from "./handoff.ts";
import { hashCanonical } from "../../guard/canonical.ts";
import {
  ACTION_CHAIN_IDS,
  ACTION_COLLECTIONS,
  ActionEventSchema,
  ActionIntentSchema,
  AmountSchema,
  BudgetSchema,
  FeeLineSchema,
  IdempotencyClaimSchema,
  IdempotencyKeySchema,
  ObservedDeltaSchema,
  ReservationSchema,
  SignatureSchema,
  SignerHandoffSchema,
  TERMINAL_ACTION_STATUSES,
  TransactionClaimSchema,
  actionDigestOf,
  eventHashOf,
  eventKey,
  eventPrefix,
  idempotencyScopeKey,
  newActionId,
  raw,
  rawString,
  transactionKey,
  WRAPPED_SOL_MINT,
  type ActionCluster,
  type ActionEvent,
  type ActionEventType,
  type ActionIntent,
  type ActionStatus,
  type Actor,
  type Amount,
  type Budget,
  type FeeLine,
  type IdempotencyClaim,
  type ObservedDelta,
  type ProjectionRef,
  type ReceiptRef,
  type Reservation,
  type SignerHandoff,
  type TransactionClaim,
} from "./model.ts";
import { verifyActionReceipt, type ReceiptCheckReason } from "./receipt-check.ts";

/* ------------------------------------------------------------------ results */

export const LEDGER_REFUSALS = [
  "VALIDATION_ERROR",
  "AUTHORITY_UNKNOWN",
  "AUTHORITY_NOT_AUTOMATIC",
  "IDEMPOTENCY_CONFLICT",
  "ACTION_NOT_FOUND",
  "STATE_REFUSED",
  "BUDGET_NOT_FOUND",
  "BUDGET_CONFLICT",
  "BUDGET_MINT_MISMATCH",
  "BUDGET_SCOPE_MISMATCH",
  "BUDGET_REFUSED",
  "SIGNER_NOT_OPEN",
  "HANDOFF_REFUSED",
  "HANDOFF_MISMATCH",
  "HANDOFF_STILL_LIVE",
  "SIGNATURE_TAKEN",
  "TRANSACTION_UNKNOWN",
  "RECEIPT_REFUSED",
  "LEDGER_CONTENDED",
  "LEDGER_UNAVAILABLE",
] as const;
export type LedgerRefusal = (typeof LEDGER_REFUSALS)[number];

export type LedgerOk<T = object> = Readonly<{ ok: true; action: ActionIntent; event: ActionEvent | null; replay: boolean }> & Readonly<T>;
export type LedgerRefused = Readonly<{
  ok: false;
  code: LedgerRefusal;
  reasons: readonly string[];
  retryable: boolean;
  /** Set when the refusal itself was recorded as an event (a budget refused, a receipt refused). */
  action: ActionIntent | null;
  event: ActionEvent | null;
}>;
export type LedgerResult<T = object> = LedgerOk<T> | LedgerRefused;

function refused(code: LedgerRefusal, reasons: readonly string[] = [], extra: Partial<Pick<LedgerRefused, "action" | "event" | "retryable">> = {}): LedgerRefused {
  return Object.freeze({ ok: false, code, reasons, retryable: extra.retryable ?? false, action: extra.action ?? null, event: extra.event ?? null });
}

/* ----------------------------------------------------------------- the step */

type EventDraft = Readonly<{
  type: ActionEventType;
  statusAfter: ActionStatus;
  observer: string;
  programId?: string | null;
  signerRef?: string | null;
  slot?: number | null;
  txSignature?: string | null;
  observedDeltas?: readonly ObservedDelta[];
  feeBreakdown?: readonly FeeLine[] | null;
  amountRaw?: string | null;
  reasonCodes?: readonly string[];
  receiptRef?: ReceiptRef | null;
}>;

type Decision<T> =
  | Readonly<{ refuse: LedgerRefused }>
  | Readonly<{ replay: T }>
  | Readonly<{
      event: EventDraft;
      head?: Partial<Omit<ActionIntent, "version" | "status" | "lastSeq" | "lastEventHash" | "updatedAt">>;
      writes?: readonly GuardAtomicVersionedWrite[];
      result: T;
      /** The step is recorded and is still a refusal to its caller (a budget or a receipt refused). */
      refusal?: Readonly<{ code: LedgerRefusal; reasons: readonly string[] }>;
    }>;

function buildEvent(head: ActionIntent, seq: number, draft: EventDraft, now: string): ActionEvent {
  const body: Omit<ActionEvent, "eventHash"> = {
    schema: "ryntra.action.event",
    schemaVersion: "1.0.0",
    version: 1,
    eventId: `${head.actionId}:e${seq}`,
    actionId: head.actionId,
    seq,
    type: draft.type,
    statusAfter: draft.statusAfter,
    orgId: head.orgId,
    actorId: head.actor.id,
    mandateId: head.mandateId,
    policyVersion: head.policyVersion,
    idempotencyKey: head.idempotencyKey,
    actionDigest: head.actionDigest,
    chainId: head.chainId,
    venue: head.venue,
    programId: draft.programId ?? null,
    signerRef: draft.signerRef ?? null,
    quoteId: head.quoteId,
    slot: draft.slot ?? null,
    txSignature: draft.txSignature ?? null,
    observedDeltas: [...(draft.observedDeltas ?? [])],
    feeBreakdown: draft.feeBreakdown ? [...draft.feeBreakdown] : null,
    amountRaw: draft.amountRaw ?? null,
    reasonCodes: [...(draft.reasonCodes ?? [])],
    eventAt: now,
    observer: draft.observer,
    receiptRef: draft.receiptRef ?? null,
    prevEventHash: seq === 1 ? null : head.lastEventHash,
  };
  return ActionEventSchema.parse({ ...body, eventHash: eventHashOf(body) });
}

/** A stored record that no longer reads as its schema: the store's fault, never the request's. */
class StoredRecordError extends Error {
  constructor(where: string) {
    super(`A stored ledger record does not read: ${where}`);
    this.name = "StoredRecordError";
  }
}

type Parser<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

function parseStored<T>(schema: Parser<T>, value: unknown, where: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StoredRecordError(where);
  return parsed.data;
}

async function readHead(store: GuardStore, actionId: string): Promise<ActionIntent | null> {
  const value = await store.collection<unknown>(ACTION_COLLECTIONS.intents).get(actionId);
  if (value === undefined || value === null) return null;
  return parseStored(ActionIntentSchema, value, `${ACTION_COLLECTIONS.intents}/${actionId}`);
}

async function readParsed<T>(store: GuardStore, collection: (typeof ACTION_COLLECTIONS)[keyof typeof ACTION_COLLECTIONS], key: string, schema: Parser<T>): Promise<T | null> {
  const value = await store.collection<unknown>(collection).get(key);
  return value === undefined || value === null ? null : parseStored(schema, value, `${collection}/${key}`);
}

/** Store faults and lost races become refusals: a caller in a money pipeline stops on them, it never guesses. */
async function guarded<T>(run: () => Promise<LedgerResult<T>>): Promise<LedgerResult<T>> {
  try {
    return await run();
  } catch (failure) {
    if (failure instanceof GuardCasExhaustedError) return refused("LEDGER_CONTENDED", [], { retryable: true });
    if (failure instanceof StoredRecordError) return refused("LEDGER_UNAVAILABLE", ["STORED_RECORD_UNREADABLE", failure.message.slice(0, 160)], { retryable: false });
    /* A record that does not parse is the request's fault (a field only the full schema checks), never an outage. */
    if (failure instanceof ZodError) return refused("VALIDATION_ERROR", failure.issues.slice(0, 8).map((issue) => `${issue.path.join(".")}: ${issue.message}`.slice(0, 120)));
    return refused("LEDGER_UNAVAILABLE", [failure instanceof Error ? failure.message.slice(0, 200) : "UNKNOWN"], { retryable: true });
  }
}

async function step<T extends object>(
  store: GuardStore,
  actionId: string,
  now: string,
  decide: (head: ActionIntent) => Promise<Decision<T>> | Decision<T>,
): Promise<LedgerResult<T>> {
  return guarded(() =>
    withBoundedCasRetry<LedgerResult<T>>(async () => {
      const head = await readHead(store, actionId);
      if (!head) return refused("ACTION_NOT_FOUND");
      const decision = await decide(head);
      if ("refuse" in decision) return decision.refuse;
      if ("replay" in decision) return Object.freeze({ ok: true as const, action: head, event: null, replay: true, ...decision.replay });
      const seq = head.lastSeq + 1;
      const event = buildEvent(head, seq, decision.event, now);
      const next = ActionIntentSchema.parse({
        ...head,
        ...decision.head,
        version: head.version + 1,
        status: decision.event.statusAfter,
        lastSeq: seq,
        lastEventHash: event.eventHash,
        updatedAt: now,
      });
      const wrote = await store.compareAndSetMany([
        { collection: ACTION_COLLECTIONS.intents, key: actionId, expectedVersion: head.version, next },
        { collection: ACTION_COLLECTIONS.events, key: eventKey(actionId, seq), expectedVersion: null, next: event },
        ...(decision.writes ?? []),
      ]);
      if (!wrote) return false;
      if (decision.refusal) return refused(decision.refusal.code, decision.refusal.reasons, { action: next, event });
      return Object.freeze({ ok: true as const, action: next, event, replay: false, ...decision.result });
    }),
  );
}

/* ------------------------------------------------------------------ opening */

export type OpenActionInput = Readonly<{
  cluster: ActionCluster;
  authorityId: string;
  mode: "MANUAL" | "ASSISTED" | "AUTONOMOUS";
  orgId: string | null;
  actor: Actor;
  mandateId?: string | null;
  policyVersion?: string | null;
  venue: string;
  programIds?: readonly string[];
  spend: Amount | null;
  payer?: string | null;
  recipient?: string | null;
  quoteId?: string | null;
  idempotencyKey: string;
  now: string;
  /** Tests only: a fixed id source. */
  newId?: () => string;
}>;

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

/**
 * Whether an action must hold a budget reservation before any signer sees its bytes: every spend except a person's
 * own wallet acting for itself — a team's, an agent's, a bot's, anything under a mandate.
 */
export function budgeted(action: Readonly<{ actor: Actor; orgId: string | null; mandateId: string | null }>): boolean {
  return !(action.actor.kind === "PERSON" && action.orgId === null && action.mandateId === null);
}

/** One scope per team, else per actor: two teams (or two people) may use the same key without meeting. */
export function idempotencyScopeOf(args: Readonly<{ orgId: string | null; actor: Actor }>): string {
  return args.orgId !== null ? `org:${args.orgId}` : `${args.actor.kind.toLowerCase()}:${args.actor.id}`;
}

/**
 * Open an action before anything is built or signed: one `actionId`, its digest, the idempotency claim and the first
 * event, in one write. The same key with the same action replays the first answer; with another action it is
 * `IDEMPOTENCY_CONFLICT` and nothing is written.
 */
export async function openAction(store: GuardStore, input: OpenActionInput): Promise<LedgerResult> {
  const row = findAuthority(input.authorityId);
  if (!row) return refused("AUTHORITY_UNKNOWN", [input.authorityId]);
  /* «Без виконання коштами людей»: an autonomous action exists only under a row the matrix calls automatic — none today. */
  if (input.mode === "AUTONOMOUS" && !isAutomatic(row)) return refused("AUTHORITY_NOT_AUTOMATIC", [row.id]);
  const key = IdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!key.success) return refused("VALIDATION_ERROR", ["IDEMPOTENCY_KEY_INVALID"]);
  if (input.spend !== null && !AmountSchema.safeParse(input.spend).success) return refused("VALIDATION_ERROR", ["SPEND_INVALID"]);
  const payer = input.payer ?? (input.spend !== null && (input.actor.kind === "PERSON" || input.actor.kind === "TEAM_MEMBER") ? input.actor.id : null);
  if (input.spend !== null && payer === null) return refused("VALIDATION_ERROR", ["PAYER_REQUIRED"]);
  const programIds = [...new Set(input.programIds ?? [])].sort();
  const invalid = [
    ...(payer !== null && !BASE58_ADDRESS.test(payer) ? ["PAYER_INVALID"] : []),
    ...(input.recipient && !BASE58_ADDRESS.test(input.recipient) ? ["RECIPIENT_INVALID"] : []),
    ...(programIds.some((program) => !BASE58_ADDRESS.test(program)) || programIds.length > 16 ? ["PROGRAMS_INVALID"] : []),
  ];
  if (invalid.length > 0) return refused("VALIDATION_ERROR", invalid);
  /* A spend that is not the person's own wallet acting for itself is budgeted; its bound must name where and through what. */
  if (budgeted({ actor: input.actor, orgId: input.orgId, mandateId: input.mandateId ?? null })) {
    /* A team's, an agent's or a bot's action names what it may spend — "0" for none — so its bound is never open. */
    const missing = [
      ...(input.spend === null ? ["SPEND_REQUIRED"] : []),
      ...(!input.recipient ? ["RECIPIENT_REQUIRED"] : []),
      ...(programIds.length === 0 ? ["PROGRAMS_REQUIRED"] : []),
    ];
    if (missing.length > 0) return refused("VALIDATION_ERROR", missing);
  }
  const digestInput = {
    cluster: input.cluster,
    authorityId: row.id,
    mode: input.mode,
    orgId: input.orgId,
    actor: { kind: input.actor.kind, id: input.actor.id },
    mandateId: input.mandateId ?? null,
    policyVersion: input.policyVersion ?? null,
    venue: input.venue,
    programIds,
    spend: input.spend,
    payer,
    recipient: input.recipient ?? null,
    quoteId: input.quoteId ?? null,
  };
  const actionDigest = actionDigestOf(digestInput);
  const scope = idempotencyScopeOf(input);
  const claimKey = idempotencyScopeKey(scope, input.idempotencyKey);

  return guarded(() =>
    withBoundedCasRetry<LedgerResult>(async () => {
      const prior = await readParsed(store, ACTION_COLLECTIONS.idempotency, claimKey, IdempotencyClaimSchema);
      if (prior) return replayOrConflict(store, prior, actionDigest);
      const actionId = (input.newId ?? newActionId)();
      const draft = {
        schema: "ryntra.action.intent" as const,
        schemaVersion: "1.0.0" as const,
        version: 1,
        actionId,
        origin: "OPENED" as const,
        chainId: ACTION_CHAIN_IDS[input.cluster],
        ...digestInput,
        idempotencyKey: input.idempotencyKey,
        actionDigest,
        status: "OPENED" as const,
        lastSeq: 1,
        reservation: null,
        handoffs: [],
        signatures: [],
        receipt: null,
        projections: [],
        createdAt: input.now,
        updatedAt: input.now,
      };
      const event = buildEvent({ ...draft, lastEventHash: `0x${"0".repeat(64)}` } as ActionIntent, 1, { type: "OPENED", statusAfter: "OPENED", observer: "ledger" }, input.now);
      const head = ActionIntentSchema.parse({ ...draft, lastEventHash: event.eventHash });
      const claim: IdempotencyClaim = { schema: "ryntra.action.idempotency", version: 1, scope, idempotencyKey: input.idempotencyKey, actionId, actionDigest, claimedAt: input.now };
      const wrote = await store.compareAndSetMany([
        { collection: ACTION_COLLECTIONS.idempotency, key: claimKey, expectedVersion: null, next: IdempotencyClaimSchema.parse(claim) },
        { collection: ACTION_COLLECTIONS.intents, key: actionId, expectedVersion: null, next: head },
        { collection: ACTION_COLLECTIONS.events, key: eventKey(actionId, 1), expectedVersion: null, next: event },
      ]);
      if (!wrote) return false;
      return Object.freeze({ ok: true as const, action: head, event, replay: false });
    }),
  );
}

async function replayOrConflict(store: GuardStore, claim: IdempotencyClaim, actionDigest: string): Promise<LedgerResult> {
  if (claim.actionDigest !== actionDigest) return refused("IDEMPOTENCY_CONFLICT", ["KEY_USED_FOR_ANOTHER_ACTION"]);
  const head = await readHead(store, claim.actionId);
  /* The claim, the head and the first event land in one transaction; a claim without its head is a broken store. */
  if (!head) return refused("LEDGER_UNAVAILABLE", ["IDEMPOTENCY_CLAIM_WITHOUT_ACTION"], { retryable: false });
  return Object.freeze({ ok: true as const, action: head, event: null, replay: true });
}

/* ------------------------------------------------------------------ budgets */

export type DefineBudgetInput = Readonly<{
  budgetId: string;
  orgId: string | null;
  ownerId: string;
  limit: Amount;
  startsAt?: string | null;
  endsAt?: string | null;
  now: string;
}>;

/** A budget is made once; the same terms again replay, other terms are `BUDGET_CONFLICT`. */
export async function defineBudget(store: GuardStore, input: DefineBudgetInput): Promise<Readonly<{ ok: true; budget: Budget; replay: boolean }> | LedgerRefused> {
  const parsed = BudgetSchema.safeParse({
    schema: "ryntra.action.budget",
    schemaVersion: "1.0.0",
    version: 1,
    budgetId: input.budgetId,
    orgId: input.orgId,
    ownerId: input.ownerId,
    mint: input.limit.mint,
    decimals: input.limit.decimals,
    limitRaw: input.limit.amountRaw,
    reservedRaw: "0",
    spentRaw: "0",
    overspentRaw: "0",
    frozen: false,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    createdAt: input.now,
    updatedAt: input.now,
  });
  if (!parsed.success) return refused("VALIDATION_ERROR", ["BUDGET_INVALID"]);
  try {
    const budgets = store.versioned<Budget>(ACTION_COLLECTIONS.budgets);
    if (await budgets.compareAndSet(input.budgetId, null, parsed.data)) return { ok: true, budget: parsed.data, replay: false };
    const existing = await readBudget(store, input.budgetId);
    if (!existing) return refused("LEDGER_UNAVAILABLE", [], { retryable: true });
    const same = existing.orgId === input.orgId && existing.ownerId === input.ownerId && existing.mint === input.limit.mint
      && existing.decimals === input.limit.decimals && existing.limitRaw === input.limit.amountRaw
      && existing.startsAt === (input.startsAt ?? null) && existing.endsAt === (input.endsAt ?? null);
    return same ? { ok: true, budget: existing, replay: true } : refused("BUDGET_CONFLICT");
  } catch (failure) {
    return refused("LEDGER_UNAVAILABLE", [failure instanceof Error ? failure.message.slice(0, 200) : "UNKNOWN"], { retryable: true });
  }
}

export async function readBudget(store: GuardStore, budgetId: string): Promise<Budget | null> {
  return readParsed(store, ACTION_COLLECTIONS.budgets, budgetId, BudgetSchema);
}

export function budgetAvailable(budget: Budget): bigint {
  return raw(budget.limitRaw) - raw(budget.reservedRaw) - raw(budget.spentRaw);
}

function budgetWrite(budget: Budget, next: Partial<Budget>, now: string): GuardAtomicVersionedWrite {
  const updated = BudgetSchema.parse({ ...budget, ...next, version: budget.version + 1, updatedAt: now });
  /* The database's own check (the migration) holds the same line; this throws before a bad batch is even sent. */
  if (raw(updated.reservedRaw) + raw(updated.spentRaw) > raw(updated.limitRaw)) throw new Error("A budget write would pass its limit.");
  return { collection: ACTION_COLLECTIONS.budgets, key: budget.budgetId, expectedVersion: budget.version, next: updated };
}

/**
 * Hold the action's whole spend on a budget, atomically with the action's event. Two actions racing for the last of a
 * budget: one holds it, the other is `BUDGET_REFUSED` (recorded) — never both. The same action asking twice replays.
 */
export async function reserveBudget(store: GuardStore, input: Readonly<{ actionId: string; budgetId: string; now: string }>): Promise<LedgerResult<{ reservation: Reservation | null }>> {
  return step<{ reservation: Reservation | null }>(store, input.actionId, input.now, async (head) => {
    if (head.reservation) {
      if (head.reservation.budgetId !== input.budgetId) return { refuse: refused("STATE_REFUSED", ["RESERVED_ON_ANOTHER_BUDGET"]) };
      const reservation = await readParsed(store, ACTION_COLLECTIONS.reservations, head.actionId, ReservationSchema);
      /* A reservation already committed or given back is history, not a hold: asking again is not a success. */
      if (!reservation || reservation.state !== "RESERVED") return { refuse: refused("STATE_REFUSED", ["RESERVATION_SETTLED"]) };
      return { replay: { reservation } };
    }
    if (head.status !== "OPENED") return { refuse: refused("STATE_REFUSED", [head.status]) };
    if (!head.spend) return { refuse: refused("VALIDATION_ERROR", ["NOTHING_TO_RESERVE"]) };
    const budget = await readBudget(store, input.budgetId);
    if (!budget) return { refuse: refused("BUDGET_NOT_FOUND") };
    if (budget.mint !== head.spend.mint || budget.decimals !== head.spend.decimals) return { refuse: refused("BUDGET_MINT_MISMATCH") };
    const inScope = budget.orgId !== null ? budget.orgId === head.orgId : head.orgId === null && budget.ownerId === head.actor.id;
    if (!inScope) return { refuse: refused("BUDGET_SCOPE_MISMATCH") };
    const amount = raw(head.spend.amountRaw);
    const reasons: string[] = [];
    if (budget.frozen) reasons.push("BUDGET_FROZEN");
    if (budget.startsAt && Date.parse(input.now) < Date.parse(budget.startsAt)) reasons.push("BUDGET_NOT_STARTED");
    if (budget.endsAt && Date.parse(input.now) >= Date.parse(budget.endsAt)) reasons.push("BUDGET_ENDED");
    if (amount > budgetAvailable(budget)) reasons.push("BUDGET_EXCEEDED");
    if (reasons.length > 0) {
      return {
        event: { type: "BUDGET_REFUSED", statusAfter: "REFUSED", observer: "ledger", amountRaw: rawString(amount), reasonCodes: reasons },
        result: { reservation: null },
        refusal: { code: "BUDGET_REFUSED", reasons },
      };
    }
    const reservation = ReservationSchema.parse({
      schema: "ryntra.action.reservation",
      version: 1,
      actionId: head.actionId,
      budgetId: budget.budgetId,
      mint: budget.mint,
      amountRaw: rawString(amount),
      state: "RESERVED",
      committedRaw: null,
      reservedAt: input.now,
      settledAt: null,
    });
    return {
      event: { type: "BUDGET_RESERVED", statusAfter: "RESERVED", observer: "ledger", amountRaw: rawString(amount) },
      head: { reservation: { budgetId: budget.budgetId, amountRaw: rawString(amount) } },
      writes: [
        budgetWrite(budget, { reservedRaw: rawString(raw(budget.reservedRaw) + amount) }, input.now),
        { collection: ACTION_COLLECTIONS.reservations, key: head.actionId, expectedVersion: null, next: reservation },
      ],
      result: { reservation },
    };
  });
}

/** Settle a reservation: `committed` of it becomes spent, the rest goes back. Writes for one batch. */
async function settleReservation(
  store: GuardStore,
  head: ActionIntent,
  committed: bigint,
  overspent: bigint,
  now: string,
): Promise<readonly GuardAtomicVersionedWrite[]> {
  if (!head.reservation) return [];
  const reservation = await readParsed(store, ACTION_COLLECTIONS.reservations, head.actionId, ReservationSchema);
  const budget = await readBudget(store, head.reservation.budgetId);
  if (!reservation || !budget || reservation.state !== "RESERVED") throw new Error("A reservation the action names is missing or settled.");
  const held = raw(reservation.amountRaw);
  return [
    budgetWrite(budget, {
      reservedRaw: rawString(raw(budget.reservedRaw) - held),
      spentRaw: rawString(raw(budget.spentRaw) + committed),
      overspentRaw: rawString(raw(budget.overspentRaw) + overspent),
      frozen: budget.frozen || overspent > 0n,
    }, now),
    {
      collection: ACTION_COLLECTIONS.reservations,
      key: head.actionId,
      expectedVersion: reservation.version,
      next: ReservationSchema.parse({ ...reservation, version: reservation.version + 1, state: committed > 0n ? "COMMITTED" : "RELEASED", committedRaw: rawString(committed), settledAt: now }),
    },
  ];
}

/* ------------------------------------------------------------------ handoff */

export type IssueHandoffInput = Readonly<{
  actionId: string;
  signer: Readonly<{ kind: SignerKind; ref: string }>;
  /** Read from the built bytes: their SHA-256, recipient, the amount of the spend mint they move, their programs. */
  messageHash: string;
  recipient: string | null;
  spend: Amount | null;
  programIds: readonly string[];
  /** The last block height the bytes' blockhash is valid for — required: it is what says a copy can no longer land. */
  lastValidBlockHeight: number;
  expiresAt: string;
  now: string;
  /** For a handoff after an earlier one: the cluster's block height now, and that a chain search for each earlier message found nothing. */
  blockHeight?: number;
  previousNotFoundOnChain?: boolean;
}>;

/**
 * Record what the signer is handed and return the sealed contract. Refused before anything is written when the bytes
 * would do other than the action says: another recipient, another mint, more than the action's spend (or its
 * reservation), a program the action does not name. A budgeted action (a team's, an agent's, a bot's, under a
 * mandate) is handed off only once it holds its reservation.
 *
 * At most one handoff is live: a new one (new bytes, a new blockhash) is refused while the last can still land
 * (`HANDOFF_STILL_LIVE`), so two signed copies can never spend one reservation twice. The same bytes asked for again
 * replay the sealed handoff already recorded; the same bytes with other facts are `HANDOFF_MISMATCH`.
 */
export async function issueSignerHandoff(store: GuardStore, input: IssueHandoffInput): Promise<LedgerResult<{ handoff: SignerHandoff | null }>> {
  if (input.signer.kind === "BOUNDED_SIGNER" && !BOUNDED_SIGNER_OPEN) return refused("SIGNER_NOT_OPEN");
  if (!/^0x[0-9a-f]{64}$/.test(input.messageHash)) return refused("VALIDATION_ERROR", ["MESSAGE_HASH_INVALID"]);
  const life = Date.parse(input.expiresAt) - Date.parse(input.now);
  if (!(life > 0)) return refused("VALIDATION_ERROR", ["EXPIRES_AT_PAST"]);
  if (life > MAX_HANDOFF_LIFE_MS) return refused("VALIDATION_ERROR", ["EXPIRES_AT_TOO_FAR"]);
  if (!Number.isInteger(input.lastValidBlockHeight) || input.lastValidBlockHeight < 0) return refused("VALIDATION_ERROR", ["LAST_VALID_BLOCK_HEIGHT_REQUIRED"]);
  /* The height comes from the blockhash of the bytes just built; one already passed is a handoff that cannot land. */
  if (input.blockHeight !== undefined && input.lastValidBlockHeight <= input.blockHeight) return refused("VALIDATION_ERROR", ["LAST_VALID_BLOCK_HEIGHT_PASSED"]);
  const programIds = [...new Set(input.programIds)].sort();
  const factsOf = (facts: Readonly<{ signer: { kind: string; ref: string }; recipient: string | null; spend: Amount | null; programIds: readonly string[] }>) =>
    hashCanonical({ signer: { kind: facts.signer.kind, ref: facts.signer.ref }, recipient: facts.recipient, spend: facts.spend, programIds: [...facts.programIds].sort() });
  return step<{ handoff: SignerHandoff | null }>(store, input.actionId, input.now, (head) => {
    const same = head.handoffs.find((handoff) => handoff.messageHash === input.messageHash);
    if (same) {
      if (factsOf(same) !== factsOf({ ...input, programIds })) return { refuse: refused("HANDOFF_MISMATCH", ["SAME_BYTES_OTHER_FACTS"]) };
      if (same !== head.handoffs.at(-1)) return { refuse: refused("STATE_REFUSED", ["HANDOFF_SUPERSEDED"]) };
      if (head.status === "HANDED_OFF") return { replay: { handoff: same } };
      return { refuse: refused("STATE_REFUSED", [head.status]) };
    }
    const mustReserve = budgeted(head);
    const fromOpened = head.status === "OPENED" && !mustReserve && input.signer.kind === "PERSON_WALLET";
    if (!(head.status === "RESERVED" || head.status === "HANDED_OFF" || fromOpened)) {
      return { refuse: refused("STATE_REFUSED", head.status === "OPENED" ? ["RESERVATION_REQUIRED"] : [head.status]) };
    }
    /* A new handoff only when no earlier copy can land: past its time and its block height, and not found on the chain. */
    const live = head.handoffs.filter((handoff) => handoffMayLand(handoff, input.now, input.blockHeight));
    if (live.length > 0) return { refuse: refused("HANDOFF_STILL_LIVE", live.map((handoff) => handoff.handoffId)) };
    if (head.handoffs.length > 0 && input.previousNotFoundOnChain !== true) return { refuse: refused("STATE_REFUSED", ["CHAIN_NOT_SEARCHED"]) };
    if (head.handoffs.length >= 8) return { refuse: refused("STATE_REFUSED", ["HANDOFFS_EXHAUSTED"]) };
    const reasons: string[] = [];
    if (input.signer.kind === "PERSON_WALLET" && head.payer !== null && input.signer.ref !== head.payer) reasons.push("SIGNER_NOT_PAYER");
    if (head.recipient !== null && input.recipient !== head.recipient) reasons.push("RECIPIENT_MISMATCH");
    if (head.spend === null) {
      if (input.spend !== null && input.spend.amountRaw !== "0") reasons.push("AMOUNT_ABOVE_SPEND");
    } else if (input.spend !== null) {
      if (input.spend.mint !== head.spend.mint || input.spend.decimals !== head.spend.decimals) reasons.push("MINT_MISMATCH");
      const ceiling = head.reservation ? raw(head.reservation.amountRaw) : raw(head.spend.amountRaw);
      if (raw(input.spend.amountRaw) > ceiling) reasons.push("AMOUNT_ABOVE_SPEND");
    }
    if (head.programIds.length > 0 && programIds.some((program) => !head.programIds.includes(program))) reasons.push("PROGRAM_NOT_ALLOWED");
    if (reasons.length > 0) return { refuse: refused("HANDOFF_REFUSED", reasons) };
    const handoff = SignerHandoffSchema.parse(sealHandoff({
      schema: "ryntra.action.signer-handoff",
      schemaVersion: "1.0.0",
      handoffId: `${head.actionId}:h${head.lastSeq + 1}`,
      actionId: head.actionId,
      actionDigest: head.actionDigest,
      cluster: head.cluster,
      chainId: head.chainId,
      signer: { kind: input.signer.kind, ref: input.signer.ref },
      messageHash: input.messageHash,
      recipient: input.recipient,
      spend: input.spend,
      programIds,
      reservation: head.reservation,
      policyVersion: head.policyVersion,
      mandateId: head.mandateId,
      lastValidBlockHeight: input.lastValidBlockHeight,
      issuedAt: input.now,
      expiresAt: input.expiresAt,
    }));
    return {
      event: {
        type: "HANDOFF_ISSUED",
        statusAfter: "HANDED_OFF",
        observer: "ledger",
        signerRef: `${input.signer.kind}:${input.signer.ref}`.slice(0, 128),
        amountRaw: input.spend?.amountRaw ?? null,
      },
      head: { handoffs: [...head.handoffs, handoff] },
      result: { handoff },
    };
  });
}

/**
 * The handoff a signer checks against (`checkSignerHandoff`'s `recordedDigest`): read from the ledger by its id, so a
 * handoff changed and re-sealed on its way does not match what was recorded.
 */
export async function readSignerHandoff(store: GuardStore, handoffId: string): Promise<SignerHandoff | null> {
  const actionId = handoffId.split(":")[0];
  const head = await readHead(store, actionId);
  return head?.handoffs.find((handoff) => handoff.handoffId === handoffId) ?? null;
}

/* --------------------------------------------------------------- submission */

/**
 * The signed bytes crossed the broadcast boundary. One signature belongs to one action (claimed in the same write);
 * an action has one live attempt — after `SUBMITTED` only an observation, a recovery or a failure follows, never a
 * second send.
 */
export async function recordSubmission(store: GuardStore, input: Readonly<{ actionId: string; signature: string; messageHash: string; now: string }>): Promise<LedgerResult> {
  if (!SignatureSchema.safeParse(input.signature).success) return refused("VALIDATION_ERROR", ["SIGNATURE_INVALID"]);
  return step(store, input.actionId, input.now, async (head) => {
    if (head.signatures.includes(input.signature)) return { replay: {} };
    const claimKey = transactionKey(head.cluster, input.signature);
    const claim = await readParsed(store, ACTION_COLLECTIONS.transactions, claimKey, TransactionClaimSchema);
    if (claim && claim.actionId !== head.actionId) return { refuse: refused("SIGNATURE_TAKEN") };
    if (head.status !== "HANDED_OFF") return { refuse: refused("STATE_REFUSED", [head.status]) };
    /* Any bytes this action was handed may have been signed and sent, an expired copy included: the send is a fact to
       record, and the chain — not the clock — says whether it landed. */
    if (!head.handoffs.some((handoff) => handoff.messageHash === input.messageHash)) return { refuse: refused("HANDOFF_MISMATCH") };
    const record: TransactionClaim = { schema: "ryntra.action.transaction", version: 1, cluster: head.cluster, signature: input.signature, actionId: head.actionId, messageHash: input.messageHash, claimedAt: input.now };
    return {
      event: { type: "SUBMITTED", statusAfter: "SUBMITTED", observer: "ledger", txSignature: input.signature },
      head: { signatures: [...head.signatures, input.signature] },
      writes: [{ collection: ACTION_COLLECTIONS.transactions, key: claimKey, expectedVersion: null, next: TransactionClaimSchema.parse(record) }],
      result: {},
    };
  });
}

/** The answer to the send was lost: the action waits for a read of the chain by its signature, and nothing is resent. */
export async function markRecovery(store: GuardStore, input: Readonly<{ actionId: string; reason: string; now: string }>): Promise<LedgerResult> {
  if (!REASON_CODE.test(input.reason)) return refused("VALIDATION_ERROR", ["REASON_INVALID"]);
  return step(store, input.actionId, input.now, (head) => {
    if (head.status === "RECOVERY") return { replay: {} };
    if (head.status !== "SUBMITTED") return { refuse: refused("STATE_REFUSED", [head.status]) };
    return { event: { type: "RECOVERY_REQUIRED", statusAfter: "RECOVERY", observer: "ledger", reasonCodes: [input.reason] }, result: {} };
  });
}

/* -------------------------------------------------------------- observation */

export type RecordObservationInput = Readonly<{
  actionId: string;
  signature: string;
  outcome: "LANDED" | "FAILED";
  slot: number | null;
  /** The chain's balance changes, read at finality (spec §14.6, §14.7 п. 1), never inferred from an HTTP 200. */
  observedDeltas: readonly ObservedDelta[];
  feeBreakdown?: readonly FeeLine[] | null;
  observer: string;
  now: string;
}>;

/** What the network takes beside the bytes' own amount — always in SOL, out of the fee payer's balance. */
const NETWORK_FEE_KINDS: readonly FeeLine["kind"][] = ["NETWORK", "PRIORITY"];

/**
 * The most network and priority fees one action may set apart from its spend: 0.01 SOL. A larger "fee" counts as
 * spend, so a fee line can never hide what the bytes moved.
 */
export const MAX_NETWORK_FEE_LAMPORTS = 10_000_000n;

/**
 * How much of the action's spend mint left the payer, by the chain's own deltas. For a SOL spend, the network and
 * priority fees the payer itself paid (fee lines in wrapped SOL naming the payer, up to `MAX_NETWORK_FEE_LAMPORTS`)
 * are set apart — they are in the same balance change and the event keeps them in `feeBreakdown`. Nothing else is
 * subtracted: a venue's or Ryntra's fee is part of what the bytes moved, and rent is money that left the person.
 */
export function spentOf(head: ActionIntent, deltas: readonly ObservedDelta[], fees: readonly FeeLine[] = []): bigint {
  if (!head.spend || !head.payer) return 0n;
  const net = deltas
    .filter((delta) => delta.owner === head.payer && delta.mint === head.spend?.mint)
    .reduce((sum, delta) => sum + raw(delta.deltaRaw), 0n);
  const outflow = net < 0n ? -net : 0n;
  const networkFees = head.spend.mint !== WRAPPED_SOL_MINT ? 0n : fees
    .filter((fee) => fee.mint === WRAPPED_SOL_MINT && fee.payer === head.payer && NETWORK_FEE_KINDS.includes(fee.kind))
    .reduce((sum, fee) => sum + raw(fee.amountRaw), 0n);
  const setApart = networkFees > MAX_NETWORK_FEE_LAMPORTS ? MAX_NETWORK_FEE_LAMPORTS : networkFees;
  return outflow > setApart ? outflow - setApart : 0n;
}

/**
 * Record what the chain shows for the submitted signature and settle the reservation in the same write: what left
 * the payer becomes spent, up to what was reserved, and the rest goes back. More than reserved is an incident: the
 * reserved part is spent, the excess is kept apart, the budget freezes and the action goes to `RECOVERY` — never a
 * quiet success.
 */
export async function recordObservation(store: GuardStore, input: RecordObservationInput): Promise<LedgerResult<{ spentRaw: string; overspentRaw: string }>> {
  const deltas = ObservedDeltaSchema.array().max(32).safeParse(input.observedDeltas);
  if (!deltas.success) return refused("VALIDATION_ERROR", ["DELTAS_INVALID"]);
  const fees = input.feeBreakdown ? FeeLineSchema.array().max(16).safeParse(input.feeBreakdown) : null;
  if (fees && !fees.success) return refused("VALIDATION_ERROR", ["FEES_INVALID"]);
  return step<{ spentRaw: string; overspentRaw: string }>(store, input.actionId, input.now, async (head) => {
    if (!head.signatures.includes(input.signature)) return { refuse: refused("TRANSACTION_UNKNOWN") };
    const settled = [...(await readEvents(store, head.actionId))].reverse().find((event) => event.type === "OBSERVED" || event.type === "FAILED" || event.type === "OVERSPEND_DETECTED");
    if (settled) {
      /* Observed once: the same read again settles nothing twice. */
      const overspentRaw = settled.type === "OVERSPEND_DETECTED" ? settled.amountRaw ?? "0" : "0";
      const spentRaw = settled.type === "OVERSPEND_DETECTED" ? head.reservation?.amountRaw ?? head.spend?.amountRaw ?? "0" : settled.amountRaw ?? "0";
      return { replay: { spentRaw, overspentRaw } };
    }
    if (head.status !== "SUBMITTED" && head.status !== "RECOVERY") return { refuse: refused("STATE_REFUSED", [head.status]) };
    const spent = spentOf(head, deltas.data, fees?.data ?? []);
    const ceiling = head.reservation ? raw(head.reservation.amountRaw) : head.spend ? raw(head.spend.amountRaw) : 0n;
    const overspent = spent > ceiling ? spent - ceiling : 0n;
    const committed = spent - overspent;
    const writes = await settleReservation(store, head, committed, overspent, input.now);
    const common = { observer: input.observer, slot: input.slot, txSignature: input.signature, observedDeltas: deltas.data, feeBreakdown: fees?.data ?? null };
    const event: EventDraft = overspent > 0n
      ? { ...common, type: "OVERSPEND_DETECTED", statusAfter: "RECOVERY", amountRaw: rawString(overspent), reasonCodes: ["SPENT_ABOVE_RESERVATION"] }
      : input.outcome === "LANDED"
        ? { ...common, type: "OBSERVED", statusAfter: "OBSERVED", amountRaw: rawString(committed) }
        : { ...common, type: "FAILED", statusAfter: "FAILED", amountRaw: rawString(committed), reasonCodes: ["LANDED_FAILED"] };
    return { event, writes, result: { spentRaw: rawString(committed), overspentRaw: rawString(overspent) } };
  });
}

export type CancelActionInput = Readonly<{
  actionId: string;
  reason: string;
  now: string;
  /**
   * For a handed-off action only: the cluster's block height now (it must be past every handoff's
   * `lastValidBlockHeight` that was recorded) and the caller's word that a search of the chain by each handoff's
   * message found nothing. Without both the bytes might still land, and the reservation stays.
   */
  blockHeight?: number;
  notFoundOnChain?: boolean;
}>;

/**
 * Give the reservation back before anything was sent. A handed-off action is cancelled only once none of its handed-off
 * bytes can land — each handoff past its time and its last valid block height, and searched for on the chain.
 */
export async function cancelAction(store: GuardStore, input: CancelActionInput): Promise<LedgerResult> {
  if (!REASON_CODE.test(input.reason)) return refused("VALIDATION_ERROR", ["REASON_INVALID"]);
  return step(store, input.actionId, input.now, async (head) => {
    if (head.status === "RELEASED") return { replay: {} };
    if (!(head.status === "OPENED" || head.status === "RESERVED" || head.status === "HANDED_OFF")) return { refuse: refused("STATE_REFUSED", [head.status]) };
    if (head.status === "HANDED_OFF") {
      const live = head.handoffs.filter((handoff) => handoffMayLand(handoff, input.now, input.blockHeight));
      if (live.length > 0) return { refuse: refused("HANDOFF_STILL_LIVE", live.map((handoff) => handoff.handoffId)) };
      if (input.notFoundOnChain !== true) return { refuse: refused("STATE_REFUSED", ["CHAIN_NOT_SEARCHED"]) };
    }
    const writes = await settleReservation(store, head, 0n, 0n, input.now);
    return {
      event: { type: "CANCELLED", statusAfter: "RELEASED", observer: "ledger", amountRaw: head.reservation?.amountRaw ?? null, reasonCodes: [input.reason] },
      writes,
      result: {},
    };
  });
}

/* ------------------------------------------------------------------ receipt */

/**
 * Check an Outcome Receipt against the action and record the verdict. `RECEIPT_VERIFIED` reconciles the action; a
 * refused receipt is recorded with its reasons and the action stays `OBSERVED`, waiting for one that proves it.
 */
export async function attachReceipt(
  store: GuardStore,
  input: Readonly<{ actionId: string; receipt: unknown; trustedPublicKeys: readonly string[]; now: string }>,
): Promise<LedgerResult<{ reasons: readonly ReceiptCheckReason[] }>> {
  /* A sound signature by any key proves only that someone signed: the deployment's published issuer keys are required. */
  if (!Array.isArray(input.trustedPublicKeys) || input.trustedPublicKeys.length === 0) return refused("VALIDATION_ERROR", ["TRUSTED_KEYS_REQUIRED"]);
  return step<{ reasons: readonly ReceiptCheckReason[] }>(store, input.actionId, input.now, async (head) => {
    const contentHash = (input.receipt as { contentHash?: unknown } | null)?.contentHash;
    if (head.status === "RECONCILED" && head.receipt?.contentHash === contentHash) return { replay: { reasons: [] } };
    if (head.status !== "OBSERVED") return { refuse: refused("STATE_REFUSED", [head.status]) };
    const events = await readEvents(store, head.actionId);
    const observed = lastObservation(head, events);
    const check = verifyActionReceipt(head, input.receipt, { trustedPublicKeys: input.trustedPublicKeys, observed });
    if (!check.ok) {
      /* Each refusal is on record — up to a bound, so a stream of bad receipts cannot grow the log without end. */
      if (events.filter((event) => event.type === "RECEIPT_REFUSED").length >= MAX_RECORDED_RECEIPT_REFUSALS) {
        return { refuse: refused("RECEIPT_REFUSED", check.reasons) };
      }
      return {
        event: { type: "RECEIPT_REFUSED", statusAfter: "OBSERVED", observer: "ledger", reasonCodes: check.reasons, receiptRef: check.ref },
        result: { reasons: check.reasons },
        refusal: { code: "RECEIPT_REFUSED", reasons: check.reasons },
      };
    }
    return {
      event: { type: "RECEIPT_VERIFIED", statusAfter: "RECONCILED", observer: "ledger", receiptRef: check.ref, txSignature: check.ref?.transactionHash ?? null },
      head: { receipt: check.ref },
      result: { reasons: [] },
    };
  });
}

const MAX_RECORDED_RECEIPT_REFUSALS = 16;

function lastObservation(head: ActionIntent, events: readonly ActionEvent[]): "LANDED" | "FAILED" | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === "OBSERVED") return "LANDED";
    if (events[index].type === "FAILED") return "FAILED";
  }
  /* An adopted action's first event carries the lane's own observation. */
  return head.origin === "ADOPTED" && head.status === "OBSERVED" ? "LANDED" : null;
}

/* -------------------------------------------------------------------- reads */

export async function readEvents(store: GuardStore, actionId: string): Promise<readonly ActionEvent[]> {
  const rows = await store.collection<unknown>(ACTION_COLLECTIONS.events).valuesWithPrefix(eventPrefix(actionId));
  return rows.map((row) => parseStored(ActionEventSchema, row, `${ACTION_COLLECTIONS.events}/${actionId}`)).sort((left, right) => left.seq - right.seq);
}

export type ActionReading = Readonly<{
  action: ActionIntent;
  events: readonly ActionEvent[];
  /** `INTACT` when every event's hash recomputes, each names the one before it, and the head names the last. */
  chain: "INTACT" | "BROKEN";
  issues: readonly string[];
}>;

export async function readAction(store: GuardStore, actionId: string): Promise<ActionReading | null> {
  const action = await readHead(store, actionId);
  if (!action) return null;
  const events = await readEvents(store, actionId);
  return Object.freeze({ action, events, ...chainOf(action, events) });
}

export function chainOf(action: ActionIntent, events: readonly ActionEvent[]): Readonly<{ chain: "INTACT" | "BROKEN"; issues: readonly string[] }> {
  const issues: string[] = [];
  let previous: string | null = null;
  events.forEach((event, index) => {
    const { eventHash, ...body } = event;
    if (event.seq !== index + 1) issues.push(`SEQ_GAP_AT_${index + 1}`);
    if (eventHashOf(body) !== eventHash) issues.push(`EVENT_HASH_MISMATCH_${event.seq}`);
    if (event.prevEventHash !== previous) issues.push(`EVENT_LINK_BROKEN_${event.seq}`);
    if (event.actionId !== action.actionId || event.actionDigest !== action.actionDigest) issues.push(`EVENT_FOREIGN_${event.seq}`);
    previous = eventHash;
  });
  const last = events.at(-1);
  if (!last || last.seq !== action.lastSeq || last.eventHash !== action.lastEventHash) issues.push("HEAD_NOT_AT_LAST_EVENT");
  if (last && last.statusAfter !== action.status) issues.push("STATUS_NOT_FROM_EVENTS");
  return { chain: issues.length === 0 ? "INTACT" : "BROKEN", issues };
}

/** Which action a submitted signature belongs to, for a receipt or a chain read that names only the transaction. */
export async function actionIdForSignature(store: GuardStore, cluster: ActionCluster, signature: string): Promise<string | null> {
  const claim = await readParsed(store, ACTION_COLLECTIONS.transactions, transactionKey(cluster, signature), TransactionClaimSchema);
  return claim?.actionId ?? null;
}

export function isTerminal(status: ActionStatus): boolean {
  return TERMINAL_ACTION_STATUSES.includes(status);
}

/* ----------------------------------------------------------------- adoption */

export type AdoptActionInput = Readonly<{
  actionId: string;
  cluster: ActionCluster;
  authorityId: string;
  actor: Actor;
  venue: string;
  spend: Amount | null;
  idempotencyKey: string;
  status: Extract<ActionStatus, "SUBMITTED" | "OBSERVED" | "FAILED" | "RECOVERY">;
  signature: string | null;
  /** Claim the signature for this action — off for a lane whose transaction is another action's (a payment received). */
  claimSignature: boolean;
  projection: ProjectionRef;
  observer: string;
  now: string;
}>;

const ADOPTED_MOVES: Readonly<Record<string, readonly ActionStatus[]>> = {
  SUBMITTED: ["OBSERVED", "FAILED", "RECOVERY"],
  RECOVERY: ["OBSERVED", "FAILED"],
};
const ADOPTED_EVENT: Readonly<Record<string, ActionEventType>> = { OBSERVED: "OBSERVED", FAILED: "FAILED", RECOVERY: "RECOVERY_REQUIRED" };

/**
 * Record an action a lane already made — signed by the person's wallet, recorded first by the lane — under its
 * deterministic `actionId`. Its first sight is one `ADOPTED` event; a later sight that moves it (in flight → done)
 * appends one event; a sight that says nothing new writes nothing. The lane's own record is never touched.
 */
export async function adoptAction(store: GuardStore, input: AdoptActionInput): Promise<LedgerResult> {
  const row = findAuthority(input.authorityId);
  if (!row) return refused("AUTHORITY_UNKNOWN", [input.authorityId]);
  const signature = input.signature !== null && SignatureSchema.safeParse(input.signature).success ? input.signature : null;
  return guarded(() =>
    withBoundedCasRetry<LedgerResult>(async () => {
      const head = await readHead(store, input.actionId);
      if (head) return advanceAdopted(store, head, input, signature);
      /* A signature joins `signatures` only with its claim: one transaction, one action, so one receipt reconciles one. */
      const claimable = signature !== null && input.claimSignature
        && !(await readParsed(store, ACTION_COLLECTIONS.transactions, transactionKey(input.cluster, signature), TransactionClaimSchema));
      const digestInput = {
        cluster: input.cluster,
        authorityId: row.id,
        mode: "MANUAL" as const,
        orgId: null,
        actor: { kind: input.actor.kind, id: input.actor.id },
        mandateId: null,
        policyVersion: null,
        venue: input.venue,
        programIds: [],
        spend: input.spend,
        payer: input.spend !== null ? input.actor.id : null,
        recipient: null,
        quoteId: null,
      };
      const actionDigest = actionDigestOf(digestInput);
      const draft = {
        schema: "ryntra.action.intent" as const,
        schemaVersion: "1.0.0" as const,
        version: 1,
        actionId: input.actionId,
        origin: "ADOPTED" as const,
        chainId: ACTION_CHAIN_IDS[input.cluster],
        ...digestInput,
        idempotencyKey: input.idempotencyKey,
        actionDigest,
        status: input.status,
        lastSeq: 1,
        reservation: null,
        handoffs: [],
        signatures: claimable && signature ? [signature] : [],
        receipt: null,
        projections: [input.projection],
        createdAt: input.now,
        updatedAt: input.now,
      };
      const event = buildEvent({ ...draft, lastEventHash: `0x${"0".repeat(64)}` } as ActionIntent, 1, { type: "ADOPTED", statusAfter: input.status, observer: input.observer, txSignature: signature }, input.now);
      const head0 = ActionIntentSchema.parse({ ...draft, lastEventHash: event.eventHash });
      const scope = idempotencyScopeOf({ orgId: null, actor: input.actor });
      const claim: IdempotencyClaim = { schema: "ryntra.action.idempotency", version: 1, scope, idempotencyKey: input.idempotencyKey, actionId: input.actionId, actionDigest, claimedAt: input.now };
      const writes: GuardAtomicVersionedWrite[] = [
        { collection: ACTION_COLLECTIONS.idempotency, key: idempotencyScopeKey(scope, input.idempotencyKey), expectedVersion: null, next: IdempotencyClaimSchema.parse(claim) },
        { collection: ACTION_COLLECTIONS.intents, key: input.actionId, expectedVersion: null, next: head0 },
        { collection: ACTION_COLLECTIONS.events, key: eventKey(input.actionId, 1), expectedVersion: null, next: event },
      ];
      if (claimable && signature) writes.push(signatureClaim(input.cluster, signature, input.actionId, input.now));
      if (!(await store.compareAndSetMany(writes))) return false;
      return Object.freeze({ ok: true as const, action: head0, event, replay: false });
    }),
  );
}

function signatureClaim(cluster: ActionCluster, signature: string, actionId: string, now: string): GuardAtomicVersionedWrite {
  return {
    collection: ACTION_COLLECTIONS.transactions,
    key: transactionKey(cluster, signature),
    expectedVersion: null,
    next: TransactionClaimSchema.parse({ schema: "ryntra.action.transaction", version: 1, cluster, signature, actionId, messageHash: null, claimedAt: now }),
  };
}

async function advanceAdopted(store: GuardStore, head: ActionIntent, input: AdoptActionInput, signature: string | null): Promise<LedgerResult | false> {
  if (head.origin !== "ADOPTED") return refused("STATE_REFUSED", ["NOT_ADOPTED"]);
  /* The authority may read differently on a later sight (a row's origin filled in); the actor and network never may. */
  if (head.actor.kind !== input.actor.kind || head.actor.id !== input.actor.id || head.cluster !== input.cluster) return refused("STATE_REFUSED", ["ANOTHER_ACTOR"]);
  const moves = ADOPTED_MOVES[head.status] ?? [];
  const newSignature = signature !== null && input.claimSignature && !head.signatures.includes(signature) && head.signatures.length < 8
    && !(await readParsed(store, ACTION_COLLECTIONS.transactions, transactionKey(head.cluster, signature), TransactionClaimSchema))
    ? signature
    : null;
  const moving = moves.includes(input.status);
  if (!moving && !newSignature) {
    /* The same sight again, or one that would move a settled action back: nothing to record. */
    return Object.freeze({ ok: true as const, action: head, event: null, replay: true });
  }
  const status = moving ? input.status : head.status;
  const seq = head.lastSeq + 1;
  const type: ActionEventType = moving ? ADOPTED_EVENT[input.status] : "SIGNATURE_SEEN";
  const event = buildEvent(head, seq, { type, statusAfter: status, observer: input.observer, txSignature: signature }, input.now);
  const next = ActionIntentSchema.parse({
    ...head,
    version: head.version + 1,
    status,
    lastSeq: seq,
    lastEventHash: event.eventHash,
    signatures: newSignature ? [...head.signatures, newSignature] : head.signatures,
    updatedAt: input.now,
  });
  const wrote = await store.compareAndSetMany([
    { collection: ACTION_COLLECTIONS.intents, key: head.actionId, expectedVersion: head.version, next },
    { collection: ACTION_COLLECTIONS.events, key: eventKey(head.actionId, seq), expectedVersion: null, next: event },
    ...(newSignature ? [signatureClaim(head.cluster, newSignature, head.actionId, input.now)] : []),
  ]);
  if (!wrote) return false;
  return Object.freeze({ ok: true as const, action: next, event, replay: false });
}
