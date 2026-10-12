// Run from repo root: node --test lib/solana/swap-receipt-build.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { bindReferrer, ensureRewardAccount, listRewardEntries, totalRewards } from "../rewards/ledger.ts";
import { recordOperationRewards } from "../rewards/record.server.ts";
import { serviceFeeEstimate, serviceFeeReviewText, serviceFeeText } from "../swap/service-fee.ts";
import { fetchJupiterBuild } from "./jupiter-build.ts";
import { JUPITER_SWAP_V2_BASE_URL } from "./quotes.ts";
import { serviceFeeReadFor } from "./swap-observe.ts";
import { buildSwapReceiptFacts } from "./swap-receipt.ts";
import { buildSwapQuoteReview, verifySwapQuoteReview } from "./swap-review.ts";

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/jupiter-build-sol-usdc.json", import.meta.url), "utf8"));
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FEE_WALLET = "5sWCoxARMPyGdqTu9ru6z69REZ1ZZLojcb1rfABDP2Ne";
const FEE_ACCOUNT = "4kbERimV3PwxwiL72n1NBRpX5HG2Mwja1QNhb4yEp578";
const ENDPOINT = {
  ok: true,
  access: "production",
  tier: "pro",
  baseUrl: JUPITER_SWAP_V2_BASE_URL,
  orderUrl: `${JUPITER_SWAP_V2_BASE_URL}/order`,
  buildUrl: `${JUPITER_SWAP_V2_BASE_URL}/build`,
  executeUrl: `${JUPITER_SWAP_V2_BASE_URL}/execute`,
  label: "Jupiter Swap API V2, keyed production",
  authorizationHeaders: () => ({}),
};

async function buildReview() {
  const result = await fetchJupiterBuild(
    { inputMint: WSOL, outputMint: USDC, amountRaw: "10000000", taker: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", fee: { bps: 10, side: "INPUT", mint: WSOL, owner: FEE_WALLET, account: FEE_ACCOUNT, decimals: 9, symbol: "SOL" } },
    ENDPOINT,
    { fetchImpl: async () => new Response(JSON.stringify(FIXTURE), { status: 200, headers: { "content-type": "application/json" } }), now: () => new Date("2026-10-05T12:00:00.000Z") },
  );
  assert.equal(result.ok, true);
  return { quote: result.answer.quote, review: buildSwapQuoteReview({ ...result.answer.quote, priorityFeeLamports: "600" }, new Date("2026-10-05T12:00:01.000Z")) };
}

const observation = (quote, patch = {}) => ({
  signature: "5".repeat(88),
  slot: "453400000",
  finality: "confirmed",
  actualInputRaw: quote.inAmountRaw,
  actualOutputRaw: quote.outAmountRaw,
  baseFeeLamports: "5000",
  priorityFeeLamports: "600",
  programs: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
  observedAt: "2026-10-05T12:00:20.000Z",
  serviceFeeCollectedRaw: "10000",
  source: { ref: "solana:mainnet:transaction:independent", label: "Independent Solana RPC transaction read" },
  ...patch,
});

test("a /build Review hashes and verifies with its fee account inside it", async () => {
  const { review } = await buildReview();
  assert.equal(verifySwapQuoteReview(review).quote.path, "BUILD_SUBMIT");
  assert.deepEqual(review.quote.ryntraFeeAccount, { owner: FEE_WALLET, account: FEE_ACCOUNT });
  assert.throws(() => verifySwapQuoteReview({ ...review, quote: { ...review.quote, ryntraFeeAccount: { owner: FEE_WALLET, account: "GfZQv5L2fAmqNgMsUv97ecV3MUF8GYs7rE7K4ySJDhod" } } }), /digest/, "the fee account is covered by the digest");
});

test("the chain read looks for the fee under the fee wallet the bytes named", async () => {
  const { review } = await buildReview();
  assert.deepEqual(serviceFeeReadFor(review.quote), { referralAccount: FEE_WALLET, feeMint: WSOL });
});

test("a /build receipt: no provider report by design, MATCHED on the chain's word when it equals the Review; the fee observed whole", async () => {
  const { quote, review } = await buildReview();
  const facts = buildSwapReceiptFacts({ review, provider: null, observation: observation(quote), reconciliation: "MATCHED" });
  assert.deepEqual(facts.reconciliation.deviations, []);
  const fee = facts.fees.serviceFee;
  assert.deepEqual([fee.mechanism, fee.state, fee.amountRaw], ["JUPITER_PLATFORM_FEE", "COLLECTED", "10000"]);
  assert.deepEqual(fee.settlement, { userPaidRaw: "10000", providerRaw: "0", ryntraRaw: "10000", asset: WSOL, symbol: "SOL", decimals: 9, basis: "OBSERVED", operationRef: "5".repeat(88) });
  assert.equal(serviceFeeText(fee), "0.10% · 0.00001 SOL", "the receipt says the amount the chain shows");
});

test("a /build landing off the quote by a unit is a recorded deviation, never MATCHED", async () => {
  const { quote, review } = await buildReview();
  const moved = observation(quote, { actualOutputRaw: (BigInt(quote.outAmountRaw) + 1n).toString() });
  assert.throws(() => buildSwapReceiptFacts({ review, provider: null, observation: moved, reconciliation: "MATCHED" }), /cannot reconcile as MATCHED/);
  assert.equal(buildSwapReceiptFacts({ review, provider: null, observation: moved, reconciliation: "DEVIATION_RECORDED" }).reconciliation.deviations.join(), "OUTPUT_MISMATCH");
  const none = buildSwapReceiptFacts({ review, provider: null, observation: observation(quote, { serviceFeeCollectedRaw: "0" }), reconciliation: "MATCHED" });
  assert.equal(none.fees.serviceFee.state, "NOT_COLLECTED");
  assert.match(none.fees.serviceFee.note, /fee wallet/);
});

test("the fee on the screen before the signature is the amount the chain then shows", async () => {
  const { quote, review } = await buildReview();
  const sides = { [WSOL]: { decimals: 9, code: "SOL" }, [USDC]: { decimals: 6, code: "USDC" } };
  const reviewQuote = { inputMint: WSOL, outputMint: USDC, inputRaw: quote.inAmountRaw, quotedOutputRaw: quote.outAmountRaw };
  assert.equal(serviceFeeReviewText(review.quote.ryntraFee, reviewQuote, sides), "0.10% · 0.00001 SOL", "the figures are never broken across lines");
  const facts = buildSwapReceiptFacts({ review, provider: null, observation: observation(quote), reconciliation: "MATCHED" });
  assert.equal(serviceFeeText(facts.fees.serviceFee), "0.10% · 0.00001 SOL");
  /* A referral fee states no amount: before the swap it is an estimate, marked so. */
  const referral = { mechanism: "JUPITER_REFERRAL", state: "QUOTED", basisPoints: 50, asset: USDC, amountRaw: null, decimals: null, symbol: null, usd: null };
  assert.deepEqual(serviceFeeEstimate(referral, { ...reviewQuote, quotedOutputRaw: "1213062" }), { amountRaw: "6065", exact: false });
  assert.equal(serviceFeeReviewText(referral, { ...reviewQuote, quotedOutputRaw: "1213062" }, sides), "0.50% · ≈ 0.006065 USDC");
  assert.equal(serviceFeeReviewText({ ...referral, basisPoints: 0 }, reviewQuote, sides, "0.00%"), "0.00%");
});

test("cashback and friends accrue from a /build fee under the rewards rule — 50 / 10 / 5 % of the fee the person paid, the base untouched", async () => {
  const { quote } = await buildReview();
  const usdcReview = buildSwapQuoteReview({ ...quote, priorityFeeLamports: "600", inputMint: USDC, outputMint: WSOL, ryntraFee: { ...quote.ryntraFee, asset: USDC, symbol: "USDC", decimals: 6, amountRaw: "5000000" } }, new Date("2026-10-05T12:00:01.000Z"));
  const facts = buildSwapReceiptFacts({ review: usdcReview, provider: null, observation: observation(quote, { actualInputRaw: usdcReview.quote.inputRaw, actualOutputRaw: usdcReview.quote.quotedOutputRaw, serviceFeeCollectedRaw: "5000000" }), reconciliation: "MATCHED" });
  const A = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp", B = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL", C = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const NOW = "2026-10-05T12:00:00.000Z";
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, NOW), b = await ensureRewardAccount(store, B, NOW);
  await bindReferrer(store, { wallet: B, code: a.code, now: NOW });
  await bindReferrer(store, { wallet: C, code: b.code, now: NOW });
  const outcome = await recordOperationRewards(store, { fee: facts.fees.serviceFee, trader: C, settledAt: NOW, now: NOW, env: { RYNTRA_REWARDS_ACTIVATION_AT: "2026-09-10T15:25:00Z" } });
  assert.equal(outcome.state, "RECORDED", outcome.reason);
  for (const [wallet, amount] of [[C, 2_500_000n], [B, 500_000n], [A, 250_000n]]) assert.equal(totalRewards(await listRewardEntries(store, wallet)).entitledUsdMicros, amount);
});
