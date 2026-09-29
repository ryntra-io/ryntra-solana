import { randomUUID } from "node:crypto";

import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";

/**
 * One claim at a time, per wallet, across tabs, instances and cold starts.
 *
 * ## Why this is a record and not a lock around a submit
 *
 * The dangerous window is not the broadcast. It is everything before it: two
 * tabs both read a $12.48 balance, both decide it is claimable, and both build
 * a payout. By the time either reaches an RPC there are two transactions for
 * one debt, with different blockhashes and different signatures, and no
 * submit-once boundary keyed by *bytes* can see that they are the same money —
 * that is exactly the defect `solanaCctpBurns` was created for on the bridge.
 *
 * So the thing that must be unique is the **claim**, not the transaction, and
 * it is claimed by a compare-and-set before anything is built. A second tab
 * finds `CLAIMING` and is told a claim is already running rather than starting
 * a second one.
 *
 * ## Why an unresolved claim never becomes a second payment
 *
 * `SUBMITTED_UNKNOWN` exists because a broadcast can fail to answer while
 * having succeeded. From there the only legal move is to *read the signature
 * back*. There is no path in this state machine from an unknown outcome to a
 * new payout, and `openClaim` refuses while one is unresolved — a person is
 * told to wait, which is annoying and correct, rather than paid twice.
 */

export const REWARD_CLAIM_STATES = [
  "CLAIMING",
  "SUBMITTED_UNKNOWN",
  "PAID",
  "FAILED",
] as const;

export type RewardClaimState = (typeof REWARD_CLAIM_STATES)[number];

/** States in which no new claim may open. */
export const REWARD_CLAIM_OPEN_STATES: readonly RewardClaimState[] = ["CLAIMING", "SUBMITTED_UNKNOWN"];

export const RewardClaimSchema = z
  .object({
    claimId: z.string().min(1).max(80),
    wallet: z.string().min(32).max(64),
    state: z.enum(REWARD_CLAIM_STATES),
    /** The exact amount this claim is for, fixed when it opened. */
    usdMicros: z.string().regex(/^[1-9][0-9]*$/),
    /** The USDC token account the payout targets. */
    destination: z.string().min(32).max(64).nullable(),
    signature: z.string().min(1).max(120).nullable(),
    openedAt: z.string().datetime({ offset: true }),
    resolvedAt: z.string().datetime({ offset: true }).nullable(),
    /** Operator-facing. Never rendered to a customer as-is. */
    note: z.string().max(400).nullable(),
    version: z.number().int().min(0),
    /** v2 persists the exact signature before any broadcast is allowed. */
    protocolVersion: z.literal(2).optional(),
    preparationExpiresAt: z.string().datetime({ offset: true }).optional(),
    blockhash: z.string().min(32).max(64).optional(),
    lastValidBlockHeight: z.string().regex(/^[0-9]+$/).optional(),
  })
  .strict();

export type RewardClaim = z.output<typeof RewardClaimSchema>;

const COLLECTION = "rewardClaims" as const;

export type OpenClaimResult =
  | Readonly<{ ok: true; claim: RewardClaim }>
  | Readonly<{ ok: false; code: "ALREADY_RUNNING" | "CONTENDED"; reason: string; claim: RewardClaim | null }>;

/** The claim currently or last recorded for this wallet. */
export async function readClaim(store: GuardStore, wallet: string): Promise<RewardClaim | null> {
  return (await store.versioned<RewardClaim>(COLLECTION).get(wallet)) ?? null;
}

/** True when a claim is still deciding and a new one must not start. */
export function claimUnresolved(claim: RewardClaim | null): boolean {
  return claim !== null && REWARD_CLAIM_OPEN_STATES.includes(claim.state);
}

/**
 * Take the claim slot, or refuse.
 *
 * The amount is fixed here rather than read again later. A claim is a promise
 * about a specific figure the person saw; re-reading the ledger mid-payout
 * would let a reward that accrued in between be paid by a transaction the
 * person never agreed to, and would make the amount depend on how long an RPC
 * took.
 */
export async function openClaim(
  store: GuardStore,
  args: Readonly<{ wallet: string; usdMicros: bigint; now: string; claimId?: string; expectedVersion?: number | null }>,
): Promise<OpenClaimResult> {
  if (args.usdMicros <= 0n) throw new Error("A claim must be for a positive amount.");
  const claims = store.versioned<RewardClaim>(COLLECTION);
  return withBoundedCasRetry<OpenClaimResult>(async () => {
    const current = await claims.get(args.wallet);
    if (args.expectedVersion !== undefined && (current?.version ?? null) !== args.expectedVersion) {
      return { ok: false, code: "CONTENDED", reason: "The claim changed after this balance was read. Refresh before claiming.", claim: current ?? null };
    }
    if (claimUnresolved(current ?? null)) {
      return {
        ok: false,
        code: "ALREADY_RUNNING",
        reason: "A claim is already running for this wallet.",
        claim: current ?? null,
      };
    }
    const claim: RewardClaim = RewardClaimSchema.parse({
      claimId: args.claimId ?? randomUUID(),
      wallet: args.wallet,
      state: "CLAIMING",
      usdMicros: args.usdMicros.toString(),
      destination: null,
      signature: null,
      openedAt: args.now,
      resolvedAt: null,
      note: null,
      version: (current?.version ?? -1) + 1,
      protocolVersion: 2,
      preparationExpiresAt: new Date(Date.parse(args.now) + 120_000).toISOString(),
    });
    const written = await claims.compareAndSet(args.wallet, current?.version ?? null, claim);
    return written ? { ok: true, claim } : false;
  });
}

const LEGAL: Readonly<Record<RewardClaimState, readonly RewardClaimState[]>> = {
  CLAIMING: ["SUBMITTED_UNKNOWN", "PAID", "FAILED"],
  /* Deliberately no route to `FAILED` without reading the chain first, and no
     route back to `CLAIMING` at all. An unknown outcome is resolved by looking,
     never by deciding. */
  SUBMITTED_UNKNOWN: ["PAID", "FAILED"],
  PAID: [],
  FAILED: [],
};

export type ClaimTransitionResult =
  | Readonly<{ ok: true; claim: RewardClaim }>
  | Readonly<{ ok: false; reason: string }>;

/** One winner stores the transaction identity before its caller may send. */
export async function armClaim(store: GuardStore, args: Readonly<{
  wallet: string; claimId: string; signature: string; destination: string;
  blockhash: string; lastValidBlockHeight: string; at: string;
}>): Promise<ClaimTransitionResult> {
  const claims = store.versioned<RewardClaim>(COLLECTION);
  return withBoundedCasRetry(async () => {
    const current = await claims.get(args.wallet);
    if (!current || current.claimId !== args.claimId || current.state !== "CLAIMING" || current.signature
      || current.protocolVersion !== 2 || !current.preparationExpiresAt || Date.parse(current.preparationExpiresAt) <= Date.parse(args.at)) {
      return { ok: false, reason: "This claim no longer permits a broadcast." } as const;
    }
    const next = RewardClaimSchema.parse({ ...current, state: "SUBMITTED_UNKNOWN", signature: args.signature,
      destination: args.destination, blockhash: args.blockhash, lastValidBlockHeight: args.lastValidBlockHeight, version: current.version + 1 });
    return await claims.compareAndSet(args.wallet, current.version, next) ? { ok: true, claim: next } as const : false;
  });
}

/** Advance a claim, refusing any move the machine does not allow. */
export async function transitionClaim(
  store: GuardStore,
  args: Readonly<{
    wallet: string;
    claimId: string;
    to: RewardClaimState;
    at: string;
    signature?: string | null;
    destination?: string | null;
    note?: string | null;
    from?: RewardClaimState;
  }>,
): Promise<ClaimTransitionResult> {
  const claims = store.versioned<RewardClaim>(COLLECTION);
  return withBoundedCasRetry<ClaimTransitionResult>(async () => {
    const current = await claims.get(args.wallet);
    if (!current) return { ok: false, reason: "There is no claim to advance for this wallet." };
    if (current.claimId !== args.claimId) {
      return { ok: false, reason: "That claim is not the one this wallet currently holds." };
    }
    if (args.from && current.state !== args.from) return { ok: false, reason: "The claim advanced while this step was pending." };
    if (current.state === args.to) return { ok: true, claim: current };
    if (!LEGAL[current.state].includes(args.to)) {
      return { ok: false, reason: `A claim cannot move from ${current.state} to ${args.to}.` };
    }
    const next = RewardClaimSchema.parse({
      ...current,
      state: args.to,
      signature: args.signature ?? current.signature,
      destination: args.destination ?? current.destination,
      note: args.note ?? current.note,
      resolvedAt: args.to === "PAID" || args.to === "FAILED" ? args.at : current.resolvedAt,
      version: current.version + 1,
    });
    const written = await claims.compareAndSet(args.wallet, current.version, next);
    return written ? { ok: true, claim: next } : false;
  });
}

/** What a customer is told about a claim, with no internal vocabulary in it. */
export function claimStatusText(
  claim: RewardClaim | null,
  locale: "en" | "uk",
): string | null {
  if (!claim) return null;
  const text: Readonly<Record<RewardClaimState, Readonly<Record<"en" | "uk", string>>>> = {
    CLAIMING: { en: "Sending your rewards…", uk: "Надсилаємо ваші винагороди…" },
    SUBMITTED_UNKNOWN: {
      en: "We are checking your payout. Do not start another one.",
      uk: "Перевіряємо стан виплати. Не починайте іншу.",
    },
    PAID: { en: "Paid to your wallet.", uk: "Виплачено на ваш гаманець." },
    FAILED: {
      en: "That payout did not go through. Your balance is unchanged and you can try again.",
      uk: "Виплата не пройшла. Ваш баланс не змінився, спробуйте ще раз.",
    },
  };
  return text[claim.state][locale];
}
