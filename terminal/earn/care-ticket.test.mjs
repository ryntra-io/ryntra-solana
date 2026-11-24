// «Your agent looks after it» on a pool's ticket: what the ticket decides from the city's care.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MAX_HALF, MIN_HALF, STYLE_HALF } from "../../city/lib/earn/pier.ts";
import { CARE_STOPS } from "../../city/lib/earn/care.ts";
import { CARE_STOP_PCTS, CARE_WIDTH } from "../../lib/care/service.server.ts";
import { CARE_STOP_IDS, CARE_WIDTH_MAX, CARE_WIDTH_MIN, careBlock, careDaySol, caredHere, careStopOf, careWidthFits, careWidthOf } from "./care-ticket.ts";
import { EARN } from "./words.ts";

test("the width the agent is given is the ticket's own range — every style fits the engine's bounds", () => {
  for (const half of Object.values(STYLE_HALF)) assert.ok(careWidthFits(careWidthOf(half)), `±${half}`);
  assert.equal(careWidthOf(MAX_HALF), CARE_WIDTH_MAX, "the widest range the ticket draws is the widest the engine takes");
  assert.equal(careWidthFits(careWidthOf(MIN_HALF)), false, "a range narrower than the agent keeps is said, not sent");
  assert.equal(careWidthFits(careWidthOf(3)), true);
  assert.equal(careWidthFits(careWidthOf(2)), false);
  assert.equal(CARE_WIDTH_MIN, 6);
  assert.ok(careWidthFits(CARE_WIDTH), "the engine's own default fits");
});

test("the stops the segment offers are the engine's, and the city's", () => {
  assert.deepEqual(CARE_STOP_IDS.map(careStopOf), [...CARE_STOP_PCTS]);
  assert.deepEqual(CARE_STOP_IDS.map(careStopOf), [...CARE_STOPS]);
});

test("giving to the agent waits for an amount and a range it keeps — the pool's ceiling for a plain deposit is not the care's", () => {
  const ok = { lamports: 5_000_000_000n, problem: null, width: careWidthOf(16) };
  assert.equal(careBlock(ok), null);
  assert.equal(careBlock({ ...ok, lamports: 500_000_000_000n }), null, "no ceiling of Ryntra's on the sum");
  assert.equal(careBlock({ ...ok, problem: "ceiling" }), null, "the plain deposit's ceiling does not hold the care");
  assert.equal(careBlock({ ...ok, problem: "balance" }), "amount");
  assert.equal(careBlock({ ...ok, problem: "format" }), "amount");
  assert.equal(careBlock({ ...ok, lamports: null }), "amount");
  assert.equal(careBlock({ ...ok, lamports: 0n }), "amount");
  assert.equal(careBlock({ ...ok, width: careWidthOf(1) }), "width");
});

test("a care stands on the ticket of its own pool only, and only while it works", () => {
  const day = { claimedInY: 0.004, reinvestedInY: 0.001, rebalances: 0 };
  const cares = [
    { key: "a", pool: "P1", status: "working", inRange: true, day },
    { key: "b", pool: "P2", status: "working", inRange: false, day },
    { key: "c", pool: "P1", status: "stopped", inRange: null, day },
    { key: "d", pool: "P1", status: "signing", inRange: null, day },
  ];
  assert.deepEqual(caredHere(cares, "P1").map((care) => care.key), ["a"]);
  assert.deepEqual(caredHere(null, "P1"), []);
  assert.ok(Math.abs(careDaySol(cares[0]) - 0.005) < 1e-12);
  assert.equal(careDaySol({ day: { claimedInY: 0, reinvestedInY: 0, rebalances: 2 } }), null, "nothing taken — no «+0»");
});

test("a care stopped but not withdrawn stands on its pool's ticket with «Withdraw» until all is back", () => {
  const day = { claimedInY: 0, reinvestedInY: 0, rebalances: 0 };
  const cares = [
    { key: "left", pool: "P1", status: "stopped", inRange: null, day, left: true },
    { key: "back", pool: "P1", status: "stopped", inRange: null, day, left: false },
    { key: "unread", pool: "P1", status: "stopped", inRange: null, day, left: null },
    { key: "elsewhere", pool: "P2", status: "stopped", inRange: null, day, left: true },
    { key: "working", pool: "P1", status: "working", inRange: true, day },
  ];
  assert.deepEqual(caredHere(cares, "P1").map((care) => care.key), ["left", "working"], "its rules or money still on chain: it stays; all back or not read: it goes, as before");
  assert.deepEqual(caredHere(cares, "P2").map((care) => care.key), ["elsewhere"]);
  assert.equal(EARN.en.careLeft, "Stopped — not withdrawn");
  assert.equal(EARN.uk.careLeft, "Зупинено — не забрано");
  assert.equal(EARN.en.careWithdraw, "Withdraw");
  assert.equal(EARN.uk.careWithdraw, "Забрати");
  const source = readFileSync(new URL("./PoolTicket.tsx", import.meta.url), "utf8");
  assert.match(source, /left \? w\.careWithdraw : w\.careTake/u, "«Withdraw» is the same take back");
  assert.match(source, /useCare\.getState\(\)\.takeBack\(connection, key\)/u);
});

test("the care's words: both languages, the same keys, no promise of a result", () => {
  const keys = Object.keys(EARN.en).filter((key) => key.startsWith("care") || key === "caredHere");
  assert.ok(keys.length >= 18);
  for (const key of keys) assert.equal(typeof EARN.uk[key], typeof EARN.en[key], key);
  const all = keys.map((key) => (typeof EARN.en[key] === "function" ? EARN.en[key]("1") + EARN.uk[key]("1") : EARN.en[key] + EARN.uk[key])).join(" ");
  assert.doesNotMatch(all, /guarantee|profit|risk-free|гарант|прибут|без ризику/iu);
});

test("the ticket gives to the agent only by its own action, and only where the care is open", () => {
  const source = readFileSync(new URL("./PoolTicket.tsx", import.meta.url), "utf8");
  assert.match(source, /CARE_MODE !== 'closed' && !copied/u, "offered only where the care's switch is open");
  assert.match(source, /useState\(false\)/u, "off until she turns it on");
  assert.match(source, /useCare\.getState\(\)\.give\(connection, \{ pool: pier\.pool\.address, lamports: choice\.lamports, width: careWidth, shape: GOAL_SHAPE\[goal\] \}\)/u);
  assert.match(source, /if \(caring \|\| !connection/u, "the plain add's figures are not built while the care is on");
});
