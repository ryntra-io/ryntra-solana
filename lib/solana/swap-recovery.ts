/**
 * Read-only recovery for one already-recorded Jupiter swap signature.
 *
 * This module has no submit dependency and accepts no signed transaction. It
 * verifies the issuer-bound execution bundle against the durable submit-once
 * record, reads the chain through the independent operator, reconciles what
 * landed, and mints the recovery Receipt. An unseen signature stays pending;
 * it never turns into permission for another order or `/execute` call.
 */

import { OutcomeReceiptArtifactSchema, type OutcomeReceiptArtifact } from "../agent-control/artifacts.ts";
import type { GuardStore } from "../guard/store.ts";
import { readSignatureStatus, type SignatureStatusRpcRead } from "./recover.ts";
import { type SolanaRpcHandle, withRpcDiscipline } from "./rpc.ts";
import {
  markSendSubmittedUnknown,
  readSendAttempt,
  reserveSendAttempt,
  transitionSendAttempt,
} from "./send-attempt.ts";
import {
  SwapExecutionBundleSchema,
  SwapExecutionProofSchema,
  type SwapExecutionBundle,
  type SwapExecutionProof,
  verifySwapExecutionProof,
} from "./swap-execution-review.ts";
import { observeSwap, serviceFeeReadFor, type SwapObservationResult } from "./swap-observe.ts";
import {
  completeSwapOwnerLock,
  expireUnclaimedSwapOwnerReview,
  expireSwapOwnerSignature,
  failSwapOwnerLock,
  markSwapOwnerSubmitted,
  readSwapOwnerRecovery,
  readSwapOwnerLock,
} from "./swap-owner-lock.ts";
import { mintSwapOutcomeReceipt } from "./swap-outcome.ts";
import { buildSwapReceiptFacts, parseSwapReceiptFactsFromEffects } from "./swap-receipt.ts";

/** No execution record is not evidence of non-execution: execute may still be preparing. */
export async function recoverUnrecordedSwap(args: {
  store: GuardStore;
  owner: string;
  signature: string;
  requestId?: string;
  status: SignatureStatusRpcRead;
  handle: SolanaRpcHandle;
  trustedPublicKey: string;
  dependencies?: { isBlockhashValid?: () => Promise<boolean>; readStatus?: (signature: string) => Promise<SignatureStatusRpcRead> };
}): Promise<{ state: "PENDING" | "SEEN_WITHOUT_RECORD" | "UNKNOWN_TO_CHAIN"; signature: string; reason: string }> {
  const pending = { state: "PENDING" as const, signature: args.signature, reason: "The outcome is not yet known. Keep checking this transaction; do not send another." };
  if (args.status.state !== "READ") return pending;
  if (args.status.status.seen) return {
    state: "SEEN_WITHOUT_RECORD", signature: args.signature,
    reason: "The network has seen this transaction, but its receipt is unavailable. Check the explorer.",
  };
  if (!args.requestId) return pending;
  const lock = await readSwapOwnerLock({ store: args.store, owner: args.owner });
  if (!lock.ok || lock.record.requestId !== args.requestId || lock.record.signature !== null ||
    !["REVIEW_ISSUED", "EXPIRED_BEFORE_SUBMIT"].includes(lock.record.state)) return pending;
  const bundle = SwapExecutionBundleSchema.safeParse(lock.record.bundle);
  const proof = SwapExecutionProofSchema.safeParse(lock.record.proof);
  if (!bundle.success || !proof.success || bundle.data.taker !== args.owner ||
    bundle.data.review.quote.requestId !== args.requestId ||
    lock.record.reviewDigest !== proof.data.digest || lock.record.messageDigest !== `0x${bundle.data.inspection.messageHashHex}` ||
    !verifySwapExecutionProof({ bundle: bundle.data as SwapExecutionBundle, proof: proof.data, trustedPublicKey: args.trustedPublicKey }).ok) return pending;
  let valid: unknown;
  try {
    valid = args.dependencies?.isBlockhashValid ? await args.dependencies.isBlockhashValid() :
      (await withRpcDiscipline(args.handle, (abortSignal) => args.handle.rpc
        .isBlockhashValid(bundle.data.inspection.blockhash as never, { commitment: "confirmed" }).send({ abortSignal }))).value;
  } catch { return pending; }
  // Missing/malformed RPC answers are not an invalid blockhash; a clock is not proof either.
  if (valid !== false) return pending;
  // A transaction may have landed between the first status read and the expiry read.
  const finalStatus = await (args.dependencies?.readStatus ?? ((signature: string) => readSignatureStatus(args.handle, signature)))(args.signature).catch(() => null);
  if (!finalStatus || finalStatus.state !== "READ") return pending;
  if (finalStatus.status.seen) return { state: "SEEN_WITHOUT_RECORD", signature: args.signature,
    reason: "The network has seen this transaction, but its receipt is unavailable. Check the explorer." };
  if (lock.record.state === "REVIEW_ISSUED") {
    const expired = await expireUnclaimedSwapOwnerReview({ store: args.store, owner: args.owner,
      requestId: args.requestId, at: new Date().toISOString() });
    if (!expired.ok) return pending;
  }
  return { state: "UNKNOWN_TO_CHAIN", signature: args.signature,
    reason: "The signature was not observed and the exact reviewed transaction can no longer reach the chain. Nothing was sent by this attempt." };
}

type RecoveryDependencies = Readonly<{
  readStatus?: (signature: string) => Promise<SignatureStatusRpcRead>;
  observe?: (args: {
    signature: string;
    taker: string;
    inputMint: string;
    outputMint: string;
    requiredSignatures: number;
    finality: "confirmed" | "finalized";
    serviceFee?: Readonly<{ referralAccount: string; feeMint: string }> | null;
  }) => Promise<SwapObservationResult>;
  isBlockhashValid?: () => Promise<boolean>;
  readBlockHeight?: () => Promise<string>;
}>;

/**
 * Can these bytes still land?
 *
 * Two independent answers to one question. `isBlockhashValid` is the direct
 * one. Block height against the bundle's own `lastValidBlockHeight` is the
 * arithmetic one, and it answers when the first is unavailable — a single
 * flaky read must not be able to hold a wallet unresolved forever. CLOSED is
 * not an opinion: past that height no validator will ever include them.
 */
type LandingWindow = "OPEN" | "CLOSED" | "UNKNOWN";

async function readLandingWindow(args: {
  handle: SolanaRpcHandle;
  bundle: SwapExecutionBundle;
  dependencies?: RecoveryDependencies;
}): Promise<LandingWindow> {
  try {
    const valid = args.dependencies?.isBlockhashValid
      ? await args.dependencies.isBlockhashValid()
      : (
          (
            await withRpcDiscipline(args.handle, (abortSignal) =>
              args.handle.rpc
                .isBlockhashValid(args.bundle.inspection.blockhash as never, { commitment: "confirmed" })
                .send({ abortSignal }),
            )
          ).value
        );
    if (typeof valid === "boolean") return valid ? "OPEN" : "CLOSED";
  } catch {
    /* Ask the other way rather than giving up on the question. */
  }
  try {
    const height = args.dependencies?.readBlockHeight
      ? await args.dependencies.readBlockHeight()
      : String(
          await withRpcDiscipline(args.handle, (abortSignal) =>
            args.handle.rpc.getBlockHeight({ commitment: "confirmed" }).send({ abortSignal }),
          ),
        );
    return BigInt(height) > BigInt(args.bundle.lastValidBlockHeight) ? "CLOSED" : "OPEN";
  } catch {
    return "UNKNOWN";
  }
}

/**
 * Release the wallet behind a landed failure.
 *
 * The send-attempt ledger keeps the signature `RECOVERY_REQUIRED` for its
 * fee-only evidence; the owner slot is a different thing — it says whether this
 * wallet may ask for another Review — and a failure on the ledger answers that.
 * A mismatch means the slot already moved on (archived, or a later Review),
 * and an absent slot has nothing in it; either way there is nothing left to
 * open. Any other failure is a real one.
 */
async function releaseLandedFailure(args: {
  store: GuardStore;
  bundle: SwapExecutionBundle;
  signature: string;
  now?: Date;
}): Promise<Readonly<{ code: string; reason: string }> | null> {
  const released = await failSwapOwnerLock({
    store: args.store,
    owner: args.bundle.taker,
    signature: args.signature,
    at: (args.now ?? new Date()).toISOString(),
  });
  if (released.ok || released.code === "OWNER_SWAP_LOCK_MISMATCH" || released.code === "OWNER_SWAP_LOCK_ABSENT") return null;
  return { code: released.code, reason: released.reason };
}

export type SwapRecoveryResult =
  | Readonly<{
      state: "PENDING";
      signature: string;
      reason: string;
    }>
  | Readonly<{
      state: "FAILED";
      signature: string;
      reason: string;
      chainError: string | null;
    }>
  | Readonly<{
      state: "EXPIRED_BEFORE_SUBMIT";
      signature: string;
      blockhashValid: false;
      lastValidBlockHeight: string;
    }>
  | Readonly<{
      /* Broadcast, never seen by the full ledger, and now past the height
         that could have carried it. Settled with no effect on chain. */
      state: "EXPIRED_AFTER_SUBMIT";
      signature: string;
      blockhashValid: false;
      lastValidBlockHeight: string;
    }>
  | Readonly<{
      state: "ALREADY_RECEIPTED";
      signature: string;
      receiptHash: string;
      receipt: OutcomeReceiptArtifact;
      /**
       * Contract 1.11.0, the mobile line's request 14: the chain's figures the
       * swap was reconciled on, as the fields a fresh recovery carries — read
       * back from the facts the receipt sealed, never from a second chain read.
       * Null only for a receipt that seals no facts.
       */
      observation: Extract<SwapObservationResult, { ok: true }>["observation"] | null;
      facts: ReturnType<typeof buildSwapReceiptFacts> | null;
    }>
  | Readonly<{
      state: "RECOVERED";
      signature: string;
      finality: "confirmed" | "finalized";
      observation: Extract<SwapObservationResult, { ok: true }>["observation"];
      facts: ReturnType<typeof buildSwapReceiptFacts>;
      receipt: Extract<ReturnType<typeof mintSwapOutcomeReceipt>, { ok: true }>["receipt"];
    }>
  | Readonly<{
      state: "REFUSED";
      signature: string;
      code: string;
      reason: string;
    }>;

export async function recoverSwapOutcome(args: {
  store: GuardStore;
  bundle: SwapExecutionBundle;
  proof: SwapExecutionProof;
  trustedPublicKey: string;
  signature: string;
  handle: SolanaRpcHandle;
  environment?: Record<string, string | undefined>;
  now?: Date;
  dependencies?: RecoveryDependencies;
}): Promise<SwapRecoveryResult> {
  const proofCheck = verifySwapExecutionProof({
    bundle: args.bundle,
    proof: args.proof,
    trustedPublicKey: args.trustedPublicKey,
  });
  if (!proofCheck.ok) {
    return { state: "REFUSED", signature: args.signature, code: "REVIEW_PROOF_REFUSED", reason: proofCheck.reason };
  }
  const ownerRecovery = await readSwapOwnerRecovery({
    store: args.store,
    owner: args.bundle.taker,
    signature: args.signature,
  });
  if (!ownerRecovery.ok) {
    return { state: "REFUSED", signature: args.signature, code: ownerRecovery.code, reason: ownerRecovery.reason };
  }
  if (
    ownerRecovery.record.messageDigest !== `0x${args.bundle.inspection.messageHashHex}` ||
    ownerRecovery.record.reviewDigest !== args.proof.digest
  ) {
    return {
      state: "REFUSED",
      signature: args.signature,
      code: "OWNER_SWAP_LOCK_MISMATCH",
      reason: "The durable owner recovery record belongs to a different exact Review.",
    };
  }
  if (ownerRecovery.record.state === "RECEIPTED") {
    const storedReceipt = OutcomeReceiptArtifactSchema.safeParse(ownerRecovery.record.receipt);
    if (!ownerRecovery.record.receiptHash || !storedReceipt.success || storedReceipt.data.contentHash !== ownerRecovery.record.receiptHash) {
      return {
        state: "REFUSED",
        signature: args.signature,
        code: "OWNER_SWAP_LOCK_UNAVAILABLE",
        reason: "The durable owner lock names a Receipt without its matching artifact.",
      };
    }
    const sealed = parseSwapReceiptFactsFromEffects(storedReceipt.data.outcome.observedEffects);
    return {
      state: "ALREADY_RECEIPTED",
      signature: args.signature,
      receiptHash: ownerRecovery.record.receiptHash,
      receipt: storedReceipt.data,
      /* A receipt minted before the service fee was read carries no fee figure: nothing was looked for, which is what null says. */
      observation: sealed ? { ...sealed.independentObservation, serviceFeeCollectedRaw: sealed.independentObservation.serviceFeeCollectedRaw ?? null } : null,
      facts: sealed,
    };
  }
  /* Settled as failed once, on a confirmed read, and terminal. Answered from
     the record, so a later read on an operator with a short history cannot
     turn a spent network fee into "nothing happened". */
  if (ownerRecovery.record.state === "FAILED") {
    return {
      state: "FAILED",
      signature: args.signature,
      reason: "The transaction landed and failed on chain; only the network fee was spent.",
      chainError: null,
    };
  }

  let attempt = await readSendAttempt({ store: args.store, network: "mainnet", signature: args.signature });
  let statusRead: SignatureStatusRpcRead | null = null;
  const preSubmit = !attempt.ok
    ? attempt.code === "SEND_ATTEMPT_ABSENT"
    : attempt.record.state === "RESERVED";
  if (preSubmit) {
    const readStatus = args.dependencies?.readStatus ?? ((signature: string) => readSignatureStatus(args.handle, signature));
    statusRead = await readStatus(args.signature);
    if (statusRead.state === "READ" && statusRead.status.seen) {
      if (!attempt.ok) {
        const reconstructed = await reserveSendAttempt({
          store: args.store,
          network: "mainnet",
          signature: args.signature,
          messageDigest: `0x${args.bundle.inspection.messageHashHex}`,
          reviewDigest: args.proof.digest,
          at: (args.now ?? new Date()).toISOString(),
        });
        if (!reconstructed.ok) {
          return { state: "REFUSED", signature: args.signature, code: reconstructed.code, reason: reconstructed.reason };
        }
      }
      const crossed = await markSendSubmittedUnknown({
        store: args.store,
        network: "mainnet",
        signature: args.signature,
        at: (args.now ?? new Date()).toISOString(),
      });
      if (!crossed.ok) {
        return { state: "REFUSED", signature: args.signature, code: crossed.code, reason: crossed.reason };
      }
      const ownerCrossed = await markSwapOwnerSubmitted({
        store: args.store,
        owner: args.bundle.taker,
        signature: args.signature,
        submissionLane: "UNKNOWN",
        at: (args.now ?? new Date()).toISOString(),
      });
      if (!ownerCrossed.ok) {
        return { state: "REFUSED", signature: args.signature, code: ownerCrossed.code, reason: ownerCrossed.reason };
      }
      attempt = await readSendAttempt({ store: args.store, network: "mainnet", signature: args.signature });
    } else if (statusRead.state === "READ") {
      const window = await readLandingWindow({
        handle: args.handle,
        bundle: args.bundle,
        dependencies: args.dependencies,
      });
      if (window === "UNKNOWN") {
        return { state: "PENDING", signature: args.signature, reason: "The signature is unseen and exact blockhash validity is unavailable." };
      }
      if (window === "OPEN") {
        return { state: "PENDING", signature: args.signature, reason: "The signature is unseen but its exact blockhash remains valid." };
      }
      const finalStatus = await readStatus(args.signature).catch(() => null);
      if (!finalStatus || finalStatus.state !== "READ" || finalStatus.status.seen) {
        return { state: "PENDING", signature: args.signature, reason: "The status changed or could not be read after expiry. Keep checking this signature." };
      }
      if (attempt.ok && attempt.record.state === "RESERVED") {
        const expiredAttempt = await transitionSendAttempt({
          store: args.store,
          network: "mainnet",
          signature: args.signature,
          to: "EXPIRED_BEFORE_SUBMIT",
          at: (args.now ?? new Date()).toISOString(),
        });
        if (!expiredAttempt.ok) {
          return { state: "REFUSED", signature: args.signature, code: expiredAttempt.code, reason: expiredAttempt.reason };
        }
      }
      const expiredOwner = await expireSwapOwnerSignature({
        store: args.store,
        owner: args.bundle.taker,
        signature: args.signature,
        at: (args.now ?? new Date()).toISOString(),
      });
      if (!expiredOwner.ok) {
        return { state: "REFUSED", signature: args.signature, code: expiredOwner.code, reason: expiredOwner.reason };
      }
      return {
        state: "EXPIRED_BEFORE_SUBMIT",
        signature: args.signature,
        blockhashValid: false,
        lastValidBlockHeight: args.bundle.lastValidBlockHeight,
      };
    } else {
      return { state: "PENDING", signature: args.signature, reason: "The independent signature-status read is unavailable." };
    }
  }
  if (!attempt.ok) {
    return { state: "REFUSED", signature: args.signature, code: attempt.code, reason: attempt.reason };
  }
  const expectedMessageDigest = `0x${args.bundle.inspection.messageHashHex}`;
  if (
    attempt.record.messageDigest !== expectedMessageDigest ||
    attempt.record.reviewDigest !== args.proof.digest
  ) {
    return {
      state: "REFUSED",
      signature: args.signature,
      code: "ATTEMPT_BINDING_MISMATCH",
      reason: "The durable submit record belongs to a different reviewed transaction.",
    };
  }
  if (attempt.record.state === "RECEIPTED") {
    return {
      state: "REFUSED",
      signature: args.signature,
      code: "OWNER_SWAP_LOCK_UNAVAILABLE",
      reason: "The send-attempt ledger is receipted but the durable owner artifact is unavailable.",
    };
  }
  if (attempt.record.state === "RESERVED" || attempt.record.state === "EXPIRED_BEFORE_SUBMIT") {
    return {
      state: "REFUSED",
      signature: args.signature,
      code: "SUBMIT_NOT_RECORDED",
      reason: "This attempt never crossed the durable submit boundary.",
    };
  }

  const readStatus = args.dependencies?.readStatus ?? ((signature: string) => readSignatureStatus(args.handle, signature));
  statusRead = statusRead ?? await readStatus(args.signature);
  if (statusRead.state !== "READ") {
    return { state: "PENDING", signature: args.signature, reason: "The independent signature-status read is unavailable." };
  }
  if (!statusRead.status.seen) {
    /*
     * The gap this closes.
     *
     * These bytes crossed the submit boundary, so nothing may ever record
     * that they did not — and there was no other terminal state, which left
     * every broadcast the ledger never saw pending forever, and its owner
     * locked out of the product with a Recover button that could only repeat
     * the word "yet".
     *
     * "Unseen" here is the whole ledger's answer rather than a cache's: the
     * status read searches transaction history. Put that beside a closed
     * landing window and the transaction is not undetermined, it is
     * impossible. Saying so is not a guess about what happened; it is the
     * only thing that can have happened.
     */
    const window = await readLandingWindow({
      handle: args.handle,
      bundle: args.bundle,
      dependencies: args.dependencies,
    });
    if (window !== "CLOSED") {
      return {
        state: "PENDING",
        signature: args.signature,
        reason:
          window === "OPEN"
            ? "The independent operator has not observed this signature yet, and its blockhash can still carry it."
            : "The independent operator has not observed this signature yet, and its blockhash could not be checked.",
      };
    }
    const finalStatus = await readStatus(args.signature).catch(() => null);
    if (!finalStatus || finalStatus.state !== "READ" || finalStatus.status.seen) {
      return { state: "PENDING", signature: args.signature, reason: "The status changed or could not be read after expiry. Keep checking this signature." };
    }
    const closedAttempt = await transitionSendAttempt({
      store: args.store,
      network: "mainnet",
      signature: args.signature,
      to: "EXPIRED_AFTER_SUBMIT",
      at: (args.now ?? new Date()).toISOString(),
    });
    if (!closedAttempt.ok) {
      return { state: "REFUSED", signature: args.signature, code: closedAttempt.code, reason: closedAttempt.reason };
    }
    const releasedOwner = await expireSwapOwnerSignature({
      store: args.store,
      owner: args.bundle.taker,
      signature: args.signature,
      at: (args.now ?? new Date()).toISOString(),
    });
    /* A mismatch means the live owner slot no longer belongs to this
       signature — archived, or replaced by a later Review — so there is
       nothing left to open. Any other failure is a real one. */
    if (!releasedOwner.ok && releasedOwner.code !== "OWNER_SWAP_LOCK_MISMATCH") {
      return { state: "REFUSED", signature: args.signature, code: releasedOwner.code, reason: releasedOwner.reason };
    }
    return {
      state: "EXPIRED_AFTER_SUBMIT",
      signature: args.signature,
      blockhashValid: false,
      lastValidBlockHeight: args.bundle.lastValidBlockHeight,
    };
  }
  /* One validator's view is not the cluster's: a processed failure can still be
     dropped with its fork, and the same bytes could then land. An error is
     settled here only once the cluster has confirmed it. Anything less —
     processed, or a status that names no level — is asked of the transaction
     itself at confirmed below: not there yet stays PENDING, there and failed
     is LANDED_FAILED and settles the same way. */
  const confirmedFailure =
    statusRead.status.err !== null &&
    (statusRead.status.confirmationStatus === "confirmed" || statusRead.status.confirmationStatus === "finalized");
  if (confirmedFailure) {
    const held = await transitionSendAttempt({
      store: args.store,
      network: "mainnet",
      signature: args.signature,
      to: "RECOVERY_REQUIRED",
      at: (args.now ?? new Date()).toISOString(),
    });
    const released = await releaseLandedFailure(args);
    if (released) return { state: "REFUSED", signature: args.signature, ...released };
    return {
      state: "FAILED",
      signature: args.signature,
      reason: `The signature landed with a chain error and remains ${held.ok ? held.record.state : "unresolved"} until its fee-only evidence is reconciled.`,
      chainError: statusRead.status.err,
    };
  }

  const finality = statusRead.status.confirmationStatus === "finalized" ? "finalized" : "confirmed";
  const quote = args.bundle.review.quote;
  const observe = args.dependencies?.observe ?? ((input) => observeSwap(args.handle, input));
  const observed = await observe({
    signature: args.signature,
    taker: args.bundle.taker,
    inputMint: quote.inputMint,
    outputMint: quote.outputMint,
    requiredSignatures: args.bundle.inspection.signerAddresses.length,
    finality,
    /* Recovery reads the same fee the Review promised, from the same reviewed
       quote — a recovered swap is not a swap whose earnings are unknowable. */
    serviceFee: serviceFeeReadFor(quote),
  });
  if (!observed.ok) {
    const landedFailed = observed.code === "LANDED_FAILED";
    await transitionSendAttempt({
      store: args.store,
      network: "mainnet",
      signature: args.signature,
      to: "RECOVERY_REQUIRED",
      at: (args.now ?? new Date()).toISOString(),
    });
    if (landedFailed) {
      const released = await releaseLandedFailure(args);
      if (released) return { state: "REFUSED", signature: args.signature, ...released };
    }
    return landedFailed
      ? {
          state: "FAILED",
          signature: args.signature,
          reason: observed.reason,
          chainError: observed.chainError,
        }
      : { state: "PENDING", signature: args.signature, reason: observed.reason };
  }

  /*
   * A recovery that finds the swap did exactly what was reviewed is not a
   * recovery outcome, it is a late answer to a good one. Labelling every
   * resolved read `RECOVERY` put that word on a successful trade, which reads
   * as damage. The chain's own numbers decide: the reviewed input left and at
   * least the reviewed minimum arrived, or it did not.
   */
  const asReviewed =
    observed.observation.actualInputRaw === quote.inputRaw &&
    BigInt(observed.observation.actualOutputRaw) >= BigInt(quote.minimumOutputRaw);
  const facts = buildSwapReceiptFacts({
    review: args.bundle.review,
    provider: null,
    observation: { ...observed.observation, programs: [...observed.observation.programs] },
    reconciliation: asReviewed ? "DEVIATION_RECORDED" : "RECOVERY",
  });
  const at = (args.now ?? new Date()).toISOString();
  const finalized = await transitionSendAttempt({
    store: args.store,
    network: "mainnet",
    signature: args.signature,
    to: finality === "finalized" ? "FINALIZED" : "CONFIRMED",
    at,
  });
  if (!finalized.ok) {
    return { state: "REFUSED", signature: args.signature, code: finalized.code, reason: finalized.reason };
  }

  const minted = mintSwapOutcomeReceipt({
    id: `swap:${quote.requestId}`,
    actionPassportHash: args.proof.digest,
    facts,
    submissionLane: ownerRecovery.record.submissionLane ?? "UNKNOWN",
    environment: args.environment,
    now: args.now,
  });
  if (!minted.ok) {
    const held = await transitionSendAttempt({
      store: args.store,
      network: "mainnet",
      signature: args.signature,
      to: "RECOVERY_REQUIRED",
      at,
    });
    return {
      state: "REFUSED",
      signature: args.signature,
      code: minted.code,
      reason: `${minted.reason}${held.ok ? "" : ` ${held.reason}`}`,
    };
  }

  const ownerCompleted = await completeSwapOwnerLock({
    store: args.store,
    owner: args.bundle.taker,
    signature: args.signature,
    state: "RECEIPTED",
    receiptHash: minted.receipt.contentHash,
    receipt: minted.receipt,
    at,
  });
  let receipt = minted.receipt;
  if (!ownerCompleted.ok) {
    const concurrent = await readSwapOwnerRecovery({
      store: args.store,
      owner: args.bundle.taker,
      signature: args.signature,
    });
    const stored = concurrent.ok && concurrent.record.state === "RECEIPTED"
      ? OutcomeReceiptArtifactSchema.safeParse(concurrent.record.receipt)
      : null;
    if (!concurrent.ok || !concurrent.record.receiptHash || !stored?.success || stored.data.contentHash !== concurrent.record.receiptHash) {
      return { state: "REFUSED", signature: args.signature, code: ownerCompleted.code, reason: ownerCompleted.reason };
    }
    receipt = stored.data;
  }

  const receipted = await transitionSendAttempt({
    store: args.store,
    network: "mainnet",
    signature: args.signature,
    to: "RECEIPTED",
    at,
    receiptHash: receipt.contentHash,
  });
  if (!receipted.ok) {
    return { state: "REFUSED", signature: args.signature, code: receipted.code, reason: receipted.reason };
  }

  return {
    state: "RECOVERED",
    signature: args.signature,
    finality,
    observation: observed.observation,
    facts,
    receipt,
  };
}
