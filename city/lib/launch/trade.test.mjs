import assert from "node:assert/strict";
import test from "node:test";

import {
  LaunchMarketResponseSchema,
  LaunchTradeBuildRequestSchema,
  LaunchTradeBuildResponseSchema,
  LaunchTradeQuoteRequestSchema,
  LaunchTradeQuoteResponseSchema,
  LaunchTradeReceiptRequestSchema,
  LaunchTradeReceiptResponseSchema,
  LaunchTradeSubmitRequestSchema,
  LaunchTradeSubmitResponseSchema,
  LaunchWalletResponseSchema,
} from "../../../lib/api/v1/contract.ts";
import { API_HEADERS } from "./engine.ts";
import { STUB_CREATOR, stubAddress, stubEngine } from "./stub.ts";
import {
  BUY_CHIPS,
  SELL_CHIPS,
  chipFits,
  clock,
  explorerUrl,
  feeNow,
  feeShares,
  heldAfter,
  httpTradeEngine,
  progressOf,
  rawToNumber,
  reviewOf,
  routeOf,
  shareOfRaw,
  wholeToRaw,
} from "./trade.ts";
import { stubTradeEngine } from "./trade-stub.ts";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const SPARK = stubAddress("SPARK");
const MOTH = stubAddress("MOTH");

function stand(now = () => NOW) {
  const launch = stubEngine({ now });
  return stubTradeEngine({ market: (token) => launch.market(token), now });
}

test("SOL in: the engine's quote takes the pair currency only — no input mint rides in the request", () => {
  const body = { side: "buy", amountRaw: "25000000", slippageBps: 300 };
  assert.ok(LaunchTradeQuoteRequestSchema.safeParse(body).success);
  for (const extra of [{ inputMint: "So11111111111111111111111111111111111111112" }, { inputSymbol: "SOL" }, { pay: "SOL" }]) {
    assert.equal(LaunchTradeQuoteRequestSchema.safeParse({ ...body, ...extra }).success, false, JSON.stringify(extra));
    assert.equal(LaunchTradeBuildRequestSchema.safeParse({ ...body, wallet: STUB_CREATOR, ...extra }).success, false, JSON.stringify(extra));
  }
});

test("chips: whole USDC to raw, shares of a holding rounded down, a chip over the balance closed", () => {
  assert.deepEqual([...BUY_CHIPS], [10, 25, 50, 100]);
  assert.deepEqual([...SELL_CHIPS], [25, 50, 100]);
  assert.equal(wholeToRaw(25, 6), "25000000");
  assert.equal(wholeToRaw(0, 9), "0");
  assert.throws(() => wholeToRaw(2.5, 6));
  assert.equal(shareOfRaw("1001", 50), "500");
  assert.equal(shareOfRaw("1001", 25), "250");
  assert.equal(shareOfRaw("1001", 100), "1001");
  assert.equal(chipFits("25000000", "24999999"), false);
  assert.equal(chipFits("25000000", "25000000"), true);
  assert.equal(chipFits("25000000", null), true, "an unread balance closes nothing");
  assert.equal(rawToNumber("12345678", 6), 12.345678);
});

test("the fee line is the quote's, the fall is the curve's schedule, counted on the device's clock", () => {
  const market = { venue: "curve", curveFee: { nowBps: 1300, endBps: 100, sniperUntil: new Date(NOW + 48_000).toISOString() } };
  assert.deepEqual(feeNow(market, 1400, NOW), { venue: "curve", nowBps: 1400, endBps: 100, leftS: 48 }, "a swing surcharge rides on top of the schedule");
  assert.deepEqual(feeNow(market, null, NOW), { venue: "curve", nowBps: 1300, endBps: 100, leftS: 48 }, "no amount yet: the market's read");
  assert.deepEqual(feeNow(market, 100, NOW + 1_000), { venue: "curve", nowBps: 100, endBps: null, leftS: null }, "at the end fee nothing is falling");
  assert.deepEqual(feeNow(market, 1400, NOW + 48_000), { venue: "curve", nowBps: 1400, endBps: null, leftS: null }, "the fall is over");
  assert.deepEqual(feeNow({ venue: "pool", curveFee: null }, 70, NOW), { venue: "pool", nowBps: 70, endBps: null, leftS: null });
  assert.equal(feeNow({ venue: "pool", curveFee: null }, null, NOW), null, "nothing read, nothing said");
  assert.equal(clock(48), "0:48");
  assert.equal(clock(312), "5:12");
  assert.equal(clock(-3), "0:00");
});

test("who earns the fee follows the route: creator, Ryntra and Meteora on the curve; the locked liquidity in the pool", () => {
  const curve = feeShares({ venue: "curve", fee: { totalRaw: "1000", creatorRaw: "320", ryntraRaw: "520", meteoraRaw: "160", liquidityRaw: null } });
  assert.deepEqual(curve.map((row) => [row.who, row.raw, row.bps]), [
    ["creator", "320", 3200],
    ["ryntra", "520", 5200],
    ["meteora", "160", 1600],
  ]);
  const pool = feeShares({
    venue: "pool",
    fee: { totalRaw: "1000", creatorRaw: null, ryntraRaw: "20", meteoraRaw: "180", liquidityRaw: "800", liquidity: { creatorRaw: "200", ryntraRaw: "200", othersRaw: "0", compoundingRaw: "400" } },
  });
  assert.deepEqual(pool.map((row) => row.who), ["creatorPosition", "ryntraPosition", "compounding", "meteora", "ryntra"], "a zero share is not listed");
  const unsplit = feeShares({ venue: "pool", fee: { totalRaw: "1000", creatorRaw: null, ryntraRaw: "20", meteoraRaw: "180", liquidityRaw: "800", liquidity: null } });
  assert.deepEqual(unsplit.map((row) => row.who), ["liquidity", "meteora", "ryntra"]);
});

test("the bonding bar reads the engine: its share rounded down before graduation, «Graduated · DAMM v2» after", () => {
  const curve = { progress: { bps: 4699, migrated: false, reserveRaw: "0", thresholdRaw: "0" }, marketCap: { pair: 34_500, usd: 34_500 }, trading: { jupiter: false } };
  assert.deepEqual(progressOf(curve, 75_000), { migrated: false, pct: 46, capUsd: 34_500, graduationUsd: 75_000 });
  const pool = { progress: { bps: 10_000, migrated: true, reserveRaw: "0", thresholdRaw: "0" }, marketCap: { pair: 1, usd: 1 }, trading: { jupiter: true } };
  assert.deepEqual(progressOf(pool, 75_000), { migrated: true, jupiter: true });
  assert.equal(routeOf({ venue: "curve", trading: { jupiter: false } }), "curve");
  assert.equal(routeOf({ venue: "pool", trading: { jupiter: false } }), "pool");
  assert.equal(routeOf({ venue: "pool", trading: { jupiter: true } }), "poolJupiter");
});

test("the position moves at once by the fill, never below zero", () => {
  assert.deepEqual(heldAfter({ tokenRaw: "0", pairRaw: "500000000" }, "buy", { tokensRaw: "1200", pairRaw: "25000000" }), { tokenRaw: "1200", pairRaw: "475000000" });
  assert.deepEqual(heldAfter({ tokenRaw: "1200", pairRaw: "0" }, "sell", { tokensRaw: "1200", pairRaw: "9000" }), { tokenRaw: "0", pairRaw: "9000" });
  assert.deepEqual(heldAfter({ tokenRaw: "10", pairRaw: "0" }, "sell", { tokensRaw: "20", pairRaw: "1" }), { tokenRaw: "0", pairRaw: "1" });
});

test("the review reads a quote in units: what is spent, got, the least, the fee in the pair", async () => {
  const engine = stand();
  const answer = await engine.quote(SPARK, { side: "buy", amountRaw: "25000000", slippageBps: 300 });
  assert.ok(answer.ok);
  const review = reviewOf(answer.data, { token: "SPARK", tokenDecimals: 6, pair: "USDC", pairDecimals: 6 });
  assert.equal(review.spend, 25);
  assert.equal(review.spendSymbol, "USDC");
  assert.equal(review.getSymbol, "SPARK");
  assert.ok(review.get > 0 && review.minimum < review.get && review.minimum >= review.get * 0.97 - 1e-6);
  assert.ok(review.fee > 0 && review.fee < 25);
  assert.equal(review.feeBps, answer.data.feeBps);
});

test("the stand-in answers in the v1 contract's shapes, before and after graduation", async () => {
  const engine = stand();
  for (const token of [SPARK, MOTH]) {
    const market = await engine.market(token);
    assert.ok(market.ok);
    LaunchMarketResponseSchema.parse(market.data);
    const quote = await engine.quote(token, { side: "buy", amountRaw: "10000000", slippageBps: 100 });
    assert.ok(quote.ok);
    LaunchTradeQuoteResponseSchema.parse(quote.data);
    assert.equal(quote.data.venue, token === SPARK ? "curve" : "pool");
    const wallet = await engine.wallet(token, STUB_CREATOR);
    assert.ok(wallet.ok);
    LaunchWalletResponseSchema.parse(wallet.data);
    const build = await engine.build(token, { wallet: STUB_CREATOR, side: "buy", amountRaw: "10000000", slippageBps: 100 });
    assert.ok(build.ok);
    LaunchTradeBuildResponseSchema.parse(build.data);
    const submit = await engine.submit(token, { buildId: build.data.buildId, wallet: STUB_CREATOR, signedWireBase64: build.data.unsignedWireBase64 });
    assert.ok(submit.ok);
    LaunchTradeSubmitResponseSchema.parse(submit.data);
    const receipt = await engine.receipt(token, { wallet: STUB_CREATOR, signature: submit.data.signature });
    assert.ok(receipt.ok);
    LaunchTradeReceiptResponseSchema.parse(receipt.data);
  }
});

test("the young stand coin's launch fee is still falling; an older one pays the end fee", async () => {
  const launch = stubEngine({ now: () => NOW });
  const spark = await launch.market(SPARK);
  assert.ok(spark.ok);
  assert.ok(spark.data.curveFee.nowBps > spark.data.curveFee.endBps);
  assert.equal(Date.parse(spark.data.curveFee.sniperUntil), NOW + 2 * 60_000);
  const kite = await launch.market(stubAddress("KITE"));
  assert.ok(kite.ok);
  assert.deepEqual(kite.data.curveFee, { nowBps: 100, endBps: 100, sniperUntil: null });
});

test("over HTTP the panel calls the engine's own routes with the v1 headers and the bodies it validates", async () => {
  const seen = [];
  const fetcher = async (path, init) => {
    seen.push({ path, method: init.method ?? "GET", headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const engine = httpTradeEngine(fetcher);
  await engine.market(SPARK);
  await engine.wallet(SPARK, STUB_CREATOR);
  await engine.quote(SPARK, { side: "buy", amountRaw: "25000000", slippageBps: 300 });
  await engine.build(SPARK, { wallet: STUB_CREATOR, side: "sell", amountRaw: "1", slippageBps: 300 });
  await engine.submit(SPARK, { buildId: "a".repeat(32), wallet: STUB_CREATOR, signedWireBase64: "AA==" });
  await engine.receipt(SPARK, { wallet: STUB_CREATOR, signature: "1".repeat(88) });
  assert.deepEqual(
    seen.map((call) => `${call.method} ${call.path}`),
    [
      `GET /api/v1/launch/${SPARK}/market`,
      `GET /api/v1/launch/${SPARK}/wallet/${STUB_CREATOR}`,
      `POST /api/v1/launch/${SPARK}/trade/quote`,
      `POST /api/v1/launch/${SPARK}/trade/build`,
      `POST /api/v1/launch/${SPARK}/trade/submit`,
      `POST /api/v1/launch/${SPARK}/trade/receipt`,
    ],
  );
  for (const call of seen) assert.equal(call.headers["X-Ryntra-API-Version"], API_HEADERS["X-Ryntra-API-Version"]);
  LaunchTradeQuoteRequestSchema.parse(seen[2].body);
  LaunchTradeBuildRequestSchema.parse(seen[3].body);
  LaunchTradeSubmitRequestSchema.parse(seen[4].body);
  LaunchTradeReceiptRequestSchema.parse(seen[5].body);
  const refused = await engine.quote("not-a-mint", { side: "buy", amountRaw: "1", slippageBps: 300 });
  assert.equal(refused.ok, false);
  assert.equal(seen.length, 6, "a bad mint never leaves the page");
});

test("an engine error comes back as its code; a dead network as UNAVAILABLE", async () => {
  const failing = httpTradeEngine(async () => new Response(JSON.stringify({ error: { code: "LAUNCH_BALANCE_LOW", message: "low" } }), { status: 400 }));
  assert.deepEqual(await failing.quote(SPARK, { side: "buy", amountRaw: "1", slippageBps: 300 }), { ok: false, code: "LAUNCH_BALANCE_LOW", message: "low" });
  const dead = httpTradeEngine(async () => {
    throw new Error("offline");
  });
  assert.deepEqual(await dead.market(SPARK), { ok: false, code: "UNAVAILABLE", message: "" });
});

test("the explorer link names the cluster on devnet only", () => {
  assert.equal(explorerUrl("sig", "solana:devnet"), "https://solscan.io/tx/sig?cluster=devnet");
  assert.equal(explorerUrl("sig", "solana:mainnet"), "https://solscan.io/tx/sig");
});
