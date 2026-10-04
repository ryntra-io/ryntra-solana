// Run from repo root: node --test lib/core/solana-swap/fee-route.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { chooseExecutableOrder, chooseQuote, feePolicyInForce, orderSignableByTaker } from "./fee-route.server.ts";

const TAKER = "Taker111111111111111111111111111111111111111";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CONFIG = { jupiterReferralAccount: null, relayAppFeeRecipient: null, mayanReferrerSolana: null };
const REFERRAL = { account: "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv", feeBps: 50 };
const FEE = { bps: 10, side: "INPUT", mint: WSOL, owner: "5sWCoxARMPyGdqTu9ru6z69REZ1ZZLojcb1rfABDP2Ne", account: "4kbERimV3PwxwiL72n1NBRpX5HG2Mwja1QNhb4yEp578", decimals: 9, symbol: "SOL" };
const ARGS = { inputMint: WSOL, outputMint: USDC, amountRaw: "1000000000", taker: TAKER, carrier: "site", endpoint: {}, handle: {}, config: CONFIG };

const built = (out, bps) => ({ ok: true, answer: { quote: { path: "BUILD_SUBMIT", inputMint: WSOL, inAmountRaw: "1000000000", outAmountRaw: out, inUsdValue: null, ryntraFee: { mechanism: bps > 0 ? "JUPITER_PLATFORM_FEE" : "NONE", state: bps > 0 ? "QUOTED" : "NONE", basisPoints: bps } } } });
const ordered = (out, bps, extra = {}) => ({
  ok: true,
  order: { path: "ORDER_EXECUTE", inputMint: WSOL, inAmountRaw: "1000000000", outAmountRaw: out, inUsdValue: "121.3", gasless: false, signatureFeePayer: TAKER, priorityFeePayer: TAKER, taker: TAKER, ryntraFee: { mechanism: "JUPITER_REFERRAL", state: bps > 0 ? "QUOTED" : "UNCONFIGURED", basisPoints: bps }, ...extra },
});
const assembledFrom = async (answer) => ({ ok: true, order: { ...answer.quote, schema: "ryntra.solana.jupiter-executable-order", taker: TAKER } });

function world({ flow = "MAJOR", fee = { ok: true, fee: FEE }, referral = null, build, order, assemble = assembledFrom, policy = "v2" }) {
  const calls = { build: 0, order: [], fee: 0 };
  return {
    calls,
    deps: {
      policy,
      flow: async () => flow,
      fee: async () => ((calls.fee += 1), fee),
      referral: async () => referral,
      fetchBuild: async () => ((calls.build += 1), build),
      fetchOrder: async (request) => (calls.order.push(request.referral), order),
      fetchQuote: async (request) => (calls.order.push(request.referral), order),
      assemble,
    },
  };
}

test("the operator's switch: as-now unless it says otherwise", () => {
  assert.equal(feePolicyInForce({}), "v2");
  assert.equal(feePolicyInForce({ RYNTRA_FEE_POLICY: "as-now" }), "as-now");
  assert.equal(feePolicyInForce({ RYNTRA_FEE_POLICY: "anything" }), "v2");
});

test("as-now and the phone take /order with the referral as production did, and ask /build nothing", async () => {
  for (const variant of [{ policy: "as-now", carrier: "site" }, { policy: "v2", carrier: "bearer" }]) {
    const { deps, calls } = world({ policy: variant.policy, referral: REFERRAL, build: built("1", 10), order: ordered("121000000", 50) });
    const choice = await chooseExecutableOrder({ ...ARGS, carrier: variant.carrier }, deps);
    assert.deepEqual([choice.ok, choice.lane, choice.flow, calls.build, calls.fee], [true, "ORDER", "AS_NOW", 0, 0]);
    assert.deepEqual(calls.order, [REFERRAL]);
  }
});

test("a major on /build when the router's price with Ryntra's fee is the better one; the input's dollar figure is /order's for the same amount", async () => {
  const { deps } = world({ build: built("121000000", 10), order: ordered("121100000", 0) });
  const choice = await chooseExecutableOrder(ARGS, deps);
  assert.deepEqual([choice.lane, choice.order.path, choice.order.inUsdValue], ["BUILD", "BUILD_SUBMIT", "121.3"]);
});

test("/order with no fee wins only when it pays the person more than Ryntra's whole fee", async () => {
  /* 10 bps of 121 000 000 ≈ 121 121: /order must beat 121 121 121. */
  const { deps } = world({ build: built("121000000", 10), order: ordered("121200000", 0) });
  const choice = await chooseExecutableOrder(ARGS, deps);
  assert.deepEqual([choice.lane, choice.order.path], ["ORDER", "ORDER_EXECUTE"]);
});

test("a meme token: /order with the same 1 % referral wins only past Jupiter's fifth of the fee", async () => {
  const memeReferral = { ...REFERRAL, feeBps: 100 };
  const close = world({ flow: "MEME", referral: memeReferral, build: built("1000000", 100), order: ordered("1002000", 100) });
  assert.equal((await chooseExecutableOrder(ARGS, close.deps)).lane, "BUILD");
  assert.deepEqual(close.calls.order, [memeReferral], "the referral asks the flow's rate");
  const far = world({ flow: "MEME", referral: memeReferral, build: built("1000000", 100), order: ordered("1002100", 100) });
  assert.equal((await chooseExecutableOrder(ARGS, far.deps)).lane, "ORDER");
});

test("an /order this lane cannot sign never wins: gasless, or a fee paid by somebody else", async () => {
  for (const extra of [{ gasless: true }, { signatureFeePayer: "MarketMaker1111111111111111111111111111111111" }]) {
    const { deps } = world({ build: built("121000000", 10), order: ordered("130000000", 0, extra) });
    assert.equal((await chooseExecutableOrder(ARGS, deps)).lane, "BUILD");
  }
  assert.equal(orderSignableByTaker({ gasless: false, signatureFeePayer: null, priorityFeePayer: null, taker: TAKER }), true);
});

test("no fee account for the fee: /order alone, /build never asked", async () => {
  const { deps, calls } = world({ fee: { ok: false, reason: "The fee wallet has no account for this mint." }, build: built("1", 10), order: ordered("121000000", 0) });
  const choice = await chooseExecutableOrder(ARGS, deps);
  assert.deepEqual([choice.lane, calls.build], ["ORDER", 0]);
});

test("Ondo and PreStocks are /order flows: the router is never asked", async () => {
  for (const flow of ["ONDO", "PRESTOCK", "AS_NOW"]) {
    const { deps, calls } = world({ flow, referral: REFERRAL, build: built("1", 10), order: ordered("5000000", 50) });
    const choice = await chooseExecutableOrder(ARGS, deps);
    assert.deepEqual([choice.lane, calls.build, calls.fee], ["ORDER", 0, 0], flow);
  }
});

test("when the router has no route or its bytes do not assemble, /order is the swap; when neither answers, the router's own refusal", async () => {
  const noRoute = world({ build: { ok: false, code: "NO_ROUTE", reason: "none" }, order: ordered("121000000", 0) });
  assert.equal((await chooseExecutableOrder(ARGS, noRoute.deps)).lane, "ORDER");
  const notAssembled = world({ build: built("121000000", 10), order: ordered("120000000", 0), assemble: async () => ({ ok: false, code: "BUILD_FAILED", reason: "does not simulate" }) });
  assert.equal((await chooseExecutableOrder(ARGS, notAssembled.deps)).lane, "ORDER");
  const neither = world({ build: built("121000000", 10), order: { ok: false, code: "NO_ROUTE", reason: "none" }, assemble: async () => ({ ok: false, code: "BUILD_FAILED", reason: "does not simulate" }) });
  const refused = await chooseExecutableOrder(ARGS, neither.deps);
  assert.deepEqual([refused.ok, refused.failure.code], [false, "BUILD_FAILED"]);
});

test("the card's quote takes the same decision, and carries no bytes", async () => {
  const better = world({ build: built("121000000", 10), order: ordered("121100000", 0) });
  const quote = await chooseQuote({ ...ARGS, selection: { ok: true, access: "production" } }, better.deps);
  assert.deepEqual([quote.lane, quote.order.path, quote.order.inUsdValue], ["BUILD", "BUILD_SUBMIT", "121.3"]);
  const worse = world({ build: built("121000000", 10), order: ordered("121200000", 0) });
  assert.equal((await chooseQuote({ ...ARGS, selection: { ok: true, access: "production" } }, worse.deps)).lane, "ORDER");
  const keyless = world({ build: built("121000000", 10), order: ordered("121000000", 0) });
  const degraded = await chooseQuote({ ...ARGS, selection: { ok: true, access: "degraded" } }, keyless.deps);
  assert.deepEqual([degraded.lane, keyless.calls.build], ["ORDER", 0], "the keyless lane never asks /build");
});

test("a stock the catalogue could not be asked about is still known by the stock universe", async () => {
  const { readSideFacts, flowOfSwap } = await import("./fee-route.server.ts");
  const busy = async () => ({ ok: false, code: "RATE_LIMITED", reason: "spent" });
  const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
  assert.deepEqual(await readSideFacts(NVDAX, busy, async () => "xstocks"), { mint: NVDAX, verified: true, tags: ["xstocks"], firstPoolAt: null });
  assert.equal(await readSideFacts(NVDAX, busy, async () => null), null, "neither witness: unread");
  assert.equal(await flowOfSwap("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", NVDAX, { read: busy, stock: async () => "xstocks" }), "XSTOCK");
});

test("the owner's simulated output: a token's delta, or SOL with the fee and the rent it paid", async () => {
  const { takerOutputOf } = await import("../solana-swap/guard.ts");
  const proof = { ownerTokenDeltas: [{ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", rawDelta: "3309971" }, { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", rawDelta: "-10000000" }], takerLamportDelta: "-5382", feeLamports: "5382", durableRentLamports: "0" };
  assert.equal(takerOutputOf(proof, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), "3309971");
  const sol = { ownerTokenDeltas: [{ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", rawDelta: "-1000000" }], takerLamportDelta: "8183000", feeLamports: "5382", durableRentLamports: "0" };
  assert.equal(takerOutputOf(sol, "So11111111111111111111111111111111111111112"), "8188382");
  assert.equal(takerOutputOf({ ...proof, ownerTokenDeltas: [] }, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), null);
});

test("dollar to dollar on /order says no fee is charged, never «not configured»", async () => {
  const unconfigured = { ...ordered("5000816", 0), order: { ...ordered("5000816", 0).order, ryntraFee: { mechanism: "JUPITER_REFERRAL", state: "UNCONFIGURED", basisPoints: 0, note: "No Jupiter referral account is configured" } } };
  const { deps } = world({ flow: "STABLE", fee: { ok: true, fee: null }, build: built("5000000", 0), order: unconfigured });
  const choice = await chooseExecutableOrder(ARGS, deps);
  assert.deepEqual([choice.lane, choice.order.ryntraFee.state, choice.order.ryntraFee.mechanism], ["ORDER", "NONE", "NONE"]);
});
