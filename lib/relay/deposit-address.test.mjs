import assert from "node:assert/strict";
import test from "node:test";

import { SOLANA_USDC_MINT } from "../swap/catalog.ts";
import { DEPOSIT_NETWORKS, depositAddressRequest, depositProgressOf, parseDepositAddress } from "./deposit-address.ts";

const RECIPIENT = "So11111111111111111111111111111111111111112";

/**
 * A live answer of `POST /quote/v2` with `useDepositAddress: true`, read
 * 2026-10-20 (Base USDC 10 → Solana USDC), trimmed to the fields read here.
 */
function recorded(overrides = {}) {
  return {
    requestId: "0x1792485267724b2f181895a617078a3f8f0eab88749b182fdb2d98668227cb1d",
    steps: [{ id: "deposit", kind: "transaction", depositAddress: "0xc6d52922f6f6ddd9de2bf49b3208d56f167e4c0c", requestId: "0x17", items: [] }],
    fees: {
      gas: { amountUsd: "0.000342" },
      relayer: { amountUsd: "0.026881" },
      relayerGas: { amountUsd: "0.003881" },
      relayerService: { amountUsd: "0.022999" },
      app: { amountUsd: "0" },
    },
    details: {
      sender: "0x0000000000000000000000000000000000000000",
      recipient: RECIPIENT,
      currencyIn: { currency: { chainId: 8453, address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }, amount: "10000000" },
      currencyOut: { currency: { chainId: 792703809, address: SOLANA_USDC_MINT }, amount: "9973115" },
      timeEstimate: 1,
    },
    protocol: { v2: { orderData: { inputs: [{ refunds: [{ chainId: "solana", recipient: RECIPIENT, currency: SOLANA_USDC_MINT }] }] } } },
    ...overrides,
  };
}

test("the question is USDC on the chosen network to USDC on Solana, open, with no refund address and no fee of ours", () => {
  const body = depositAddressRequest("base", RECIPIENT);
  assert.equal(body.useDepositAddress, true);
  assert.equal(body.strict, undefined);
  assert.equal(body.refundTo, undefined);
  assert.equal(body.appFees, undefined);
  assert.equal(body.originChainId, 8453);
  assert.equal(body.destinationChainId, 792703809);
  assert.equal(body.destinationCurrency, SOLANA_USDC_MINT);
  assert.equal(body.recipient, RECIPIENT);
  assert.equal(body.amount, "10000000");
  /* BNB Chain's USDC has eighteen decimals, not six. */
  assert.equal(depositAddressRequest("bnb", RECIPIENT).amount, "10000000000000000000");
  for (const network of DEPOSIT_NETWORKS) assert.match(String(depositAddressRequest(network, RECIPIENT).originCurrency), /^0x[0-9a-fA-F]{40}$/);
});

test("a matching answer becomes an address, a fee and a time", () => {
  const parsed = parseDepositAddress("base", RECIPIENT, recorded());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.address, "0xc6d52922f6f6ddd9de2bf49b3208d56f167e4c0c");
  /* What the deposit loses: 10 in, 9.973115 out — not the sum of `fees`, where `relayer` already holds its parts. */
  assert.equal(parsed.value.feeUsd, 0.03);
  assert.equal(parsed.value.seconds, 1);
  /* BNB Chain's USDC has eighteen decimals on the way in and six on the way out. */
  const bnb = recorded();
  bnb.details.currencyIn = { currency: { chainId: 56, address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" }, amount: "10000000000000000000" };
  bnb.details.currencyOut.amount = "9944770";
  assert.equal(parseDepositAddress("bnb", RECIPIENT, bnb).value.feeUsd, 0.06);
});

test("an answer that would pay anyone else, or carry anything else, shows no address", () => {
  assert.deepEqual(parseDepositAddress("base", RECIPIENT, recorded({ steps: [] })), { ok: false, reason: "NO_ADDRESS" });
  assert.deepEqual(parseDepositAddress("base", "11111111111111111111111111111111", recorded()), { ok: false, reason: "WRONG_RECIPIENT" });
  assert.deepEqual(parseDepositAddress("ethereum", RECIPIENT, recorded()), { ok: false, reason: "WRONG_ROUTE" });
  const otherOut = recorded();
  otherOut.details.currencyOut.currency.address = "So11111111111111111111111111111111111111112";
  assert.deepEqual(parseDepositAddress("base", RECIPIENT, otherOut), { ok: false, reason: "WRONG_ROUTE" });
  const refundElsewhere = recorded();
  refundElsewhere.protocol.v2.orderData.inputs[0].refunds[0] = { chainId: "base", recipient: "0xabc" };
  assert.deepEqual(parseDepositAddress("base", RECIPIENT, refundElsewhere), { ok: false, reason: "WRONG_REFUND" });
  assert.deepEqual(parseDepositAddress("base", RECIPIENT, null), { ok: false, reason: "NO_ADDRESS" });
});

test("Relay's request states collapse into four a person reads, and unknown is never «arrived»", () => {
  assert.equal(depositProgressOf({ requests: [] }).progress, "NONE");
  assert.equal(depositProgressOf({ requests: [{ status: "waiting" }] }).progress, "ON_THE_WAY");
  assert.equal(depositProgressOf({ requests: [{ status: "pending" }] }).progress, "ON_THE_WAY");
  assert.equal(depositProgressOf({ requests: [{ status: "something-new" }] }).progress, "ON_THE_WAY");
  assert.equal(depositProgressOf({ requests: [{ status: "refund" }] }).progress, "REFUNDED");
  assert.equal(depositProgressOf({ requests: [{ status: "failure" }] }).progress, "FAILED");
  const done = depositProgressOf({ requests: [{ status: "success", createdAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T10:01:00Z", data: { route: { actual: { destination: { outputCurrency: { amountFormatted: "9.97" } } } } } }] });
  assert.deepEqual(done, { progress: "ARRIVED", amount: "9.97", at: "2026-10-20T10:00:00Z" });
});

test("the progress read asks only for deposits made since the address was shown, newest first", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync(new URL("../../app/api/swap/deposit-address/route.ts", import.meta.url), "utf8");
  for (const param of ['"startTimestamp", String(since)', '"sortBy", "createdAt"', '"sortDirection", "desc"']) assert.ok(route.includes(param), param);
  const block = readFileSync(new URL("../../app/app/top-up/network-deposit.tsx", import.meta.url), "utf8");
  assert.match(block, /&since=\$\{since\}/);
  assert.match(block, /deposit\.network === network && deposit\.recipient === recipient/, "never the last address under a new network's name");
});
