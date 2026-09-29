import { z } from "zod";

import { isServiceFeeIncome, ServiceFeeSchema, settleServiceFee, type RyntraServiceFee } from "../swap/service-fee.ts";
import { type SwapQuoteReview, verifySwapQuoteReview } from "./swap-review.ts";

const RawAmount = z.string().regex(/^[0-9]+$/);
const SignedAmount = z.string().regex(/^-?[0-9]+$/);
const Digest = z.string().regex(/^0x[0-9a-f]{64}$/);
const ReviewDigest = Digest.refine(
  (digest) => /[1-9a-f]/.test(digest.slice(2)),
  "Swap Receipt facts require a nonzero Review digest.",
);
const QuoteDigest = Digest.refine(
  (digest) => /[1-9a-f]/.test(digest.slice(2)),
  "Swap Receipt facts require a nonzero quote digest.",
);
const Address = z.string().min(32).max(44);

const SourceSchema = z
  .object({
    ref: z.string().min(1).max(256),
    label: z.string().min(1).max(256),
  })
  .strict();

const TimedSourceSchema = SourceSchema.extend({
  observedAt: z.string().datetime({ offset: true }),
}).strict();

const FeeSchema = z
  .object({
    basisPoints: z.number().int().min(0).max(10_000),
    mint: Address.nullable(),
    amountRaw: RawAmount.nullable(),
  })
  .strict();

const ProviderObservationSchema = z
  .object({
    requestId: z.string().min(1).max(128),
    signature: z.string().min(64).max(96),
    status: z.string().min(1).max(64),
    inputRaw: RawAmount,
    outputRaw: RawAmount,
    source: TimedSourceSchema,
  })
  .strict();

const IndependentObservationSchema = z
  .object({
    signature: z.string().min(64).max(96),
    slot: RawAmount,
    finality: z.enum(["confirmed", "finalized"]),
    actualInputRaw: RawAmount,
    actualOutputRaw: RawAmount,
    baseFeeLamports: RawAmount,
    priorityFeeLamports: RawAmount,
    programs: z.array(Address).min(1).max(32),
    observedAt: z.string().datetime({ offset: true }),
    source: SourceSchema,
    /**
     * Raw base units of the fee mint that reached Ryntra's referral account in
     * this transaction, read from its own token balances.
     *
     * Optional so every receipt written before
     * `RYN-SOL-SWAP-MONETIZATION-001` still parses. `"0"` means the fee was
     * asked for and nothing arrived, which is a fact worth keeping.
     */
    serviceFeeCollectedRaw: RawAmount.nullable().optional(),
  })
  .strict();

export const SwapReceiptFactsSchema = z
  .object({
    schema: z.literal("ryntra.solana.swap-receipt-facts"),
    schemaVersion: z.literal("1.0.0"),
    reviewDigest: ReviewDigest,
    quoteDigest: QuoteDigest,
    quote: z
      .object({
        inputMint: Address,
        outputMint: Address,
        inputRaw: RawAmount,
        outputRaw: RawAmount,
        minimumOutputRaw: RawAmount,
      })
      .strict(),
    routing: z
      .object({
        router: z.string().min(1).max(64),
        mode: z.string().min(1).max(64),
        route: z
          .array(
            z.object({ ammKey: Address, basisPoints: z.number().int().min(0).max(10_000) }).strict(),
          )
          .max(32),
      })
      .strict(),
    fees: z
      .object({
        platform: FeeSchema,
        /**
         * Ryntra's fee, kept in the three-field shape every receipt written
         * before `RYN-SOL-SWAP-MONETIZATION-001` used, so old receipts still
         * verify. `serviceFee` beside it carries the whole truth — mechanism,
         * where it accrues, and above all whether it was actually **collected**.
         * The narrow row is a projection of the wide one, never a second source.
         */
        referral: FeeSchema,
        serviceFee: ServiceFeeSchema.optional(),
        baseLamports: RawAmount,
        priorityLamports: RawAmount,
      })
      .strict(),
    provider: ProviderObservationSchema.nullable(),
    independentObservation: IndependentObservationSchema,
    reconciliation: z
      .object({
        state: z.enum(["MATCHED", "DEVIATION_RECORDED", "FAILED", "UNKNOWN", "RECOVERY"]),
        outputDeltaRaw: SignedAmount,
        minimumMet: z.boolean(),
        deviations: z.array(
          z.enum([
            "PROVIDER_REQUEST_MISMATCH",
            "PROVIDER_SIGNATURE_MISMATCH",
            "PROVIDER_INPUT_MISMATCH",
            "PROVIDER_OUTPUT_MISMATCH",
            "PROVIDER_EVIDENCE_UNAVAILABLE",
            "INPUT_MISMATCH",
            "OUTPUT_MISMATCH",
            "BELOW_MINIMUM",
            "BASE_FEE_MISMATCH",
            "PRIORITY_FEE_MISMATCH",
          ]),
        ),
      })
      .strict(),
  })
  .strict();

export type SwapReceiptFacts = z.infer<typeof SwapReceiptFactsSchema>;

export type BuildSwapReceiptFactsInput = Readonly<{
  review: SwapQuoteReview;
  provider: z.input<typeof ProviderObservationSchema> | null;
  observation: z.input<typeof IndependentObservationSchema> | null;
  reconciliation: SwapReceiptFacts["reconciliation"]["state"];
}>;

/**
 * The reviewed fee, resolved against what the chain shows arrived.
 *
 * Three cases and no fourth. Nothing was asked for, so nothing changes. Nothing
 * was looked for, so the quote stands unsettled and is not income. Or a number
 * came back — and a zero is as much an answer as a positive amount.
 */
function settleCollectedServiceFee(
  quoted: RyntraServiceFee,
  collectedRaw: string | null,
  operationRef: string,
): RyntraServiceFee {
  if (quoted.state !== "QUOTED") return quoted;
  if (collectedRaw === null) {
    return { ...quoted, note: "No referral account was given to the chain read, so nothing about collection is claimed." };
  }
  const gross = BigInt(collectedRaw);
  const collected = gross > 0n;
  /* **The referral token account receives the whole fee, not Ryntra's share of
     it.** Corrected 2026-09-10 against a real swap: 0.01 SOL charged 50 bps put
     exactly 50,000 lamports into the account — the full charge, not 80% of it —
     and the Ultra project's own `default_share_bps` reads **8000**, so Jupiter's
     fifth is separated when the balance is claimed rather than when the swap
     lands. The first version of this had the split inverted and would have
     reported a fee 25% larger than the person actually paid.

     So the observed number is the **gross**: what the person was charged.
     Ryntra's share follows from the published rate, and the provider's share is
     rounded **up** so that the figure recorded as Ryntra's is never the
     optimistic one. */
  const retained = quoted.providerRetainedPercent;
  const provider = retained === null ? null : (gross * BigInt(retained) + 99n) / 100n;
  const ryntra = provider === null ? null : gross - provider;
  return settleServiceFee(quoted, {
    collected,
    /* The headline figure is what the person paid, which is what the chain shows. */
    amountRaw: collected ? collectedRaw : quoted.amountRaw,
    settlement: {
      userPaidRaw: collectedRaw,
      providerRaw: provider === null ? null : provider.toString(),
      ryntraRaw: ryntra === null ? null : ryntra.toString(),
      asset: quoted.asset,
      symbol: quoted.symbol,
      decimals: quoted.decimals,
      basis: provider === null ? "OBSERVED" : "RYNTRA_OBSERVED_SPLIT_DOCUMENTED",
      operationRef,
    },
    note: collected ? null : "Jupiter took no fee into the referral account for this swap; the referral token account for the fee mint was most likely not initialised.",
  });
}

/** True only when a provider states the fee was taken. The revenue predicate. */
export function swapReceiptEarnedServiceFee(facts: SwapReceiptFacts): boolean {
  return facts.fees.serviceFee !== undefined && isServiceFeeIncome(facts.fees.serviceFee);
}

export function buildSwapReceiptFacts(input: BuildSwapReceiptFactsInput): SwapReceiptFacts {
  if (!input.observation) {
    throw new Error("An independent observation is required before Swap Receipt facts can exist.");
  }

  const observation = IndependentObservationSchema.parse(input.observation);
  const provider = input.provider === null ? null : ProviderObservationSchema.parse(input.provider);
  const review = verifySwapQuoteReview(input.review);
  if (review.state !== "FRESH" || review.quote.access !== "production") {
    throw new Error("Swap Receipt facts require a fresh production quote review.");
  }
  if (review.quote.platformFee.basisPoints === null) {
    throw new Error("Swap Receipt facts require explicit platform fee basis points.");
  }

  const quote = review.quote;
  const expectedBaseFeeLamports = quote.signatureFeeLamports;
  const expectedPriorityFeeLamports = quote.priorityFeeLamports;
  const deviations: SwapReceiptFacts["reconciliation"]["deviations"] = [];
  if (provider === null) {
    deviations.push("PROVIDER_EVIDENCE_UNAVAILABLE");
  } else {
    if (provider.requestId !== quote.requestId) deviations.push("PROVIDER_REQUEST_MISMATCH");
    if (provider.signature !== observation.signature) deviations.push("PROVIDER_SIGNATURE_MISMATCH");
    if (provider.inputRaw !== observation.actualInputRaw) deviations.push("PROVIDER_INPUT_MISMATCH");
    if (provider.outputRaw !== observation.actualOutputRaw) deviations.push("PROVIDER_OUTPUT_MISMATCH");
  }
  if (quote.inputRaw !== observation.actualInputRaw) deviations.push("INPUT_MISMATCH");
  if (quote.quotedOutputRaw !== observation.actualOutputRaw) deviations.push("OUTPUT_MISMATCH");
  const minimumMet = BigInt(observation.actualOutputRaw) >= BigInt(quote.minimumOutputRaw);
  if (!minimumMet) deviations.push("BELOW_MINIMUM");
  if (expectedBaseFeeLamports !== observation.baseFeeLamports) deviations.push("BASE_FEE_MISMATCH");
  if (expectedPriorityFeeLamports !== observation.priorityFeeLamports) deviations.push("PRIORITY_FEE_MISMATCH");

  if (
    input.reconciliation === "MATCHED" &&
    (provider?.status !== "Success" || deviations.length > 0)
  ) {
    throw new Error("A provider or chain deviation cannot reconcile as MATCHED.");
  }

  /* What Ryntra was actually paid, decided by the chain rather than by the quote.
     A quoted fee whose collected amount reads zero is `NOT_COLLECTED` and stays
     visible beside the figure that was quoted — the gap is the interesting part,
     and a receipt that quietly recorded the quote as earnings would be the
     defect this whole state machine exists to prevent. */
  /* Keyed by the landed signature, so reading this swap again is the same
     income rather than new income. A ledger deduplicates on that reference. */
  const serviceFee = settleCollectedServiceFee(quote.ryntraFee, observation.serviceFeeCollectedRaw ?? null, observation.signature);

  return SwapReceiptFactsSchema.parse({
    schema: "ryntra.solana.swap-receipt-facts",
    schemaVersion: "1.0.0",
    reviewDigest: review.reviewDigest,
    quoteDigest: review.quoteDigest,
    quote: {
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inputRaw: quote.inputRaw,
      outputRaw: quote.quotedOutputRaw,
      minimumOutputRaw: quote.minimumOutputRaw,
    },
    routing: {
      router: quote.router,
      mode: quote.mode,
      route: quote.route.map((hop) => ({ ammKey: hop.ammKey, basisPoints: hop.basisPoints })),
    },
    fees: {
      platform: {
        basisPoints: quote.platformFee.basisPoints,
        mint: quote.platformFee.mint,
        amountRaw: quote.platformFee.amountRaw,
      },
      referral: {
        basisPoints: serviceFee.basisPoints,
        mint: serviceFee.asset,
        amountRaw: serviceFee.amountRaw,
      },
      serviceFee,
      baseLamports: expectedBaseFeeLamports,
      priorityLamports: expectedPriorityFeeLamports,
    },
    provider,
    independentObservation: observation,
    reconciliation: {
      state: input.reconciliation,
      outputDeltaRaw: (BigInt(observation.actualOutputRaw) - BigInt(quote.quotedOutputRaw)).toString(),
      minimumMet,
      deviations,
    },
  });
}

type ReceiptEffect = Readonly<{ description: string; sourceRef: string; observedAt: string }>;
const EFFECT_CHUNK_SIZE = 480;
export const SWAP_RECEIPT_FACTS_SOURCE = "ryntra.solana.swap-receipt.facts@1";

export function swapReceiptFactsToEffects(args: {
  facts: SwapReceiptFacts;
  sourceRef: string;
  observedAt: string;
}): readonly ReceiptEffect[] {
  const encoded = JSON.stringify(SwapReceiptFactsSchema.parse(args.facts));
  const chunks: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += EFFECT_CHUNK_SIZE) {
    chunks.push(encoded.slice(offset, offset + EFFECT_CHUNK_SIZE));
  }
  return chunks.map((description, index) => ({
    description,
    sourceRef: `${SWAP_RECEIPT_FACTS_SOURCE}:${args.sourceRef}#${index + 1}/${chunks.length}`,
    observedAt: args.observedAt,
  }));
}

export function parseSwapReceiptFactsFromEffects(effects: readonly ReceiptEffect[]): SwapReceiptFacts | null {
  const escaped = SWAP_RECEIPT_FACTS_SOURCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:.*#(\\d+)\/(\\d+)$`);
  const chunks = effects
    .map((effect) => ({ effect, match: pattern.exec(effect.sourceRef) }))
    .filter((entry): entry is { effect: ReceiptEffect; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => ({ index: Number(entry.match[1]), total: Number(entry.match[2]), description: entry.effect.description }));
  if (chunks.length === 0) return null;
  const total = chunks[0].total;
  if (chunks.length !== total || chunks.some((chunk) => chunk.total !== total)) return null;
  chunks.sort((left, right) => left.index - right.index);
  if (chunks.some((chunk, index) => chunk.index !== index + 1)) return null;
  try {
    const parsed = JSON.parse(chunks.map((chunk) => chunk.description).join("")) as unknown;
    const result = SwapReceiptFactsSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
