import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";

/**
 * Submit exactly once, and never twice.
 *
 * The guard this replaces lived in process memory. It was correct on one warm
 * instance and meaningless the moment there were two: each had its own map, so
 * a retried request could reach a second broadcast of bytes already on the
 * network. Nothing about a duplicate transfer is recoverable, so what makes
 * "once" true has to survive a cold start and a second writer.
 *
 * The rule is one-directional. The record crosses to `SUBMITTED_UNKNOWN`
 * immediately *before* the one network call, and no path in this module moves
 * it back. An attempt that never reached the network may expire; an attempt
 * that might have reached it stays reserved forever and is resolved by reading
 * its signature, never by sending again.
 *
 * Only hashes, the signature, bounded state and timestamps are stored. Never
 * the signed wire bytes, never a token name, never anything about the person.
 */

export const SEND_ATTEMPT_STATES = [
  "RESERVED",
  "SUBMITTED_UNKNOWN",
  "CONFIRMED",
  "FINALIZED",
  "LANDED_FAILED",
  "EXPIRED_BEFORE_SUBMIT",
  "EXPIRED_AFTER_SUBMIT",
  "RECOVERY_REQUIRED",
  "RECEIPTED",
] as const;
export type SendAttemptState = (typeof SEND_ATTEMPT_STATES)[number];

/** States from which nothing may be released: the bytes may already be live. */
const AFTER_SUBMIT: readonly SendAttemptState[] = [
  "SUBMITTED_UNKNOWN",
  "CONFIRMED",
  "FINALIZED",
  "LANDED_FAILED",
  "EXPIRED_AFTER_SUBMIT",
  "RECOVERY_REQUIRED",
  "RECEIPTED",
];

const HEX_DIGEST = /^0x[0-9a-f]{64}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

const SendAttemptRecordSchema = z
  .object({
    version: z.number().int().min(0),
    network: z.enum(["mainnet", "devnet"]),
    signature: z.string().regex(SIGNATURE),
    messageDigest: z.string().regex(HEX_DIGEST),
    reviewDigest: z.string().regex(HEX_DIGEST),
    state: z.enum(SEND_ATTEMPT_STATES),
    reservedAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    receiptHash: z.string().regex(HEX_DIGEST).nullable(),
  })
  .strict();

export type SendAttemptRecord = z.output<typeof SendAttemptRecordSchema>;

export type ReserveSendAttemptResult =
  | Readonly<{ ok: true; record: SendAttemptRecord; duplicate?: true }>
  | Readonly<{ ok: false; code: "SEND_ATTEMPT_CONFLICT" | "SEND_ATTEMPT_UNAVAILABLE"; reason: string }>;

export type ReadSendAttemptResult =
  | Readonly<{ ok: true; record: SendAttemptRecord }>
  | Readonly<{ ok: false; code: "SEND_ATTEMPT_ABSENT" | "SEND_ATTEMPT_UNAVAILABLE"; reason: string }>;

export type TransitionResult =
  | Readonly<{ ok: true; record: SendAttemptRecord }>
  | Readonly<{
      ok: false;
      code:
        | "SEND_ATTEMPT_ABSENT"
        | "SEND_ATTEMPT_UNAVAILABLE"
        | "SEND_ATTEMPT_TRANSITION_REFUSED"
        | "SEND_ATTEMPT_CONTENDED";
      reason: string;
    }>;

const COLLECTION = "solanaSendAttempts" as const;

/** Network and signature. The same bytes on two clusters are two attempts. */
function attemptKey(network: string, signature: string): string {
  return network.concat(":", signature);
}

async function readRecord(
  store: GuardStore,
  key: string,
): Promise<Readonly<{ found: false }> | Readonly<{ found: true; record: SendAttemptRecord }> | Readonly<{ found: "MALFORMED" }>> {
  const raw = await store.collection<unknown>(COLLECTION).get(key);
  if (raw === undefined || raw === null) return { found: false };
  const parsed = SendAttemptRecordSchema.safeParse(raw);
  /* A record that will not parse is not an empty slot. It might be a crossed
     submit boundary written by a version that stored one more field, and
     treating it as absent would authorize a second broadcast. */
  if (!parsed.success) return { found: "MALFORMED" };
  return { found: true, record: parsed.data };
}

export async function readSendAttempt(args: {
  store: GuardStore;
  network: string;
  signature: string;
}): Promise<ReadSendAttemptResult> {
  const read = await readRecord(args.store, attemptKey(args.network, args.signature));
  if (read.found === "MALFORMED") {
    return {
      ok: false,
      code: "SEND_ATTEMPT_UNAVAILABLE",
      reason: "The stored send-attempt record could not be read, so whether these bytes were submitted is not established.",
    };
  }
  if (!read.found) {
    return { ok: false, code: "SEND_ATTEMPT_ABSENT", reason: "No attempt is recorded for that signature." };
  }
  return { ok: true, record: read.record };
}

/**
 * Claim one exact signed transaction before anything can submit it.
 *
 * An identical repeat returns the existing record marked `duplicate` — a
 * retried request must not fail — while the same signature carrying a
 * different message or Review is refused outright, because those are two
 * different transactions claiming one identity.
 */
export async function reserveSendAttempt(args: {
  store: GuardStore;
  network: "mainnet" | "devnet";
  signature: string;
  messageDigest: string;
  reviewDigest: string;
  at: string;
}): Promise<ReserveSendAttemptResult> {
  const key = attemptKey(args.network, args.signature);
  const fresh: SendAttemptRecord = {
    version: 0,
    network: args.network,
    signature: args.signature,
    messageDigest: args.messageDigest,
    reviewDigest: args.reviewDigest,
    state: "RESERVED",
    reservedAt: args.at,
    updatedAt: args.at,
    receiptHash: null,
  };
  const parsed = SendAttemptRecordSchema.safeParse(fresh);
  if (!parsed.success) {
    return {
      ok: false,
      code: "SEND_ATTEMPT_UNAVAILABLE",
      reason: "The attempt to record is not a well-formed send attempt.",
    };
  }

  const won = await args.store
    .versioned<SendAttemptRecord>(COLLECTION)
    .compareAndSet(key, null, parsed.data);
  if (won) return { ok: true, record: parsed.data };

  const existing = await readRecord(args.store, key);
  if (existing.found === "MALFORMED" || !existing.found) {
    return {
      ok: false,
      code: "SEND_ATTEMPT_UNAVAILABLE",
      reason: "A send attempt already claims that signature and its record could not be read.",
    };
  }
  if (
    existing.record.messageDigest !== args.messageDigest ||
    existing.record.reviewDigest !== args.reviewDigest
  ) {
    return {
      ok: false,
      code: "SEND_ATTEMPT_CONFLICT",
      reason: "That signature is already claimed by a different reviewed transaction.",
    };
  }
  return { ok: true, record: existing.record, duplicate: true };
}

async function moveTo(args: {
  store: GuardStore;
  network: string;
  signature: string;
  at: string;
  receiptHash?: string | null;
  decide: (record: SendAttemptRecord) => SendAttemptState | null;
}): Promise<TransitionResult> {
  const key = attemptKey(args.network, args.signature);
  let refusal: TransitionResult | null = null;

  let settled: TransitionResult;
  try {
    settled = await withBoundedCasRetry(async () => {
    refusal = null;
    const read = await readRecord(args.store, key);
    if (read.found === "MALFORMED") {
      refusal = {
        ok: false,
        code: "SEND_ATTEMPT_UNAVAILABLE",
        reason: "The stored send-attempt record could not be read.",
      };
      return refusal;
    }
    if (!read.found) {
      refusal = {
        ok: false,
        code: "SEND_ATTEMPT_ABSENT",
        reason: "No attempt is recorded for that signature.",
      };
      return refusal;
    }
    const next = args.decide(read.record);
    if (next === null) {
      refusal = {
        ok: false,
        code: "SEND_ATTEMPT_TRANSITION_REFUSED",
        reason: `A send attempt in ${read.record.state} cannot move to the requested state.`,
      };
      return refusal;
    }
    if (next === read.record.state && args.receiptHash === undefined) {
      return { ok: true, record: read.record } as TransitionResult;
    }
    const updated: SendAttemptRecord = {
      ...read.record,
      version: read.record.version + 1,
      state: next,
      updatedAt: args.at,
      receiptHash: args.receiptHash === undefined ? read.record.receiptHash : args.receiptHash,
    };
    const won = await args.store
      .versioned<SendAttemptRecord>(COLLECTION)
      .compareAndSet(key, read.record.version, updated);
      if (!won) return false;
      return { ok: true, record: updated } as TransitionResult;
    });
  } catch {
    /* `withBoundedCasRetry` throws once its attempt budget is spent. An
       unbounded retry would be a request that never returns; a stated failure
       is one the caller can surface and repeat deliberately. */
    return {
      ok: false,
      code: "SEND_ATTEMPT_CONTENDED",
      reason: "The send-attempt record did not settle within its attempt budget.",
    };
  }
  return refusal ?? settled;
}

/**
 * Cross the boundary. Called immediately before the one broadcast, never after.
 *
 * Idempotent on purpose: a retried request that already crossed must not fail
 * here, and it must not broadcast either — the caller treats a crossed
 * boundary as final and switches to reading the signature.
 */
export async function markSendSubmittedUnknown(args: {
  store: GuardStore;
  network: string;
  signature: string;
  at?: string;
}): Promise<TransitionResult> {
  return moveTo({
    store: args.store,
    network: args.network,
    signature: args.signature,
    at: args.at ?? new Date().toISOString(),
    decide: (record) => {
      if (record.state === "RESERVED" || record.state === "SUBMITTED_UNKNOWN") return "SUBMITTED_UNKNOWN";
      /* Already past the boundary in a settled state: leave it exactly where
         it is rather than reopening a resolved attempt. */
      return AFTER_SUBMIT.includes(record.state) ? record.state : null;
    },
  });
}

export type SendSubmitBoundary = Readonly<{ beforeSubmit: () => Promise<void> }>;

export type SendAttemptFailure = Readonly<{
  ok: false;
  code: string;
  reason: string;
  signature: string | null;
}>;

/**
 * Run one settlement inside the durable boundary.
 *
 * The caller invokes `beforeSubmit` immediately before its single broadcast.
 * Everything after that point is one-directional: an exception, an ambiguous
 * HTTP answer or a lost connection leaves the attempt reserved and resolvable
 * by reading its signature, and no branch here releases it for a retry.
 *
 * A repeat of a signature that already crossed the boundary never reaches the
 * settle callback at all.
 */
export async function withSendAttemptBoundary<T>(args: {
  store: GuardStore;
  network: "mainnet" | "devnet";
  signature: string;
  messageDigest: string;
  reviewDigest: string;
  now?: Date;
  settle: (boundary: SendSubmitBoundary) => Promise<T>;
  onAlreadySubmitted: (record: SendAttemptRecord) => Promise<T | SendAttemptFailure> | T | SendAttemptFailure;
  onFailure: (failure: Readonly<{ code: string; reason: string; signature: string | null }>) => SendAttemptFailure;
}): Promise<T | SendAttemptFailure> {
  const at = (args.now ?? new Date()).toISOString();
  const reserved = await reserveSendAttempt({
    store: args.store,
    network: args.network,
    signature: args.signature,
    messageDigest: args.messageDigest,
    reviewDigest: args.reviewDigest,
    at,
  });
  if (!reserved.ok) {
    return args.onFailure({ code: reserved.code, reason: reserved.reason, signature: args.signature });
  }
  if (AFTER_SUBMIT.includes(reserved.record.state)) {
    /* These bytes were already handed to the network once. The only correct
       action left is to read what happened to them. */
    return args.onAlreadySubmitted(reserved.record);
  }

  let crossed = false;
  const beforeSubmit = async () => {
    if (crossed) throw new Error("The send submit boundary may be crossed only once.");
    const marked = await markSendSubmittedUnknown({
      store: args.store,
      network: args.network,
      signature: args.signature,
      at: new Date().toISOString(),
    });
    if (!marked.ok) throw new Error(`The durable send submit marker failed: ${marked.reason}`);
    crossed = true;
  };

  try {
    return await args.settle({ beforeSubmit });
  } catch (failure) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    if (!crossed) {
      await transitionSendAttempt({
        store: args.store,
        network: args.network,
        signature: args.signature,
        to: "EXPIRED_BEFORE_SUBMIT",
        at: new Date().toISOString(),
      });
      return args.onFailure({
        code: "SEND_SETTLEMENT_FAILED",
        reason: `Settlement stopped before submit: ${reason}`,
        signature: null,
      });
    }
    await transitionSendAttempt({
      store: args.store,
      network: args.network,
      signature: args.signature,
      to: "RECOVERY_REQUIRED",
      at: new Date().toISOString(),
    });
    return args.onFailure({
      code: "SUBMISSION_UNKNOWN",
      reason:
        "Settlement failed after the submit boundary. These bytes may be on the network; the attempt stays reserved and is resolved by reading its signature, never by sending again.",
      signature: args.signature,
    });
  }
}

export async function transitionSendAttempt(args: {
  store: GuardStore;
  network: string;
  signature: string;
  to: SendAttemptState;
  at: string;
  receiptHash?: string | null;
}): Promise<TransitionResult> {
  return moveTo({
    store: args.store,
    network: args.network,
    signature: args.signature,
    at: args.at,
    receiptHash: args.receiptHash,
    decide: (record) => {
      if (args.to === "RESERVED") return null;
      if (args.to === "EXPIRED_BEFORE_SUBMIT") {
        /* Only an attempt that provably never reached the network. */
        return record.state === "RESERVED" ? "EXPIRED_BEFORE_SUBMIT" : null;
      }
      if (args.to === "EXPIRED_AFTER_SUBMIT") {
        /*
         * The other half of the same truth, and the one that was missing.
         *
         * Bytes that crossed the boundary may never claim they did not, so
         * they can never reach EXPIRED_BEFORE_SUBMIT. But a broadcast whose
         * blockhash has died while the full ledger never saw its signature did
         * nothing and can never do anything: past `lastValidBlockHeight` no
         * validator will include it. With no terminal state for that, such an
         * attempt stayed unresolved forever and the lock it held never opened.
         * The record still says the bytes went out. Only the waiting ends.
         */
        return record.state === "SUBMITTED_UNKNOWN" ||
          record.state === "RECOVERY_REQUIRED" ||
          record.state === "EXPIRED_AFTER_SUBMIT"
          ? "EXPIRED_AFTER_SUBMIT"
          : null;
      }
      if (record.state === "EXPIRED_BEFORE_SUBMIT" || record.state === "EXPIRED_AFTER_SUBMIT") return null;
      return args.to;
    },
  });
}
