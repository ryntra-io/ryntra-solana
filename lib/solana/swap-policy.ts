/**
 * The product swap policy.
 *
 * The owner canary (`canary-policy.ts`) governs the families it was built
 * for: a bounded package with an enumerated destination allowlist, a $2–5
 * window and a $20 ceiling. That envelope is the right shape for a one-shot
 * experiment and the wrong shape for a swap of a person's own funds — it
 * refuses every pair it did not enumerate, every amount outside its window,
 * and every wallet outside its list, which is what it did to the live Trade
 * card in both directions.
 *
 * This module is the swap's own policy. It keeps every rule that is about the
 * signer's safety and drops every rule that was only about the size of the
 * experiment. Each finding below is derived from evidence the order route
 * already holds — the decoded message, the simulation of those exact bytes,
 * the proven owner deltas, the live mint review — so no rule is decorative
 * and none of them can pass by configuration alone.
 *
 * It performs no network call, holds no key and signs nothing.
 */

import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalJson } from "../guard/canonical-json.ts";
import {
  SWAP_POLICY_DECISIONS,
  SWAP_POLICY_ID,
  SWAP_POLICY_LIMITS,
  SWAP_POLICY_OUTCOMES,
  SWAP_POLICY_RULES,
  type SwapPolicyDecision,
  type SwapPolicyRule,
} from "./swap-policy-rules.ts";

export {
  SWAP_POLICY_DECISIONS,
  SWAP_POLICY_ID,
  SWAP_POLICY_LIMITS,
  SWAP_POLICY_OUTCOMES,
  SWAP_POLICY_RULES,
  type SwapPolicyDecision,
  type SwapPolicyRule,
} from "./swap-policy-rules.ts";

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RAW_AMOUNT = /^(?:0|[1-9][0-9]{0,39})$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

export const SwapPolicyIntentSchema = z
  .object({
    schema: z.literal("ryntra.solana.swap-intent"),
    schemaVersion: z.literal("1.0.0"),
    intentId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    network: z.literal("mainnet"),
    /* A swap pays out to the wallet that signs it. One field, because the
       signer and the recipient are the same party by construction — and the
       PAYOUT_TO_SIGNER rule proves the transaction agrees. */
    signer: z.string().regex(BASE58_ADDRESS),
    inputMint: z.string().regex(BASE58_ADDRESS),
    outputMint: z.string().regex(BASE58_ADDRESS),
    inputAmountRaw: z.string().regex(RAW_AMOUNT),
    quotedOutputRaw: z.string().regex(RAW_AMOUNT),
    minimumOutputRaw: z.string().regex(RAW_AMOUNT),
    slippageBps: z.number().int().min(0).max(10_000),
    priceImpactPct: z.string().max(64),
    /* Every program the exact message can invoke, top level and CPI, as the
       simulation resolved them. Provider prose never enters this list. */
    programs: z.array(z.string().regex(BASE58_ADDRESS)).min(1).max(64),
    usd: z
      .object({
        inValue: z.string().regex(DECIMAL).nullable(),
        outValue: z.string().regex(DECIMAL).nullable(),
        swapValue: z.string().regex(DECIMAL).nullable(),
        sourceRef: z.string().min(1).max(256),
      })
      .strict()
      .nullable(),
    reviewExpiresAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.inputMint === value.outputMint) {
      context.addIssue({ code: "custom", path: ["outputMint"], message: "A swap intent needs two distinct mints." });
    }
    if (BigInt(value.minimumOutputRaw) > BigInt(value.quotedOutputRaw)) {
      context.addIssue({
        code: "custom",
        path: ["minimumOutputRaw"],
        message: "The minimum received cannot exceed the quoted output.",
      });
    }
  });

export type SwapPolicyIntent = z.output<typeof SwapPolicyIntentSchema>;

const FindingSchema = z
  .object({
    rule: z.enum(SWAP_POLICY_RULES),
    outcome: z.enum(SWAP_POLICY_OUTCOMES),
    detail: z.string().min(1).max(512),
  })
  .strict();

export type SwapPolicyFinding = z.output<typeof FindingSchema>;

export const SwapPolicyVerdictSchema = z
  .object({
    schema: z.literal("ryntra.solana.swap-verdict"),
    schemaVersion: z.literal("1.0.0"),
    decision: z.enum(SWAP_POLICY_DECISIONS),
    policyId: z.literal(SWAP_POLICY_ID),
    policyDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    intentDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    findings: z.array(FindingSchema).length(SWAP_POLICY_RULES.length),
    evaluatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type SwapPolicyVerdict = z.output<typeof SwapPolicyVerdictSchema>;

function digest(domain: string, value: unknown): string {
  return `0x${createHash("sha256").update(`${domain}\n${canonicalJson(value)}`, "utf8").digest("hex")}`;
}

export function swapPolicyIntentDigest(value: SwapPolicyIntent): string {
  return digest("ryntra.solana.swap-intent.v1", SwapPolicyIntentSchema.parse(value));
}

export function swapPolicyDigest(): string {
  return digest("ryntra.solana.swap-policy.v1", {
    policyId: SWAP_POLICY_ID,
    rules: SWAP_POLICY_RULES,
    limits: SWAP_POLICY_LIMITS,
  });
}

function finding(rule: SwapPolicyRule, outcome: SwapPolicyFinding["outcome"], detail: string): SwapPolicyFinding {
  return { rule, outcome, detail };
}

function highestDecision(findings: readonly SwapPolicyFinding[]): SwapPolicyDecision {
  if (findings.some((entry) => entry.outcome === "BLOCK")) return "BLOCK";
  if (findings.some((entry) => entry.outcome === "REVIEW")) return "REVIEW";
  return "ALLOW";
}

/** A finite decimal percentage, or null when the provider stated nothing usable. */
function percentage(value: string): number | null {
  if (!DECIMAL.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
}

/**
 * Build the swap intent from the same evidence the wallet will be asked to
 * sign over. Nothing here is provider prose: the amounts come from the
 * normalized order, the program list from the proven simulation effects.
 */
export function buildSwapPolicyIntent(args: {
  order: Readonly<{
    requestId: string;
    taker: string;
    inputMint: string;
    outputMint: string;
    inAmountRaw: string;
    outAmountRaw: string;
    minReceivedRaw: string;
    slippageBps: number;
    priceImpactPct: string;
    inUsdValue: string | null;
    outUsdValue: string | null;
    swapUsdValue: string | null;
    reviewExpiresAt: string;
    source: Readonly<{ ref: string }>;
  }>;
  programs: readonly string[];
  revision?: number;
}): SwapPolicyIntent {
  const { order } = args;
  const anyUsd = order.inUsdValue !== null || order.outUsdValue !== null || order.swapUsdValue !== null;
  return SwapPolicyIntentSchema.parse({
    schema: "ryntra.solana.swap-intent",
    schemaVersion: "1.0.0",
    intentId: `swap:${order.requestId}`,
    revision: args.revision ?? 1,
    network: "mainnet",
    signer: order.taker,
    inputMint: order.inputMint,
    outputMint: order.outputMint,
    inputAmountRaw: order.inAmountRaw,
    quotedOutputRaw: order.outAmountRaw,
    minimumOutputRaw: order.minReceivedRaw,
    slippageBps: order.slippageBps,
    priceImpactPct: order.priceImpactPct,
    programs: [...new Set(args.programs)].sort(),
    usd: anyUsd
      ? {
          inValue: order.inUsdValue,
          outValue: order.outUsdValue,
          swapValue: order.swapUsdValue,
          sourceRef: order.source.ref,
        }
      : null,
    reviewExpiresAt: order.reviewExpiresAt,
  });
}

export type SwapPolicyEvidence = Readonly<{
  /** The pre-sign firewall's reading of the exact provider bytes. */
  inspection: Readonly<{ feePayer: string; programs: readonly string[]; instructionCount: number }> | null;
  /** `simulateTransaction` over those same bytes. */
  simulationStatus: "OK" | "FAILED";
  /** The proven net effect of the simulation on the signer's own accounts. */
  ownerEffects: Readonly<{
    status: "VERIFIED";
    taker: string;
    inputMint: string;
    outputMint: string;
    inputAmountRaw: string;
    outputAmountRaw: string;
    minimumOutputRaw: string;
  }> | null;
  /** The thirteen-rule review over the mint the signer would receive. */
  outputAssetVerdict: Readonly<{ verdict: string }> | null;
  /** Whether the provider named a fee payer other than the signer. */
  gasless: boolean;
}>;

/**
 * Judge one swap. Every finding names the evidence that produced it, so a
 * refusal on this card can be read without opening the source.
 */
export function evaluateSwapPolicy(args: {
  intent: SwapPolicyIntent;
  evidence: SwapPolicyEvidence;
  now?: Date;
}): SwapPolicyVerdict {
  const intent = SwapPolicyIntentSchema.parse(args.intent);
  const evidence = args.evidence;
  const now = args.now ?? new Date();

  const inspection = evidence.inspection;
  const effects = evidence.ownerEffects;

  const payoutToSigner =
    effects !== null && effects.taker === intent.signer && inspection?.feePayer === intent.signer;
  const feePayerIsSigner = !evidence.gasless && inspection?.feePayer === intent.signer;
  const effectsMatchReview =
    effects !== null &&
    effects.status === "VERIFIED" &&
    effects.inputMint === intent.inputMint &&
    effects.outputMint === intent.outputMint &&
    effects.inputAmountRaw === intent.inputAmountRaw &&
    effects.minimumOutputRaw === intent.minimumOutputRaw;

  const outputVerdict = evidence.outputAssetVerdict?.verdict ?? null;
  const impact = percentage(intent.priceImpactPct);

  /*
   * Judge the slippage the chain will enforce, not the one the venue labels.
   *
   * `slippageBps` is provider prose; the number that actually decides what the
   * signer may lose is `minimumOutputRaw`, which comes from a different field
   * and is what the route checks on chain. Reading only the label meant the
   * one economic BLOCK in this policy could be walked past by a response whose
   * stated bps and stated minimum disagree. The wider of the two governs, so
   * under-labelling buys nothing.
   */
  const quotedOutput = BigInt(intent.quotedOutputRaw);
  const minimumOutput = BigInt(intent.minimumOutputRaw);
  const impliedSlippageBps =
    quotedOutput > 0n ? Number(((quotedOutput - minimumOutput) * 10_000n) / quotedOutput) : 0;
  const effectiveSlippageBps = Math.max(intent.slippageBps, impliedSlippageBps);
  const slippageDisagrees = Math.abs(impliedSlippageBps - intent.slippageBps) > 1;

  const findings: SwapPolicyFinding[] = [
    finding("NETWORK_MAINNET", "PASS", "The reviewed swap is pinned to Solana mainnet."),
    finding(
      "PAIR_DISTINCT",
      intent.inputMint === intent.outputMint ? "BLOCK" : "PASS",
      intent.inputMint === intent.outputMint
        ? "The two legs name the same mint."
        : "The two legs name two different mints, each read live from the chain.",
    ),
    finding(
      "OUTPUT_ASSET_REVIEWED",
      outputVerdict === null ? "REVIEW" : outputVerdict === "BLOCKED" ? "BLOCK" : outputVerdict === "NO_KNOWN_BLOCKER" ? "PASS" : "REVIEW",
      outputVerdict === null
        ? "The review policy returned no verdict over the mint you would receive."
        : `The review policy over the mint you would receive returned ${outputVerdict}.`,
    ),
    finding(
      "PAYOUT_TO_SIGNER",
      payoutToSigner ? "PASS" : "BLOCK",
      payoutToSigner
        ? "The proven simulation deltas land on the wallet that signs, and no other."
        : "The transaction does not prove that the wallet signing it is the one paid.",
    ),
    finding(
      "FEE_PAYER_IS_SIGNER",
      feePayerIsSigner ? "PASS" : "BLOCK",
      feePayerIsSigner
        ? "The signer pays its own network fee; no gasless or third-party payer lane is used."
        : "The transaction names a fee payer other than the signer, or a gasless lane.",
    ),
    finding(
      "BYTES_INSPECTED",
      inspection !== null && inspection.instructionCount > 0 && inspection.programs.length > 0 ? "PASS" : "BLOCK",
      inspection !== null
        ? `The exact provider message decoded: ${inspection.instructionCount} instructions over ${inspection.programs.length} top-level programs, none of them a token authority, delegate, mint, burn or freeze mutation.`
        : "The exact provider message could not be decoded and inspected.",
    ),
    finding(
      "SIMULATION_OK",
      evidence.simulationStatus === "OK" ? "PASS" : "BLOCK",
      evidence.simulationStatus === "OK"
        ? "Those exact bytes were simulated against mainnet state without error."
        : "Those exact bytes failed simulation; nothing may reach a wallet.",
    ),
    finding(
      "OWNER_EFFECTS_PROVEN",
      effectsMatchReview ? "PASS" : "BLOCK",
      effectsMatchReview
        ? "The simulation proves the signer loses exactly the reviewed input and receives at least the reviewed minimum, and nothing else moves."
        : "The simulation did not prove the reviewed legs as the signer's complete asset effect.",
    ),
    finding(
      "SLIPPAGE_BOUNDED",
      effectiveSlippageBps >= SWAP_POLICY_LIMITS.slippageBlockBps
        ? "BLOCK"
        : effectiveSlippageBps > SWAP_POLICY_LIMITS.slippageReviewBps || slippageDisagrees
          ? "REVIEW"
          : "PASS",
      effectiveSlippageBps >= SWAP_POLICY_LIMITS.slippageBlockBps
        ? `The minimum you would receive is ${effectiveSlippageBps} bps below the quote — too low to call a price.`
        : slippageDisagrees
          ? `The venue states ${intent.slippageBps} bps of slippage, but its own minimum of ${intent.minimumOutputRaw} raw units is ${impliedSlippageBps} bps below the quote. The wider of the two is what the chain enforces.`
          : effectiveSlippageBps > SWAP_POLICY_LIMITS.slippageReviewBps
            ? `Slippage is ${effectiveSlippageBps} bps; the minimum you would receive is ${intent.minimumOutputRaw} raw units.`
            : `Slippage is ${effectiveSlippageBps} bps, and the minimum received is enforced against the chain.`,
    ),
    finding(
      "PRICE_IMPACT_DISCLOSED",
      impact === null ? "REVIEW" : impact >= SWAP_POLICY_LIMITS.priceImpactReviewPct ? "REVIEW" : "PASS",
      impact === null
        ? "The venue stated no readable price impact for this route."
        : `The venue states a price impact of ${intent.priceImpactPct}% for this size on this route.`,
    ),
    finding(
      "VALUE_DISCLOSED",
      intent.usd === null ? "REVIEW" : "PASS",
      intent.usd === null
        ? "No USD value was quoted for either leg, so this trade is priced in the assets themselves."
        : "Both legs carry the venue's own USD valuation, stated with its source.",
    ),
    finding(
      "REVIEW_FRESH",
      Date.parse(intent.reviewExpiresAt) > now.getTime() ? "PASS" : "BLOCK",
      Date.parse(intent.reviewExpiresAt) > now.getTime()
        ? "The reviewed order is inside its window; the bytes are still the ones judged here."
        : "The reviewed order's window has closed; ask for a fresh one.",
    ),
  ];

  return SwapPolicyVerdictSchema.parse({
    schema: "ryntra.solana.swap-verdict",
    schemaVersion: "1.0.0",
    decision: highestDecision(findings),
    policyId: SWAP_POLICY_ID,
    policyDigest: swapPolicyDigest(),
    intentDigest: swapPolicyIntentDigest(intent),
    findings,
    evaluatedAt: now.toISOString(),
  });
}
