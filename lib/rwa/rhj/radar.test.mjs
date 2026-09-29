import assert from "node:assert/strict";
import test from "node:test";

import { compileResearchMandate } from "../../home/research/mandate.ts";
import { compileMonitorRules } from "../../home/research/monitor-rule.ts";
import { detectMaterialChanges } from "../../home/research/change.ts";
import { RHJ_EVENT_CATALOGUE, RHJ_EVENT_KINDS } from "./events.ts";
import { RHJ_SCOPE_KIND, RHJ_SOURCE_ID, rhjFacts, rhjMateriality, rhjSubjectRef } from "./radar.ts";

const ASOF = "2026-08-23T16:00:00.000Z";

const event = (overrides = {}) => ({
  kind: "MULTIPLIER_CHANGED",
  changeKind: "VALUE_MOVE",
  severity: "CRITICAL",
  subjectRef: rhjSubjectRef("AAPL"),
  subjectLabel: "AAPL",
  summary: "The issuer has scheduled a multiplier change.",
  previous: "1.0",
  current: "4.0",
  measuredBps: null,
  identities: [{ surfaceId: "rhj-assets", instrumentId: "AAPL" }],
  conflict: [],
  dedupeKey: "MULTIPLIER_CHANGED|AAPL|4.0",
  ...overrides,
});

/** The whole path the surface uses: mandate → rules → engine. */
function radar(events) {
  const compiled = compileResearchMandate({
    mandateId: "home",
    ownerRef: "owner-1",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    reviewAt: null,
    expiresAt: null,
    scope: [{ kind: RHJ_SCOPE_KIND, ref: rhjSubjectRef("AAPL"), label: "AAPL" }],
    sources: [
      {
        sourceId: RHJ_SOURCE_ID,
        label: "Robinhood Stock Token API",
        rights: { entitlement: "PROVIDER_PUBLIC", storage: true, aiProcessing: true, alerting: true, redistribution: false },
        freshnessPolicy: { maxAgeSeconds: 120 },
      },
      {
        sourceId: "robinhood-chain-uiMultiplier",
        label: "Robinhood Chain",
        rights: { entitlement: "PROVIDER_PUBLIC", storage: true, aiProcessing: true, alerting: true, redistribution: false },
        freshnessPolicy: { maxAgeSeconds: 120 },
      },
    ],
    freshness: { maxAgeSeconds: 120 },
    materiality: rhjMateriality(),
    cadence: { mode: "SCHEDULE", cron: "0 7 * * *", quietHours: null, cooldownSeconds: 3600 },
    budgets: { dataReadsPerDay: 24, aiCallsPerDay: 0, maxAlertsPerDay: 6 },
    notificationChannels: ["surface"],
  });
  assert.equal(compiled.ok, true, "the RHJ mandate must compile: " + JSON.stringify(compiled));

  const facts = rhjFacts(events, ASOF);
  return detectMaterialChanges({
    rules: compileMonitorRules(compiled.mandate),
    observations: facts.observations,
    baselines: facts.baselines,
    degradedSources: [],
    asOf: ASOF,
  });
}

test("every event kind has a threshold, and the mandate accepts all twelve", function () {
  const materiality = rhjMateriality();
  assert.equal(materiality.length, RHJ_EVENT_KINDS.length);
  for (const threshold of materiality) {
    assert.ok(RHJ_EVENT_KINDS.includes(threshold.factKey), threshold.factKey + " is not an event kind");
    /* A STATE_CHANGE threshold must carry no number; the engine rejects one
       that does, which is how a mis-specified threshold fails loudly. */
    assert.equal(threshold.comparison, "STATE_CHANGE");
    assert.equal(threshold.value, null);
    assert.deepEqual(threshold.scopeKinds, ["ISSUER"]);
  }
  const severities = new Map(RHJ_EVENT_CATALOGUE.map(function (d) { return [d.kind, d.severity]; }));
  for (const threshold of materiality) {
    assert.equal(threshold.severity, severities.get(threshold.factKey), threshold.factKey + " changed severity in transit");
  }
});

test("an event reaches the Radar as a material change naming the condition that raised it", function () {
  const changes = radar([event()]);
  const found = changes.filter(function (change) { return change.factKey === "MULTIPLIER_CHANGED"; });
  assert.equal(found.length, 1);
  assert.equal(found[0].state, "MATERIAL");
  assert.equal(found[0].severity, "CRITICAL");
  assert.equal(found[0].subjectLabel, "AAPL");
  assert.equal(found[0].previous.value, "1.0");
  assert.equal(found[0].current.value, "4.0");
  assert.ok(found[0].sources.includes(RHJ_SOURCE_ID), "the row must name its source");
  assert.ok(found[0].evidenceRefs.length > 0, "the row must carry evidence references");
});

test("a conflict arrives through the engine's own conflict path, with both values and no average", function () {
  const changes = radar([
    event({
      kind: "SOURCE_CONFLICT",
      previous: null,
      current: null,
      conflict: [
        { sourceId: RHJ_SOURCE_ID, value: "1.000000000000000000" },
        { sourceId: "robinhood-chain-uiMultiplier", value: "1.000566080061" },
      ],
    }),
  ]);
  const conflict = changes.find(function (change) { return change.state === "CONFLICT"; });
  assert.ok(conflict, "two sources disagreeing must reach the Conflicts view");
  assert.equal(conflict.kind, "EVIDENCE_CONFLICT");
  assert.equal(conflict.measured, null, "a conflict carries no measured figure");
  assert.equal(conflict.current, null, "a conflict has no single current reading");
  assert.equal(conflict.conflict.length, 2);
  const values = conflict.conflict.map(function (entry) { return entry.value; }).sort();
  assert.deepEqual(values, ["1.000000000000000000", "1.000566080061"]);
  /* The averaged figure that must never exist anywhere on this path. */
  assert.ok(!JSON.stringify(conflict).includes("1.0002830"), "a reconciled midpoint appeared");
});

test("two events on one subject produce one baseline, not two answers to the same question", function () {
  const facts = rhjFacts([event(), event({ current: "5.0", dedupeKey: "x" })], ASOF);
  const forFact = facts.baselines.filter(function (b) { return b.factKey === "MULTIPLIER_CHANGED"; });
  assert.equal(forFact.length, 1);
  assert.equal(forFact[0].value, "1.0");
});

test("an event with no previous value creates no baseline and is not invented as one", function () {
  const facts = rhjFacts([event({ kind: "SOURCE_STALE", previous: null, current: ASOF })], ASOF);
  assert.deepEqual(facts.baselines, []);
  assert.equal(facts.observations.length, 1);
  assert.equal(facts.observations[0].value, ASOF);
});

test("a null current reaches the engine as an unknown rather than an empty string", function () {
  const facts = rhjFacts([event({ current: null, previous: null })], ASOF);
  assert.equal(facts.observations[0].value, null);
  assert.notEqual(facts.observations[0].value, "");
});

test("no event is emitted without an evidence reference", function () {
  const withIdentity = rhjFacts([event()], ASOF);
  assert.ok(withIdentity.observations[0].evidenceRefs[0].startsWith("evidence:rhj-assets"));

  /* A venue-only event carries no issuer identity, and still may not be
     anonymous — it falls back to naming the source that produced it. */
  const withoutIdentity = rhjFacts([event({ kind: "VENUE_MARKET_LISTED", identities: [], previous: null })], ASOF);
  assert.equal(withoutIdentity.observations[0].evidenceRefs.length, 1);
  assert.ok(withoutIdentity.observations[0].evidenceRefs[0].length > "evidence:".length);
});

test("no event reaches the Radar without passing through the one change engine", async function () {
  /* The defect guarded is a second producer of MaterialChange appearing beside
     the engine, which is how two surfaces start disagreeing about one change. */
  const source = await import("node:fs").then(function (fs) {
    return fs.readFileSync(new URL("./radar.ts", import.meta.url), "utf8");
  });
  assert.doesNotMatch(source, /MaterialChange\s*[=:]/, "radar.ts constructs a MaterialChange of its own");
  assert.doesNotMatch(source, /dedupeKey:/, "radar.ts mints a dedupe key the engine owns");
});
