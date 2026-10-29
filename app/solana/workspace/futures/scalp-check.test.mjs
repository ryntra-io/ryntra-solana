// Run from repo root: node --test app/solana/workspace/futures/scalp-check.test.mjs
//
// PERP-7 — Scalp Check (spec §8): the cost of one round trip counted by walking the book that is on screen, and the
// break-even move that follows from it. Every figure here is checked against the levels by hand: the walk is the
// product's one walk, so a test that agreed with its own arithmetic instead of the book's would prove nothing.
import assert from "node:assert/strict";
import test from "node:test";

import { scalpCheck, scalpUnits } from "./scalp-check.ts";

/* A book with a one-dollar spread and thin levels: a size over two units has to climb it. */
const BOOK = {
  asks: [
    { price: 100.5, size: 1 },
    { price: 101, size: 1 },
    { price: 102, size: 2 },
  ],
  bids: [
    { price: 99.5, size: 1 },
    { price: 99, size: 1 },
    { price: 98, size: 2 },
  ],
};
/* Phoenix's own rates as its catalogue sends them, and Ryntra's builder fee through Flight. */
const RATES = { takerRate: 0.00035, makerRate: 0.00005, builderBps: 2 };
const near = (actual, expected, within, what) => assert.ok(Math.abs(actual - expected) <= within, `${what}: ${actual} vs ${expected}`);

test("one unit: the spread, both fees and the break-even move, all from the book's own levels", () => {
  const seen = scalpCheck({ side: "long", sizeUnits: 1, book: BOOK, rates: RATES });
  assert.equal(seen.kind, "cost");
  assert.equal(seen.spreadUsd, 1, "100.5 ask less 99.5 bid");
  near(seen.spreadPercent, 1, 1e-9, "spread as a share of the middle");
  /* One unit sits inside the best level on either side: it fills at the best price and slips nothing. */
  assert.equal(seen.entry.averageUsd, 100.5);
  assert.equal(seen.exit.averageUsd, 99.5);
  assert.equal(seen.entry.slippagePercent, 0);
  assert.equal(seen.exit.slippagePercent, 0);
  /* Phoenix: 3.5 bps of each leg's notional, rounded up to the cent it is paid in. Ryntra: 2 bps of the same. */
  near(seen.entry.phoenixUsd, 100.5 * 0.00035, 1e-6, "Phoenix in");
  near(seen.entry.ryntraUsd, 100.5 * 0.0002, 1e-6, "Ryntra in");
  near(seen.exit.phoenixUsd, 99.5 * 0.00035, 1e-6, "Phoenix out");
  const fees = seen.entry.phoenixUsd + seen.entry.ryntraUsd + seen.exit.phoenixUsd + seen.exit.ryntraUsd;
  near(seen.feesUsd, fees, 1e-9, "both legs together");
  /* Back to nothing: the dollar of spread the position starts behind, plus the fees over the size. */
  near(seen.breakEvenUsd, 1 + fees, 1e-9, "break-even move");
  near(seen.breakEvenPercent, ((1 + fees) / 100.5) * 100, 1e-9, "the same as a share of the entry");
  /* A round trip that rests on both sides pays Phoenix's maker rate and brings the builder nothing. */
  near(seen.makerFeesUsd, 100.5 * 0.00005 + 99.5 * 0.00005, 1e-6, "both legs resting");
  assert.ok(seen.makerFeesUsd < seen.feesUsd);
});

test("a size that climbs the book: the break-even move is counted on the real depth, not on the best price", () => {
  /* Three units in: 1 at 100.5, 1 at 101, 1 at 102 — 101.1667 on average. Out: 99.5, 99, 98 — 98.8333. */
  const seen = scalpCheck({ side: "long", sizeUnits: 3, book: BOOK, rates: RATES });
  assert.equal(seen.kind, "cost");
  near(seen.entry.averageUsd, (100.5 + 101 + 102) / 3, 1e-9, "the walk in");
  near(seen.exit.averageUsd, (99.5 + 99 + 98) / 3, 1e-9, "the walk out");
  assert.equal(seen.entry.worstUsd, 102);
  assert.equal(seen.exit.worstUsd, 98);
  near(seen.entry.slippagePercent, ((seen.entry.averageUsd - 100.5) / 100.5) * 100, 1e-9, "in, against the best ask");
  near(seen.exit.slippagePercent, ((99.5 - seen.exit.averageUsd) / 99.5) * 100, 1e-9, "out, against the best bid");
  assert.ok(seen.entry.slippagePercent > 0 && seen.exit.slippagePercent > 0);
  const gap = seen.entry.averageUsd - seen.exit.averageUsd;
  near(seen.breakEvenUsd, gap + seen.feesUsd / 3, 1e-9, "spread, both walks and the fees");
  /* The depth of the book is what makes it bigger than the one-unit round trip, not an assumed impact. */
  const one = scalpCheck({ side: "long", sizeUnits: 1, book: BOOK, rates: RATES });
  assert.ok(seen.breakEvenUsd > one.breakEvenUsd * 2, "three units cost far more than three times nothing extra");
});

test("a short walks the other way: in on the bids, out on the asks", () => {
  const long = scalpCheck({ side: "long", sizeUnits: 2, book: BOOK, rates: RATES });
  const short = scalpCheck({ side: "short", sizeUnits: 2, book: BOOK, rates: RATES });
  assert.equal(short.kind, "cost");
  near(short.entry.averageUsd, (99.5 + 99) / 2, 1e-9, "a short sells into the bids");
  near(short.exit.averageUsd, (100.5 + 101) / 2, 1e-9, "and buys back from the asks");
  assert.ok(short.entry.slippagePercent > 0, "a short slips too");
  /* The same book costs the same round trip either way round: the gap between the two walks is one gap. */
  near(short.breakEvenUsd, long.breakEvenUsd, 1e-9, "the same book, the same cost");
});

test("«Для такого ордера книга недостатньо глибока» comes with the figures the book can carry", () => {
  const seen = scalpCheck({ side: "long", sizeUnits: 10, book: BOOK, rates: RATES });
  assert.equal(seen.kind, "thin", "four units on each side cannot carry ten");
  assert.equal(seen.sizeUnits, 10);
  assert.equal(seen.depth.entryUnits, 4);
  near(seen.depth.entryNotionalUsd, 100.5 + 101 + 2 * 102, 1e-9, "what the asks are worth");
  assert.equal(seen.depth.exitUnits, 4);
  near(seen.depth.exitNotionalUsd, 99.5 + 99 + 2 * 98, 1e-9, "what the bids are worth");
  /* Exactly what the thinner side holds still goes through; a hair more does not. */
  assert.equal(scalpCheck({ side: "long", sizeUnits: 4, book: BOOK, rates: RATES }).kind, "cost");
  assert.equal(scalpCheck({ side: "long", sizeUnits: 4.01, book: BOOK, rates: RATES }).kind, "thin");
  /* One side empty is one side that cannot carry anything: the way out is as much the answer as the way in. */
  assert.equal(scalpCheck({ side: "long", sizeUnits: 1, book: { asks: BOOK.asks, bids: [] }, rates: RATES }).kind, "thin");
});

test("old figures are carried through, never quietly counted as fresh", () => {
  const stale = scalpCheck({ side: "long", sizeUnits: 1, book: BOOK, rates: RATES, stale: true });
  assert.equal(stale.kind, "cost");
  assert.equal(stale.stale, true);
  assert.equal(scalpCheck({ side: "long", sizeUnits: 99, book: BOOK, rates: RATES, stale: true }).stale, true, "a thin answer says it too");
  assert.equal(scalpCheck({ side: "long", sizeUnits: 1, book: BOOK, rates: RATES }).stale, false);
});

test("a rate that is not known is not counted as nothing", () => {
  const unknown = scalpCheck({ side: "long", sizeUnits: 1, book: BOOK, rates: { takerRate: null, makerRate: null, builderBps: 2 } });
  assert.equal(unknown.kind, "cost");
  assert.equal(unknown.entry.phoenixUsd, null);
  assert.equal(unknown.feesUsd, null, "no total without Phoenix's own rate");
  assert.equal(unknown.makerFeesUsd, null);
  assert.equal(unknown.breakEvenUsd, null, "and no break-even move either");
  assert.equal(unknown.spreadUsd, 1, "what the book does say is still said");
  /* No builder, no builder fee — that one is known to be nothing, which is not the same as not knowing. */
  assert.equal(scalpCheck({ side: "long", sizeUnits: 1, book: BOOK, rates: { ...RATES, builderBps: 0 } }).entry.ryntraUsd, 0);
  const noBps = scalpCheck({ side: "long", sizeUnits: 1, book: BOOK, rates: { ...RATES, builderBps: null } });
  assert.equal(noBps.entry.ryntraUsd, null, "a builder whose bps the chain has not given is not counted as nothing");
  assert.equal(noBps.feesUsd, null);
  assert.equal(noBps.breakEvenUsd, null);
  assert.notEqual(noBps.makerFeesUsd, null, "a round trip that rests pays no builder fee either way, so it still counts");
});

test("nothing to count: no book, no size", () => {
  assert.deepEqual(scalpCheck({ side: "long", sizeUnits: 1, book: null, rates: RATES }), { kind: "none", reason: "book" });
  assert.deepEqual(scalpCheck({ side: "long", sizeUnits: 1, book: { asks: [], bids: [] }, rates: RATES }), { kind: "none", reason: "book" });
  assert.deepEqual(scalpCheck({ side: "long", sizeUnits: 0, book: BOOK, rates: RATES }), { kind: "none", reason: "size" });
  assert.deepEqual(scalpCheck({ side: "long", sizeUnits: Number.NaN, book: BOOK, rates: RATES }), { kind: "none", reason: "size" });
});

test("dollars typed become a size at the price they are typed against", () => {
  assert.equal(scalpUnits(1_005, 100.5), 10);
  assert.equal(scalpUnits(0, 100.5), null);
  assert.equal(scalpUnits(100, null), null);
  assert.equal(scalpUnits(100, 0), null);
  assert.equal(scalpUnits(null, 100), null);
});
