import assert from "node:assert/strict";
import test from "node:test";

import { dayBudget, dayCeilingOf } from "./day-budget.ts";

/*
 * A day's ceiling on what one instance spends of a paid source: what does not fit is not spent, and a new UTC day
 * starts from nothing.
 */

const NOON = Date.parse("2026-11-20T12:00:00.000Z");
const BEFORE_MIDNIGHT = Date.parse("2026-11-20T23:59:59.999Z");
const MIDNIGHT = Date.parse("2026-11-21T00:00:00.000Z");

test("what fits under the ceiling is allowed, what does not is refused; spending is counted", () => {
  const day = dayBudget();
  assert.equal(day.allows(40, 100, NOON), true);
  day.spend(70, NOON);
  assert.equal(day.spent(NOON), 70);
  assert.equal(day.allows(30, 100, NOON), true, "exactly up to the ceiling");
  assert.equal(day.allows(31, 100, NOON), false);
  day.spend(-5, NOON);
  day.spend(Number.NaN, NOON);
  assert.equal(day.spent(NOON), 70, "only what was spent is counted");
  assert.equal(day.allows(1, 0, NOON), false, "a ceiling of nought closes the source");
});

test("the day is the calendar day in UTC: at midnight it starts from nothing", () => {
  const day = dayBudget();
  day.spend(100, NOON);
  assert.equal(day.allows(1, 100, BEFORE_MIDNIGHT), false, "the last millisecond of the day is the same day");
  assert.equal(day.allows(1, 100, MIDNIGHT), true);
  assert.equal(day.spent(MIDNIGHT), 0);
  day.spend(5, MIDNIGHT);
  day.reset();
  assert.equal(day.spent(MIDNIGHT), 0);
});

test("a ceiling from a setting: a whole number from nought up, else the default", () => {
  assert.equal(dayCeilingOf(undefined, 20_000), 20_000);
  assert.equal(dayCeilingOf("", 20_000), 20_000);
  assert.equal(dayCeilingOf(" 5000 ", 20_000), 5_000);
  assert.equal(dayCeilingOf("0", 20_000), 0);
  for (const odd of ["-1", "1.5", "1e6", "many", "12345678901"]) assert.equal(dayCeilingOf(odd, 20_000), 20_000, odd);
});
