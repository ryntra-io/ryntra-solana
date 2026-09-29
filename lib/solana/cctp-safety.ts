/**
 * The one gate between a bridge Review and a wallet prompt.
 *
 * Send has `send-safety.ts` and this is its counterpart, separate because the
 * questions differ. A Send is safe when the transfer simulates, the fee is
 * priced and the recipient account exists. A burn is safe when all of that
 * holds *and* the things that make a cross-chain transfer recoverable are in
 * place before anything is destroyed: a durable claim that survives a cold
 * start, a second operator on each side, a provider whose fee for this exact
 * lane was actually read, and an issuer-signed Review the submit route can
 * check rather than trust.
 *
 * Every verdict is derived from what this server established for itself. The
 * request never carries a finding; a caller that posted its own "this is fine"
 * would be supplying the permission it is asking for.
 *
 * ## Both directions, one gate
 *
 * The findings are the same questions asked of whichever chain is the source.
 * Two of them genuinely differ and are branched rather than fudged:
 *
 * - **What "it was executed before it was signed" means.** On Solana the
 *   cluster simulates the exact bytes. On Base the equivalent is the chain
 *   pricing the call — `eth_estimateGas` executes it, and a call that would
 *   revert has no price.
 * - **The token permission.** Burning on Base spends an ERC-20 allowance. When
 *   there is not enough of one the answer is not a refusal; it is that the next
 *   action is the approval, and the burn is not the thing being asked about
 *   yet. That is a REVIEW, which is what stops the card offering to send.
 */

import { solanaCanaryRefusalSentence, type SolanaCanaryVerdict } from "./canary-policy.ts";
import { cctpLaneFacts, type CctpDirection } from "./cctp-direction.ts";
import type { CctpBurnPlan } from "./cctp-plan.ts";
import type { CctpProviderSnapshot } from "./cctp-provider.ts";

export type CctpSafetyDecision = "ALLOW" | "REVIEW" | "BLOCK";

export type CctpSafetyFinding = Readonly<{
  code: string;
  outcome: "PASS" | "REVIEW" | "BLOCK";
  detail: string;
}>;

export type CctpSafetyVerdict = Readonly<{
  decision: CctpSafetyDecision;
  findings: readonly CctpSafetyFinding[];
  /** The single sentence a surface shows when the decision is not ALLOW. */
  blockedReason: string | null;
}>;

/**
 * What this gate needs to know about a plan, whichever chain built it.
 *
 * Deliberately not the plan type itself. Two plans of different shapes both
 * answer these three questions, and a gate typed to one of them is a gate that
 * silently only guards one direction.
 */
export type CctpSafetyPlanFacts = Readonly<{
  maxFeeRaw: string;
  protocolFeeRaw: string;
  /**
   * The source-side token permission, on a lane that has one.
   *
   * `null` on Solana, where an owner-authority signature covers the burn and no
   * standing permission exists to be short of.
   */
  allowance?: Readonly<{ sufficient: boolean; currentRaw: string; requiredRaw: string }> | null;
}>;

export type CctpSafetyInput = Readonly<{
  /** The deployment's bridge stop, re-derived on the server, never from a request. */
  state: "OPEN" | "PAUSED";
  direction: CctpDirection;
  plan: CctpSafetyPlanFacts;
  provider: CctpProviderSnapshot;
  /**
   * Whether the source chain executed these exact effects before anything was
   * signed, and what it said if it would not.
   */
  simulation: Readonly<{ status: "PRESENT" | "SKIPPED"; succeeded: boolean; error: string | null }>;
  canaryVerdict: SolanaCanaryVerdict;
  reviewProof: Readonly<{ status: "SIGNED" | "UNSIGNED" }>;
  /** From `deploymentSendCapability`: whether a claim survives a cold start. */
  settlementStore: "DURABLE_MULTI_WRITER" | "NOT_DURABLE";
  /** Whether a second Solana operator exists. */
  independentSolanaRead: boolean;
  /** Whether a second Base operator exists. */
  independentBaseRead: boolean;
  /** Whether the destination recipient was confirmed by the person, not guessed. */
  recipientConfirmed: boolean;
}>;

function decide(findings: readonly CctpSafetyFinding[]): CctpSafetyDecision {
  if (findings.some((entry) => entry.outcome === "BLOCK")) return "BLOCK";
  if (findings.some((entry) => entry.outcome === "REVIEW")) return "REVIEW";
  return "ALLOW";
}

export function evaluateCctpSafety(input: CctpSafetyInput): CctpSafetyVerdict {
  const findings: CctpSafetyFinding[] = [];
  const lane = cctpLaneFacts(input.direction);
  const sourceIsSolana = lane.source.chain === "solana";
  /* The EVM end's own name, for the sentences below. Base or Ethereum, never
     "Base" by habit on a lane that never touches it. */
  const evmLabel = sourceIsSolana ? lane.destination.label : lane.source.label;
  const sourceSecondOperator = sourceIsSolana ? input.independentSolanaRead : input.independentBaseRead;
  const destinationSecondOperator = sourceIsSolana ? input.independentBaseRead : input.independentSolanaRead;

  /* First, so an operator stop is the sentence a paused surface shows rather
     than whichever technical refusal happens to sort earlier. The owner-canary
     policy used to be the only thing that could close this lane without a
     deploy; now that it no longer decides an ordinary person's burn, this is. */
  findings.push(
    input.state === "OPEN"
      ? { code: "LANE_STATE", outcome: "PASS", detail: "Bridging is open on this deployment." }
      : { code: "LANE_STATE", outcome: "BLOCK", detail: "Bridging is turned off right now." },
  );

  findings.push(
    input.simulation.status === "PRESENT" && input.simulation.succeeded
      ? {
          code: "SIMULATION",
          outcome: "PASS",
          detail: sourceIsSolana
            ? "The cluster ran these exact bytes and they succeeded."
            : `${evmLabel} priced this exact call, which means it executed it without reverting.`,
        }
      : {
          code: "SIMULATION",
          outcome: "BLOCK",
          detail:
            input.simulation.status === "SKIPPED"
              ? sourceIsSolana
                ? "The cluster would not simulate these bytes, so nothing is known about what they would do."
                : `${evmLabel} would not price this call, so nothing is known about what it would do.`
              : `The simulation failed: ${input.simulation.error ?? "no reason returned"}`,
        },
  );

  findings.push(
    input.reviewProof.status === "SIGNED"
      ? { code: "REVIEW_PROOF", outcome: "PASS", detail: "The Review is signed by this deployment's issuer key." }
      : {
          code: "REVIEW_PROOF",
          outcome: "BLOCK",
          detail: "This deployment has no document-signing key, so the burn route could not verify what was reviewed.",
        },
  );

  /* A burn cannot be undone from this side, so the record that says "this
     intent already burned" has to survive a cold start and a second instance.
     A claim held in one process's memory is not a boundary. */
  findings.push(
    input.settlementStore === "DURABLE_MULTI_WRITER"
      ? { code: "DURABLE_CLAIM", outcome: "PASS", detail: "The duplicate-burn claim survives a restart and a second instance." }
      : {
          code: "DURABLE_CLAIM",
          outcome: "BLOCK",
          detail: "This deployment cannot hold a durable burn claim, so nothing here could prevent a second burn.",
        },
  );

  findings.push(
    sourceSecondOperator
      ? {
          code: "SOURCE_SECOND_OPERATOR",
          outcome: "PASS",
          detail: `A second ${lane.source.label} operator can read the burn back.`,
        }
      : {
          code: "SOURCE_SECOND_OPERATOR",
          outcome: "BLOCK",
          detail: `Only one ${lane.source.label} operator is configured, so the burn could not be confirmed independently.`,
        },
  );
  findings.push(
    destinationSecondOperator
      ? {
          code: "DESTINATION_SECOND_OPERATOR",
          outcome: "PASS",
          detail: `A second ${lane.destination.label} operator can read the mint.`,
        }
      : {
          code: "DESTINATION_SECOND_OPERATOR",
          outcome: "REVIEW",
          detail: `Only one ${lane.destination.label} operator is configured, so the destination mint would rest on a single answer.`,
        },
  );

  const feesRead = input.provider.fees.state === "AVAILABLE";
  findings.push(
    feesRead
      ? { code: "PROVIDER_FACTS", outcome: "PASS", detail: "Circle's fee and finality for this exact lane were read." }
      : {
          code: "PROVIDER_FACTS",
          outcome: "BLOCK",
          detail: "Circle's fee for this route could not be read, so the ceiling on this burn is not established.",
        },
  );

  /* The provider snapshot has to belong to *this* lane. A fee read for the
     other direction is a real number about the wrong thing, and it would set
     the ceiling on somebody's burn. */
  const providerBound =
    input.provider.direction === input.direction &&
    input.provider.sourceDomain === lane.source.domain &&
    input.provider.destinationDomain === lane.destination.domain;
  findings.push(
    providerBound
      ? {
          code: "PROVIDER_LANE_BOUND",
          outcome: "PASS",
          detail: "The provider snapshot names this exact source and destination.",
        }
      : {
          code: "PROVIDER_LANE_BOUND",
          outcome: "BLOCK",
          detail: "The provider snapshot belongs to the other direction, so its fee is not this transfer's fee.",
        },
  );

  /* Standard is quoted at zero on this route. A non-zero fee is not a refusal —
     it is a number the person has to have seen, and the plan carries it. */
  findings.push(
    input.plan.maxFeeRaw === input.plan.protocolFeeRaw
      ? { code: "FEE_CEILING", outcome: "PASS", detail: "The ceiling equals the fee Circle currently quotes for this lane." }
      : { code: "FEE_CEILING", outcome: "BLOCK", detail: "The fee ceiling does not match the quoted fee." },
  );

  /* Only a lane with an ERC-20 source has a permission to be short of. On
     Solana this finding is absent rather than reported as passing, because a
     PASS would be a claim about something that does not exist. */
  if (input.plan.allowance) {
    findings.push(
      input.plan.allowance.sufficient
        ? {
            code: "SOURCE_TOKEN_APPROVAL",
            outcome: "PASS",
            detail: "This wallet has already given Circle permission for at least this amount.",
          }
        : {
            code: "SOURCE_TOKEN_APPROVAL",
            outcome: "REVIEW",
            detail: "Circle does not yet have permission to move this much USDC from this wallet, so the approval comes first.",
          },
    );
  }

  findings.push(
    input.recipientConfirmed
      ? {
          code: "RECIPIENT_CONFIRMED",
          outcome: "PASS",
          detail: `The ${lane.destination.label} recipient is the one the owner confirmed.`,
        }
      : {
          code: "RECIPIENT_CONFIRMED",
          outcome: "REVIEW",
          detail: `The ${lane.destination.label} recipient has not been confirmed by the owner for this exact transfer.`,
        },
  );

  /**
   * The owner-canary policy decides this burn only when this burn is one of
   * its own.
   *
   * The verdict already says which it is. `canary-policy.ts` stamps every
   * verdict with a scope: `INSIDE_ENVELOPE` when the destination, mints,
   * programs and recorded approval are the ones the owner configured the
   * experiment with, and `OUTSIDE_ENVELOPE` otherwise — and its own comment
   * says an outside-envelope BLOCK "is carried as evidence and is not the
   * gate". `cctp-canary-exposure.ts` already reads it and refuses to reserve or
   * charge an outside-envelope transfer.
   *
   * This function was the one consumer in the repository that read `.decision`
   * without reading `.scope`. That is why an ordinary person's bridge was
   * refused by a policy written to bound a $20 founder experiment: their
   * destination is not on the owner allowlist, so the verdict was `BLOCK`, so
   * the burn was blocked — a refusal about somebody else's budget.
   *
   * Inside the envelope nothing changes: the founder's own canary is still
   * decided by it, still bounded, still charged.
   */
  const canary = input.canaryVerdict.decision;
  findings.push(
    input.canaryVerdict.scope.status === "OUTSIDE_ENVELOPE"
      ? {
          code: "OWNER_CANARY_POLICY",
          outcome: "PASS",
          detail:
            "Ryntra's own internal transfer limits do not apply here. They are recorded as evidence and decide nothing about this transfer.",
        }
      : {
          code: "OWNER_CANARY_POLICY",
          outcome: canary === "ALLOW" ? "PASS" : canary === "REVIEW" ? "REVIEW" : "BLOCK",
          detail: solanaCanaryRefusalSentence(canary),
        },
  );

  const decision = decide(findings);
  const blocked = findings.find((entry) => entry.outcome === "BLOCK") ?? findings.find((entry) => entry.outcome === "REVIEW");
  return {
    decision,
    findings,
    blockedReason: decision === "ALLOW" ? null : (blocked?.detail ?? null),
  };
}

/** Whether the burn route may cross its boundary at all. */
export function canBurn(verdict: Pick<CctpSafetyVerdict, "decision">): boolean {
  return verdict.decision === "ALLOW";
}

/** Narrow a Solana burn plan to what the gate reads. Kept so callers do not guess. */
export function cctpSafetyPlanFacts(plan: Pick<CctpBurnPlan, "maxFeeRaw" | "protocolFeeRaw">): CctpSafetyPlanFacts {
  return { maxFeeRaw: plan.maxFeeRaw, protocolFeeRaw: plan.protocolFeeRaw, allowance: null };
}
