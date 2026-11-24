/* The rules of «Сітка» and «Сигнали»: a level's line and its quote, the levels held after sales, every
   condition of a signal and its bounds, and the plan's text — read back exactly, the old plans unchanged. */
import assert from "node:assert/strict";
import test from "node:test";

import { AGENT_SIGNATURE_LAMPORTS, average, dayLow, gridCoversCost, gridHeld, gridLevel, gridLots, gridNetworkRaw, gridOpenBuys, gridSaleDue, gridSaleLine, gridSaleNext, SIGNAL_DEFAULTS, signalFrom, signalLeaves, signalNow, signalRefusal, signalText, TOKEN_ACCOUNT_RENT_LAMPORTS } from "./rules.ts";
import { boundedPlan, planFrom, planLeaves, planMarks, planText, ruleOf } from "../../mandate/plans.ts";

const buy = (level, at, coins = "100", spent = "1000") => ({ at, status: "ok", spentRaw: spent, receivedRaw: coins, level });
const gridSale = (level, at, status = "ok") => ({ at, status, soldRaw: "100", why: "grid", level });

test("a level's line is one step above it; the deepest level due goes first", () => {
  assert.equal(gridLevel(100, 500, 0), 100);
  assert.equal(gridLevel(100, 500, 2), 100 * 0.95 ** 2);
  assert.equal(gridSaleLine(100, 500, 2), 95);
  assert.ok(Math.abs(gridSaleLine(100, 500, 0) - 100 / 0.95) < 1e-9);
  const lots = gridLots([buy(0, 1), buy(1, 2), buy(3, 3)], []);
  assert.deepEqual(lots.map((lot) => lot.level), [0, 1, 3]);
  /* At 96: levels 1 (line 100) and 3 (line 85.7) are due, 0 (line 105.3) is not — the deepest first. */
  assert.equal(gridSaleNext({ anchor: 100, stepBps: 500, lots, price: 96 }).level, 3);
  assert.equal(gridSaleNext({ anchor: 100, stepBps: 500, lots, price: 84 }), null);
  assert.equal(gridSaleNext({ anchor: null, stepBps: 500, lots, price: 96 }), null);
  assert.equal(gridSaleNext({ anchor: 100, stepBps: 500, lots, price: null }), null);
  /* A level whose coins are not read yet holds its place, and has nothing to sell. */
  const unread = gridLots([{ ...buy(2, 1), receivedRaw: null }], []);
  assert.deepEqual(unread.map((lot) => [lot.level, lot.coinsRaw]), [[2, 0n]]);
  assert.equal(gridSaleNext({ anchor: 100, stepBps: 500, lots: unread, price: 200 }), null);
});

test("a level sold opens again; a sale in flight holds it out; a failed one keeps it", () => {
  assert.deepEqual(gridHeld([buy(0, 1), buy(2, 2)], [gridSale(2, 3)]), [0]);
  assert.deepEqual(gridHeld([buy(0, 1), buy(2, 2)], [{ ...gridSale(2, 3, "failed"), unsettled: true }]), [0]);
  assert.deepEqual(gridHeld([buy(0, 1), buy(2, 2)], [gridSale(2, 3, "failed")]), [0, 2]);
  /* Bought again after its sale: held again. */
  assert.deepEqual(gridHeld([buy(2, 2), buy(2, 4)], [gridSale(2, 3)]), [2]);
  /* Her rules' sales are not a level's: the stop is the position's (the caller hands the open position only). */
  assert.deepEqual(gridHeld([buy(1, 1)], [{ at: 2, status: "ok", soldRaw: "50", why: "half" }]), [1]);
  /* Failed buys and buys without a level hold nothing. */
  assert.deepEqual(gridHeld([{ ...buy(1, 1), status: "failed" }, { at: 2, status: "ok", spentRaw: "1", receivedRaw: "1" }], []), []);
});

test("the quote for exactly the level's coins decides — in the marks' unit", () => {
  const due = (quoteRaw) => gridSaleDue({ anchor: 100_000_000, stepBps: 500, level: 2, coinsRaw: 600n, quoteRaw, unitRaw: 1_000_000n });
  /* Line of level 2: 95 000 000 a whole coin → 600 base units must fetch at least 57 000 lamports. */
  assert.equal(due(57_000n), true);
  assert.equal(due(56_999n), false);
  assert.equal(due(null), false);
  assert.equal(due(0n), false);
  assert.equal(gridSaleDue({ anchor: 100, stepBps: 500, level: 2, coinsRaw: 0n, quoteRaw: 10n, unitRaw: 1n }), false);
});

test("signals: every condition, a figure not read is «unread», never a guess", () => {
  const marks = (...prices) => prices.map((price, at) => ({ at: 1_000 + at, price }));
  const now = 2_000;
  assert.equal(average(marks(1, 2, 3), 2), 2.5);
  assert.equal(average(marks(1), 2), null);
  assert.equal(dayLow(marks(5, 3, 4), now), 3);
  const cross = { kind: "cross", fast: 2, slow: 3 };
  assert.equal(signalNow(cross, { marks: marks(90, 90, 100), anchor: null, now }), "on");
  assert.equal(signalNow(cross, { marks: marks(100, 100, 90), anchor: null, now }), "off");
  assert.equal(signalNow(cross, { marks: marks(100, 90), anchor: null, now }), "unread");
  assert.equal(signalLeaves(cross, "off"), true);
  assert.equal(signalLeaves(cross, "unread"), false, "a price not read sells nothing");
  assert.equal(signalLeaves({ kind: "above", bps: 500 }, "off"), false, "only «cross» sells by itself");
  assert.equal(signalNow({ kind: "above", bps: 500 }, { marks: marks(105), anchor: 100, now }), "on");
  assert.equal(signalNow({ kind: "above", bps: 500 }, { marks: marks(104), anchor: 100, now }), "off");
  assert.equal(signalNow({ kind: "below", bps: 500 }, { marks: marks(95), anchor: 100, now }), "on");
  assert.equal(signalNow({ kind: "below", bps: 500 }, { marks: marks(96), anchor: 100, now }), "off");
  assert.equal(signalNow({ kind: "below", bps: 500 }, { marks: [], anchor: 100, now }), "unread");
  assert.equal(signalNow({ kind: "move", bps: 1_000 }, { marks: marks(100, 90, 100), anchor: null, now }), "on");
  assert.equal(signalNow({ kind: "move", bps: 1_000 }, { marks: marks(100, 90, 98), anchor: null, now }), "off");
  const volume = { kind: "volume", pct: 200 };
  assert.equal(signalNow(volume, { marks: [], anchor: null, market: { volumeH6Usd: 500, volumeH24Usd: 1_000 }, now }), "on");
  assert.equal(signalNow(volume, { marks: [], anchor: null, market: { volumeH6Usd: 400, volumeH24Usd: 1_000 }, now }), "off");
  assert.equal(signalNow(volume, { marks: [], anchor: null, market: { volumeH6Usd: null, volumeH24Usd: 1_000 }, now }), "unread");
  assert.equal(signalNow(volume, { marks: [], anchor: null, now }), "unread");
});

test("a signal's text: read back exactly, out of bounds not read", () => {
  for (const trigger of Object.values(SIGNAL_DEFAULTS)) assert.deepEqual(signalFrom(signalText(trigger).split(":")), trigger);
  assert.equal(signalFrom(["cross", "24", "6"]), null, "the slow is longer than the fast");
  assert.equal(signalFrom(["cross", "1", "6"]), null);
  assert.equal(signalFrom(["above", "50"]), null);
  assert.equal(signalFrom(["move", "99999"]), null);
  assert.equal(signalFrom(["volume", "100"]), null);
  assert.equal(signalFrom(["volume", "x"]), null);
  assert.equal(signalFrom(["spike", "200"]), null);
  assert.equal(signalRefusal({ kind: "cross", fast: 6, slow: 6 }), "the slow average is longer than the fast");
});

test("the plan: a grid's sales and a signal, read back exactly; the old plans read as before", () => {
  for (const text of ["grid:500:5,sell:1", "grid:500:5,stop:1000,sell:1,pace:2", "signal:cross:6:24", "signal:above:500,stop:1500", "signal:volume:200,pace:3,hours:1", "grid:500:5", "dip:800,take:2000", "steady,pace:1,hours:1"]) {
    assert.equal(planText(planFrom(text)), text);
  }
  assert.equal(planFrom("grid:500:5").sell, undefined, "a grid without the part buys and holds, as before");
  assert.equal(planFrom("dip:800,sell:1"), null, "only a grid sells its levels");
  assert.equal(planFrom("grid:500:5,sell:2"), null);
  assert.equal(planFrom("grid:500:5,pace:2,sell:1"), null, "the order is the text's own");
  assert.equal(planFrom("grid:500:5,sell:1,stop:1000"), null);
  assert.equal(planFrom("grid:500:5,sell:1,sell:1"), null);
  assert.equal(planFrom("signal:cross"), null);
  assert.equal(planFrom("signal"), null);
  assert.deepEqual(boundedPlan({ id: "signal" }), { id: "signal", trigger: SIGNAL_DEFAULTS.cross, exit: null });
  assert.deepEqual(boundedPlan({ id: "signal", trigger: { kind: "above", bps: 9 } }), { id: "signal", trigger: SIGNAL_DEFAULTS.cross, exit: null });
  assert.equal(planMarks(planFrom("signal:volume:200")), false);
  assert.equal(planMarks(planFrom("signal:move:800")), true);
  assert.equal(planMarks(planFrom("steady")), false);
  assert.equal(planMarks(planFrom("grid:500:5")), true);
});

test("the rule of a buy: a signal buys only while its condition holds; a grid that sells re-buys a sold level", () => {
  const position = { spent: 0n, worth: 0n };
  const base = { now: 10_000, anchor: 100, held: [], position, bornAt: null };
  const on = ruleOf({ ...base, plan: planFrom("signal:above:500"), marks: [{ at: 9_000, price: 106 }] });
  assert.deepEqual(on, { do: "buy" });
  assert.deepEqual(ruleOf({ ...base, plan: planFrom("signal:above:500"), marks: [{ at: 9_000, price: 101 }] }), { do: "hold", why: "no-signal" });
  assert.deepEqual(ruleOf({ ...base, plan: planFrom("signal:above:500"), marks: [] }), { do: "hold", why: "unread" });
  assert.deepEqual(ruleOf({ ...base, plan: planFrom("signal:volume:200"), marks: [], market: { volumeH6Usd: 600, volumeH24Usd: 1_000 } }), { do: "buy" });
  assert.deepEqual(ruleOf({ ...base, plan: planFrom("signal:volume:200"), marks: [] }), { do: "hold", why: "unread" });
  /* The grid's own rule is unchanged: the caller hands the levels held — a sold one is simply not among them. */
  const grid = planFrom("grid:500:5,sell:1");
  assert.deepEqual(ruleOf({ ...base, plan: grid, marks: [{ at: 9_000, price: 90 }], held: [0, 1] }), { do: "buy", level: 2 });
  assert.deepEqual(ruleOf({ ...base, plan: grid, marks: [{ at: 9_000, price: 90 }], held: [0] }), { do: "buy", level: 2 }, "the deepest open level the price came to");
  assert.equal(planLeaves(planFrom("signal:cross:2:3"), { marks: [100, 100, 90].map((price, at) => ({ at, price })), anchor: null, now: 10 }), true);
  assert.equal(planLeaves(grid, { marks: [], anchor: null, now: 10 }), false);
});

test("the lead's review of #1965: a level's sale covers its own cost after the fee, or it is no sale", () => {
  assert.equal(gridCoversCost({ outRaw: 50_000_000n, costRaw: 50_000_000n }), true, "at cost");
  assert.equal(gridCoversCost({ outRaw: 49_999_999n, costRaw: 50_000_000n }), false, "a lamport under");
  assert.equal(gridCoversCost({ outRaw: null, costRaw: 1n }), false, "not read");
  assert.equal(gridCoversCost({ outRaw: 0n, costRaw: 0n }), false, "nothing brought");
});

/* ------------------------------------------------------------------ The reviews' MINOR before the money opens */

test("a level the day's limit sold in part stays held with what is left — never bought over the rest", () => {
  const part = { at: 2, status: "ok", soldRaw: "60", why: "grid", level: 1, partial: true, costRaw: "600" };
  /* Level 1 bought 100 coins for 1 000; a sale cut short by the day's limit sold 60 of them, carrying 600 of the cost. */
  const lots = gridLots([buy(0, 1), buy(1, 1)], [part]);
  assert.deepEqual(lots.map((lot) => [lot.level, lot.coinsRaw, lot.costRaw]), [[0, 100n, 1000n], [1, 40n, 400n]]);
  assert.deepEqual(gridHeld([buy(0, 1), buy(1, 1)], [part]), [0, 1], "the level is still held: the rule of a buy does not buy it again");
  assert.equal(gridOpenBuys([buy(0, 1), buy(1, 1)], [part]).length, 2, "its buy still stands in the position");
  /* The rest sold whole: the level opens again. */
  const rest = { at: 3, status: "ok", soldRaw: "40", why: "grid", level: 1, costRaw: "400" };
  assert.deepEqual(gridHeld([buy(0, 1), buy(1, 1)], [part, rest]), [0]);
  /* Every coin sold in parts: nothing left to hold, the level is open. */
  assert.deepEqual(gridHeld([buy(1, 1)], [part, { ...part, at: 3, soldRaw: "40", costRaw: "400" }]), []);
  /* A part still in flight holds its coins out as well; a failed part takes nothing. */
  assert.deepEqual(gridLots([buy(1, 1)], [{ ...part, status: "failed", unsettled: true }]).map((lot) => lot.coinsRaw), [40n]);
  assert.deepEqual(gridLots([buy(1, 1)], [{ ...part, status: "failed" }]).map((lot) => lot.coinsRaw), [100n]);
  /* The next sale is the rest of the level, at its own line: the deepest due. */
  assert.equal(gridSaleNext({ anchor: 100, stepBps: 500, lots, price: 100 }).coinsRaw, 40n);
});

test("a «cross» signal's averages only over marks without a gap — otherwise «unread»", () => {
  const STEP = 10 * 60_000;
  const even = [100, 100, 100, 90].map((price, at) => ({ at: at * STEP, price }));
  assert.equal(signalNow({ kind: "cross", fast: 2, slow: 3 }, { marks: even, anchor: null, now: 3 * STEP, maxGapMs: 2 * STEP }), "off");
  /* One mark three hours late inside the slow window: the average spans the gap — not read. */
  const gapped = even.map((mark, at) => (at === 3 ? { ...mark, at: mark.at + 3 * 3_600_000 } : mark));
  assert.equal(signalNow({ kind: "cross", fast: 2, slow: 3 }, { marks: gapped, anchor: null, now: gapped.at(-1).at, maxGapMs: 2 * STEP }), "unread");
  assert.equal(signalLeaves({ kind: "cross", fast: 2, slow: 3 }, "unread"), false, "unread sells nothing");
  /* A gap older than the slow window is past: the window itself is even. */
  const old = [{ at: -9 * 3_600_000, price: 50 }, ...even];
  assert.equal(average(old, 3, 2 * STEP), (100 + 100 + 90) / 3);
  assert.equal(average(gapped, 3, 2 * STEP), null);
  /* The run on history hands no gap: its bars are read as they are. */
  assert.equal(average(gapped, 3), (100 + 100 + 90) / 3);
  /* The engine's own rule of a buy reads the gap too. */
  const plan = planFrom("signal:cross:2:3");
  const position = { spent: 0n, worth: null };
  assert.deepEqual(ruleOf({ plan, now: gapped.at(-1).at, marks: gapped, anchor: null, held: [], position, bornAt: null, markGapMs: 2 * STEP }), { do: "hold", why: "unread" });
  assert.equal(planLeaves(plan, { marks: gapped, anchor: null, now: gapped.at(-1).at, markGapMs: 2 * STEP }), false);
});

test("the network's fees of a level's round trip — two signatures, and the rent of each account the sale opens", () => {
  assert.equal(gridNetworkRaw(), 2n * AGENT_SIGNATURE_LAMPORTS);
  assert.equal(gridNetworkRaw({ accountsOpened: 1 }), 2n * AGENT_SIGNATURE_LAMPORTS + TOKEN_ACCOUNT_RENT_LAMPORTS);
  assert.equal(gridNetworkRaw({ priorityRaw: 1_000n }), 2n * (AGENT_SIGNATURE_LAMPORTS + 1_000n));
  assert.equal(gridNetworkRaw({ accountsOpened: -2, priorityRaw: -1n }), 2n * AGENT_SIGNATURE_LAMPORTS, "nothing negative lowers the floor");
  /* A level that covers its buy and not its signatures is no sale. */
  assert.equal(gridCoversCost({ outRaw: 1_000_000n, costRaw: 1_000_000n + gridNetworkRaw() }), false);
  assert.equal(gridCoversCost({ outRaw: 1_010_000n, costRaw: 1_000_000n + gridNetworkRaw() }), true);
});
