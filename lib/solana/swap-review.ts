import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalJson } from "../guard/canonical-json.ts";
import { ServiceFeeSchema } from "../swap/service-fee.ts";
import { assessJupiterOrderFreshness, type JupiterOrderQuote } from "./quotes.ts";

const QUOTE_HASH_DOMAIN = "ryntra.solana.swap-quote-review.v1";
const REVIEW_HASH_DOMAIN = "ryntra.solana.swap-review-bundle.v1";

const RawAmount = z.string().regex(/^[0-9]+$/);
const Digest = z.string().regex(/^0x[0-9a-f]{64}$/);

const FeeSchema = z
  .object({
    basisPoints: z.number().int().min(0).max(10_000).nullable(),
    mint: z.string().nullable(),
    amountRaw: RawAmount.nullable(),
  })
  .strict();

const QuoteSnapshotSchema = z
  .object({
    schema: z.literal("ryntra.solana.jupiter-order-quote"),
    schemaVersion: z.literal("1.0.0"),
    provider: z.literal("jupiter"),
    path: z.literal("ORDER_EXECUTE"),
    access: z.enum(["production", "degraded"]),
    tier: z.enum(["pro", "lite"]),
    execution: z.literal("NOT_EXECUTED"),
    router: z.string().min(1),
    mode: z.string().min(1),
    swapType: z.string().min(1),
    swapMode: z.string().min(1),
    requestId: z.string().min(1),
    inputMint: z.string().min(32).max(44),
    outputMint: z.string().min(32).max(44),
    inputRaw: RawAmount,
    quotedOutputRaw: RawAmount,
    minimumOutputRaw: RawAmount,
    slippageBps: z.number().int().min(0).max(10_000),
    priceImpactPct: z.string().min(1),
    inUsdValue: z.string().min(1).nullable(),
    outUsdValue: z.string().min(1).nullable(),
    swapUsdValue: z.string().min(1).nullable(),
    totalFeeBasisPoints: z.number().int().min(0).max(10_000),
    totalFeeMint: z.string().min(32).max(44),
    platformFee: FeeSchema,
    providerFee: FeeSchema,
    /* Ryntra’s own fee, with the mechanism and the collection state inside the
       reviewed bundle rather than beside it — the digest then covers the fee a
       person was shown, so it cannot be restated afterwards. */
    ryntraFee: ServiceFeeSchema,
    /** What Jupiter echoed back; the field that decides whether the fee exists. */
    providerReferralAccount: z.string().min(32).max(44).nullable(),
    signatureFeeLamports: RawAmount,
    signatureFeePayer: z.string().min(32).max(44).nullable(),
    priorityFeeLamports: RawAmount,
    priorityFeePayer: z.string().min(32).max(44).nullable(),
    rentFeeLamports: RawAmount,
    rentFeePayer: z.string().min(32).max(44).nullable(),
    gasless: z.boolean(),
    guaranteedPrice: z.boolean(),
    jitOptimized: z.boolean(),
    route: z
      .array(
        z
          .object({
            ammKey: z.string().min(1),
            label: z.string().min(1),
            inputMint: z.string().min(1),
            outputMint: z.string().min(1),
            inAmountRaw: RawAmount,
            outAmountRaw: RawAmount,
            basisPoints: z.number().int().min(0).max(10_000),
          })
          .strict(),
      )
      .max(32),
    routeAffectingOptions: z.array(z.string()).max(16),
    taker: z.null(),
    transactionBase64: z.null(),
    observedAt: z.string().datetime({ offset: true }),
    providerExpiresAt: z.string().datetime({ offset: true }).nullable(),
    reviewExpiresAt: z.string().datetime({ offset: true }),
    latencyMs: z.number().int().min(0),
    sourceRef: z.string().min(1),
    sourceLabel: z.string().min(1),
  })
  .strict();

export const SwapQuoteReviewSchema = z
  .object({
    schema: z.literal("ryntra.solana.swap-quote-review"),
    schemaVersion: z.literal("1.0.0"),
    state: z.enum(["FRESH", "STALE", "PROVIDER_DEGRADED"]),
    execution: z.literal("NOT_EXECUTED"),
    quoteDigest: Digest,
    reviewDigest: Digest,
    quote: QuoteSnapshotSchema,
    limitations: z.tuple([
      z.literal("QUOTE_ONLY"),
      z.literal("NO_SIGNATURE"),
      z.literal("NO_EXECUTION"),
      z.literal("NO_RECEIPT"),
    ]),
  })
  .strict();

export type SwapQuoteReview = z.infer<typeof SwapQuoteReviewSchema>;

function snapshot(order: JupiterOrderQuote): z.infer<typeof QuoteSnapshotSchema> {
  return {
    schema: order.schema,
    schemaVersion: order.schemaVersion,
    provider: order.provider,
    path: order.path,
    access: order.access,
    tier: order.tier,
    execution: order.execution,
    router: order.router,
    mode: order.mode,
    swapType: order.swapType,
    swapMode: order.swapMode,
    requestId: order.requestId,
    inputMint: order.inputMint,
    outputMint: order.outputMint,
    inputRaw: order.inAmountRaw,
    quotedOutputRaw: order.outAmountRaw,
    minimumOutputRaw: order.minReceivedRaw,
    slippageBps: order.slippageBps,
    priceImpactPct: order.priceImpactPct,
    inUsdValue: order.inUsdValue,
    outUsdValue: order.outUsdValue,
    swapUsdValue: order.swapUsdValue,
    totalFeeBasisPoints: order.totalFeeBasisPoints,
    totalFeeMint: order.totalFeeMint,
    platformFee: order.platformFee,
    providerFee: order.providerFee,
    ryntraFee: order.ryntraFee,
    providerReferralAccount: order.providerReferralAccount,
    signatureFeeLamports: order.signatureFeeLamports,
    signatureFeePayer: order.signatureFeePayer,
    priorityFeeLamports: order.priorityFeeLamports,
    priorityFeePayer: order.priorityFeePayer,
    rentFeeLamports: order.rentFeeLamports,
    rentFeePayer: order.rentFeePayer,
    gasless: order.gasless,
    guaranteedPrice: order.guaranteedPrice,
    jitOptimized: order.jitOptimized,
    route: [...order.route],
    routeAffectingOptions: [...order.routeAffectingOptions],
    taker: order.taker,
    transactionBase64: order.transactionBase64,
    observedAt: order.observedAt,
    providerExpiresAt: order.providerExpiresAt,
    reviewExpiresAt: order.reviewExpiresAt,
    latencyMs: order.latencyMs,
    sourceRef: order.source.ref,
    sourceLabel: order.source.label,
  };
}

function digest(domain: string, value: unknown): `0x${string}` {
  return `0x${createHash("sha256").update(`${domain}\n${canonicalJson(value)}`, "utf8").digest("hex")}`;
}

function reviewPayload(review: Omit<SwapQuoteReview, "reviewDigest">): Omit<SwapQuoteReview, "reviewDigest"> {
  return {
    schema: review.schema,
    schemaVersion: review.schemaVersion,
    state: review.state,
    execution: review.execution,
    quoteDigest: review.quoteDigest,
    quote: review.quote,
    limitations: review.limitations,
  };
}

export function verifySwapQuoteReview(value: unknown): SwapQuoteReview {
  const review = SwapQuoteReviewSchema.parse(value);
  const expectedQuoteDigest = digest(QUOTE_HASH_DOMAIN, review.quote);
  if (review.quoteDigest !== expectedQuoteDigest) {
    throw new Error("Swap quote digest does not match the reviewed quote.");
  }
  const { reviewDigest: _reviewDigest, ...unsignedReview } = review;
  const expectedReviewDigest = digest(REVIEW_HASH_DOMAIN, reviewPayload(unsignedReview));
  if (review.reviewDigest !== expectedReviewDigest) {
    throw new Error("Swap review digest does not match the review bundle.");
  }
  return review;
}

export function buildSwapQuoteReview(order: JupiterOrderQuote, now = new Date()): SwapQuoteReview {
  const quote = snapshot(order);
  const freshness = assessJupiterOrderFreshness(order, now);
  const unsignedReview: Omit<SwapQuoteReview, "reviewDigest"> = {
    schema: "ryntra.solana.swap-quote-review",
    schemaVersion: "1.0.0",
    state: order.access === "degraded" ? "PROVIDER_DEGRADED" : freshness === "FRESH" ? "FRESH" : "STALE",
    execution: "NOT_EXECUTED",
    quoteDigest: digest(QUOTE_HASH_DOMAIN, quote),
    quote,
    limitations: ["QUOTE_ONLY", "NO_SIGNATURE", "NO_EXECUTION", "NO_RECEIPT"],
  };
  return verifySwapQuoteReview({
    ...unsignedReview,
    reviewDigest: digest(REVIEW_HASH_DOMAIN, reviewPayload(unsignedReview)),
  });
}
