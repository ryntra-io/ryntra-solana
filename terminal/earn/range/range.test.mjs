import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { beforeEach, test } from "node:test";

import { scriptedEngine, ok } from "../../../city/lib/districts/harbor/test-fixtures.mjs";
import { SOL, SOL_USDC, USDC, zapReview } from "../../../city/lib/earn/pier-fixtures.mjs";
import { MAX_HALF, STYLE_HALF, isPierHalf, pierHalf, pierOf, pierRange, pierZapBody, styleOfHalf } from "../../../city/lib/earn/pier.ts";
import { dayRangeOf } from "../../../city/lib/earn/pier-history.ts";
import { pierChoice, setPierEnv, usePier } from "../../../city/lib/earn/pier-store.ts";
import { factRows, gapLine, rangeLine } from "./facts.ts";
import {
  QUICK_PCTS,
  RANGE_MAX_HALF,
  barsOf,
  binWorth,
  clampHalf,
  dayEstimate,
  dayMove,
  gapView,
  halfAt,
  halfForPct,
  heldShare,
  pctText,
  quickPicks,
  rangeView,
  rangeWorth,
  reachOf,
  rentView,
  shapeAt,
  spanOf,
  stretchView,
} from "./model.ts";
import { giveWidthBack } from "../useReads.ts";
import { DRAG_START_PX, pressDown, pressMove } from "./gesture.ts";
import { RANGE } from "./words.ts";

/* A position's range on the Earn ticket: its arithmetic, the pool's bins as bars, the facts before the
   signature in both languages, and the width set by hand on the city's own store — the same request, another count. */

const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";

/** A pool of SOL against USDC, step 4 bps, 150 at the price: 300 USDC on every bin under it, 2 SOL on every bin over, both where it stands. */
function answer(half = 40, over = {}) {
  const bins = [];
  for (let offset = -half; offset <= half; offset += 1) {
    bins.push({ offset, id: -4_290 + offset, price: 150 * 1.0004 ** offset, x: offset >= 0 ? "2000000000" : "0", y: offset <= 0 ? "300000000" : "0" });
  }
  return {
    venue: "dlmm",
    pool: POOL,
    x: { mint: SOL, decimals: 9 },
    y: { mint: USDC, decimals: 6 },
    stepBps: 4,
    activeId: -4_290,
    price: 150,
    bins,
    market: { price: 150, gapPct: 0 },
    rent: {
      positionLamports: "57406080",
      ledgerLamports: "71437440",
      ledgers: [
        { lower: -4_340, upper: -4_271, open: true },
        { lower: -4_270, upper: -4_201, open: false },
        { lower: -4_200, upper: -4_131, open: false },
      ],
    },
    at: "2026-11-17T09:00:00.000Z",
    ...over,
  };
}

test("a width is steps each side: per cent to steps and back, held within what one position takes", () => {
  assert.equal(RANGE_MAX_HALF, STYLE_HALF.calm);
  assert.equal(RANGE_MAX_HALF, MAX_HALF);
  assert.deepEqual([...QUICK_PCTS], [1, 2, 5, 10]);
  assert.equal(halfForPct(4, 1), 25);
  assert.equal(halfForPct(20, 5), 24);
  assert.equal(halfForPct(100, 10), 10);
  assert.equal(halfForPct(100, 0.1), 1, "never under one step");
  assert.equal(halfForPct(0, 1), 1);
  const reach = reachOf(4, 34);
  assert.ok(Math.abs(reach.upPct - 1.369) < 0.001 && Math.abs(reach.downPct - 1.3506) < 0.001, `${reach.upPct} / ${reach.downPct}`);
  assert.deepEqual([clampHalf(0), clampHalf(12.4), clampHalf(99), clampHalf(Number.NaN), clampHalf(20, 16)], [1, 12, 34, 1, 16]);
});

test("the quick widths: a per cent the pool's step cannot reach in one position is not offered", () => {
  assert.deepEqual(quickPicks(4), [
    { pct: 1, half: 25, fits: true },
    { pct: 2, half: 50, fits: false },
    { pct: 5, half: 122, fits: false },
    { pct: 10, half: 238, fits: false },
  ]);
  assert.deepEqual(quickPicks(80).map((pick) => [pick.half, pick.fits]), [[1, true], [2, true], [6, true], [12, true]]);
});

test("a range's edges are the edge bins' own prices where they were read, else counted by the step", () => {
  const read = rangeView(150, 4, 16, answer().bins);
  assert.deepEqual([read.half, read.steps], [16, 33]);
  assert.ok(Math.abs(read.low - 150 * 1.0004 ** -16) < 1e-9 && Math.abs(read.high - 150 * 1.0004 ** 16) < 1e-9);
  assert.ok(Math.abs(read.upPct - 0.6419) < 0.001 && Math.abs(read.downPct - 0.6378) < 0.001);
  const counted = rangeView(150, 4, 16);
  assert.ok(Math.abs(counted.low - read.low) < 1e-9 && Math.abs(counted.high - read.high) < 1e-9);
  /* The city's own range for the same width is the same two prices. */
  const pier = pierOf(SOL_USDC);
  const city = pierRange(pier, "balanced");
  const ours = rangeView(pier.pool.price, pier.pool.binStepBps, STYLE_HALF.balanced);
  assert.ok(Math.abs(city.low - ours.low) < 1e-9 && Math.abs(city.high - ours.high) < 1e-9);
  /* On a pool of ticks the range ends at the upper edge of its top step. */
  const stretch = stretchView(150, 4, 16, answer().bins);
  assert.ok(Math.abs(stretch.high - 150 * 1.0004 ** 17) < 1e-9 && stretch.low === read.low && stretch.steps === 33);
});

test("the pool's bins as bars: Y under the price, X over it, the bin the price stands in marked, the range over them", () => {
  const bars = barsOf(answer(), 5);
  assert.equal(bars.length, 81);
  assert.equal(spanOf(answer()), 40);
  assert.deepEqual(bars.filter((bar) => bar.active).map((bar) => [bar.offset, bar.side]), [[0, "both"]]);
  assert.equal(bars.filter((bar) => bar.inRange).length, 11);
  assert.ok(bars.slice(0, 40).every((bar) => bar.side === "y") && bars.slice(41).every((bar) => bar.side === "x"));
  assert.ok(bars.every((bar) => bar.height > 0 && bar.height <= 1));
  /* One deep bin does not flatten the rest: a bar is capped against the median. */
  const spiky = answer();
  spiky.bins[40] = { ...spiky.bins[40], y: "900000000000" };
  const capped = barsOf(spiky, 5);
  assert.equal(capped[40].height, 1);
  assert.ok(capped[10].height > 0.15, `${capped[10].height}`);
  /* An empty pool draws nothing. */
  const empty = answer();
  assert.ok(barsOf({ ...empty, bins: empty.bins.map((bin) => ({ ...bin, x: "0", y: "0" })) }, 5).every((bar) => bar.height === 0 && bar.side === "none"));
  assert.equal(binWorth({ offset: 0, id: 0, price: 150, x: "2000000000", y: "300000000" }, answer()), 600);
});

test("a place across the chart is a width: the same from either side of the price, never past the widest", () => {
  assert.equal(halfAt(0.5, 40), 1, "on the price itself: the narrowest");
  assert.equal(halfAt(0, 40), 34);
  assert.equal(halfAt(1, 40), 34);
  assert.equal(halfAt(30.5 / 81, 40), 10);
  assert.equal(halfAt(50.5 / 81, 40), 10);
  assert.equal(halfAt(0, 20), 20, "never past what was read");
  assert.equal(halfAt(0, 40, 16), 16);
});

test("a press is never a jump: a mouse on the bars sets the width there, a mouse on a grip takes hold of its edge, a finger waits for a move across", () => {
  /* A mouse on the bars: the width is read where it is pressed, and follows while held. */
  const bars = pressDown({ id: 1, x: 140, y: 50, touch: false }, null);
  assert.deepEqual([bars.set, bars.capture, bars.press.live], [140, true, true]);
  assert.equal(pressMove(bars.press, { id: 1, x: 150, y: 90 }).set, 150);

  /* A mouse on the lower edge's grip, 10 px right of the edge: nothing moves on the press; a drag moves the edge by as
     much as the pointer, never to where the pointer stands. */
  const grip = pressDown({ id: 2, x: 110, y: 50, touch: false }, 100);
  assert.deepEqual([grip.set, grip.capture, grip.press.offset], [null, true, -10]);
  assert.equal(pressMove(grip.press, { id: 2, x: 110, y: 50 }).set, 100, "held still: the edge stays where it is");
  assert.equal(pressMove(grip.press, { id: 2, x: 95, y: 52 }).set, 85);

  /* A finger on the bars: a tap and a scroll down the ticket change nothing; a move across takes the width. */
  const finger = pressDown({ id: 3, x: 140, y: 50, touch: true }, null);
  assert.deepEqual([finger.set, finger.capture, finger.press.live], [null, false, false]);
  assert.deepEqual(pressMove(finger.press, { id: 3, x: 140 + DRAG_START_PX - 1, y: 50 }), { press: finger.press, set: null, capture: false });
  assert.equal(pressMove(finger.press, { id: 3, x: 150, y: 90 }).set, null, "more down than across: a scroll");
  const across = pressMove(finger.press, { id: 3, x: 160, y: 55 });
  assert.deepEqual([across.set, across.capture, across.press.live], [160, true, true]);
  assert.equal(pressMove(across.press, { id: 3, x: 170, y: 80 }).set, 170, "once across, it follows");

  /* A finger on a grip: the same wait, then the edge moves by as much as the finger. */
  const fingerGrip = pressDown({ id: 4, x: 290, y: 50, touch: true }, 300);
  assert.equal(fingerGrip.set, null);
  assert.equal(pressMove(fingerGrip.press, { id: 4, x: 292, y: 120 }).set, null, "a scroll that starts on a grip scrolls");
  assert.equal(pressMove(fingerGrip.press, { id: 4, x: 270, y: 54 }).set, 280);

  /* Another pointer, or nothing pressed: nothing moves. */
  assert.equal(pressMove(bars.press, { id: 9, x: 10, y: 10 }).set, null);
  assert.deepEqual(pressMove(null, { id: 1, x: 10, y: 10 }), { press: null, set: null, capture: false });
});

test("the chart wires its pointer through the gesture's steps, and its grips take no press of their own", () => {
  const source = readFileSync(new URL("./RangeEditor.tsx", import.meta.url), "utf8");
  assert.match(source, /pressDown\(/);
  assert.match(source, /pressMove\(/);
  assert.equal(/onPointerDown: grab|grab\(event\)/.test(source), false, "no press on a grip sets the width");
});

test("the shape's outline: even is flat, near the price peaks there, catch moves rises to the edges", () => {
  assert.deepEqual([shapeAt("spot", 0, 10), shapeAt("spot", 10, 10), shapeAt("spot", 11, 10)], [1, 1, 0]);
  assert.ok(shapeAt("curve", 0, 10) === 1 && shapeAt("curve", 10, 10) < 0.25);
  assert.ok(shapeAt("bid_ask", 0, 10) < 0.25 && shapeAt("bid_ask", -10, 10) === 1);
});

test("about a day: what trades paid, times the deposit's share of the range, times the part of the day the range would have held the price", () => {
  const worth = rangeWorth(answer(), 5);
  /* Five bins of 300 USDC under, the price's own 300 + 2 SOL at 150, five bins of 2 SOL over at their prices. */
  assert.ok(Math.abs(worth - (5 * 300 + 600 + [1, 2, 3, 4, 5].reduce((sum, k) => sum + 2 * 150 * 1.0004 ** k, 0))) < 1e-6, String(worth));

  /* The day's walk, from the pair's own candles: the last 24 hours of four-hour closes. */
  const hour = 3_600;
  const line = [140, 150, 149, 151, 150.5, 152, 150, 151].map((p, index) => ({ t: 1_763_000_000 + index * 4 * hour, p }));
  assert.deepEqual(dayMove(line), { low: 149, high: 152 }, "a close older than a day is not the day's");
  assert.equal(dayMove(line.slice(-1)), null);
  assert.equal(dayMove([]), null);

  /* SOL against dollars: the day's own lowest and highest, wicks included — never narrower than its closes say. */
  const bar = (index, close, low, high) => ({ time: 1_763_000_000 + index * 4 * hour, open: close, high, low, close, volume: 1 });
  const bars = [bar(0, 140, 120, 160), bar(1, 150, 149, 151), bar(2, 149, 146, 150), bar(3, 151, 150, 155), bar(4, 150.5, 150, 151), bar(5, 152, 151, 153), bar(6, 150, 149.5, 150.5)];
  assert.deepEqual(dayRangeOf({ candles: bars }), { low: 146, high: 155 }, "the six bars of the day; the older one's wicks are not the day's");
  assert.equal(dayRangeOf({ candles: bars.slice(-1) }), null);
  assert.equal(dayRangeOf({ candles: "none" }), null);
  assert.ok(heldShare(33, 4, 146, 155) < heldShare(33, 4, 149, 152), "wicks walk farther than closes: a narrow range holds less of the day");

  /* A range of 33 bins of 4 bps against a walk of 149 … 152 (about 51 bins): it would have held the price 0.65 of the day. */
  const held = heldShare(33, 4, 149, 152);
  assert.ok(Math.abs(held - 33 / (Math.log(152 / 149) / Math.log(1.0004) + 1)) < 1e-12 && held > 0.6 && held < 0.7, String(held));
  assert.equal(heldShare(69, 4, 150, 150.5), 1, "a walk that fits inside is the whole day");
  assert.equal(heldShare(33, 4, null, 152), null);
  assert.equal(heldShare(33, 4, 152, 149), null);

  const base = { lpFees24hUsd: 8_000, depositUsd: 1_000, rangeUsd: 99_000, poolUsd: 3_000_000 };
  assert.deepEqual(dayEstimate({ ...base, held: 1 }), { dayUsd: 80, sharePct: 1, basis: "range" });
  assert.deepEqual(dayEstimate({ ...base, held: 0.5 }), { dayUsd: 40, sharePct: 0.5, basis: "range" });
  /* Three bins on a deep pool: a large share of little, for a small part of the day — never the pool's whole day. */
  const narrow = dayEstimate({ ...base, rangeUsd: 4_000, held: heldShare(3, 4, 149, 152) });
  assert.ok(narrow.dayUsd < 100, String(narrow.dayUsd));
  /* The day's prices not read: the plain share of the whole pool, the careful figure. */
  const careful = dayEstimate({ ...base, held: null });
  assert.ok(Math.abs(careful.dayUsd - 8_000 * (1_000 / 3_001_000)) < 1e-9);
  assert.equal(careful.basis, "pool");
  /* The bins not read: the same careful figure, never an empty row. */
  assert.equal(dayEstimate({ ...base, rangeUsd: null, held: 0.5 }).basis, "pool");
  /* Whatever the width, the figure never passes what the pool's liquidity was paid in the day. */
  for (const steps of [3, 11, 33, 69]) assert.ok(dayEstimate({ ...base, depositUsd: 5_000_000, rangeUsd: 1, held: heldShare(steps, 4, 149, 152) }).dayUsd <= 8_000);
  /* Nothing lies in the range to share with: no figure, never the pool's whole day. */
  assert.equal(dayEstimate({ ...base, rangeUsd: 0, held: 1 }), null);
  assert.equal(dayEstimate({ ...base, lpFees24hUsd: null, held: 1 }), null);
  assert.equal(dayEstimate({ ...base, depositUsd: null, held: 1 }), null);
  assert.equal(dayEstimate({ ...base, depositUsd: 0, held: 1 }), null);
  assert.equal(dayEstimate({ ...base, poolUsd: null, held: null }), null);
});

test("the accounts: the position's own comes back; a ledger nobody opened is paid by the engine's own rule — the lowest bin's and the one after", () => {
  const rent = answer().rent;
  /* -4290 − 34 = -4324: its ledger is open, the one after is not. */
  assert.deepEqual(rentView(rent, -4_290, 34), { pay: 57_406_080n + 71_437_440n, back: 57_406_080n, ledgers: 1 });
  /* -4290 − 5 = -4295: the same two ledgers, though every bin of the range lies in the first. */
  assert.deepEqual(rentView(rent, -4_290, 5), { pay: 57_406_080n + 71_437_440n, back: 57_406_080n, ledgers: 1 });
  /* A price in the second ledger: both it and the third are closed. */
  assert.equal(rentView(rent, -4_250, 5).ledgers, 2);
  const open = { ...rent, ledgers: rent.ledgers.map((ledger) => ({ ...ledger, open: true })) };
  assert.deepEqual(rentView(open, -4_290, 34), { pay: 57_406_080n, back: 57_406_080n, ledgers: 0 });
  assert.equal(rentView(null, -4_290, 34), null);
  assert.equal(rentView({ ...rent, ledgers: [] }, -4_290, 34), null, "ledgers not read where the range starts: the Review alone says");
  assert.equal(rentView({ ...rent, ledgers: rent.ledgers.slice(0, 1) }, -4_290, 34), null);
});

test("the pool's price against the market's: a line only from one per cent, or two of the pool's steps", () => {
  assert.equal(gapView(null, 4), null);
  assert.deepEqual(gapView(0.4, 4), { pct: 0.4, far: false, dearer: true });
  assert.deepEqual(gapView(-1.8, 4), { pct: 1.8, far: true, dearer: false });
  assert.equal(gapView(1.5, 100).far, false, "a pool of one-per-cent steps stands a step away without a word");
  assert.equal(gapView(2.5, 100).far, true);
  assert.deepEqual([pctText(1.369), pctText(0.2), pctText(12.34), pctText(123.4), pctText(-0.64)], ["1.37", "0.2", "12.3", "123", "0.64"]);
});

test("the facts before the signature, in both languages: the two prices, the bins, what goes in, the swap, the rent, the fee in and out, about a day", () => {
  const input = {
    range: rangeView(150, 4, 34, answer().bins),
    steps: "bins",
    shape: "curve",
    goesIn: "0.5 SOL + 74.9 USDC",
    exact: true,
    swap: { from: "0.5 SOL", to: "74.9 USDC", rate: "149.8", unit: "USDC" },
    rent: { pay: "0.1288", back: "0.0574", all: false, exact: true },
    fee: { inPct: "0.1%" },
    day: { usd: "$1.24", basis: "range" },
  };
  assert.deepEqual(factRows(RANGE.en, "en", input), [
    ["Bins", "69 bins · Curve"],
    ["Goes in", "0.5 SOL + 74.9 USDC"],
    ["Swapped first", "0.5 SOL → 74.9 USDC · at 149.8 USDC"],
    ["Account rent", "0.1288 SOL · 0.0574 back at exit"],
    ["Ryntra fee", "in 0.1% of the swap · out 0%"],
    ["About, per day", "≈ $1.24 · at the last day’s move"],
  ]);
  const uk = factRows(RANGE.uk, "uk", { ...input, day: { usd: "$1,24", basis: "range" } });
  assert.deepEqual(uk.map((row) => row[1]), [
    "69 бінів · Curve",
    "0,5 SOL + 74,9 USDC",
    "0,5 SOL → 74,9 USDC · за 149,8 USDC",
    "0,1288 SOL · 0,0574 повернеться",
    "вхід 0,1% з обміну · вихід 0%",
    "≈ $1,24 · при русі як за добу",
  ]);
  /* Before a wallet is here: the figures are «about», the fee's rate is the Review's to say, and a figure nobody has leaves its row empty. */
  const guest = factRows(RANGE.en, "en", { ...input, exact: false, fee: null, swap: null, rent: null, day: null });
  assert.deepEqual([guest[1][1], guest[2][1], guest[3][1], guest[4][1], guest[5][1]], ["≈ 0.5 SOL + 74.9 USDC", null, null, "in — only on the swap · out 0%", null]);
  assert.equal(factRows(RANGE.en, "en", { ...input, swap: "none", fee: { inPct: null }, rent: { pay: "0.0574", back: "0.0574", all: true, exact: true } })[2][1], "No swap");
  assert.equal(factRows(RANGE.en, "en", { ...input, fee: { inPct: null } })[4][1], "in 0% · out 0%");
  assert.equal(factRows(RANGE.en, "en", { ...input, rent: { pay: "0.0574", back: "0.0574", all: true, exact: true } })[3][1], "0.0574 SOL · all back at exit");
  /* The pool's own facts before a Review: «about» — the wallet's own missing account is the Review's to add. */
  assert.equal(factRows(RANGE.uk, "uk", { ...input, rent: { pay: "0.1288", back: "0.0574", all: false, exact: false } })[3][1], "≈ 0,1288 SOL · 0,0574 повернеться");
  assert.deepEqual(factRows(RANGE.uk, "uk", { ...input, steps: "steps", range: rangeView(150, 4, 1) })[0], ["Кроків", "3 кроки · Curve"]);
  /* The careful figure says what it is a share of. */
  assert.equal(factRows(RANGE.en, "en", { ...input, day: { usd: "$0.60", basis: "pool" } })[5][1], "≈ $0.60 · share of the whole pool");
  assert.equal(factRows(RANGE.uk, "uk", { ...input, day: { usd: "$0,60", basis: "pool" } })[5][1], "≈ $0,60 · частка всього пулу");
  assert.equal(RANGE.uk.binsOf("21"), "21 бін");
  assert.equal(RANGE.uk.binsOf("33"), "33 біни");
  assert.equal(RANGE.uk.binsOf("11"), "11 бінів");
});

test("the range's one line and the market's one line", () => {
  assert.equal(rangeLine(RANGE.en, "en", rangeView(150, 4, 16), "USDC", "bins"), "149.04 – 150.96 USDC · 33 bins");
  assert.equal(rangeLine(RANGE.uk, "uk", rangeView(150, 4, 16), "USDC", "bins"), "149,04 – 150,96 USDC · 33 біни");
  assert.equal(gapLine(RANGE.en, "en", gapView(0.3, 4)), null);
  assert.equal(gapLine(RANGE.en, "en", gapView(1.84, 4)), "The pool’s price is 1.84% above the market.");
  assert.equal(gapLine(RANGE.uk, "uk", gapView(-2.5, 4)), "Ціна пулу на 2,5% нижча за ринкову.");
  assert.equal(gapLine(RANGE.en, "en", null), null);
});

test("the two languages carry the same words", () => {
  assert.deepEqual(Object.keys(RANGE.en).sort(), Object.keys(RANGE.uk).sort());
  for (const [key, value] of Object.entries(RANGE.uk)) if (typeof value === "string") assert.ok(value.length > 0, key);
});

/* ── a width by hand on the city's own store ───────────────────────────────────────────────────────────────────── */

const rich = { owner: OWNER, sol: { spendableRaw: "50000000000", decimals: 9 }, tokens: new Map(), complete: true, at: 1 };

beforeEach(() => {
  usePier.setState({ pool: null, style: "balanced", goal: null, half: null, copy: null, typed: "1", boat: null, states: null, reviewed: null, costs: null, target: null, phase: "idle", outcome: null, sent: null, notice: null, rest: null });
});

test("a width by hand is the engine's own request with another count; without one the request is byte for byte what it was", () => {
  const pier = pierOf(SOL_USDC);
  assert.deepEqual([pierHalf("balanced"), pierHalf("balanced", null), pierHalf("balanced", 9), pierHalf("dense", 99), pierHalf("dense", 0)], [16, 16, 9, 5, 5]);
  assert.deepEqual([isPierHalf(1), isPierHalf(34), isPierHalf(35), isPierHalf(0), isPierHalf(2.5), isPierHalf("9")], [true, true, false, false, false, false]);
  assert.deepEqual([styleOfHalf(34), styleOfHalf(16), styleOfHalf(5), styleOfHalf(9)], ["calm", "balanced", "dense", null]);
  const plain = pierZapBody(pier, OWNER, 1_000_000_000n, "balanced", "even");
  assert.equal(JSON.stringify(pierZapBody(pier, OWNER, 1_000_000_000n, "balanced", "even", null)), JSON.stringify(plain));
  assert.equal(JSON.stringify(plain), JSON.stringify({ action: "zap_in", venue: "meteora-dlmm", request: { pool: pier.pool.address, owner: OWNER, amountIn: "1000000000", half: 16, slippageBps: 100 } }));
  const own = pierZapBody(pier, OWNER, 1_000_000_000n, "balanced", "near", 9);
  assert.deepEqual(own.request, { pool: pier.pool.address, owner: OWNER, amountIn: "1000000000", half: 9, shape: "curve", slippageBps: 100 });

  const keyOf = (half) => pierChoice(pier, "balanced", "1", rich, OWNER, 1_000_000, null, "even", half).key;
  assert.equal(keyOf(null), `zap:${OWNER}:${pier.pool.address}:balanced:1000000000`);
  assert.equal(keyOf(16), keyOf(null), "the style's own count is the style");
  assert.equal(keyOf(9), `zap:${OWNER}:${pier.pool.address}:h9:1000000000`);
});

test("the store: a width by hand asks the engine for that many bins; a style, another pool or leaving gives the width back", async () => {
  const asked = [];
  const engine = scriptedEngine({});
  setPierEnv({
    engine: { ...engine, admit: async () => ok({ add: "on", exit: "on", ceilingUsd: 1_000_000, stopped: false }), zap: async (body) => (asked.push(body), ok(zapReview())), candles: async () => ok([]) },
    now: () => 1_763_000_000_000,
    sleep: async () => undefined,
    after: () => undefined,
    report: () => undefined,
  });
  const connection = { wallet: "Test", address: OWNER };
  const store = usePier.getState();
  store.openPier(SOL_USDC);
  await usePier.getState().loadStates(OWNER);

  await usePier.getState().prepare(connection, { kind: "add" }, rich);
  assert.equal(asked.at(-1).request.half, 16);
  assert.equal("shape" in asked.at(-1).request, false);
  const before = JSON.stringify(asked.at(-1));

  usePier.getState().setHalf(9);
  assert.deepEqual([usePier.getState().half, usePier.getState().reviewed], [9, null], "the figures of another width are not this one's");
  await usePier.getState().prepare(connection, { kind: "add" }, rich);
  assert.equal(asked.at(-1).request.half, 9);
  assert.equal(usePier.getState().reviewed.key.includes(":h9:"), true);

  usePier.getState().setHalf(0);
  usePier.getState().setHalf(35);
  usePier.getState().setHalf(4.5);
  assert.equal(usePier.getState().half, 9, "a count the engine does not take is not set");

  usePier.getState().setStyle("calm");
  assert.deepEqual([usePier.getState().style, usePier.getState().half], ["calm", null]);
  usePier.getState().setStyle("balanced");
  await usePier.getState().prepare(connection, { kind: "add" }, rich);
  assert.equal(JSON.stringify(asked.at(-1)), before, "back on the style, the request is the very one it was");

  usePier.getState().setHalf(7);
  usePier.getState().openPier(SOL_USDC);
  assert.equal(usePier.getState().half, 7, "the same pool keeps its width");
  usePier.getState().openPier({ ...SOL_USDC, address: "BoeMUkCLHchTD31HdXsbDExuZZfcUppSLpYtV3LZTH6U" });
  assert.equal(usePier.getState().half, null, "another pool's bins are another count");

  usePier.getState().setHalf(7);
  usePier.setState({ copy: { strategy: "captain", style: "dense" } });
  usePier.getState().setHalf(3);
  assert.equal(usePier.getState().half, 7, "a copy is its recipe");
  usePier.setState({ copy: null, phase: "wallet" });
  usePier.getState().setHalf(null);
  assert.equal(usePier.getState().half, 7, "never while a signature is out");
  usePier.setState({ phase: "idle" });
  usePier.getState().setHalf(null);
  assert.equal(usePier.getState().half, null);

  /* Back to the list, and a form that is done with, give the width back too: the city's card never opens on one. */
  usePier.getState().openPier(SOL_USDC);
  usePier.getState().setHalf(11);
  usePier.getState().back();
  assert.deepEqual([usePier.getState().pool, usePier.getState().half], [null, null]);
  usePier.getState().openPier(SOL_USDC);
  usePier.getState().setHalf(11);
  usePier.setState({ outcome: { kind: "done", signatures: [] }, phase: "done" });
  usePier.getState().again();
  assert.equal(usePier.getState().half, null);
});

test("the ledger of copies hears the style a width is exactly — and nothing for a width that is none of the three", async () => {
  const reported = [];
  const engine = scriptedEngine({});
  const landing = { ...engine, admit: async () => ok({ add: "on", exit: "on", ceilingUsd: 1_000_000, stopped: false }), zap: async () => ok(zapReview()), candles: async () => ok([]), submit: async () => ok({ results: [{ signature: "s1", state: "LANDED", reason: null }, { signature: "s2", state: "LANDED", reason: null }], settled: true }) };
  setPierEnv({ engine: landing, now: () => 1_763_000_000_000, sleep: async () => undefined, after: () => undefined, report: (landed) => reported.push(landed.style), sign: () => async (unsigned) => ({ ok: true, signed: unsigned }) });
  const connection = { wallet: "Test", address: OWNER };
  const add = async (half) => {
    usePier.setState({ pool: null, half: null, style: "balanced", outcome: null, phase: "idle", reviewed: null, target: null });
    usePier.getState().openPier(SOL_USDC);
    await usePier.getState().loadStates(OWNER);
    if (half !== null) usePier.getState().setHalf(half);
    await usePier.getState().prepare(connection, { kind: "add" }, rich);
    await usePier.getState().confirm(connection, rich);
    return usePier.getState().outcome?.kind;
  };
  const outcomes = [await add(null), await add(5), await add(9)];
  assert.deepEqual(outcomes, ["done", "done", "done"]);
  assert.deepEqual(reported, ["balanced", "dense"]);

  /* The person leaves the screen while the wallet is open: the width goes back to the style once the signature is over,
     and the ledger still hears the style of what was signed. */
  setPierEnv({ sign: () => async (unsigned) => (giveWidthBack(), { ok: true, signed: unsigned }) });
  assert.equal(await add(34), "done");
  assert.deepEqual([reported.at(-1), usePier.getState().half], ["calm", null]);
});

test("leaving the screen gives the width back: figures being built are let go, an outcome is left as it stands, a signature out is waited for", () => {
  const start = (over) => usePier.setState({ pool: SOL_USDC, half: 9, phase: "idle", outcome: null, reviewed: null, target: { kind: "add" }, ...over });

  start({ phase: "reviewing" });
  giveWidthBack();
  assert.deepEqual([usePier.getState().half, usePier.getState().phase], [null, "idle"]);

  /* A part that landed keeps its card as it is — its phase, its outcome, what is left to do — only the width goes. */
  const outcome = { kind: "partial", signatures: ["s1"] };
  start({ phase: "partial", outcome, rest: { reviewed: null, outcome: null, notice: null } });
  giveWidthBack();
  assert.deepEqual([usePier.getState().half, usePier.getState().phase, usePier.getState().outcome, usePier.getState().rest !== null], [null, "partial", outcome, true]);

  /* The wallet is open: nothing moves now; the width goes once the signature is over. */
  start({ phase: "wallet" });
  giveWidthBack();
  assert.deepEqual([usePier.getState().half, usePier.getState().phase], [9, "wallet"]);
  usePier.setState({ phase: "sending" });
  assert.equal(usePier.getState().half, 9);
  usePier.setState({ phase: "idle" });
  assert.equal(usePier.getState().half, null);

  /* No width by hand: nothing is touched. */
  start({ half: null, phase: "reviewing" });
  giveWidthBack();
  assert.equal(usePier.getState().phase, "reviewing");
  usePier.setState({ phase: "idle" });
});

test("each ticket's form carries its own `edit`: a change lets a build go before it lands", () => {
  for (const file of ["../PoolTicket.tsx", "../ProTicket.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(/\bedit\(\(\) =>/.test(source), `${file} changes its form through edit`);
    assert.ok(/^function edit\(change: \(\) => void\): void \{/m.test(source), `${file} defines edit`);
  }
});

/* ── the form ──────────────────────────────────────────────────────────────────────────────────────────────────── */

test("one form: the range's styles round nothing but what is pressed, cut nothing, and paint no amber of their own", () => {
  const css = readFileSync(new URL("./range.module.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const radii = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((match) => match[1].trim());
  assert.ok(radii.length > 0);
  for (const radius of radii) assert.ok(radius === "0" || radius === "var(--r-ctl)" || radius === "50%", radius);
  assert.equal(/clip-path|--cut/.test(css), false);
  assert.equal(/#[0-9a-f]{3,8}\b/i.test(css), false, "colours are the terminal's tokens");
  assert.equal(/var\(--amber/.test(css), false);
});

test("no branch on a second look: the range's parts read no «Pro» switch", () => {
  const folder = new URL("./", import.meta.url);
  for (const file of readdirSync(folder)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    assert.equal(/usePro\b/.test(readFileSync(new URL(file, folder), "utf8")), false, file);
  }
});
