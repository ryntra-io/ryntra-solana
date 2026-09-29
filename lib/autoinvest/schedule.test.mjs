// Run from repo root: node --test lib/autoinvest/schedule.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { isReadableSchedule, isTimeZone, latestDueAtOrBefore, nextDueAfter, reminderOpenUntil, wallClockAt, zonedInstant } from "./schedule.ts";

const iso = (ms) => new Date(ms).toISOString();
const weekly = (weekday, time, timeZone = "Europe/Kyiv") => ({ cadence: "weekly", weekday, monthDay: null, time, timeZone });

test("a weekly rule in Kyiv falls on the wall clock: 19:00 on Thursday is 16:00 UTC in summer and 17:00 UTC after the clocks go back", () => {
  const rule = weekly(4, "19:00");
  /* Thursday 24 September 2026, 00:29 in Kyiv. */
  const now = Date.parse("2026-09-23T21:29:00.000Z");
  assert.equal(iso(nextDueAfter(rule, now)), "2026-09-24T16:00:00.000Z");
  /* Kyiv leaves summer time on Sunday 25 October 2026. */
  assert.equal(iso(nextDueAfter(rule, Date.parse("2026-10-22T16:00:00.000Z"))), "2026-10-29T17:00:00.000Z");
  assert.equal(iso(nextDueAfter(rule, Date.parse("2026-10-22T15:59:00.000Z"))), "2026-10-22T16:00:00.000Z");
});

test("the next due is strictly after the instant, the latest due is at or before it", () => {
  const rule = weekly(4, "19:00");
  const due = Date.parse("2026-09-24T16:00:00.000Z");
  assert.equal(iso(nextDueAfter(rule, due)), "2026-10-01T16:00:00.000Z", "a due instant is never its own next");
  assert.equal(iso(latestDueAtOrBefore(rule, due)), "2026-09-24T16:00:00.000Z");
  assert.equal(iso(latestDueAtOrBefore(rule, due - 1)), "2026-09-17T16:00:00.000Z");
  assert.equal(iso(latestDueAtOrBefore(rule, Date.parse("2026-09-30T08:00:00.000Z"))), "2026-09-24T16:00:00.000Z");
});

test("a daily rule reminds every day at its hour, across the spring change of the clocks in New York", () => {
  const rule = { cadence: "daily", weekday: null, monthDay: null, time: "09:30", timeZone: "America/New_York" };
  /* New York moves to summer time on Sunday 8 March 2026. */
  assert.equal(iso(nextDueAfter(rule, Date.parse("2026-03-07T15:00:00.000Z"))), "2026-03-08T13:30:00.000Z");
  assert.equal(iso(nextDueAfter(rule, Date.parse("2026-03-06T15:00:00.000Z"))), "2026-03-07T14:30:00.000Z");
  const due = Date.parse("2026-03-07T14:30:00.000Z");
  assert.equal(iso(reminderOpenUntil(rule, due)), "2026-03-08T13:30:00.000Z", "a daily reminder closes when the next opens — 23 hours across the change");
});

test("a monthly rule on the 31st falls on the last day of a shorter month", () => {
  const rule = { cadence: "monthly", weekday: null, monthDay: 31, time: "10:00", timeZone: "Europe/Kyiv" };
  assert.equal(iso(nextDueAfter(rule, Date.parse("2027-01-31T09:00:00.000Z"))), "2027-02-28T08:00:00.000Z");
  assert.equal(iso(nextDueAfter(rule, Date.parse("2027-02-28T08:00:00.000Z"))), "2027-03-31T07:00:00.000Z", "summer time from the last Sunday of March");
  const first = { ...rule, monthDay: 1 };
  assert.equal(iso(nextDueAfter(first, Date.parse("2026-09-24T12:00:00.000Z"))), "2026-10-01T07:00:00.000Z");
});

test("a weekly reminder stays open a day; a monthly one too", () => {
  const rule = weekly(1, "08:00");
  const due = Date.parse("2026-09-28T05:00:00.000Z");
  assert.equal(iso(reminderOpenUntil(rule, due)), "2026-09-29T05:00:00.000Z");
});

test("the hour the clocks skip is read as the hour after it", () => {
  /* Kyiv skips 03:00–04:00 on Sunday 29 March 2026. */
  const at = zonedInstant(2026, 3, 29, 3, 30, "Europe/Kyiv");
  const wall = wallClockAt(at, "Europe/Kyiv");
  assert.equal(`${wall.hour}:${wall.minute}`, "4:30");
});

test("the wall clock names its weekday the ISO way", () => {
  const wall = wallClockAt(Date.parse("2026-09-24T16:00:00.000Z"), "Europe/Kyiv");
  assert.deepEqual([wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.weekday], [2026, 9, 24, 19, 0, 4]);
  assert.equal(wallClockAt(Date.parse("2026-09-27T12:00:00.000Z"), "Europe/Kyiv").weekday, 7, "Sunday is 7");
});

test("a time zone is an IANA name this runtime knows; a schedule is readable only whole", () => {
  assert.equal(isTimeZone("Europe/Kyiv"), true);
  assert.equal(isTimeZone("America/New_York"), true);
  assert.equal(isTimeZone("Mars/Olympus"), false);
  assert.equal(isTimeZone(""), false);
  assert.equal(isTimeZone(42), false);
  assert.equal(isReadableSchedule(weekly(4, "19:00")), true);
  assert.equal(isReadableSchedule(weekly(null, "19:00")), false, "a weekly rule without its day");
  assert.equal(isReadableSchedule({ cadence: "daily", weekday: 2, monthDay: null, time: "08:00", timeZone: "UTC" }), false, "a daily rule naming a weekday");
  assert.equal(isReadableSchedule({ cadence: "monthly", weekday: null, monthDay: 15, time: "24:00", timeZone: "UTC" }), false, "not a time of day");
});
