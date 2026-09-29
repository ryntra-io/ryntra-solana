// Run from repo root: node --test --test-isolation=none lib/admin-audit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const moduleUrl = new URL("./admin-audit.ts", import.meta.url);
const implementationExists = existsSync(fileURLToPath(moduleUrl));
const audit = implementationExists ? await import(moduleUrl) : null;
const adminRoute = readFileSync(new URL("../app/api/admin/route.ts", import.meta.url), "utf8");

test("admin audit events allowlist actions and redact actor identity", () => {
  assert.ok(audit, "admin audit implementation must exist");
  const event = audit.adminAuditEvent(123456789, "broadcast", "attempt", "unit-test-secret");
  assert.deepEqual(Object.keys(event).sort(), ["action", "actor", "at", "outcome"]);
  assert.equal(event.action, "broadcast");
  assert.equal(event.outcome, "attempt");
  assert.match(event.actor, /^[0-9a-f]{24}$/);
  assert.match(event.at, /^\d{4}-\d{2}-\d{2}T/);
  const serialized = JSON.stringify(event);
  assert.ok(!serialized.includes("123456789"));
  assert.ok(!serialized.includes("unit-test-secret"));
  assert.equal(audit.adminAuditAction("not-real"), null);
});

test("admin audit fails closed without its HMAC secret and logs only the bounded event", () => {
  assert.ok(audit, "admin audit implementation must exist");
  assert.equal(audit.adminAuditEvent(123, "verify_x", "attempt", ""), null);

  const calls = [];
  const original = console.info;
  console.info = (...args) => calls.push(args);
  try {
    assert.equal(audit.auditAdminAction(123, "message_user", "rejected", "unit-test-secret"), true);
  } finally {
    console.info = original;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "admin.audit");
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ["action", "actor", "at", "outcome"]);
});

test("audited admin action records failed outcome when a dependency throws", async () => {
  assert.ok(audit, "admin audit implementation must exist");
  assert.equal(typeof audit.runAuditedAdminAction, "function", "route needs a runtime exception-safe audit wrapper");

  const calls = [];
  const original = console.info;
  console.info = (...args) => calls.push(args);
  let result;
  try {
    result = await audit.runAuditedAdminAction(
      123,
      "run_fill_check",
      async () => { throw new Error("dependency included sensitive detail"); },
      "unit-test-secret"
    );
  } finally {
    console.info = original;
  }

  assert.deepEqual(calls.map((call) => call[1].outcome), ["attempt", "failed"]);
  assert.deepEqual(result, { outcome: "failed", payload: { error: "action failed" }, status: 502 });
  assert.ok(!JSON.stringify(calls).includes("sensitive detail"));
});

test("admin route audits every recognized mutation before any side effect and records outcomes", () => {
  const attemptAt = adminRoute.indexOf("runAuditedAdminAction(admin, action");
  const sideEffects = [
    /* adminVerify was the manual X-follow verification; RYN-BETA-001 retired that path
       along with the reward ladder it fed, so there is no side effect left to order. */
    'sendPlainMessage(',
    'rpc<{ telegram_id: number }[]>("admin_broadcast_targets"',
    'fetch(`${base}/api/cron/fills`',
  ].map((needle) => adminRoute.indexOf(needle));

  assert.ok(adminRoute.includes('from "@/lib/admin-audit"'));
  assert.ok(attemptAt > adminRoute.indexOf("req.json()"));
  assert.ok(sideEffects.every((at) => at > attemptAt), "attempt audit must precede every mutation side effect");
  assert.ok(adminRoute.includes("adminAuditAction(body.action)"), "unknown actions must not enter the audit/mutation path");
  assert.ok(adminRoute.includes("await runAuditedAdminAction("), "each action must use the exception-safe runtime audit wrapper");
  assert.match(adminRoute, /error: "audit unavailable".*status: 503/);
});
