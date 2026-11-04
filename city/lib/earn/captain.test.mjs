import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAPTAIN_MIN_COPIES,
  CAPTAIN_MIN_DAYS,
  COPY_PENDING_MS,
  dayOf,
  dayPoints,
  drawdownPct,
  newCopy,
  passCopy,
  pctText,
  provenStrategies,
  readCaptainAnswer,
  readRecipeId,
  recipeId,
  resultLine,
  sparkOf,
  styleOfBins,
} from "./captain.ts";

const SOL = "So11111111111111111111111111111111111111112";
const JITO = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const POOL = "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y";
const OTHER_POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const POSITION = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const DAY = 86_400_000;
const T0 = Date.parse("2026-09-01T12:00:00Z");

/** A position of JitoSOL (X) against SOL (Y) as the chain read it. */
function seen({ x = 1, y = 1.2, ux = 0, uy = 0, jito = 240, sol = 200, lower = -16, upper = 16, owner = OWNER, pool = POOL, value } = {}) {
  return {
    address: POSITION,
    pool,
    owner,
    bins: { lower, upper },
    rangeState: "in_range",
    x: { mint: JITO, symbol: "JitoSOL", amount: x, unclaimed: ux, priceUsd: jito },
    y: { mint: SOL, symbol: "SOL", amount: y, unclaimed: uy, priceUsd: sol },
    valueUsd: value ?? x * jito + y * sol,
  };
}

const copy = (over = {}) => newCopy({ position: POSITION, owner: OWNER, pool: POOL, style: "balanced", ...over }, T0);

test("a recipe is a pier and a style; its id reads back and nothing else does", () => {
  const id = recipeId({ pool: POOL, style: "calm" });
  assert.deepEqual(readRecipeId(id), { pool: POOL, style: "calm" });
  assert.equal(readRecipeId(`${POOL}:wild`), null);
  assert.equal(readRecipeId(`nope:calm`), null);
  assert.equal(readRecipeId(`${id}:extra`), null);
  assert.equal(readRecipeId(42), null);
});

test("a position's bins name its style only at the style's exact width", () => {
  assert.equal(styleOfBins(-34, 34), "calm");
  assert.equal(styleOfBins(100, 132), "balanced");
  assert.equal(styleOfBins(-5, 5), "dense");
  assert.equal(styleOfBins(-6, 5), null);
  assert.equal(styleOfBins(5, -5), null);
});

test("a reported copy is believed only when the chain shows it as the recipe", () => {
  const fresh = copy();
  assert.equal(passCopy(fresh, null, true, T0 + 1000).kind, "pending");
  assert.equal(passCopy(fresh, null, false, T0 + 2 * DAY).kind, "pending", "a chain that did not answer changes nothing");
  assert.deepEqual(passCopy(fresh, null, true, T0 + COPY_PENDING_MS + 1), { kind: "drop", reason: "not-seen" });
  assert.deepEqual(passCopy(fresh, seen({ lower: -34, upper: 34 }), true, T0 + 1000), { kind: "drop", reason: "not-recipe" });
  assert.deepEqual(passCopy(fresh, seen({ owner: POOL }), true, T0 + 1000), { kind: "drop", reason: "not-recipe" });
  assert.deepEqual(passCopy(fresh, seen({ pool: OTHER_POOL }), true, T0 + 1000), { kind: "drop", reason: "not-recipe" });

  const confirmed = passCopy(fresh, seen(), true, T0 + 1000);
  assert.equal(confirmed.kind, "live");
  assert.deepEqual(confirmed.copy.entry, { x: 1, y: 1.2, usd: 480, lamports: "2400000000", at: T0 + 1000 });
  assert.deepEqual(confirmed.copy.last, { holdUsd: 480, netUsd: 0, feesUsd: 0, at: T0 + 1000 });
});

test("a live copy is SOL-2b's sum: fees and the price's move against keeping its coins", () => {
  const live = passCopy(copy(), seen(), true, T0).copy;
  // SOL up: the pool sold some SOL for JitoSOL along the way; worth less than keeping, fees on top.
  const later = passCopy(live, seen({ x: 1.1, y: 1.07, ux: 0.01, uy: 0.012, jito: 252, sol: 210 }), true, T0 + DAY);
  assert.equal(later.kind, "live");
  const hold = 1 * 252 + 1.2 * 210;
  const value = 1.1 * 252 + 1.07 * 210;
  const fees = 0.01 * 252 + 0.012 * 210;
  assert.ok(Math.abs(later.copy.last.holdUsd - hold) < 1e-9);
  assert.ok(Math.abs(later.copy.last.feesUsd - fees) < 1e-9);
  assert.ok(Math.abs(later.copy.last.netUsd - (value - hold + fees)) < 1e-9);
});

test("fees seen leaving are kept as claimed, never more than was seen", () => {
  let live = passCopy(copy(), seen(), true, T0).copy;
  live = passCopy(live, seen({ ux: 0.02, uy: 0.03 }), true, T0 + DAY).copy;
  const claimed = passCopy(live, seen({ ux: 0, uy: 0.001 }), true, T0 + 2 * DAY);
  assert.ok(Math.abs(claimed.copy.claimedUsd - (0.02 * 240 + 0.029 * 200)) < 1e-9);
  assert.ok(Math.abs(claimed.copy.last.feesUsd - (0.02 * 240 + 0.029 * 200 + 0.001 * 200)) < 1e-9);
});

test("a withdrawal, a deposit, a new width or a position gone closes the copy and keeps its last result", () => {
  const live = passCopy(copy(), seen(), true, T0).copy;
  const gone = passCopy(live, null, true, T0 + DAY);
  assert.equal(gone.kind, "closed");
  assert.equal(gone.copy.closedAt, T0 + DAY);
  assert.deepEqual(gone.copy.last, live.last);
  assert.equal(passCopy(live, null, false, T0 + DAY).kind, "live", "a chain that did not answer closes nothing");
  assert.equal(passCopy(live, seen({ x: 0.5, y: 0.6 }), true, T0 + DAY).kind, "closed", "both coins short — withdrawn");
  assert.equal(passCopy(live, seen({ x: 2, y: 2.4 }), true, T0 + DAY).kind, "closed", "worth more than keeping — deposited");
  assert.equal(passCopy(live, seen({ lower: -5, upper: 5 }), true, T0 + DAY).kind, "closed");
  assert.equal(passCopy(gone.copy, seen(), true, T0 + 2 * DAY).kind, "closed", "closed stays closed");
});

test("a day's point sums the live copies that count, each strategy apart", () => {
  const big = passCopy(copy(), seen(), true, T0).copy;
  const dust = passCopy(copy({ position: OWNER }), seen({ x: 0.0001, y: 0.0001 }), true, T0).copy;
  const other = passCopy(copy({ style: "calm" }), seen({ lower: -34, upper: 34 }), true, T0).copy;
  const points = dayPoints([big, dust, other, copy()], T0);
  assert.equal(points.length, 2);
  const balanced = points.find((p) => p.strategy === recipeId({ pool: POOL, style: "balanced" }));
  assert.equal(balanced.copies, 1, "a copy under the minimum never counts");
  assert.equal(balanced.day, dayOf(T0));
  assert.equal(dayPoints([big], T0 + DAY).length, 0, "a copy not measured today is not today's");
});

test("the deepest fall starts level with holding and is never negative", () => {
  assert.equal(drawdownPct([]), 0);
  assert.equal(drawdownPct([0.5, 1, 2]), 0);
  assert.equal(drawdownPct([-0.4, -1.2, -0.3]), 1.2);
  assert.ok(Math.abs(drawdownPct([1, 3, 1.5, 2.5, 0.5, 1]) - 2.5) < 1e-9);
});

/** A strategy's record: one point a day for `days`, with `wallets` copies that count. */
function record({ days = 32, wallets = 5, style = "balanced", line = (i) => i * 0.05, now = T0 + 40 * DAY } = {}) {
  const strategy = recipeId({ pool: POOL, style });
  const start = now - days * DAY;
  const points = Array.from({ length: days + 1 }, (_, i) => ({ strategy, day: dayOf(start + i * DAY), copies: wallets, holdUsd: 1000, netUsd: line(i) * 10, feesUsd: 8, at: start + i * DAY }));
  const copies = Array.from({ length: wallets }, (_, i) => ({ ...copy({ owner: `${"1".repeat(31)}${String.fromCharCode(65 + i)}`, style }), entry: { x: 1, y: 1, usd: 440, lamports: "2200000000", at: start } }));
  return { points, copies, now };
}

test("only a record of thirty days and five wallets reaches a card, its fall beside it", () => {
  const proven = record();
  const list = provenStrategies(proven.copies, proven.points, proven.now);
  assert.equal(list.length, 1);
  const card = list[0];
  assert.equal(card.style, "balanced");
  assert.ok(card.days >= CAPTAIN_MIN_DAYS);
  assert.equal(card.copies, CAPTAIN_MIN_COPIES);
  assert.ok(Math.abs(card.resultPct - 1.6) < 1e-9);
  assert.equal(card.drawdownPct, 0);
  assert.ok(Math.abs(card.feesPct - 0.8) < 1e-9);
  assert.ok(Math.abs(card.pricePct - 0.8) < 1e-9);

  const young = record({ days: CAPTAIN_MIN_DAYS - 3 });
  assert.equal(provenStrategies(young.copies, young.points, young.now).length, 0, "under thirty days");
  const few = record({ wallets: CAPTAIN_MIN_COPIES - 1 });
  assert.equal(provenStrategies(few.copies, few.points, few.now).length, 0, "under five copies");
  const sameWallet = record();
  const one = sameWallet.copies.map((c) => ({ ...c, owner: OWNER }));
  assert.equal(provenStrategies(one, sameWallet.points, sameWallet.now).length, 0, "five copies from one wallet are one");
  const stale = record();
  assert.equal(provenStrategies(stale.copies, stale.points, stale.now + 5 * DAY).length, 0, "a record not measured lately");
});

test("a record that lost shows its loss and its fall; the steadier one ranks first", () => {
  const loser = record({ line: (i) => -i * 0.03 });
  const [card] = provenStrategies(loser.copies, loser.points, loser.now);
  assert.ok(card.resultPct < 0);
  assert.ok(card.drawdownPct > 0);
  const smooth = record({ style: "calm", line: (i) => i * 0.04 });
  const swing = record({ style: "dense", line: (i) => (i % 2 ? 4 : -2) + i * 0.02 });
  const ranked = provenStrategies([...smooth.copies, ...swing.copies], [...smooth.points, ...swing.points], smooth.now);
  assert.deepEqual(ranked.map((s) => s.style), ["calm", "dense"]);
});

test("the answer is read field by field and the gate holds on the page too", () => {
  const good = record();
  const [card] = provenStrategies(good.copies, good.points, good.now);
  const read = readCaptainAnswer({ strategies: [card, { ...card, copies: 2 }, { ...card, id: "bad" }, { ...card, series: ["x"] }], counting: true, at: good.now });
  assert.equal(read.strategies.length, 1);
  assert.equal(read.counting, true);
  assert.equal(readCaptainAnswer({ strategies: "no", counting: true, at: 1 }), null);
  assert.equal(readCaptainAnswer(null), null);
});

test("figures for the eye", () => {
  assert.equal(pctText(1.234), "+1.23%");
  assert.equal(pctText(-0.5), "−0.50%");
  assert.equal(pctText(12.34), "+12.3%");
  assert.equal(pctText(0.0001), "0%");
  assert.equal(resultLine([]).length, 0);
  assert.equal(sparkOf([1], 100, 20), null);
  const spark = sparkOf([0, 1, -1, 2], 100, 20);
  assert.ok(spark.line.startsWith("M0.0,"));
  assert.ok(spark.zero > 0 && spark.zero < 20);
});
