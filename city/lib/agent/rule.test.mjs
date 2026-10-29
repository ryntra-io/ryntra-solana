import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_RULE, explain, fits, matches, miss, readRule, ruleLine, withSignal } from "./rule.ts";

const tower = (over = {}) => ({
  id: "WIF",
  symbol: "WIF",
  name: "dogwifhat",
  icon: null,
  district: "strip",
  price: 1.2,
  mcap: 1_200_000_000,
  liquidity: 4_000_000,
  holders: 200_000,
  change5m: 0.4,
  change1h: 6.2,
  change24h: 12,
  volume24h: 90_000_000,
  traders1h: 1800,
  organic: 74,
  verified: true,
  launchedAt: null,
  ...over,
});

const rule = { signal: "rise1h", move: 5, liquidity: 250_000, area: "any", budget: 100 };

test("a coin rising this hour with deep liquidity fits", () => {
  assert.equal(miss(tower(), rule), null);
  assert.ok(fits(tower(), rule));
});

test("each part of the rule can leave a coin out", () => {
  assert.equal(miss(tower({ change1h: 4.9 }), rule), "move");
  assert.equal(miss(tower({ liquidity: 249_999 }), rule), "liquidity");
  assert.equal(miss(tower(), { ...rule, area: "core" }), "area");
  assert.equal(miss(tower(), { ...rule, area: "strip" }), null);
  assert.equal(miss(tower(), { ...rule, signal: "rise24h", move: 25 }), "move");
  assert.equal(miss(tower(), { ...rule, signal: "rise24h", move: 10 }), null);
});

test("a dip rule looks for drops and only drops", () => {
  const dip = { ...rule, signal: "dip24h", move: 10 };
  assert.equal(miss(tower({ change24h: -12 }), dip), null);
  assert.equal(miss(tower({ change24h: -8 }), dip), "move");
  assert.equal(miss(tower({ change24h: 15 }), dip), "move");
});

test("unverified coins and Launch Docks pools are never brought", () => {
  assert.equal(miss(tower({ verified: false }), rule), "unverified");
  assert.equal(miss(tower({ district: "docks" }), rule), "unverified");
});

test("activity must look human and have real traders, whatever the rule", () => {
  assert.equal(miss(tower({ organic: 29 }), rule), "organic");
  assert.equal(miss(tower({ traders1h: 24 }), rule), "traders");
});

test("missing figures never pass a floor", () => {
  assert.equal(miss(tower({ liquidity: Number.NaN }), rule), "liquidity");
  assert.equal(miss(tower({ change1h: Number.NaN }), rule), "move");
});

test("the strongest match comes first: the move weighted by how many people traded", () => {
  const lonely = tower({ id: "A", change1h: 9, traders1h: 30 });
  const crowd = tower({ id: "B", change1h: 7, traders1h: 5000 });
  const out = tower({ id: "C", change1h: 1 });
  assert.deepEqual(matches([lonely, out, crowd], rule).map((t) => t.id), ["B", "A"]);
});

test("ties go to the deeper pool", () => {
  const a = tower({ id: "A", liquidity: 1_000_000 });
  const b = tower({ id: "B", liquidity: 3_000_000 });
  assert.deepEqual(matches([a, b], rule).map((t) => t.id), ["B", "A"]);
});

test("why this tower: four figures from the data, each with its window and the bar it cleared", () => {
  const facts = explain(tower(), rule);
  assert.deepEqual(
    facts.map((f) => [f.label, f.value, f.note]),
    [
      ["Move 1H", "+6.2%", "≥ +5%"],
      ["Liquidity", "$4M", "≥ $250K"],
      ["Traders 1H", "1.8K", "≥ 25"],
      ["Organic", "74/100", "≥ 30"],
    ],
  );
  const dip = explain(tower({ change24h: -11.04 }), { ...rule, signal: "dip24h", move: 10 });
  assert.deepEqual([dip[0].label, dip[0].value, dip[0].note], ["Move 24H", "−11.0%", "≤ −10%"]);
});

test("a rule read back from storage keeps only offered choices", () => {
  assert.deepEqual(readRule(null), DEFAULT_RULE);
  assert.deepEqual(readRule({ signal: "rise24h", move: 25, liquidity: 1_000_000, area: "heights", budget: 500 }), {
    signal: "rise24h",
    move: 25,
    liquidity: 1_000_000,
    area: "heights",
    budget: 500,
  });
  // Anything else — a typed amount, an unknown district, a string — falls back to the default choice.
  assert.deepEqual(readRule({ signal: "moon", move: 7, liquidity: 1, area: "docks", budget: "1000000" }), DEFAULT_RULE);
  assert.equal(readRule({ signal: "dip24h", move: 2 }).move, 5);
});

test("switching the signal keeps the move when it is offered there", () => {
  assert.equal(withSignal({ ...rule, move: 5 }, "dip24h").move, 5);
  assert.equal(withSignal({ ...rule, move: 2 }, "rise24h").move, 10);
});

test("the rule in one line", () => {
  assert.equal(ruleLine(rule), "Rising this hour +5%, liquidity from $250K, pause after $100 a week");
  assert.equal(ruleLine({ ...rule, signal: "dip24h", move: 10, area: "strip", liquidity: 1_000_000 }), "Dipping today −10% in Meme Strip, liquidity from $1M, pause after $100 a week");
});
