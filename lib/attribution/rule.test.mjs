// Run from repo root: node --test lib/attribution/rule.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ATTRIBUTION_PATHS,
  ATTRIBUTION_RULE_VERSION,
  aggregateOperations,
  attributeSolanaTransaction,
  historyIsComplete,
  operationKey,
  ownerMintDeltas,
  ryntraShareRaw,
  valueAtParUsdMicros,
} from "./rule.ts";

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/onchain-2026-09.json", import.meta.url), "utf8"));
const REFERRAL = FIXTURE.referralAccount;
const TX = FIXTURE.transactions;
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

test("the rule has a version and three named paths, one of them chain-proven", () => {
  assert.equal(ATTRIBUTION_RULE_VERSION, "1.1.0");
  assert.deepEqual([...ATTRIBUTION_PATHS], ["JUPITER_REFERRAL_ONCHAIN", "RELAY_APP_FEE_RECORD", "CCTP_RECORD_ONLY"]);
  assert.equal(operationKey("JUPITER_REFERRAL_ONCHAIN", "sig"), "solana:sig");
  assert.equal(operationKey("RELAY_APP_FEE_RECORD", "req"), "relay:req");
  assert.equal(operationKey("CCTP_RECORD_ONLY", "burn"), "cctp:burn");
});

test("the proof swap of 2026-09-10 is attributable: 50,000 lamports of wSOL reached the referral account, the taker received 1.007814 USDC", () => {
  const verdict = attributeSolanaTransaction(TX.proofSwap, REFERRAL);
  assert.ok(verdict.attributable);
  const op = verdict.operation;
  assert.equal(op.key, `solana:${TX.proofSwap.signature}`);
  assert.equal(op.taker, TX.proofSwap.signers[0]);
  assert.deepEqual(op.feeCredits, [{ mint: WSOL, decimals: 9, deltaRaw: 50_000n }]);
  assert.deepEqual(op.legs, [{ mint: USDC, decimals: 6, deltaRaw: 1_007_814n }]);
  /* Valued at par from the stablecoin leg the person received. */
  assert.equal(op.valueUsdMicros, 1_007_814n);
});

test("creating the referral token accounts is not an operation: nothing was credited", () => {
  const verdict = attributeSolanaTransaction(TX.ataCreation, REFERRAL);
  assert.equal(verdict.attributable, false);
  assert.equal(verdict.reason, "NO_REFERRAL_CREDIT");
  assert.deepEqual(verdict.referralDeltas, []);
});

test("the router is not part of the rule: an order Jupiter routed through a partner aggregator still counts, by the credit alone", () => {
  assert.ok(!TX.partnerRouter.programs.some((program) => program.startsWith("JUP")), "the fixture must not touch Jupiter's own program");
  const verdict = attributeSolanaTransaction(TX.partnerRouter, REFERRAL);
  assert.ok(verdict.attributable);
  assert.deepEqual(verdict.operation.feeCredits, [{ mint: WSOL, decimals: 9, deltaRaw: 173_300n }]);
  assert.equal(verdict.operation.valueUsdMicros, 3_525_904n);
});

test("a stock buy paid its fee in USDC: the fee is the gross the person paid, the value is the USDC that left the wallet", () => {
  const verdict = attributeSolanaTransaction(TX.usdcFeeStockBuy, REFERRAL);
  assert.ok(verdict.attributable);
  assert.deepEqual(verdict.operation.feeCredits, [{ mint: USDC, decimals: 6, deltaRaw: 2_500n }]);
  const usdcLeg = verdict.operation.legs.find((leg) => leg.mint === USDC);
  assert.equal(usdcLeg.deltaRaw, -500_000n);
  assert.equal(verdict.operation.valueUsdMicros, 500_000n, "the paid stablecoin leg, fee included, at par");
  /* 0.5 USDC at 50 bps is exactly 2,500 raw — the fee came out of the input. */
  assert.equal(verdict.operation.feeCredits[0].deltaRaw * 10_000n / 50n, 500_000n);
});

test("a failed transaction is never an operation, whatever its balances say", () => {
  const verdict = attributeSolanaTransaction({ ...TX.proofSwap, failed: true }, REFERRAL);
  assert.equal(verdict.attributable, false);
  assert.equal(verdict.reason, "FAILED_TRANSACTION");
});

test("a claim — a debit from the referral account — is not an operation and is still reported as a movement", () => {
  const withdrawal = {
    signature: "claim",
    slot: 1,
    blockTime: 1,
    failed: false,
    signers: ["owner"],
    preTokenBalances: [{ accountIndex: 1, mint: WSOL, owner: REFERRAL, uiTokenAmount: { amount: "1000", decimals: 9 } }],
    postTokenBalances: [{ accountIndex: 1, mint: WSOL, owner: REFERRAL, uiTokenAmount: { amount: "0", decimals: 9 } }],
  };
  const verdict = attributeSolanaTransaction(withdrawal, REFERRAL);
  assert.equal(verdict.attributable, false);
  assert.equal(verdict.reason, "NO_REFERRAL_CREDIT");
  assert.deepEqual(verdict.referralDeltas, [{ mint: WSOL, decimals: 9, deltaRaw: -1000n }]);
});

test("owner-scoped deltas sum accounts of one mint and drop what did not move", () => {
  const pre = [
    { accountIndex: 1, mint: USDC, owner: "w", uiTokenAmount: { amount: "10", decimals: 6 } },
    { accountIndex: 2, mint: USDC, owner: "w", uiTokenAmount: { amount: "5", decimals: 6 } },
    { accountIndex: 3, mint: WSOL, owner: "w", uiTokenAmount: { amount: "7", decimals: 9 } },
  ];
  const post = [
    { accountIndex: 1, mint: USDC, owner: "w", uiTokenAmount: { amount: "0", decimals: 6 } },
    { accountIndex: 3, mint: WSOL, owner: "w", uiTokenAmount: { amount: "7", decimals: 9 } },
    { accountIndex: 4, mint: USDC, owner: "other", uiTokenAmount: { amount: "999", decimals: 6 } },
  ];
  assert.deepEqual(ownerMintDeltas("w", pre, post), [{ mint: USDC, decimals: 6, deltaRaw: -15n }]);
});

test("value at par: the stablecoin paid wins over the one received; no stablecoin means unvalued, never a price", () => {
  const usdt = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
  assert.equal(valueAtParUsdMicros([{ mint: USDC, decimals: 6, deltaRaw: -3_000_000n }, { mint: usdt, decimals: 6, deltaRaw: 2_990_000n }]), 3_000_000n);
  assert.equal(valueAtParUsdMicros([{ mint: USDC, decimals: 6, deltaRaw: 2_000_000n }]), 2_000_000n);
  assert.equal(valueAtParUsdMicros([{ mint: WSOL, decimals: 9, deltaRaw: -10_000_000n }, { mint: "Meme", decimals: 6, deltaRaw: 5n }]), null);
});

test("aggregation counts each signature once, sums fees per mint and value at par, and names the boundary", () => {
  const ops = [TX.proofSwap, TX.partnerRouter, TX.usdcFeeStockBuy, TX.proofSwap]
    .map((tx) => attributeSolanaTransaction(tx, REFERRAL))
    .filter((verdict) => verdict.attributable)
    .map((verdict) => verdict.operation);
  const totals = aggregateOperations(ops);
  assert.equal(totals.operations, 3, "the proof swap appeared twice and counts once");
  assert.equal(totals.wallets, 2);
  assert.equal(totals.valued, 3);
  assert.equal(totals.unvalued, 0);
  assert.equal(totals.volumeUsdMicros, 1_007_814n + 3_525_904n + 500_000n);
  assert.deepEqual(totals.fees, [
    { mint: USDC, decimals: 6, grossRaw: 2_500n, operations: 1 },
    { mint: WSOL, decimals: 9, grossRaw: 223_300n, operations: 2 },
  ]);
  assert.equal(totals.first.signature, TX.proofSwap.signature, "the boundary is the earliest attributable signature");
  assert.equal(totals.first.slot, 445_833_175);
  assert.equal(totals.last.signature, TX.usdcFeeStockBuy.signature);
});

test("Ryntra's share rounds the provider's part up, so the figure called Ryntra's is never optimistic", () => {
  assert.equal(ryntraShareRaw(50_000n, 8_000), 40_000n);
  assert.equal(ryntraShareRaw(2_500n, 8_000), 2_000n);
  assert.equal(ryntraShareRaw(1n, 8_000), 0n);
  assert.equal(ryntraShareRaw(9n, 8_000), 7n, "9 gross: provider ceil(1.8) = 2, Ryntra 7");
});

test("history is complete only when every movement seen sums to the balance the accounts hold today", () => {
  const verdicts = [TX.ataCreation, TX.proofSwap, TX.partnerRouter, TX.usdcFeeStockBuy, TX.proofSwap].map((tx) => attributeSolanaTransaction(tx, REFERRAL));
  const complete = historyIsComplete(verdicts, [
    { mint: WSOL, amountRaw: "223300" },
    { mint: USDC, amountRaw: "2500" },
  ]);
  assert.equal(complete.complete, true);
  const partial = historyIsComplete(verdicts, [{ mint: WSOL, amountRaw: "1235854" }]);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.mismatches, [{ mint: WSOL, seenRaw: 223_300n, balanceRaw: 1_235_854n }]);
});

test("the fixtures are real chain facts, trimmed, with the referral account named", () => {
  assert.match(FIXTURE.referralAccount, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  for (const tx of Object.values(TX)) {
    assert.match(tx.signature, /^[1-9A-HJ-NP-Za-km-z]{86,88}$/);
    assert.ok(Number.isInteger(tx.slot) && tx.slot > 445_000_000);
    assert.equal(tx.signers.length, 1);
  }
});

/* ---------------------------------------------------------------------------
 * The three negative cases.
 * Constructed from the real fixtures — the shapes are the chain's, the
 * signatures are labelled as constructed so nobody reads them as history.
 * ------------------------------------------------------------------------- */

const SPONSOR = "Sponsor11111111111111111111111111111111111";
const DEPOSITOR = "Depositor1111111111111111111111111111111111";
const constructed = (name, tx) => ({ ...tx, signature: `constructed-${name}-${"1".repeat(70)}` });

/** A plain SPL transfer of 2,500 raw USDC from a wallet into the referral's USDC account: nothing else moves. */
const bareTransfer = constructed("bare-transfer", {
  slot: 446_915_600,
  blockTime: 1_789_400_000,
  failed: false,
  signers: [DEPOSITOR],
  preTokenBalances: [
    { accountIndex: 1, mint: USDC, owner: REFERRAL, uiTokenAmount: { amount: "26870", decimals: 6 } },
    { accountIndex: 2, mint: USDC, owner: DEPOSITOR, uiTokenAmount: { amount: "1000000", decimals: 6 } },
  ],
  postTokenBalances: [
    { accountIndex: 1, mint: USDC, owner: REFERRAL, uiTokenAmount: { amount: "29370", decimals: 6 } },
    { accountIndex: 2, mint: USDC, owner: DEPOSITOR, uiTokenAmount: { amount: "997500", decimals: 6 } },
  ],
});

test("negative 1 — a credit to the referral account is not, by itself, a trade: a bare transfer is refused and still reported as a movement", () => {
  const verdict = attributeSolanaTransaction(bareTransfer, REFERRAL);
  assert.equal(verdict.attributable, false);
  assert.equal(verdict.reason, "TRANSFER_TO_REFERRAL");
  assert.deepEqual(verdict.referralDeltas, [{ mint: USDC, decimals: 6, deltaRaw: 2_500n }]);
  /* The refused transfer is still a movement the completeness proof must count, or the balance would never reconcile. */
  const complete = historyIsComplete([verdict, attributeSolanaTransaction(TX.usdcFeeStockBuy, REFERRAL)], [{ mint: USDC, amountRaw: "5000" }]);
  assert.equal(complete.complete, true);
  /* And a real swap that credits the same mint keeps counting: the person paid and received two different assets. */
  assert.ok(attributeSolanaTransaction(TX.usdcFeeStockBuy, REFERRAL).attributable);
});

test("negative 2 — the first signer is not always the taker: with a sponsor paying the fee, the trader is the signer whose tokens moved", () => {
  /* The proof swap, with a sponsor as the fee payer: the message lists the sponsor first, the person second, and only the person's balances move. */
  const sponsored = constructed("sponsored-swap", { ...TX.proofSwap, signers: [SPONSOR, ...TX.proofSwap.signers] });
  const verdict = attributeSolanaTransaction(sponsored, REFERRAL);
  assert.ok(verdict.attributable);
  assert.equal(verdict.operation.taker, TX.proofSwap.signers[0], "the trader is read from the movement, not from signer order");
  assert.deepEqual(verdict.operation.legs, [{ mint: USDC, decimals: 6, deltaRaw: 1_007_814n }]);
  assert.equal(verdict.operation.valueUsdMicros, 1_007_814n);
  /* A transaction whose signers moved nothing at all still names the fee payer, unvalued — the limit the methodology states. */
  const nobodyMoved = constructed("nobody-moved", {
    ...TX.proofSwap,
    signers: [SPONSOR, "Someone1111111111111111111111111111111111111"],
    preTokenBalances: TX.proofSwap.preTokenBalances.filter((entry) => entry.owner !== TX.proofSwap.signers[0]),
    postTokenBalances: TX.proofSwap.postTokenBalances.filter((entry) => entry.owner !== TX.proofSwap.signers[0]),
  });
  const fallback = attributeSolanaTransaction(nobodyMoved, REFERRAL);
  assert.ok(fallback.attributable);
  assert.equal(fallback.operation.taker, SPONSOR);
  assert.deepEqual(fallback.operation.legs, []);
  assert.equal(fallback.operation.valueUsdMicros, null);
});

test("negative 3 — a matching balance is not proof of a complete history: two missed movements that cancel pass the balance check, which is why the reader also states what it saw", () => {
  const seen = [TX.ataCreation, TX.proofSwap, TX.usdcFeeStockBuy].map((tx) => attributeSolanaTransaction(tx, REFERRAL));
  /* Missing from the reader: the partner-router swap (+173,300 wSOL) and a claim of exactly that much (−173,300 wSOL). */
  const missedClaim = constructed("missed-claim", {
    ...TX.partnerRouter,
    preTokenBalances: [{ accountIndex: 1, mint: WSOL, owner: REFERRAL, uiTokenAmount: { amount: "507376", decimals: 9 } }],
    postTokenBalances: [{ accountIndex: 1, mint: WSOL, owner: REFERRAL, uiTokenAmount: { amount: "334076", decimals: 9 } }],
  });
  const everything = [...seen, attributeSolanaTransaction(TX.partnerRouter, REFERRAL), attributeSolanaTransaction(missedClaim, REFERRAL)];
  const balances = [
    { mint: WSOL, amountRaw: "50000" },
    { mint: USDC, amountRaw: "2500" },
  ];
  assert.equal(historyIsComplete(everything, balances).complete, true, "the whole history reconciles");
  const partial = historyIsComplete(seen, balances);
  assert.equal(partial.complete, true, "so does the history with both movements missing — the balance check sees net movement only");
  assert.equal(aggregateOperations(everything.flatMap((v) => (v.attributable ? [v.operation] : []))).operations, 3);
  assert.equal(aggregateOperations(seen.flatMap((v) => (v.attributable ? [v.operation] : []))).operations, 2, "and one real operation is missing from the count");
});
