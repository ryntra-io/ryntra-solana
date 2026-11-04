import { test } from "node:test";
import assert from "node:assert/strict";

import {
  basePriceAt,
  binForTarget,
  binsFit,
  binsFor,
  coinOfUsd,
  depositInDollars,
  depositUnits,
  EVE_BEFORE_MS,
  eveGuard,
  fullFillShown,
  LADDER_BINS,
  mergePending,
  orderUnitPrices,
  poolSide,
  previewRatio,
  readRecord,
  replaceDue,
  shownUnits,
  unitPriceAt,
  unitPriceNow,
  usdOfCoin,
  wheelTarget,
} from "./limit.ts";

const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";

/** A stock (8 decimals) against USDC (6) on a 20 bps step, the stock as X, a base token at about $204 — $200 a share at ×1.02. */
function stockMarket(over = {}) {
  const raw = 204 * 10 ** (6 - 8);
  const active = Math.round(Math.log(raw) / Math.log(1.002));
  return {
    pool: POOL,
    asset: { mint: NVDAX, symbol: "NVDAx", decimals: 8, kind: "stock", name: "NVIDIA" },
    quote: { mint: USDC, symbol: "USDC", decimals: 6 },
    assetIsX: true,
    binStepBps: 20,
    activeBin: active,
    feeBps: 30,
    multiplier: { current: 1.02, pending: null, effectiveAt: null },
    priceUsd: 200,
    quoteUsd: 1,
    at: "2026-10-31T12:00:00.000Z",
    ...over,
  };
}

/** The same stock as the pool's Y, USDC as X: the asset's price falls as the bin rises. */
function flippedMarket() {
  const m = stockMarket();
  const raw = (1 / 204) * 10 ** (8 - 6);
  return { ...m, assetIsX: false, activeBin: Math.round(Math.log(raw) / Math.log(1.002)) };
}

test("a share price goes through the live multiplier: one base token is `multiplier` shares", () => {
  const m = stockMarket();
  const now = unitPriceNow(m);
  assert.ok(Math.abs(now - 200) / 200 < 0.002, `about $200 a share, got ${now}`);
  assert.ok(Math.abs(basePriceAt(m, m.activeBin) - 204) / 204 < 0.002, "about $204 a base token");
  assert.ok(Math.abs(unitPriceAt(m, m.activeBin, 1) - basePriceAt(m, m.activeBin)) < 1e-9, "without a multiplier, a share is a token");
});

test("a sale sits at or over the target, a purchase at or under it — whichever way the pool counts", () => {
  for (const m of [stockMarket(), flippedMarket()]) {
    const sellBin = binForTarget(m, "sell", 210);
    const buyBin = binForTarget(m, "buy", 190);
    assert.ok(unitPriceAt(m, sellBin) >= 210 - 1e-9, "never sells under the target");
    assert.ok(unitPriceAt(m, sellBin) < 210 * 1.0021, "within one step of it");
    assert.ok(unitPriceAt(m, buyBin) <= 190 + 1e-9, "never pays over the target");
    assert.ok(unitPriceAt(m, buyBin) > 190 / 1.0021);
    const sellSide = poolSide("sell", m.assetIsX);
    const buySide = poolSide("buy", m.assetIsX);
    assert.notEqual(sellSide, buySide);
    assert.equal(binsFit(sellSide, binsFor(sellSide, sellBin, "one"), m.activeBin), true, "a sale over the price sits on its side");
    assert.equal(binsFit(buySide, binsFor(buySide, buyBin, "one"), m.activeBin), true, "a purchase under the price sits on its side");
  }
  assert.equal(poolSide("sell", true), "ask");
  assert.equal(poolSide("sell", false), "bid");
  assert.equal(binForTarget(stockMarket(), "sell", 0), null);
  assert.equal(binForTarget(stockMarket(), "sell", Number.NaN), null);
});

test("a target at today's price, or past it, is on the wrong side and does not fit", () => {
  const m = stockMarket();
  const side = poolSide("sell", true);
  const atNow = binForTarget(m, "sell", unitPriceNow(m) * 0.999);
  assert.equal(binsFit(side, binsFor(side, atNow, "one"), m.activeBin), false);
});

test("a ladder runs away from the price; its first bin is the target's", () => {
  assert.deepEqual(binsFor("ask", 120, "ladder"), { lower: 120, upper: 120 + LADDER_BINS - 1 });
  assert.deepEqual(binsFor("bid", 80, "ladder"), { lower: 80 - LADDER_BINS + 1, upper: 80 });
  const m = stockMarket();
  const prices = orderUnitPrices(m, "ask", { lower: m.activeBin + 5, upper: m.activeBin + 14 });
  assert.ok(prices.near < prices.far);
  const bid = orderUnitPrices(m, "bid", { lower: m.activeBin - 14, upper: m.activeBin - 5 });
  assert.ok(bid.near > bid.far, "a bid starts filling at its highest");
});

test("shares typed are turned into base tokens through the multiplier; a purchase is the quote as typed", () => {
  const m = stockMarket();
  assert.equal(depositUnits(m, "sell", "1.02"), 100_000_000n, "1.02 shares at ×1.02 is one base token");
  assert.equal(depositUnits(m, "buy", "250"), 250_000_000n);
  assert.equal(depositUnits(m, "sell", "abc"), null);
  assert.equal(depositUnits(m, "sell", "0"), null);
  assert.equal(depositUnits(m, "buy", "1.0000001"), null, "past the quote's decimals");
  assert.equal(depositUnits(m, "sell", "2,5"), 245_098_039n, "a comma reads as the decimal point");
  assert.ok(Math.abs(shownUnits(100_000_000n, 8, 1.02) - 1.02) < 1e-9);
});

test("what all of it brings: a sale paid in the quote, a purchase in shares", () => {
  const m = stockMarket();
  const bin = m.activeBin + 10;
  const sold = fullFillShown(m, "sell", { lower: bin, upper: bin }, 100_000_000n);
  assert.ok(Math.abs(sold - basePriceAt(m, bin)) < 1e-6, "one base token at the bin's price");
  const bought = fullFillShown(m, "buy", { lower: m.activeBin - 10, upper: m.activeBin - 10 }, 200_000_000n);
  assert.ok(Math.abs(bought - (200 / basePriceAt(m, m.activeBin - 10)) * 1.02) < 1e-6, "base tokens bought, said in shares");
});

/* ----------------------------------------------------------- the eve guard */

const NOW = Date.parse("2026-11-02T12:00:00.000Z");
const dividend = (hoursAhead, pending = 1.0125) => ({ current: 1.02, pending, effectiveAt: new Date(NOW + hoursAhead * 3_600_000).toISOString() });

test("on the eve of a dividend a sale near the price waits; a sale further away, a purchase, or another day does not", () => {
  const near = eveGuard({ intent: "sell", multiplier: dividend(10, 1.0302), mint: NVDAX, ratio: 1.01, nowMs: NOW });
  assert.equal(near.blocked, true);
  assert.equal(near.kind, "dividend");
  assert.ok(Math.abs(near.band - 0.02) < 1e-9 || near.band >= 0.02);
  assert.equal(eveGuard({ intent: "sell", multiplier: dividend(10, 1.0302), mint: NVDAX, ratio: 1.08, nowMs: NOW }).blocked, false, "further away may be set");
  assert.equal(eveGuard({ intent: "buy", multiplier: dividend(10, 1.0302), mint: NVDAX, ratio: 0.99, nowMs: NOW }).blocked, false, "a purchase is not filled by units that grow");
  assert.equal(eveGuard({ intent: "sell", multiplier: dividend(30, 1.0302), mint: NVDAX, ratio: 1.01, nowMs: NOW }).blocked, false, "more than a day before");
  const after = eveGuard({ intent: "sell", multiplier: dividend(-0.1, 1.0302), mint: NVDAX, ratio: 1.01, nowMs: NOW });
  assert.equal(after.blocked, true, "and the issuer's quarter of an hour after");
  assert.equal(eveGuard({ intent: "sell", multiplier: dividend(-1, 1.0302), mint: NVDAX, ratio: 1.01, nowMs: NOW }).blocked, false);
  assert.equal(eveGuard({ intent: "sell", multiplier: { current: 1, pending: null, effectiveAt: null }, mint: NVDAX, ratio: 1.001, nowMs: NOW }).blocked, false, "no event, no guard");
  assert.equal(eveGuard({ intent: "sell", multiplier: null, mint: NVDAX, ratio: 1.001, nowMs: NOW }).blocked, false);
  assert.equal(EVE_BEFORE_MS, 86_400_000);
});

test("a split closes sales up to the step itself; a reverse split closes purchases near the price instead", () => {
  const split = { current: 1, pending: 2, effectiveAt: new Date(NOW + 3_600_000).toISOString() };
  const s = eveGuard({ intent: "sell", multiplier: split, mint: NVDAX, ratio: 1.9, nowMs: NOW });
  assert.equal(s.blocked, true);
  assert.equal(s.kind, "split");
  assert.equal(eveGuard({ intent: "sell", multiplier: split, mint: NVDAX, ratio: 2.1, nowMs: NOW }).blocked, false);
  const reverse = { current: 1, pending: 0.1, effectiveAt: new Date(NOW + 3_600_000).toISOString() };
  assert.equal(eveGuard({ intent: "buy", multiplier: reverse, mint: NVDAX, ratio: 0.5, nowMs: NOW }).blocked, true);
  assert.equal(eveGuard({ intent: "sell", multiplier: reverse, mint: NVDAX, ratio: 1.01, nowMs: NOW }).blocked, false);
});

test("the server's guard reads an engine preview in the asset's terms, whichever side of the pool it is", () => {
  assert.ok(Math.abs(previewRatio({ assetIsX: true, side: "ask", poolPrice: 200, lowerPrice: 210, upperPrice: 220 }) - 1.05) < 1e-12);
  assert.ok(Math.abs(previewRatio({ assetIsX: true, side: "bid", poolPrice: 200, lowerPrice: 180, upperPrice: 190 }) - 0.95) < 1e-12);
  // The asset as Y: a sale is a bid; its nearest bin is the highest pool price, the lowest asset price.
  assert.ok(Math.abs(previewRatio({ assetIsX: false, side: "bid", poolPrice: 1 / 200, lowerPrice: 1 / 220, upperPrice: 1 / 210 }) - 1.05) < 1e-12);
  assert.equal(previewRatio({ assetIsX: true, side: "ask", poolPrice: 0, lowerPrice: 1, upperPrice: 1 }), null);
});

test("the issuer's announced multiplier is taken only when the chain schedules none sooner and both agree on today's", () => {
  const chain = { current: 1.02, pending: null, effectiveAt: null };
  const at = new Date(NOW + 5 * 3_600_000).toISOString();
  assert.deepEqual(mergePending(chain, { current: 1.02, pending: 1.03, effectiveAt: at }, NOW), { current: 1.02, pending: 1.03, effectiveAt: at });
  assert.deepEqual(mergePending(chain, { current: 1.01, pending: 1.03, effectiveAt: at }, NOW), chain, "disagreeing on today's: ignored");
  assert.deepEqual(mergePending(chain, { current: 1.02, pending: 1.03, effectiveAt: new Date(NOW - 1).toISOString() }, NOW), chain, "already past");
  const sooner = { current: 1.02, pending: 1.025, effectiveAt: new Date(NOW + 3_600_000).toISOString() };
  assert.deepEqual(mergePending(sooner, { current: 1.02, pending: 1.03, effectiveAt: at }, NOW), sooner, "the chain's own schedule comes first");
  assert.deepEqual(mergePending(chain, null, NOW), chain);
});

/* -------------------------------------------------------- re-place and the Wheel */

test("an order set through one multiplier and read through another is offered again; the Wheel steps five per cent", () => {
  const record = { order: POOL, pool: POOL, mint: NVDAX, intent: "sell", target: 210, multiplier: 1.02, at: 1 };
  assert.equal(replaceDue(record, 1.02), false);
  assert.equal(replaceDue(record, 1.0302), true);
  assert.equal(replaceDue(null, 1.03), false);
  assert.ok(Math.abs(wheelTarget("sell", 200) - 190) < 1e-9);
  assert.ok(Math.abs(wheelTarget("buy", 200) - 210) < 1e-9);
  assert.deepEqual(readRecord(record), record);
  assert.equal(readRecord({ ...record, intent: "hold" }), null);
  assert.equal(readRecord({ ...record, multiplier: 0 }), null);
  assert.equal(readRecord({ ...record, order: "x" }), null);
});

/* ------------------------------------------------------- dollars on the card (CITY-190) */

test("dollars typed become the coin at the venue's price, rounded down; the coin reads back in cents", () => {
  const sol = { ...stockMarket(), asset: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, kind: "sol", name: null }, multiplier: { current: 1, pending: null, effectiveAt: null }, priceUsd: 186.4, quoteUsd: 1 };
  // $10 of SOL at $186.40: 0.053648…, six places, never over the dollars typed.
  assert.equal(coinOfUsd(sol, "sell", "10"), "0.053648");
  assert.ok(Number(coinOfUsd(sol, "sell", "10")) * 186.4 <= 10);
  assert.equal(coinOfUsd(sol, "sell", "10,5"), "0.05633", "a comma is a decimal point");
  assert.equal(coinOfUsd(sol, "sell", ""), "");
  assert.equal(coinOfUsd(sol, "sell", "abc"), "");
  assert.equal(coinOfUsd(sol, "sell", "0.0000001"), "", "under the coin's least step is no amount");
  assert.equal(coinOfUsd({ ...sol, priceUsd: null }, "sell", "10"), "", "no price, no amount");
  assert.equal(usdOfCoin(sol, "sell", "0.05"), "9.32", "rounded down to the cent");
  assert.equal(usdOfCoin(sol, "sell", "5"), "932");
  // A purchase paid in SOL counts the quote's dollars; one paid in USDC is dollars already.
  const tsla = { ...stockMarket(), quote: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 }, priceUsd: 430.6, quoteUsd: 186.4 };
  assert.equal(coinOfUsd(tsla, "buy", "100"), "0.53648");
  assert.equal(depositInDollars(tsla, "buy"), false);
  assert.equal(depositInDollars(stockMarket(), "buy"), true);
  assert.equal(depositInDollars(stockMarket(), "sell"), false);
  // Shares typed through dollars still go in through the live multiplier, as typed shares do.
  const shares = coinOfUsd(stockMarket(), "sell", "100");
  assert.equal(shares, "0.5");
  assert.equal(depositUnits(stockMarket(), "sell", shares), depositUnits(stockMarket(), "sell", "0.5"));
});
