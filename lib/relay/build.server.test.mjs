import assert from "node:assert/strict";
import test from "node:test";

import { buildRelayEvmCalls, RELAY_ROBINHOOD_DEPOSITORY, RELAY_SOLANA_DEPOSITORY_PROGRAM } from "./build.server.ts";

/**
 * These tests exist for one reason: this module decides what a wallet is asked
 * to sign. Every case below is a plan that looks ordinary and points somewhere
 * it should not, and the assertion is always that nothing is built.
 */

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const OWNER = "0x000000000000000000000000000000000000dEaD";
const AMOUNT = "100000000";

/** `approve(depository, 100000000)`, encoded the way Relay encodes it. */
const approveCallData = (spender = RELAY_ROBINHOOD_DEPOSITORY, amount = BigInt(AMOUNT)) =>
  `0x095ea7b3${spender.slice(2).toLowerCase().padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;

const evmStep = (id, to, data, value = "0") => ({
  id,
  kind: "transaction",
  items: [{ status: "incomplete", data: { from: OWNER, to, data, value, chainId: 4663, gas: "80319", maxFeePerGas: "262833200" } }],
});

const quoteWith = (steps) => ({ requestId: "0x" + "1".repeat(64), steps, details: { currencyIn: {}, currencyOut: {} } });

/** A handle whose reads never happen, because every case here fails first. */
const deadHandle = { chain: { id: "robinhood", chainId: 4663 }, endpoints: [], timeoutMs: 1, fetchImpl: async () => new Response("{}") };

test("a deposit that does not target Relay's published depository is refused", async () => {
  const result = await buildRelayEvmCalls({
    quote: quoteWith([evmStep("deposit", "0x1111111111111111111111111111111111111111", "0xdeadbeef")]),
    owner: OWNER,
    chainId: 4663,
    handle: deadHandle,
    inputToken: null,
    amountRaw: AMOUNT,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNEXPECTED_TARGET");
});

test("a call built for another chain is refused even when its target is right", async () => {
  const result = await buildRelayEvmCalls({
    quote: quoteWith([{ id: "deposit", kind: "transaction", items: [{ status: "incomplete", data: { from: OWNER, to: RELAY_ROBINHOOD_DEPOSITORY, data: "0xdeadbeef", value: "0", chainId: 8453 } }] }]),
    owner: OWNER,
    chainId: 4663,
    handle: deadHandle,
    inputToken: null,
    amountRaw: AMOUNT,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ROUTE_SHAPE");
});

test("an approval naming a spender other than the depository is refused", async () => {
  const result = await buildRelayEvmCalls({
    quote: quoteWith([
      evmStep("approve", USDG, approveCallData("0x2222222222222222222222222222222222222222")),
      evmStep("deposit", RELAY_ROBINHOOD_DEPOSITORY, "0xdeadbeef"),
    ]),
    owner: OWNER,
    chainId: 4663,
    handle: deadHandle,
    inputToken: USDG,
    amountRaw: AMOUNT,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNEXPECTED_TARGET");
});

test("an unlimited approval is refused — the approval may never exceed what the swap spends", async () => {
  const unlimited = (1n << 256n) - 1n;
  const result = await buildRelayEvmCalls({
    quote: quoteWith([
      evmStep("approve", USDG, approveCallData(RELAY_ROBINHOOD_DEPOSITORY, unlimited)),
      evmStep("deposit", RELAY_ROBINHOOD_DEPOSITORY, "0xdeadbeef"),
    ]),
    owner: OWNER,
    chainId: 4663,
    handle: deadHandle,
    inputToken: USDG,
    amountRaw: AMOUNT,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNEXPECTED_TARGET");
});

test("an approval pointed at a contract other than the token being spent is refused", async () => {
  const result = await buildRelayEvmCalls({
    quote: quoteWith([
      evmStep("approve", "0x3333333333333333333333333333333333333333", approveCallData()),
      evmStep("deposit", RELAY_ROBINHOOD_DEPOSITORY, "0xdeadbeef"),
    ]),
    owner: OWNER,
    chainId: 4663,
    handle: deadHandle,
    inputToken: USDG,
    amountRaw: AMOUNT,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNEXPECTED_TARGET");
});

test("an approval offered for a native-coin swap is refused", async () => {
  const result = await buildRelayEvmCalls({
    quote: quoteWith([
      evmStep("approve", USDG, approveCallData()),
      evmStep("deposit", RELAY_ROBINHOOD_DEPOSITORY, "0xdeadbeef"),
    ]),
    owner: OWNER,
    chainId: 4663,
    handle: deadHandle,
    inputToken: null,
    amountRaw: AMOUNT,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ROUTE_SHAPE");
});

test("the pinned depositories are the ones Relay publishes", () => {
  /* Read from `protocol.v2.depository` in Relay's own chain list on 2026-09-09
     and matched against three live quotes. A change here is a decision, not a
     refactor: it moves the target of a signature. */
  assert.equal(RELAY_ROBINHOOD_DEPOSITORY, "0x4cd00e387622c35bddb9b4c962c136462338bc31");
  assert.equal(RELAY_SOLANA_DEPOSITORY_PROGRAM, "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2");
  assert.equal(RELAY_ROBINHOOD_DEPOSITORY, RELAY_ROBINHOOD_DEPOSITORY.toLowerCase(), "compared lower-cased against a step's target");
});
