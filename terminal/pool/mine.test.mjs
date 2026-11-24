import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { distributionOf, mineBand } from "./pool-view.ts";
import { mineEntryOfPro, mineEntryOfView } from "./mine.ts";
import { POOL } from "./words.ts";

/* The pool's page: the person's own range over «Liquidity by price», the fees to collect, the history. */

const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const SOL = "So11111111111111111111111111111111111111112";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const bins = () => ({
  venue: "pro",
  pool: "P",
  x: { mint: MET, decimals: 6 },
  y: { mint: SOL, decimals: 9 },
  stepBps: 128,
  activeId: 0,
  price: 0.0036,
  bins: Array.from({ length: 81 }, (_, i) => {
    const offset = i - 40;
    const price = 0.0036 * Math.pow(1.0128, offset);
    const x = offset >= 0 && offset <= 8 ? "100000000" : "0";
    const y = offset <= 0 && offset >= -10 ? "500000000" : "0";
    return { offset, id: offset * 128, price, x, y };
  }),
  market: { gapPct: null },
  rent: null,
});

test("a range stands over the columns it holds — the price's own step and the steps under it, cheapest first", () => {
  const view = distributionOf(bins(), "x");
  const lower = 0.0036 * Math.pow(1.0128, -4);
  const upper = 0.0036;
  const band = mineBand(view, { lower, upper }, "x");
  assert.ok(band);
  const inside = view.columns.filter((column) => column.price >= lower * 0.999 && column.price <= upper * 1.001);
  assert.equal(inside.length, 5, "four steps under the price and its own");
  const width = 100 / view.columns.length;
  assert.ok(Math.abs(band.toPct - band.fromPct - inside.length * width) < 1e-9);
  const here = view.columns.findIndex((column) => column.side === "both");
  assert.ok(Math.abs(band.toPct - (here + 1) * width) < 1e-9, "the band ends on the price's own step");
});

test("the coin as Y turns the range over: the same columns, told in the coin's own terms", () => {
  const view = distributionOf(bins(), "y");
  const lower = 0.0036 * Math.pow(1.0128, -4);
  const upper = 0.0036;
  const band = mineBand(view, { lower, upper }, "y");
  assert.ok(band);
  const inside = view.columns.filter((column) => column.price >= (1 / upper) * 0.999 && column.price <= (1 / lower) * 1.001);
  assert.equal(inside.length, 5);
});

test("no band for a range that is not one, or holds none of the columns shown", () => {
  const view = distributionOf(bins(), "x");
  assert.equal(mineBand(view, { lower: 0, upper: 1 }, "x"), null);
  assert.equal(mineBand(view, { lower: 2, upper: 1 }, "x"), null);
  assert.equal(mineBand(view, { lower: 10, upper: 20 }, "x"), null);
});

const mark = (lower, upper) => (lower && upper ? `${lower} – ${upper}` : null);

test("a DLMM Pro position: its range, the fees to collect in dollars, its result and what this device saw", () => {
  const boat = { nftMint: "N", pool: "P", inRange: false, ranges: 3, lowerPrice: 0.003, upperPrice: 0.004, worth: { xRaw: "0", yRaw: "0", lamports: "2000000000" }, fees: { xRaw: "0", yRaw: "0", lamports: "50000000" }, rewards: [], empty: false, cared: false, care: null };
  const row = { nowUsd: 200, result: null };
  const ledger = { nftMint: "N", pool: "P", openedAt: 1_763_500_000_000, in: { xRaw: "0", yRaw: "0", lamports: "1000000000" }, addedLamports: "0", collectedLamports: "100000000", costsLamports: "0", rentLamports: "0", lost: false };
  const usd = (lamports) => (Number(lamports) / 1e9) * 100;
  const entry = mineEntryOfPro(boat, row, ledger, usd, mark);
  assert.deepEqual(entry.range, { lower: 0.003, upper: 0.004 });
  assert.equal(entry.inRange, false);
  assert.equal(entry.nowUsd, 200);
  assert.equal(entry.unclaimedUsd, 5);
  assert.deepEqual(entry.history, { openedAt: ledger.openedAt, inUsd: 100, collectedUsd: 10, addedUsd: 0 });
  // An entry that lost track of an action says no history — never a guess.
  assert.equal(mineEntryOfPro(boat, row, { ...ledger, lost: true }, usd, mark).history, null);
  assert.equal(mineEntryOfPro(boat, row, null, usd, mark).history, null);
  // No SOL price: the dollars are not known, never a zero.
  assert.equal(mineEntryOfPro(boat, row, ledger, () => null, mark).unclaimedUsd, null);
});

test("a DLMM or DAMM v2 position: the venue's dollars; the plain curve has no range and no in-or-out", () => {
  const view = { kind: "dlmm", address: "A", pool: "P", name: "MET-SOL", x: {}, y: {}, rangeState: "in_range", lower: 0.003, upper: 0.004, price: 0.0036, valueUsd: 120, unclaimedUsd: 1.5, lockedBps: 0, feesElsewhere: false, hasRewards: false, slot: null, at: 0, pricesAt: null };
  const entry = mineEntryOfView(view, mark);
  assert.deepEqual(entry.range, { lower: 0.003, upper: 0.004 });
  assert.equal(entry.inRange, true);
  assert.equal(entry.unclaimedUsd, 1.5);
  assert.equal(entry.result, null);
  const curve = mineEntryOfView({ ...view, kind: "damm-v2", lower: null, upper: null }, mark);
  assert.equal(curve.range, null);
  assert.equal(curve.inRange, null);
});

test("the page draws the ranges and the card for every kind of pool, the words in both languages", () => {
  const screen = read("./PoolScreen.tsx");
  assert.match(screen, /useMineHere\(pool, solUsd\)/);
  assert.match(screen, /<Distribution [^>]*mine=\{mineRanges\}/);
  assert.doesNotMatch(screen, /pool\.pro \? <MineHere/, "not DLMM Pro alone");
  for (const lang of ["en", "uk"]) for (const key of ["mineRange", "unclaimed", "history", "histOpened", "histIn", "histCollected", "histAdded", "histWhy"]) assert.ok(POOL[lang][key].length > 0, `${lang}.${key}`);
});
