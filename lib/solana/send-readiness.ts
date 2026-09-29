/**
 * One gate between Review and a wallet signature.
 *
 * M0C keeps mainnet signing closed, but M1 must not be able to open it by
 * flipping one network constant while simulation, policy or fee evidence is
 * incomplete. This pure decision is shared by the UI and settlement tests.
 */

import type { SolanaPolicyVerdict, SplTransferPreflight } from "./contracts.ts";
import type { SolanaCanaryVerdict } from "./canary-policy.ts";
import type { SendSupportVerdict } from "./send-support.ts";
import type { TransferPlan } from "./transaction.ts";

export const SEND_READINESS_CODES = [
  "READY",
  "SIMULATION_MISSING",
  "SIMULATION_FAILED",
  "POLICY_NOT_CLEAR",
  "CANARY_NOT_CLEAR",
  /* The asset's own transfer semantics, which replaced the owner-canary
     envelope for ordinary user-signed Send. A reviewed risk is ready; an
     unproven one is not. */
  "SUPPORT_BLOCKED",
  "SUPPORT_NOT_ESTABLISHED",
  "BASE_FEE_UNKNOWN",
  "REVIEW_PROOF_UNSIGNED",
] as const;

export type SendReadiness = Readonly<{
  ready: boolean;
  code: (typeof SEND_READINESS_CODES)[number];
  reason: string;
}>;

export function assessSendReadiness(args: {
  plan: Pick<TransferPlan, "baseFeeLamports"> | Readonly<{ baseFeeLamports: string | null | undefined }>;
  preflight: Pick<SplTransferPreflight, "simulation">;
  verdict?: Pick<SolanaPolicyVerdict, "verdict">;
  /**
   * The historical owner-canary envelope. Ordinary user-signed Send no longer
   * consults it — `RYN-SOL-M1B`'s evidence is history, not a gate — so it is
   * optional and checked only where a caller still supplies one.
   */
  canaryVerdict?: Pick<SolanaCanaryVerdict, "decision" | "newRiskAllowed">;
  /** What this exact transfer shape was proven to be. */
  support?: Pick<SendSupportVerdict, "decision">;
  reviewProof: Readonly<{ status: "SIGNED" | "UNSIGNED" }>;
  requireReviewProof: boolean;
}): SendReadiness {
  const simulation = args.preflight.simulation;
  if (simulation.status !== "PRESENT") {
    return {
      ready: false,
      code: "SIMULATION_MISSING",
      reason: `The exact message was not simulated: ${simulation.reason}`,
    };
  }
  if (!simulation.succeeded) {
    return {
      ready: false,
      code: "SIMULATION_FAILED",
      reason: `The exact message failed simulation${simulation.error ? `: ${simulation.error}` : "."}`,
    };
  }
  if (args.verdict && args.verdict.verdict !== "NO_KNOWN_BLOCKER") {
    return {
      ready: false,
      code: "POLICY_NOT_CLEAR",
      reason: `Policy returned ${args.verdict.verdict}; only NO_KNOWN_BLOCKER may reach a wallet signature.`,
    };
  }
  if (args.support?.decision === "BLOCKED") {
    return {
      ready: false,
      code: "SUPPORT_BLOCKED",
      reason: "This transfer cannot succeed as built, so it does not reach a wallet.",
    };
  }
  if (args.support?.decision === "UNKNOWN") {
    return {
      ready: false,
      code: "SUPPORT_NOT_ESTABLISHED",
      reason: "Something about this asset has no written semantics here, so what the transfer would do is not established.",
    };
  }
  if (args.canaryVerdict && (args.canaryVerdict.decision !== "ALLOW" || !args.canaryVerdict.newRiskAllowed)) {
    return {
      ready: false,
      code: "CANARY_NOT_CLEAR",
      reason: `Owner-canary policy returned ${args.canaryVerdict.decision}; only an exact ALLOW may reach a wallet signature.`,
    };
  }
  if (args.plan.baseFeeLamports === null || args.plan.baseFeeLamports === undefined) {
    return {
      ready: false,
      code: "BASE_FEE_UNKNOWN",
      reason: "The exact message has no cluster-priced base fee.",
    };
  }
  if (args.requireReviewProof && args.reviewProof.status !== "SIGNED") {
    return {
      ready: false,
      code: "REVIEW_PROOF_UNSIGNED",
      reason: "This deployment cannot bind the exact Review bundle to its document-signing key.",
    };
  }
  return { ready: true, code: "READY", reason: "Ready for signature." };
}
