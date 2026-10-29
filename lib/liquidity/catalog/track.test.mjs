// SOL-2b: watching a pool position — divergence loss and net result against the entry, the entry as actions change it,
// the rebalance a position out of range asks for, and the net of an LP position under the person's assumptions.
import assert from "node:assert/strict";
import test from "node:test";

import { normalCdf, simulateBins, simulateNet, simulateRange, timeInRange } from "./simulate.ts";
import { entryAfterAdd, entryAfterClaim, entryAfterRemove, entryMatches, halfBinsOfSpan, positionResult, readEntry, rebalanceAdvice, SETTLE_WINDOW_MS, settleEntry, typedEntry } from "./track.ts";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

/* A SOL/USDC position: 1 SOL and 100 USDC went in at SOL = $100; SOL is $121 now. */
const view = (overrides = {}) => ({
  kind: "dlmm",
  address: "P",
  pool: "Q",
  name: "SOL-USDC",
  x: { mint: "SOL", symbol: "SOL", amount: 0.9, unclaimed: 0.01, priceUsd: 121 },
  y: { mint: "USDC", symbol: "USDC", amount: 110, unclaimed: 1, priceUsd: 1 },
  rangeState: "in_range",
  lower: 80,
  upper: 125,
  price: 121,
  valueUsd: 0.9 * 121 + 110,
  unclaimedUsd: 0.01 * 121 + 1,
  lockedBps: 0,
  feesElsewhere: false,
  hasRewards: false,
  slot: 1,
  at: 1,
  pricesAt: null,
  ...overrides,
});
const ENTRY = { x: 1, y: 100, usd: 200, claimedUsd: 0, at: 1, source: "ryntra" };

test("divergence loss is the position now against the entry's tokens kept in the wallet; net adds the fees", () => {
  const result = positionResult(view(), ENTRY);
  const hold = 1 * 121 + 100;
  const value = 0.9 * 121 + 110;
  assert.ok(close(result.hold, hold));
  assert.ok(close(result.divergence, value - hold));
  assert.ok(result.divergence < 0, "the price moved: the position holds less than holding would");
  assert.ok(close(result.fees, 2.21));
  assert.ok(close(result.net, value - hold + 2.21));
  assert.ok(close(result.netPct, ((value - hold + 2.21) / hold) * 100));
  assert.ok(close(result.sinceDeposit, value + 2.21 - 200));
  /* Claimed through Ryntra counts with what it earned. */
  assert.ok(close(positionResult(view(), { ...ENTRY, claimedUsd: 5 }).fees, 7.21));
  /* A typed entry has no USD of its own: no «since the deposit». */
  assert.equal(positionResult(view(), { ...ENTRY, usd: null, source: "typed" }).sinceDeposit, null);
});

test("no entry or no prices — no loss is drawn", () => {
  assert.equal(positionResult(view(), null), null);
  assert.equal(positionResult(view({ valueUsd: null }), ENTRY), null);
  assert.equal(positionResult(view({ x: { ...view().x, priceUsd: null } }), ENTRY), null);
  assert.equal(positionResult(view(), { ...ENTRY, x: 0, y: 0 }), null);
});

test("the entry follows what landed: a new position starts it, a withdrawal keeps the rest, a claim counts", () => {
  const opened = entryAfterAdd(null, { x: 1, y: 100, xPriceUsd: 100, yPriceUsd: 1, at: 5 }, true);
  assert.deepEqual(opened, { x: 1, y: 100, usd: 200, claimedUsd: 0, at: 5, source: "ryntra", pending: { xPriceUsd: 100, yPriceUsd: 1 } });
  /* Into an existing position: what it took cannot be told from the price's work — no entry rather than a false one. */
  assert.equal(entryAfterAdd(opened, { x: 0.5, y: 0, xPriceUsd: 120, yPriceUsd: 1, at: 6 }, false), null);
  assert.equal(entryAfterAdd(null, { x: 1, y: 1, xPriceUsd: 1, yPriceUsd: 1, at: 1 }, false), null);
  /* Unpriced: amounts kept, no USD. */
  assert.equal(entryAfterAdd(null, { x: 1, y: 1, xPriceUsd: null, yPriceUsd: 1, at: 1 }, true).usd, null);
  const settled = { ...opened, pending: undefined };
  delete settled.pending;
  const half = entryAfterRemove(settled, 5_000, false);
  assert.equal(half.x, 0.5);
  assert.equal(half.y, 50);
  assert.equal(half.usd, 100);
  assert.equal(entryAfterRemove(settled, 10_000, true), null, "closed — nothing left to watch");
  /* The share is of what may be withdrawn: with half locked, «all» takes half and the entry keeps the rest. */
  const locked = entryAfterRemove(settled, 10_000, false, 5_000);
  assert.equal(locked.x, 0.5);
  assert.equal(entryAfterRemove(settled, 5_000, false, 5_000).x, 0.75);
  assert.equal(entryAfterRemove(settled, 10_000, false), null, "all of an unlocked position — none left");
  assert.equal(entryAfterClaim(half, 3).claimedUsd, 3);
  assert.equal(entryAfterClaim(half, null), half, "an unpriced claim leaves the entry as it was");
  assert.equal(entryAfterClaim(null, 3), null);
});

test("a pending entry takes the amounts the program took from the first read soon after the deposit", () => {
  /* DAMM v2's Review states the cap — sized + slippage; the chain has ~1 % less. */
  const opened = entryAfterAdd(null, { x: 1.01, y: 101, xPriceUsd: 100, yPriceUsd: 1, at: 1_000 }, true);
  const read = { x: { amount: 1 }, y: { amount: 100 }, at: 61_000 };
  const settled = settleEntry(opened, read);
  assert.equal(settled.x, 1);
  assert.equal(settled.y, 100);
  assert.equal(settled.usd, 200, "valued at the deposit's prices");
  assert.equal(settled.pending, undefined);
  /* The browser's clock ahead of the server's: a read that holds the position still settles it. */
  assert.equal(settleEntry(opened, { ...read, at: 500 }).x, 1);
  /* Too late a read: the price has moved the amounts, and the caps are ~1 % high — no entry; the person types it. */
  assert.equal(settleEntry(opened, { ...read, at: 1_000 + SETTLE_WINDOW_MS + 1 }), null);
  assert.equal(settleEntry(settled, read), settled);
  /* Stored and read back, the wait survives. */
  assert.deepEqual(readEntry(JSON.parse(JSON.stringify(opened))), opened);
});

test("an entry the position no longer matches draws no loss", () => {
  /* Half withdrawn on Meteora: both tokens short of the entry. */
  const halved = view({ x: { ...view().x, amount: 0.45 }, y: { ...view().y, amount: 55 }, valueUsd: 0.45 * 121 + 55 });
  assert.equal(entryMatches(halved, ENTRY), false);
  assert.equal(positionResult(halved, ENTRY), null);
  /* A price move trades one for the other: one side holds no less. */
  assert.equal(entryMatches(view(), ENTRY), true);
  /* One-sided entry: no mismatch can be told. */
  assert.equal(entryMatches(halved, { ...ENTRY, y: 0 }), true);
});

test("a typed or stored entry is checked field by field", () => {
  assert.deepEqual(typedEntry(2, 0, 9), { x: 2, y: 0, usd: null, claimedUsd: 0, at: 9, source: "typed" });
  assert.equal(typedEntry(0, 0, 9), null);
  assert.equal(typedEntry(Number.NaN, 1, 9), null);
  assert.equal(typedEntry(-1, 1, 9), null);
  assert.deepEqual(readEntry(JSON.parse(JSON.stringify(ENTRY))), ENTRY);
  assert.equal(readEntry({ ...ENTRY, source: "elsewhere" }), null);
  assert.equal(readEntry({ ...ENTRY, x: "1" }), null);
  assert.equal(readEntry("x"), null);
  assert.equal(readEntry({ ...ENTRY, usd: -5 }).usd, null);
});

test("out of range: the price's side, how far past the edge, and the same width around the price now", () => {
  /* rangeState «above» — the range sits above the price: the price is below it, the position all in X. */
  const below = rebalanceAdvice({ rangeState: "above", lower: 100, upper: 150, price: 90 });
  assert.equal(below.kind, "out");
  assert.equal(below.price, "below");
  assert.equal(below.holds, "x");
  assert.ok(close(below.pastPct, 10));
  assert.ok(close(below.reopen.span, 1.5));
  assert.ok(close(below.reopen.upper / below.reopen.lower, 1.5));
  assert.ok(close(Math.sqrt(below.reopen.upper * below.reopen.lower), 90), "centred on the price in ratio, as bins are");
  const above = rebalanceAdvice({ rangeState: "below", lower: 100, upper: 150, price: 165 });
  assert.equal(above.price, "above");
  assert.equal(above.holds, "y");
  assert.ok(close(above.pastPct, 10));
  /* A venue price behind the chain, still on the range's side of the edge: no distance, no new range. */
  const behind = rebalanceAdvice({ rangeState: "below", lower: 100, upper: 150, price: 140 });
  assert.equal(behind.kind, "out");
  assert.equal(behind.pastPct, null);
  assert.equal(behind.reopen, null);
  assert.equal(rebalanceAdvice({ rangeState: "above", lower: 100, upper: 150, price: 120 }).reopen, null);
  /* No price (an answer from before SOL-2b): still out, no distance, no new range. */
  const blind = rebalanceAdvice({ rangeState: "below", lower: 100, upper: 150 });
  assert.equal(blind.kind, "out");
  assert.equal(blind.pastPct, null);
  assert.equal(blind.reopen, null);
});

test("in range: near an edge says how far is left; the middle and a curve without bounds ask nothing", () => {
  const top = rebalanceAdvice({ rangeState: "in_range", lower: 100, upper: 200, price: 196 });
  assert.equal(top.kind, "near_edge");
  assert.equal(top.edge, "upper");
  assert.ok(close(top.leftPct, (200 / 196 - 1) * 100));
  const bottom = rebalanceAdvice({ rangeState: "in_range", lower: 100, upper: 200, price: 103 });
  assert.equal(bottom.kind, "near_edge");
  assert.equal(bottom.edge, "lower");
  assert.equal(rebalanceAdvice({ rangeState: "in_range", lower: 100, upper: 200, price: 141 }).kind, "none");
  assert.equal(rebalanceAdvice({ rangeState: "in_range", lower: null, upper: null, price: 141 }).kind, "none");
  assert.equal(rebalanceAdvice({ rangeState: "in_range", lower: 100, upper: 200, price: null }).kind, "none");
});

test("a span back to the add form's half-width in bins", () => {
  /* 31 bins at 25 bps: 30 steps across. */
  assert.equal(halfBinsOfSpan(1.0025 ** 30, 25), 15);
  assert.equal(halfBinsOfSpan(1, 25), null);
  assert.equal(halfBinsOfSpan(2, 0), null);
});

test("the normal distribution and the time a wandering price stays inside a range", () => {
  assert.ok(close(normalCdf(0), 0.5, 1e-7));
  assert.ok(close(normalCdf(1.959964), 0.975, 1e-6));
  assert.ok(close(normalCdf(-1), 1 - normalCdf(1), 1e-7));
  assert.equal(timeInRange(null, null, 5, 7), 1, "no bounds: always in");
  const narrow = timeInRange(2, 2, 5, 7);
  const wide = timeInRange(30, 30, 5, 7);
  assert.ok(narrow > 0 && narrow < wide && wide < 1);
  assert.ok(timeInRange(10, 10, 5, 30) < timeInRange(10, 10, 5, 1), "the longer the period, the more of it outside");
  assert.ok(timeInRange(10, 10, 20, 7) < timeInRange(10, 10, 2, 7), "the wilder the price, the more of it outside");
});

test("the net of a position: three outcomes, fees by share and time in range, less divergence, gas and Ryntra's entry share", () => {
  const divergenceAt = (percent) => simulateRange({ min: null, max: null, price: 100, nextPrice: 100 * (1 + percent / 100), value: 1000 }).difference;
  const input = { depositUsd: 1000, tvlUsd: 99_000, volumeUsdPerDay: 1_000_000, feePct: 0.25, protocolSharePct: 5, volatilityPct: 5, days: 7, gasUsd: 0.1, ryntraEntryPct: 0, down: null, up: null, divergenceAt };
  const net = simulateNet(input);
  assert.ok(close(net.share, 0.01));
  assert.equal(net.inRange, 1);
  assert.ok(close(net.fees, 1_000_000 * 0.0025 * 0.95 * 0.01 * 7));
  assert.equal(net.ryntraEntry, 0, "A deposit without automation — Ryntra takes nothing");
  const [down, still, up] = net.scenarios;
  assert.ok(down.movePct < 0 && up.movePct > 0 && still.movePct === 0);
  assert.ok(close(Math.log(1 + up.movePct / 100), -Math.log(1 + down.movePct / 100)), "a typical move, the same in ratio either way");
  assert.ok(close(still.net, net.fees - 0.1));
  assert.ok(down.divergence < 0 && up.divergence < 0, "any move costs a constant-product position against holding");
  assert.ok(down.net < still.net && up.net < still.net);
  /* An entry share, when automation has one, comes off every outcome. */
  const share = simulateNet({ ...input, ryntraEntryPct: 0.5 });
  assert.ok(close(share.ryntraEntry, 5));
  assert.ok(close(share.scenarios[1].net, still.net - 5));
  /* A narrow DLMM range: in range less of the time, so fewer fees. */
  const bins = (percent) => simulateBins({ binStepBps: 25, price: 100, nextPrice: 100 * (1 + percent / 100), below: 5, above: 5, value: 1000 }).difference;
  const narrow = simulateNet({ ...input, down: 1.24, up: 1.26, divergenceAt: bins });
  assert.ok(narrow.inRange < 0.5);
  assert.ok(narrow.fees < net.fees);
  /* Nothing to say without a deposit or with a broken figure. */
  assert.equal(simulateNet({ ...input, depositUsd: 0 }), null);
  assert.equal(simulateNet({ ...input, volumeUsdPerDay: Number.NaN }), null);
  assert.equal(simulateNet({ ...input, divergenceAt: () => null }), null);
});
