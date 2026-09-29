/**
 * The durable record of one cross-chain swap order — `RYN-SOL-MONEY-FLOWS-001F`.
 *
 * Modelled on `lib/solana/cctp-burn-claim.ts` and for the same reason: a swap
 * that leaves one chain cannot be undone from this side, so the thing that must
 * be unique is the *intent*, never the bytes. One intent digest, one record,
 * compare-and-set on every move, and a trail that keeps where the order has
 * been. The record answers the question the 001F card asks — "where does the
 * money sit right now" — for the card, for History and for recovery, and it is
 * the only place a second submit can be refused from.
 *
 * States, in the order money moves through them:
 *
 * - `RESERVED` — a plan exists; nothing has been handed to any network.
 * - `SUBMITTED_UNKNOWN` — the boundary is being crossed: Solana bytes were
 *   handed to the RPC, or an EVM wallet is about to broadcast. From here on,
 *   value may already be gone.
 * - `SUBMITTED` — the source transaction is known by hash.
 * - `IN_PROGRESS` — Mayan has indexed the order and is working it.
 * - `COMPLETED` — Mayan paid the destination; the destination transaction is known.
 * - `REFUNDED` — Mayan refunded the source side; the refund may be a different
 *   token than the one sent (Swift locks USDC/ETH), which History must say.
 * - `EXPIRED_BEFORE_SUBMIT` — provably never broadcast; the intent may be
 *   planned again.
 * - `SOURCE_FAILED` — the source transaction landed and failed, moving nothing.
 * - `RECOVERY_REQUIRED` — crossed, then lost. Resolved by reading, never by
 *   submitting again.
 */

import { createHash } from "node:crypto";

import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { SWAP_NETWORKS, type CrossSwapProvider, type CrossSwapRouteMechanism, type CrossSwapTupleId, type SwapNetwork } from "../swap/catalog.ts";
import type { CrossSwapProviderStatus } from "./explorer-api.ts";


export const CROSS_SWAP_ORDER_STATES = [
  "RESERVED",
  "SUBMITTED_UNKNOWN",
  "SUBMITTED",
  "IN_PROGRESS",
  "COMPLETED",
  "REFUNDED",
  "EXPIRED_BEFORE_SUBMIT",
  "SOURCE_FAILED",
  "RECOVERY_REQUIRED",
] as const;
export type CrossSwapOrderState = (typeof CROSS_SWAP_ORDER_STATES)[number];

/** States from which no new order may start for this intent. */
const VALUE_MAY_HAVE_MOVED: readonly CrossSwapOrderState[] = [
  "SUBMITTED_UNKNOWN",
  "SUBMITTED",
  "IN_PROGRESS",
  "COMPLETED",
  "REFUNDED",
  "RECOVERY_REQUIRED",
];

const HEX_DIGEST = /^0x[0-9a-f]{64}$/;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const EVM_TX = /^0x[0-9a-fA-F]{64}$/;
const CHAIN_TX = z.union([z.string().regex(SOLANA_SIGNATURE), z.string().regex(EVM_TX)]);
const RAW = /^[0-9]+$/;

const TrailEntrySchema = z
  .object({ state: z.enum(CROSS_SWAP_ORDER_STATES), at: z.string().datetime({ offset: true }), attempt: z.number().int().min(1) })
  .strict();

const RefundSchema = z
  .object({
    chain: z.string().nullable(),
    tokenAddress: z.string().nullable(),
    tokenSymbol: z.string().nullable(),
    amount: z.string().nullable(),
  })
  .strict();

export const CrossSwapOrderRecordSchema = z
  .object({
    version: z.number().int().min(0),
    network: z.literal("mainnet"),
    /* Two providers now carry this lane. The record names which one, because
       a stored order is read back long after the classifier that chose it,
       and the status poller must ask the provider that actually has it. */
    provider: z.enum(["MAYAN", "RELAY"]),
    intentDigest: z.string().regex(HEX_DIGEST),
    /** Digest of the reviewed quote facts; a different Review over the same intent is a conflict. */
    reviewDigest: z.string().regex(HEX_DIGEST),
    /* The pair, by name. An enum of ten until `RYN-SOL-MONEY-FLOWS-001I` opened
       which assets the lane carries: a stored order must still name its pair exactly,
       so the shape stays pinned even though the membership no longer is. The
       shortlisted pairs keep the names they were written with, so nothing
       already stored changes meaning. */
    tupleId: z
      .string()
      .regex(/^[A-Z]+_[A-Za-z0-9]{1,64}_TO_[A-Z]+_[A-Za-z0-9]{1,64}$/)
      .max(160),
    route: z.enum(["SWIFT", "FAST_MCTP", "RELAY_DEPOSIT"]),
    /* Every network this product can carry, not the four it could when this
       record was written. A stored order whose chain the schema refuses is an
       order nobody can read back — including the recovery path. */
    sourceChain: z.enum(SWAP_NETWORKS),
    destinationChain: z.enum(SWAP_NETWORKS),
    sourceWallet: z.string().min(32).max(64),
    destinationWallet: z.string().min(32).max(64),
    amountInRaw: z.string().regex(RAW),
    expectedOutRaw: z.string().regex(RAW),
    minimumOutRaw: z.string().regex(RAW),
    fromDecimals: z.number().int().min(0).max(18),
    toDecimals: z.number().int().min(0).max(18),
    fromSymbol: z.string().min(1).max(24),
    toSymbol: z.string().min(1).max(24),
    deadlineUnix: z.number().int().min(0),
    quoteId: z.string().max(128).nullable(),
    /** sha256 of the unsigned Solana wire the person reviewed; the submit refuses anything else. */
    reviewedWireHash: z.string().regex(HEX_DIGEST).nullable(),
    /** sha256 of the EVM call (to, data, value) the person reviewed. */
    reviewedCallHash: z.string().regex(HEX_DIGEST).nullable(),
    state: z.enum(CROSS_SWAP_ORDER_STATES),
    attempt: z.number().int().min(1),
    sourceTxHash: CHAIN_TX.nullable(),
    providerStatus: z.string().max(96).nullable(),
    providerOrderId: z.string().max(160).nullable(),
    destinationTxHash: CHAIN_TX.nullable(),
    refundTxHash: CHAIN_TX.nullable(),
    /** Human decimal of the output token as Mayan reports it; null until completed. */
    receivedAmount: z.string().max(64).nullable(),
    refund: RefundSchema.nullable(),
    /**
     * The Cross-chain Receipt, minted once and then never rebuilt.
     *
     * `RYN-MONEY-RECEIPT-PARITY-001`. Both default to null so every order
     * written before these fields existed still parses — the two real fills of
     * 2026-09-11 among them, which are exactly the orders that need a receipt
     * issued after the fact.
     *
     * The document is stored rather than recomputed because `createdAt` and the
     * issuer signature move with the clock: a second mint of identical facts is
     * a different content hash, and the hash is what the Activity row was
     * written with. Storing it is what makes a bridge made on a laptop open on
     * a phone.
     */
    receiptHash: z.string().regex(HEX_DIGEST).nullable().default(null),
    receipt: z.unknown().nullable().default(null),
    reservedAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    lastCheckedAt: z.string().datetime({ offset: true }).nullable(),
    trail: z.array(TrailEntrySchema).min(1).max(24),
  })
  .strict();

export type CrossSwapOrderRecord = z.output<typeof CrossSwapOrderRecordSchema>;

export type CrossSwapOrderFailureCode =
  | "CROSS_SWAP_ORDER_UNAVAILABLE"
  | "CROSS_SWAP_ORDER_ABSENT"
  | "CROSS_SWAP_ALREADY_STARTED"
  | "CROSS_SWAP_ORDER_CONFLICT"
  | "CROSS_SWAP_ORDER_STATE";

export type CrossSwapOrderResult =
  | Readonly<{ ok: true; record: CrossSwapOrderRecord; duplicate?: boolean }>
  | Readonly<{ ok: false; code: CrossSwapOrderFailureCode; reason: string; record?: CrossSwapOrderRecord }>;

const COLLECTION = "solanaCrossSwapOrders" as const;

export function crossSwapOrderKey(network: string, intentDigest: string): string {
  return network.concat(":", intentDigest);
}

function sha256Hex(value: unknown): string {
  return `0x${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

/**
 * The identity of one order: who, what, how much, on which reviewed quote,
 * built when. Two plans of the same facts at the same instant are the same
 * intent; the same person planning again a minute later is a new one, which is
 * what lets an abandoned plan be replaced without ever letting a submitted one
 * be repeated.
 */
export function crossSwapIntentDigest(
  facts: Readonly<{
    sourceWallet: string;
    destinationWallet: string;
    tupleId: CrossSwapTupleId;
    route: CrossSwapRouteMechanism;
    amountInRaw: string;
    minimumOutRaw: string;
    quoteId: string | null;
    builtAt: string;
  }>,
): string {
  return sha256Hex(["ryntra.solana.cross-swap-intent.v1", facts]);
}

export function crossSwapReviewDigest(
  facts: Readonly<{
    route: CrossSwapRouteMechanism;
    amountInRaw: string;
    expectedOutRaw: string;
    minimumOutRaw: string;
    deadlineUnix: number;
    walletPrompts: number;
  }>,
): string {
  return sha256Hex(["ryntra.solana.cross-swap-review.v1", facts]);
}

function appendTrail(record: Pick<CrossSwapOrderRecord, "trail" | "attempt">, state: CrossSwapOrderState, at: string): CrossSwapOrderRecord["trail"] {
  const next = [...record.trail, { state, at, attempt: record.attempt }];
  if (next.length <= 24) return next;
  return [...next.slice(0, 8), ...next.slice(next.length - 16)];
}

async function readRecord(
  store: GuardStore,
  key: string,
): Promise<Readonly<{ found: false }> | Readonly<{ found: true; record: CrossSwapOrderRecord }> | Readonly<{ found: "MALFORMED" }>> {
  const raw = await store.collection<unknown>(COLLECTION).get(key);
  if (raw === undefined || raw === null) return { found: false };
  const parsed = CrossSwapOrderRecordSchema.safeParse(raw);
  /* A record that will not parse is not an empty slot: it may be a crossed
     boundary written by a newer shape, and reading it as absent would allow a
     second submit — the one thing this module exists to make impossible. */
  if (!parsed.success) return { found: "MALFORMED" };
  return { found: true, record: parsed.data };
}

export async function readCrossSwapOrder(args: { store: GuardStore; network?: "mainnet"; intentDigest: string }): Promise<CrossSwapOrderResult> {
  const read = await readRecord(args.store, crossSwapOrderKey(args.network ?? "mainnet", args.intentDigest));
  if (read.found === "MALFORMED") {
    return {
      ok: false,
      code: "CROSS_SWAP_ORDER_UNAVAILABLE",
      reason: "The stored order could not be read, so whether this intent has already been submitted is not established.",
    };
  }
  if (!read.found) return { ok: false, code: "CROSS_SWAP_ORDER_ABSENT", reason: "No order is recorded for that intent." };
  return { ok: true, record: read.record };
}

export type ClaimCrossSwapOrderInput = Readonly<{
  store: GuardStore;
  network?: "mainnet";
  intentDigest: string;
  reviewDigest: string;
  provider: CrossSwapProvider;
  tupleId: CrossSwapTupleId;
  route: CrossSwapRouteMechanism;
  sourceChain: SwapNetwork;
  destinationChain: SwapNetwork;
  sourceWallet: string;
  destinationWallet: string;
  amountInRaw: string;
  expectedOutRaw: string;
  minimumOutRaw: string;
  fromDecimals: number;
  toDecimals: number;
  fromSymbol: string;
  toSymbol: string;
  deadlineUnix: number;
  quoteId: string | null;
  reviewedWireHash?: string | null;
  reviewedCallHash?: string | null;
  at: string;
}>;

export function sha256HexOf(text: string): string {
  return `0x${createHash("sha256").update(text).digest("hex")}`;
}

/**
 * Claim one intent before any transaction is built for it.
 *
 * An identical repeat before the boundary returns the existing record as a
 * duplicate, so a retried request never fails. An intent whose value may have
 * moved is refused with the record attached, so the caller shows what exists.
 * A different Review over the same intent is a conflict. After a provably
 * never-broadcast or chain-failed attempt, the same intent may be reserved
 * again with a new attempt number and the whole trail kept.
 */
export async function claimCrossSwapOrder(args: ClaimCrossSwapOrderInput): Promise<CrossSwapOrderResult> {
  const network = args.network ?? "mainnet";
  const key = crossSwapOrderKey(network, args.intentDigest);
  const fresh: CrossSwapOrderRecord = {
    version: 0,
    network,
    provider: args.provider,
    intentDigest: args.intentDigest,
    reviewDigest: args.reviewDigest,
    tupleId: args.tupleId,
    route: args.route,
    sourceChain: args.sourceChain,
    destinationChain: args.destinationChain,
    sourceWallet: args.sourceWallet,
    destinationWallet: args.destinationWallet,
    amountInRaw: args.amountInRaw,
    expectedOutRaw: args.expectedOutRaw,
    minimumOutRaw: args.minimumOutRaw,
    fromDecimals: args.fromDecimals,
    toDecimals: args.toDecimals,
    fromSymbol: args.fromSymbol,
    toSymbol: args.toSymbol,
    deadlineUnix: args.deadlineUnix,
    quoteId: args.quoteId,
    reviewedWireHash: args.reviewedWireHash ?? null,
    reviewedCallHash: args.reviewedCallHash ?? null,
    state: "RESERVED",
    attempt: 1,
    sourceTxHash: null,
    providerStatus: null,
    providerOrderId: null,
    destinationTxHash: null,
    refundTxHash: null,
    receivedAmount: null,
    refund: null,
    receiptHash: null,
    receipt: null,
    reservedAt: args.at,
    updatedAt: args.at,
    lastCheckedAt: null,
    trail: [{ state: "RESERVED", at: args.at, attempt: 1 }],
  };
  const parsed = CrossSwapOrderRecordSchema.safeParse(fresh);
  if (!parsed.success) {
    return { ok: false, code: "CROSS_SWAP_ORDER_UNAVAILABLE", reason: "The order to record is not a well-formed cross-swap order." };
  }
  const won = await args.store.versioned<CrossSwapOrderRecord>(COLLECTION).compareAndSet(key, null, parsed.data);
  if (won) return { ok: true, record: parsed.data };

  const existing = await readRecord(args.store, key);
  if (existing.found === "MALFORMED" || !existing.found) {
    return { ok: false, code: "CROSS_SWAP_ORDER_UNAVAILABLE", reason: "An order already claims that intent and its record could not be read." };
  }
  const record = existing.record;
  if (VALUE_MAY_HAVE_MOVED.includes(record.state)) {
    return {
      ok: false,
      code: "CROSS_SWAP_ALREADY_STARTED",
      reason: `An order for this intent is already in ${record.state}. Value may already have left the source chain; resolve it by reading, never by submitting again.`,
      record,
    };
  }
  if (record.reviewDigest !== args.reviewDigest && record.state === "RESERVED") {
    return { ok: false, code: "CROSS_SWAP_ORDER_CONFLICT", reason: "That intent is already claimed by a different reviewed quote.", record };
  }
  if (record.state === "RESERVED") return { ok: true, record, duplicate: true };

  /* EXPIRED_BEFORE_SUBMIT or SOURCE_FAILED: a new attempt over the same intent. */
  return moveTo({
    store: args.store,
    network,
    intentDigest: args.intentDigest,
    at: args.at,
    bumpAttempt: true,
    patch: {
      reviewDigest: args.reviewDigest,
      sourceTxHash: null,
      providerStatus: null,
      reviewedWireHash: args.reviewedWireHash ?? null,
      reviewedCallHash: args.reviewedCallHash ?? null,
    },
    decide: (current) => (current.state === "EXPIRED_BEFORE_SUBMIT" || current.state === "SOURCE_FAILED" ? "RESERVED" : null),
  });
}

type Patch = Partial<
  Pick<
    CrossSwapOrderRecord,
    | "reviewDigest"
    | "sourceTxHash"
    | "providerStatus"
    | "providerOrderId"
    | "destinationTxHash"
    | "refundTxHash"
    | "receivedAmount"
    | "refund"
    | "lastCheckedAt"
    | "reviewedWireHash"
    | "reviewedCallHash"
    | "receiptHash"
    | "receipt"
  >
>;

async function moveTo(args: {
  store: GuardStore;
  network: string;
  intentDigest: string;
  at: string;
  patch?: Patch;
  bumpAttempt?: boolean;
  /** The next state, or `null` to refuse from the current one; `"SAME"` to patch without moving. */
  decide: (record: CrossSwapOrderRecord) => CrossSwapOrderState | "SAME" | null;
}): Promise<CrossSwapOrderResult> {
  const key = crossSwapOrderKey(args.network, args.intentDigest);
  let refusal: CrossSwapOrderResult | null = null;
  let settled: CrossSwapOrderResult;
  try {
    settled = await withBoundedCasRetry(async () => {
      refusal = null;
      const read = await readRecord(args.store, key);
      if (read.found === "MALFORMED") {
        refusal = { ok: false, code: "CROSS_SWAP_ORDER_UNAVAILABLE", reason: "The stored order could not be read." };
        return refusal;
      }
      if (!read.found) {
        refusal = { ok: false, code: "CROSS_SWAP_ORDER_ABSENT", reason: "No order is recorded for that intent." };
        return refusal;
      }
      const current = read.record;
      const decision = args.decide(current);
      if (decision === null) {
        refusal = {
          ok: false,
          code: "CROSS_SWAP_ORDER_STATE",
          reason: `The order is in ${current.state}, from which this step does not follow.`,
          record: current,
        };
        return refusal;
      }
      const nextState = decision === "SAME" ? current.state : decision;
      const attempt = args.bumpAttempt ? current.attempt + 1 : current.attempt;
      /* An undefined patch field means "leave it"; spreading it would erase the
         stored value and fail the strict schema. */
      const patch = Object.fromEntries(Object.entries(args.patch ?? {}).filter(([, value]) => value !== undefined)) as Patch;
      const candidate: CrossSwapOrderRecord = {
        ...current,
        ...patch,
        version: current.version + 1,
        attempt,
        state: nextState,
        updatedAt: args.at,
        trail: decision === "SAME" ? current.trail : appendTrail({ trail: current.trail, attempt }, nextState, args.at),
      };
      const parsed = CrossSwapOrderRecordSchema.safeParse(candidate);
      if (!parsed.success) {
        refusal = { ok: false, code: "CROSS_SWAP_ORDER_UNAVAILABLE", reason: "The next order record would not be well-formed.", record: current };
        return refusal;
      }
      const won = await args.store.versioned<CrossSwapOrderRecord>(COLLECTION).compareAndSet(key, current.version, parsed.data);
      if (!won) return false;
      return { ok: true, record: parsed.data } as CrossSwapOrderResult;
    });
  } catch (error) {
    return {
      ok: false,
      code: "CROSS_SWAP_ORDER_UNAVAILABLE",
      reason: `The order could not be moved: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return refusal ?? settled;
}

/** The boundary is about to be crossed; from here value may have moved. */
export function markCrossSwapArmed(args: { store: GuardStore; intentDigest: string; at: string }): Promise<CrossSwapOrderResult> {
  return moveTo({ ...args, network: "mainnet", decide: (r) => {
    if (r.state !== "RESERVED") return null;
    if (r.provider === "RELAY" && (!Number.isFinite(Date.parse(args.at)) || Date.parse(args.at) >= r.deadlineUnix * 1000)) return null;
    return "SUBMITTED_UNKNOWN";
  } });
}

/** A status read may close only an unclaimed expired Review, atomically. */
export function expireReservedCrossSwap(args: { store: GuardStore; intentDigest: string; at: string }): Promise<CrossSwapOrderResult> {
  return moveTo({ ...args, network: "mainnet", decide: (r) =>
    r.state === "RESERVED" && Date.parse(args.at) >= r.deadlineUnix * 1000 ? "EXPIRED_BEFORE_SUBMIT" : null });
}

export function markCrossSwapSubmitted(args: { store: GuardStore; intentDigest: string; sourceTxHash: string; at: string }): Promise<CrossSwapOrderResult> {
  return moveTo({
    store: args.store,
    network: "mainnet",
    intentDigest: args.intentDigest,
    at: args.at,
    patch: { sourceTxHash: args.sourceTxHash },
    decide: (r) => (r.state === "SUBMITTED_UNKNOWN" || r.state === "RESERVED" ? "SUBMITTED" : r.state === "SUBMITTED" && r.sourceTxHash === args.sourceTxHash ? "SAME" : null),
  });
}

/** Provably never broadcast — a wallet declined before signing, or the blockhash died unsent. */
export function markCrossSwapNeverBroadcast(args: { store: GuardStore; intentDigest: string; at: string }): Promise<CrossSwapOrderResult> {
  return moveTo({ ...args, network: "mainnet", decide: (r) => (r.state === "RESERVED" || r.state === "SUBMITTED_UNKNOWN" ? "EXPIRED_BEFORE_SUBMIT" : null) });
}

/** The source transaction landed and failed on chain: nothing moved. */
export function markCrossSwapSourceFailed(args: { store: GuardStore; intentDigest: string; at: string }): Promise<CrossSwapOrderResult> {
  return moveTo({ ...args, network: "mainnet", decide: (r) => (r.state === "SUBMITTED" || r.state === "SUBMITTED_UNKNOWN" ? "SOURCE_FAILED" : null) });
}

/** Crossed, then lost — an unknown landing. Resolved by reading. */
export function markCrossSwapRecoveryRequired(args: { store: GuardStore; intentDigest: string; at: string }): Promise<CrossSwapOrderResult> {
  return moveTo({ ...args, network: "mainnet", decide: (r) => (r.state === "SUBMITTED_UNKNOWN" || r.state === "SUBMITTED" ? "RECOVERY_REQUIRED" : null) });
}

/**
 * Fold what Mayan says into the record. Terminal states are final: a later
 * read that disagrees is recorded as a check, never as a move backwards.
 */
export function applyCrossSwapProviderStatus(args: {
  store: GuardStore;
  intentDigest: string;
  status: CrossSwapProviderStatus;
  at: string;
}): Promise<CrossSwapOrderResult> {
  const status = args.status;
  const patch: Patch = {
    providerStatus: status.status,
    providerOrderId: status.orderId,
    destinationTxHash: status.destinationTxHash,
    refundTxHash: status.refundTxHash,
    receivedAmount: status.clientStatus === "COMPLETED" ? status.toAmount : undefined,
    refund: status.clientStatus === "REFUNDED" ? (status.refund ?? { chain: null, tokenAddress: null, tokenSymbol: null, amount: null }) : undefined,
    lastCheckedAt: args.at,
  };
  return moveTo({
    store: args.store,
    network: "mainnet",
    intentDigest: args.intentDigest,
    at: args.at,
    patch,
    decide: (r) => {
      if (r.state === "COMPLETED" || r.state === "REFUNDED" || r.state === "EXPIRED_BEFORE_SUBMIT" || r.state === "SOURCE_FAILED") return "SAME";
      if (r.state === "RESERVED") return null;
      if (status.clientStatus === "COMPLETED") return "COMPLETED";
      if (status.clientStatus === "REFUNDED") return "REFUNDED";
      if (status.clientStatus === "INPROGRESS") return r.state === "IN_PROGRESS" ? "SAME" : "IN_PROGRESS";
      return "SAME";
    },
  });
}

export function markCrossSwapChecked(args: { store: GuardStore; intentDigest: string; at: string }): Promise<CrossSwapOrderResult> {
  return moveTo({ store: args.store, network: "mainnet", intentDigest: args.intentDigest, at: args.at, patch: { lastCheckedAt: args.at }, decide: () => "SAME" });
}

/**
 * Attach the Cross-chain Receipt, once.
 *
 * The state does not move: a receipt is a statement *about* a finished order,
 * not a step in it. What this does enforce is that the statement is made once
 * — a second mint over the same order is refused rather than allowed to replace
 * the document the Activity row already names by hash. Minting the identical
 * hash again is idempotent and accepted, which is what makes a retried write
 * safe.
 */
export function markCrossSwapReceipted(args: {
  store: GuardStore;
  intentDigest: string;
  receiptHash: string;
  receipt: unknown;
  at: string;
}): Promise<CrossSwapOrderResult> {
  return moveTo({
    store: args.store,
    network: "mainnet",
    intentDigest: args.intentDigest,
    at: args.at,
    patch: { receiptHash: args.receiptHash, receipt: args.receipt },
    decide: (r) => (r.receiptHash === null || r.receiptHash === args.receiptHash ? "SAME" : null),
  });
}

/**
 * What a person may do from here. Never a resubmit: `mayPlanAgain` is true only
 * where the record proves nothing left the source chain.
 */
export function crossSwapRecovery(record: CrossSwapOrderRecord): Readonly<{
  mayPlanAgain: boolean;
  inMotion: boolean;
  terminal: boolean;
  needsReading: boolean;
}> {
  const mayPlanAgain = record.state === "RESERVED" || record.state === "EXPIRED_BEFORE_SUBMIT" || record.state === "SOURCE_FAILED";
  const inMotion = record.state === "SUBMITTED_UNKNOWN" || record.state === "SUBMITTED" || record.state === "IN_PROGRESS";
  const terminal = record.state === "COMPLETED" || record.state === "REFUNDED";
  return { mayPlanAgain, inMotion, terminal, needsReading: record.state === "RECOVERY_REQUIRED" || record.state === "SUBMITTED_UNKNOWN" };
}
