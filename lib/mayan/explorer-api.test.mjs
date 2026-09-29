import assert from "node:assert/strict";
import test from "node:test";

import { buildMayanStatusUrl, fetchMayanSwapStatus, normalizeMayanSwapStatus } from "./explorer-api.ts";

const SOL_SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

test("the status URL is the explorer's trx path for a base58 signature or a 0x hash, and nothing else", () => {
  assert.equal(buildMayanStatusUrl(SOL_SIG), `https://explorer-api.mayan.finance/v3/swap/trx/${SOL_SIG}`);
  assert.equal(buildMayanStatusUrl("0x" + "ab".repeat(32)), `https://explorer-api.mayan.finance/v3/swap/trx/0x${"ab".repeat(32)}`);
  assert.throws(() => buildMayanStatusUrl("not-a-hash"), TypeError);
});

test("a 404 is not-indexed-yet, never an error and never a reason to resubmit", async () => {
  const result = await fetchMayanSwapStatus(SOL_SIG, { fetchImpl: async () => new Response("", { status: 404 }), now: () => new Date("2026-09-07T12:00:00Z") });
  assert.deepEqual(result, { found: false, reason: "NOT_INDEXED", observedAt: "2026-09-07T12:00:00.000Z" });
  const limited = await fetchMayanSwapStatus(SOL_SIG, { fetchImpl: async () => new Response("", { status: 429 }) });
  assert.equal(limited.found, false);
  assert.equal(limited.reason, "RATE_LIMITED");
});

test("a live answer keeps the tri-state, both hashes and the refund facts", async () => {
  const payload = {
    clientStatus: "COMPLETED",
    status: "ORDER_SETTLED",
    service: "SWIFT_V2",
    orderId: "SWIFT_V2_0xabc",
    sourceTxHash: SOL_SIG,
    fulfillTxHash: "0x" + "cd".repeat(32),
    redeemTxHash: null,
    refundTxHash: null,
    toAmount: 10.388583,
    completedAt: "2026-09-07T12:00:05.000Z",
    statusUpdatedAt: "2026-09-07T12:00:05.000Z",
    txs: [{ txHash: SOL_SIG, goals: ["INIT"], scannerUrl: "x" }],
  };
  const result = await fetchMayanSwapStatus(SOL_SIG, { fetchImpl: async () => Response.json(payload), now: () => new Date("2026-09-07T12:00:06Z") });
  assert.equal(result.found, true);
  assert.equal(result.clientStatus, "COMPLETED");
  assert.equal(result.destinationTxHash, "0x" + "cd".repeat(32));
  assert.equal(result.toAmount, "10.388583");
  assert.equal(result.refund, null);
  assert.equal(result.observedAt, "2026-09-07T12:00:06.000Z");

  const refunded = normalizeMayanSwapStatus(
    { clientStatus: "REFUNDED", status: "ORDER_REFUNDED", refundTxHash: SOL_SIG, refundAmount: "10.36", refundChain: "solana", refundTokenSymbol: "USDC", refundTokenAddress: "EPjF" },
    "2026-09-07T12:00:07.000Z",
  );
  assert.equal(refunded.clientStatus, "REFUNDED");
  assert.deepEqual(refunded.refund, { chain: "solana", tokenAddress: "EPjF", tokenSymbol: "USDC", amount: "10.36" });
  assert.equal(refunded.destinationTxHash, null);

  const redeem = normalizeMayanSwapStatus({ clientStatus: "COMPLETED", redeemTxHash: SOL_SIG }, "x");
  assert.equal(redeem.destinationTxHash, SOL_SIG, "Fast MCTP pays through a redeem transaction");
});
