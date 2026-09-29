import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalJson } from "../guard/canonical-json.ts";
import {
  SolanaCanaryIntentSchema,
  evaluateSolanaCanaryIntent,
  solanaCanaryRefusalSentence,
  type SolanaCanaryBudgetSnapshot,
  type SolanaCanaryPolicy,
  type SolanaCanaryVerdict,
} from "./canary-policy.ts";
import type { CctpProviderSnapshot, CctpFeeTier } from "./cctp-provider.ts";
import {
  SOLANA_CCTP_MAINNET_REGISTRY,
  cctpRegistryDigest,
  solanaCctpLane,
  type SolanaCctpDirection,
} from "./cctp-registry.ts";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ADDRESS = z.string().min(32).max(44);
const RAW = z.string().regex(/^(0|[1-9][0-9]*)$/);

export const CctpPrecanaryInputSchema = z
  .object({
    direction: z.enum(["SOLANA_TO_BASE", "BASE_TO_SOLANA", "SOLANA_TO_ETHEREUM", "ETHEREUM_TO_SOLANA"]),
    sourceWallet: ADDRESS.nullable(),
    destinationRecipient: ADDRESS.nullable(),
    amountRaw: RAW.nullable(),
    speed: z.enum(["STANDARD", "FAST"]),
    humanApproval: z.enum(["NOT_RECORDED", "RECORDED"]),
  })
  .strict();

export type CctpPrecanaryInput = z.output<typeof CctpPrecanaryInputSchema>;
export type CctpReviewDecision = "READY" | "REVIEW" | "BLOCK" | "UNKNOWN";

export type CctpReviewFinding = Readonly<{
  code: string;
  outcome: "PASS" | "REVIEW" | "BLOCK" | "UNKNOWN" | "PAUSE";
  detail: string;
}>;

type ReviewChain = "solana" | "base" | "ethereum";

/** A chain-qualified reference, so the same V2 address on Base and Ethereum never compares equal. */
function programRef(chain: ReviewChain, address: string): string {
  return chain === "solana" ? address : `${SOLANA_CCTP_MAINNET_REGISTRY.chains[chain].chainRef}:${address}`;
}

function decimalToScaled(value: string, decimals: number): bigint {
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) throw new Error("Fee basis points are malformed.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("Fee basis points exceed the supported precision.");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}

function protocolFeeRaw(amountRaw: string, feeBps: string): string {
  const amount = BigInt(amountRaw);
  const scaledBps = decimalToScaled(feeBps, 6);
  const denominator = 10_000n * 1_000_000n;
  return ((amount * scaledBps + denominator - 1n) / denominator).toString();
}

function tier(snapshot: CctpProviderSnapshot, mode: "STANDARD" | "FAST"): CctpFeeTier | null {
  if (snapshot.fees.state !== "AVAILABLE") return null;
  return snapshot.fees.tiers.find((entry) => entry.mode === mode) ?? null;
}

function addressMatches(chain: ReviewChain, value: string | null): boolean {
  if (!value) return false;
  return chain === "solana" ? SOLANA_ADDRESS.test(value) : EVM_ADDRESS.test(value);
}

function decisionOf(findings: readonly CctpReviewFinding[]): CctpReviewDecision {
  if (findings.some((entry) => entry.outcome === "BLOCK")) return "BLOCK";
  if (findings.some((entry) => entry.outcome === "UNKNOWN")) return "UNKNOWN";
  if (findings.some((entry) => entry.outcome === "REVIEW" || entry.outcome === "PAUSE")) return "REVIEW";
  return "READY";
}

export type CctpPrecanaryReview = Readonly<{
  schema: "ryntra.solana.cctp-precanary-review";
  schemaVersion: "1.0.0";
  reviewId: string;
  decision: CctpReviewDecision;
  execution: "NOT_BUILT";
  provider: "CIRCLE_CCTP_V2";
  lane: ReturnType<typeof solanaCctpLane>;
  sourceWallet: string | null;
  destinationRecipient: string | null;
  amountRaw: string | null;
  fees: Readonly<{
    protocolFeeRaw: string | null;
    relayerFeeRaw: null;
    relayerFeeReason: "FORWARDING_NOT_SELECTED";
    destinationGasRaw: null;
    destinationGasReason: "DESTINATION_EXECUTION_NOT_ESTIMATED";
  }>;
  expectedReceiveRaw: string | null;
  speed: Readonly<{
    requested: "STANDARD" | "FAST";
    effective: "STANDARD" | "FAST" | null;
    finalityThreshold: 1000 | 2000 | null;
    minimumFeeBps: string | null;
    fastAllowanceRaw: string | null;
    fallbackReason: "FAST_ALLOWANCE_INSUFFICIENT" | "FAST_ALLOWANCE_UNKNOWN" | null;
    guarantee: "ALLOWANCE_DEPENDENT_NOT_A_TIME_PROMISE";
  }>;
  approvals: Readonly<{
    sourceTokenApproval: "REQUIRED_AT_CANARY";
    ownerSignature: "NOT_REQUESTED";
    humanApproval: "NOT_RECORDED" | "RECORDED";
  }>;
  recovery: Readonly<{
    path: "INSPECT_EXISTING_BURN_MESSAGE_ATTESTATION_AND_MINT";
    secondBurnAllowed: false;
  }>;
  providerSnapshot: CctpProviderSnapshot;
  canaryIntent: z.output<typeof SolanaCanaryIntentSchema> | null;
  canaryVerdict: SolanaCanaryVerdict | null;
  findings: readonly CctpReviewFinding[];
  evaluatedAt: string;
}>;

export function buildCctpPrecanaryReview(args: {
  input: CctpPrecanaryInput;
  provider: CctpProviderSnapshot;
  policy: SolanaCanaryPolicy;
  budget: SolanaCanaryBudgetSnapshot;
  now?: Date;
}): CctpPrecanaryReview {
  const input = CctpPrecanaryInputSchema.parse(args.input);
  const lane = solanaCctpLane(input.direction as SolanaCctpDirection);
  const now = args.now ?? new Date();
  const findings: CctpReviewFinding[] = [];

  const providerBound =
    args.provider.direction === input.direction &&
    args.provider.sourceDomain === lane.source.domain &&
    args.provider.destinationDomain === lane.destination.domain;
  findings.push({
    code: "PROVIDER_LANE_BOUND",
    outcome: providerBound ? "PASS" : "BLOCK",
    detail: providerBound
      ? "The provider snapshot names this exact source and destination domain."
      : "The provider snapshot does not belong to this lane.",
  });

  const sourceValid = addressMatches(lane.source.id, input.sourceWallet);
  const destinationValid = addressMatches(lane.destination.id, input.destinationRecipient);
  findings.push({
    code: "WALLET_IDENTITIES",
    outcome: sourceValid && destinationValid ? "PASS" : input.sourceWallet && input.destinationRecipient ? "BLOCK" : "REVIEW",
    detail:
      sourceValid && destinationValid
        ? "Source wallet and destination recipient match their chain formats."
        : "Both exact wallet identities must match the selected source and destination chains.",
  });

  const amount = input.amountRaw === null ? null : BigInt(input.amountRaw);
  const amountInRange = amount !== null && amount >= 2_000_000n && amount <= 5_000_000n;
  findings.push({
    code: "PROOF_RANGE",
    outcome: amount === null ? "REVIEW" : amountInRange ? "PASS" : "BLOCK",
    detail: amountInRange
      ? "The amount is within the 2–5 USDC CCTP owner-canary proof range."
      : "The first CCTP owner canary is bounded to 2–5 USDC.",
  });

  let effective: "STANDARD" | "FAST" | null = null;
  let fallbackReason: "FAST_ALLOWANCE_INSUFFICIENT" | "FAST_ALLOWANCE_UNKNOWN" | null = null;
  if (args.provider.fees.state === "AVAILABLE") {
    if (input.speed === "STANDARD") {
      effective = tier(args.provider, "STANDARD") ? "STANDARD" : null;
    } else if (args.provider.allowance.state === "AVAILABLE" && amount !== null) {
      effective = BigInt(args.provider.allowance.allowance.allowanceRaw) >= amount ? "FAST" : "STANDARD";
      if (effective === "STANDARD") fallbackReason = "FAST_ALLOWANCE_INSUFFICIENT";
    } else {
      effective = tier(args.provider, "STANDARD") ? "STANDARD" : null;
      fallbackReason = "FAST_ALLOWANCE_UNKNOWN";
    }
  }
  const selectedTier = effective ? tier(args.provider, effective) : null;
  if (!selectedTier || !providerBound) {
    findings.push({
      code: "PROVIDER_FACTS_UNAVAILABLE",
      outcome: "UNKNOWN",
      detail: "Current route fees/finality could not be read for this exact lane.",
    });
  } else {
    findings.push({
      code: "PROVIDER_FACTS_UNAVAILABLE",
      outcome: "PASS",
      detail: "Current route fee and finality facts are available.",
    });
  }
  if (fallbackReason) {
    findings.push({
      code: "FAST_FALLBACK",
      outcome: "REVIEW",
      detail:
        fallbackReason === "FAST_ALLOWANCE_INSUFFICIENT"
          ? "Fast allowance is below the requested amount; the effective mode is Standard."
          : "Fast allowance is unreadable; the effective mode falls back to Standard.",
    });
  }

  const feeRaw = amount !== null && selectedTier ? protocolFeeRaw(input.amountRaw as string, selectedTier.minimumFeeBps) : null;
  const expectedReceiveRaw =
    amount !== null && feeRaw !== null && BigInt(feeRaw) <= amount ? (amount - BigInt(feeRaw)).toString() : null;
  findings.push({
    code: "DESTINATION_GAS",
    outcome: "REVIEW",
    detail: "Destination gas is not estimated in M0F; no forwarding or destination transaction is built.",
  });

  let canaryIntent: z.output<typeof SolanaCanaryIntentSchema> | null = null;
  let canaryVerdict: SolanaCanaryVerdict | null = null;
  if (sourceValid && destinationValid && amountInRange) {
    const sourceProgram = lane.source.components.find((entry) =>
      entry.role === (lane.source.id === "solana" ? "TOKEN_MESSENGER_MINTER_V2" : "TOKEN_MESSENGER_V2"),
    );
    const destinationProgram = lane.destination.components.find((entry) => entry.role === "MESSAGE_TRANSMITTER_V2");
    if (sourceProgram && destinationProgram) {
      const destination = lane.destination.id === "solana"
        ? input.destinationRecipient as string
        : `${lane.destination.chainRef}:${input.destinationRecipient}`;
      const registryDigest = cctpRegistryDigest(SOLANA_CCTP_MAINNET_REGISTRY);
      const intentSeed = canonicalJson({
        input,
        providerObservedAt: args.provider.observedAt,
        registryDigest,
      });
      canaryIntent = SolanaCanaryIntentSchema.parse({
        schema: "ryntra.solana.canary-intent",
        schemaVersion: "1.0.0",
        intentId: `cctp:${createHash("sha256").update(intentSeed, "utf8").digest("hex")}`,
        revision: 1,
        family: "CCTP",
        network: "mainnet",
        destination,
        /* The two USDCs this exact lane touches. On the Base lanes that is the
           same pair as before; on the Ethereum lanes the Ethereum USDC replaces
           Base's rather than being added beside it, because the intent names
           what moves and nothing on a Solana ↔ Ethereum transfer touches Base. */
        mints: [lane.source.asset.assetRef, lane.destination.asset.assetRef].sort(),
        programs: [
          programRef(lane.source.id, sourceProgram.address),
          programRef(lane.destination.id, destinationProgram.address),
        ].sort(),
        principalUsdMicros: input.amountRaw,
        feeReserveUsdMicros: null,
        usdMicros: null,
        valuation: null,
        humanApproval: input.humanApproval,
      });
      canaryVerdict = evaluateSolanaCanaryIntent({
        policy: args.policy,
        budget: args.budget,
        intent: canaryIntent,
        now,
      });
      findings.push({
        code: "OWNER_CANARY_POLICY",
        outcome:
          canaryVerdict.decision === "ALLOW"
            ? "PASS"
            : canaryVerdict.decision === "BLOCK"
              ? "BLOCK"
              : canaryVerdict.decision === "UNKNOWN"
                ? "UNKNOWN"
                : canaryVerdict.decision === "PAUSE"
                  ? "PAUSE"
                  : "REVIEW",
        detail: solanaCanaryRefusalSentence(canaryVerdict.decision),
      });
    }
  }
  if (!canaryVerdict) {
    findings.push({
      code: "OWNER_CANARY_POLICY",
      outcome: "REVIEW",
      detail: "This transfer needs a valid sending and receiving address and an amount inside the allowed range.",
    });
  }
  if (input.humanApproval !== "RECORDED") {
    findings.push({
      code: "HUMAN_APPROVAL",
      outcome: "REVIEW",
      detail: "No owner approval is recorded; M0F never asks for one.",
    });
  }

  return {
    schema: "ryntra.solana.cctp-precanary-review",
    schemaVersion: "1.0.0",
    reviewId: `cctp_review_${createHash("sha256")
      .update(canonicalJson({ input, provider: args.provider, registry: cctpRegistryDigest(SOLANA_CCTP_MAINNET_REGISTRY) }), "utf8")
      .digest("hex")}`,
    decision: decisionOf(findings),
    execution: "NOT_BUILT",
    provider: "CIRCLE_CCTP_V2",
    lane,
    sourceWallet: input.sourceWallet,
    destinationRecipient: input.destinationRecipient,
    amountRaw: input.amountRaw,
    fees: {
      protocolFeeRaw: feeRaw,
      relayerFeeRaw: null,
      relayerFeeReason: "FORWARDING_NOT_SELECTED",
      destinationGasRaw: null,
      destinationGasReason: "DESTINATION_EXECUTION_NOT_ESTIMATED",
    },
    expectedReceiveRaw,
    speed: {
      requested: input.speed,
      effective,
      finalityThreshold: selectedTier?.finalityThreshold ?? null,
      minimumFeeBps: selectedTier?.minimumFeeBps ?? null,
      fastAllowanceRaw:
        args.provider.allowance.state === "AVAILABLE"
          ? args.provider.allowance.allowance.allowanceRaw
          : null,
      fallbackReason,
      guarantee: "ALLOWANCE_DEPENDENT_NOT_A_TIME_PROMISE",
    },
    approvals: {
      sourceTokenApproval: "REQUIRED_AT_CANARY",
      ownerSignature: "NOT_REQUESTED",
      humanApproval: input.humanApproval,
    },
    recovery: {
      path: "INSPECT_EXISTING_BURN_MESSAGE_ATTESTATION_AND_MINT",
      secondBurnAllowed: false,
    },
    providerSnapshot: args.provider,
    canaryIntent,
    canaryVerdict,
    findings,
    evaluatedAt: now.toISOString(),
  };
}
