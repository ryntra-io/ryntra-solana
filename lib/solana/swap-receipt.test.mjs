import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeJupiterOrder } from "./quotes.ts";
import {
  buildSwapReceiptFacts,
  parseSwapReceiptFactsFromEffects,
  swapReceiptEarnedServiceFee,
  swapReceiptFactsToEffects,
  SwapReceiptFactsSchema,
} from "./swap-receipt.ts";
import { buildSwapQuoteReview } from "./swap-review.ts";

const raw = JSON.parse(readFileSync("lib/solana/fixtures/jupiter-order-v2-sol-usdc.json", "utf8"));

function review(overrides = {}) {
  const orderBody = {
    ...raw,
    signatureFeeLamports: 5000,
    prioritizationFeeLamports: 1000,
    ...overrides,
  };
  const normalized = normalizeJupiterOrder(orderBody, {
    access: "production",
    latencyMs: 118,
    observedAt: "2026-08-27T10:00:00.000Z",
    reviewWindowMs: 15_000,
    sourceHost: "api.jup.ag",
    routeAffectingOptions: [],
  });
  return buildSwapQuoteReview(normalized, new Date("2026-08-27T10:00:01.000Z"));
}

const BASE = {
  review: review(),
  provider: {
    requestId: "11111111-2222-4333-8444-555555555555",
    signature: "3".repeat(88),
    status: "Success",
    inputRaw: "1000000",
    outputRaw: "104497",
    source: {
      ref: "jupiter:mainnet:swap-v2:execute:11111111-2222-4333-8444-555555555555",
      label: "Jupiter Swap API V2 execute response",
      observedAt: "2026-08-27T10:00:55.000Z",
    },
  },
  observation: {
    signature: "3".repeat(88),
    slot: "123456789",
    finality: "finalized",
    actualInputRaw: "1000000",
    actualOutputRaw: "104497",
    baseFeeLamports: "5000",
    priorityFeeLamports: "1000",
    programs: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
    observedAt: "2026-08-27T10:01:00.000Z",
    source: {
      ref: "solana:mainnet:transaction:independent",
      label: "Independent Solana RPC transaction read",
    },
  },
};

test("future Swap Receipt facts round-trip only with provider and independent observations", () => {
  const facts = buildSwapReceiptFacts({ ...BASE, reconciliation: "MATCHED" });
  assert.equal(facts.schema, "ryntra.solana.swap-receipt-facts");
  assert.equal(facts.schemaVersion, "1.0.0");
  assert.equal(facts.reconciliation.state, "MATCHED");
  assert.equal(facts.reconciliation.outputDeltaRaw, "0");
  assert.equal(facts.reviewDigest, BASE.review.reviewDigest);
  assert.equal(facts.quoteDigest, BASE.review.quoteDigest);
  assert.doesNotThrow(() => SwapReceiptFactsSchema.parse(facts));

  const effects = swapReceiptFactsToEffects({
    facts,
    sourceRef: "solana:mainnet:transaction:independent",
    observedAt: BASE.observation.observedAt,
  });
  assert.ok(effects.length >= 2, "The structured facts should exercise the chunked Outcome Receipt boundary.");
  assert.deepEqual(parseSwapReceiptFactsFromEffects(effects), facts);
});

test("arbitrary or stale digests cannot bind future Swap Receipt facts", () => {
  assert.throws(
    () =>
      buildSwapReceiptFacts({
        ...BASE,
        review: { ...BASE.review, reviewDigest: "0x" + "0".repeat(64) },
        reconciliation: "MATCHED",
      }),
    /review digest/i,
  );
  assert.throws(
    () =>
      buildSwapReceiptFacts({
        ...BASE,
        review: { ...BASE.review, quoteDigest: "0x" + "0".repeat(64) },
        reconciliation: "MATCHED",
      }),
    /quote digest/i,
  );
});

test("receipt facts cannot bind observations to a different valid review", () => {
  const differentReview = review({
    outAmount: "104496",
    otherAmountThreshold: "104496",
    routePlan: raw.routePlan.map((hop) => ({
      ...hop,
      swapInfo: { ...hop.swapInfo, outAmount: "104496" },
    })),
  });
  assert.throws(
    () => buildSwapReceiptFacts({ ...BASE, review: differentReview, reconciliation: "MATCHED" }),
    /cannot reconcile as MATCHED/i,
  );
  assert.throws(
    () =>
      buildSwapReceiptFacts({
        ...BASE,
        review: {
          ...BASE.review,
          quote: { ...BASE.review.quote, quotedOutputRaw: "104496" },
        },
        reconciliation: "DEVIATION_RECORDED",
      }),
    /quote digest does not match/i,
  );
});

test("provider success alone cannot mint Swap Receipt facts", () => {
  assert.throws(
    () => buildSwapReceiptFacts({ ...BASE, observation: null, reconciliation: "MATCHED" }),
    /independent observation is required/i,
  );
});

test("recovery can seal independent chain truth while provider evidence is unavailable", () => {
  const facts = buildSwapReceiptFacts({
    ...BASE,
    provider: null,
    reconciliation: "RECOVERY",
  });
  assert.equal(facts.provider, null);
  assert.equal(facts.reconciliation.state, "RECOVERY");
  assert.ok(facts.reconciliation.deviations.includes("PROVIDER_EVIDENCE_UNAVAILABLE"));
  assert.throws(
    () => buildSwapReceiptFacts({ ...BASE, provider: null, reconciliation: "MATCHED" }),
    /cannot reconcile as MATCHED/i,
  );
});

test("provider and independent observations must name the same transaction", () => {
  const changed = {
    ...BASE,
    provider: { ...BASE.provider, signature: "4".repeat(88) },
  };
  assert.throws(() => buildSwapReceiptFacts({ ...changed, reconciliation: "MATCHED" }), /cannot reconcile as MATCHED/i);
  const deviation = buildSwapReceiptFacts({ ...changed, reconciliation: "DEVIATION_RECORDED" });
  assert.ok(deviation.reconciliation.deviations.includes("PROVIDER_SIGNATURE_MISMATCH"));
});

test("an output mismatch cannot be labelled MATCHED", () => {
  const changed = {
    ...BASE,
    observation: { ...BASE.observation, actualOutputRaw: "103999" },
  };
  assert.throws(() => buildSwapReceiptFacts({ ...changed, reconciliation: "MATCHED" }), /cannot reconcile as MATCHED/i);

  const deviation = buildSwapReceiptFacts({ ...changed, reconciliation: "DEVIATION_RECORDED" });
  assert.equal(deviation.reconciliation.state, "DEVIATION_RECORDED");
  assert.equal(deviation.reconciliation.outputDeltaRaw, "-498");
});

test("base or priority fee drift cannot be labelled MATCHED", () => {
  const changedPriority = {
    ...BASE,
    observation: { ...BASE.observation, priorityFeeLamports: "999" },
  };
  assert.throws(() => buildSwapReceiptFacts({ ...changedPriority, reconciliation: "MATCHED" }), /cannot reconcile as MATCHED/i);
  const facts = buildSwapReceiptFacts({ ...changedPriority, reconciliation: "DEVIATION_RECORDED" });
  assert.ok(facts.reconciliation.deviations.includes("PRIORITY_FEE_MISMATCH"));

  const changedBase = {
    ...BASE,
    observation: { ...BASE.observation, baseFeeLamports: "4999" },
  };
  assert.throws(() => buildSwapReceiptFacts({ ...changedBase, reconciliation: "MATCHED" }), /cannot reconcile as MATCHED/i);
});


/* ── The service fee on a receipt ──────────────────────────────────────────
   `RYN-SOL-SWAP-MONETIZATION-001`. Jupiter states a fee rate on the order and
   never an amount, so the amount comes from the transaction's own token
   balances — and whether the fee was taken at all comes from the same read. A
   receipt is where a quoted intention either becomes revenue or is recorded as
   the thing that did not happen. */

const REFERRAL_ACCOUNT = "18LeLp3B8yGctKtWKAXXqdB6Lf1GxmEa2fRL5xxa1ta";

/** The same fixture order, asked for with a referral and answered with one. */
function paidReview() {
  const orderBody = { ...raw, signatureFeeLamports: 5000, prioritizationFeeLamports: 1000, referralAccount: REFERRAL_ACCOUNT, feeBps: 50, platformFee: { ...raw.platformFee, feeBps: 50 } };
  const normalized = normalizeJupiterOrder(orderBody, {
    access: "production",
    latencyMs: 118,
    observedAt: "2026-08-27T10:00:00.000Z",
    reviewWindowMs: 15_000,
    sourceHost: "api.jup.ag",
    routeAffectingOptions: ["referralFee=50", "referralAccount=set"],
    referral: { account: REFERRAL_ACCOUNT, feeBps: 50 },
  });
  return buildSwapQuoteReview(normalized, new Date("2026-08-27T10:00:01.000Z"));
}

test("a fee the chain shows arriving is revenue, and the amount is the chain's", () => {
  const facts = buildSwapReceiptFacts({
    ...BASE,
    review: paidReview(),
    observation: { ...BASE.observation, serviceFeeCollectedRaw: "5000" },
    reconciliation: "MATCHED",
  });
  assert.equal(facts.fees.serviceFee.mechanism, "JUPITER_REFERRAL");
  assert.equal(facts.fees.serviceFee.state, "COLLECTED");
  assert.equal(facts.fees.serviceFee.basisPoints, 50);
  assert.equal(swapReceiptEarnedServiceFee(facts), true);

  /* The split, kept as three separate facts, and the direction of it is the part
     that was wrong first time. The referral token account receives the **whole**
     charge — verified against a real swap on 2026-09-10, where 0.01 SOL at 50 bps
     put exactly 50,000 lamports there — and the Ultra project's own
     `default_share_bps` is 8000, so Jupiter's fifth comes out at claim time. So
     5,000 observed means the person paid 5,000, Ryntra is owed 4,000 and Jupiter
     1,000. Inverting this would have overstated the charge by a quarter. */
  const split = facts.fees.serviceFee.settlement;
  assert.equal(split.userPaidRaw, "5000", "the whole charge, read from the chain");
  assert.equal(split.providerRaw, "1000");
  assert.equal(split.ryntraRaw, "4000");
  assert.equal(BigInt(split.providerRaw) + BigInt(split.ryntraRaw), BigInt(split.userPaidRaw), "the two shares are the whole charge");
  assert.equal(split.basis, "RYNTRA_OBSERVED_SPLIT_DOCUMENTED");
  assert.equal(split.operationRef, BASE.observation.signature, "keyed by the signature, so a second read is not a second income");
  assert.equal(facts.fees.serviceFee.amountRaw, "5000", "the headline figure is what the person paid");

  /* The narrow legacy row is a projection of the wide one, never a second source. */
  assert.equal(facts.fees.referral.basisPoints, 50);
  assert.equal(facts.fees.referral.amountRaw, "5000");
  assert.doesNotThrow(() => SwapReceiptFactsSchema.parse(facts));
  assert.deepEqual(
    parseSwapReceiptFactsFromEffects(swapReceiptFactsToEffects({ facts, sourceRef: "solana:mainnet:transaction:independent", observedAt: BASE.observation.observedAt })),
    facts,
  );
});

test("a fee that did not arrive is not revenue, and the receipt says so out loud", () => {
  const facts = buildSwapReceiptFacts({
    ...BASE,
    review: paidReview(),
    observation: { ...BASE.observation, serviceFeeCollectedRaw: "0" },
    reconciliation: "MATCHED",
  });
  assert.equal(facts.fees.serviceFee.state, "NOT_COLLECTED");
  assert.equal(swapReceiptEarnedServiceFee(facts), false);
  assert.equal(facts.fees.serviceFee.basisPoints, 50, "the quoted rate stays on the record beside the miss");
  assert.match(facts.fees.serviceFee.note, /referral token account/i);
});

test("no chain read means no claim either way, and never revenue", () => {
  const facts = buildSwapReceiptFacts({ ...BASE, review: paidReview(), reconciliation: "MATCHED" });
  assert.equal(facts.fees.serviceFee.state, "QUOTED");
  assert.equal(swapReceiptEarnedServiceFee(facts), false);
});

test("a swap with no fee configured records a zero that is true", () => {
  const facts = buildSwapReceiptFacts({ ...BASE, reconciliation: "MATCHED" });
  assert.equal(facts.fees.serviceFee.state, "UNCONFIGURED");
  assert.equal(facts.fees.serviceFee.basisPoints, 0);
  assert.equal(facts.fees.referral.basisPoints, 0);
  assert.equal(swapReceiptEarnedServiceFee(facts), false);
});


test("the provider's share is rounded against Ryntra, never in its favour", () => {
  /* An amount that does not divide by five. Rounding the provider's fifth up
     means the number recorded as Ryntra's is the conservative one — a revenue
     figure that is wrong should be wrong downward. */
  const facts = buildSwapReceiptFacts({
    ...BASE,
    review: paidReview(),
    observation: { ...BASE.observation, serviceFeeCollectedRaw: "5003" },
    reconciliation: "MATCHED",
  });
  const split = facts.fees.serviceFee.settlement;
  assert.equal(split.userPaidRaw, "5003");
  assert.equal(split.providerRaw, "1001", "20% of 5003 is 1000.6, rounded up");
  assert.equal(split.ryntraRaw, "4002");
  assert.equal(BigInt(split.providerRaw) + BigInt(split.ryntraRaw), 5003n);
});
