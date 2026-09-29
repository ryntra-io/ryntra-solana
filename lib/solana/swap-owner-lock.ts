/**
 * Durable one-owner / one-open-swap lock.
 *
 * Browser storage is only UX. This record is the authority that prevents a
 * new tab, closed tab or new Jupiter requestId from creating a second open
 * swap while the first Review or signature is still unresolved. It also
 * preserves the issuer-bound bundle and proof needed for read-only recovery.
 *
 * What it must never do is outlive the thing it protects. A settled swap —
 * receipted, failed, or expired before submit — is history, and holding its
 * lock forever turned "one swap at a time" into one swap per wallet, ever.
 * Those three states are replaced by the next Review; an outstanding
 * signature is not.
 */

import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { SWAP_SUBMISSION_LANES, type SwapSubmissionLane } from "./swap-submission.ts";

const COLLECTION = "solanaSwapOwnerLocks" as const;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,90}$/;
const DIGEST = /^0x[0-9a-f]{64}$/;

export const SWAP_OWNER_LOCK_STATES = [
  "REVIEW_ISSUED",
  "SIGNED",
  "SUBMITTED_UNKNOWN",
  "EXPIRED_BEFORE_SUBMIT",
  "EXPIRED_AFTER_SUBMIT",
  "FAILED",
  "RECEIPTED",
] as const;
export type SwapOwnerLockState = (typeof SWAP_OWNER_LOCK_STATES)[number];

/** A terminal owner record is history and may be archived by the next Review. */
export function isSwapOwnerLockSettled(state: SwapOwnerLockState): boolean {
  return state === "EXPIRED_BEFORE_SUBMIT" ||
    state === "EXPIRED_AFTER_SUBMIT" ||
    state === "FAILED" ||
    state === "RECEIPTED";
}

const SwapOwnerLockRecordSchema = z
  .object({
    schema: z.literal("ryntra.solana.swap-owner-lock"),
    schemaVersion: z.literal("1.0.0"),
    version: z.number().int().min(0),
    owner: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    requestId: z.string().min(1).max(128),
    messageDigest: z.string().regex(DIGEST),
    reviewDigest: z.string().regex(DIGEST),
    reviewExpiresAt: z.string().datetime({ offset: true }),
    state: z.enum(SWAP_OWNER_LOCK_STATES),
    signature: z.string().regex(BASE58).nullable(),
    submissionLane: z.enum(SWAP_SUBMISSION_LANES).nullable().default(null),
    receiptHash: z.string().regex(DIGEST).nullable(),
    receipt: z.unknown().nullable(),
    bundle: z.unknown(),
    proof: z.unknown(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type SwapOwnerLockRecord = z.output<typeof SwapOwnerLockRecordSchema>;

type Success = Readonly<{ ok: true; record: SwapOwnerLockRecord }>;
type Failure = Readonly<{
  ok: false;
  code: "OWNER_SWAP_LOCKED" | "OWNER_SWAP_LOCK_ABSENT" | "OWNER_SWAP_LOCK_MISMATCH" | "OWNER_SWAP_LOCK_UNAVAILABLE";
  reason: string;
  record?: SwapOwnerLockRecord;
}>;

function key(owner: string): string {
  return `mainnet:${owner}`;
}

/**
 * Where a settled swap's own record is kept once its slot is reused.
 *
 * The lock is keyed by owner, so the next Review overwrites the last one — and
 * the last one was the only durable copy of that swap's Receipt, bundle and
 * proof. Reusing the slot without moving the record first traded a completed
 * swap's evidence for the next one's, which is the opposite of what a ledger
 * is for. Keyed by signature, because that is what identifies a swap after the
 * fact and what `/recover` is asked about.
 */
function archiveKey(signature: string): string {
  return `mainnet:settled:${signature}`;
}

/**
 * Move a settled record out of the owner slot before it is reused.
 *
 * Additive and idempotent: `expectedVersion: null` writes only when absent, so
 * re-archiving the same swap is a no-op and a lost race is not a failure. It is
 * deliberately not fatal to the reservation that follows — a Review must not be
 * refused because an archive row already existed.
 */
async function archiveSettled(store: GuardStore, record: SwapOwnerLockRecord): Promise<void> {
  if (!record.signature) return;
  try {
    await store
      .versioned<SwapOwnerLockRecord>(COLLECTION)
      .compareAndSet(archiveKey(record.signature), null, { ...record, version: 0 });
  } catch {
    /* An archive that could not be written must not block the next swap; the
       Receipt also reached the browser and the send-attempt ledger. */
  }
}

async function readRecord(store: GuardStore, owner: string): Promise<SwapOwnerLockRecord | null | "MALFORMED"> {
  const raw = await store.collection<unknown>(COLLECTION).get(key(owner));
  if (raw === undefined || raw === null) return null;
  const parsed = SwapOwnerLockRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : "MALFORMED";
}

function unavailable(reason: string): Failure {
  return { ok: false, code: "OWNER_SWAP_LOCK_UNAVAILABLE", reason };
}

export async function readSwapOwnerLock(args: {
  store: GuardStore;
  owner: string;
}): Promise<Success | Failure> {
  const read = await readRecord(args.store, args.owner);
  if (read === "MALFORMED") return unavailable("The durable owner-swap lock is malformed.");
  if (read === null) return { ok: false, code: "OWNER_SWAP_LOCK_ABSENT", reason: "No owner-swap lock exists." };
  return { ok: true, record: read };
}

export async function reserveSwapOwnerReview(args: {
  store: GuardStore;
  owner: string;
  requestId: string;
  messageDigest: string;
  reviewDigest: string;
  reviewExpiresAt: string;
  bundle: unknown;
  proof: unknown;
  at: string;
}): Promise<Success | Failure> {
  const candidate = SwapOwnerLockRecordSchema.parse({
    schema: "ryntra.solana.swap-owner-lock",
    schemaVersion: "1.0.0",
    version: 0,
    owner: args.owner,
    requestId: args.requestId,
    messageDigest: args.messageDigest,
    reviewDigest: args.reviewDigest,
    reviewExpiresAt: args.reviewExpiresAt,
    state: "REVIEW_ISSUED",
    signature: null,
    submissionLane: null,
    receiptHash: null,
    receipt: null,
    bundle: args.bundle,
    proof: args.proof,
    createdAt: args.at,
    updatedAt: args.at,
  });
  try {
    return await withBoundedCasRetry(async () => {
      const existing = await readRecord(args.store, args.owner);
      if (existing === "MALFORMED") return unavailable("The durable owner-swap lock is malformed.");
      const replaceable = existing ? isSwapOwnerLockSettled(existing.state) : false;
      if (existing && !replaceable) {
        return {
          ok: false,
          code: "OWNER_SWAP_LOCKED",
          reason: `This owner already has an unresolved swap in ${existing.state}.`,
          record: existing,
        } as const;
      }
      /* The outgoing record is a completed swap's only durable evidence.
         Move it under its signature before the slot is reused. */
      if (existing) await archiveSettled(args.store, existing);
      const next = existing
        ? SwapOwnerLockRecordSchema.parse({
            ...candidate,
            version: existing.version + 1,
            createdAt: existing.createdAt,
          })
        : candidate;
      const won = await args.store
        .versioned<SwapOwnerLockRecord>(COLLECTION)
        .compareAndSet(key(args.owner), existing?.version ?? null, next);
      return won ? ({ ok: true, record: next } as const) : false;
    });
  } catch {
    return unavailable("The durable owner-swap lock did not settle inside its contention budget.");
  }
}

async function update(args: {
  store: GuardStore;
  owner: string;
  decide: (record: SwapOwnerLockRecord) => SwapOwnerLockRecord | Failure;
}): Promise<Success | Failure> {
  try {
    return await withBoundedCasRetry(async () => {
      const existing = await readRecord(args.store, args.owner);
      if (existing === "MALFORMED") return unavailable("The durable owner-swap lock is malformed.");
      if (!existing) return { ok: false, code: "OWNER_SWAP_LOCK_ABSENT", reason: "No owner-swap lock exists." } as const;
      const decided = args.decide(existing);
      if ("ok" in decided && decided.ok === false) return decided;
      const next = SwapOwnerLockRecordSchema.parse(decided);
      const won = await args.store
        .versioned<SwapOwnerLockRecord>(COLLECTION)
        .compareAndSet(key(args.owner), existing.version, next);
      return won ? ({ ok: true, record: next } as const) : false;
    });
  } catch {
    return unavailable("The durable owner-swap lock did not settle inside its contention budget.");
  }
}

export async function claimSwapOwnerSignature(args: {
  store: GuardStore;
  owner: string;
  requestId: string;
  messageDigest: string;
  reviewDigest: string;
  signature: string;
  at: string;
}): Promise<Success | Failure> {
  return update({
    store: args.store,
    owner: args.owner,
    decide: (record) => {
      if (
        record.requestId !== args.requestId ||
        record.messageDigest !== args.messageDigest ||
        record.reviewDigest !== args.reviewDigest
      ) {
        return { ok: false, code: "OWNER_SWAP_LOCK_MISMATCH", reason: "The signature does not match the durable exact Review.", record };
      }
      if (record.state !== "REVIEW_ISSUED" || Date.parse(args.at) >= Date.parse(record.reviewExpiresAt)) {
        return { ok: false, code: "OWNER_SWAP_LOCKED", reason: `A ${record.state} Review cannot accept a new signature.`, record };
      }
      return {
        ...record,
        version: record.version + 1,
        state: "SIGNED" as const,
        signature: args.signature,
        updatedAt: args.at,
      };
    },
  });
}

export async function markSwapOwnerSubmitted(args: {
  store: GuardStore;
  owner: string;
  signature: string;
  submissionLane: SwapSubmissionLane;
  at: string;
}): Promise<Success | Failure> {
  return update({
    store: args.store,
    owner: args.owner,
    decide: (record) => {
      if (record.signature !== args.signature || (record.state !== "SIGNED" && record.state !== "SUBMITTED_UNKNOWN")) {
        return { ok: false, code: "OWNER_SWAP_LOCK_MISMATCH", reason: "The submitted signature does not match the durable owner lock.", record };
      }
      const lane = args.submissionLane ?? "UNKNOWN";
      if (
        record.submissionLane !== null &&
        record.submissionLane !== "UNKNOWN" &&
        lane !== "UNKNOWN" &&
        record.submissionLane !== lane
      ) {
        return {
          ok: false,
          code: "OWNER_SWAP_LOCK_MISMATCH",
          reason: "The submit lane does not match the durable owner lock.",
          record,
        };
      }
      if (record.state === "SUBMITTED_UNKNOWN" && record.submissionLane === lane) return record;
      return {
        ...record,
        version: record.version + 1,
        state: "SUBMITTED_UNKNOWN" as const,
        submissionLane: record.submissionLane === null || record.submissionLane === "UNKNOWN"
          ? lane
          : record.submissionLane,
        updatedAt: args.at,
      };
    },
  });
}

export async function readSwapOwnerRecovery(args: {
  store: GuardStore;
  owner: string;
  signature: string;
}): Promise<Success | Failure> {
  const read = await readSwapOwnerLock({ store: args.store, owner: args.owner });
  if (read.ok && read.record.signature === args.signature && read.record.state !== "REVIEW_ISSUED") {
    return read;
  }
  /* The owner slot holds one swap at a time, so a signature older than the
     current Review is looked up where it was archived rather than declared a
     mismatch. Reading is by signature either way. */
  const archived = await args.store.collection<unknown>(COLLECTION).get(archiveKey(args.signature));
  const parsed = archived === undefined || archived === null ? null : SwapOwnerLockRecordSchema.safeParse(archived);
  if (parsed?.success && parsed.data.owner === args.owner && parsed.data.signature === args.signature) {
    return { ok: true, record: parsed.data };
  }
  if (!read.ok) return read;
  return {
    ok: false,
    code: "OWNER_SWAP_LOCK_MISMATCH",
    reason: "The recovery signature does not match a signed owner attempt.",
    record: read.record,
  };
}

export async function expireSwapOwnerSignature(args: {
  store: GuardStore;
  owner: string;
  signature: string;
  at: string;
}): Promise<Success | Failure> {
  return update({
    store: args.store,
    owner: args.owner,
    decide: (record) => {
      if (
        record.signature !== args.signature ||
        (record.state !== "SIGNED" && record.state !== "SUBMITTED_UNKNOWN")
      ) {
        return {
          ok: false,
          code: "OWNER_SWAP_LOCK_MISMATCH",
          reason: "Only the matching unresolved signed attempt can expire.",
          record,
        };
      }
      /*
       * Name the state after where it came from.
       *
       * A signature that never left says EXPIRED_BEFORE_SUBMIT. One that was
       * broadcast and then died unseen must not borrow that word: those bytes
       * did cross the boundary, and this record is the only place that stays
       * true about it afterwards. Both are settled, and both release the slot.
       */
      return {
        ...record,
        version: record.version + 1,
        state:
          record.state === "SUBMITTED_UNKNOWN"
            ? ("EXPIRED_AFTER_SUBMIT" as const)
            : ("EXPIRED_BEFORE_SUBMIT" as const),
        updatedAt: args.at,
      };
    },
  });
}

/**
 * Complete an explicit owner-cancel after the caller authenticated the owner
 * and independently proved the stored exact blockhash invalid. Never call
 * this from a clock-only expiry path.
 */
export async function expireUnclaimedSwapOwnerReview(args: {
  store: GuardStore;
  owner: string;
  requestId: string;
  at: string;
}): Promise<Success | Failure> {
  return update({
    store: args.store,
    owner: args.owner,
    decide: (record) => {
      if (record.state !== "REVIEW_ISSUED" || record.signature !== null || record.requestId !== args.requestId) {
        return {
          ok: false,
          code: "OWNER_SWAP_LOCK_MISMATCH",
          reason: "Only the exact unclaimed Review can be owner-cancelled.",
          record,
        };
      }
      return {
        ...record,
        version: record.version + 1,
        state: "EXPIRED_BEFORE_SUBMIT" as const,
        updatedAt: args.at,
      };
    },
  });
}

export async function completeSwapOwnerLock(args: {
  store: GuardStore;
  owner: string;
  signature: string;
  state: "FAILED" | "RECEIPTED";
  receiptHash?: string | null;
  receipt?: unknown;
  at: string;
}): Promise<Success | Failure> {
  return update({
    store: args.store,
    owner: args.owner,
    decide: (record) => {
      if (record.signature !== args.signature || record.state === "REVIEW_ISSUED" || record.state === "SIGNED") {
        return { ok: false, code: "OWNER_SWAP_LOCK_MISMATCH", reason: "The outcome does not match a submitted owner attempt.", record };
      }
      if (record.state === "RECEIPTED") {
        return record.receiptHash === (args.receiptHash ?? null) && args.state === "RECEIPTED"
          ? record
          : { ok: false, code: "OWNER_SWAP_LOCK_MISMATCH", reason: "A receipted owner lock is immutable.", record };
      }
      return {
        ...record,
        version: record.version + 1,
        state: args.state,
        receiptHash: args.state === "RECEIPTED" ? args.receiptHash ?? null : null,
        receipt: args.state === "RECEIPTED" ? args.receipt ?? null : null,
        updatedAt: args.at,
      };
    },
  });
}
