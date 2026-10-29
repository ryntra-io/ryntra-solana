import assert from "node:assert/strict";
import test from "node:test";

import { EVENING_WINDOW_HOUR_UTC, EVENING_WINDOW_MINUTES, HOURLY_WINDOW_MINUTES, launchedIn, nextWindow, tMinus, windowById, windowClock, windowLabel, windowOfLaunch, windowOpenAt } from "./windows.ts";

const at = (iso) => Date.parse(iso);

test("a small window opens at the top of every hour UTC, the evening one at 20:00 and stays open longer", () => {
  const hourly = windowOpenAt(at("2026-10-25T13:04:00Z"));
  assert.equal(hourly.id, "2026-10-25T13:00Z");
  assert.equal(hourly.kind, "hourly");
  assert.equal(hourly.closesAt - hourly.opensAt, HOURLY_WINDOW_MINUTES * 60_000);
  assert.equal(windowOpenAt(at("2026-10-25T13:10:00Z")), null, "closed at its end");
  const evening = windowOpenAt(at(`2026-10-25T${EVENING_WINDOW_HOUR_UTC}:25:00Z`));
  assert.equal(evening.kind, "evening");
  assert.equal(evening.closesAt - evening.opensAt, EVENING_WINDOW_MINUTES * 60_000);
  assert.equal(windowLabel(evening), "Evening window · 20:00 UTC");
  assert.equal(windowClock(hourly), "13:00 UTC");
});

test("the next window is strictly ahead; the next evening skips the hourly ones", () => {
  assert.equal(nextWindow(at("2026-10-25T13:04:00Z")).id, "2026-10-25T14:00Z");
  assert.equal(nextWindow(at("2026-10-25T13:00:00Z")).id, "2026-10-25T14:00Z", "the one opening now is not next");
  assert.equal(nextWindow(at("2026-10-25T21:30:00Z"), "evening").id, "2026-10-26T20:00Z");
  assert.equal(nextWindow(at("2026-10-25T19:59:59Z")).kind, "evening");
});

test("a launch is in a window only when its creation landed while it was open", () => {
  assert.equal(windowOfLaunch("2026-10-25T20:29:59Z")?.id, "2026-10-25T20:00Z");
  assert.equal(windowOfLaunch("2026-10-25T20:30:00Z"), null);
  assert.equal(windowOfLaunch(null), null);
  assert.equal(windowOfLaunch("not a date"), null);
  const rows = [{ launchedAt: "2026-10-25T09:02:00Z" }, { launchedAt: "2026-10-25T09:40:00Z" }, { launchedAt: null }];
  assert.equal(launchedIn(windowById("2026-10-25T09:00Z"), rows).length, 1);
});

test("a window id is one the schedule has; T-minus never runs below zero", () => {
  assert.equal(windowById("2026-10-25T09:00Z")?.kind, "hourly");
  assert.equal(windowById("2026-10-25T09:30Z"), null);
  assert.equal(windowById("2026-13-25T09:00Z"), null);
  assert.equal(tMinus(4 * 60_000 + 12_000), "T-04:12");
  assert.equal(tMinus(3_729_000), "T-1:02:09");
  assert.equal(tMinus(-5), "T-00:00");
});
