// Run from repo root:
// node --test lib/agent-control/analytics/operations.test.mjs
//
// Statistics and operations analytics. The interesting property is not any
// individual number — it is that two *kinds* of number live here and the module
// refuses to add them together. A measured count ("this warm instance answered
// 412 requests") and a catalogue size ("twelve tools are registered") are both
// integers and mean nothing alike; summing them produces a figure that looks
// authoritative and describes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  COUNTING_BOUNDARIES,
  MixedCountKindsError,
  operationsAnalytics,
  sumCounts,
} from "./operations.ts";
import { createAgentControlObserver } from "../observability.ts";

const source = readFileSync(new URL("./operations.ts", import.meta.url), "utf8");

const NOW = "2026-08-24T12:00:00.000Z";

function observerWith(records) {
  const observer = createAgentControlObserver({ sink: () => {}, nowMs: () => 1_000 });
  for (const record of records) {
    observer.record({
      route: record.route,
      method: "GET",
      status: record.status,
      outcome: record.outcome,
      principal: null,
      durationMs: record.durationMs ?? 10,
    });
  }
  return observer;
}

/* ═══════════════════════════════ the two kinds of number, kept apart by type */

test("every count declares whether it was measured or merely catalogued", () => {
  const analytics = operationsAnalytics({ observer: observerWith([]), asOf: NOW });
  for (const count of [analytics.measured.requests, analytics.measured.refused]) {
    assert.equal(count.kind, "MEASURED", count.what);
    assert.equal(count.boundary, "PER_WARM_INSTANCE");
  }
  for (const count of Object.values(analytics.declared.counts)) {
    assert.equal(count.kind, "DECLARED", count.what);
    assert.equal(count.boundary, "DECLARED_CATALOGUE");
  }
  assert.equal(Object.isFrozen(COUNTING_BOUNDARIES), true);
});

test("GATE-PROVED — summing a measured count with a catalogue size throws", () => {
  const analytics = operationsAnalytics({ observer: observerWith([]), asOf: NOW });
  const measured = analytics.measured.requests;
  const declared = analytics.declared.counts.localTools;
  assert.throws(() => sumCounts([measured, declared]), MixedCountKindsError);
  /* And the legitimate case still works, or the guard would just be a ban. */
  const summed = sumCounts([measured, analytics.measured.refused]);
  assert.equal(summed.kind, "MEASURED");
  assert.equal(summed.value, measured.value + analytics.measured.refused.value);
});

test("GATE-PROVED — kind and boundary are two independent guards, not one", () => {
  /* The first version of this suite only ever summed a MEASURED/PER_WARM_INSTANCE
     count with a DECLARED/DECLARED_CATALOGUE one, which trips both guards at
     once — so deleting the kind check left the suite green and the check was
     untested. The two are not redundant in principle: a durable store-backed
     counter would be MEASURED without being per-instance. Each is proved on its
     own by constructing counts that differ in exactly one field. */
  const sameBoundaryDifferentKind = [
    { kind: "MEASURED", boundary: "PER_WARM_INSTANCE", value: 1, what: "a", source: "x" },
    { kind: "DECLARED", boundary: "PER_WARM_INSTANCE", value: 1, what: "b", source: "x" },
  ];
  assert.throws(() => sumCounts(sameBoundaryDifferentKind), MixedCountKindsError);

  const sameKindDifferentBoundary = [
    { kind: "MEASURED", boundary: "PER_WARM_INSTANCE", value: 1, what: "a", source: "x" },
    { kind: "MEASURED", boundary: "DECLARED_CATALOGUE", value: 1, what: "b", source: "x" },
  ];
  assert.throws(() => sumCounts(sameKindDifferentBoundary), MixedCountKindsError);

  assert.throws(() => sumCounts([]), MixedCountKindsError);
});

test("no field on the snapshot is a total across the two kinds", () => {
  const analytics = operationsAnalytics({
    observer: observerWith([
      { route: "/api/agents/mcp", status: 200, outcome: "OK" },
      { route: "/api/agents/mcp", status: 401, outcome: "CREDENTIAL_REQUIRED" },
    ]),
    asOf: NOW,
  });
  const measuredTotal = analytics.measured.requests.value;
  const declaredTotal = Object.values(analytics.declared.counts).reduce((sum, count) => sum + count.value, 0);
  const flat = JSON.stringify(analytics);
  assert.equal(
    flat.includes(`:${measuredTotal + declaredTotal}`),
    false,
    "a value equal to measured + declared appears somewhere on the snapshot",
  );
});

/* ══════════════════════════════════════════ the counting boundary is a field */

test("the counting boundary is carried on the snapshot, not left to a footnote", () => {
  const analytics = operationsAnalytics({ observer: observerWith([]), asOf: NOW });
  assert.equal(analytics.measured.boundary, "PER_WARM_INSTANCE");
  assert.match(analytics.measured.caveat, /instance/i);
  assert.match(analytics.measured.caveat, /fleet|total/i);
  assert.equal(typeof analytics.measured.observedFromMs, "number");
});

test("a cold instance reports its own age rather than an authoritative zero", () => {
  /* "0 requests" from an instance that started a second ago and "0 requests"
     over a week are the same integer and different facts. */
  const analytics = operationsAnalytics({ observer: observerWith([]), asOf: NOW });
  assert.equal(analytics.measured.requests.value, 0);
  assert.equal(analytics.measured.refusalRate, null, "no traffic means no rate, not zero percent");
  assert.equal(analytics.measured.hasTraffic, false);
});

/* ═══════════════════════════════════════════════════ what it actually counts */

test("refusals are broken down by their own code, ordered by frequency", () => {
  const analytics = operationsAnalytics({
    observer: observerWith([
      { route: "/api/agents/mcp", status: 200, outcome: "OK" },
      { route: "/api/agents/mcp", status: 401, outcome: "CREDENTIAL_REQUIRED" },
      { route: "/api/agents/mcp", status: 401, outcome: "CREDENTIAL_REQUIRED" },
      { route: "/api/agents/metrics", status: 429, outcome: "QUOTA_EXCEEDED" },
    ]),
    asOf: NOW,
  });
  assert.equal(analytics.measured.requests.value, 4);
  assert.equal(analytics.measured.refused.value, 3);
  assert.equal(analytics.measured.hasTraffic, true);
  assert.equal(analytics.measured.refusalRate, "75%");
  assert.deepEqual(
    analytics.refusals.map((row) => [row.code, row.count.value]),
    [["CREDENTIAL_REQUIRED", 2], ["QUOTA_EXCEEDED", 1]],
  );
  for (const row of analytics.refusals) assert.equal(row.count.kind, "MEASURED");
});

test("`OK` is never reported as a refusal", () => {
  const analytics = operationsAnalytics({
    observer: observerWith([{ route: "/api/agents/mcp", status: 200, outcome: "OK" }]),
    asOf: NOW,
  });
  assert.deepEqual(analytics.refusals, []);
  assert.equal(analytics.measured.refused.value, 0);
  assert.equal(analytics.measured.refusalRate, "0%");
});

test("routes carry their own requests, mean duration and status classes", () => {
  const analytics = operationsAnalytics({
    observer: observerWith([
      { route: "/api/agents/mcp", status: 200, outcome: "OK", durationMs: 10 },
      { route: "/api/agents/mcp", status: 200, outcome: "OK", durationMs: 30 },
      { route: "/api/agents/metrics", status: 401, outcome: "CREDENTIAL_REQUIRED", durationMs: 5 },
    ]),
    asOf: NOW,
  });
  const mcp = analytics.routes.find((row) => row.route === "/api/agents/mcp");
  assert.equal(mcp.requests.value, 2);
  assert.equal(mcp.meanDurationMs, 20);
  assert.deepEqual(mcp.byStatusClass, { "2xx": 2 });
  assert.equal(mcp.refused.value, 0);
  const metrics = analytics.routes.find((row) => row.route === "/api/agents/metrics");
  assert.equal(metrics.refused.value, 1);
});

test("the declared catalogue is read from the real modules, not written down", () => {
  const analytics = operationsAnalytics({ observer: observerWith([]), asOf: NOW });
  const counts = analytics.declared.counts;
  assert.ok(counts.adapters.value >= 4, "four adapters are registered through the manifest");
  assert.ok(counts.localTools.value >= 12, "twelve local MCP tools exist");
  assert.ok(counts.hostedTools.value >= 1);
  assert.ok(counts.hostedTools.value < counts.localTools.value, "the hosted endpoint serves a strict subset");
  assert.ok(counts.writeTools.value >= 5);
  assert.equal(counts.scopes.value, 3);
  for (const count of Object.values(counts)) {
    assert.ok(count.source.length > 10, count.what + " must name where its number came from");
  }
});

test("a truncated snapshot says it was truncated rather than reading as complete", () => {
  const observer = createAgentControlObserver({ sink: () => {}, nowMs: () => 1_000 });
  for (let index = 0; index < 80; index += 1) {
    observer.record({
      route: `/api/agents/route-${index}`,
      method: "GET",
      status: 200,
      outcome: "OK",
      principal: null,
      durationMs: 1,
    });
  }
  const analytics = operationsAnalytics({ observer, asOf: NOW });
  assert.equal(analytics.measured.truncated, true);
  assert.match(analytics.measured.caveat, /truncat/i);
});

/* ════════════════════════════════════════════════ the module claims nothing */

test("the module states no maturity, no availability figure and no health verdict", () => {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const word of ['"healthy"', '"degraded"', '"uptime"', '"sla"', '"live"']) {
    assert.equal(stripped.toLowerCase().includes(word), false, "analytics must not carry " + word);
  }
});
