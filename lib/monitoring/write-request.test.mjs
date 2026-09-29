import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MonitoringPreferencesSchema, MonitoringWriteRequestSchema } from "../api/v1/contract.ts";
import { PREFERENCES_REFUSAL, QUIET_HOURS_REFUSAL, readMonitoringWrite } from "./write-request.ts";

/*
 * Contract 1.11.0 — `POST /api/monitoring` reads its body against the
 * contract. Every body below was stored as sent (or answered 500) before, and
 * the surface's next read then carried a value its own schema refuses.
 */

test("a read mark is a string `read`, every other key ignored, as before", () => {
  assert.deepEqual(readMonitoringWrite({ read: "inb_0123456789abcdef01234567" }), { kind: "read", id: "inb_0123456789abcdef01234567" });
  assert.deepEqual(readMonitoringWrite({ read: "inb_x", telegram: "yes" }), { kind: "read", id: "inb_x" }, "a read mark is judged as a read mark");
});

test("where notes go keeps each field of its own type, ignores keys it does not read, and keeps only a window's three fields", () => {
  assert.deepEqual(readMonitoringWrite({ telegram: false }), { kind: "preferences", telegram: false });
  assert.deepEqual(readMonitoringWrite({ push: true, quietHours: null }), { kind: "preferences", push: true, quietHours: null });
  assert.deepEqual(readMonitoringWrite({ read: 5, telegram: true, theme: "dark" }), { kind: "preferences", telegram: true }, "a non-string read is ignored, as the route always did");
  const window = readMonitoringWrite({ quietHours: { start: "22:00", end: "07:30", timezone: "Europe/Kyiv", extra: 1 } });
  assert.deepEqual(window, { kind: "preferences", quietHours: { start: "22:00", end: "07:30", timezone: "Europe/Kyiv" } });
  /* What a write stores reads back through the surface's own schema. */
  assert.equal(MonitoringPreferencesSchema.safeParse({ telegram: true, push: true, quietHours: window.quietHours }).success, true);
});

test("the bodies that were stored as sent, or answered 500, are refused with the reason a person can act on", () => {
  for (const body of [{ telegram: "yes" }, { push: 1 }, { telegram: null }, [], "push", 42, null]) {
    assert.deepEqual(readMonitoringWrite(body), { kind: "invalid", message: PREFERENCES_REFUSAL }, JSON.stringify(body));
  }
  for (const quietHours of [false, 0, "", { start: "22:00", end: "07:00" }, { start: ["22:00"], end: "07:00", timezone: "UTC" }, { start: "25:00", end: "07:00", timezone: "UTC" }]) {
    assert.deepEqual(readMonitoringWrite({ quietHours }), { kind: "invalid", message: QUIET_HOURS_REFUSAL }, JSON.stringify(quietHours));
  }
  /* The contract's request union agrees with what the route now accepts. */
  assert.equal(MonitoringWriteRequestSchema.safeParse({ read: "inb_x" }).success, true);
  assert.equal(MonitoringWriteRequestSchema.safeParse({ telegram: "yes" }).success, false);
});

test("the route reads its body through the one reader and keeps its checks", () => {
  const source = readFileSync(new URL("../../app/api/monitoring/route.ts", import.meta.url), "utf8");
  assert.match(source, /const body = readMonitoringWrite\(raw\);/);
  assert.match(source, /if \(body\.kind === "invalid"\) return apiFailure\("VALIDATION_ERROR", body\.message\);/);
  assert.doesNotMatch(source, /as typeof body/, "no cast of the body stands in for its check");
  assert.match(source, /isValidQuietHours\(quietHours\)/, "a well-typed window is still judged as a window (a real timezone)");
});
