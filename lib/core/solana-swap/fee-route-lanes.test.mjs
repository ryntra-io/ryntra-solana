// Run from repo root: node --test lib/core/solana-swap/fee-route-lanes.test.mjs
// The quote asks over the signable order's routers, and the lanes switch (swap speed, 18.11).
import assert from "node:assert/strict";
import test from "node:test";

import { chooseExecutableOrder, chooseQuote, inputDollarsOf, QUOTE_EXCLUDED_ROUTERS, swapLanesInForce } from "./fee-route.server.ts";

const TAKER = "Taker111111111111111111111111111111111111111";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CONFIG = { jupiterReferralAccount: null, relayAppFeeRecipient: null, mayanReferrerSolana: null };
const FEE = { bps: 10, side: "INPUT", mint: WSOL, owner: "5sWCoxARMPyGdqTu9ru6z69REZ1ZZLojcb1rfABDP2Ne", account: "4kbERimV3PwxwiL72n1NBRpX5HG2Mwja1QNhb4yEp578", decimals: 9, symbol: "SOL" };
const ORDER_ARGS = { inputMint: WSOL, outputMint: USDC, amountRaw: "1000000000", taker: TAKER, endpoint: {}, handle: {}, config: CONFIG };
const QUOTE_ARGS = { inputMint: WSOL, outputMint: USDC, amountRaw: "1000000000", selection: { ok: true, access: "production" }, handle: {}, config: CONFIG };

const built = (out, bps) => ({ ok: true, answer: { quote: { path: "BUILD_SUBMIT", inputMint: WSOL, inAmountRaw: "1000000000", outAmountRaw: out, inUsdValue: null, ryntraFee: { mechanism: "JUPITER_PLATFORM_FEE", state: "QUOTED", basisPoints: bps } } } });
const ordered = (out) => ({
  ok: true,
  order: { path: "ORDER_EXECUTE", inputMint: WSOL, inAmountRaw: "1000000000", outAmountRaw: out, inUsdValue: "121.3", gasless: false, signatureFeePayer: TAKER, priorityFeePayer: TAKER, taker: TAKER, ryntraFee: { mechanism: "JUPITER_REFERRAL", state: "UNCONFIGURED", basisPoints: 0 } },
});
const refused = (code) => ({ ok: false, code, reason: code, errorCode: null, status: code === "RATE_LIMITED" ? 429 : 400, access: "production", router: null });
const assembledFrom = async (answer) => ({ ok: true, order: { ...answer.quote, schema: "ryntra.solana.jupiter-executable-order", taker: TAKER } });

function world({ lanes = "both", build, order, assemble = assembledFrom }) {
  const calls = { build: 0, order: 0, excluded: [] };
  return {
    calls,
    deps: {
      policy: "v2",
      lanes,
      flow: async () => "MAJOR",
      fee: async () => ({ ok: true, fee: FEE }),
      referral: async () => null,
      fetchBuild: async () => ((calls.build += 1), build),
      fetchOrder: async () => ((calls.order += 1), order),
      fetchQuote: async (request) => ((calls.order += 1), calls.excluded.push(request.excludeRouters ?? []), order),
      assemble,
      dollars: async () => null,
    },
  };
}

test("the quote asks /order over the routers the signable order may take: JupiterZ never prices a swap it cannot build", async () => {
  assert.deepEqual(QUOTE_EXCLUDED_ROUTERS, ["jupiterz"]);
  const { deps, calls } = world({ lanes: "both", build: built("121000000", 10), order: ordered("121000000") });
  await chooseQuote(QUOTE_ARGS, deps);
  assert.deepEqual(calls.excluded, [["jupiterz"]]);
  const asNow = world({ lanes: "both", build: built("1", 10), order: ordered("121000000") });
  await chooseQuote(QUOTE_ARGS, { ...asNow.deps, policy: "as-now" });
  assert.deepEqual(asNow.calls.excluded, [["jupiterz"]]);
});

test("the lanes switch: /build alone unless it says both (the rollback)", () => {
  assert.equal(swapLanesInForce({}), "build");
  assert.equal(swapLanesInForce({ RYNTRA_SWAP_LANES: "both" }), "both");
  assert.equal(swapLanesInForce({ RYNTRA_SWAP_LANES: " both " }), "both");
  assert.equal(swapLanesInForce({ RYNTRA_SWAP_LANES: "order" }), "build");
});

test("the input's dollar value under /build alone: a dollar coin is its amount, another coin the market's price, else none", async () => {
  assert.equal(await inputDollarsOf(USDC, "1500000", async () => assert.fail("a dollar coin asks nothing")), "1.500000");
  assert.equal(await inputDollarsOf(WSOL, "2000000000", async () => ({ ok: true, market: { price: 140.5, decimals: 9 } })), "281.000000");
  assert.equal(await inputDollarsOf(WSOL, "2000000000", async () => ({ ok: true, market: { price: null, decimals: 9 } })), null);
  assert.equal(await inputDollarsOf(WSOL, "2000000000", async () => ({ ok: false })), null);
  assert.equal(await inputDollarsOf("Mint1111111111111111111111111111111111111111", "5", async () => ({ ok: true, market: { price: 1, decimals: null } })), null);
});

test("/build alone carries the input's dollar value into the quote and the order", async () => {
  for (const choose of [chooseQuote, chooseExecutableOrder]) {
    const { deps } = world({ lanes: "build", build: built("121000000", 10), order: ordered("121200000") });
    const choice = await choose(choose === chooseQuote ? QUOTE_ARGS : ORDER_ARGS, { ...deps, dollars: async () => "140.500000" });
    assert.equal(choice.order.inUsdValue, "140.500000", choose.name);
  }
});

test("both lanes: a MAJOR price and order ask Jupiter twice, and /order may win with no Ryntra fee", async () => {
  for (const choose of [chooseQuote, chooseExecutableOrder]) {
    const { deps, calls } = world({ lanes: "both", build: built("121000000", 10), order: ordered("121200000") });
    const choice = await choose(choose === chooseQuote ? QUOTE_ARGS : ORDER_ARGS, deps);
    assert.deepEqual([calls.build, calls.order, choice.lane], [1, 1, "ORDER"], choose.name);
  }
});

test("build alone: one Jupiter request a price and an order, and the flow's fee on every swap", async () => {
  for (const choose of [chooseQuote, chooseExecutableOrder]) {
    const { deps, calls } = world({ lanes: "build", build: built("121000000", 10), order: ordered("121200000") });
    const choice = await choose(choose === chooseQuote ? QUOTE_ARGS : ORDER_ARGS, deps);
    assert.deepEqual([calls.build, calls.order, choice.lane], [1, 0, "BUILD"], choose.name);
    assert.equal(choice.order.ryntraFee.basisPoints, 10);
  }
});

test("build alone: /order stands in when the router has no route, never for a full request window", async () => {
  for (const choose of [chooseQuote, chooseExecutableOrder]) {
    const args = choose === chooseQuote ? QUOTE_ARGS : ORDER_ARGS;
    const noRoute = world({ lanes: "build", build: refused("NO_ROUTE"), order: ordered("121000000") });
    const stood = await choose(args, noRoute.deps);
    assert.deepEqual([noRoute.calls.order, stood.ok, stood.lane], [1, true, "ORDER"], choose.name);
    const busy = world({ lanes: "build", build: refused("RATE_LIMITED"), order: ordered("121000000") });
    const said = await choose(args, busy.deps);
    assert.deepEqual([busy.calls.order, said.ok, said.failure.code], [0, false, "RATE_LIMITED"], choose.name);
  }
});

test("build alone: bytes that would not assemble are swapped by /order, asked then", async () => {
  const { deps, calls } = world({ lanes: "build", build: built("121000000", 10), order: ordered("121000000"), assemble: async () => refused("BUILD_FAILED") });
  const choice = await chooseExecutableOrder(ORDER_ARGS, deps);
  assert.deepEqual([calls.order, choice.ok, choice.lane], [1, true, "ORDER"]);
});
