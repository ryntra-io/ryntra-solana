import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { boardSummary, isStale, providerStatus, timedProbe, unconfigured, PROVIDER_IDS, PROVIDER_CAPABILITY } from "./operations.ts";

const at = new Date("2026-09-05T12:00:00.000Z");

test("a probe that misses its deadline is UNAVAILABLE with reason timeout, never healthy", async () => {
  const result = await timedProbe(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true, latencyMs: 5 }), 80)), 20);
  assert.equal(result.ok, false);
  assert.equal(result.state, "UNAVAILABLE");
  assert.equal(result.reason, "timeout");
  const status = providerStatus("jupiter", result, at);
  assert.equal(status.state, "UNAVAILABLE");
  assert.equal(status.checkedAt, at.toISOString());
});

test("a probe that throws is UNAVAILABLE and one that answers keeps its state and latency", async () => {
  const thrown = await timedProbe(() => Promise.reject(new Error("boom")), 50);
  assert.equal(thrown.ok, false);
  assert.equal(thrown.reason, "probe_threw");
  const degraded = await timedProbe(async () => ({ ok: true, latencyMs: 12, state: "DEGRADED", reason: "fallback_served", detail: "fallback" }), 50);
  assert.equal(providerStatus("solana_rpc", degraded, at).state, "DEGRADED");
  assert.equal(providerStatus("solana_rpc", degraded, at).latencyMs, 12);
  const unknown = await timedProbe(async () => ({ ok: false, latencyMs: 30, state: "UNKNOWN", reason: "malformed" }), 50);
  assert.equal(providerStatus("jupiter", unknown, at).state, "UNKNOWN", "HTTP 200 with a malformed body is not healthy");
});

test("missing credentials are UNCONFIGURED, and the board summary reports the worst row", () => {
  const board = [
    providerStatus("database", { ok: true, latencyMs: 40 }, at),
    providerStatus("ga4", unconfigured("no creds"), at),
    providerStatus("telegram_bot", { ok: true, latencyMs: 90, state: "DEGRADED", reason: "recent_webhook_error" }, at),
    providerStatus("circle_iris", { ok: false, latencyMs: 400, state: "UNAVAILABLE", reason: "unreachable_from_environment" }, at),
  ];
  const summary = boardSummary(board);
  assert.equal(summary.worst, "UNAVAILABLE");
  assert.deepEqual(summary.attention.map((row) => row.id), ["telegram_bot", "circle_iris"]);
  assert.deepEqual(summary.counts, { HEALTHY: 1, DEGRADED: 1, UNAVAILABLE: 1, UNKNOWN: 0, UNCONFIGURED: 1 });
  assert.equal(boardSummary([board[0]]).worst, "HEALTHY");
  assert.equal(boardSummary([]).worst, "HEALTHY");
});

test("every provider names the one capability it checks, and a stale check is stale", () => {
  for (const id of PROVIDER_IDS) assert.ok(PROVIDER_CAPABILITY[id].length > 8, id);
  assert.equal(isStale(null, at), true);
  assert.equal(isStale("2026-09-05T11:54:00.000Z", at), true);
  assert.equal(isStale("2026-09-05T11:58:00.000Z", at), false);
});

test("the operations route never renders a token and never treats one 200 as the whole provider", () => {
  const route = readFileSync(new URL("../../app/api/admin/operations/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /facts: \{[^}]*token/i);
  assert.match(route, /timedProbe\(run, PROBE_MS\)/);
  assert.match(route, /state: "UNKNOWN", reason: "malformed"/, "a 200 without the fact is UNKNOWN");
  assert.match(route, /Promise\.all\(probes\.map/, "probes run independently");
  assert.match(route, /migration_not_applied/);
});
