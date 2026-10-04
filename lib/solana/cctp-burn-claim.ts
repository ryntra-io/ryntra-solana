/**
 * Burn once for one intent, and never twice.
 *
 * The Send lane already has a durable submit-once boundary, and it is the wrong
 * shape for this one. `send-attempt.ts` keys on the transaction signature, so
 * it proves that *these exact bytes* were broadcast once. Rebuild the same
 * transfer — a fresh blockhash, a fresh ephemeral account, a different fee
 * payer — and you get different bytes, a different signature and a clean claim.
 * On Send that is tolerable: the second transfer is visible, reversible by
 * sending the money back, and the person can see both. On a CCTP burn it is
 * not. The money is destroyed on Solana against a message that mints on Base,
 * and a second burn is a second real loss with nothing on this side to undo it.
 *
 * So this boundary keys on the **intent** — who is burning, how much, to which
 * recipient, on which destination domain, at which finality — and deliberately
 * ignores everything a legitimate rebuild is allowed to change. That is the
 * property the bridge actually needs: *no duplicate burn under any
 * failure*, where "duplicate" means the same money leaving twice, not the same
 * bytes going out twice.
 *
 * ## Nothing here is ever released
 *
 * There is no path in this module that moves a claim back to a state another
 * burn could start from. An attempt that provably never reached the network can
 * expire; an attempt that might have reached it stays claimed forever and is
 * resolved by *reading* — the burn signature, then Circle's message, then the
 * destination mint — never by burning again.
 *
 * The single exception is a burn that landed on Solana **and failed**. A failed
 * transaction changes nothing: no tokens were burned and no CCTP message
 * exists, so a fresh burn is not a duplicate of anything. Even then the record
 * is not released — it moves to `BURN_REVERTED`, carrying the signature that
 * proves it, and the next claim increments an attempt counter on the same
 * record rather than starting a blank one. One intent has one durable account
 * of everything that was ever tried for it.
 *
 * Only digests, identifiers, bounded state and timestamps are stored. Never the
 * signed bytes and never a key.
 *
 * Two account addresses are the exception, and both earn their place on a lane
 * whose source is an EVM chain. The **source account** is what the release test
 * reads: an unchanged pending transaction count is the only thing that can prove
 * a declined wallet sent nothing, and it cannot be asked without knowing whose
 * count to ask about. The **destination wallet** is what the person's own
 * History row is written against, and a transfer whose second step happens in a
 * later request has nowhere else to carry it. Neither is stored on the Solana
 * lane, where the plan travels with every request that needs it.
 */

import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { CCTP_DIRECTIONS, type CctpDirection } from "./cctp-direction.ts";

export const CCTP_BURN_CLAIM_STATES = [
  /** Claimed. Nothing has been broadcast. */
  "RESERVED",
  /** The boundary was crossed. These bytes may be on the network. */
  "BURN_SUBMITTED_UNKNOWN",
  /** The burn landed and succeeded, and was read back from the cluster. */
  "BURN_CONFIRMED",
  /** Circle has signed a message for this burn. */
  "ATTESTED",
  /** The destination mint was observed on the destination chain. */
  "MINT_OBSERVED",
  /** A Bridge Receipt exists for the completed transfer. */
  "RECEIPTED",
  /** Provably never broadcast. This intent may be planned again. */
  "EXPIRED_BEFORE_BURN",
  /** Crossed, then lost. Resolve by reading; never by burning. */
  "RECOVERY_REQUIRED",
  /** The burn landed and failed on chain, so it moved nothing. */
  "BURN_REVERTED",
] as const;
export type CctpBurnClaimState = (typeof CCTP_BURN_CLAIM_STATES)[number];

/**
 * States from which no new burn may start, because value may already be gone.
 *
 * `BURN_REVERTED` is absent on purpose and `EXPIRED_BEFORE_BURN` is absent
 * because it means the bytes provably never left.
 */
const VALUE_MAY_HAVE_MOVED: readonly CctpBurnClaimState[] = [
  "BURN_SUBMITTED_UNKNOWN",
  "BURN_CONFIRMED",
  "ATTESTED",
  "MINT_OBSERVED",
  "RECEIPTED",
  "RECOVERY_REQUIRED",
];

const HEX_DIGEST = /^0x[0-9a-f]{64}$/;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const EVM_TX = /^0x[0-9a-f]{64}$/;

/**
 * A transaction on either chain.
 *
 * Both the source burn and the destination replay used to be single-chain
 * fields — a base58 signature for the burn because the burn was always on
 * Solana, a hex hash for the mint because the mint was always on Base. With two
 * directions each of them can be either, and a schema that still insisted on one
 * shape would refuse to record a real transaction that had already happened,
 * which is the worst moment to be unable to write anything down.
 */
const CHAIN_TX = z.union([z.string().regex(SOLANA_SIGNATURE), z.string().regex(EVM_TX)]);

const TrailEntrySchema = z
  .object({
    state: z.enum(CCTP_BURN_CLAIM_STATES),
    at: z.string().datetime({ offset: true }),
    attempt: z.number().int().min(1),
  })
  .strict();

const CctpBurnClaimRecordSchema = z
  .object({
    version: z.number().int().min(0),
    network: z.literal("mainnet"),
    /**
     * Which way this transfer goes.
     *
     * Defaulted rather than required, because a record written before the lane
     * had two directions is a real record of a real Solana-to-Base transfer and
     * must keep parsing. A claim that stopped parsing would read as *malformed*,
     * and this module treats malformed as "a burn may already have happened,
     * refuse everything" — which is correct behaviour and a catastrophic way to
     * greet a schema change.
     */
    direction: z.enum(CCTP_DIRECTIONS).default("SOLANA_TO_BASE"),
    /** What makes two burns the same burn. See `cctpBurnIntentDigest`. */
    intentDigest: z.string().regex(HEX_DIGEST),
    /** The issuer-signed Review this claim belongs to. */
    reviewDigest: z.string().regex(HEX_DIGEST),
    state: z.enum(CCTP_BURN_CLAIM_STATES),
    /** How many burns have been started for this intent. Visible, not hidden. */
    attempt: z.number().int().min(1),
    burnSignature: CHAIN_TX.nullable(),
    /**
     * The source account's transaction count at the moment the boundary was
     * crossed, on a lane whose source is an EVM chain.
     *
     * This is the only evidence that can prove a burn was *never broadcast*
     * after the boundary was already crossed. An EVM wallet signs and sends in
     * one step, so the boundary has to be crossed before the wallet opens; when
     * the person then declines, something has to establish that nothing left
     * the account, and a client saying so is not that something. An unchanged
     * pending transaction count, read from the chain, is.
     */
    sourceAccountNonce: z.string().regex(/^(0|[1-9][0-9]*)$/).max(20).nullable().default(null),
    /** The account the source burn is sent from, on an EVM source lane. */
    sourceAccount: z.string().regex(/^0x[0-9a-f]{40}$/).nullable().default(null),
    /** The wallet the money is going to, for the person's own History row. */
    destinationWallet: z.string().min(32).max(44).nullable().default(null),
    /**
     * The owner-canary reservation this transfer took, when it took one.
     *
     * A Solana burn reserves, broadcasts and settles inside one request and
     * never needs this. A Base burn cannot: the reservation is taken in the
     * request that arms the wallet and the outcome is only known in the one that
     * reports the transaction, so the key has to survive between them or a
     * confirmed burn would hold its reservation for ever.
     */
    canaryIdempotencyKey: z.string().min(1).max(200).nullable().default(null),
    /** The CCTP message nonce, once Circle has assigned and signed one. */
    messageNonce: z.string().regex(HEX_DIGEST).nullable(),
    /** The destination transaction that minted, once it has been observed. */
    mintTransactionHash: CHAIN_TX.nullable(),
    receiptHash: z.string().regex(HEX_DIGEST).nullable(),
    reservedAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    /* Bounded, because an unbounded audit trail inside a CAS record is a
       record that eventually cannot be written. Twenty-four entries is more
       than a canary can legitimately produce. */
    trail: z.array(TrailEntrySchema).max(24),
  })
  .strict();

export type CctpBurnClaimRecord = z.output<typeof CctpBurnClaimRecordSchema>;

export type CctpBurnClaimFailureCode =
  | "CCTP_BURN_CLAIM_CONFLICT"
  | "CCTP_BURN_CLAIM_UNAVAILABLE"
  | "CCTP_BURN_ALREADY_STARTED"
  | "CCTP_BURN_CLAIM_ABSENT"
  | "CCTP_BURN_TRANSITION_REFUSED"
  | "CCTP_BURN_CLAIM_CONTENDED";

export type ClaimCctpBurnResult =
  | Readonly<{ ok: true; record: CctpBurnClaimRecord; duplicate?: true }>
  | Readonly<{ ok: false; code: CctpBurnClaimFailureCode; reason: string; record?: CctpBurnClaimRecord }>;

export type CctpBurnTransitionResult =
  | Readonly<{ ok: true; record: CctpBurnClaimRecord }>
  | Readonly<{ ok: false; code: CctpBurnClaimFailureCode; reason: string }>;

const COLLECTION = "solanaCctpBurns" as const;

/** Network and intent. The same intent on two networks is two claims. */
export function cctpBurnClaimKey(network: string, intentDigest: string): string {
  return network.concat(":", intentDigest);
}

function appendTrail(
  record: Pick<CctpBurnClaimRecord, "trail" | "attempt">,
  state: CctpBurnClaimState,
  at: string,
): CctpBurnClaimRecord["trail"] {
  const next = [...record.trail, { state, at, attempt: record.attempt }];
  /* Keep the beginning, which is where a claim's origin is, and the end, which
     is where its present is. Dropping from the middle loses the least. */
  if (next.length <= 24) return next;
  return [...next.slice(0, 8), ...next.slice(next.length - 16)];
}

async function readRecord(
  store: GuardStore,
  key: string,
): Promise<
  | Readonly<{ found: false }>
  | Readonly<{ found: true; record: CctpBurnClaimRecord }>
  | Readonly<{ found: "MALFORMED" }>
> {
  const raw = await store.collection<unknown>(COLLECTION).get(key);
  if (raw === undefined || raw === null) return { found: false };
  const parsed = CctpBurnClaimRecordSchema.safeParse(raw);
  /* A record that will not parse is not an empty slot. It might be a crossed
     burn boundary written by a version that stored one more field, and reading
     it as absent would authorize a second burn — the one failure this whole
     module exists to make impossible. */
  if (!parsed.success) return { found: "MALFORMED" };
  return { found: true, record: parsed.data };
}

export async function readCctpBurnClaim(args: {
  store: GuardStore;
  network: "mainnet";
  intentDigest: string;
}): Promise<
  | Readonly<{ ok: true; record: CctpBurnClaimRecord }>
  | Readonly<{ ok: false; code: CctpBurnClaimFailureCode; reason: string }>
> {
  const read = await readRecord(args.store, cctpBurnClaimKey(args.network, args.intentDigest));
  if (read.found === "MALFORMED") {
    return {
      ok: false,
      code: "CCTP_BURN_CLAIM_UNAVAILABLE",
      reason:
        "The stored burn claim could not be read, so whether this intent has already burned is not established. Nothing may be burned while that is unknown.",
    };
  }
  if (!read.found) {
    return { ok: false, code: "CCTP_BURN_CLAIM_ABSENT", reason: "No burn is claimed for that intent." };
  }
  return { ok: true, record: read.record };
}

/**
 * Claim one burn intent before anything can build a transaction for it.
 *
 * An identical repeat before the boundary returns the existing record marked
 * `duplicate`, because a retried request must not fail. A claim whose value may
 * already have moved is refused outright with the record attached, so the
 * caller can show what exists rather than asking again. A different Review over
 * the same intent is a conflict: two Reviews claiming one identity is exactly
 * the ambiguity that makes a second burn look reasonable.
 */
export async function claimCctpBurn(args: {
  store: GuardStore;
  network: "mainnet";
  direction?: CctpDirection;
  intentDigest: string;
  reviewDigest: string;
  sourceAccount?: string | null;
  sourceAccountNonce?: string | null;
  destinationWallet?: string | null;
  at: string;
}): Promise<ClaimCctpBurnResult> {
  const key = cctpBurnClaimKey(args.network, args.intentDigest);
  const fresh: CctpBurnClaimRecord = {
    version: 0,
    network: args.network,
    direction: args.direction ?? "SOLANA_TO_BASE",
    intentDigest: args.intentDigest,
    reviewDigest: args.reviewDigest,
    state: "RESERVED",
    attempt: 1,
    burnSignature: null,
    sourceAccount: args.sourceAccount ?? null,
    sourceAccountNonce: args.sourceAccountNonce ?? null,
    destinationWallet: args.destinationWallet ?? null,
    canaryIdempotencyKey: null,
    messageNonce: null,
    mintTransactionHash: null,
    receiptHash: null,
    reservedAt: args.at,
    updatedAt: args.at,
    trail: [{ state: "RESERVED", at: args.at, attempt: 1 }],
  };
  const parsed = CctpBurnClaimRecordSchema.safeParse(fresh);
  if (!parsed.success) {
    return {
      ok: false,
      code: "CCTP_BURN_CLAIM_UNAVAILABLE",
      reason: "The claim to record is not a well-formed CCTP burn claim.",
    };
  }

  const won = await args.store.versioned<CctpBurnClaimRecord>(COLLECTION).compareAndSet(key, null, parsed.data);
  if (won) return { ok: true, record: parsed.data };

  const existing = await readRecord(args.store, key);
  if (existing.found === "MALFORMED" || !existing.found) {
    return {
      ok: false,
      code: "CCTP_BURN_CLAIM_UNAVAILABLE",
      reason: "A burn already claims that intent and its record could not be read.",
    };
  }
  const record = existing.record;

  if (VALUE_MAY_HAVE_MOVED.includes(record.state)) {
    return {
      ok: false,
      code: "CCTP_BURN_ALREADY_STARTED",
      reason: `A burn for this intent is already in ${record.state}. Value may already have left Solana; resolve it by reading the burn, the message and the destination mint. A second burn is never a recovery action.`,
      record,
    };
  }
  if (record.reviewDigest !== args.reviewDigest && record.state !== "BURN_REVERTED") {
    return {
      ok: false,
      code: "CCTP_BURN_CLAIM_CONFLICT",
      reason: "That intent is already claimed by a different reviewed bridge transfer.",
      record,
    };
  }
  if (record.state === "RESERVED") return { ok: true, record, duplicate: true };

  /* The two states a new burn may legitimately follow: one that provably never
     reached the network, and one the chain itself says moved nothing. The
     record is not replaced — the attempt counter moves and the trail keeps
     everything that came before. */
  return moveTo({
    store: args.store,
    network: args.network,
    intentDigest: args.intentDigest,
    at: args.at,
    patch: {
      reviewDigest: args.reviewDigest,
      burnSignature: null,
      messageNonce: null,
      mintTransactionHash: null,
      sourceAccount: args.sourceAccount ?? null,
      sourceAccountNonce: args.sourceAccountNonce ?? null,
      destinationWallet: args.destinationWallet ?? null,
      canaryIdempotencyKey: null,
    },
    bumpAttempt: true,
    decide: (current) =>
      current.state === "EXPIRED_BEFORE_BURN" || current.state === "BURN_REVERTED" ? "RESERVED" : null,
  });
}

async function moveTo(args: {
  store: GuardStore;
  network: string;
  intentDigest: string;
  at: string;
  patch?: Partial<
    Pick<
      CctpBurnClaimRecord,
      | "burnSignature"
      | "messageNonce"
      | "mintTransactionHash"
      | "receiptHash"
      | "reviewDigest"
      | "sourceAccount"
      | "sourceAccountNonce"
      | "destinationWallet"
      | "canaryIdempotencyKey"
    >
  >;
  bumpAttempt?: boolean;
  decide: (record: CctpBurnClaimRecord) => CctpBurnClaimState | null;
}): Promise<CctpBurnTransitionResult> {
  const key = cctpBurnClaimKey(args.network, args.intentDigest);
  let refusal: CctpBurnTransitionResult | null = null;

  let settled: CctpBurnTransitionResult;
  try {
    settled = await withBoundedCasRetry(async () => {
      refusal = null;
      const read = await readRecord(args.store, key);
      if (read.found === "MALFORMED") {
        refusal = {
          ok: false,
          code: "CCTP_BURN_CLAIM_UNAVAILABLE",
          reason: "The stored burn claim could not be read.",
        };
        return refusal;
      }
      if (!read.found) {
        refusal = { ok: false, code: "CCTP_BURN_CLAIM_ABSENT", reason: "No burn is claimed for that intent." };
        return refusal;
      }
      const next = args.decide(read.record);
      if (next === null) {
        refusal = {
          ok: false,
          code: "CCTP_BURN_TRANSITION_REFUSED",
          reason: `A burn claim in ${read.record.state} cannot move to the requested state.`,
        };
        return refusal;
      }
      const attempt = args.bumpAttempt ? read.record.attempt + 1 : read.record.attempt;
      const updated: CctpBurnClaimRecord = {
        ...read.record,
        ...args.patch,
        version: read.record.version + 1,
        state: next,
        attempt,
        updatedAt: args.at,
        trail: appendTrail({ trail: read.record.trail, attempt }, next, args.at),
      };
      const parsed = CctpBurnClaimRecordSchema.safeParse(updated);
      if (!parsed.success) {
        refusal = {
          ok: false,
          code: "CCTP_BURN_TRANSITION_REFUSED",
          reason: "The requested state needs evidence the claim does not carry.",
        };
        return refusal;
      }
      const won = await args.store
        .versioned<CctpBurnClaimRecord>(COLLECTION)
        .compareAndSet(key, read.record.version, parsed.data);
      if (!won) return false;
      return { ok: true, record: parsed.data } as CctpBurnTransitionResult;
    });
  } catch {
    return {
      ok: false,
      code: "CCTP_BURN_CLAIM_CONTENDED",
      reason: "The burn claim did not settle within its attempt budget.",
    };
  }
  return refusal ?? settled;
}

/**
 * Cross the boundary. Called immediately before the one broadcast, never after.
 *
 * Idempotent: a retried request that already crossed must not fail here, and it
 * must not broadcast either — the caller treats a crossed boundary as final and
 * switches to reading.
 */
export async function markCctpBurnSubmitted(args: {
  store: GuardStore;
  network: "mainnet";
  intentDigest: string;
  signature: string;
  at?: string;
}): Promise<CctpBurnTransitionResult> {
  return moveTo({
    store: args.store,
    network: args.network,
    intentDigest: args.intentDigest,
    at: args.at ?? new Date().toISOString(),
    patch: { burnSignature: args.signature },
    decide: (record) => {
      if (record.state === "RESERVED" || record.state === "BURN_SUBMITTED_UNKNOWN") return "BURN_SUBMITTED_UNKNOWN";
      /* Already past the boundary and settled: leave it exactly where it is
         rather than reopening a resolved burn. */
      return VALUE_MAY_HAVE_MOVED.includes(record.state) ? record.state : null;
    },
  });
}

/**
 * Cross the boundary before an EVM wallet opens, with no signature to name yet.
 *
 * On a Solana source the browser signs first and hands back finished bytes, so
 * the boundary can be crossed with the exact transaction id it is about. An EVM
 * wallet does not work that way: `eth_sendTransaction` signs *and broadcasts* in
 * one call, and by the time a hash comes back the money has already left. There
 * is no moment between the two to hold a claim in.
 *
 * So the claim is crossed first, deliberately, without a hash. The cost of that
 * is a claim held for a burn that may never have happened; the cost of the
 * alternative is a second real burn, and only one of those is recoverable. What
 * makes the first cost bearable is `markCctpBurnNeverBroadcast`, which can
 * release it — but only on evidence read from the chain.
 */
export async function markCctpSourceArmed(args: {
  store: GuardStore;
  network: "mainnet";
  intentDigest: string;
  sourceAccount: string;
  sourceAccountNonce: string;
  destinationWallet?: string | null;
  canaryIdempotencyKey?: string | null;
  at?: string;
}): Promise<CctpBurnTransitionResult> {
  return moveTo({
    store: args.store,
    network: args.network,
    intentDigest: args.intentDigest,
    at: args.at ?? new Date().toISOString(),
    patch: {
      sourceAccount: args.sourceAccount,
      sourceAccountNonce: args.sourceAccountNonce,
      ...(args.destinationWallet === undefined ? {} : { destinationWallet: args.destinationWallet }),
      ...(args.canaryIdempotencyKey === undefined ? {} : { canaryIdempotencyKey: args.canaryIdempotencyKey }),
    },
    decide: (record) => {
      if (record.state === "RESERVED" || record.state === "BURN_SUBMITTED_UNKNOWN") return "BURN_SUBMITTED_UNKNOWN";
      return VALUE_MAY_HAVE_MOVED.includes(record.state) ? record.state : null;
    },
  });
}

/**
 * The wallet was armed and nothing was ever broadcast, proved by the chain.
 *
 * The second and last door back to a burnable state, and it is narrower than it
 * looks. It is reachable only from a crossed boundary that never learned a
 * transaction id, and only when the caller can show that the source account's
 * pending transaction count is exactly what it was when the claim was armed. An
 * account that has sent *anything* since — the burn, or something unrelated —
 * fails that test and the claim stays held, which is the conservative answer and
 * the right one.
 *
 * `observedNonce` must come from a chain read the caller actually performed. A
 * caller that could assert this without evidence would be able to release its
 * own boundary and burn again, which is the whole failure this module exists to
 * prevent.
 */
export async function markCctpBurnNeverBroadcast(args: {
  store: GuardStore;
  network: "mainnet";
  intentDigest: string;
  observedNonce: string;
  at?: string;
}): Promise<CctpBurnTransitionResult> {
  return moveTo({
    store: args.store,
    network: args.network,
    intentDigest: args.intentDigest,
    at: args.at ?? new Date().toISOString(),
    decide: (record) => {
      if (record.state !== "BURN_SUBMITTED_UNKNOWN") return null;
      if (record.burnSignature !== null) return null;
      if (record.sourceAccountNonce === null) return null;
      return record.sourceAccountNonce === args.observedNonce ? "EXPIRED_BEFORE_BURN" : null;
    },
  });
}

/** The burn landed and succeeded, read back from the cluster. */
export async function markCctpBurnConfirmed(args: {
  store: GuardStore;
  network: "mainnet";
  intentDigest: string;
  at?: string;
}): Promise<CctpBurnTransitionResult> {
  return moveTo({
    store: args.store,
    network: args.network,
    intentDigest: args.intentDigest,
    at: args.at ?? new Date().toISOString(),
    decide: (record) =>
      record.state === "BURN_SUBMITTED_UNKNOWN" || record.state === "RECOVERY_REQUIRED" ? "BURN_CONFIRMED" : null,
  });
}

/** Circle signed a message for this burn. Binds the nonce that the mint replays against. */
export async function markCctpAttested(args: {
  store: GuardStore;
  network: "mainnet";
  intentDigest: string;
  messageNonce: string;
  at?: string;
}): Promise<CctpBurnTransitionResult> {
  return moveTo({
    store: args.store,
    network: args.network,
    intentDigest: args.intentDigest,
    at: args.at ?? new Date().toISOString(),
    patch: { messageNonce: args.messageNonce },
    decide: (record) =>
      record.state === "BURN_CONFIRMED" || record.state === "ATTESTED" || record.state === "RECOVERY_REQUIRED"
        ? "ATTESTED"
        : null,
  });
}

/** The destination mint was observed. */
export async function markCctpMintObserved(args: {
  store: GuardStore;
  network: "mainnet";
  intentDigest: string;
  mintTransactionHash: string | null;
  at?: string;
}): Promise<CctpBurnTransitionResult> {
  return moveTo({
    store: args.store,
    network: args.network,
    intentDigest: args.intentDigest,
    at: args.at ?? new Date().toISOString(),
    patch: { mintTransactionHash: args.mintTransactionHash },
    decide: (record) =>
      record.state === "ATTESTED" || record.state === "MINT_OBSERVED" || record.state === "RECOVERY_REQUIRED"
        ? "MINT_OBSERVED"
        : null,
  });
}

/** A Bridge Receipt exists. The terminal happy state. */
export async function markCctpReceipted(args: {
  store: GuardStore;
  network: "mainnet";
  intentDigest: string;
  receiptHash: string;
  at?: string;
}): Promise<CctpBurnTransitionResult> {
  return moveTo({
    store: args.store,
    network: args.network,
    intentDigest: args.intentDigest,
    at: args.at ?? new Date().toISOString(),
    patch: { receiptHash: args.receiptHash },
    decide: (record) => (record.state === "MINT_OBSERVED" || record.state === "RECEIPTED" ? "RECEIPTED" : null),
  });
}

/**
 * The burn landed on Solana and failed.
 *
 * The only door back to a burnable state, and it is narrow on purpose. A failed
 * transaction reverts every state change: no tokens left the account and no
 * CCTP message was emitted, so a fresh burn is not a duplicate of anything. The
 * signature that proves it is required and stored, the attempt counter moves,
 * and the trail keeps the reverted attempt where anyone can see it.
 */
export async function markCctpBurnReverted(args: {
  store: GuardStore;
  network: "mainnet";
  intentDigest: string;
  signature: string;
  at?: string;
}): Promise<CctpBurnTransitionResult> {
  return moveTo({
    store: args.store,
    network: args.network,
    intentDigest: args.intentDigest,
    at: args.at ?? new Date().toISOString(),
    patch: { burnSignature: args.signature },
    decide: (record) => {
      /* Reachable only from states where bytes went out and nothing has been
         attested. Once Circle has signed a message, the burn provably
         succeeded and calling it reverted would be a lie the chain refutes. */
      if (record.state === "BURN_SUBMITTED_UNKNOWN" || record.state === "RECOVERY_REQUIRED") return "BURN_REVERTED";
      return record.state === "BURN_REVERTED" ? "BURN_REVERTED" : null;
    },
  });
}

export type CctpBurnBoundary = Readonly<{ beforeBurn: (signature: string) => Promise<void> }>;

export type CctpBurnBoundaryFailure = Readonly<{
  ok: false;
  code: string;
  reason: string;
  signature: string | null;
  /**
   * The claim as it stands, when one exists.
   *
   * Carried so a caller refusing a second burn can show what already happened
   * instead of asking the person to trust the refusal. A failure before any
   * claim exists has nothing to show, and says so with null.
   */
  record?: CctpBurnClaimRecord | null;
}>;

/**
 * Run one burn inside the durable boundary.
 *
 * The caller invokes `beforeBurn` immediately before its single broadcast.
 * Everything after that point is one-directional: an exception, an ambiguous
 * HTTP answer or a lost connection leaves the claim held and resolvable by
 * reading, and no branch here releases it.
 */
export async function withCctpBurnBoundary<T>(args: {
  store: GuardStore;
  network: "mainnet";
  direction?: CctpDirection;
  intentDigest: string;
  reviewDigest: string;
  now?: Date;
  burn: (boundary: CctpBurnBoundary) => Promise<T>;
  onAlreadyStarted: (record: CctpBurnClaimRecord) => Promise<T | CctpBurnBoundaryFailure> | T | CctpBurnBoundaryFailure;
  onFailure: (failure: Readonly<{ code: string; reason: string; signature: string | null }>) => CctpBurnBoundaryFailure;
}): Promise<T | CctpBurnBoundaryFailure> {
  const at = (args.now ?? new Date()).toISOString();
  const claimed = await claimCctpBurn({
    store: args.store,
    network: args.network,
    direction: args.direction,
    intentDigest: args.intentDigest,
    reviewDigest: args.reviewDigest,
    at,
  });
  if (!claimed.ok) {
    if (claimed.code === "CCTP_BURN_ALREADY_STARTED" && claimed.record) {
      return args.onAlreadyStarted(claimed.record);
    }
    return args.onFailure({ code: claimed.code, reason: claimed.reason, signature: null });
  }

  let crossed: string | null = null;
  const beforeBurn = async (signature: string) => {
    if (crossed !== null) throw new Error("The CCTP burn boundary may be crossed only once.");
    const marked = await markCctpBurnSubmitted({
      store: args.store,
      network: args.network,
      intentDigest: args.intentDigest,
      signature,
      at: new Date().toISOString(),
    });
    if (!marked.ok) throw new Error(`The durable burn marker failed: ${marked.reason}`);
    crossed = signature;
  };

  try {
    return await args.burn({ beforeBurn });
  } catch (failure) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    if (crossed === null) {
      await moveTo({
        store: args.store,
        network: args.network,
        intentDigest: args.intentDigest,
        at: new Date().toISOString(),
        decide: (record) => (record.state === "RESERVED" ? "EXPIRED_BEFORE_BURN" : null),
      });
      return args.onFailure({
        code: "CCTP_BURN_FAILED_BEFORE_BOUNDARY",
        reason: `The bridge transfer stopped before the burn was broadcast: ${reason}`,
        signature: null,
      });
    }
    await moveTo({
      store: args.store,
      network: args.network,
      intentDigest: args.intentDigest,
      at: new Date().toISOString(),
      decide: (record) => (record.state === "BURN_SUBMITTED_UNKNOWN" ? "RECOVERY_REQUIRED" : null),
    });
    return args.onFailure({
      code: "CCTP_BURN_UNKNOWN",
      reason:
        "The bridge transfer failed after the burn boundary. Those bytes may be on Solana; the claim stays held and is resolved by reading the burn, then Circle's message, then the destination mint. A second burn is never a recovery action.",
      signature: crossed,
    });
  }
}

/**
 * What a held claim says a person should do next.
 *
 * One function, so no surface has to reconstruct the rule, and every branch
 * answers the same two questions: where the value is, and whether burning
 * again is permitted. Only two states answer yes, and both of them mean the
 * money never left.
 */
export function cctpBurnRecovery(record: CctpBurnClaimRecord): Readonly<{
  action: string;
  whereValueIs: string;
  burnAgainPermitted: boolean;
}> {
  /* The source chain is a fact of the record, not of whichever file is asking.
     A recovery line that named Solana on a Base-source transfer would send a
     person to look for their money on the chain it never left from. */
  const sourceChain =
    record.direction === "SOLANA_TO_BASE" || record.direction === "SOLANA_TO_ETHEREUM"
      ? "SOLANA"
      : record.direction === "ETHEREUM_TO_SOLANA"
        ? "ETHEREUM"
        : "BASE";
  switch (record.state) {
    case "RESERVED":
      return { action: "CONTINUE_TO_REVIEW", whereValueIs: "SOURCE_WALLET_UNTOUCHED", burnAgainPermitted: false };
    case "EXPIRED_BEFORE_BURN":
      return { action: "PLAN_A_FRESH_TRANSFER", whereValueIs: "SOURCE_WALLET_UNTOUCHED", burnAgainPermitted: true };
    case "BURN_REVERTED":
      return {
        action: "PLAN_A_FRESH_TRANSFER",
        whereValueIs: "SOURCE_WALLET_UNTOUCHED_THE_BURN_LANDED_AND_FAILED",
        burnAgainPermitted: true,
      };
    case "BURN_SUBMITTED_UNKNOWN":
      return {
        action: `READ_THE_BURN_SIGNATURE_ON_${sourceChain}`,
        whereValueIs: "SOURCE_TRANSACTION_EXISTS_OR_MAY_EXIST",
        burnAgainPermitted: false,
      };
    case "BURN_CONFIRMED":
      return {
        action: "ASK_CIRCLE_FOR_THE_MESSAGE_AND_ATTESTATION",
        whereValueIs: "BURNED_AT_SOURCE_AWAITING_ATTESTATION",
        burnAgainPermitted: false,
      };
    case "ATTESTED":
      return {
        action: "COMPLETE_THE_DESTINATION_MINT_WITH_THE_EXISTING_ATTESTATION",
        whereValueIs: "BURNED_AT_SOURCE_ATTESTATION_HELD",
        burnAgainPermitted: false,
      };
    case "RECOVERY_REQUIRED":
      return {
        action: "INSPECT_BURN_THEN_MESSAGE_THEN_DESTINATION_MINT",
        whereValueIs: "UNKNOWN_VALUE_MAY_HAVE_LEFT_SOURCE",
        burnAgainPermitted: false,
      };
    case "MINT_OBSERVED":
      return { action: "ISSUE_THE_BRIDGE_RECEIPT", whereValueIs: "DESTINATION_WALLET_OBSERVED", burnAgainPermitted: false };
    case "RECEIPTED":
      return { action: "NONE_REQUIRED", whereValueIs: "DESTINATION_WALLET_OBSERVED", burnAgainPermitted: false };
  }
}
