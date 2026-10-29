import { test } from "node:test";
import assert from "node:assert/strict";

import { decide, keepWeek, leftInWeek, opensAgainAt, SEEN_MS, spentInWeek, usdOfBuy, WEEK_MS } from "./scout.ts";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const tower = (id, over = {}) => ({
  id,
  symbol: id,
  name: id,
  icon: null,
  district: "strip",
  price: 1,
  mcap: 100_000_000,
  liquidity: 2_000_000,
  holders: 10_000,
  change5m: 0,
  change1h: 6,
  change24h: 10,
  volume24h: 1_000_000,
  traders1h: 500,
  organic: 60,
  verified: true,
  launchedAt: null,
  ...over,
});

const rule = { signal: "rise1h", move: 5, liquidity: 250_000, area: "any", budget: 100 };
const towers = [tower("A", { change1h: 12 }), tower("B", { change1h: 7 }), tower("C", { change1h: 1 })];

test("the scout brings the strongest match with its reasons", () => {
  const d = decide({ rule, towers, live: true, seen: {}, ledger: [], now: NOW });
  assert.equal(d.kind, "find");
  assert.equal(d.tower.id, "A");
  assert.deepEqual([d.facts[0].label, d.facts[0].value], ["Move 1H", "+12.0%"]);
});

test("old or saved data brings nothing", () => {
  assert.deepEqual(decide({ rule, towers, live: false, seen: {}, ledger: [], now: NOW }), { kind: "waiting" });
});

test("a tower brought a moment ago is not brought again until hours pass", () => {
  const seen = { A: NOW - 60_000 };
  assert.equal(decide({ rule, towers, live: true, seen, ledger: [], now: NOW }).tower.id, "B");
  const later = { A: NOW - SEEN_MS };
  assert.equal(decide({ rule, towers, live: true, seen: later, ledger: [], now: NOW }).tower.id, "A");
  assert.deepEqual(decide({ rule, towers, live: true, seen: { A: NOW, B: NOW }, ledger: [], now: NOW }), { kind: "quiet" });
});

test("with the week's budget spent, the scout rests until the oldest buy leaves the seven days", () => {
  const ledger = [
    { at: NOW - 3 * DAY, mint: "A", usd: 60 },
    { at: NOW - 1 * DAY, mint: "B", usd: 45 },
  ];
  const d = decide({ rule, towers, live: true, seen: {}, ledger, now: NOW });
  assert.deepEqual(d, { kind: "resting", until: NOW - 3 * DAY + WEEK_MS });
  // Resting wins over old data: the reason on the card is the budget.
  assert.equal(decide({ rule, towers, live: false, seen: {}, ledger, now: NOW }).kind, "resting");
  // A bigger budget, and the same buys leave room again.
  assert.equal(decide({ rule: { ...rule, budget: 250 }, towers, live: true, seen: {}, ledger, now: NOW }).kind, "find");
});

test("only the last seven days count", () => {
  const ledger = [
    { at: NOW - 8 * DAY, mint: "A", usd: 90 },
    { at: NOW - 2 * DAY, mint: "B", usd: 30 },
    { at: NOW + DAY, mint: "C", usd: 500 },
    { at: NOW - DAY, mint: "D", usd: Number.NaN },
  ];
  assert.deepEqual(keepWeek(ledger, NOW).map((s) => s.mint), ["B"]);
  assert.equal(spentInWeek(ledger, NOW), 30);
  assert.equal(leftInWeek(100, ledger, NOW), 70);
  assert.equal(leftInWeek(20, ledger, NOW), 0);
});

test("budget comes back when enough of the oldest buys have left the week", () => {
  const ledger = [
    { at: NOW - 5 * DAY, mint: "A", usd: 20 },
    { at: NOW - 4 * DAY, mint: "B", usd: 50 },
    { at: NOW - 1 * DAY, mint: "C", usd: 40 },
  ];
  // 110 of 100: the first buy leaving still leaves 90 < 100, so budget is back then.
  assert.equal(opensAgainAt(100, ledger, NOW), NOW - 5 * DAY + WEEK_MS);
  // 110 of 60: two buys must leave.
  assert.equal(opensAgainAt(60, ledger, NOW), NOW - 4 * DAY + WEEK_MS);
  assert.equal(opensAgainAt(250, ledger, NOW), null);
});

test("a buy counts in dollars: USDC as a dollar, SOL at the city's SOL price", () => {
  const prices = { solMint: "SOL", usdcMint: "USDC", sol: 180 };
  assert.equal(usdOfBuy({ inputMint: "SOL", inputRaw: "500000000", decimals: 9 }, prices), 90);
  assert.equal(usdOfBuy({ inputMint: "USDC", inputRaw: "25000000", decimals: 6 }, prices), 25);
  assert.equal(usdOfBuy({ inputMint: "SOL", inputRaw: null, decimals: 9 }, prices), null);
  assert.equal(usdOfBuy({ inputMint: "SOL", inputRaw: "1", decimals: 9 }, { ...prices, sol: null }), null);
  assert.equal(usdOfBuy({ inputMint: "BONK", inputRaw: "1", decimals: 5 }, prices), null);
  assert.equal(usdOfBuy({ inputMint: "SOL", inputRaw: "-1", decimals: 9 }, prices), null);
});
