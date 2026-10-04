// Run from repo root: node --test lib/core/fee-policy.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  FEE_FLOWS,
  FEE_POLICY_V2,
  USDC_MINT,
  USDT_MINT,
  WRAPPED_SOL_MINT,
  buildFeeSide,
  candidateValueRaw,
  classifyPair,
  classifySide,
  flowOfSides,
  inputSideFeeRaw,
  orderReferralBps,
  preferOrder,
  productOfFlow,
} from "./fee-policy.ts";
import { proveBuildFee, simulatedTransfersInto } from "../solana/build-fee-proof.ts";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const JITOSOL = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const NEW = "NewMeme1111111111111111111111111111111111111";
const facts = (mint, patch = {}) => ({ mint, verified: true, tags: ["verified"], firstPoolAt: new Date(NOW - 30 * DAY).toISOString(), ...patch });

test("the table: rates and lanes", () => {
  assert.deepEqual(
    Object.fromEntries(FEE_FLOWS.map((flow) => [flow, [FEE_POLICY_V2[flow].bps, FEE_POLICY_V2[flow].lane]])),
    {
      MEME: [100, "BUILD"],
      TRENDING: [50, "BUILD"],
      MAJOR: [10, "BUILD"],
      STABLE: [0, "BUILD"],
      XSTOCK: [25, "BUILD"],
      ONDO: [50, "ORDER"],
      PRESTOCK: [50, "ORDER"],
      AS_NOW: [50, "ORDER"],
    },
  );
  assert.equal(FEE_POLICY_V2.ONDO.orderMayWin, false, "Ondo trades on Jupiter only by RFQ: /order and nothing else");
});

test("a side's class: dollars and majors by mint, stocks by the issuer's tag, tokens by verification and age", () => {
  assert.equal(classifySide(USDC_MINT, null, NOW), "DOLLAR");
  assert.equal(classifySide(WRAPPED_SOL_MINT, null, NOW), "MAJOR");
  assert.equal(classifySide(JITOSOL, facts(JITOSOL, { tags: ["verified", "lst"] }), NOW), "MAJOR", "liquid-staked SOL is a major");
  assert.equal(classifySide(AAPLX, facts(AAPLX, { tags: ["verified", "xstocks", "stocks"] }), NOW), "XSTOCK");
  assert.equal(classifySide("SPYon1111111111111111111111111111111111111", facts("SPYon1111111111111111111111111111111111111", { tags: ["ondo", "stocks"] }), NOW), "ONDO");
  assert.equal(classifySide("Pre11111111111111111111111111111111111111111", facts("Pre11111111111111111111111111111111111111111", { tags: ["prestocks"] }), NOW), "PRESTOCK");
  assert.equal(classifySide("Bp111111111111111111111111111111111111111111", facts("Bp111111111111111111111111111111111111111111", { tags: ["backpack", "stocks"] }), NOW), "OTHER_STOCK");
  assert.equal(classifySide(BONK, facts(BONK, { tags: ["verified", "meme"] }), NOW), "TRENDING", "verified and older than a week");
  assert.equal(classifySide(NEW, facts(NEW, { firstPoolAt: new Date(NOW - 2 * DAY).toISOString() }), NOW), "MEME", "younger than seven days");
  assert.equal(classifySide(NEW, facts(NEW, { verified: false, tags: [] }), NOW), "MEME", "not verified by Jupiter");
  assert.equal(classifySide(NEW, null, NOW), "UNREAD");
  assert.equal(classifySide(NEW, facts(NEW, { firstPoolAt: null }), NOW), "UNREAD", "a verified token of unknown age is not guessed");
  assert.equal(classifySide(NEW, facts("Other111111111111111111111111111111111111111"), NOW), "UNREAD", "facts of another mint are not this mint's");
});

test("a pair's flow: the stock decides, two dollars pay nothing, the riskier token wins, anything unread is as before", () => {
  assert.equal(flowOfSides("DOLLAR", "DOLLAR"), "STABLE");
  assert.equal(flowOfSides("MAJOR", "DOLLAR"), "MAJOR");
  assert.equal(flowOfSides("DOLLAR", "XSTOCK"), "XSTOCK");
  assert.equal(flowOfSides("XSTOCK", "MAJOR"), "XSTOCK");
  assert.equal(flowOfSides("DOLLAR", "ONDO"), "ONDO");
  assert.equal(flowOfSides("MAJOR", "MEME"), "MEME");
  assert.equal(flowOfSides("TRENDING", "MEME"), "MEME");
  assert.equal(flowOfSides("TRENDING", "DOLLAR"), "TRENDING");
  assert.equal(flowOfSides("UNREAD", "DOLLAR"), "AS_NOW");
  assert.equal(flowOfSides("OTHER_STOCK", "DOLLAR"), "AS_NOW");
  assert.equal(flowOfSides("XSTOCK", "ONDO"), "AS_NOW", "two issuers' stocks against each other are not a flow of the table");
  assert.equal(classifyPair({ inputMint: WRAPPED_SOL_MINT, outputMint: USDC_MINT, input: null, output: null, nowMs: NOW }), "MAJOR");
  assert.equal(productOfFlow("MEME"), "memes");
  assert.equal(productOfFlow("XSTOCK"), "stocks");
  assert.equal(productOfFlow("MAJOR"), "swap");
});

test("the fee side: the input when the fee wallet takes it, else the output, else none", () => {
  assert.deepEqual(buildFeeSide(WRAPPED_SOL_MINT, BONK), { side: "INPUT", mint: WRAPPED_SOL_MINT });
  assert.deepEqual(buildFeeSide(USDC_MINT, AAPLX), { side: "INPUT", mint: USDC_MINT });
  assert.deepEqual(buildFeeSide(BONK, USDT_MINT), { side: "OUTPUT", mint: USDT_MINT });
  assert.equal(buildFeeSide(BONK, AAPLX), null);
  assert.equal(inputSideFeeRaw("12345678", 25), "30864", "floor(amount × bps / 10 000) — measured by simulation");
  assert.equal(inputSideFeeRaw("123456789", 10), "123456");
});

test("an /order referral is the flow's rate where Jupiter allows it, none below its minimum", () => {
  assert.equal(orderReferralBps("MEME", 50), 100);
  assert.equal(orderReferralBps("ONDO", 50), 50);
  assert.equal(orderReferralBps("MAJOR", 50), null);
  assert.equal(orderReferralBps("STABLE", 50), null);
});

test("/order wins only when its price, net of Jupiter's share, is better", () => {
  /* Same rate: /order must beat the router by more than Jupiter's fifth of the fee. 1 % of 1 000 000 ≈ 10 101; a fifth ≈ 2 020. */
  assert.equal(preferOrder({ outputRaw: "1000000", feeBps: 100 }, { outputRaw: "1002000", feeBps: 100, referral: true }), false);
  assert.equal(preferOrder({ outputRaw: "1000000", feeBps: 100 }, { outputRaw: "1002100", feeBps: 100, referral: true }), true);
  /* No referral on /order (a 10 bps major): it must pay the person more than Ryntra's whole fee. */
  assert.equal(preferOrder({ outputRaw: "1000000", feeBps: 10 }, { outputRaw: "1000900", feeBps: 0, referral: false }), false);
  assert.equal(preferOrder({ outputRaw: "1000000", feeBps: 10 }, { outputRaw: "1001100", feeBps: 0, referral: false }), true);
  /* Dollar to dollar: no fee either way, the better price wins; a tie stays on /build. */
  assert.equal(preferOrder({ outputRaw: "1000000", feeBps: 0 }, { outputRaw: "1000000", feeBps: 0, referral: false }), false);
  assert.equal(preferOrder({ outputRaw: "1000000", feeBps: 0 }, { outputRaw: "1000001", feeBps: 0, referral: false }), true);
  assert.equal(candidateValueRaw("990000", 100, 100), 1_000_000n);
});

test("the fee proof: the simulated bytes pay exactly the reviewed fee into the reviewed account", () => {
  const FEE = "4kbERimV3PwxwiL72n1NBRpX5HG2Mwja1QNhb4yEp578";
  const transfer = (destination, amount, programId = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") => ({ programId, parsed: { type: "transfer", info: { destination, amount, source: "S", authority: "A" } } });
  const inner = [{ index: 6, instructions: [transfer("Pool11111111111111111111111111111111111111111", "100000000"), transfer(FEE, "1000000")] }];
  assert.equal(simulatedTransfersInto(inner, FEE), 1_000_000n);
  assert.deepEqual(proveBuildFee({ staticAccounts: ["T", FEE], feeAccount: FEE, expectedRaw: "1000000", innerInstructions: inner }), { ok: true, paidRaw: "1000000" });
  assert.equal(proveBuildFee({ staticAccounts: ["T", FEE], feeAccount: FEE, expectedRaw: "999999", innerInstructions: inner }).code, "FEE_MISMATCH");
  assert.equal(proveBuildFee({ staticAccounts: ["T", FEE], feeAccount: FEE, expectedRaw: null, innerInstructions: inner, bps: 100, takerOutputRaw: "99000000" }).ok, true, "on the output side, some fee within the rate");
  assert.equal(proveBuildFee({ staticAccounts: ["T"], feeAccount: FEE, expectedRaw: "1000000", innerInstructions: inner }).code, "FEE_ACCOUNT_NOT_STATIC");
  assert.equal(proveBuildFee({ staticAccounts: ["T", FEE], feeAccount: FEE, expectedRaw: null, innerInstructions: [] }).code, "FEE_NOT_PAID");
  const checked = [{ index: 2, instructions: [{ programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", parsed: { type: "transferChecked", info: { destination: FEE, tokenAmount: { amount: "25" } } } }] }];
  assert.equal(simulatedTransfersInto(checked, FEE), 25n);
  assert.equal(simulatedTransfersInto([{ instructions: [transfer(FEE, "5", "Fake111111111111111111111111111111111111111")] }], FEE), 0n, "only a token program moves tokens");
});

test("an output-side fee is held to the flow's rate of the route's output, and an unmeasured output refuses", () => {
  const FEE = "GfZQv5L2fAmqNgMsUv97ecV3MUF8GYs7rE7K4ySJDhod";
  const inner = (amount) => [{ index: 3, instructions: [{ programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", parsed: { type: "transfer", info: { destination: FEE, amount } } }] }];
  const prove = (amount, bps, received) => proveBuildFee({ staticAccounts: [FEE], feeAccount: FEE, expectedRaw: null, innerInstructions: inner(amount), bps, takerOutputRaw: received });
  /* Measured on mainnet: 10 bps of JUP → USDC paid 3 312 with 3 309 971 to the person. */
  assert.equal(prove("3312", 10, "3309971").ok, true);
  assert.equal(prove("8440", 10, "3304843").code, "FEE_ABOVE_RATE", "2.5× the rate is refused before the wallet");
  assert.equal(prove("3312", 10, null).code, "FEE_UNMEASURED");
  assert.equal(prove("3312", 0, "3309971").code, "FEE_UNMEASURED");
});
