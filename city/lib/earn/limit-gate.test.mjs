import { test } from "node:test";
import assert from "node:assert/strict";

import { admitLimitExit, admitLimitPlace, limitMode, limitStates, withinLimitCeiling } from "./limit-gate.ts";

const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const ENGINE_ON = { add: { status: "on" }, remove: { status: "on" }, maxDepositUsd: null };
const ENGINE_OFF = { add: { status: "later" }, remove: { status: "later" }, maxDepositUsd: null };

test("closed by default and for any value the switch does not know", () => {
  assert.equal(limitMode(undefined), "closed");
  assert.equal(limitMode("yes"), "closed");
  assert.equal(limitMode(" OPEN "), "open");
  assert.deepEqual(admitLimitPlace(OWNER, {}), { ok: false, code: "LIMITS_CLOSED" });
  assert.equal(admitLimitExit(OWNER, {}), false);
});

test("the canary admits one wallet, with no sum of Ryntra's; everyone else is told it is closed", () => {
  const env = { NEXT_PUBLIC_RYNTRA_CITY_EARN_LIMITS: "canary", RYNTRA_CITY_EARN_LIMITS_CANARY_WALLET: OWNER };
  assert.deepEqual(admitLimitPlace(OWNER, env), { ok: true, mode: "canary" });
  assert.deepEqual(admitLimitPlace(OTHER, env), { ok: false, code: "LIMITS_CLOSED" });
  assert.deepEqual(admitLimitPlace(OWNER, { NEXT_PUBLIC_RYNTRA_CITY_EARN_LIMITS: "canary" }), { ok: false, code: "LIMITS_CLOSED" }, "no wallet named, nobody admitted");
  assert.equal(admitLimitExit(OWNER, env), true);
  assert.equal(admitLimitExit(OTHER, env), false);
});

test("the stop halts new orders at once and never holds money in", () => {
  const env = { NEXT_PUBLIC_RYNTRA_CITY_EARN_LIMITS: "open", RYNTRA_CITY_EARN_LIMITS_STOP: "1" };
  assert.deepEqual(admitLimitPlace(OWNER, env), { ok: false, code: "LIMITS_STOPPED" });
  assert.equal(admitLimitExit(OWNER, env), true, "cancelling stays open");
  assert.deepEqual(admitLimitPlace(OWNER, { ...env, RYNTRA_CITY_EARN_LIMITS_STOP: "off" }), { ok: true, mode: "open" });
});

test("the city's word and the engine's together: on only where both say on, no sum of Ryntra's", () => {
  const open = { NEXT_PUBLIC_RYNTRA_CITY_EARN_LIMITS: "open" };
  assert.deepEqual(limitStates(OWNER, open, ENGINE_ON), { place: "on", exit: "on", ceilingUsd: null, stopped: false });
  assert.deepEqual(limitStates(OWNER, open, ENGINE_OFF), { place: "off", exit: "off", ceilingUsd: null, stopped: false });
  assert.equal(limitStates(OWNER, open, { ...ENGINE_ON, maxDepositUsd: 5 }).ceilingUsd, 5);
  assert.deepEqual(limitStates(OWNER, { ...open, RYNTRA_CITY_EARN_LIMITS_STOP: "yes" }, ENGINE_ON), { place: "off", exit: "on", ceilingUsd: null, stopped: true });
  assert.equal(limitStates(OTHER, { NEXT_PUBLIC_RYNTRA_CITY_EARN_LIMITS: "canary", RYNTRA_CITY_EARN_LIMITS_CANARY_WALLET: OWNER }, ENGINE_ON).stopped, false, "the canary is not announced");
});

test("an order without a price is refused rather than guessed", () => {
  assert.equal(withinLimitCeiling(null, 5), false);
  assert.equal(withinLimitCeiling(0, 5), false);
  assert.equal(withinLimitCeiling(4.99, 5), true);
  assert.equal(withinLimitCeiling(5.01, 5), false);
  assert.equal(withinLimitCeiling(Number.NaN, 5), false);
  assert.equal(withinLimitCeiling(1_000_000, null), true, "no sum of Ryntra's");
  assert.equal(withinLimitCeiling(null, null), false, "still priced");
});
