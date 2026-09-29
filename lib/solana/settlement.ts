/**
 * The exact reviewed-plan handoff at the sole Solana submit boundary.
 *
 * This module does not decide which network may submit; the route keeps that
 * operational gate. It proves that the signed message, plan, preflight and
 * verdict describe one immutable candidate, then orchestrates submit-once,
 * recovery-first handling, independent observation and receipt minting.
 */

import { z } from "zod";

import {
  NATIVE_SOL_TRANSFER_ACTION_REF,
  SPL_TRANSFER_ACTION_REF,
} from "../agent-control/adapters/solana-token-2022.ts";
import type { Reconciliation } from "../agent-control/reconcile.ts";
import {
  SolanaCanaryIntentSchema,
  SolanaCanaryVerdictSchema,
  verifySolanaCanaryVerdictBinding,
  type SolanaCanaryIntent,
  type SolanaCanaryVerdict,
} from "./canary-policy.ts";
import {
  SolanaPolicyVerdictSchema,
  SplTransferPreflightSchema,
  type SolanaPolicyVerdict,
  type SplTransferPreflight,
} from "./contracts.ts";
import type { ObserveResult, TransferObservation } from "./observe.ts";
import type { ReceiptMintResult } from "./outcome.ts";
import {
  SendReviewProofSchema,
  verifySendReviewProof,
  type SendReviewProof,
} from "./review-proof.ts";
import type { RecoveryFacts, SendState } from "./send-lifecycle.ts";
import { assessSendReadiness } from "./send-readiness.ts";
import { SEND_ACTION_KINDS } from "./send-kinds.ts";
import { SEND_SUPPORT_DECISIONS } from "./send-support.ts";
import { checkSignedTransfer, type SignedTransferCheck } from "./signature.ts";
import type { SubmitResult } from "./submit.ts";
import type { TransferPlan } from "./transaction.ts";
import { expectedEffectsFor } from "./outcome.ts";
import { COMPUTE_BUDGET_PROGRAM, LIGHTHOUSE_PROGRAM } from "./wallet-modification.ts";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RAW = /^(0|[1-9]\d*)$/;
const HEX_HASH = /^0x[0-9a-f]{64}$/;
const SETTLEMENT_DEADLINE = Symbol("settlement-deadline");
const ReviewProviderSchema = z
  .object({
    role: z.enum(["primary", "fallback"]),
    host: z.string().min(1).max(253),
  })
  .strict();

async function beforeSettlementDeadline<T>(
  pending: Promise<T>,
  deadlineAt: number,
): Promise<T | typeof SETTLEMENT_DEADLINE> {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) return SETTLEMENT_DEADLINE;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<typeof SETTLEMENT_DEADLINE>((resolve) => {
        timer = setTimeout(() => resolve(SETTLEMENT_DEADLINE), remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const TransferLegSchema = z
  .object({
    programAddress: z.string().regex(BASE58),
    source: z.string().regex(BASE58),
    mint: z.string().regex(BASE58),
    destination: z.string().regex(BASE58),
    authority: z.string().regex(BASE58),
    amountRaw: z.string().regex(RAW),
    decimals: z.number().int().min(0).max(255),
  })
  .strict();

const TransferFingerprintSchema = z
  .object({
    messageHash: z.string().regex(HEX_HASH),
    feePayer: z.string().regex(BASE58),
    blockhash: z.string().regex(BASE58),
    instructionCount: z.number().int().min(1).max(16),
    transfer: TransferLegSchema,
    /* One entry per transfer instruction. Fingerprinting only the first leg
       would let a wallet drop or rewrite the rest while the check passed. */
    transfers: z.array(TransferLegSchema).min(1).max(12),
  })
  .strict()
  .superRefine((fingerprint, context) => {
    const [first] = fingerprint.transfers;
    for (const [key, value] of Object.entries(fingerprint.transfer)) {
      if ((first as Record<string, unknown>)[key] !== value) {
        context.addIssue({
          code: "custom",
          path: ["transfer", key],
          message: "The single-leg projection must be the first transfer leg.",
        });
      }
    }
  });

const WalletAugmentationPlanSchema = z
  .object({
    computeUnitLimit: z.number().int().positive().max(1_400_000),
    microLamportsPerUnit: z.string().regex(RAW),
    maximumPriorityFeeLamports: z.string().regex(RAW),
    lighthouseAssertions: z
      .array(
        z
          .object({
            kind: z.enum(["ASSERT_ACCOUNT_INFO_MULTI", "ASSERT_TOKEN_ACCOUNT_MULTI"]),
            account: z.string().regex(BASE58),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();

export const TransferPlanSchema = z
  .object({
    actionKind: z.enum(SEND_ACTION_KINDS),
    network: z.enum(["mainnet", "devnet"]),
    mint: z.string().regex(BASE58),
    tokenProgram: z.string().regex(BASE58),
    decimals: z.number().int().min(0).max(255),
    sender: z.string().regex(BASE58),
    recipient: z.string().regex(BASE58),
    senderTokenAccount: z.string().regex(BASE58),
    recipientTokenAccount: z.string().regex(BASE58),
    sources: z
      .array(
        z
          .object({
            account: z.string().regex(BASE58),
            amountRaw: z.string().regex(RAW),
            feeRaw: z.string().regex(RAW),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    recipientKind: z.enum(["WALLET_OWNER", "EXISTING_TOKEN_ACCOUNT"]),
    recipientOwner: z.string().regex(BASE58),
    memo: z.string().min(1).max(566).nullable(),
    transferHook: z
      .object({
        program: z.string().regex(BASE58),
        extraAccounts: z.array(z.string().regex(BASE58)).max(32),
      })
      .strict()
      .nullable(),
    support: z
      .object({
        decision: z.enum(SEND_SUPPORT_DECISIONS),
        findings: z
          .array(
            z
              .object({
                code: z.string().min(1).max(64),
                outcome: z.enum(["PASS", "REVIEW", "BLOCK", "UNKNOWN"]),
                detail: z.string().min(1).max(512),
              })
              .strict(),
          )
          .max(32),
      })
      .strict(),
    createsRecipientAccount: z.boolean(),
    ataRentLamports: z.string().regex(RAW).nullable(),
    amountRaw: z.string().regex(RAW),
    senderBalanceRaw: z.string().regex(RAW),
    baseFeeLamports: z.string().regex(RAW),
    priorityFeeLamports: z.string().regex(RAW),
    walletAugmentation: WalletAugmentationPlanSchema.optional(),
    programs: z.array(z.string().regex(BASE58)).min(1).max(8),
    blockhash: z.string().regex(BASE58),
    lastValidBlockHeight: z.string().regex(RAW),
    unsignedWireBase64: z.string().min(64).max(8_192),
    fingerprint: TransferFingerprintSchema,
    builtAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((plan, context) => {
    const comparisons: Array<[string, unknown, unknown]> = [
      ["fingerprint.feePayer", plan.fingerprint.feePayer, plan.sender],
      ["fingerprint.blockhash", plan.fingerprint.blockhash, plan.blockhash],
      ["fingerprint.transfer.programAddress", plan.fingerprint.transfer.programAddress, plan.tokenProgram],
      ["fingerprint.transfer.source", plan.fingerprint.transfer.source, plan.senderTokenAccount],
      ["fingerprint.transfer.mint", plan.fingerprint.transfer.mint, plan.mint],
      ["fingerprint.transfer.destination", plan.fingerprint.transfer.destination, plan.recipientTokenAccount],
      ["fingerprint.transfer.authority", plan.fingerprint.transfer.authority, plan.sender],
      ["fingerprint.transfer.decimals", plan.fingerprint.transfer.decimals, plan.decimals],
      /* The first leg's source is the plan's legacy single-source field, and
         the legs together are the plan's amount. Comparing the first leg's
         amount against the whole amount was right while there was only ever
         one leg and would reject every genuine multi-source transfer. */
      ["sources[0].account", plan.sources[0].account, plan.senderTokenAccount],
      [
        "sources.amountRaw",
        plan.sources.reduce((total, source) => total + BigInt(source.amountRaw), 0n).toString(),
        plan.amountRaw,
      ],
      [
        "fingerprint.transfers.length",
        plan.fingerprint.transfers.length,
        plan.sources.length,
      ],
    ];
    for (const [field, actual, expected] of comparisons) {
      if (actual !== expected) {
        context.addIssue({
          code: "custom",
          path: field.split("."),
          message: `${field} does not match the reviewed plan.`,
        });
      }
    }
    if (plan.walletAugmentation) {
      if (plan.walletAugmentation.maximumPriorityFeeLamports !== plan.priorityFeeLamports) {
        context.addIssue({
          code: "custom",
          path: ["walletAugmentation", "maximumPriorityFeeLamports"],
          message: "Wallet augmentation priority fee must match the exact reviewed plan.",
        });
      }
      if (!plan.programs.includes(COMPUTE_BUDGET_PROGRAM)) {
        context.addIssue({
          code: "custom",
          path: ["walletAugmentation"],
          message: "Wallet augmentation requires the reviewed ComputeBudget program.",
        });
      }
      if (
        plan.walletAugmentation.lighthouseAssertions.length > 0 &&
        !plan.programs.includes(LIGHTHOUSE_PROGRAM)
      ) {
        context.addIssue({
          code: "custom",
          path: ["walletAugmentation", "lighthouseAssertions"],
          message: "Reviewed Lighthouse assertions require the Lighthouse program.",
        });
      }
    }
    if (!plan.programs.includes(plan.fingerprint.transfer.programAddress)) {
      context.addIssue({
        code: "custom",
        path: ["programs"],
        message: "The transfer program is absent from the reviewed program list.",
      });
    }
    if (
      plan.actionKind === "NATIVE_SOL" &&
      (plan.senderTokenAccount !== plan.sender ||
        plan.recipientTokenAccount !== plan.recipient ||
        plan.mint !== plan.tokenProgram)
    ) {
      context.addIssue({
        code: "custom",
        path: ["actionKind"],
        message: "A native SOL plan must bind the owner accounts and System Program directly.",
      });
    }
  });

export const SettlementRequestSchema = z
  .object({
    plan: TransferPlanSchema,
    preflight: SplTransferPreflightSchema,
    verdict: SolanaPolicyVerdictSchema,
    provider: ReviewProviderSchema,
    canaryIntent: SolanaCanaryIntentSchema,
    canaryVerdict: SolanaCanaryVerdictSchema,
    reviewProof: SendReviewProofSchema,
    signedWireBase64: z.string().min(64).max(8_192),
  })
  .strict();

export type SettlementRequest = Readonly<{
  plan: TransferPlan;
  preflight: SplTransferPreflight;
  verdict: SolanaPolicyVerdict;
  provider: z.output<typeof ReviewProviderSchema>;
  canaryIntent: SolanaCanaryIntent;
  canaryVerdict: SolanaCanaryVerdict;
  reviewProof: SendReviewProof;
  signedWireBase64: string;
}>;

export type SettlementValidationFailure = Readonly<{
  ok: false;
  code:
    | "PLAN_INVALID"
    | "PLAN_PREFLIGHT_DISAGREE"
    | "REVIEW_PROOF_INVALID"
    | "NOT_READY"
    | "SIGNED_BYTES_REJECTED";
  reason: string;
}>;

export type ValidatedSettlement = Readonly<{
  ok: true;
  plan: TransferPlan;
  preflight: SplTransferPreflight;
  verdict: SolanaPolicyVerdict;
  provider: z.output<typeof ReviewProviderSchema>;
  canaryIntent: SolanaCanaryIntent;
  canaryVerdict: SolanaCanaryVerdict;
  reviewProof: SendReviewProof;
  signedWireBase64: string;
  check: SignedTransferCheck;
}>;

export function validateSettlementCandidate(
  value: unknown,
  options?: Readonly<{ trustedPublicKey?: string }>,
): ValidatedSettlement | SettlementValidationFailure {
  const parsed = SettlementRequestSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      code: "PLAN_INVALID",
      reason: parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" · "),
    };
  }
  const request = value as SettlementRequest;
  if (!options?.trustedPublicKey) {
    return {
      ok: false,
      code: "REVIEW_PROOF_INVALID",
      reason: "No trusted issuer key is configured for the reviewed Send bundle.",
    };
  }
  const proof = verifySendReviewProof({
    bundle: {
      plan: request.plan,
      preflight: request.preflight,
      verdict: request.verdict,
      provider: request.provider,
      canaryIntent: request.canaryIntent,
      canaryVerdict: request.canaryVerdict,
    },
    proof: request.reviewProof,
    trustedPublicKey: options.trustedPublicKey,
  });
  if (!proof.ok) {
    return { ok: false, code: "REVIEW_PROOF_INVALID", reason: proof.reason };
  }
  const canaryBinding = verifySolanaCanaryVerdictBinding({
    intent: request.canaryIntent,
    verdict: request.canaryVerdict,
  });
  if (!canaryBinding.ok) {
    return { ok: false, code: "REVIEW_PROOF_INVALID", reason: canaryBinding.reason };
  }
  const expectations = expectedEffectsFor({ plan: request.plan, preflight: request.preflight });
  const reviewedNetworkFee = (
    BigInt(request.plan.baseFeeLamports) + BigInt(request.plan.priorityFeeLamports)
  ).toString();
  if (
    !expectations.ok ||
    request.preflight.sender !== request.plan.sender ||
    request.preflight.recipient !== request.plan.recipient ||
    request.preflight.networkFeeLamports !== reviewedNetworkFee
  ) {
    return {
      ok: false,
      code: "PLAN_PREFLIGHT_DISAGREE",
      reason: expectations.ok
        ? "The preflight sender, recipient or exact total network fee does not match the reviewed plan."
        : expectations.reason,
    };
  }
  /* Judged by the transfer's own proven capability. The owner-canary verdict
     is still carried on the request as M1B evidence and is no longer what
     decides whether an ordinary Send may settle. */
  const readiness = assessSendReadiness({
    plan: request.plan,
    preflight: request.preflight,
    verdict: request.verdict,
    support: request.plan.support,
    reviewProof: request.reviewProof,
    requireReviewProof: true,
  });
  if (!readiness.ready) {
    return { ok: false, code: "NOT_READY", reason: readiness.reason };
  }
  const check = checkSignedTransfer({
    plan: request.plan,
    signedWireBase64: request.signedWireBase64,
  });
  if (check.verdict !== "CLEARED") {
    return { ok: false, code: "SIGNED_BYTES_REJECTED", reason: check.detail };
  }
  return {
    ok: true,
    plan: request.plan,
    preflight: request.preflight,
    verdict: request.verdict,
    provider: request.provider,
    canaryIntent: request.canaryIntent,
    canaryVerdict: request.canaryVerdict,
    reviewProof: request.reviewProof,
    signedWireBase64: request.signedWireBase64,
    check,
  };
}

type RecoveryResult = Readonly<{
  state: SendState;
  facts: RecoveryFacts;
  effectReadback?: unknown;
}>;

export type SettlementDependencies = Readonly<{
  currentBlockHeight: () => Promise<string>;
  submit: (args: {
    plan: TransferPlan;
    check: SignedTransferCheck;
    signedWireBase64: string;
    deadlineAt: number;
  }) => Promise<SubmitResult>;
  recover: (args: {
    signature: string;
    lastValidBlockHeight: string;
    actionRef: typeof SPL_TRANSFER_ACTION_REF | typeof NATIVE_SOL_TRANSFER_ACTION_REF;
  }) => Promise<RecoveryResult>;
  observe: (args: {
    signature: string;
    actionRef: typeof SPL_TRANSFER_ACTION_REF | typeof NATIVE_SOL_TRANSFER_ACTION_REF;
  }) => Promise<ObserveResult>;
  mint: (args: {
    id: string;
    actionPassportHash: string;
    plan: TransferPlan;
    preflight: SplTransferPreflight;
    observed: TransferObservation;
    reviewDigest: string;
    finality: "confirmed" | "finalized" | "unknown";
  }) => ReceiptMintResult;
}>;

type LandingState = "CONFIRMED" | "FINALIZED" | "LANDED_FAILED";

export type SettlementResult =
  | SettlementValidationFailure
  | Readonly<{
      ok: false;
      code: string;
      reason: string;
      signature: string | null;
      landingState?: LandingState;
    }>
  | Readonly<{
      ok: true;
      state: SendState;
      landingState?: LandingState;
      signature: string;
      confirmation?: Readonly<{ slot: string; status: "confirmed" | "finalized"; err: string | null }>;
      observation?: TransferObservation["observation"];
      observedEffects?: TransferObservation["observedEffects"];
      reconciliation?: Reconciliation;
      receipt: unknown | null;
      sendReceiptFacts?: unknown;
      recovery?: RecoveryFacts;
      effectReadback?: unknown;
    }>;

export async function settleSignedTransfer(args: {
  request: unknown;
  trustedPublicKey?: string;
  deadlineAt?: number;
  dependencies: SettlementDependencies;
}): Promise<SettlementResult> {
  const deadlineAt = args.deadlineAt ?? Date.now() + 50_000;
  const validated = validateSettlementCandidate(args.request, {
    trustedPublicKey: args.trustedPublicKey,
  });
  if (!validated.ok) return validated;

  let currentBlockHeight: bigint;
  try {
    const height = await beforeSettlementDeadline(
      args.dependencies.currentBlockHeight(),
      deadlineAt,
    );
    if (height === SETTLEMENT_DEADLINE) {
      return {
        ok: false,
        code: "REQUEST_DEADLINE",
        reason: "The settlement request deadline elapsed before the pre-submit height read completed.",
        signature: null,
      };
    }
    currentBlockHeight = BigInt(height);
  } catch (failure) {
    return {
      ok: false,
      code: "CURRENT_HEIGHT_UNKNOWN",
      reason: `The current block height could not be established before submit: ${failure instanceof Error ? failure.message : String(failure)}`,
      signature: null,
    };
  }
  if (currentBlockHeight > BigInt(validated.plan.lastValidBlockHeight)) {
    return {
      ok: false,
      code: "PLAN_EXPIRED",
      reason: "The reviewed blockhash has expired. Return to Review and build a fresh message.",
      signature: null,
    };
  }

  const actionRef =
    validated.plan.actionKind === "NATIVE_SOL"
      ? NATIVE_SOL_TRANSFER_ACTION_REF
      : SPL_TRANSFER_ACTION_REF;

  const submittedBeforeDeadline = await beforeSettlementDeadline(
    args.dependencies.submit({
      plan: validated.plan,
      check: validated.check,
      signedWireBase64: validated.signedWireBase64,
      deadlineAt,
    }),
    deadlineAt,
  );
  if (submittedBeforeDeadline === SETTLEMENT_DEADLINE) {
    return {
      ok: true,
      state: "UNKNOWN",
      signature: validated.check.signature.value as string,
      receipt: null,
    };
  }
  const submitted = submittedBeforeDeadline;

  let signature: string;
  let confirmation: { slot: string; status: "confirmed" | "finalized"; err: string | null };
  let landingState: LandingState;
  if (submitted.ok) {
    signature = submitted.signature;
    confirmation = submitted.confirmation;
    landingState = confirmation.err
      ? "LANDED_FAILED"
      : confirmation.status === "finalized"
        ? "FINALIZED"
        : "CONFIRMED";
  } else if (submitted.signature) {
    signature = submitted.signature;
    const recoveredBeforeDeadline = await beforeSettlementDeadline(
      args.dependencies.recover({
        signature,
        lastValidBlockHeight: validated.plan.lastValidBlockHeight,
        actionRef,
      }),
      deadlineAt,
    );
    if (recoveredBeforeDeadline === SETTLEMENT_DEADLINE) {
      return { ok: true, state: "UNKNOWN", signature, receipt: null };
    }
    const recovered = recoveredBeforeDeadline;
    if (
      recovered.state !== "CONFIRMED" &&
      recovered.state !== "FINALIZED" &&
      recovered.state !== "LANDED_FAILED"
    ) {
      return {
        ok: true,
        state: recovered.state,
        signature,
        receipt: null,
        recovery: recovered.facts,
        effectReadback: recovered.effectReadback,
      };
    }
    landingState = recovered.state;
    const status = recovered.facts.status;
    confirmation = {
      slot: status.slot ?? "0",
      status: status.confirmationStatus === "finalized" ? "finalized" : "confirmed",
      err: status.err,
    };
  } else {
    return {
      ok: false,
      code: submitted.code,
      reason: submitted.reason,
      signature: null,
    };
  }

  const observedBeforeDeadline = await beforeSettlementDeadline(
    args.dependencies.observe({ signature, actionRef }),
    deadlineAt,
  );
  if (observedBeforeDeadline === SETTLEMENT_DEADLINE) {
    return {
      ok: true,
      state: "RECOVERY",
      landingState,
      signature,
      confirmation,
      receipt: null,
    };
  }
  const observed = observedBeforeDeadline;
  if (!observed.ok) {
    return {
      ok: true,
      state: "RECOVERY",
      landingState,
      signature,
      confirmation,
      receipt: null,
    };
  }
  const minted = args.dependencies.mint({
    id: `outcome_solana_${validated.plan.network}_${signature.slice(0, 16)}`,
    actionPassportHash: validated.reviewProof.digest,
    plan: validated.plan,
    preflight: validated.preflight,
    observed,
    reviewDigest: validated.reviewProof.digest,
    finality: confirmation.status,
  });
  if (!minted.ok) {
    return {
      ok: false,
      code: minted.code,
      reason: minted.reason,
      signature,
      landingState,
    };
  }
  return {
    ok: true,
    state: "RECEIPTED",
    landingState,
    signature,
    confirmation,
    observation: observed.observation,
    observedEffects: observed.observedEffects,
    reconciliation: minted.reconciliation,
    receipt: minted.receipt,
    sendReceiptFacts: minted.sendReceiptFacts,
  };
}
