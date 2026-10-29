// Run from repo root: node --test lib/spot/meme-exits.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  EXIT_CLAIM_MS,
  EXIT_PRESETS,
  EXIT_STORAGE_PREFIX,
  EXIT_PRICE_MAX_AGE_MS,
  armExitPlan,
  cancelExitPlan,
  claimLeg,
  exitPlanWrites,
  exitDraftErrors,
  latestPlanFor,
  legKey,
  legSale,
  legSentWith,
  levelPastNow,
  levelUsd,
  markLegSent,
  nextReadyLeg,
  observeExitPlan,
  openPlanFor,
  planOpen,
  readExitPlans,
  readyLegs,
  remainingRaw,
  settleLeg,
  typedPct,
  unsendLeg,
} from "./meme-exits.ts";

const T0 = 1_760_000_000_000;
const OWNER = "Owner1111111111111111111111111111111111111";
const MINT = "Meme111111111111111111111111111111111111111";

function arm(draft = EXIT_PRESETS.halfAtDouble, over = {}) {
  const armed = armExitPlan({ id: "p1", owner: OWNER, mint: MINT, symbol: "MEME", decimals: 6, holdingRaw: 1_000_000_000n, entryUsd: 0.001, entrySource: "Jupiter", entryAt: T0, now: T0 + 1_000, draft, ...over });
  assert.equal(armed.ok, true, JSON.stringify(armed));
  return armed.plan;
}

const sent = (plan, legId, signature, sentRaw = 500_000_000n, tab = "A") => markLegSent(plan, legId, { signature, requestId: `req-${signature}`, sentRaw, tab, now: T0 + 10_000 });

/** A device's storage: the writes applied to a map, read back as the page reads it. */
function store(entries = new Map()) {
  return {
    entries,
    apply(writes) {
      for (const [key, value] of writes) {
        if (value === null) entries.delete(key);
        else entries.set(key, value);
      }
    },
    read() {
      return readExitPlans((key) => entries.get(key) ?? null, [...entries.keys()]);
    },
  };
}

test("the storage keys are the plan's own", () => {
  assert.equal(EXIT_STORAGE_PREFIX, "ryntra.exit.v1:");
  assert.equal(legKey("p1", "tp1"), "ryntra.exit.v1:leg:p1:tp1");
});

test("a draft is checked in the order a person fixes it", () => {
  assert.deepEqual(exitDraftErrors({ tp: [], sl: null, trail: null }), ["EMPTY"]);
  assert.deepEqual(exitDraftErrors(EXIT_PRESETS.halfAtDouble), []);
  assert.deepEqual(exitDraftErrors(EXIT_PRESETS.ladder), []);
  assert.deepEqual(exitDraftErrors({ tp: [{ movePct: 0, sharePct: 50 }], sl: null, trail: null }), ["TP_MOVE"]);
  assert.deepEqual(exitDraftErrors({ tp: [{ movePct: 50, sharePct: 0 }], sl: null, trail: null }), ["TP_SHARE"]);
  assert.deepEqual(exitDraftErrors({ tp: [{ movePct: 100, sharePct: 50 }, { movePct: 50, sharePct: 20 }], sl: null, trail: null }), ["TP_ORDER"]);
  assert.deepEqual(exitDraftErrors({ tp: [{ movePct: 50, sharePct: 60 }, { movePct: 100, sharePct: 60 }], sl: null, trail: null }), ["TP_SHARES_OVER"]);
  assert.deepEqual(exitDraftErrors({ tp: [], sl: { movePct: 100 }, trail: null }), ["SL_MOVE"], "a stop at −100 % never fires");
  assert.deepEqual(exitDraftErrors({ tp: [], sl: null, trail: { movePct: 95 } }), ["TRAIL_MOVE"]);
  assert.deepEqual(exitDraftErrors({ tp: [{ movePct: 1.5, sharePct: 50 }], sl: null, trail: null }), ["TP_MOVE"], "whole per cents only");
  assert.deepEqual(exitDraftErrors({ tp: [1, 2, 3, 4].map((n) => ({ movePct: n * 10, sharePct: 10 })), sl: null, trail: null }), ["TP_COUNT"]);
});

test("a typed per cent is whole and positive", () => {
  assert.equal(typedPct("50"), 50);
  assert.equal(typedPct(" 50 % "), 50);
  assert.equal(typedPct("+100"), 100);
  assert.equal(typedPct("50.5"), null);
  assert.equal(typedPct("-5"), null);
  assert.equal(typedPct(""), null);
});

test("nothing is set without a holding or on a price older than a minute", () => {
  const base = { id: "p", owner: OWNER, mint: MINT, symbol: "MEME", decimals: 6, entrySource: "Jupiter", draft: EXIT_PRESETS.halfAtDouble };
  assert.deepEqual(armExitPlan({ ...base, holdingRaw: 0n, entryUsd: 1, entryAt: T0, now: T0 }), { ok: false, code: "NO_HOLDING" });
  assert.deepEqual(armExitPlan({ ...base, holdingRaw: 5n, entryUsd: null, entryAt: T0, now: T0 }), { ok: false, code: "NO_PRICE" });
  assert.deepEqual(armExitPlan({ ...base, holdingRaw: 5n, entryUsd: 1, entryAt: T0, now: T0 + EXIT_PRICE_MAX_AGE_MS + 1 }), { ok: false, code: "STALE_PRICE" });
  assert.deepEqual(armExitPlan({ ...base, holdingRaw: 5n, entryUsd: 1, entryAt: T0, now: T0, draft: { tp: [], sl: null, trail: null } }), { ok: false, code: "DRAFT" });
});

test("levels are measured from the entry; the trailing one from the highest price seen", () => {
  const plan = arm();
  assert.equal(plan.legs.map((leg) => leg.id).join(","), "tp1,sl,trail");
  assert.ok(Math.abs(levelUsd(plan, plan.legs[0]) - 0.002) < 1e-12, "+100 % doubles");
  assert.ok(Math.abs(levelUsd(plan, plan.legs[1]) - 0.0007) < 1e-12, "−30 %");
  assert.ok(Math.abs(levelUsd({ ...plan, peakUsd: 0.004 }, plan.legs[2]) - 0.003) < 1e-12, "25 % under the peak");
});

test("a stale or missing price moves nothing — not a level, not the peak", () => {
  const plan = arm();
  const stale = observeExitPlan(plan, 0.0001, T0, T0 + EXIT_PRICE_MAX_AGE_MS + 1);
  assert.equal(stale.stale, true);
  assert.equal(stale.plan, plan);
  assert.equal(observeExitPlan(plan, null, T0, T0).stale, true);
  assert.equal(observeExitPlan(plan, 0.002, null, T0).stale, true);
});

test("a level reached turns ready and waits for the person — it never sells by itself", () => {
  let plan = arm();
  let seen = observeExitPlan(plan, 0.0015, T0 + 2_000, T0 + 2_000);
  assert.deepEqual(seen.reached, []);
  assert.equal(seen.plan.peakUsd, 0.0015, "the peak follows a fresh rise");
  seen = observeExitPlan(seen.plan, 0.0021, T0 + 3_000, T0 + 3_000);
  assert.deepEqual(seen.reached, ["tp1"]);
  plan = seen.plan;
  assert.equal(plan.legs[0].state, "ready");
  assert.equal(plan.legs[0].reachedUsd, 0.0021);
  assert.equal(nextReadyLeg(plan)?.id, "tp1");
  /* The same price again reaches nothing new: a ready level stays ready, it is not reached twice. */
  assert.deepEqual(observeExitPlan(plan, 0.0021, T0 + 4_000, T0 + 4_000).reached, []);
});

test("a level reached earlier is asked again at its sale: a price back on the other side is not a take profit or a stop", () => {
  let plan = observeExitPlan(arm(), 0.0021, T0 + 3_000, T0 + 3_000).plan;
  const [tp, sl, trail] = plan.legs;
  assert.equal(tp.state, "ready");
  assert.equal(levelPastNow(plan, tp, 0.0021, T0 + 4_000, T0 + 4_000), true, "still above the take profit");
  assert.equal(levelPastNow(plan, tp, 0.002, T0 + 4_000, T0 + 4_000), true, "at the trigger counts");
  assert.equal(levelPastNow(plan, tp, 0.0018, T0 + 5_000, T0 + 5_000), false, "back below the take profit");
  /* The level stays ready — the person may still sell — but the Review no longer calls it a take profit. */
  plan = observeExitPlan(plan, 0.0018, T0 + 5_000, T0 + 5_000).plan;
  assert.equal(plan.legs[0].state, "ready");
  assert.equal(levelPastNow(plan, sl, 0.0006, T0 + 6_000, T0 + 6_000), true, "below the stop");
  assert.equal(levelPastNow(plan, sl, 0.0009, T0 + 6_000, T0 + 6_000), false, "back above the stop");
  assert.equal(levelPastNow({ ...plan, peakUsd: 0.004 }, trail, 0.0031, T0 + 6_000, T0 + 6_000), false, "above the trailing level");
  assert.equal(levelPastNow({ ...plan, peakUsd: 0.004 }, trail, 0.0029, T0 + 6_000, T0 + 6_000), true, "under the trailing level");
  /* No fresh price — nothing is said either way. */
  assert.equal(levelPastNow(plan, tp, 0.0018, T0, T0 + EXIT_PRICE_MAX_AGE_MS + 1), null);
  assert.equal(levelPastNow(plan, tp, null, T0, T0), null);
  assert.equal(levelPastNow(plan, tp, 0.0018, null, T0), null);
});

test("the trailing stop follows the peak and is reached on the fall from it", () => {
  let plan = arm({ tp: [], sl: null, trail: { movePct: 25 } });
  plan = observeExitPlan(plan, 0.004, T0 + 2_000, T0 + 2_000).plan;
  assert.equal(plan.peakUsd, 0.004);
  assert.deepEqual(observeExitPlan(plan, 0.0031, T0 + 3_000, T0 + 3_000).reached, []);
  const fall = observeExitPlan(plan, 0.0029, T0 + 4_000, T0 + 4_000);
  assert.deepEqual(fall.reached, ["trail"]);
  assert.equal(fall.plan.peakUsd, 0.004, "a fall never lowers the peak");
});

test("a stop is offered before a take profit; lower take profits first", () => {
  let plan = arm(EXIT_PRESETS.ladder);
  plan = { ...plan, legs: plan.legs.map((leg) => ({ ...leg, state: "ready" })) };
  assert.equal(nextReadyLeg(plan)?.id, "sl");
  plan = { ...plan, legs: plan.legs.map((leg) => (leg.kind === "tp" ? leg : { ...leg, state: "armed" })) };
  assert.equal(nextReadyLeg(plan)?.id, "tp1");
});

test("a sale is never more than the level's share, what is left, or what the wallet holds", () => {
  const plan = arm(EXIT_PRESETS.halfAtDouble);
  const tp = plan.legs[0];
  assert.deepEqual(legSale(plan, tp, 2_000_000_000n), { raw: 500_000_000n, planned: 500_000_000n, cappedByWallet: false }, "half of what the plan covers, not half of the wallet");
  assert.deepEqual(legSale(plan, tp, 300_000_000n), { raw: 300_000_000n, planned: 500_000_000n, cappedByWallet: true });
  const sl = plan.legs[1];
  assert.deepEqual(legSale(plan, sl, 5_000_000_000n), { raw: 1_000_000_000n, planned: 1_000_000_000n, cappedByWallet: false }, "a stop sells what is left of the plan, never the rest of the wallet");
  assert.equal(legSale(plan, sl, 0n), null);
  assert.equal(legSale(plan, sl, null), null, "a wallet not read sells nothing");
  const sold = { ...plan, soldRaw: plan.sizeRaw };
  assert.equal(legSale(sold, sl, 5n), null);
});

test("the last take profit of a ladder that sells it all leaves no dust", () => {
  const plan = arm({ tp: [{ movePct: 50, sharePct: 50 }, { movePct: 100, sharePct: 50 }], sl: null, trail: null }, { holdingRaw: 101n });
  assert.equal(legSale(plan, plan.legs[0], 101n).raw, 50n);
  const after = { ...plan, soldRaw: "50" };
  assert.equal(legSale(after, after.legs[1], 101n).raw, 51n);
});

test("a sent sale is neither sold nor offered again until the chain answers", () => {
  let plan = observeExitPlan(arm(), 0.0021, T0 + 3_000, T0 + 3_000).plan;
  plan = sent(plan, "tp1", "SIG1");
  assert.equal(plan.legs[0].state, "sent");
  assert.equal(plan.legs[0].signature, "SIG1");
  assert.equal(plan.legs[0].requestId, "req-SIG1");
  assert.equal(legSentWith(plan, "SIG1")?.id, "tp1");
  assert.equal(sent(plan, "tp1", "SIG2"), plan, "a sent level is never tied to a second signature");
  assert.equal(nextReadyLeg(plan), null, "nothing else is offered while a sale is on its way");
  assert.equal(planOpen(plan), true);
  assert.equal(remainingRaw(plan), 1_000_000_000n, "a sent sale is not counted as sold");
  /* An answer for another transaction changes nothing. */
  assert.equal(settleLeg(plan, "OTHER", { kind: "sold", soldRaw: 1n }), plan);
});

test("a signed sale that never left makes the level ready again, not missed", () => {
  let plan = sent(observeExitPlan(arm(), 0.0021, T0 + 3_000, T0 + 3_000).plan, "tp1", "SIG1");
  assert.equal(unsendLeg(plan, "OTHER"), plan);
  plan = unsendLeg(plan, "SIG1");
  assert.equal(plan.legs[0].state, "ready");
  assert.equal(plan.legs[0].signature, null);
  assert.equal(plan.legs[0].missed, false);
  assert.equal(nextReadyLeg(plan)?.id, "tp1");
});

test("not sold — the level is ready again and says the last sale did not happen", () => {
  let plan = sent(observeExitPlan(arm(), 0.0021, T0 + 3_000, T0 + 3_000).plan, "tp1", "SIG1");
  plan = settleLeg(plan, "SIG1", { kind: "notSold" });
  assert.equal(plan.legs[0].state, "ready");
  assert.equal(plan.legs[0].missed, true);
  assert.equal(plan.legs[0].signature, null);
  assert.equal(plan.soldRaw, "0");
});

test("sold — the units count against the plan; with nothing left every open level closes", () => {
  let plan = sent(observeExitPlan(arm(), 0.0021, T0 + 3_000, T0 + 3_000).plan, "tp1", "SIG1");
  plan = settleLeg(plan, "SIG1", { kind: "sold", soldRaw: 500_000_000n });
  assert.equal(plan.legs[0].state, "sold");
  assert.equal(plan.soldRaw, "500000000");
  assert.equal(remainingRaw(plan), 500_000_000n);
  assert.equal(plan.legs[1].state, "armed", "the stop still guards the rest");
  plan = observeExitPlan(plan, 0.0006, T0 + 5_000, T0 + 5_000).plan;
  assert.equal(nextReadyLeg(plan)?.id, "sl");
  assert.equal(legSale(plan, plan.legs[1], 900_000_000n).raw, 500_000_000n);
  plan = settleLeg(sent(plan, "sl", "SIG2"), "SIG2", { kind: "sold", soldRaw: 500_000_000n });
  assert.equal(remainingRaw(plan), 0n);
  assert.equal(plan.legs.find((leg) => leg.id === "trail").state, "closed");
  assert.equal(planOpen(plan), false);
});

test("turning a plan off cancels what has done nothing and keeps a sent sale in view", () => {
  let plan = observeExitPlan(arm(), 0.0021, T0 + 3_000, T0 + 3_000).plan;
  plan = sent(plan, "tp1", "SIG1");
  plan = cancelExitPlan(plan, T0 + 9_000);
  assert.deepEqual(plan.legs.map((leg) => leg.state), ["sent", "cancelled", "cancelled"]);
  assert.equal(planOpen(plan), true, "the sent sale still waits for its answer");
  assert.equal(nextReadyLeg(plan), null);
  const notSold = settleLeg(plan, "SIG1", { kind: "notSold" });
  assert.equal(notSold.legs[0].state, "cancelled", "a turned-off plan never offers the sale again");
  assert.equal(planOpen(notSold), false);
  /* A turned-off plan watches nothing. */
  assert.deepEqual(observeExitPlan(cancelExitPlan(arm(), T0), 0.01, T0 + 2_000, T0 + 2_000).reached, []);
});

test("an answer that names no amount counts what the sale was signed for", () => {
  let plan = sent(observeExitPlan(arm(), 0.0021, T0 + 3_000, T0 + 3_000).plan, "tp1", "SIG1", 500_000_000n);
  plan = settleLeg(plan, "SIG1", { kind: "sold", soldRaw: null });
  assert.equal(plan.legs[0].soldRaw, "500000000");
  assert.equal(remainingRaw(plan), 500_000_000n);
});

test("a level another tab's Review holds is not offered here until its hold runs out", () => {
  let plan = observeExitPlan(arm(), 0.0021, T0 + 3_000, T0 + 3_000).plan;
  plan = claimLeg(plan, "tp1", "A", T0 + 4_000);
  assert.deepEqual(readyLegs(plan, "A", T0 + 5_000).map((leg) => leg.id), ["tp1"], "the holding tab still offers it");
  assert.deepEqual(readyLegs(plan, "B", T0 + 5_000), [], "another tab does not");
  assert.equal(claimLeg(plan, "tp1", "B", T0 + 5_000), plan, "nor can it take it");
  const signedByB = markLegSent(plan, "tp1", { signature: "SIGB", requestId: null, sentRaw: 1n, tab: "B", now: T0 + 5_000 });
  assert.equal(signedByB.legs[0].state, "sent", "a signature is a fact, whoever holds the level: it is recorded, and the holder finds it sent");
  assert.deepEqual(readyLegs(signedByB, "A", T0 + 5_000), []);
  assert.deepEqual(readyLegs(plan, "B", T0 + 4_000 + EXIT_CLAIM_MS + 1).map((leg) => leg.id), ["tp1"], "once the hold runs out");
  assert.equal(sent(plan, "tp1", "SIGA").legs[0].claim, null, "a signature ends the hold");
});

test("a read older than the highest price counted moves nothing", () => {
  let plan = arm({ tp: [], sl: null, trail: { movePct: 25 } });
  plan = observeExitPlan(plan, 0.004, T0 + 9_000, T0 + 9_000).plan;
  const late = observeExitPlan(plan, 0.0001, T0 + 5_000, T0 + 9_500);
  assert.equal(late.stale, true);
  assert.deepEqual(late.reached, []);
});

test("plans are stored key by key and read back whole", () => {
  const device = store();
  const plan = arm();
  device.apply(exitPlanWrites([], [plan]));
  assert.deepEqual(device.read(), [plan]);
  assert.deepEqual([...device.entries.keys()], ["ryntra.exit.v1:plan:p1"], "an untouched level and peak write nothing");
  device.entries.set("ryntra.exit.v1:plan:bad", "{");
  device.entries.set(legKey("p1", "tp1"), JSON.stringify({ state: "sent", signature: null }));
  assert.equal(device.read()[0].legs[0].state, "armed", "a sent level without its transaction is not ours: read as armed");
  assert.equal(device.read().length, 1, "an unreadable plan is not half read");
});

test("one tab's peak never writes over another tab's level", () => {
  const device = store();
  const plan = observeExitPlan(arm(), 0.0021, T0 + 3_000, T0 + 3_000).plan;
  device.apply(exitPlanWrites([], [plan]));
  /* Tab A ties its signature to the take profit; tab B, reading before A wrote, moves only the peak. */
  const seenByB = device.read()[0];
  const fromA = sent(device.read()[0], "tp1", "SIG1");
  device.apply(exitPlanWrites([plan], [fromA]));
  const fromB = observeExitPlan(seenByB, 0.003, T0 + 20_000, T0 + 20_000).plan;
  const writesB = exitPlanWrites([seenByB], [fromB]);
  assert.ok(writesB.every(([key]) => !key.includes(":leg:p1:tp1")), "B writes no level it did not move");
  device.apply(writesB);
  const now = device.read()[0];
  assert.equal(now.legs[0].state, "sent");
  assert.equal(now.peakUsd, 0.003);
});

test("the sold amount is the sum of the levels' sales, never a counter of its own", () => {
  const device = store();
  let plan = observeExitPlan(arm(), 0.0021, T0 + 3_000, T0 + 3_000).plan;
  device.apply(exitPlanWrites([], [plan]));
  const next = settleLeg(sent(plan, "tp1", "SIG1"), "SIG1", { kind: "sold", soldRaw: 400_000_000n });
  device.apply(exitPlanWrites([plan], [next]));
  plan = device.read()[0];
  assert.equal(plan.soldRaw, "400000000");
});

test("plans are each wallet's own", () => {
  const plan = arm();
  assert.equal(openPlanFor([plan], OWNER, MINT), plan);
  assert.equal(openPlanFor([plan], "Another111111111111111111111111111111111111", MINT), null);
  assert.equal(openPlanFor([cancelExitPlan(plan, T0)], OWNER, MINT), null);
  assert.equal(latestPlanFor([cancelExitPlan(plan, T0)], OWNER, MINT)?.id, "p1");
});

test("a device keeps every open plan and the latest finished ones; the rest are removed key by key", () => {
  const closed = Array.from({ length: 30 }, (_, index) => cancelExitPlan({ ...arm(), id: `c${index}`, armedAt: T0 + index }, T0));
  const open = arm();
  const device = store();
  device.apply(exitPlanWrites([], [...closed, open]));
  const kept = device.read();
  assert.equal(kept.length, 21);
  assert.ok(kept.some((plan) => plan.id === "p1"));
  assert.ok(kept.some((plan) => plan.id === "c29") && !kept.some((plan) => plan.id === "c0"), "newest finished kept");
});
