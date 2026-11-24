// The stock pool's keeper: the bounds a person signs once, the switch, and the one choice of the hours.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RANGE_MAX_SHIFTS_PER_DAY,
  keeperLine,
  keeperModeOf,
  keeperTermsOf,
  liveRangeOf,
  rangeAround,
  rangeLimitsRefusal,
  shiftRefusal,
  shiftTimingRefusal,
  wholeOf,
  widthRefusal,
} from "./range-limits.ts";
import { OPEN_SETTLE_MS, RECENTER_SHARE, apartBps, inShape, nightHalfWidthBps, openSeenAtOf, stockKeeperAction } from "./stock-hours.ts";
import { STOCK_KEEPER_ENV, STOCK_KEEPER_SHIFT_ON_MAINNET, stockKeeperAllowed, stockKeeperGate } from "./stock-keeper-gate.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Thursday 19.11.2026, 16:00 UTC — the New York session is open, it closes at 21:00 UTC. */
const NOW = Date.UTC(2026, 10, 19, 16, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

/** A keeper that puts back: ±0.5 % by day, ±4 % by night, 6 moves a day; 1 000 of the stock and 100 000 USDC a move. */
const SHIFT = Object.freeze({
  narrowestBps: 50,
  widestBps: 400,
  minIntervalMs: 30 * MIN,
  maxShiftsPerDay: 6,
  maxCostPerShiftLamports: 10_000_000,
  maxCostPerDayLamports: 40_000_000,
  maxPutBackPerShift: { xRaw: "1000000000", yRaw: "100000000000" },
  maxPutBackPerDay: { xRaw: "4000000000", yRaw: "400000000000" },
});
/** The same bounds with nothing put back: it only takes out. */
const PULL = Object.freeze({ ...SHIFT, maxPutBackPerShift: { xRaw: "0", yRaw: "0" }, maxPutBackPerDay: { xRaw: "0", yRaw: "0" } });

const openSession = (closesIn = 5 * HOUR) => ({ open: true, nextChangeAt: iso(NOW + closesIn) });
const closedSession = (opensIn = 17.5 * HOUR) => ({ open: false, nextChangeAt: iso(NOW + opensIn) });

/** A range of the position around `center` with `halfWidthBps`. */
const rangeOf = (center, halfWidthBps) => {
  const { lowerPrice, upperPrice } = rangeAround(center, halfWidthBps);
  return liveRangeOf(lowerPrice, upperPrice);
};

const state = (extra = {}) => ({
  session: openSession(),
  openSeenAt: NOW - 2 * HOUR,
  step: null,
  poolPrice: 100,
  reference: { price: 100, current: true },
  range: rangeOf(100, 50),
  waitingInWallet: false,
  expectedGapBps: null,
  ...extra,
});

/* ------------------------------------------------------------------ the bounds */

test("bounds: a keeper's own bounds pass; each one outside its room is refused with the reason", () => {
  assert.equal(rangeLimitsRefusal(SHIFT), null);
  assert.equal(rangeLimitsRefusal(PULL), null);
  assert.match(rangeLimitsRefusal({ ...SHIFT, narrowestBps: 5 }), /narrowest/);
  assert.match(rangeLimitsRefusal({ ...SHIFT, widestBps: 6_000 }), /widest/);
  assert.match(rangeLimitsRefusal({ ...SHIFT, narrowestBps: 500, widestBps: 400 }), /not wider than the widest/);
  assert.match(rangeLimitsRefusal({ ...SHIFT, minIntervalMs: MIN }), /quarter of an hour/);
  assert.match(rangeLimitsRefusal({ ...SHIFT, maxShiftsPerDay: 0 }), /moves/);
  assert.match(rangeLimitsRefusal({ ...SHIFT, maxShiftsPerDay: RANGE_MAX_SHIFTS_PER_DAY + 1 }), /moves/);
  assert.match(rangeLimitsRefusal({ ...SHIFT, maxCostPerShiftLamports: 0 }), /lamports/);
  assert.match(rangeLimitsRefusal({ ...SHIFT, maxCostPerDayLamports: 1 }), /day's cost/);
  assert.match(rangeLimitsRefusal({ ...SHIFT, maxPutBackPerShift: { xRaw: "-1", yRaw: "0" } }), /raw amount/);
  assert.match(rangeLimitsRefusal({ ...SHIFT, maxPutBackPerShift: { xRaw: "1.5", yRaw: "0" } }), /raw amount/);
  assert.match(rangeLimitsRefusal({ ...SHIFT, maxPutBackPerShift: { xRaw: "18446744073709551616", yRaw: "0" } }), /raw amount/);
  assert.match(rangeLimitsRefusal({ ...SHIFT, maxPutBackPerDay: { xRaw: "1", yRaw: "400000000000" } }), /day's put-back/);
});

test("bounds: nothing put back on either coin is a keeper that only takes out", () => {
  assert.equal(keeperModeOf(PULL), "pull");
  assert.equal(keeperModeOf(SHIFT), "shift");
  assert.equal(keeperModeOf({ maxPutBackPerShift: { xRaw: "0", yRaw: "1" } }), "shift");
});

test("bounds: a built move is held to every bound — width, time, count, cost and what it puts back, per move and per day", () => {
  const plan = { halfWidthBps: 50, costLamports: 3_000_000, putBackXRaw: "900000000", putBackYRaw: "90000000000" };
  assert.equal(shiftRefusal(SHIFT, plan, [], NOW), null);
  assert.equal(shiftRefusal(SHIFT, { ...plan, halfWidthBps: 49 }, [], NOW), "too-narrow");
  assert.equal(shiftRefusal(SHIFT, { ...plan, halfWidthBps: 401 }, [], NOW), "too-wide");
  assert.equal(shiftRefusal(SHIFT, plan, [{ at: NOW - 29 * MIN, costLamports: 0, putBackXRaw: "0", putBackYRaw: "0" }], NOW), "too-soon");
  assert.equal(shiftRefusal(SHIFT, plan, [{ at: NOW - 30 * MIN, costLamports: 0, putBackXRaw: "0", putBackYRaw: "0" }], NOW), null, "exactly the interval is enough");
  const six = Array.from({ length: 6 }, (_, index) => ({ at: NOW - (index + 1) * 3 * HOUR, costLamports: 1, putBackXRaw: "0", putBackYRaw: "0" }));
  assert.equal(shiftRefusal(SHIFT, plan, six, NOW), "too-many", "six moves in 18 hours");
  assert.equal(shiftRefusal(SHIFT, plan, six.map((entry, index) => (index === 5 ? { ...entry, at: NOW - DAY } : entry)), NOW), null, "a move a whole day ago is not in the day");
  assert.equal(shiftRefusal(SHIFT, { ...plan, costLamports: 10_000_001 }, [], NOW), "cost-per-shift");
  assert.equal(shiftRefusal(SHIFT, plan, [{ at: NOW - 2 * HOUR, costLamports: 37_000_001, putBackXRaw: "0", putBackYRaw: "0" }], NOW), "cost-per-day");
  assert.equal(shiftRefusal(SHIFT, { ...plan, putBackXRaw: "1000000001" }, [], NOW), "put-back-per-shift");
  assert.equal(shiftRefusal(SHIFT, { ...plan, putBackYRaw: "100000000001" }, [], NOW), "put-back-per-shift");
  assert.equal(shiftRefusal(SHIFT, plan, [{ at: NOW - 2 * HOUR, costLamports: 0, putBackXRaw: "3200000000", putBackYRaw: "0" }], NOW), "put-back-per-day");
  assert.equal(shiftRefusal(PULL, { ...plan, putBackXRaw: "1", putBackYRaw: "0" }, [], NOW), "put-back-per-shift", "a keeper that only takes out puts nothing back");
  assert.equal(shiftRefusal(SHIFT, { ...plan, putBackXRaw: "x" }, [], NOW), "bad-plan");
  assert.equal(shiftTimingRefusal(SHIFT, [{ at: NOW + MIN, costLamports: 0, putBackXRaw: "0", putBackYRaw: "0" }], NOW), null, "a record from the future is not a move made");
  assert.equal(widthRefusal(SHIFT, 50), null);
});

test("bounds: a range reads as its centre and half-width, and is laid back the same", () => {
  const laid = rangeAround(150, 200);
  const read = liveRangeOf(laid.lowerPrice, laid.upperPrice);
  assert.ok(Math.abs(read.centerPrice - 150) < 1e-9);
  assert.equal(read.halfWidthBps, 200);
  assert.equal(liveRangeOf(0, 1), null);
  assert.equal(liveRangeOf(2, 1), null);
});

/* ------------------------------------------------------------------ what the person reads */

test("terms: a keeper that only takes out names no approval; one that puts back names it, and that its key could spend it outside the pool", () => {
  const pull = keeperTermsOf(PULL, null);
  assert.equal(pull.mode, "pull");
  assert.equal(pull.approval, null);
  assert.equal(pull.approvalOutsideThePool, false);
  assert.deepEqual(pull.may.map((entry) => entry.what), ["collect-fees", "take-out-to-wallet"]);
  assert.ok(pull.mayNot.some((entry) => entry.what === "pay-anyone-but-the-owner" && entry.heldBy === "program"));

  const approval = { xRaw: "4000000000", yRaw: "400000000000" };
  const shift = keeperTermsOf(SHIFT, approval);
  assert.equal(shift.mode, "shift");
  assert.deepEqual(shift.approval, approval);
  assert.equal(shift.approvalOutsideThePool, true, "said before the signature, never hidden");
  assert.ok(shift.may.some((entry) => entry.what === "put-back-from-wallet" && entry.heldBy === "token-program"));
  assert.ok(shift.may.some((entry) => entry.what === "move-range" && entry.heldBy === "ryntra-signer"));
  assert.ok(shift.mayNot.some((entry) => entry.what === "put-back-over-bounds" && entry.heldBy === "ryntra-signer"));
});

test("terms: the one line says where the money goes, in both languages, with no word of the machinery", () => {
  const coins = { x: { symbol: "ANT", decimals: 6 }, y: { symbol: "USDC", decimals: 6 } };
  const pullUk = keeperLine(keeperTermsOf(PULL, null), coins, "uk");
  const pullEn = keeperLine(keeperTermsOf(PULL, null), coins, "en");
  assert.match(pullUk, /лише на твій гаманець/);
  assert.match(pullUk, /±4%/, "a keeper that only takes out says the night's width it takes out below");
  assert.doesNotMatch(pullEn, /keeps ±/, "it lays no range, so it does not say it keeps one");
  assert.match(pullEn, /only to your wallet/);
  const shiftUk = keeperLine(keeperTermsOf(SHIFT, { xRaw: "4000000000", yRaw: "400000000000" }), coins, "uk");
  assert.match(shiftUk, /±0.5%.*±4%/);
  assert.match(shiftUk, /4000 ANT · 400000 USDC/);
  assert.match(shiftUk, /лише на твій гаманець/);
  assert.match(shiftUk, /цю межу тримає Ryntra/, "who holds the approval's bound is said, not hidden");
  assert.match(keeperLine(keeperTermsOf(SHIFT, { xRaw: "1", yRaw: "1" }), coins, "en"), /Ryntra holds that bound/);
  for (const line of [pullUk, pullEn, shiftUk]) assert.doesNotMatch(line, /tick|bps|delegate|делегат|тік|API|program|програм/i);
  assert.equal(wholeOf("1500000", 6), "1.5");
  assert.equal(wholeOf("7", 0), "7");
  assert.equal(wholeOf("1", 9), "0.000000001");
});

/* ------------------------------------------------------------------ the switch */

test("switch: closed unless it names a network", () => {
  assert.deepEqual(stockKeeperGate({}), { open: false });
  assert.deepEqual(stockKeeperGate({ [STOCK_KEEPER_ENV]: "yes" }), { open: false });
  assert.deepEqual(stockKeeperGate({ [STOCK_KEEPER_ENV]: " DevNet " }), { open: true, network: "devnet", modes: ["pull", "shift"] });
  assert.equal(STOCK_KEEPER_SHIFT_ON_MAINNET, false);
  assert.deepEqual(stockKeeperGate({ [STOCK_KEEPER_ENV]: "mainnet" }), { open: true, network: "mainnet", modes: ["pull"] });
  const devnet = stockKeeperGate({ [STOCK_KEEPER_ENV]: "devnet" });
  const mainnet = stockKeeperGate({ [STOCK_KEEPER_ENV]: "mainnet" });
  assert.equal(stockKeeperAllowed(devnet, "devnet", SHIFT), true);
  assert.equal(stockKeeperAllowed(devnet, "mainnet", PULL), false, "the switch's network only");
  assert.equal(stockKeeperAllowed(mainnet, "mainnet", PULL), true);
  assert.equal(stockKeeperAllowed(mainnet, "mainnet", SHIFT), false);
  assert.equal(stockKeeperAllowed({ open: false }, "devnet", PULL), false);
});

/* ------------------------------------------------------------------ the hours */

test("hours: no session known, or no price — nothing is guessed", () => {
  assert.deepEqual(stockKeeperAction(state({ session: null }), SHIFT, "leave", [], NOW), { kind: "wait", reason: "session-unknown" });
  assert.deepEqual(stockKeeperAction(state({ session: { open: null, nextChangeAt: null } }), SHIFT, "leave", [], NOW), { kind: "wait", reason: "session-unknown" });
  assert.deepEqual(stockKeeperAction(state({ poolPrice: 0 }), SHIFT, "leave", [], NOW), { kind: "wait", reason: "bad-price" });
  assert.deepEqual(stockKeeperAction(state({ poolPrice: Number.NaN }), SHIFT, "leave", [], NOW), { kind: "wait", reason: "bad-price" });
});

test("hours, the open: the night's wide range stays for the first quarter of an hour, then goes narrow around the price", () => {
  const night = rangeOf(100, 400);
  const justOpened = state({ range: night, openSeenAt: NOW - 5 * MIN });
  assert.deepEqual(stockKeeperAction(justOpened, SHIFT, "leave", [], NOW), { kind: "wait", reason: "opening" });
  assert.deepEqual(stockKeeperAction(state({ range: night, openSeenAt: null }), SHIFT, "leave", [], NOW), { kind: "wait", reason: "opening" }, "an open not yet seen is an open just now");
  const settled = stockKeeperAction(state({ range: night, openSeenAt: NOW - OPEN_SETTLE_MS }), SHIFT, "leave", [], NOW);
  assert.equal(settled.kind, "shift");
  assert.equal(settled.shape, "narrow");
  assert.equal(settled.reason, "open");
  assert.equal(settled.halfWidthBps, SHIFT.narrowestBps, "narrow is the narrowest the person allowed");
  assert.ok(Math.abs(settled.centerPrice - 100) < 1e-9);
  assert.ok(Math.abs(settled.upperPrice / settled.centerPrice - 1.005) < 1e-12 && Math.abs(settled.centerPrice / settled.lowerPrice - 1.005) < 1e-12);
});

test("hours, the open with a jump: no narrow range while the pool stands apart from the exchange; laid around the exchange's price once the pool sits inside it", () => {
  const night = rangeOf(100, 400);
  const jumped = state({ range: night, poolPrice: 100, reference: { price: 103, current: true } });
  assert.ok(apartBps(103, 100) > RECENTER_SHARE * SHIFT.narrowestBps);
  assert.deepEqual(stockKeeperAction(jumped, SHIFT, "leave", [], NOW), { kind: "wait", reason: "price-apart" });
  assert.deepEqual(stockKeeperAction(state({ range: night, poolPrice: 102.7, reference: { price: 103, current: true } }), SHIFT, "leave", [], NOW), { kind: "wait", reason: "price-apart" }, "29 bps apart: a ±0.5 % range at 103 would hold the pool's price at its very edge");
  const caught = stockKeeperAction(state({ range: night, poolPrice: 102.85, reference: { price: 103, current: true } }), SHIFT, "leave", [], NOW);
  assert.equal(caught.kind, "shift");
  assert.ok(Math.abs(caught.centerPrice - 103) < 1e-9, "centred on the exchange's price, where the engine has a current one");
  assert.ok(caught.lowerPrice < 102.85 && 102.85 < caught.upperPrice, "and the pool's price is inside the range laid");
  const stale = stockKeeperAction(state({ range: night, poolPrice: 100, reference: { price: 103, current: false } }), SHIFT, "leave", [], NOW);
  assert.equal(stale.kind, "shift", "a reference that is not current is not the price");
  assert.ok(Math.abs(stale.centerPrice - 100) < 1e-9, "the pool's own price instead");
  const wideApart = stockKeeperAction(state({ session: openSession(30 * MIN), poolPrice: 100, reference: { price: 103, current: true } }), SHIFT, "leave", [], NOW);
  assert.equal(wideApart.kind, "shift", "the close does not wait for the pool to catch up");
  assert.ok(Math.abs(wideApart.centerPrice - 100) < 1e-9, "its wide range is laid around the pool's own price, which it must hold");
});

test("hours, the close: the last hour the range goes wide; a keeper that only takes out takes the narrow liquidity to the wallet", () => {
  const closing = state({ session: openSession(45 * MIN) });
  const shift = stockKeeperAction(closing, SHIFT, "leave", [], NOW);
  assert.equal(shift.kind, "shift");
  assert.equal(shift.shape, "wide");
  assert.equal(shift.reason, "close");
  assert.equal(shift.halfWidthBps, SHIFT.widestBps, "with no gap known, the widest the person allowed");
  assert.deepEqual(stockKeeperAction(closing, PULL, "leave", [], NOW), { kind: "pull", reason: "close" });
  assert.deepEqual(stockKeeperAction(state({ session: openSession(2 * HOUR) }), SHIFT, "leave", [], NOW), { kind: "wait", reason: "in-shape" }, "two hours before the close the narrow range stays");
  assert.deepEqual(stockKeeperAction(state({ session: closedSession(), range: rangeOf(100, 400), openSeenAt: null }), PULL, "leave", [], NOW), { kind: "wait", reason: "in-shape" }, "a range as wide as the night's stays even for a keeper that only takes out");
});

test("hours, the night and a holiday: wide once, then nothing — a closed day is not a churning day", () => {
  const holiday = { open: false, nextChangeAt: iso(NOW + 3 * DAY) };
  const first = stockKeeperAction(state({ session: holiday, openSeenAt: null }), SHIFT, "leave", [], NOW);
  assert.equal(first.kind, "shift");
  assert.equal(first.shape, "wide");
  const history = [{ at: NOW, costLamports: 3_000_000, putBackXRaw: "0", putBackYRaw: "0" }];
  for (let hours = 1; hours <= 48; hours += 1) {
    const later = NOW + hours * HOUR;
    const drift = 100 * (1 + (hours % 3) * 0.004);
    const action = stockKeeperAction(state({ session: holiday, openSeenAt: null, poolPrice: drift, reference: { price: 100, current: false }, range: rangeOf(100, 400) }), SHIFT, "leave", history, later);
    assert.deepEqual(action, { kind: "wait", reason: "in-shape" }, `hour ${hours}`);
  }
  const gone = stockKeeperAction(state({ session: holiday, openSeenAt: null, poolPrice: 103, reference: null, range: rangeOf(100, 400) }), SHIFT, "leave", history, NOW + 4 * HOUR);
  assert.equal(gone.kind, "shift", "a price that walked half the night's range away is laid around again");
  assert.equal(gone.reason, "recenter");
});

test("hours, a drift by day: laid again around the price once it is half the half-width from the centre", () => {
  assert.deepEqual(stockKeeperAction(state({ poolPrice: 100.2, reference: { price: 100.2, current: true } }), SHIFT, "leave", [], NOW), { kind: "wait", reason: "in-shape" });
  const drifted = stockKeeperAction(state({ poolPrice: 100.3, reference: { price: 100.3, current: true } }), SHIFT, "leave", [], NOW);
  assert.equal(drifted.kind, "shift");
  assert.equal(drifted.reason, "recenter");
  assert.deepEqual(stockKeeperAction(state({ poolPrice: 100.3, reference: { price: 100.3, current: true } }), PULL, "leave", [], NOW), { kind: "wait", reason: "needs-owner" }, "a keeper that only takes out cannot lay it again");
});

test("hours, within the bounds only: too soon after the last move, or the day's moves spent — it waits and says which", () => {
  const night = rangeOf(100, 400);
  const settled = state({ range: night });
  assert.deepEqual(stockKeeperAction(settled, SHIFT, "leave", [{ at: NOW - 10 * MIN, costLamports: 1, putBackXRaw: "0", putBackYRaw: "0" }], NOW), { kind: "wait", reason: "too-soon" });
  const spent = Array.from({ length: SHIFT.maxShiftsPerDay }, (_, index) => ({ at: NOW - (index + 1) * HOUR, costLamports: 1, putBackXRaw: "0", putBackYRaw: "0" }));
  assert.deepEqual(stockKeeperAction(settled, SHIFT, "leave", spent, NOW), { kind: "wait", reason: "too-many" });
});

test("hours, a dividend: inside the Stock Pier's window nothing new goes in; «leave» takes the liquidity to the wallet, «stay» keeps it still", () => {
  const step = { at: iso(NOW + 6 * HOUR), from: 1, to: 1.004 };
  assert.deepEqual(stockKeeperAction(state({ step }), SHIFT, "leave", [], NOW), { kind: "pull", reason: "dividend" });
  assert.deepEqual(stockKeeperAction(state({ step }), PULL, "leave", [], NOW), { kind: "pull", reason: "dividend" });
  assert.deepEqual(stockKeeperAction(state({ step }), SHIFT, "stay", [], NOW), { kind: "wait", reason: "dividend-hold" });
  assert.deepEqual(stockKeeperAction(state({ step, range: rangeOf(100.6, 50) }), SHIFT, "stay", [], NOW), { kind: "wait", reason: "dividend-hold" }, "not even a recentre: that would put new liquidity in");
  assert.deepEqual(stockKeeperAction(state({ step, range: null, waitingInWallet: true }), SHIFT, "leave", [], NOW), { kind: "wait", reason: "dividend-hold" }, "what was taken out waits in the wallet");
  const ahead = { at: iso(NOW + 3 * DAY), from: 1, to: 1.004 };
  assert.deepEqual(stockKeeperAction(state({ step: ahead }), SHIFT, "leave", [], NOW), { kind: "wait", reason: "in-shape" }, "a step in sight but outside its window changes nothing yet");
  const split = { at: iso(NOW + 6 * HOUR), from: 1, to: 2 };
  assert.deepEqual(stockKeeperAction(state({ step: split }), SHIFT, "leave", [], NOW), { kind: "wait", reason: "in-shape" }, "a split holds only its quarter of an hour either side");
  assert.deepEqual(stockKeeperAction(state({ step: split }), SHIFT, "leave", [], Date.parse(split.at) - 10 * MIN), { kind: "pull", reason: "dividend" });
});

test("hours, after the window: a keeper that puts back lays the money from the wallet again; one that only takes out calls the person", () => {
  const after = state({ range: null, waitingInWallet: true });
  const back = stockKeeperAction(after, SHIFT, "leave", [], NOW);
  assert.equal(back.kind, "shift");
  assert.equal(back.reason, "back");
  assert.equal(back.shape, "narrow");
  assert.deepEqual(stockKeeperAction(after, PULL, "leave", [], NOW), { kind: "wait", reason: "needs-owner" });
  assert.deepEqual(stockKeeperAction(state({ range: null, waitingInWallet: false }), SHIFT, "leave", [], NOW), { kind: "wait", reason: "nothing-in-pool" });
});

test("hours: the night's width is twice the expected opening gap, within the person's bounds", () => {
  assert.equal(nightHalfWidthBps(SHIFT, null), 400);
  assert.equal(nightHalfWidthBps(SHIFT, 120), 240);
  assert.equal(nightHalfWidthBps(SHIFT, 900), 400);
  assert.equal(nightHalfWidthBps(SHIFT, 10), 50);
  assert.equal(nightHalfWidthBps(SHIFT, -5), 400);
  const closing = stockKeeperAction(state({ session: openSession(30 * MIN), expectedGapBps: 120 }), SHIFT, "leave", [], NOW);
  assert.equal(closing.halfWidthBps, 240);
});

test("hours: when the keeper saw the session open — set once, kept while open, cleared at the close", () => {
  assert.equal(openSeenAtOf(null, openSession(), NOW), NOW);
  assert.equal(openSeenAtOf(NOW - HOUR, openSession(), NOW), NOW - HOUR);
  assert.equal(openSeenAtOf(NOW - HOUR, openSession(30 * MIN), NOW), NOW - HOUR, "the closing hour is still open");
  assert.equal(openSeenAtOf(NOW - HOUR, closedSession(), NOW), null);
  assert.equal(openSeenAtOf(NOW - HOUR, null, NOW), null);
});

test("hours: a range is the one asked for when it is about that wide and the price is near its centre", () => {
  assert.equal(inShape(rangeOf(100, 50), 100, 50), true);
  assert.equal(inShape(rangeOf(100, 54), 100, 50), true);
  assert.equal(inShape(rangeOf(100, 60), 100, 50), false);
  assert.equal(inShape(rangeOf(100, 400), 100, 50), false);
  assert.equal(inShape(rangeOf(100, 50), 100.3, 50), false);
});
