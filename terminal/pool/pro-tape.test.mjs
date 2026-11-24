// A DLMM Pro pool's day, trades and filled limit orders on the screens — from the program's own events. A day read in
// part is a floor, a pool whose read did not answer is no figure (never a zero), and the table's orders put the
// unknown last.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { dayOf, daysOf, fillAmounts, sidesOf, sortProRows, walletHref } from "./pro-tape.ts";
import { isProDaysAnswer } from "../../lib/pro-pools/tape.ts";
import { withProDays, dayUsdText } from "../earn/choose.ts";
import { POOL } from "./words.ts";

const STATS = {
  hours: 24,
  from: "2026-11-13T13:01:32.000Z",
  to: "2026-11-14T13:01:32.000Z",
  whole: true,
  trades: { count: 5, buys: 4, sells: 1, wallets: 2 },
  volume: { coinRaw: "1", quoteRaw: "3765516090", usd: 3765.51609 },
  fees: {
    total: { xRaw: "0", yRaw: "427802732", usd: 427.802732 },
    lp: { xRaw: "0", yRaw: "335344310", usd: 335.34431 },
    orders: { xRaw: "0", yRaw: "4311178", usd: 4.311178 },
    protocol: { xRaw: "0", yRaw: "73035137", usd: 73.035137 },
    referral: { xRaw: "0", yRaw: "15112107", usd: 15.112107 },
    partner: { xRaw: "0", yRaw: "0", usd: 0 },
  },
  orders: { placed: 2, fillingTrades: 1, filled: 2, partial: 1, unfilled: 0, unknown: 0, bonusEarned: { xRaw: "0", yRaw: "4311178", usd: 4.311178 }, bonusPaid: { xRaw: "0", yRaw: "4766850", usd: 4.76685 }, referralPaid: { xRaw: "0", yRaw: "862235", usd: 0.862235 } },
  price: { first: 0.000005, last: 0.000011 },
};

test("the day of a pool: volume, the depositors' fees and the whole fee, trades, filled orders and the bonus paid", () => {
  const day = dayOf(STATS);
  assert.equal(day.volumeUsd, 3765.51609);
  assert.equal(day.lpFeesUsd, 335.34431);
  assert.equal(day.feesUsd, 427.802732);
  assert.equal(day.trades, 5);
  assert.equal(day.filled, 3, "filled whole and in part");
  assert.equal(day.bonusPaidUsd, 4.76685);
  assert.deepEqual([day.whole, day.hours], [true, 24]);
  const part = dayOf({ ...STATS, whole: false, from: "2026-11-14T07:31:32.000Z" });
  assert.deepEqual([part.whole, part.hours], [false, 5], "a day read in part names its hours");
});

test("the table's days come from one answer: a counted pool by its figures, a zero day as zeros, a pool still counting keeps what the page had or has none", () => {
  const answer = {
    network: "mainnet",
    at: "2026-11-14T13:01:32.000Z",
    fresh: 300,
    days: [
      { pool: "P1", state: "ready", at: "2026-11-14T13:00:00.000Z", depth: { from: null, checked: null, transactions: 0, whole: true, stop: "window" }, stats: STATS },
      { pool: "P2", state: "ready", at: "2026-11-14T13:00:00.000Z", depth: { from: null, checked: null, transactions: 0, whole: true, stop: "window" }, stats: { ...STATS, volume: { coinRaw: "0", quoteRaw: "0", usd: 0 } } },
      { pool: "P3", state: "counting", at: null },
      { pool: "P4", state: "counting", at: null },
    ],
  };
  assert.ok(isProDaysAnswer(answer));
  assert.equal(isProDaysAnswer({ ...answer, days: [{ pool: "P1", state: "ready" }] }), false, "a counted day without its figures is not an answer");
  const was = new Map([["P3", dayOf(STATS)]]);
  const { days, counting } = daysOf(answer, was);
  assert.equal(counting, true);
  assert.equal(days.get("P1").volumeUsd, 3765.51609);
  assert.equal(days.get("P2").volumeUsd, 0, "a quiet day is a zero, said");
  assert.equal(days.get("P3").volumeUsd, 3765.51609, "still counting: the day the page had stays");
  assert.equal(days.has("P4"), false, "still counting and never read: no figure");
  assert.equal(daysOf({ ...answer, days: answer.days.slice(0, 2) }).counting, false);
  const ended = { ...answer, days: [...answer.days.slice(0, 2), { pool: "P5", state: "unknown", at: null }] };
  assert.ok(isProDaysAnswer(ended));
  const read = daysOf(ended, new Map([["P5", dayOf(STATS)]]));
  assert.equal(read.counting, false, "a pool the engine could not count is not waited for");
  assert.equal(read.days.has("P5"), false, "and stands as a quiet empty cell");
  const floor = daysOf({ ...answer, days: [{ ...answer.days[0], stats: { ...STATS, whole: false } }] });
  assert.equal(floor.counting, false, "a day read only in part is a floor, deepened at the usual pace — not asked for every few seconds");
  assert.equal(floor.days.get("P1").whole, false);
});

const proRow = (type, address, over = {}) => ({ key: `${type}:${address}`, type, address, name: "A · B", coins: [{ mint: "a", symbol: "A" }, { mint: "b", symbol: "B" }], verified: true, tvlUsd: 100_000, volume24hUsd: null, fees24hUsd: null, feeTvlPct: null, baseFeePct: 0.1, feePct: 0.1, step: 1, createdAt: null, page: null, act: "pro", ...over });

test("the pools table: a DLMM Pro row takes its day where it was read; a row not read stays empty, never a zero", () => {
  const rows = [proRow("pro", "P1"), proRow("pro", "P2"), proRow("dlmm", "D1", { volume24hUsd: 9, fees24hUsd: 1 })];
  const days = new Map([["P1", { volumeUsd: 5000, lpFeesUsd: 50, whole: true }], ["P2", { volumeUsd: 700, lpFeesUsd: 7, whole: false }], ["D1", { volumeUsd: 1, lpFeesUsd: 1, whole: true }]]);
  const [p1, p2, d1] = withProDays(rows, days);
  assert.deepEqual([p1.volume24hUsd, p1.fees24hUsd, p1.feeTvlPct, p1.dayFloor], [5000, 50, 0.05, false]);
  assert.deepEqual([p2.volume24hUsd, p2.feeTvlPct, p2.dayFloor], [700, null, true], "a day in part gives no day's share of the depth");
  assert.equal(d1.volume24hUsd, 9, "another venue's figures stay its own");
  const [silent] = withProDays([proRow("pro", "P3")], days);
  assert.equal(dayUsdText(silent, silent.volume24hUsd, "en"), "", "a pool whose day did not answer: an empty cell");
  assert.equal(dayUsdText(p2, p2.volume24hUsd, "en"), "≥ $700.00", "a floor says itself");
  assert.equal(dayUsdText(d1, null, "en"), "—", "another venue's unknown keeps its dash");
});

test("the DLMM Pro table orders by the day's volume or fees; a pool not read goes last, in the list's own order", () => {
  const rows = ["A", "B", "C", "D"].map((address, at) => ({ address, tvlUsd: 1000 - at }));
  const days = new Map([["B", { volumeUsd: 10, lpFeesUsd: 3 }], ["D", { volumeUsd: 30, lpFeesUsd: 1 }]]);
  assert.deepEqual(sortProRows(rows, null, days).map((row) => row.address), ["A", "B", "C", "D"], "no order picked — the list's own");
  assert.deepEqual(sortProRows(rows, { key: "volume", dir: "desc" }, days).map((row) => row.address), ["D", "B", "A", "C"]);
  assert.deepEqual(sortProRows(rows, { key: "volume", dir: "asc" }, days).map((row) => row.address), ["B", "D", "A", "C"]);
  assert.deepEqual(sortProRows(rows, { key: "fees", dir: "desc" }, days).map((row) => row.address), ["B", "D", "A", "C"]);
  assert.deepEqual(sortProRows(rows, { key: "tvl", dir: "asc" }, days).map((row) => row.address), ["D", "C", "B", "A"]);
});

test("a filled order: what it got and the bonus, each in its own coin; a wallet opens its own page", () => {
  const pair = { coin: { mint: "c", symbol: "RHRSL", decimals: 6, usd: null, side: "x" }, quote: { mint: "q", symbol: "USDC", decimals: 6, usd: 1, side: "y" } };
  assert.equal(sidesOf(pair).y.symbol, "USDC");
  const fill = { proceedsRaw: "36147690010899", proceedsToken: "x", bonusXRaw: "0", bonusYRaw: "3448943" };
  const { got, bonus } = fillAmounts(fill, pair);
  assert.deepEqual(got, { amount: 36147690.010899, symbol: "RHRSL" });
  assert.deepEqual(bonus, [{ amount: 3.448943, symbol: "USDC" }]);
  assert.equal(fillAmounts({ ...fill, proceedsRaw: null, proceedsToken: null }, pair).got, null, "a side not known — nothing guessed");
  assert.equal(walletHref("Abc"), "/wallet/Abc");
});

test("the pool's page reads its own trades and fills, and says the day's hours only behind its «i»", () => {
  const screen = readFileSync(new URL("./PoolScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /<ProTrades address=\{pool\.address\} \/>/);
  assert.match(screen, /<ProFills address=\{pool\.address\}/);
  assert.match(screen, /\.\.\.dayOf\(w\.volume24, day\?\.volumeUsd\)/);
  assert.doesNotMatch(screen, /day \? digits\(String\(day\.trades\), lang\) : .—./, "a day not read leaves its figures out, never a dash");
  const tape = readFileSync(new URL("./ProTape.tsx", import.meta.url), "utf8");
  assert.match(tape, /day && day\.bonusPaidUsd !== null \?/, "the day's bonus stands only once the day is read");
  for (const lang of ["en", "uk"]) {
    const said = POOL[lang].dayPart("5");
    assert.doesNotMatch(said, /\b(tick|bin|event|signature|program|api)\b|подія|підпис/i, `${lang}: «${said}»`);
  }
});
