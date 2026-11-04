import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { clock, no, ok, wire } from "../districts/harbor/test-fixtures.mjs";
import { binForTarget, unitPriceNow } from "./limit.ts";
import { limitChoice, limitCosts, limitFailure, priceField, rollBins, setLimitEnv, startPrice, useLimit } from "./limit-store.ts";
import { useEarn } from "./open.ts";

const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const ORDER = "8xPos1tionAddr3ssxxxxxxxxxxxxxxxxxxxxxxxxx1";
const NOW = Date.parse("2026-10-31T12:00:00.000Z");
const connection = { wallet: "Phantom", address: OWNER };

function market(over = {}) {
  const raw = 204 * 10 ** (6 - 8);
  return {
    pool: POOL,
    asset: { mint: NVDAX, symbol: "NVDAx", decimals: 8, kind: "stock", name: "NVIDIA" },
    quote: { mint: USDC, symbol: "USDC", decimals: 6 },
    assetIsX: true,
    binStepBps: 20,
    activeBin: Math.round(Math.log(raw) / Math.log(1.002)),
    feeBps: 30,
    multiplier: { current: 1.02, pending: null, effectiveAt: null },
    priceUsd: 200,
    quoteUsd: 1,
    at: "2026-10-31T12:00:00.000Z",
    ...over,
  };
}

const holdings = (stockRaw, usdcRaw, sol = 1e9) => ({
  owner: OWNER,
  sol: { spendableRaw: String(sol), decimals: 9 },
  tokens: new Map([
    [NVDAX, { spendableRaw: String(stockRaw), decimals: 8 }],
    [USDC, { spendableRaw: String(usdcRaw), decimals: 6 }],
  ]),
  complete: true,
  at: 1,
});

const choose = (over = {}) => limitChoice({ market: market(), intent: "sell", form: "one", price: "210", amount: "1", holdings: holdings(10e8, 1000e6), owner: OWNER, ceilingUsd: 1000, costs: null, solUsd: 150, nowMs: NOW, ...over });

test("the card's choice: a sale over the price with the shares held passes, and carries the Review's key", () => {
  const c = choose();
  assert.equal(c.problem, null);
  assert.equal(c.side, "ask");
  assert.ok(c.near >= 210 - 1e-9 && c.near < 210 * 1.0021);
  assert.equal(c.deposit, 98_039_215n, "1 share at ×1.02 in base units");
  assert.ok(Math.abs(c.usd - 200) < 0.01);
  assert.match(c.key, new RegExp(`^place:${OWNER}:${POOL}:ask:\\d+:\\d+:98039215$`));
});

test("the card says plainly what is wrong, one thing at a time", () => {
  assert.equal(choose({ price: "" }).problem, "price");
  assert.equal(choose({ price: "190" }).problem, "side", "a sale under the price");
  assert.equal(choose({ intent: "buy", price: "210", amount: "100" }).problem, "side", "a purchase over the price");
  assert.equal(choose({ amount: "" }).problem, "format");
  assert.equal(choose({ amount: "0.001" }).problem, "min", "under a dollar");
  assert.equal(choose({ amount: "6" }).problem, "ceiling", "over the ceiling");
  assert.equal(choose({ amount: "2", holdings: holdings(1e8, 0) }).problem, "balance");
  const eve = { current: 1.02, pending: 1.0302, effectiveAt: new Date(NOW + 3_600_000).toISOString() };
  assert.equal(choose({ market: market({ multiplier: eve }), price: "201" }).problem, "eve", "near the price on the eve of a dividend");
  assert.equal(choose({ market: market({ multiplier: eve }), price: "215" }).problem, null, "further away it may be set");
  assert.equal(choose({ owner: null }).key, null, "no wallet, no Review");
});

test("costs raise the minimum to twenty times what never comes back; SOL spent leaves the order's costs aside", () => {
  const review = { networkFeeLamports: "10000", preview: { rent: [{ what: "limit_order", direction: "pay", lamports: "2000000", refundable: true }, { what: "bin_arrays", direction: "pay", lamports: "70000000", refundable: false }] } };
  const costs = limitCosts(review);
  assert.deepEqual(costs, { lostLamports: 70_010_000n, keptLamports: 2_000_000n });
  const c = choose({ costs, amount: "0.5" });
  assert.ok(Math.abs(c.minUsd - 0.07001 * 150 * 20) < 1e-6);
  assert.equal(c.problem, "min");
  const solMarket = market({ asset: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, kind: "sol", name: null }, multiplier: { current: 1, pending: null, effectiveAt: null }, priceUsd: 150, activeBin: Math.round(Math.log(150 * 10 ** (6 - 9)) / Math.log(1.002)) });
  assert.equal(choose({ market: solMarket, price: "160", amount: "1", holdings: holdings(0, 0, 1e9) }).problem, "balance", "all the SOL, with nothing left for the order's costs");
});

test("the Wheel's next order sits on the other side, a step past the fill, never across the price", () => {
  const m = market();
  const bin = binForTarget(m, "sell", 210);
  const filled = { side: "ask", bins: [{ bin }], pool: POOL };
  const next = rollBins(m, filled);
  assert.ok(next.upper < m.activeBin, "a purchase under the price");
  // Sold far above, the price since fell under the wheel's target: the purchase still sits under the price now.
  const crashed = { ...m, activeBin: m.activeBin - 60 };
  const safe = rollBins(crashed, filled);
  assert.ok(safe.upper < crashed.activeBin);
  assert.ok(Math.abs(startPrice(m, "sell") / unitPriceNow(m) - 1.05) < 1e-9);
  assert.equal(priceField(210.123456), "210.12");
  assert.equal(priceField(12.5), "12.5");
  assert.equal(priceField(0.000123456), "0.00012346");
  // In dollars, to the cent from a dollar up (CITY-190): +2% on $96.006 is 97.93, not 97.9261.
  assert.equal(priceField(96.006 * 1.02, true), "97.93");
  assert.equal(priceField(12.5, true), "12.50");
  assert.equal(priceField(1840.336, true), "1840.34");
  assert.equal(priceField(0.0123456, true), "0.01235", "a cheap coin keeps what it needs");
});

test("the amount in dollars: the field keeps the dollars, the order keeps the coin; Max and a typed coin read back", () => {
  const st = () => useLimit.getState();
  st().setUnit("usd");
  st().setUsd("100");
  assert.equal(st().usd, "100");
  assert.equal(st().amount, "0.5", "$100 of a $200 share");
  assert.equal(choose({ amount: st().amount }).deposit, choose({ amount: "0.5" }).deposit, "what is signed is the coin");
  st().setAmount("1.25");
  assert.equal(st().usd, "250", "Max or a typed coin shows in dollars too");
  st().setUnit("coin");
  assert.equal(st().amount, "1.25", "the unit changes the field, never the order");
  st().setIntent("buy");
  assert.equal(st().amount, "");
  assert.equal(st().usd, "");
});

test("refusals in the product's words, the engine's own words otherwise", () => {
  assert.match(limitFailure("LIMIT_EVE"), /corporate action/i);
  assert.match(limitFailure("LIMITS_STOPPED"), /paused/i);
  assert.equal(typeof limitFailure("SIMULATION_FAILED"), "string");
});

/* ------------------------------------------------------------- the flow */

beforeEach(() => {
  useEarn.setState({ busy: false });
  useLimit.setState({ markets: { status: "ready", value: [market()], at: NOW }, pool: POOL, intent: "sell", form: "one", price: "210", amount: "1", states: { owner: OWNER, value: { place: "on", exit: "on", ceilingUsd: 1000, stopped: false } }, orders: null, reviewed: null, costs: null, target: { kind: "place" }, phase: "idle", outcome: null, done: null, notice: null });
});

function placeReview() {
  return {
    preview: { action: "limit_place", venue: "meteora-dlmm", pool: POOL, fees: [], rent: [{ what: "limit_order", direction: "pay", lamports: "2000000", refundable: true }], transactions: 1, notices: [], price: "2.04", activeBin: market().activeBin, makerShareBps: 5000, feeBps: 30, at: 1, expiresAt: 2, request: {}, place: { side: "ask", bins: { lower: 1, upper: 1 }, lowerPrice: "2.1", upperPrice: "2.1", spread: [], deposit: { asset: NVDAX, units: "98039215", decimals: 8 }, fullFill: { asset: USDC, units: "1", decimals: 6 } } },
    transactions: [{ wireBase64: wire(1), presigned: [] }],
    position: ORDER,
    ticket: "ticket-1",
    expiresAt: 0,
    signableMs: 20_000,
    networkFeeLamports: "10000",
    depositUsd: 200,
  };
}

function scripted({ review = [ok(placeReview())], submit = [ok({ results: [{ signature: "s1", state: "LANDED", reason: null }], settled: true })], orders = [ok({ owner: OWNER, orders: [], at: "x" })] } = {}) {
  const calls = [];
  const queues = { review: [...review], submit: [...submit], orders: [...orders] };
  const answer = (route) => (...args) => {
    calls.push({ route, args });
    const next = queues[route]?.shift();
    return Promise.resolve(next ?? ok({ owner: OWNER, orders: [], at: "x" }));
  };
  const time = clock(NOW);
  const signs = [];
  setLimitEnv({
    engine: { review: answer("review"), submit: answer("submit"), status: answer("status"), orders: answer("orders"), markets: answer("markets"), admit: answer("admit") },
    now: time.now,
    sleep: time.sleep,
    sign: () => async (unsigned) => {
      signs.push(unsigned);
      return { ok: true, signed: unsigned.map((_, i) => wire(i + 9)) };
    },
    after: () => undefined,
  });
  return { calls, signs };
}

test("place: the Review of exactly what is on the card, one wallet prompt, one relay, the order remembered", async () => {
  const { calls, signs } = scripted();
  const h = holdings(10e8, 0);
  await useLimit.getState().prepare(connection, { kind: "place" }, h);
  const asked = calls.find((c) => c.route === "review").args[0];
  assert.equal(asked.action, "limit_place");
  assert.equal(asked.request.side, "ask");
  assert.equal(asked.request.amount, "98039215");
  assert.ok(useLimit.getState().reviewed, "the Review stands on the card");
  await useLimit.getState().confirm(connection, h);
  assert.equal(signs.length, 1, "one wallet prompt");
  assert.equal(calls.filter((c) => c.route === "submit").length, 1, "sent once");
  assert.equal(useLimit.getState().outcome.kind, "done");
  assert.equal(useLimit.getState().done, "place");
  assert.equal(useEarn.getState().busy, false, "the window lets go once it is done");
});

test("a refused Review says why and builds nothing to sign; a wallet that says no keeps the Review", async () => {
  scripted({ review: [no("LIMIT_EVE")] });
  await useLimit.getState().prepare(connection, { kind: "place" }, holdings(10e8, 0));
  assert.equal(useLimit.getState().reviewed, null);
  assert.match(useLimit.getState().notice.text, /corporate action/i);

  scripted();
  await useLimit.getState().prepare(connection, { kind: "place" }, holdings(10e8, 0));
  setLimitEnv({ sign: () => async () => ({ ok: false }) });
  await useLimit.getState().confirm(connection, holdings(10e8, 0));
  assert.equal(useLimit.getState().outcome, null);
  assert.ok(useLimit.getState().reviewed, "kept for another try");
  assert.equal(useLimit.getState().phase, "idle");
});

test("cancel: an order taken back is its own Review, keyed by the order", async () => {
  const { calls } = scripted({ review: [ok({ ...placeReview(), preview: { ...placeReview().preview, action: "limit_cancel" } })] });
  const order = { address: ORDER, pool: POOL, side: "ask", bins: [{ bin: 1 }] };
  await useLimit.getState().prepare(connection, { kind: "cancel", order }, null);
  const asked = calls.find((c) => c.route === "review").args[0];
  assert.deepEqual(asked, { action: "limit_cancel", venue: "meteora-dlmm", request: { order: ORDER, owner: OWNER } });
  assert.equal(useLimit.getState().reviewed.key, `cancel:${OWNER}:${ORDER}`);
});
