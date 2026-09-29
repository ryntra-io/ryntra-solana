import assert from "node:assert/strict";
import test from "node:test";

import { inQuietHours, nextQuietEndMs } from "./quiet-hours.ts";

const hours = { start: "22:00", end: "07:00", timezone: "Europe/Kyiv" };

test("overnight quiet hours hold inside the window and release outside it", () => {
  const evening = Date.parse("2026-09-18T20:30:00.000Z"); // 23:30 Kyiv in late September (UTC+3)
  const morning = Date.parse("2026-09-18T03:00:00.000Z"); // 06:00 Kyiv
  const midday = Date.parse("2026-09-18T10:00:00.000Z"); // 13:00 Kyiv
  assert.equal(inQuietHours(evening, hours), true);
  assert.equal(inQuietHours(morning, hours), true);
  assert.equal(inQuietHours(midday, hours), false);
});

test("missing or identical bounds are not quiet hours", () => {
  assert.equal(inQuietHours(Date.now(), null), false);
  assert.equal(inQuietHours(Date.now(), { start: "09:00", end: "09:00", timezone: "UTC" }), false);
});

test("the quiet window names when it ends", () => {
  const evening = Date.parse("2026-09-18T20:30:00.000Z");
  const end = nextQuietEndMs(evening, hours);
  assert.ok(end !== null && end > evening);
  assert.equal(nextQuietEndMs(Date.parse("2026-09-18T10:00:00.000Z"), hours), null);
});
