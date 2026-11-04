import assert from "node:assert/strict";
import test from "node:test";

import { LaunchClaimSubmitRequestSchema, LaunchTradeBuildRequestSchema, LaunchTradeQuoteRequestSchema, LaunchTradeSubmitRequestSchema } from "../../../lib/api/v1/contract.ts";
import { CURVE_SLIPPAGE_BPS, runClaim, runCurveTrade, tradeFailureWords } from "./curve.ts";
import { API_HEADERS, httpEngine } from "./engine.ts";
import { BUILD_UNEXPECTED, CITY_CLOSED, WALLET_REFUSED, runLaunch } from "./flow.ts";
import { STUB_CLAIM_RAW, STUB_CREATOR, STUB_PRESETS, STUB_WALLET, stubEngine, stubWallet } from "./stub.ts";

const BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const signer = (options) => stubWallet(options).signer({ wallet: STUB_WALLET, address: STUB_CREATOR });

/** A coin launched on the stand by the stub wallet: the creator's own tower. */
async function launched(engine) {
  const result = await runLaunch({
    engine,
    signer: signer(),
    fields: { name: "Kite", symbol: "KITE", picture: { base64: BASE64, url: "" } },
    preset: STUB_PRESETS[0],
    network: "solana:devnet",
    onPhase: () => undefined,
    switchOpen: true,
  });
  assert.equal(result.step, "done");
  return result.liftoff.token;
}

async function trade(engine, token, side, amountRaw, overrides = {}) {
  const phases = [];
  const result = await runCurveTrade({ engine, signer: signer(), token, side, amountRaw, network: "solana:devnet", onPhase: (phase) => phases.push(phase), switchOpen: true, ...overrides });
  return { result, steps: phases.map((phase) => phase.step) };
}

test("create → buy on the curve → sell → the creator claims: the whole devnet flow through the engine's routes", async () => {
  const engine = stubEngine();
  const token = await launched(engine);

  const buy = await trade(engine, token, "buy", "5000000");
  assert.deepEqual(buy.steps, ["build", "sign", "send", "done"]);
  assert.equal(buy.result.fill.side, "buy");
  assert.equal(buy.result.fill.state, "CONFIRMED");
  assert.equal(buy.result.fill.pairRaw, "5000000");
  assert.ok(BigInt(buy.result.fill.tokensRaw) > 0n);

  const held = await engine.holdings(token, STUB_CREATOR);
  assert.equal(held.data.tokenRaw, buy.result.fill.tokensRaw);
  const half = (BigInt(held.data.tokenRaw) / 2n).toString();
  const sell = await trade(engine, token, "sell", half);
  assert.equal(sell.result.step, "done");
  assert.equal(sell.result.fill.tokensRaw, half);

  const review = await engine.claimReview(token, STUB_CREATOR);
  assert.equal(review.data.expectedRaw, STUB_CLAIM_RAW);
  const phases = [];
  const claim = await runClaim({ engine, signer: signer(), token, network: "solana:devnet", onPhase: (phase) => phases.push(phase), switchOpen: true });
  assert.deepEqual(phases.map((phase) => phase.step), ["build", "sign", "send", "done"]);
  assert.equal(phases[1].transactions, 1);
  assert.equal(claim.claimed.state, "CONFIRMED");
  assert.equal(claim.claimed.receivedRaw, STUB_CLAIM_RAW);
  assert.equal(claim.claimed.signatures.length, 1);

  /* Claimed once: nothing waits, and the engine's refusal reads in the card's words. */
  const again = await runClaim({ engine, signer: signer(), token, network: "solana:devnet", onPhase: () => undefined, switchOpen: true });
  assert.equal(again.failure.code, "LAUNCH_NOTHING_TO_CLAIM");
  assert.equal(tradeFailureWords(again.failure), "Nothing waits to be claimed right now.");
  assert.deepEqual(engine.calls.filter((call) => call.startsWith("trade") || call.startsWith("claim")), ["tradeBuild", "tradeSubmit", "tradeBuild", "tradeSubmit", "claimReview", "claimBuild", "claimSubmit", "claimBuild"]);
});

test("closed where the city's Launch is closed: nothing is asked of the engine", async () => {
  const engine = stubEngine();
  for (const [network, switchOpen, ownerWord] of [
    ["solana:devnet", false, undefined],
    ["solana:mainnet", true, false],
  ]) {
    const { result } = await trade(engine, "So11111111111111111111111111111111111111112", "buy", "1000", { network, switchOpen, ownerWord });
    assert.equal(result.failure.code, CITY_CLOSED);
    const claim = await runClaim({ engine, signer: signer(), token: "So11111111111111111111111111111111111111112", network, onPhase: () => undefined, switchOpen, ownerWord });
    assert.equal(claim.failure.code, CITY_CLOSED);
  }
  assert.deepEqual(engine.calls, []);
});

test("a zero or malformed amount is never built", async () => {
  const engine = stubEngine();
  for (const amount of ["0", "", "1.5", "-3"]) {
    const { result } = await trade(engine, "So11111111111111111111111111111111111111112", "buy", amount);
    assert.equal(result.failure.code, "VALIDATION_ERROR", amount);
  }
  assert.deepEqual(engine.calls, []);
});

test("a wallet that does not sign sends nothing; bytes for another network or side never reach the wallet", async () => {
  const engine = stubEngine();
  const token = await launched(engine);
  const refused = await runCurveTrade({ engine, signer: signer({ refuse: true }), token, side: "buy", amountRaw: "1000000", network: "solana:devnet", onPhase: () => undefined, switchOpen: true });
  assert.equal(refused.failure.code, WALLET_REFUSED);
  assert.ok(!engine.calls.includes("tradeSubmit"));

  const real = stubEngine();
  const coin = await launched(real);
  for (const change of [(data) => ({ ...data, network: "solana:mainnet" }), (data) => ({ ...data, quote: { ...data.quote, side: "sell" } })]) {
    let signed = 0;
    const odd = { ...real, tradeBuild: async (...args) => {
      const answer = await real.tradeBuild(...args);
      return answer.ok ? { ok: true, data: change(answer.data) } : answer;
    } };
    const counting = { wallet: STUB_WALLET, address: STUB_CREATOR, sign: async (wires) => ((signed += 1), { ok: true, signed: wires }) };
    const result = await runCurveTrade({ engine: odd, signer: counting, token: coin, side: "buy", amountRaw: "1000000", network: "solana:devnet", onPhase: () => undefined, switchOpen: true });
    assert.equal(result.failure.code, BUILD_UNEXPECTED);
    assert.equal(signed, 0);
  }
});

test("only the creator's wallet is built a claim", async () => {
  const engine = stubEngine();
  const token = await launched(engine);
  const stranger = { wallet: STUB_WALLET, address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", sign: async (wires) => ({ ok: true, signed: wires }) };
  const result = await runClaim({ engine, signer: stranger, token, network: "solana:devnet", onPhase: () => undefined, switchOpen: true });
  assert.equal(result.failure.code, "WALLET_MISMATCH");
  assert.equal(tradeFailureWords(result.failure), "This wallet is not the one the fees go to.");
});

test("over HTTP the card speaks the v1 contract: the routes, the headers, the bodies the engine validates", async () => {
  const seen = [];
  const fetcher = async (path, init) => {
    seen.push({ path, method: init?.method ?? "GET", headers: init?.headers, body: init?.body ? JSON.parse(init.body) : null });
    return { ok: false, status: 503, json: async () => ({ error: { code: "LAUNCH_PAUSED", message: "Paused." } }) };
  };
  const engine = httpEngine(fetcher);
  const token = "So11111111111111111111111111111111111111112";
  const wallet = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  const build = { wallet, side: "buy", amountRaw: "1000", slippageBps: CURVE_SLIPPAGE_BPS };
  await engine.tradeQuote(token, { side: "buy", amountRaw: "1000", slippageBps: CURVE_SLIPPAGE_BPS });
  await engine.tradeBuild(token, build);
  await engine.tradeSubmit(token, { buildId: "a".repeat(32), wallet, signedWireBase64: "AQ==" });
  await engine.holdings(token, wallet);
  await engine.claimReview(token, wallet);
  await engine.claimBuild(token, wallet);
  const answer = await engine.claimSubmit(token, { buildId: "a".repeat(32), wallet, signedWireBase64: ["AQ=="] });
  assert.deepEqual(answer, { ok: false, code: "LAUNCH_PAUSED", message: "Paused." });
  assert.deepEqual(
    seen.map((call) => `${call.method} ${call.path}`),
    [
      `POST /api/v1/launch/${token}/trade/quote`,
      `POST /api/v1/launch/${token}/trade/build`,
      `POST /api/v1/launch/${token}/trade/submit`,
      `GET /api/v1/launch/${token}/wallet/${wallet}`,
      `GET /api/v1/launch/${token}/claim/review?wallet=${wallet}`,
      `POST /api/v1/launch/${token}/claim/build`,
      `POST /api/v1/launch/${token}/claim/submit`,
    ],
  );
  for (const call of seen) assert.equal(call.headers["X-Ryntra-API"], API_HEADERS["X-Ryntra-API"]);
  LaunchTradeQuoteRequestSchema.parse(seen[0].body);
  LaunchTradeBuildRequestSchema.parse(seen[1].body);
  LaunchTradeSubmitRequestSchema.parse(seen[2].body);
  LaunchClaimSubmitRequestSchema.parse(seen[6].body);
  /* A token that is not an address is never put into a path. */
  assert.equal((await engine.tradeBuild("../admin", build)).code, "VALIDATION_ERROR");
  assert.equal(seen.length, 7);
});

test("every trade failure reads in at most two short sentences", () => {
  for (const code of [CITY_CLOSED, WALLET_REFUSED, "LAUNCH_BUILD_EXPIRED", BUILD_UNEXPECTED, "VALIDATION_ERROR", "LAUNCH_BALANCE_LOW", "LAUNCH_GRADUATING", "LAUNCH_SLIPPAGE", "LAUNCH_NOTHING_TO_CLAIM", "WALLET_MISMATCH", "LAUNCH_PAUSED", "RATE_LIMITED", "LAUNCH_SUBMIT_FAILED", "UNAVAILABLE"]) {
    for (const stage of ["before", "send"]) {
      const words = tradeFailureWords({ code, stage, message: "", token: null });
      assert.ok(words.length > 0 && words.length <= 140, `${code}: ${words}`);
      assert.ok((words.match(/[.!?](\s|$)/g) ?? []).length <= 2, `${code}: ${words}`);
    }
  }
});
