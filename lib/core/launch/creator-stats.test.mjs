import assert from "node:assert/strict";
import test from "node:test";

import {
  coverReaches,
  creatorSales,
  lpWindow,
  partOfFigure,
  poolDepth,
  poolFeeWindows,
  revenueWindows,
  traderCounts,
  volumeWindows,
  windowSum,
  windowTotal,
} from "./creator-stats.ts";

const NOW = 1_800_000_000;
const HOUR = 3_600;
const DAY = 24 * HOUR;
const CREATOR = "D6qfb7KivAR1RUHQSWqvyNejxmbft7bq4u3dos8yKwgU";
const A = "Fb2AbDwuQ4yNvmQRK7bTZWXoDZRE3AYLcqamPyhg4tL8";
const B = "EAMKay5kBxeN78xCvHVyL77ZkhGqkuTmJC2G4D2MsUuC";
const WHOLE = { complete: true, coveredFrom: null, gaps: [] };

let n = 0;
const trade = (over) => ({
  signature: `sig${(n += 1)}`,
  slot: 1_000 + n,
  at: NOW - HOUR,
  side: "buy",
  venue: "curve",
  trader: A,
  tokensRaw: "1000",
  pairRaw: "1000000",
  feeRaw: "10000",
  creatorRaw: "3200",
  ...over,
});

test("a window is exact only where every transaction since its start was read; a floor where something was found; else not read", () => {
  assert.equal(coverReaches(WHOLE, NOW - DAY), true);
  /* Listed back to 30 hours ago, nothing unread: the day is whole, the week is not. */
  const part = { complete: false, coveredFrom: NOW - 30 * HOUR, gaps: [] };
  assert.equal(coverReaches(part, NOW - DAY), true);
  assert.equal(coverReaches(part, NOW - 7 * DAY), false);
  /* A transaction listed and not read inside the day: the day is not whole. */
  assert.equal(coverReaches({ ...part, gaps: [NOW - 2 * HOUR] }, NOW - DAY), false);

  const trades = [trade({}), trade({ at: NOW - 3 * DAY })];
  const pick = (t) => BigInt(t.creatorRaw);
  assert.deepEqual(windowSum(trades, NOW - DAY, WHOLE, pick), { raw: "3200", atLeast: false });
  assert.deepEqual(windowSum(trades, NOW - 7 * DAY, part, pick), { raw: "6400", atLeast: true }, "the week read in part is a floor");
  assert.deepEqual(windowSum([], NOW - 7 * DAY, part, pick), { raw: null, atLeast: false }, "a floor of nothing says nothing");
  /* A swap decoded before the creator's part was counted: never read as zero. */
  assert.deepEqual(windowSum([trade({ creatorRaw: undefined })], NOW - DAY, WHOLE, (t) => (t.creatorRaw === undefined ? undefined : BigInt(t.creatorRaw))), { raw: null, atLeast: false });
});

const GRADUATION = { migrated: true, thresholdRaw: "15454411163", feePct: 2, creatorPct: 40, withdrawn: false };

test("the day's and the week's earnings by source: the curve's creator part per swap, the graduation fee once at its time, the LP's share", () => {
  const trades = [
    trade({ at: NOW - 2 * HOUR, creatorRaw: "3200" }),
    trade({ at: NOW - 3 * DAY, creatorRaw: "6400" }),
    trade({ venue: "pool", at: NOW - HOUR, creatorRaw: undefined, lpRaw: "8000", slot: 5_000 }),
    trade({ venue: "pool", at: NOW - 2 * DAY, creatorRaw: undefined, lpRaw: "4000", slot: 4_000 }),
  ];
  const windows = revenueWindows({
    now: NOW,
    trades,
    cover: WHOLE,
    read: { graduation: GRADUATION },
    graduatedAt: NOW - 2 * DAY - HOUR,
    migrated: true,
    lp: { positionLiquidity: "500", poolLiquidity: "1000", changeSlots: [100] },
  });
  assert.deepEqual(windows.day, { curve: { raw: "3200", atLeast: false }, graduation: { raw: "0", atLeast: false }, lp: { raw: "4000", atLeast: false } });
  /* The graduation fee on the threshold: 2 % of 15 454,41, the creator's 40 % — 123,635289 USDC, in the week. */
  assert.deepEqual(windows.week, { curve: { raw: "9600", atLeast: false }, graduation: { raw: "123635289", atLeast: false }, lp: { raw: "6000", atLeast: false } });
  assert.deepEqual(windowTotal(windows.week), { raw: "123650889", atLeast: false });
});

test("before the DEX the graduation and the LP are zero; unread counters, an unknown finish or an unknown share are «not read»", () => {
  const onCurve = { now: NOW, trades: [trade({})], cover: WHOLE, read: { graduation: { ...GRADUATION, migrated: false } }, graduatedAt: null, migrated: false, lp: null };
  const curve = revenueWindows(onCurve);
  assert.deepEqual(curve.day.graduation, { raw: "0", atLeast: false });
  assert.deepEqual(curve.day.lp, { raw: "0", atLeast: false });
  const unread = revenueWindows({ ...onCurve, migrated: true, read: null });
  assert.equal(unread.day.graduation.raw, null);
  assert.equal(unread.day.lp.raw, null);
  assert.equal(windowTotal(unread.day).raw, null, "a total with a source not read is not read");
});

test("the LP's part holds only where the pool's liquidity did not move since the window's first swap, and every transaction was read", () => {
  const swaps = [trade({ venue: "pool", at: NOW - HOUR, lpRaw: "9000", slot: 900, creatorRaw: undefined })];
  const base = { now: NOW, trades: swaps, cover: WHOLE, read: { graduation: GRADUATION }, graduatedAt: NOW - 10 * DAY, migrated: true };
  const share = { positionLiquidity: "1", poolLiquidity: "3", changeSlots: [] };
  assert.deepEqual(lpWindow({ ...base, lp: share }, NOW - DAY), { raw: "3000", atLeast: false });
  /* Liquidity added after the window's first swap: the share then was another. */
  assert.equal(lpWindow({ ...base, lp: { ...share, changeSlots: [950] } }, NOW - DAY).raw, null);
  /* Added before it: the share held for every swap counted. */
  assert.equal(lpWindow({ ...base, lp: { ...share, changeSlots: [800] } }, NOW - DAY).raw, "3000");
  /* A pool transaction decoded without looking for liquidity moves, or a transaction not read: never a floor on a share that may be wrong. */
  assert.equal(lpWindow({ ...base, lp: { ...share, changeSlots: null } }, NOW - DAY).raw, null);
  assert.equal(lpWindow({ ...base, lp: share, cover: { complete: false, coveredFrom: NOW - 2 * HOUR, gaps: [] } }, NOW - DAY).raw, null);
  assert.equal(lpWindow({ ...base, lp: share, trades: [{ ...swaps[0], lpRaw: undefined }] }, NOW - DAY).raw, null);
});

test("volume over the day, the week and all the history; the pool's fees after the DEX", () => {
  const trades = [trade({ pairRaw: "5" }), trade({ at: NOW - 3 * DAY, pairRaw: "7" }), trade({ venue: "pool", feeRaw: "11", pairRaw: "13" })];
  assert.deepEqual(volumeWindows(trades, WHOLE, NOW), { day: { raw: "18", atLeast: false }, week: { raw: "25", atLeast: false }, all: { raw: "25", atLeast: false } });
  const part = { complete: false, coveredFrom: NOW - 2 * DAY, gaps: [] };
  assert.deepEqual(volumeWindows(trades, part, NOW).all, { raw: "25", atLeast: true }, "all of a history read in part is a floor");
  assert.deepEqual(poolFeeWindows(trades, WHOLE, NOW).day, { raw: "11", atLeast: false });
});

test("traders and those who came back leave out the creator's own wallets and Ryntra's; read in part they are a floor", () => {
  const trades = [trade({ trader: A }), trade({ trader: A }), trade({ trader: B }), trade({ trader: CREATOR })];
  assert.deepEqual(traderCounts(trades, true, new Set([CREATOR])), { traders: { count: 2, atLeast: false }, repeat: { count: 1, atLeast: false } });
  /* Two trades in one transaction are one visit. */
  const same = [trade({ trader: B, signature: "one" }), trade({ trader: B, signature: "one" })];
  assert.deepEqual(traderCounts(same, true, new Set()).repeat, { count: 0, atLeast: false });
  assert.deepEqual(traderCounts(trades, false, new Set([CREATOR])).traders, { count: 2, atLeast: true });
  assert.deepEqual(traderCounts([], false, new Set()).traders, { count: null, atLeast: false });
});

test("the depth ±2 %: a compounding pool by its pair reserve, a concentrated one by its liquidity clipped at its range", () => {
  const compounding = { tokenIsA: true, compounding: true, sqrtPrice: "0", sqrtMinPrice: "0", sqrtMaxPrice: "0", liquidity: "0", pairReserveRaw: "1000000000" };
  /* y·(√1,02 − 1) and y·(1 − √0,98) on 1 000 USDC: 9,950 and 10,050. */
  assert.deepEqual(poolDepth(compounding), { upRaw: "9950493", downRaw: "10050506" });
  assert.equal(poolDepth({ ...compounding, tokenIsA: false }), null, "the formula here is the pair-as-B side's");
  const q64 = 2n ** 64n;
  const concentrated = { ...compounding, compounding: false, sqrtPrice: q64.toString(), sqrtMinPrice: "1", sqrtMaxPrice: (q64 * 2n).toString(), liquidity: (1_000_000_000n * q64).toString() };
  const depth = poolDepth(concentrated);
  assert.ok(Math.abs(Number(depth.upRaw) - 9_950_493) <= 2);
  /* The range ends at the price: nothing moves it up. */
  assert.equal(poolDepth({ ...concentrated, sqrtMaxPrice: q64.toString() }).upRaw, "0");
});

test("the creator's own trades: bought, sold and the newest sales first; a wallet's part of a figure rounded down", () => {
  const trades = [trade({ trader: CREATOR, tokensRaw: "100" }), trade({ trader: CREATOR, side: "sell", tokensRaw: "30", at: NOW - 5 }), trade({ trader: CREATOR, side: "sell", tokensRaw: "20", at: NOW - 1 }), trade({ trader: A })];
  const own = creatorSales(trades, CREATOR);
  assert.equal(own.boughtRaw, "100");
  assert.equal(own.soldRaw, "50");
  assert.deepEqual(own.sales.map((sale) => sale.tokensRaw), ["20", "30"]);
  assert.deepEqual(partOfFigure({ raw: "999", atLeast: true }, 6_000), { raw: "599", atLeast: true });
  assert.deepEqual(partOfFigure({ raw: null, atLeast: false }, 6_000), { raw: null, atLeast: false });
});
