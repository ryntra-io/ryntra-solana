// The grid on Meteora DLMM Pro: the arithmetic of the band and its two ladders, the record of a grid and its
// view from the chain's read of its orders, and the four actions over a lane that is a fake here. Nothing is built,
// signed or sent: the engine and the wallet are this file's own.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { GRID_MAX_PER_SIDE, awayBps, emptyLevels, onLevels, gridPlan, gridPrices, gridSplit, gridStep, ladderOver, rawOf, refillPlan, shapeIssue, wholeOf } = await import("./plan.ts");
const { classicView, gridRefill, gridView, quoteWorth, readRecord, takenOf, withPlaced, withStopped, withTaken } = await import("./grid.ts");
const { classicGrid } = await import("./classic.ts");
const { binPrice } = await import("../bots/ladder/plan.ts");
const { approveAll, costOf, placeAsks, placedOf, stopAsks, takeAsks } = await import("./flow.ts");

const near = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)), `${actual} ≈ ${expected}`);

test("a band's levels are geometric: the same step in percent from the lower edge to the upper one", () => {
  const shape = { lower: 90, upper: 110, levels: 11 };
  const prices = gridPrices(shape);
  assert.equal(prices.length, 11);
  near(prices[0], 90);
  near(prices[10], 110);
  const step = gridStep(shape);
  near(step, Math.pow(110 / 90, 1 / 10) - 1);
  for (let i = 1; i < prices.length; i += 1) near(prices[i] / prices[i - 1], 1 + step, 1e-9);
  assert.equal(shapeIssue({ lower: 110, upper: 90, levels: 10 }), "range");
  assert.equal(shapeIssue({ lower: 0, upper: 90, levels: 10 }), "range");
  assert.equal(shapeIssue({ lower: 90, upper: 110, levels: 1 }), "levels");
  assert.equal(shapeIssue({ lower: 90, upper: 110, levels: 51 }), "levels");
  assert.equal(shapeIssue({ lower: 90, upper: 110, levels: 2.5 }), "levels");
  assert.deepEqual(gridPrices({ lower: 1, upper: 1, levels: 4 }), []);
});

test("under the price buys, over it sells; the level within half a step of the price is skipped", () => {
  const prices = gridPrices({ lower: 90, upper: 110, levels: 11 });
  const step = gridStep({ lower: 90, upper: 110, levels: 11 });
  const at = gridSplit(prices, prices[5], step);
  assert.equal(at.skipped, prices[5]);
  assert.equal(at.buys.length, 5);
  assert.equal(at.sells.length, 5);
  assert.ok(at.buys.every((level) => level < prices[5]) && at.sells.every((level) => level > prices[5]));
  /* Halfway between two levels: both are half a step away — neither is skipped. */
  const between = Math.sqrt(prices[4] * prices[5]);
  const split = gridSplit(prices, between * 1.0001, step);
  assert.equal(split.buys.length + split.sells.length, 10, "only the nearest one, when it is nearer than half a step");
  /* Over the band: every level buys. */
  const over = gridSplit(prices, 200, step);
  assert.equal(over.sells.length, 0);
  assert.equal(over.buys.length, 11);
});

test("a side's ladder is the lane's intent: nearest and farthest as distances from the price, a price a level, the amount even", () => {
  const prices = gridPrices({ lower: 90, upper: 110, levels: 11 });
  const buys = prices.slice(0, 5);
  const intent = ladderOver(buys, 100, "buy", 5_000_000n);
  assert.deepEqual(intent, { action: "buy", nearBps: awayBps(buys[4], 100), farBps: 1_000, rungs: 5, spread: "even", amountRaw: "5000000" });
  const sells = prices.slice(6);
  const sell = ladderOver(sells, 100, "sell", 12n);
  assert.equal(sell.nearBps, awayBps(sells[0], 100));
  assert.equal(sell.farBps, 1_000);
  assert.equal(ladderOver([], 100, "buy", 1n), null);
  assert.equal(ladderOver(buys, 100, "buy", 0n), null);
  /* More than one order holds: the 25 nearest the price. */
  const many = Array.from({ length: 30 }, (_, i) => 100 * (1 - (i + 1) / 100));
  assert.equal(ladderOver(many, 100, "buy", 1n).rungs, GRID_MAX_PER_SIDE);
  assert.equal(ladderOver(many, 100, "buy", 1n).farBps, 2_500);
});

test("the plan: the same worth at every level placed — the buys rest the quote coin, the sells the coin at the price now", () => {
  const plan = gridPlan({ lower: 90, upper: 110, levels: 11 }, 100, { price: 100, coinDecimals: 6, quoteDecimals: 6 });
  assert.equal(plan.issue, null);
  assert.equal(plan.split.buys.length, 5);
  assert.equal(plan.split.sells.length, 5);
  near(plan.perLevel, 10);
  assert.equal(plan.put.quoteRaw, 50_000_000n, "five levels of $10 in the quote coin");
  assert.equal(plan.put.coinRaw, 500_000n, "five levels of $10 of the coin at 100");
  assert.equal(plan.buy.amountRaw, "50000000");
  assert.equal(plan.sell.amountRaw, "500000");
  assert.equal(plan.buy.rungs + plan.sell.rungs, 10);
  assert.equal(gridPlan({ lower: 90, upper: 110, levels: 11 }, 0, { price: 100, coinDecimals: 6, quoteDecimals: 6 }).issue, "amount");
  assert.equal(gridPlan({ lower: 80, upper: 120, levels: 40 }, 100, { price: 100, coinDecimals: 6, quoteDecimals: 6 }).issue, null);
  assert.equal(gridPlan({ lower: 10, upper: 100.5, levels: 50 }, 100, { price: 100, coinDecimals: 6, quoteDecimals: 6 }).issue, "side", "49 buys do not fit one order");
  assert.equal(gridPlan({ lower: 90, upper: 110, levels: 11 }, 0.0000001, { price: 100, coinDecimals: 6, quoteDecimals: 6 }).issue, "amount");
});

test("whole amounts and base units", () => {
  assert.equal(rawOf(1.5, 9), 1_500_000_000n);
  assert.equal(rawOf(0.1234567, 6), 123_456n);
  assert.equal(rawOf(-1, 6), 0n);
  assert.equal(rawOf(Number.NaN, 6), 0n);
  near(wholeOf("1500000", 6), 1.5);
});

test("again: the free coin over the empty levels above the price, the free quote under it — up to what still rests", () => {
  const shape = { lower: 90, upper: 110, levels: 11 };
  const prices = gridPrices(shape);
  const step = gridStep(shape);
  /* The price fell from the middle to the second level: three buys filled; sells still rest from the sixth level up. */
  const empty = emptyLevels(prices, step, prices[2] * 0.999, { buyHigh: prices[1], sellLow: prices[6] });
  assert.deepEqual(empty.sells, prices.slice(3, 6), "the sells go to the levels the buys left, and the one at the old price");
  assert.deepEqual(empty.buys, [], "the buy under the price still rests");
  const refill = refillPlan(prices, step, prices[2] * 0.999, { buyHigh: prices[1], sellLow: prices[6] }, { coinRaw: 300n, quoteRaw: 0n });
  assert.equal(refill.buy, null);
  assert.equal(refill.sell.rungs, 3);
  assert.equal(refill.sell.amountRaw, "300");
  /* Nothing free: nothing to place. */
  assert.deepEqual(refillPlan(prices, step, 100, { buyHigh: null, sellLow: null }, { coinRaw: 0n, quoteRaw: 0n }), { buy: null, sell: null });
});

test("a ladder the lane built is held to the grid's levels: as many prices, each within half a step of a level", () => {
  const shape = { lower: 90, upper: 110, levels: 11 };
  const prices = gridPrices(shape);
  const step = gridStep(shape);
  assert.equal(onLevels(prices.slice(0, 4).map((p) => p * 1.003), prices, 4, step), true);
  assert.equal(onLevels(prices.slice(0, 4).map((p) => p * 1.3), prices.slice(0, 4), 4, step), false, "the ladder moved off its levels with the price");
  assert.equal(onLevels(prices.slice(0, 3), prices, 4, step), false, "the pool's spacing merged two levels into one");
});

/* ------------------------------------------------------------------ the record */

const OWNER = "Own1111111111111111111111111111111111111111";
const POOL = "Poo1111111111111111111111111111111111111111";
const COIN = { mint: "Met1111111111111111111111111111111111111111", symbol: "MET", decimals: 6 };
const QUOTE = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 };
const record = () => ({ v: 1, id: "grid-1", network: "devnet", owner: OWNER, pool: POOL, coin: COIN, quote: QUOTE, shape: { lower: 0.0033, upper: 0.004, levels: 12 }, amount: 1, createdAt: 1, stoppedAt: null, orders: [], free: { coinRaw: "0", quoteRaw: "0" }, filledTaken: 0, basis: { coinRaw: "0", quoteRaw: "0" }, profitRaw: "0", bonusTaken: {}, venue: "pro" });
const order = (nftMint, action, over = {}) => ({ nftMint, pool: POOL, coin: { mint: COIN.mint, decimals: 6 }, quote: { mint: QUOTE.mint, decimals: 9 }, action, state: "resting", prices: 5, filledPrices: 0, restsIn: null, paysIn: null, restsRaw: "0", filledRaw: "0", proceedsRaw: "0", lowPrice: 0.0034, highPrice: 0.0036, filledPrice: null, bonus: { mint: QUOTE.mint, ownerRaw: "0", referralRaw: "0" }, agent: false, agentReady: false, agentOffered: false, partialPrices: 0, ...over });

test("a grid's view: what rests, what filled and waits, what it earned, and what still rests at its edges", () => {
  const placed = withPlaced(record(), [{ nftMint: "Buy1", action: "buy", restsRaw: "500" }, { nftMint: "Sel1", action: "sell", restsRaw: "700" }], false);
  assert.deepEqual(placed.orders, [{ nftMint: "Buy1", action: "buy" }, { nftMint: "Sel1", action: "sell" }]);
  assert.deepEqual(placed.free, { coinRaw: "0", quoteRaw: "0" }, "a first placing takes from the wallet, not from what is free");
  const orders = [
    order("Buy1", "buy", { filledPrices: 2, state: "filling", proceedsRaw: "4000", highPrice: 0.0036, bonus: { mint: QUOTE.mint, ownerRaw: "11", referralRaw: "2" } }),
    order("Sel1", "sell", { lowPrice: 0.0037, highPrice: 0.004 }),
    order("Other", "buy"),
  ];
  const view = gridView(placed, orders);
  assert.equal(view.live.length, 2, "another ladder of the wallet is not the grid's");
  assert.equal(view.resting, 8);
  assert.equal(view.waiting, 2);
  assert.equal(view.filled, 2);
  assert.equal(view.state, "filled");
  assert.equal(view.canTake, true);
  assert.equal(view.bonus[QUOTE.mint], 11n);
  assert.deepEqual(view.edges, { buyHigh: 0.0036, sellLow: 0.0037 });
  assert.equal(view.profitRaw, 0n, "a buy earns nothing until its coin is sold");
});

test("taking is booked from what reached the wallet; a sell earns its pay over what its coin cost", () => {
  /* The grid starts at 0.0036 SOL a MET with 1 MET on its sells: that MET cost 0.0036 SOL. */
  const placed = withPlaced(record(), [{ nftMint: "Buy1", action: "buy", restsRaw: "500" }, { nftMint: "Sel1", action: "sell", restsRaw: "1000000" }], false, 0.0036);
  assert.deepEqual(placed.basis, { coinRaw: "1000000", quoteRaw: "3600000" });
  /* A buy filled at 0.0034: 1 MET reached the wallet; a partly filled price of it stays in the order. */
  const buy = order("Buy1", "buy", { filledPrices: 3, partialPrices: 1, filledPrice: 0.0034, proceedsRaw: "1500000", bonus: { mint: QUOTE.mint, ownerRaw: "0", referralRaw: "0" } });
  const afterBuy = withTaken(placed, [takenOf(buy, { xRaw: "1000000", yRaw: "0", x: COIN.mint, y: QUOTE.mint }, COIN.mint)]);
  assert.deepEqual(afterBuy.free, { coinRaw: "1000000", quoteRaw: "0" }, "what came, not what the order read said");
  assert.deepEqual(afterBuy.basis, { coinRaw: "2000000", quoteRaw: "7000000" });
  assert.equal(afterBuy.filledTaken, 3, "filled prices are counted as the order read counts them");
  assert.equal(afterBuy.profitRaw, "0");
  /* A sell filled at 0.0039 paid 3 900 000 lamports and a 5-lamport bonus: it sold 1 MET that cost 0.0035 on average. */
  const sell = order("Sel1", "sell", { filledPrices: 1, filledPrice: 0.0039, proceedsRaw: "3900000", bonus: { mint: QUOTE.mint, ownerRaw: "5", referralRaw: "1" } });
  const afterSell = withTaken(afterBuy, [takenOf(sell, { xRaw: "0", yRaw: "3900005", x: COIN.mint, y: QUOTE.mint }, COIN.mint)]);
  assert.equal(afterSell.profitRaw, "400000");
  assert.deepEqual(afterSell.basis, { coinRaw: "1000000", quoteRaw: "3500000" });
  assert.deepEqual(afterSell.free, { coinRaw: "1000000", quoteRaw: "3900000" }, "the bonus is the person's, not placed again");
  assert.equal(afterSell.bonusTaken[QUOTE.mint], "5");
  /* Sold under its cost: the grid tells a loss, never a made-up gain. */
  const low = withTaken(afterBuy, [takenOf(order("Sel1", "sell", { filledPrices: 1, filledPrice: 0.003, bonus: { mint: QUOTE.mint, ownerRaw: "0", referralRaw: "0" } }), { xRaw: "0", yRaw: "3000000", x: COIN.mint, y: QUOTE.mint }, COIN.mint)]);
  assert.equal(low.profitRaw, "-500000");
  assert.equal(readRecord(JSON.parse(JSON.stringify(low))).profitRaw, "-500000", "a loss is kept as it is");
  /* Placing again takes from what is free. */
  const again = withPlaced(afterSell, [{ nftMint: "Sel2", action: "sell", restsRaw: "1000000" }], true);
  assert.deepEqual(again.free, { coinRaw: "0", quoteRaw: "3900000" });
  assert.equal(again.orders.length, 3);
  const stopped = withStopped(again, [], 99);
  assert.equal(stopped.stoppedAt, 99);
  assert.equal(gridView(stopped, []).state, "stopped");
  assert.deepEqual(gridRefill(stopped, gridView(stopped, []), 0.0035), { buy: null, sell: null }, "a stopped grid places nothing again");
  assert.equal(quoteWorth(1_000_000n, 150, 9, 6), 150_000n, "0.001 SOL at $150 is 0.15 USDC");
});

test("the price fell under the band: what was bought is placed again over the price, and the earnings say what it really was", () => {
  const shape = { lower: 90, upper: 110, levels: 11 };
  const prices = gridPrices(shape);
  const refill = refillPlan(prices, gridStep(shape), 85, { buyHigh: null, sellLow: null }, { coinRaw: 5_000_000n, quoteRaw: 0n });
  assert.equal(refill.buy, null);
  assert.equal(refill.sell.rungs, 11, "every level is over the price now");
});

test("the classic venue: the same plan as two legs of the ladder — from 2 to 12 levels a side, never more", () => {
  const pool = { pool: "P", binStep: 10, activeId: 0, baseIsX: true, baseMint: "So11111111111111111111111111111111111111112", quoteMint: "USDC", baseDecimals: 9, quoteDecimals: 6 };
  const price = binPrice(0, pool);
  const plan = gridPlan({ lower: price * 0.9, upper: price * 1.1, levels: 11 }, 500, { price, coinDecimals: 9, quoteDecimals: 6 });
  const grid = classicGrid(plan, price, pool);
  assert.equal(grid.issue, null);
  assert.deepEqual(grid.legs.map((leg) => [leg.side, leg.steps, leg.shape]), [["buy", 5, "even"], ["exit", 5, "even"]]);
  assert.ok(grid.legs.every((leg) => leg.firstPct > 0 && leg.lastPct > leg.firstPct && leg.lastPct <= 10.01));
  assert.equal(grid.plans.length, 2);
  const wide = gridPlan({ lower: price * 0.7, upper: price * 1.3, levels: 31 }, 500, { price, coinDecimals: 9, quoteDecimals: 6 });
  assert.equal(classicGrid(wide, price, pool).issue, "classicSide", "15 levels a side do not fit a classic ladder");
  /* The classic read counts prices: no earnings are told, and stopping needs no take first. */
  const rec = { ...record(), venue: "dlmm", orders: [{ nftMint: "L1", action: "buy" }, { nftMint: "L2", action: "sell" }] };
  const view = classicView(rec, { L1: { limitOrder: "L1", pool: "P", state: "partial", rungs: 5, filled: 2, partial: 0 }, L2: { limitOrder: "L2", pool: "P", state: "open", rungs: 5, filled: 0, partial: 0 } });
  assert.deepEqual([view.state, view.resting, view.waiting, view.profitRaw, view.canTake], ["filled", 8, 2, 0n, false]);
});

test("a record read back from storage is checked, never trusted", () => {
  const good = withPlaced(record(), [{ nftMint: "Buy1", action: "buy", restsRaw: "1" }], false);
  assert.deepEqual(readRecord(JSON.parse(JSON.stringify(good))), good);
  assert.equal(readRecord({ ...good, v: 2 }), null);
  assert.equal(readRecord({ ...good, network: "testnet" }), null);
  assert.equal(readRecord({ ...good, orders: [{ nftMint: "x", action: "hold" }] }), null);
  assert.equal(readRecord({ ...good, free: { coinRaw: "-1", quoteRaw: "0" } }), null);
  assert.equal(readRecord(null), null);
});

/* ------------------------------------------------------------------ the actions */

const review = (n, tx = 1) => ({ action: "place", network: "devnet", transactions: Array.from({ length: tx }, (_, i) => `u${n}-${i}`), ticket: `t${n}`, expiresAt: 0, nftMint: `N${n}`, networkFeeLamports: "10000", rentLamports: "30000000", accountsLamports: "0", quote: { amountRaw: `${n}00` }, agent: false, receives: null, referral: null });

function fakeEngine({ failReviewAt = -1, failSubmitAt = -1 } = {}) {
  const log = [];
  let n = 0;
  let s = 0;
  return {
    log,
    engine: {
      market: async () => ({ ok: true, value: null }),
      orders: async () => ({ ok: true, value: [] }),
      review: async (ask) => {
        log.push(["review", ask.action]);
        n += 1;
        if (n - 1 === failReviewAt) return { ok: false, failure: { code: "PRO_LIMIT_BALANCE_LOW", message: "" } };
        return { ok: true, value: review(n, ask.action === "place" ? 1 : 2) };
      },
      submit: async (ticket, signed) => {
        log.push(["submit", ticket, signed]);
        s += 1;
        if (s - 1 === failSubmitAt) return { ok: false, failure: { code: "PRO_LIMIT_SUBMIT_FAILED", message: "" } };
        return { ok: true, value: { action: "place", nftMint: `N${ticket.slice(1)}`, results: signed.map((wire) => ({ signature: `sig-${wire}`, state: "LANDED" })), settled: true } };
      },
    },
  };
}

test("one approval for every Review: the wallet signs them all at once, each relay gets its own bytes back in order", async () => {
  const { engine, log } = fakeEngine();
  const signedWith = [];
  const sign = async (unsigned) => {
    signedWith.push([...unsigned]);
    return unsigned.map((wire) => `${wire}*`);
  };
  const phases = [];
  const intents = { buy: { action: "buy", nearBps: 100, farBps: 1000, rungs: 5, spread: "even", amountRaw: "1" }, sell: { action: "sell", nearBps: 100, farBps: 1000, rungs: 5, spread: "even", amountRaw: "2" } };
  const asks = placeAsks(OWNER, COIN.mint, intents);
  assert.deepEqual(asks.map((ask) => [ask.action, ask.intent.action, ask.agent]), [["place", "buy", false], ["place", "sell", false]]);
  const done = await approveAll(engine, sign, asks, (phase) => phases.push(phase));
  assert.equal(done.failure, null);
  assert.deepEqual(signedWith, [["u1-0", "u2-0"]], "one approval");
  assert.deepEqual(log.filter(([kind]) => kind === "submit").map(([, ticket, signed]) => [ticket, signed]), [["t1", ["u1-0*"]], ["t2", ["u2-0*"]]]);
  assert.deepEqual(phases, ["reviewing", "wallet", "sending"]);
  assert.deepEqual(placedOf(done), [{ nftMint: "N1", action: "buy", restsRaw: "100" }, { nftMint: "N2", action: "sell", restsRaw: "200" }]);
  assert.deepEqual(costOf(done.landed.map((one) => one.review)), { feeLamports: 20_000n, rentLamports: 60_000_000n });
});

test("a Review that fails asks the wallet nothing; a relay that fails stops the ones after it", async () => {
  const intents = { buy: { action: "buy", nearBps: 100, farBps: 1000, rungs: 5, spread: "even", amountRaw: "1" }, sell: { action: "sell", nearBps: 100, farBps: 1000, rungs: 5, spread: "even", amountRaw: "2" } };
  let asked = 0;
  const sign = async (unsigned) => {
    asked += 1;
    return unsigned;
  };
  const first = fakeEngine({ failReviewAt: 1 });
  const refused = await approveAll(first.engine, sign, placeAsks(OWNER, COIN.mint, intents));
  assert.equal(refused.failure.code, "PRO_LIMIT_BALANCE_LOW");
  assert.equal(asked, 0);
  assert.deepEqual(refused.landed, []);
  const second = fakeEngine({ failSubmitAt: 1 });
  const partly = await approveAll(second.engine, sign, placeAsks(OWNER, COIN.mint, intents));
  assert.equal(partly.landed.length, 1);
  assert.equal(partly.failure.code, "PRO_LIMIT_SUBMIT_FAILED");
  const declined = await approveAll(fakeEngine().engine, async () => null, placeAsks(OWNER, COIN.mint, intents));
  assert.equal(declined.failure.code, "WALLET_DECLINED");
  assert.deepEqual(declined.landed, []);
});

test("take asks for the orders with a filled price; stop for every order of the grid", () => {
  const live = [order("A", "buy", { filledPrices: 2 }), order("B", "sell")];
  assert.deepEqual(takeAsks(OWNER, live), [{ action: "collect", owner: OWNER, pool: POOL, nftMint: "A" }]);
  assert.deepEqual(stopAsks(OWNER, live).map((ask) => [ask.action, ask.nftMint]), [["close", "A"], ["close", "B"]]);
});

test("the grid reaches the venue only through the lane: no import of the venue, its SDK, or a key", () => {
  for (const file of ["plan.ts", "grid.ts", "flow.ts"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /meteora-dlmm-pro|dlmm-pro-sdk|Keypair|secretKey|signTransaction/, file);
    const lane = source.split(/\r?\n/).filter((one) => /from ['"][^'"]*pro-limits\//.test(one));
    for (const line of lane) assert.match(line, /^import type /, `${file}: the lane is read for its types only`);
  }
});
