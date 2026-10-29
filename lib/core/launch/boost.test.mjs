import assert from "node:assert/strict";
import test from "node:test";

import { DEVNET_BOOST_BOUNDS, boostBoundsHold, boostPayouts, boostRuleLines, boostRuleProblems, boostUnlocksAt, formatRaw, holdSeconds } from "./boost.ts";

const NOW = 1_800_000_000;
const HOUR = 3_600;
const rules = (over = {}) => ({
  currency: "PAIR",
  bonusBps: 200,
  minBuyRaw: "50000000",
  capPerWalletRaw: "20000000",
  budgetRaw: "8430000000",
  startsAt: NOW,
  endsAt: NOW + 7 * 24 * HOUR,
  holdHours: 24,
  routes: "any",
  ...over,
});
const units = { symbol: "OWL", decimals: 6, pairSymbol: "USDC", pairDecimals: 6, dollar: true };

let slot = 100;
const buy = (trader, pairRaw, at, over = {}) => ({ signature: `b${slot}${trader}`, slot: slot++, at, side: "buy", trader, payer: trader, pairRaw: String(pairRaw), tokensRaw: String(BigInt(pairRaw) * 10n), ...over });
const sell = (trader, at) => ({ signature: `s${slot}${trader}`, slot: slot++, at, side: "sell", trader, payer: trader, pairRaw: "1", tokensRaw: "1" });
const opts = (over = {}) => ({ excluded: new Set(["CREATOR"]), historyComplete: true, now: NOW + 9 * 24 * HOUR, ...over });

test("the rules hold inside the bounds, and each broken rule is named once in plain words", () => {
  assert.deepEqual(boostRuleProblems(rules(), DEVNET_BOOST_BOUNDS, NOW), []);
  assert.ok(boostBoundsHold(DEVNET_BOOST_BOUNDS));
  const codes = (r, b = DEVNET_BOOST_BOUNDS) => boostRuleProblems(r, b, NOW).map((p) => p.code);
  assert.deepEqual(codes(rules({ bonusBps: 9_000 })), ["BONUS_OUT_OF_BOUNDS"]);
  assert.deepEqual(codes(rules({ budgetRaw: "0" })), ["BUDGET_EMPTY"]);
  assert.deepEqual(codes(rules({ budgetRaw: "1.5" })), ["NOT_AN_AMOUNT"]);
  assert.deepEqual(codes(rules({ capPerWalletRaw: "9000000000" })), ["CAP_ABOVE_BUDGET"]);
  assert.deepEqual(codes(rules({ startsAt: NOW - 3_600, endsAt: NOW + 3_600 })), ["STARTS_IN_PAST"], "purchases count only once the rules are shown");
  assert.deepEqual(codes(rules({ startsAt: NOW - 60 })), [], "a start a minute back is the form's clock, not the past");
  assert.deepEqual(codes(rules({ endsAt: NOW + 30 })), ["WINDOW_TOO_SHORT"]);
  assert.deepEqual(codes(rules({ endsAt: NOW + 40 * 24 * HOUR })), ["WINDOW_TOO_LONG"]);
  assert.deepEqual(codes(rules({ holdHours: 500 })), ["HOLD_OUT_OF_BOUNDS"]);
  const owner = { ...DEVNET_BOOST_BOUNDS, currencies: ["PAIR"], routes: ["ryntra"], minBuyFloorRaw: "10000000", maxCapShareBps: 10, minHoldHours: 1, maxBudgetRaw: { PAIR: "1000000000", TOKEN: null } };
  assert.ok(boostBoundsHold(owner));
  assert.deepEqual(codes(rules({ currency: "TOKEN", routes: "any", minBuyRaw: "1", holdHours: 0 }), owner), [
    "CURRENCY_NOT_ALLOWED",
    "ROUTES_NOT_ALLOWED",
    "MIN_BUY_BELOW_FLOOR",
    "CAP_ABOVE_SHARE",
    "HOLD_OUT_OF_BOUNDS",
  ]);
  assert.deepEqual(codes(rules({ routes: "ryntra" }), owner), ["BUDGET_ABOVE_BOUND", "CAP_ABOVE_SHARE"]);
  assert.ok(boostRuleProblems(rules({ bonusBps: 9_000 }), DEVNET_BOOST_BOUNDS, NOW)[0].message.includes("%"), "a problem reads as a line");
  assert.equal(boostBoundsHold({ ...DEVNET_BOOST_BOUNDS, minBonusBps: 600, maxBonusBps: 500 }), false, "a minimum above its maximum is no bound");
  assert.equal(boostBoundsHold({ ...DEVNET_BOOST_BOUNDS, currencies: ["SOL"] }), false);
});

test("the lines before a purchase: the rules, the window, what does not count, and what holds the budget — uk and en", () => {
  const uk = boostRuleLines(rules({ routes: "ryntra" }), units, "uk");
  assert.equal(uk[0], "Бонус від творця: 2\u00a0% у USDC · у кампанії 8\u00a0430 USDC · від 50 USDC · до 20 USDC на гаманець · одна виплата на гаманець · утримання 24\u00a0год · виплачує творець; Ryntra бере 0");
  assert.match(uk[1], /лише через Ryntra/);
  assert.match(uk[2], /Не рахуються творець/);
  assert.match(uk[3], /^Бюджет заблоковано в Met Lock до 2027-01-2\d \d\d:\d\d UTC: до того його не може забрати ніхто, і творець теж\./);
  assert.match(uk[3], /якщо не підпише — гроші лишаються творцеві, а Ryntra нічого не виплачує замість нього/);
  const en = boostRuleLines(rules(), units, "en");
  assert.equal(en[0], "Creator's bonus: 2% in USDC · $8,430 in the campaign · from $50 · up to $20 per wallet · one payout per wallet · 24 h hold · paid by the creator; Ryntra takes 0");
  assert.match(en[1], /from any route/);
  for (const line of [...uk, ...en]) assert.doesNotMatch(line, /безпечн|гарантовано|guarantee|safe/i, "no promise the chain does not keep");
  const token = boostRuleLines(rules({ currency: "TOKEN", bonusBps: 250, budgetRaw: "1000000000000", capPerWalletRaw: "5000000000", holdHours: 0 }), units, "uk");
  assert.match(token[0], /2,5\u00a0% у OWL · у кампанії 1\u00a0000\u00a0000 OWL · від 50 USDC · до 5\u00a0000 OWL на гаманець .* без утримання/);
  assert.equal(formatRaw("1234567", 6, "en"), "1.2345", "four decimals at most, rounded down");
  assert.equal(formatRaw("1000000", 6, "uk"), "1");
});

test("payouts: one per wallet, the share of its purchases, capped, the budget by first purchase until it runs out", () => {
  const t0 = NOW + 10;
  const trades = [
    buy("A", 100_000_000, t0), // 2 % of 100 = 2 USDC
    buy("B", 2_000_000_000, t0 + 1), // 40 → capped at 20
    buy("A", 60_000_000, t0 + 2), // A adds 1.2
    buy("C", 40_000_000, t0 + 3), // below the minimum
    buy("D", 500_000_000, t0 + 4), // 10
  ];
  const result = boostPayouts(rules({ budgetRaw: "25000000" }), trades, opts());
  assert.equal(result.state, "READY");
  assert.deepEqual(result.rows.map((row) => [row.wallet, row.bonusRaw]), [["A", "3200000"], ["B", "20000000"], ["D", "1800000"]], "D gets what the budget has left");
  assert.equal(result.rows[0].qualifyingPairRaw, "160000000");
  assert.equal(result.rows[0].signature, trades[0].signature, "the row names the first counted purchase");
  assert.equal(result.totalRaw, "25000000");
  assert.equal(result.leftoverRaw, "0");
  const roomy = boostPayouts(rules(), trades, opts());
  assert.equal(roomy.totalRaw, "33200000");
  assert.equal(roomy.leftoverRaw, String(8_430_000_000 - 33_200_000), "what is not paid stays with the creator");
  assert.equal(new Set(roomy.rows.map((row) => row.wallet)).size, roomy.rows.length, "one payout per wallet");
});

test("payouts: a sale before the hold is over drops the wallet; one after it does not", () => {
  const t0 = NOW + 100;
  const trades = [buy("A", 100_000_000, t0), sell("A", t0 + 23 * HOUR), buy("B", 100_000_000, t0), sell("B", t0 + 25 * HOUR), sell("E", t0 - 50), buy("E", 100_000_000, t0)];
  const result = boostPayouts(rules(), trades, opts());
  assert.deepEqual(result.rows.map((row) => row.wallet), ["B", "E"], "a sale before the first purchase is not a sale of it");
  assert.equal(result.soldEarly, 1);
  /* The hold runs from the last counted purchase too: a late top-up does not reset a sale. */
  const late = [buy("F", 100_000_000, t0), buy("F", 100_000_000, t0 + 30 * HOUR), sell("F", t0 + 40 * HOUR)];
  assert.deepEqual(boostPayouts(rules(), late, opts()).rows, []);
  assert.equal(boostPayouts(rules({ holdHours: 0 }), late, opts()).rows.length, 1, "no hold: a sale changes nothing");
});

test("payouts: the creator, the fee wallets, Ryntra's and linked wallets, and purchases the creator paid for are never paid", () => {
  const t0 = NOW + 5;
  const trades = [buy("CREATOR", 900_000_000, t0), buy("SHARE", 900_000_000, t0), buy("RYNTRA", 900_000_000, t0), buy("BUNDLE", 900_000_000, t0, { payer: "CREATOR" }), buy("LINKED", 900_000_000, t0), buy("P", 900_000_000, t0)];
  const result = boostPayouts(rules(), trades, opts({ excluded: new Set(["CREATOR", "SHARE", "RYNTRA", "LINKED"]) }));
  assert.deepEqual(result.rows.map((row) => row.wallet), ["P"]);
});

test("payouts: nothing is paid on a partial read, before the hold is over it waits, outside the window nothing counts", () => {
  const trades = [buy("A", 100_000_000, NOW + 5), buy("B", 100_000_000, NOW - 5), buy("C", 100_000_000, NOW + 7 * 24 * HOUR)];
  const partial = boostPayouts(rules(), trades, opts({ historyComplete: false }));
  assert.equal(partial.state, "NOT_READ");
  assert.deepEqual(partial.rows, []);
  assert.equal(partial.totalRaw, "0");
  const end = boostUnlocksAt(rules());
  assert.equal(end, NOW + 7 * 24 * HOUR + 24 * HOUR);
  assert.equal(boostPayouts(rules(), trades, opts({ now: end - 1 })).state, "WAITING");
  const ready = boostPayouts(rules(), trades, opts({ now: end }));
  assert.equal(ready.state, "READY");
  assert.deepEqual(ready.rows.map((row) => row.wallet), ["A"], "before the start and at the end do not count");
  assert.equal(holdSeconds({ holdHours: 0.05 }), 180);
});

test("payouts through Ryntra: only the purchases Ryntra's trade route sent; without their list, nothing is counted", () => {
  const a = buy("A", 100_000_000, NOW + 5);
  const b = buy("B", 100_000_000, NOW + 6);
  const r = rules({ routes: "ryntra" });
  assert.equal(boostPayouts(r, [a, b], opts()).state, "NOT_READ", "no list of Ryntra's purchases: not read, never «any»");
  assert.deepEqual(boostPayouts(r, [a, b], opts({ viaRyntra: new Set([b.signature]) })).rows.map((row) => row.wallet), ["B"]);
});

test("payouts in the token: the share of the tokens received, capped in tokens", () => {
  const r = rules({ currency: "TOKEN", bonusBps: 1_000, capPerWalletRaw: "150000000", budgetRaw: "10000000000" });
  const result = boostPayouts(r, [buy("A", 100_000_000, NOW + 5), buy("B", 500_000_000, NOW + 6)], opts());
  assert.deepEqual(result.rows.map((row) => [row.wallet, row.bonusRaw]), [["A", "100000000"], ["B", "150000000"]], "10 % of 1 000 and of 5 000 tokens (capped at 150)");
  assert.equal(result.rows[1].qualifyingTokensRaw, "5000000000");
});

test("rounding is down, and a bonus that rounds to nothing is no row", () => {
  const result = boostPayouts(rules({ bonusBps: 1, minBuyRaw: "1", capPerWalletRaw: "100" }), [buy("A", 9_999, NOW + 5), buy("B", 10_001, NOW + 6)], opts());
  assert.deepEqual(result.rows.map((row) => [row.wallet, row.bonusRaw]), [["B", "1"]]);
});
