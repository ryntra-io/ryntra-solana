/**
 * Expected against actual, and the receipt that records the difference.
 *
 * The expectations are derived from the **preflight and the plan**, both of
 * which exist before a signature does. That ordering is the entire value of
 * this step: `RYN-AGENT-CONTROL-007` recorded that writing the expectations
 * after seeing the result produces a prettier `MATCHED` and proves nothing.
 *
 * Two levels describe the same movement and must agree. The preflight states
 * owner-level deltas — what the sender and recipient *wallets* gain and lose —
 * because that is the sentence a person reads before approving. The chain
 * reports token-account-level deltas, because that is what actually moves. The
 * expectations here are written at the chain's level and cross-checked against
 * the preflight's amounts, so the two readings cannot silently disagree.
 *
 * Outside the public evidence kit: minting a receipt requires the issuer key,
 * and the kit's job is to verify receipts without holding anything.
 */

import { createOutcomeReceipt, type OutcomeReceiptArtifact } from "../agent-control/artifacts.ts";
import {
  NATIVE_SOL_TRANSFER_ACTION_REF,
  SOLANA_TOKEN_2022_ADAPTER_REF,
  SPL_TRANSFER_ACTION_REF,
} from "../agent-control/adapters/solana-token-2022.ts";
import { attestArtifact, loadIssuerKey } from "../agent-control/issuer.ts";
import { reconcileObservedOutcome, type Reconciliation } from "../agent-control/reconcile.ts";
import { AGENT_CONTROL_REGISTRY, registryPin } from "../agent-control/registry.ts";
import type { SplTransferPreflight } from "./contracts.ts";
import { observationChainRef, type TransferObservation } from "./observe.ts";
import {
  sendFactsFrom,
  NO_SEND_RECEIPT_AUGMENTATION,
  sendReceiptReconciliationEffects,
  sendReceiptFactsToEffects,
  type SendReceiptAugmentation,
  type SolanaSendReceiptFacts,
} from "./send-receipt.ts";
import type { TransferPlan } from "./transaction.ts";

function receiptAugmentationFrom(args: {
  plan: TransferPlan;
  observed: TransferObservation;
  explicit?: SendReceiptAugmentation;
}): SendReceiptAugmentation {
  if (args.explicit) return args.explicit;
  const augmentation = args.plan.walletAugmentation;
  if (!augmentation) return NO_SEND_RECEIPT_AUGMENTATION;

  const totalFee = BigInt(args.observed.observation.feeLamports);
  const baseFee = BigInt(args.plan.baseFeeLamports);
  if (totalFee < baseFee) {
    throw new Error("The confirmed transaction fee is below its reviewed signature fee.");
  }
  return {
    status: "PRESENT",
    summary: `Wallet augmentation reviewed: ${augmentation.computeUnitLimit} compute units at ${augmentation.microLamportsPerUnit} microLamports/CU and ${augmentation.lighthouseAssertions.length} Lighthouse assertion(s).`,
    actualPriorityFeeLamports: (totalFee - baseFee).toString(),
  };
}

export type ExpectationMismatch = Readonly<{
  ok: false;
  code: "PLAN_PREFLIGHT_DISAGREE";
  reason: string;
}>;

export type ExpectedEffects = Readonly<{ ok: true; effects: readonly string[] }>;

/**
 * The sentences this transfer is expected to produce, written before it runs.
 *
 * The chain's verdict comes first on purpose: an expectation about a balance
 * is meaningless if the transaction failed, and putting the verdict in the
 * expectation set means a failed transaction cannot reconcile as `MATCHED` by
 * accident.
 */
export function expectedEffectsFor(args: {
  plan: TransferPlan;
  preflight: SplTransferPreflight;
}): ExpectedEffects | ExpectationMismatch {
  const { plan, preflight } = args;

  if (preflight.mint !== plan.mint || preflight.network !== plan.network) {
    return {
      ok: false,
      code: "PLAN_PREFLIGHT_DISAGREE",
      reason: `The preflight covers ${preflight.mint} on ${preflight.network} while the plan builds ${plan.mint} on ${plan.network}; expectations from one cannot describe the other.`,
    };
  }
  if (preflight.amountRequestedRaw !== plan.amountRaw) {
    return {
      ok: false,
      code: "PLAN_PREFLIGHT_DISAGREE",
      reason: `The preflight previewed ${preflight.amountRequestedRaw} base units and the plan builds ${plan.amountRaw}. The two readings of one transfer must agree before any expectation is written from them.`,
    };
  }

  if (plan.actionKind === "NATIVE_SOL") {
    return {
      ok: true,
      effects: [
        `The transaction succeeded on ${plan.network}.`,
        `Account ${plan.sender} sent ${plan.amountRaw} lamports.`,
        `Account ${plan.recipient} received ${preflight.estimatedReceivedRaw} lamports.`,
      ],
    };
  }

  return {
    ok: true,
    effects: [
      `The transaction succeeded on ${plan.network}.`,
      `Account ${plan.senderTokenAccount} sent ${plan.amountRaw} base units of ${plan.mint}.`,
      `Account ${plan.recipientTokenAccount} received ${preflight.estimatedReceivedRaw} base units of ${plan.mint}.`,
    ],
  };
}

export type ReceiptMintFailure = Readonly<{
  ok: false;
  code: "NO_EXPECTATIONS" | "MINT_FAILED";
  reason: string;
}>;

export type ReceiptMintSuccess = Readonly<{
  ok: true;
  receipt: OutcomeReceiptArtifact;
  reconciliation: Reconciliation;
  sendReceiptFacts: SolanaSendReceiptFacts;
}>;

export type ReceiptMintResult = ReceiptMintSuccess | ReceiptMintFailure;

/**
 * Reconcile and mint, through the same builder and issuer every other Ryntra
 * artifact uses.
 *
 * The receipt is built **once**. `RYN-AGENT-CONTROL-007` recorded the failure
 * that makes this worth stating: a route that minted twice stamped a second
 * `createdAt`, so the artifact carried a hash the signature had never covered
 * and the live verifier returned `SIGNATURE_INVALID`. A signature is a claim
 * about exact bytes, and any field that moves between minting and signing
 * breaks it — so the unsigned mint fixes the content hash, and the signed mint
 * reuses that exact hash and the same timestamp.
 */
export function mintSolanaOutcomeReceipt(args: {
  id: string;
  actionPassportHash: string;
  plan: TransferPlan;
  preflight: SplTransferPreflight;
  observed: TransferObservation;
  /** Digest from the exact Review proof that cleared the submitted bundle. */
  reviewDigest: string;
  /** Explicit even when none; a wallet-side change must never be invisible. */
  augmentation?: SendReceiptAugmentation;
  finality?: SolanaSendReceiptFacts["finality"];
  environment?: Record<string, string | undefined>;
  now?: Date;
}): ReceiptMintResult {
  const expectations = expectedEffectsFor({ plan: args.plan, preflight: args.preflight });
  if (!expectations.ok) {
    return { ok: false, code: "NO_EXPECTATIONS", reason: expectations.reason };
  }

  const now = args.now ?? new Date();
  const observedInput = {
    /* Provisional: `reconcileObservedOutcome` decides the real status, and the
       chain's own verdict outranks the comparison inside it. */
    status: args.observed.transactionSucceeded ? ("MATCHED" as const) : ("FAILED" as const),
    chainRef: observationChainRef(args.plan.network),
    transactionHash: args.observed.observation.signature,
    observedEffects: args.observed.observedEffects.map((effect) => ({ ...effect })),
    reconciledAt: now.toISOString(),
  };

  try {
    const augmentation = receiptAugmentationFrom({
      plan: args.plan,
      observed: args.observed,
      explicit: args.augmentation,
    });
    const receiptEffects = sendReceiptReconciliationEffects({
      plan: args.plan,
      observed: args.observed,
      augmentation,
    });
    const reconciliation = reconcileObservedOutcome({
      expectedEffects: [...expectations.effects, ...receiptEffects.expected],
      observed: {
        ...observedInput,
        observedEffects: [
          ...observedInput.observedEffects,
          ...receiptEffects.observed.map((description) => ({
            description,
            sourceRef: args.observed.observation.sources[0].ref,
            observedAt: args.observed.observation.observedAt,
          })),
        ],
      },
    });
    const sendReceiptFacts = sendFactsFrom({
      plan: args.plan,
      preflight: args.preflight,
      observed: args.observed,
      finality: args.finality ?? "unknown",
      reconciliation: reconciliation.status,
      reviewDigest: args.reviewDigest,
      augmentation,
    });
    const structuredEffects = sendReceiptFactsToEffects({
      facts: sendReceiptFacts,
      sourceRef: args.observed.observation.sources[0].ref,
      observedAt: args.observed.observation.observedAt,
    });
    const outcome = {
      ...observedInput,
      status: reconciliation.status,
      observedEffects: [...observedInput.observedEffects, ...structuredEffects],
    };
    const registry = registryPin(AGENT_CONTROL_REGISTRY, [
      SOLANA_TOKEN_2022_ADAPTER_REF,
      args.plan.actionKind === "NATIVE_SOL" ? NATIVE_SOL_TRANSFER_ACTION_REF : SPL_TRANSFER_ACTION_REF,
    ]);

    const base = {
      id: args.id,
      actionPassportHash: args.actionPassportHash,
      outcome,
      registry,
      now,
    };
    const unsigned = createOutcomeReceipt(base);
    const key = loadIssuerKey(args.environment);
    const receipt = key
      ? createOutcomeReceipt({
          ...base,
          issuer: attestArtifact({
            kind: "OUTCOME_RECEIPT",
            contentHash: unsigned.contentHash,
            key,
            now,
          }),
        })
      : unsigned;

    return { ok: true, receipt, reconciliation, sendReceiptFacts };
  } catch (failure) {
    return {
      ok: false,
      code: "MINT_FAILED",
      reason: failure instanceof Error ? failure.message : String(failure),
    };
  }
}
