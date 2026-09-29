// Run from repo root: node --test lib/health.test.mjs
// Plain .mjs so tsc ignores it; Node 24 strips types from the .ts import natively.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let healthModule = {};
try {
  healthModule = await import("./health.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const createHealthHandler = healthModule.createHealthHandler;
const fixedNow = "2026-07-14T14:35:00.000Z";

function build(options = {}) {
  assert.equal(typeof createHealthHandler, "function", "createHealthHandler must implement the deep-health contract");
  const calls = { db: 0, arcus: 0, telegram: 0 };
  const results = { db: true, arcus: true, telegram: true, ...(options.results ?? {}) };
  const run = (name) => async () => {
    calls[name] += 1;
    const result = results[name];
    if (typeof result === "function") return result();
    if (result instanceof Error) throw result;
    return result;
  };
  const handler = createHealthHandler({
    healthSecret: Object.hasOwn(options, "healthSecret") ? options.healthSecret : "health-only",
    cronSecret: Object.hasOwn(options, "cronSecret") ? options.cronSecret : "cron",
    timeoutMs: options.timeoutMs ?? 25,
    now: () => new Date(fixedNow),
    checks: { db: run("db"), arcus: run("arcus"), telegram: run("telegram") },
  });
  return { handler, calls };
}

function request(authorization, suffix = "") {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("Authorization", authorization);
  return new Request(`https://ryntra.io/api/health${suffix}`, { headers });
}

async function json(response) {
  return JSON.parse(await response.text());
}

function assertNoStore(response) {
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
}

test("authorized health check returns a stable deep marker and no-store response", async () => {
  const { handler, calls } = build();
  const response = await handler(request("Bearer health-only"));
  assert.equal(response.status, 200);
  assertNoStore(response);
  assert.deepEqual(await json(response), {
    status: "ok",
    scope: "deep",
    checks: { db: true, arcus: true, telegram: true },
    ts: fixedNow,
  });
  assert.deepEqual(calls, { db: 1, arcus: 1, telegram: 1 });
});

test("public liveness is no-store and never calls upstream dependencies", async () => {
  const { handler, calls } = build();
  const response = await handler(request(undefined));
  assert.equal(response.status, 200);
  assertNoStore(response);
  assert.deepEqual(await json(response), { status: "ok", scope: "liveness", ts: fixedNow });
  assert.deepEqual(calls, { db: 0, arcus: 0, telegram: 0 });
});

test("wrong, malformed, and legacy credentials fail loudly without upstream calls", async () => {
  const { handler, calls } = build();
  const cases = [
    request("Bearer wrong"),
    request("Bearer "),
    request("Basic health-only"),
    request("Bearer health-only", "?key=legacy"),
  ];
  for (const req of cases) {
    const response = await handler(req);
    assert.equal(response.status, 401);
    assertNoStore(response);
  }
  assert.deepEqual(calls, { db: 0, arcus: 0, telegram: 0 });
});

test("dedicated HEALTH_SECRET overrides CRON_SECRET and fallback is fail-closed", async () => {
  const preferred = build();
  assert.equal((await preferred.handler(request("Bearer cron"))).status, 401);
  assert.equal((await preferred.handler(request("Bearer health-only"))).status, 200);

  const fallback = build({ healthSecret: undefined });
  assert.equal((await fallback.handler(request("Bearer cron"))).status, 200);

  const emptyDedicated = build({ healthSecret: "" });
  assert.equal((await emptyDedicated.handler(request("Bearer cron"))).status, 401);
});

test("Arcus-only failure degrades while DB or Telegram failure returns 503 down", async () => {
  const cases = [
    [{ arcus: false }, 200, "degraded"],
    [{ db: false }, 503, "down"],
    [{ telegram: false }, 503, "down"],
  ];
  for (const [results, status, expected] of cases) {
    const { handler } = build({ results });
    const response = await handler(request("Bearer health-only"));
    assert.equal(response.status, status);
    assertNoStore(response);
    const body = await json(response);
    assert.equal(body.scope, "deep");
    assert.equal(body.status, expected);
    assert.deepEqual(body.checks, {
      db: results.db ?? true,
      arcus: results.arcus ?? true,
      telegram: results.telegram ?? true,
    });
  }
});

test("dependency exceptions and timeouts fail closed", async () => {
  const thrown = build({ results: { db: new Error("db unavailable") } });
  const thrownResponse = await thrown.handler(request("Bearer health-only"));
  assert.equal(thrownResponse.status, 503);
  assert.equal((await json(thrownResponse)).checks.db, false);

  const timedOut = build({
    timeoutMs: 5,
    results: { telegram: () => new Promise(() => {}) },
  });
  const timeoutResponse = await timedOut.handler(request("Bearer health-only"));
  assert.equal(timeoutResponse.status, 503);
  assert.equal((await json(timeoutResponse)).checks.telegram, false);
});

test("Next health route delegates to the tested handler with production dependencies", () => {
  const source = readFileSync(new URL("../app/api/health/route.ts", import.meta.url), "utf8");
  assert.match(source, /createHealthHandler/);
  assert.match(source, /healthSecret:\s*process\.env\.HEALTH_SECRET/);
  assert.match(source, /cronSecret:\s*process\.env\.CRON_SECRET/);
  assert.match(source, /db:\s*dbPing/);
});
