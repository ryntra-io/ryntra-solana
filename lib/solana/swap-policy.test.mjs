import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SWAP_POLICY_ID,
  SWAP_POLICY_LIMITS,
  SWAP_POLICY_RULES,
  buildSwapPolicyIntent,
  evaluateSwapPolicy,
  swapPolicyIntentDigest,
} from "./swap-policy.ts";

const TAKER = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const NOW = new Date("2026-08-31T12:00:00.000Z");

function order(overrides = {}) {
  return {
    requestId: "11111111-2222-4333-8444-555555555555",
    taker: TAKER,
    inputMint: USDC,
    outputMint: WSOL,
    inAmountRaw: "3000000",
    outAmountRaw: "28000000",
    minReceivedRaw: "27860000",
    slippageBps: 50,
    priceImpactPct: "0.02",
    inUsdValue: "3.00",
    outUsdValue: "2.99",
    swapUsdValue: "3.00",
    reviewExpiresAt: "2026-08-31T12:00:15.000Z",
    source: { ref: "jupiter:mainnet:order" },
    ...overrides,
  };
}

function intentFor(overrides = {}) {
  return buildSwapPolicyIntent({ order: order(overrides), programs: [JUPITER] });
}

function evidence(intent, overrides = {}) {
  return {
    inspection: { feePayer: intent.signer, programs: [JUPITER], instructionCount: 4 },
    simulationStatus: "OK",
    ownerEffects: {
      status: "VERIFIED",
      taker: intent.signer,
      inputMint: intent.inputMint,
      outputMint: intent.outputMint,
      inputAmountRaw: intent.inputAmountRaw,
      outputAmountRaw: intent.quotedOutputRaw,
      minimumOutputRaw: intent.minimumOutputRaw,
    },
    outputAssetVerdict: { verdict: "NO_KNOWN_BLOCKER" },
    gasless: false,
    ...overrides,
  };
}

function outcomeOf(verdict, rule) {
  return verdict.findings.find((finding) => finding.rule === rule)?.outcome;
}

test("an ordinary swap of any pair and any size is ALLOWed", () => {
  for (const pair of [
    { inputMint: USDC, outputMint: WSOL },
    { inputMint: WSOL, outputMint: USDC },
    /* Token against token — the pair the old canary envelope refused outright,
       for no reason that was ever about the signer's safety. */
    { inputMint: USDC, outputMint: BONK },
  ]) {
    const intent = intentFor(pair);
    const verdict = evaluateSwapPolicy({ intent, evidence: evidence(intent), now: NOW });
    assert.equal(verdict.decision, "ALLOW", `${pair.inputMint} -> ${pair.outputMint}`);
    assert.equal(verdict.policyId, SWAP_POLICY_ID);
    assert.equal(verdict.findings.length, SWAP_POLICY_RULES.length);
    assert.ok(verdict.findings.every((finding) => finding.outcome === "PASS"));
  }

  /* No size window. The canary refused anything outside 2–5 USD. */
  for (const amount of ["1", "1000", "250000000000"]) {
    const intent = intentFor({ inAmountRaw: amount });
    assert.equal(evaluateSwapPolicy({ intent, evidence: evidence(intent), now: NOW }).decision, "ALLOW", amount);
  }
});

test("every BLOCK is structural: who is paid, who pays, what the bytes prove", () => {
  const intent = intentFor();
  const cases = [
    ["PAYOUT_TO_SIGNER", { ownerEffects: { ...evidence(intent).ownerEffects, taker: USDC.slice(0, 44) } }],
    ["FEE_PAYER_IS_SIGNER", { gasless: true }],
    ["BYTES_INSPECTED", { inspection: null }],
    ["SIMULATION_OK", { simulationStatus: "FAILED" }],
    ["OWNER_EFFECTS_PROVEN", { ownerEffects: null }],
  ];
  for (const [rule, override] of cases) {
    const verdict = evaluateSwapPolicy({ intent, evidence: evidence(intent, override), now: NOW });
    assert.equal(outcomeOf(verdict, rule), "BLOCK", rule);
    assert.equal(verdict.decision, "BLOCK", rule);
  }

  /* Effects that do not describe the reviewed legs are not effects. */
  const swapped = evaluateSwapPolicy({
    intent,
    evidence: evidence(intent, {
      ownerEffects: { ...evidence(intent).ownerEffects, inputAmountRaw: "4000000" },
    }),
    now: NOW,
  });
  assert.equal(outcomeOf(swapped, "OWNER_EFFECTS_PROVEN"), "BLOCK");

  /* An expired window blocks whatever else is true. */
  const stale = evaluateSwapPolicy({
    intent,
    evidence: evidence(intent),
    now: new Date("2026-08-31T12:00:16.000Z"),
  });
  assert.equal(outcomeOf(stale, "REVIEW_FRESH"), "BLOCK");
});

test("the asset the signer would receive is the one rule that can block on the asset", () => {
  const intent = intentFor();
  assert.equal(
    outcomeOf(
      evaluateSwapPolicy({ intent, evidence: evidence(intent, { outputAssetVerdict: { verdict: "BLOCKED" } }), now: NOW }),
      "OUTPUT_ASSET_REVIEWED",
    ),
    "BLOCK",
  );
  assert.equal(
    outcomeOf(
      evaluateSwapPolicy({ intent, evidence: evidence(intent, { outputAssetVerdict: { verdict: "REVIEW" } }), now: NOW }),
      "OUTPUT_ASSET_REVIEWED",
    ),
    "REVIEW",
  );
  assert.equal(
    outcomeOf(
      evaluateSwapPolicy({ intent, evidence: evidence(intent, { outputAssetVerdict: null }), now: NOW }),
      "OUTPUT_ASSET_REVIEWED",
    ),
    "REVIEW",
  );
});

test("economics are disclosed and reviewed, and only a meaningless floor blocks", () => {
  const wide = intentFor({ slippageBps: SWAP_POLICY_LIMITS.slippageReviewBps + 1 });
  const wideVerdict = evaluateSwapPolicy({ intent: wide, evidence: evidence(wide), now: NOW });
  assert.equal(outcomeOf(wideVerdict, "SLIPPAGE_BOUNDED"), "REVIEW");
  assert.equal(wideVerdict.decision, "REVIEW");

  const meaningless = intentFor({ slippageBps: SWAP_POLICY_LIMITS.slippageBlockBps });
  assert.equal(
    outcomeOf(evaluateSwapPolicy({ intent: meaningless, evidence: evidence(meaningless), now: NOW }), "SLIPPAGE_BOUNDED"),
    "BLOCK",
  );

  /* A large trade into a thin pool is the signer's call. It is named, not
     refused — the wallet shows them the amounts before they confirm. */
  const thin = intentFor({ priceImpactPct: "12.5" });
  const thinVerdict = evaluateSwapPolicy({ intent: thin, evidence: evidence(thin), now: NOW });
  assert.equal(outcomeOf(thinVerdict, "PRICE_IMPACT_DISCLOSED"), "REVIEW");
  assert.equal(thinVerdict.decision, "REVIEW");

  /* A silent price feed must never stop a swap of a person's own funds. */
  const unpriced = intentFor({ inUsdValue: null, outUsdValue: null, swapUsdValue: null });
  const unpricedVerdict = evaluateSwapPolicy({ intent: unpriced, evidence: evidence(unpriced), now: NOW });
  assert.equal(unpriced.usd, null);
  assert.equal(outcomeOf(unpricedVerdict, "VALUE_DISCLOSED"), "REVIEW");
  assert.equal(unpricedVerdict.decision, "REVIEW");
});

test("the intent binds to its request and its programs, and the digest moves when they do", () => {
  const intent = intentFor();
  assert.equal(intent.intentId, "swap:11111111-2222-4333-8444-555555555555");
  assert.equal(intent.signer, TAKER);
  const other = buildSwapPolicyIntent({ order: order(), programs: [JUPITER, "11111111111111111111111111111111"] });
  assert.notEqual(swapPolicyIntentDigest(intent), swapPolicyIntentDigest(other));
  assert.equal(swapPolicyIntentDigest(intent), swapPolicyIntentDigest(intentFor()));
  assert.throws(() => buildSwapPolicyIntent({ order: order({ outputMint: USDC }), programs: [JUPITER] }));
});

test("slippage is judged on the minimum the chain enforces, not the label the venue prints", () => {
  /*
   * `slippageBps` is provider prose. `minimumOutputRaw` is what the route
   * checks on chain. A response whose two fields disagree could otherwise walk
   * past the only economic BLOCK in this policy by under-labelling itself.
   */
  const understated = intentFor({ slippageBps: 10, outAmountRaw: "1000000", minReceivedRaw: "400000" });
  const verdict = evaluateSwapPolicy({ intent: understated, evidence: evidence(understated), now: NOW });
  assert.equal(outcomeOf(verdict, "SLIPPAGE_BOUNDED"), "BLOCK", "6000 bps of real slippage labelled as 10 must block");

  /* A smaller disagreement is surfaced rather than blocked, and it says both
     numbers so the person can see which one the chain will use. */
  const mismatched = intentFor({ slippageBps: 10, outAmountRaw: "1000000", minReceivedRaw: "950000" });
  const mild = evaluateSwapPolicy({ intent: mismatched, evidence: evidence(mismatched), now: NOW });
  const finding = mild.findings.find((entry) => entry.rule === "SLIPPAGE_BOUNDED");
  assert.equal(finding.outcome, "REVIEW");
  assert.match(finding.detail, /states 10 bps/);
  assert.match(finding.detail, /500 bps below the quote/);
});
