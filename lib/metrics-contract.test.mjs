// Run from repo root: node --test --test-isolation=none lib/metrics-contract.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toDescriptiveMetrics } from "./metrics-response.mjs";

const route = readFileSync(new URL("../app/api/metrics/route.ts", import.meta.url), "utf8");
const adminRoute = readFileSync(new URL("../app/api/admin/route.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/admin/panel.tsx", import.meta.url), "utf8");

test("descriptive sanitizer executes fail-closed and strips canceled thresholds", () => {
  const sanitized = toDescriptiveMetrics({ users_total: 0, thresholds: { users: 50 }, ok: false });
  assert.deepEqual(sanitized, { users_total: 0, ok: false });
  assert.equal(Object.hasOwn(sanitized, "thresholds"), false);
  for (const invalid of [null, undefined, 0, "metrics", []]) {
    assert.equal(toDescriptiveMetrics(invalid), null);
  }
  const response = { ...sanitized, ok: true };
  assert.equal(response.ok, true, "route-owned success must override any upstream ok field");
});

test("metrics API authenticates before RPC and returns descriptive data only", () => {
  assert.ok(route.indexOf("decideBearerAuth") < route.indexOf("await metrics()"));
  assert.ok(route.includes('decision === "legacy-rejected"'), "legacy query secrets must stay rejected");
  assert.ok(route.includes("toDescriptiveMetrics(await metrics())"));
  assert.ok(route.includes('{ status: 503 }'));
  assert.ok(route.includes("{ ...descriptiveMetrics, ok: true }"));
});

test("admin GET and panel keep missing metrics unavailable instead of inventing zeroes", () => {
  assert.ok(adminRoute.includes("toDescriptiveMetrics(m)"));
  assert.match(adminRoute, /if \(!descriptiveMetrics \|\| !users \|\| !extra\)[\s\S]*?status: 503/);
  assert.ok((panel.match(/setMetrics\(null\)/g) ?? []).length >= 2);
  assert.doesNotMatch(panel, /\?\?\s*0\b/);
});

test("metrics API cannot recreate the canceled validation gate", () => {
  for (const source of [route, adminRoute, panel]) {
    assert.doesNotMatch(source, /14-day validation gate/i);
    assert.doesNotMatch(source, /thresholds\s*:/);
    assert.doesNotMatch(source, /target:\s*(?:50|20)\b/);
    assert.doesNotMatch(source, /21\.07|2026-07-21/);
  }
});
