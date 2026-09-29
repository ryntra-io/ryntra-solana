/**
 * One prepared action, and what became of it.
 *
 * The Stellar workspace could do the whole lifecycle and remember none of it:
 * every state existed while a payment was being made and was discarded when the
 * page closed. Four modules waited on that — Activity, Attention & Recovery,
 * Recipients, Reports — and each of them needs the same thing, which is a record
 * that outlives the screen that produced it.
 *
 * ## What a record is, and what it deliberately is not
 *
 * It is the **evidence trail**, not the transaction. Everything here is either
 * something the person typed, something they authorized, or something the ledger
 * published — so a record can be shown, exported and reasoned about without ever
 * holding a key, an XDR that could be resubmitted, or a signature.
 *
 * The signed envelope is **absent on purpose**. Keeping it would mean a stored
 * artifact that can still reach the network, sitting in a browser, long after the
 * person stopped thinking about it. The transaction hash is the durable handle;
 * anyone can re-read the ledger from it, which is exactly what the Receipts
 * surface does.
 *
 * ## The states are the ones the founder's contract names
 *
 * Nine, and they map one-to-one onto the lifecycle the Send surface runs. The
 * two that matter most are the ones a demo skips: `FAILED` and
 * `RECONCILIATION_REQUIRED`. A product that only records success has recorded
 * nothing worth keeping.
 */

export const STELLAR_ACTIVITY_STATES = [
  /** Typed, not yet checked. */
  "DRAFT",
  /** Preflight refused it before any signature. Nothing was spent. */
  "BLOCKED",
  /** Built and waiting for the person to authorize the exact intent. */
  "AWAITING_AUTHORIZATION",
  /** Authorized against a fingerprint taken before the bytes left. */
  "AUTHORIZED",
  /** Signed in the wallet and matched field by field against the authorization. */
  "SIGNED",
  /** Accepted by the network; not yet observed in a closed ledger. */
  "SUBMITTED",
  /** In a closed ledger. What it actually did has not been compared yet. */
  "CONFIRMED",
  /** Observed, and expected does not equal actual. */
  "RECONCILIATION_REQUIRED",
  /** Observed, and every movement matched what was authorized. */
  "RECONCILED",
  /** The network, the wallet or the ledger refused it. */
  "FAILED",
] as const;

export type StellarActivityState = (typeof STELLAR_ACTIVITY_STATES)[number];

/** States that are finished: nothing further will happen without a new action. */
export const TERMINAL_ACTIVITY_STATES: readonly StellarActivityState[] = [
  "BLOCKED",
  "RECONCILED",
  "FAILED",
];

/**
 * States a person has to do something about.
 *
 * `RECONCILIATION_REQUIRED` is the one that must never be quiet: the ledger did
 * something other than what was authorized, and a surface that files that under
 * "history" has turned the product's central claim into a log line.
 */
export const ATTENTION_ACTIVITY_STATES: readonly StellarActivityState[] = [
  "RECONCILIATION_REQUIRED",
  "FAILED",
  "AWAITING_AUTHORIZATION",
  "SIGNED",
  "SUBMITTED",
];

export const ACTIVITY_SCHEMA = "stellar-activity-1.0.0";

export type StellarActivityRecord = Readonly<{
  /** Stable across every update to the same action. */
  id: string;
  schema: typeof ACTIVITY_SCHEMA;
  createdAt: string;
  updatedAt: string;
  state: StellarActivityState;

  /** What was intended. Everything below this line the person typed or chose. */
  operation: "payment";
  network: string;
  assetCode: string;
  amount: string;
  destination: string;
  memo: string | null;
  source: string | null;

  /** What was authorized, signed, submitted and observed. */
  authorizationHash: string | null;
  authorizedAt: string | null;
  transactionHash: string | null;
  ledger: number | null;
  resultCode: string | null;
  reconciliation: "MATCHED" | "DEVIATION_RECORDED" | null;
  receiptHash: string | null;

  /** Why it stopped, and the one step that moves it forward. */
  reason: string | null;
  recovery: string | null;
}>;

export type StellarActivityDraft = Partial<Omit<StellarActivityRecord, "id" | "schema" | "createdAt">> &
  Readonly<{ id: string }>;

/**
 * A new record, from an intent.
 *
 * `now` and `id` are parameters rather than generated here, because a module
 * that reaches for `Date.now()` cannot be tested for the thing that matters:
 * that two updates to the same action produce one row rather than two.
 */
export function newActivityRecord(
  input: Readonly<{
    id: string;
    now: string;
    network: string;
    assetCode: string;
    amount: string;
    destination: string;
    memo?: string | null;
    source?: string | null;
  }>,
): StellarActivityRecord {
  return {
    id: input.id,
    schema: ACTIVITY_SCHEMA,
    createdAt: input.now,
    updatedAt: input.now,
    state: "DRAFT",
    operation: "payment",
    network: input.network,
    assetCode: input.assetCode,
    amount: input.amount,
    destination: input.destination,
    memo: input.memo ?? null,
    source: input.source ?? null,
    authorizationHash: null,
    authorizedAt: null,
    transactionHash: null,
    ledger: null,
    resultCode: null,
    reconciliation: null,
    receiptHash: null,
    reason: null,
    recovery: null,
  };
}

/**
 * Apply an update to a record.
 *
 * **A terminal state is never left.** The payout kernel learned this the
 * expensive way and it is the same rule here: once a lifecycle has reconciled or
 * failed, a late-arriving update must not rewrite it into something in flight.
 * The write is dropped and the record is returned unchanged, so a caller cannot
 * silently reopen a settled decision.
 */
export function applyActivityUpdate(
  record: StellarActivityRecord,
  patch: Omit<StellarActivityDraft, "id">,
  now: string,
): StellarActivityRecord {
  if (TERMINAL_ACTIVITY_STATES.includes(record.state)) return record;
  return { ...record, ...patch, id: record.id, schema: ACTIVITY_SCHEMA, createdAt: record.createdAt, updatedAt: now };
}

/** What a reader sees, per state. Kept beside the vocabulary, not in a component. */
export const ACTIVITY_COPY: Readonly<Record<StellarActivityState, Readonly<{ label: string; meaning: string }>>> = {
  DRAFT: { label: "Draft", meaning: "Typed and not yet checked against the network." },
  BLOCKED: {
    label: "Blocked",
    meaning: "The preflight refused it before any signature. Nothing was signed and no fee was charged.",
  },
  AWAITING_AUTHORIZATION: {
    label: "Awaiting authorization",
    meaning: "Built and waiting for you to authorize the exact intent.",
  },
  AUTHORIZED: {
    label: "Authorized",
    meaning: "Authorized against a fingerprint taken before the bytes left. Not signed.",
  },
  SIGNED: {
    label: "Signed",
    meaning: "Signed in your wallet and matched field by field against what you authorized. Not submitted.",
  },
  SUBMITTED: {
    label: "Submitted",
    meaning: "Accepted by the network and not yet seen in a closed ledger.",
  },
  CONFIRMED: {
    label: "Confirmed",
    meaning: "In a closed ledger. What it actually did has not been compared yet.",
  },
  RECONCILIATION_REQUIRED: {
    label: "Reconciliation required",
    meaning: "The ledger did something other than what was authorized. This is the case the product exists for.",
  },
  RECONCILED: {
    label: "Reconciled",
    meaning: "Every movement matched what was authorized, checked against the ledger itself.",
  },
  FAILED: { label: "Failed", meaning: "The network, the wallet or the ledger refused it." },
};

/** Newest first, and stable — two records written in the same millisecond keep their order. */
export function sortActivity(records: readonly StellarActivityRecord[]): readonly StellarActivityRecord[] {
  return [...records].sort((a, b) => (a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1));
}

/** Records that need a person, in the order they need one. */
export function needsAttention(records: readonly StellarActivityRecord[]): readonly StellarActivityRecord[] {
  return sortActivity(records.filter((record) => ATTENTION_ACTIVITY_STATES.includes(record.state)));
}
