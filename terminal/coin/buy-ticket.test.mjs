import assert from "node:assert/strict";
import test from "node:test";

import {
  PROTECT_START,
  QUICK_START,
  QUICK_SLOTS,
  capFromTyped,
  capHint,
  capShort,
  capToPrice,
  capWritten,
  cleanPct,
  cleanQuickSum,
  editQuick,
  entryOf,
  priceToCap,
  protectPrices,
  quickActionAt,
  quickActions,
  readQuick,
  standOf,
  writeQuick,
  STOP_RANGE,
  TAKE_RANGE,
} from "./ticket-rules.ts";

/* The buy ticket's own rules: the person's quick sums and what they do, take-profit and stop from the buy that landed,
   the limit by market cap, and the strip of what this wallet did in the coin — held as they are written. */

test("a quick sum is a plain positive decimal: a comma is the point, places and size are held, zeros dropped", () => {
  assert.equal(cleanQuickSum("0,5", "sol"), "0.5");
  assert.equal(cleanQuickSum(" 0.250 ", "sol"), "0.25");
  assert.equal(cleanQuickSum("0100", "usd"), "100");
  assert.equal(cleanQuickSum(".5", "sol"), "0.5");
  assert.equal(cleanQuickSum("1.2345", "sol"), "1.2345");
  assert.equal(cleanQuickSum("1.23456", "sol"), null, "five places of SOL");
  assert.equal(cleanQuickSum("10.55", "usd"), "10.55");
  assert.equal(cleanQuickSum("10.555", "usd"), null, "three places of a dollar");
  for (const bad of ["", ".", "0", "0.0", "-1", "1e3", "abc", "1.2.3"]) assert.equal(cleanQuickSum(bad, "sol"), null, `«${bad}» is no sum`);
  assert.equal(cleanQuickSum("10000", "sol"), "10000");
  assert.equal(cleanQuickSum("10001", "sol"), null, "more than 10,000 SOL");
  assert.equal(cleanQuickSum("1000001", "usd"), null, "more than a million dollars");
});

test("what the browser kept is read whole: a row that is not four different clean sums, or a per cent off its range, falls back", () => {
  assert.deepEqual(readQuick(null), { sums: QUICK_START, protect: PROTECT_START });
  assert.deepEqual(readQuick("not json"), { sums: QUICK_START, protect: PROTECT_START });
  const kept = readQuick(JSON.stringify({ sums: { sol: ["2", "0.25", "1", "0.05"], usd: ["10", "10", "20", "30"] }, protect: { take: 100, stop: 95 } }));
  assert.deepEqual(kept.sums.sol, ["0.05", "0.25", "1", "2"], "kept smallest first");
  assert.deepEqual(kept.sums.usd, QUICK_START.usd, "two equal sums are no row");
  assert.deepEqual(kept.protect, { take: 100, stop: PROTECT_START.stop }, "a stop of 95% is off its range");
  // What is written reads back the same.
  const back = readQuick(writeQuick({ sums: { sol: ["0.2", "0.4", "0.8", "1.6"], usd: QUICK_START.usd }, protect: { take: 30, stop: 10 } }));
  assert.deepEqual(back, { sums: { sol: ["0.2", "0.4", "0.8", "1.6"], usd: QUICK_START.usd }, protect: { take: 30, stop: 10 } });
});

test("an edited row is kept sorted, or names the first sum that cannot be one — the second of two equal ones", () => {
  assert.deepEqual(editQuick(["5", "0,1", "1", "0.5"], "sol"), { ok: true, row: ["0.1", "0.5", "1", "5"] });
  assert.deepEqual(editQuick(["1", "2", "1", "3"], "sol"), { ok: false, bad: 2 });
  assert.deepEqual(editQuick(["1", "", "2", "3"], "usd"), { ok: false, bad: 1 });
  assert.deepEqual(editQuick(["1", "2", "3"], "usd"), { ok: false, bad: 3 }, "four sums or none");
});

test("a take-profit is 1–1000% and a stop 1–90%, whole", () => {
  assert.equal(cleanPct(50, TAKE_RANGE), 50);
  assert.equal(cleanPct("20", STOP_RANGE), 20);
  assert.equal(cleanPct(0, TAKE_RANGE), null);
  assert.equal(cleanPct(1001, TAKE_RANGE), null);
  assert.equal(cleanPct(91, STOP_RANGE), null);
  assert.equal(cleanPct(12.5, STOP_RANGE), null);
  assert.equal(cleanPct("x", STOP_RANGE), null);
});

test("the quick row as deeds: a buy in SOL or dollars writes its sums, a sale and a buy in another coin take shares; the keys reach the same", () => {
  const sums = { sol: ["0.1", "0.5", "1", "5"], usd: ["10", "50", "100", "500"] };
  const shares = [25, 50, 75, 100];
  const sol = quickActions({ side: "buy", pay: "sol", sums, shares });
  assert.equal(sol.length, QUICK_SLOTS);
  assert.deepEqual(sol[0], { slot: 1, kind: "amount", amount: "0.1", pay: "sol" });
  assert.deepEqual(sol[3], { slot: 4, kind: "amount", amount: "5", pay: "sol" });
  assert.deepEqual(quickActions({ side: "buy", pay: "usd", sums, shares })[1], { slot: 2, kind: "amount", amount: "50", pay: "usd" });
  const sale = quickActions({ side: "sell", pay: "sol", sums, shares: [10, 33, 50, 100] });
  assert.deepEqual(sale.map((action) => action.kind === "share" && action.share), [10, 33, 50, 100], "a sale takes the person's own shares, whatever pays");
  assert.deepEqual(quickActions({ side: "buy", pay: null, sums, shares })[0], { slot: 1, kind: "share", share: 25 });
  assert.deepEqual(quickActionAt({ side: "buy", pay: "sol", sums, shares }, 3), { slot: 3, kind: "amount", amount: "1", pay: "sol" });
  assert.equal(quickActionAt({ side: "buy", pay: "sol", sums, shares }, 5), null);
  assert.equal(quickActionAt({ side: "buy", pay: "sol", sums, shares }, 0), null);
});

test("the entry is what left over what came, as the chain read them; the take-profit and the stop stand their per cent from it", () => {
  // 0.5 SOL (9 places) for 1,000 coins (6 places): 0.0005 SOL a coin.
  const entry = entryOf({ paidRaw: "500000000", paidDecimals: 9, gotRaw: "1000000000", gotDecimals: 6 });
  assert.equal(entry, 0.0005);
  assert.deepEqual(protectPrices(entry, { take: 50, stop: 20 }), { take: "0.00075", stop: "0.0004" });
  assert.deepEqual(protectPrices(2, { take: 100, stop: 90 }), { take: "4", stop: "0.2" });
  assert.equal(entryOf({ paidRaw: "0", paidDecimals: 9, gotRaw: "1", gotDecimals: 6 }), null);
  assert.equal(entryOf({ paidRaw: "1", paidDecimals: 9, gotRaw: "x", gotDecimals: 6 }), null);
  assert.equal(protectPrices(0, PROTECT_START), null);
  assert.equal(protectPrices(Number.NaN, PROTECT_START), null);
  // A tiny price is still written as a price, never an exponent.
  const tiny = protectPrices(0.000000123, { take: 50, stop: 20 });
  assert.ok(tiny && !/e/i.test(tiny.take) && !/e/i.test(tiny.stop), JSON.stringify(tiny));
});

test("a limit by market cap: the cap over the supply, in what pays; and back", () => {
  // A billion coins, SOL at $200: a $1,000,000 cap is $0.001 a coin, 0.000005 SOL.
  const price = capToPrice(1_000_000, 1_000_000_000, 200);
  assert.ok(Math.abs(price - 0.000005) < 1e-15, String(price));
  assert.ok(Math.abs(priceToCap(price, 1_000_000_000, 200) - 1_000_000) < 1e-6);
  // Paid in dollars: the price is the cap over the supply.
  assert.equal(capToPrice(2_500_000, 10_000_000, 1), 0.25);
  for (const [cap, supply, usd] of [[0, 1, 1], [1, null, 1], [1, 0, 1], [1, 1, null], [1, 1, 0], [-1, 1, 1]]) {
    assert.equal(capToPrice(cap, supply, usd), null, `cap ${cap}, supply ${supply}, quote ${usd}`);
  }
  assert.equal(priceToCap(1, null, 1), null);
  assert.equal(capWritten(1234567.6), "1234568");
  assert.equal(capWritten(0), "");
});

test("the cap field's hint marks the thousands the language's way, and the field takes them back as typed", () => {
  assert.equal(capHint(40_812_800_000.4, "en"), "40,812,800,000");
  assert.equal(capHint(612_772, "uk"), "612\u00a0772");
  assert.equal(capHint(999, "en"), "999");
  assert.equal(capHint(0, "en"), "");
  assert.equal(capFromTyped("2,032800000", "en"), "2032800000");
  assert.equal(capFromTyped("1500000.5", "en"), "1500000.5");
  assert.equal(capFromTyped("1500000,5", "uk"), "1500000.5");
  assert.equal(Number(capFromTyped("40,812,800,000", "en")), 40_812_800_000);
});

test("a market cap said short", () => {
  assert.equal(capShort(1_250_000), "$1.25M");
  assert.equal(capShort(840_000), "$840K");
  assert.equal(capShort(2_100_000_000), "$2.1B");
  assert.equal(capShort(12_340), "$12.3K");
  assert.equal(capShort(950), "$950");
  assert.equal(capShort(0), "");
});

const row = (over = {}) => ({ buys: 2, sells: 1, bought: 1000, sold: 400, spentSol: 1, receivedSol: 0.5, partial: false, ...over });
const input = (over = {}) => ({ row: row(), whole: true, unpriced: false, held: 600, priceSol: 0.001, ...over });

test("bought · sold · holding · result: what the sales brought and the holding is worth, less what the buys paid", () => {
  const stand = standOf(input());
  assert.ok(stand);
  assert.equal(stand.boughtSol, 1);
  assert.equal(stand.soldSol, 0.5);
  assert.ok(Math.abs(stand.holdingSol - 0.6) < 1e-12);
  assert.ok(Math.abs(stand.resultSol - 0.1) < 1e-12);
  assert.ok(Math.abs(stand.resultPct - 10) < 1e-9);
  // All sold: nothing held, no price needed.
  const out = standOf(input({ row: row({ sold: 1000, receivedSol: 0.8 }), held: 0, priceSol: null }));
  assert.ok(out && out.holdingSol === 0 && Math.abs(out.resultSol + 0.2) < 1e-12 && Math.abs(out.resultPct + 20) < 1e-9);
  // Bought, never sold.
  const held = standOf(input({ row: row({ sells: 0, sold: 0, receivedSol: null }), held: 1000 }));
  assert.ok(held && held.soldSol === 0 && Math.abs(held.resultSol) < 1e-12);
});

test("the strip is drawn only when the record says it whole — never half known", () => {
  assert.equal(standOf(input({ row: null })), null, "no record of the coin");
  assert.equal(standOf(input({ row: row({ buys: 0 }) })), null, "never bought here");
  assert.equal(standOf(input({ row: row({ partial: true }) })), null, "a leg without a price or a cost");
  assert.equal(standOf(input({ unpriced: true })), null, "a swap for another token");
  assert.equal(standOf(input({ whole: false })), null, "transactions left unread");
  assert.equal(standOf(input({ row: row({ spentSol: null }) })), null, "what the buys paid is not known");
  assert.equal(standOf(input({ row: row({ receivedSol: null }) })), null, "a sale with no price");
  assert.equal(standOf(input({ held: null })), null, "the wallet's balance not read");
  assert.equal(standOf(input({ priceSol: null })), null, "something held and no price");
  assert.equal(standOf(input({ held: 900 })), null, "coins came another way");
  assert.equal(standOf(input({ held: 300 })), null, "coins left another way");
  assert.ok(standOf(input({ held: 603 })), "a rounding of what is held is still the same story");
});
