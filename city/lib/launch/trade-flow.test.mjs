import assert from "node:assert/strict";
import test from "node:test";

import { STUB_CREATOR, STUB_WALLET, stubAddress, stubEngine, stubWallet } from "./stub.ts";
import { BUILD_AGED, BUILD_UNEXPECTED, TRADE_CLOSED, WALLET_REFUSED, awaitReceipt, buildMatches, runLaunchTrade } from "./trade-flow.ts";
import { stubTradeEngine } from "./trade-stub.ts";

const SPARK = stubAddress("SPARK");
const MOTH = stubAddress("MOTH");
const signer = (options) => stubWallet(options).signer({ wallet: STUB_WALLET, address: STUB_CREATOR });

function stand(overrides = {}) {
  const launch = stubEngine();
  return stubTradeEngine({ market: (token) => launch.market(token), ...overrides });
}

async function trade(overrides = {}) {
  const phases = [];
  const engine = overrides.engine ?? stand();
  const order = { token: SPARK, side: "buy", amountRaw: "25000000", slippageBps: 300, ...(overrides.order ?? {}) };
  const result = await runLaunchTrade({ engine, signer: overrides.signer ?? signer(), order, network: "solana:devnet", open: overrides.open ?? true, onPhase: (phase) => phases.push(phase), now: overrides.now });
  return { result, phases, steps: phases.map((phase) => phase.step), engine };
}

test("a buy on the curve: build → one signature → send, and what it filled comes back", async () => {
  const { result, steps, engine, phases } = await trade();
  assert.deepEqual(steps, ["build", "sign", "send", "done"]);
  assert.deepEqual(engine.calls, ["build", "submit"]);
  assert.equal(result.done.side, "buy");
  assert.equal(result.done.state, "CONFIRMED");
  assert.equal(result.done.filled.pairRaw, "25000000");
  assert.ok(BigInt(result.done.filled.tokensRaw) > 0n);
  assert.ok(BigInt(result.done.feeRaw) > 0n);
  const sign = phases.find((phase) => phase.step === "sign");
  assert.equal(sign.wallet, STUB_WALLET);
  assert.ok(BigInt(sign.minimumOutRaw) > 0n, "the wallet's step shows the least it lands with");
});

test("a sale in the graduated pool, after a buy: the same window, the same flow", async () => {
  const engine = stand();
  const bought = await trade({ engine, order: { token: MOTH } });
  assert.equal(bought.result.step, "done");
  const sold = await trade({ engine, order: { token: MOTH, side: "sell", amountRaw: bought.result.done.filled.tokensRaw } });
  assert.equal(sold.result.step, "done");
  assert.equal(sold.result.done.side, "sell");
  const held = await engine.wallet(MOTH, STUB_CREATOR);
  assert.equal(held.data.tokenRaw, "0");
});

test("closed here: nothing is built, nothing is asked of the wallet", async () => {
  const { result, engine } = await trade({ open: false });
  assert.equal(result.failure.code, TRADE_CLOSED);
  assert.deepEqual(engine.calls, []);
});

test("the wallet declines: nothing is sent", async () => {
  const { result, engine } = await trade({ signer: signer({ refuse: true }) });
  assert.equal(result.failure.code, WALLET_REFUSED);
  assert.equal(result.failure.stage, "before");
  assert.deepEqual(engine.calls, ["build"]);
});

test("the engine's refusal is said in its own code, before anything is signed", async () => {
  const { result, engine } = await trade({ order: { amountRaw: "900000000" } });
  assert.equal(result.failure.code, "LAUNCH_BALANCE_LOW");
  assert.deepEqual(engine.calls, ["build"]);
});

test("a build that is not the chosen trade is never put before the wallet", () => {
  const order = { token: SPARK, side: "buy", amountRaw: "25000000", slippageBps: 300 };
  const built = (quote, network = "solana:devnet") => ({ network, quote: { side: "buy", slippageBps: 300, amountInRaw: "25000000", amountOutRaw: "100", minimumOutRaw: "97", ...quote } });
  assert.equal(buildMatches(built({}), order, "solana:devnet"), true);
  assert.equal(buildMatches(built({ amountInRaw: "20000000" }), order, "solana:devnet"), true, "a curve near its exit may take less");
  assert.equal(buildMatches(built({}, "solana:mainnet"), order, "solana:devnet"), false);
  assert.equal(buildMatches(built({ side: "sell" }), order, "solana:devnet"), false);
  assert.equal(buildMatches(built({ slippageBps: 5000 }), order, "solana:devnet"), false);
  assert.equal(buildMatches(built({ amountInRaw: "25000001" }), order, "solana:devnet"), false);
  assert.equal(buildMatches(built({ minimumOutRaw: "0" }), order, "solana:devnet"), false);
  assert.equal(buildMatches(built({ minimumOutRaw: "101" }), order, "solana:devnet"), false);
});

test("bytes signed after their life are not sent: the engine builds again and the wallet is asked once more", async () => {
  let clock = 0;
  const slowSigner = {
    wallet: STUB_WALLET,
    address: STUB_CREATOR,
    sign: async (wires) => {
      clock += 40_000;
      return { ok: true, signed: wires };
    },
  };
  const { result, steps, engine } = await trade({ signer: slowSigner, now: () => clock });
  assert.equal(result.failure.code, BUILD_AGED);
  assert.deepEqual(steps, ["build", "sign", "build", "sign", "failed"]);
  assert.deepEqual(engine.calls, ["build", "build"]);
});

test("a build for another trade stops before the wallet", async () => {
  const engine = stand();
  const original = engine.build;
  engine.build = async (token, body) => {
    const answer = await original(token, body);
    return answer.ok ? { ok: true, data: { ...answer.data, network: "solana:mainnet" } } : answer;
  };
  const { result, steps } = await trade({ engine });
  assert.equal(result.failure.code, BUILD_UNEXPECTED);
  assert.deepEqual(steps, ["build", "failed"]);
});

test("the receipt is asked until the chain answers; SENT is never read as failed", async () => {
  const states = ["SENT", "SENT", "DONE"];
  const engine = { receipt: async () => ({ ok: true, data: { signature: "s", state: states.shift(), receipt: null } }) };
  const done = await awaitReceipt({ engine, token: SPARK, wallet: STUB_CREATOR, signature: "s", sleep: async () => undefined });
  assert.equal(done.state, "DONE");
  const quiet = { receipt: async () => ({ ok: true, data: { signature: "s", state: "SENT", receipt: null } }) };
  const waiting = await awaitReceipt({ engine: quiet, token: SPARK, wallet: STUB_CREATOR, signature: "s", tries: 2, sleep: async () => undefined });
  assert.equal(waiting.state, "SENT");
});
