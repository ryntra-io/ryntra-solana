import assert from "node:assert/strict";
import test from "node:test";

import { compileResearchMandate } from "./mandate.ts";
import { compileMonitorRules } from "./monitor-rule.ts";
import { detectMaterialChanges } from "./change.ts";

const ASOF = "2026-08-23T12:00:00.000Z";

const source = (sourceId, alerting = true) => ({
  sourceId,
  label: sourceId,
  rights: { entitlement: "OWN_ACCOUNT", storage: true, aiProcessing: true, alerting, redistribution: false },
  freshnessPolicy: { maxAgeSeconds: 120 },
});

function rules(materiality) {
  const result = compileResearchMandate({
    mandateId: "home",
    ownerRef: "owner-1",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    reviewAt: null,
    expiresAt: null,
    scope: [{ kind: "HOLDING", ref: "arcus:perp:TSLA-USD", label: "TSLA-USD" }],
    sources: [source("arcus-perps"), source("rhc-oracle")],
    freshness: { maxAgeSeconds: 120 },
    materiality,
    cadence: { mode: "SCHEDULE", cron: "0 7 * * *", quietHours: null, cooldownSeconds: 3600 },
    budgets: { dataReadsPerDay: 24, aiCallsPerDay: 0, maxAlertsPerDay: 6 },
    notificationChannels: ["surface"],
  });
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.reason}`);
  return compileMonitorRules(result.mandate);
}

const priceRules = () => rules([
  { factKey: "markPrice", comparison: "RELATIVE_BPS", value: 500, severity: "MEDIUM", scopeKinds: ["HOLDING"] },
]);

const observation = (overrides) => ({
  factKey: "markPrice",
  subjectRef: "arcus:perp:TSLA-USD",
  subjectLabel: "TSLA-USD",
  sourceId: "arcus-perps",
  observedAt: ASOF,
  effectiveAt: null,
  value: "100.00",
  unit: "USD",
  evidenceRefs: ["evidence:arcus-perps:0"],
  entitlement: "OWN_ACCOUNT",
  ...overrides,
});

const baseline = (overrides = {}) => ({
  subjectRef: "arcus:perp:TSLA-USD",
  factKey: "markPrice",
  value: "100.00",
  observedAt: "2026-08-23T07:00:00.000Z",
  source: "account_watch",
  ...overrides,
});

test("a move past the threshold is a MATERIAL change carrying what it measured", () => {
  const [change, ...rest] = detectMaterialChanges({
    rules: priceRules(),
    observations: [observation({ value: "106.00" })],
    baselines: [baseline()],
    degradedSources: [],
    asOf: ASOF,
  });
  assert.deepEqual(rest, []);
  assert.equal(change.state, "MATERIAL");
  assert.equal(change.kind, "VALUE_MOVE");
  assert.equal(change.severity, "MEDIUM");
  assert.equal(change.subjectRef, "arcus:perp:TSLA-USD");
  assert.equal(change.factKey, "markPrice");
  assert.deepEqual(change.threshold, { comparison: "RELATIVE_BPS", value: 500, unit: "bps" });
  assert.deepEqual(change.measured, { value: "600", unit: "bps" });
  assert.equal(change.previous.value, "100.00");
  assert.equal(change.current.value, "106.00");
  assert.deepEqual(change.sources, ["arcus-perps"]);
  assert.equal(change.ruleId, "home:HOLDING:arcus:perp:TSLA-USD");
  assert.match(change.id, /^chg-[0-9a-f]{12}$/);
});

test("a move short of the threshold is IMMATERIAL and still carries its measurement", () => {
  const [change] = detectMaterialChanges({
    rules: priceRules(),
    observations: [observation({ value: "101.00" })],
    baselines: [baseline()],
    degradedSources: [],
    asOf: ASOF,
  });
  assert.equal(change.state, "IMMATERIAL");
  assert.deepEqual(change.measured, { value: "100", unit: "bps" });
});

test("a borderline move rounds toward reporting, never toward silence", () => {
  /* 100.00 -> 105.001 is 500.1 bps. Rounding down would hide a move that is
     over the threshold, so the magnitude is rounded away from zero. */
  const [change] = detectMaterialChanges({
    rules: priceRules(),
    observations: [observation({ value: "105.001" })],
    baselines: [baseline()],
    degradedSources: [],
    asOf: ASOF,
  });
  assert.equal(change.state, "MATERIAL");
  assert.equal(change.measured.value, "501");
});

test("two sources that disagree produce a CONFLICT that keeps both values", () => {
  const [change] = detectMaterialChanges({
    rules: priceRules(),
    observations: [
      observation({ sourceId: "arcus-perps", value: "106.00" }),
      observation({ sourceId: "rhc-oracle", value: "112.00", evidenceRefs: ["evidence:rhc-oracle:0"] }),
    ],
    baselines: [baseline()],
    degradedSources: [],
    asOf: ASOF,
  });
  assert.equal(change.state, "CONFLICT");
  assert.equal(change.kind, "EVIDENCE_CONFLICT");
  assert.deepEqual(
    change.conflict.map((entry) => [entry.sourceId, entry.value]),
    [["arcus-perps", "106.00"], ["rhc-oracle", "112.00"]],
  );
  /* The averaging defect this test exists for: 109.00 must appear nowhere. */
  assert.equal(change.measured, null);
  assert.equal(change.current, null);
  assert.equal(JSON.stringify(change).includes("109"), false);
  assert.deepEqual(change.sources, ["arcus-perps", "rhc-oracle"]);
  assert.deepEqual(change.evidenceRefs, ["evidence:arcus-perps:0", "evidence:rhc-oracle:0"]);
});

test("two sources that agree are not a conflict", () => {
  const [change, ...rest] = detectMaterialChanges({
    rules: priceRules(),
    observations: [
      observation({ sourceId: "arcus-perps", value: "106.00" }),
      observation({ sourceId: "rhc-oracle", value: "106.00" }),
    ],
    baselines: [baseline()],
    degradedSources: [],
    asOf: ASOF,
  });
  assert.deepEqual(rest, []);
  assert.equal(change.state, "MATERIAL");
  assert.deepEqual(change.sources, ["arcus-perps", "rhc-oracle"]);
});

test("a fact no source supplies is an UNKNOWN that names what is missing", () => {
  const [change] = detectMaterialChanges({
    rules: priceRules(),
    observations: [],
    baselines: [baseline()],
    degradedSources: [],
    asOf: ASOF,
  });
  assert.equal(change.state, "UNKNOWN");
  assert.equal(change.kind, "EVIDENCE_MISSING");
  assert.equal(change.unknown.length, 1);
  assert.match(change.unknown[0], /markPrice/);
  assert.equal(change.measured, null);
});

test("a source that returned the fact as null is named as the one that did not supply it", () => {
  const [change] = detectMaterialChanges({
    rules: priceRules(),
    observations: [observation({ value: null })],
    baselines: [baseline()],
    degradedSources: [],
    asOf: ASOF,
  });
  assert.equal(change.state, "UNKNOWN");
  assert.match(change.unknown[0], /arcus-perps/);
});

test("no recorded baseline produces an UNKNOWN, never an invented delta", () => {
  const [change] = detectMaterialChanges({
    rules: priceRules(),
    observations: [observation({ value: "106.00" })],
    baselines: [],
    degradedSources: [],
    asOf: ASOF,
  });
  assert.equal(change.state, "UNKNOWN");
  assert.equal(change.kind, "NEW_OBSERVATION");
  assert.equal(change.previous, null);
  assert.equal(change.current.value, "106.00");
  assert.equal(change.measured, null);
  assert.match(change.unknown[0], /baseline/i);
});

test("a zero baseline has no denominator, and that is stated rather than divided by", () => {
  const [change] = detectMaterialChanges({
    rules: priceRules(),
    observations: [observation({ value: "106.00" })],
    baselines: [baseline({ value: "0.00" })],
    degradedSources: [],
    asOf: ASOF,
  });
  assert.equal(change.state, "UNKNOWN");
  assert.match(change.unknown[0], /denominator|zero/i);
});

test("an absolute threshold is measured in the fact's own unit", () => {
  const [change] = detectMaterialChanges({
    rules: rules([{ factKey: "markPrice", comparison: "ABSOLUTE", value: 5, severity: "HIGH", scopeKinds: ["HOLDING"] }]),
    observations: [observation({ value: "106.00" })],
    baselines: [baseline()],
    degradedSources: [],
    asOf: ASOF,
  });
  assert.equal(change.state, "MATERIAL");
  assert.deepEqual(change.measured, { value: "6.00", unit: "USD" });
  assert.deepEqual(change.threshold, { comparison: "ABSOLUTE", value: 5, unit: "USD" });
});

test("a state change is material when the token differs and immaterial when it does not", () => {
  const stateRules = rules([{ factKey: "oracleState", comparison: "STATE_CHANGE", value: null, severity: "HIGH", scopeKinds: ["HOLDING"] }]);
  const observations = (value) => [observation({ factKey: "oracleState", value, unit: null })];
  const baselines = (value) => [baseline({ factKey: "oracleState", value })];

  const [moved] = detectMaterialChanges({
    rules: stateRules,
    observations: observations("PAUSED"),
    baselines: baselines("ACTIVE"),
    degradedSources: [],
    asOf: ASOF,
  });
  assert.equal(moved.state, "MATERIAL");
  assert.equal(moved.kind, "STATE_CHANGE");
  assert.equal(moved.severity, "HIGH");
  assert.equal(moved.previous.value, "ACTIVE");
  assert.equal(moved.current.value, "PAUSED");

  const [same] = detectMaterialChanges({
    rules: stateRules,
    observations: observations("ACTIVE"),
    baselines: baselines("ACTIVE"),
    degradedSources: [],
    asOf: ASOF,
  });
  assert.equal(same.state, "IMMATERIAL");
});

test("a degraded source is its own change, attributed to a rule that required it", () => {
  const changes = detectMaterialChanges({
    rules: priceRules(),
    observations: [observation({ value: "100.00" })],
    baselines: [baseline()],
    degradedSources: [{ sourceId: "rhc-oracle", reason: "The oracle read did not complete." }],
    asOf: ASOF,
  });
  const degraded = changes.find((change) => change.kind === "SOURCE_DEGRADED");
  assert.ok(degraded);
  assert.equal(degraded.state, "UNKNOWN");
  assert.equal(degraded.subjectRef, "rhc-oracle");
  assert.equal(degraded.ruleId, "home:HOLDING:arcus:perp:TSLA-USD");
  assert.match(degraded.unknown[0], /did not complete/);
});

test("ordering is total: conflicts, then material, then unknown, then immaterial", () => {
  const changes = detectMaterialChanges({
    rules: rules([
      { factKey: "markPrice", comparison: "RELATIVE_BPS", value: 500, severity: "MEDIUM", scopeKinds: ["HOLDING"] },
      { factKey: "oracleState", comparison: "STATE_CHANGE", value: null, severity: "HIGH", scopeKinds: ["HOLDING"] },
      { factKey: "fundingRate", comparison: "RELATIVE_BPS", value: 10, severity: "LOW", scopeKinds: ["HOLDING"] },
    ]),
    observations: [
      observation({ factKey: "markPrice", sourceId: "arcus-perps", value: "106.00" }),
      observation({ factKey: "markPrice", sourceId: "rhc-oracle", value: "120.00" }),
      observation({ factKey: "oracleState", value: "PAUSED", unit: null }),
    ],
    baselines: [baseline(), baseline({ factKey: "oracleState", value: "ACTIVE" })],
    degradedSources: [],
    asOf: ASOF,
  });
  assert.deepEqual(changes.map((change) => change.state), ["CONFLICT", "MATERIAL", "UNKNOWN"]);
  assert.deepEqual(changes.map((change) => change.factKey), ["markPrice", "oracleState", "fundingRate"]);
});

test("the same world produces the same ids twice, so a change can be linked to", () => {
  const call = () => detectMaterialChanges({
    rules: priceRules(),
    observations: [observation({ value: "106.00" })],
    baselines: [baseline()],
    degradedSources: [],
    asOf: ASOF,
  });
  assert.deepEqual(call().map((change) => change.id), call().map((change) => change.id));
});

test("a different reading clock does not change an id, but a different value does", () => {
  const at = (asOf, value) => detectMaterialChanges({
    rules: priceRules(),
    observations: [observation({ value, observedAt: asOf })],
    baselines: [baseline()],
    degradedSources: [],
    asOf,
  })[0].id;
  assert.equal(at("2026-08-23T12:00:00.000Z", "106.00"), at("2026-08-23T13:00:00.000Z", "106.00"));
  assert.notEqual(at(ASOF, "106.00"), at(ASOF, "107.00"));
});

test("an observation for another subject is not measured against this rule", () => {
  const changes = detectMaterialChanges({
    rules: priceRules(),
    observations: [observation({ subjectRef: "arcus:perp:AAPL-USD", value: "106.00" })],
    baselines: [baseline()],
    degradedSources: [],
    asOf: ASOF,
  });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].state, "UNKNOWN");
  assert.equal(changes[0].kind, "EVIDENCE_MISSING");
});

test("an observation with a value that is not a canonical decimal cannot become a measurement", () => {
  const [change] = detectMaterialChanges({
    rules: priceRules(),
    observations: [observation({ value: "1e6" })],
    baselines: [baseline()],
    degradedSources: [],
    asOf: ASOF,
  });
  assert.equal(change.state, "UNKNOWN");
  assert.match(change.unknown[0], /decimal/i);
});
