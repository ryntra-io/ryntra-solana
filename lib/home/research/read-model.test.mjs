import assert from "node:assert/strict";
import test from "node:test";

import { compileResearchMandate } from "./mandate.ts";
import { compileMonitorRules } from "./monitor-rule.ts";
import { detectMaterialChanges } from "./change.ts";
import { RESEARCH_VIEW_IDS, findChange, projectResearch } from "./read-model.ts";

const ASOF = "2026-08-23T12:00:00.000Z";

const source = (sourceId) => ({
  sourceId,
  label: sourceId,
  rights: { entitlement: "OWN_ACCOUNT", storage: true, aiProcessing: true, alerting: true, redistribution: false },
  freshnessPolicy: { maxAgeSeconds: 120 },
});

function mandate(scope) {
  const result = compileResearchMandate({
    mandateId: "home",
    ownerRef: "owner-1",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    reviewAt: null,
    expiresAt: null,
    scope,
    sources: [source("arcus-perps"), source("rhc-oracle")],
    freshness: { maxAgeSeconds: 120 },
    materiality: [
      { factKey: "markPrice", comparison: "RELATIVE_BPS", value: 500, severity: "MEDIUM", scopeKinds: null },
    ],
    cadence: { mode: "SCHEDULE", cron: "0 7 * * *", quietHours: null, cooldownSeconds: 3600 },
    budgets: { dataReadsPerDay: 24, aiCallsPerDay: 0, maxAlertsPerDay: 6 },
    notificationChannels: ["surface"],
  });
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.reason}`);
  return result.mandate;
}

const SCOPE = [
  { kind: "HOLDING", ref: "hold-1", label: "TSLA-USD" },
  { kind: "WATCHLIST", ref: "watch-1", label: "AAPL token" },
  { kind: "CHAIN", ref: "chain-1", label: "Robinhood Chain" },
];

const observation = (subjectRef, sourceId, value) => ({
  factKey: "markPrice",
  subjectRef,
  subjectLabel: subjectRef,
  sourceId,
  observedAt: ASOF,
  effectiveAt: null,
  value,
  unit: "USD",
  evidenceRefs: [`evidence:${sourceId}:${subjectRef}`],
  entitlement: "OWN_ACCOUNT",
});

const baseline = (subjectRef, value) => ({
  subjectRef,
  factKey: "markPrice",
  value,
  observedAt: "2026-08-23T07:00:00.000Z",
  source: "account_watch",
});

function project(overrides = {}) {
  const compiled = mandate(overrides.scope ?? SCOPE);
  const rules = compileMonitorRules(compiled);
  const changes = detectMaterialChanges({
    rules,
    observations: overrides.observations ?? [],
    baselines: overrides.baselines ?? [],
    degradedSources: overrides.degradedSources ?? [],
    asOf: ASOF,
  });
  return projectResearch({
    mandate: compiled,
    rules,
    changes,
    runs: overrides.runs ?? rules.map((rule) => [rule.ruleId, {
      last: { state: "UNKNOWN", at: null, reason: "No scheduler record exists for this rule.", source: null },
      lastEvidenceRefresh: { state: "UNKNOWN", at: null, reason: "No scheduler record exists for this rule.", source: null },
      next: { state: "DECLARED", at: "2026-08-24T07:00:00.000Z", reason: "Derived from the declared schedule, not from an observed run." },
      enrolled: false,
      watermark: null,
      runCount: null,
    }]),
    sources: overrides.sources ?? [
      { sourceId: "arcus-perps", label: "arcus-perps", state: "OK", reason: null, entitlement: "OWN_ACCOUNT" },
      { sourceId: "rhc-oracle", label: "rhc-oracle", state: "OK", reason: null, entitlement: "OWN_ACCOUNT" },
    ],
    asOf: ASOF,
  });
}

test("the six views exist, in their fixed order, and every change lands in one", () => {
  const projection = project({
    observations: [observation("hold-1", "arcus-perps", "106.00")],
    baselines: [baseline("hold-1", "100.00")],
  });
  assert.deepEqual(
    projection.views.map((view) => view.id),
    ["FOR_ME", "WATCHLIST", "MARKET", "CONFLICTS", "UNKNOWNS", "SCHEDULED"],
  );
  assert.deepEqual([...RESEARCH_VIEW_IDS], projection.views.map((view) => view.id));
});

test("scope kind decides which of the first three views a change belongs to", () => {
  const projection = project({
    observations: [
      observation("hold-1", "arcus-perps", "106.00"),
      observation("watch-1", "arcus-perps", "212.00"),
      observation("chain-1", "arcus-perps", "318.00"),
    ],
    baselines: [baseline("hold-1", "100.00"), baseline("watch-1", "200.00"), baseline("chain-1", "300.00")],
  });
  const by = (id) => projection.views.find((view) => view.id === id);
  assert.deepEqual(by("FOR_ME").items.map((item) => item.subjectRef), ["hold-1"]);
  assert.deepEqual(by("WATCHLIST").items.map((item) => item.subjectRef), ["watch-1"]);
  assert.deepEqual(by("MARKET").items.map((item) => item.subjectRef), ["chain-1"]);
});

test("conflicts and unknowns get their own views and are not averaged away", () => {
  const projection = project({
    observations: [
      observation("hold-1", "arcus-perps", "106.00"),
      observation("hold-1", "rhc-oracle", "112.00"),
    ],
    baselines: [baseline("hold-1", "100.00")],
  });
  const conflicts = projection.views.find((view) => view.id === "CONFLICTS");
  assert.equal(conflicts.items.length, 1);
  assert.equal(conflicts.items[0].state, "CONFLICT");
  assert.deepEqual(conflicts.items[0].conflict.map((entry) => entry.value), ["106.00", "112.00"]);

  const unknowns = projection.views.find((view) => view.id === "UNKNOWNS");
  /* Two scope items had no observation at all. */
  assert.equal(unknowns.items.length, 2);
  assert.equal(projection.state, "ATTENTION");
});

test("a change within its threshold is counted, not listed", () => {
  const projection = project({
    scope: [SCOPE[0]],
    observations: [observation("hold-1", "arcus-perps", "101.00")],
    baselines: [baseline("hold-1", "100.00")],
  });
  const forMe = projection.views.find((view) => view.id === "FOR_ME");
  assert.deepEqual(forMe.items, []);
  assert.equal(forMe.withinThresholdCount, 1);
  assert.match(forMe.emptyReason ?? "", /within/i);
  assert.equal(projection.state, "CALM");
});

test("an empty view says why it is empty rather than showing nothing", () => {
  const projection = project({ scope: [SCOPE[0]] });
  const watchlist = projection.views.find((view) => view.id === "WATCHLIST");
  assert.deepEqual(watchlist.items, []);
  assert.match(watchlist.emptyReason ?? "", /mandate/i);
});

test("the Scheduled view carries rules and their run projections, not changes", () => {
  const projection = project({ scope: [SCOPE[0]] });
  const scheduled = projection.views.find((view) => view.id === "SCHEDULED");
  assert.deepEqual(scheduled.items, []);
  assert.equal(scheduled.scheduled.length, 1);
  const [rule] = scheduled.scheduled;
  assert.equal(rule.ruleId, "home:HOLDING:hold-1");
  assert.equal(rule.run.last.state, "UNKNOWN");
  assert.equal(rule.run.next.state, "DECLARED");
  assert.equal(rule.mode, "SCHEDULE");
});

test("a rule with no run projection is UNKNOWN rather than absent", () => {
  const projection = project({ scope: [SCOPE[0]], runs: [] });
  const [rule] = projection.views.find((view) => view.id === "SCHEDULED").scheduled;
  assert.equal(rule.run.last.state, "UNKNOWN");
  assert.equal(rule.run.next.state, "UNKNOWN");
  assert.match(rule.run.last.reason ?? "", /no scheduler record/i);
});

test("the mandate summary states its authority boundary and its budgets", () => {
  const projection = project({ scope: [SCOPE[0]] });
  assert.equal(projection.mandate.executionAuthority, "NONE");
  assert.equal(projection.mandate.state, "ACTIVE");
  assert.equal(projection.mandate.budgets.aiCallsPerDay, 0);
  assert.match(projection.mandate.version, /^v1-[0-9a-f]{12}$/);
  assert.equal(projection.mandate.scopeCount, 1);
  assert.equal(projection.mandate.sourceCount, 2);
});

test("a degraded source degrades the surface and names itself, and never empties a healthy view", () => {
  const projection = project({
    scope: [SCOPE[0]],
    observations: [observation("hold-1", "arcus-perps", "106.00")],
    baselines: [baseline("hold-1", "100.00")],
    degradedSources: [{ sourceId: "rhc-oracle", reason: "The oracle read did not complete." }],
    sources: [
      { sourceId: "arcus-perps", label: "arcus-perps", state: "OK", reason: null, entitlement: "OWN_ACCOUNT" },
      { sourceId: "rhc-oracle", label: "rhc-oracle", state: "FAILED", reason: "The oracle read did not complete.", entitlement: "OWN_ACCOUNT" },
    ],
  });
  assert.equal(projection.state, "DEGRADED");
  const forMe = projection.views.find((view) => view.id === "FOR_ME");
  /* The healthy source's material change survives, and the failed source's
     degradation is a change of its own beside it rather than a silence. */
  assert.equal(forMe.items.filter((item) => item.state === "MATERIAL").length, 1);
  assert.equal(forMe.items.filter((item) => item.kind === "SOURCE_DEGRADED").length, 1);
  assert.equal(projection.sources.find((entry) => entry.sourceId === "rhc-oracle").state, "FAILED");
});

test("every source failing is a recovery state, not a calm one", () => {
  const projection = project({
    scope: [SCOPE[0]],
    sources: [
      { sourceId: "arcus-perps", label: "arcus-perps", state: "FAILED", reason: "no answer", entitlement: "OWN_ACCOUNT" },
      { sourceId: "rhc-oracle", label: "rhc-oracle", state: "FAILED", reason: "no answer", entitlement: "OWN_ACCOUNT" },
    ],
  });
  assert.equal(projection.state, "DEGRADED");
  assert.equal(projection.recovery.length > 0, true);
});

test("a mandate with no compiled rule is an ERROR, because nothing is being watched", () => {
  const compiled = mandate([SCOPE[0]]);
  const projection = projectResearch({
    mandate: compiled,
    rules: [],
    changes: [],
    runs: [],
    sources: [],
    asOf: ASOF,
  });
  assert.equal(projection.state, "ERROR");
  assert.match(projection.recovery[0], /no rule/i);
});

test("an unusable reading clock is UNKNOWN and says so, rather than rendering a time", () => {
  const compiled = mandate([SCOPE[0]]);
  const projection = projectResearch({
    mandate: compiled,
    rules: compileMonitorRules(compiled),
    changes: [],
    runs: [],
    sources: [],
    asOf: "whenever",
  });
  assert.equal(projection.mandate.state, "UNKNOWN");
});

test("a change resolves by id, and an unknown id resolves to nothing", () => {
  const projection = project({
    scope: [SCOPE[0]],
    observations: [observation("hold-1", "arcus-perps", "106.00")],
    baselines: [baseline("hold-1", "100.00")],
  });
  const [change] = projection.changes;
  assert.equal(findChange(projection, change.id)?.id, change.id);
  assert.equal(findChange(projection, "chg-000000000000"), null);
  assert.equal(findChange(projection, "../../etc/passwd"), null);
});

test("the rule a change came from is resolvable from the projection", () => {
  const projection = project({
    scope: [SCOPE[0]],
    observations: [observation("hold-1", "arcus-perps", "106.00")],
    baselines: [baseline("hold-1", "100.00")],
  });
  const [change] = projection.changes;
  const rule = projection.rules.find((entry) => entry.ruleId === change.ruleId);
  assert.ok(rule, "a change must always point at a rule the surface can show");
  assert.equal(rule.triggers.length >= 1, true);
});

test("view counts agree with the items and the changes they came from", () => {
  const projection = project({
    observations: [
      observation("hold-1", "arcus-perps", "106.00"),
      observation("watch-1", "arcus-perps", "200.00"),
    ],
    baselines: [baseline("hold-1", "100.00"), baseline("watch-1", "200.00")],
  });
  for (const view of projection.views) {
    if (view.id === "SCHEDULED") continue;
    assert.equal(
      view.items.length,
      view.materialCount + view.conflictCount + view.unknownCount,
      `${view.id} counts must equal its item list`,
    );
  }
  assert.equal(
    projection.changes.filter((change) => change.state !== "IMMATERIAL").length,
    projection.views
      .filter((view) => ["FOR_ME", "WATCHLIST", "MARKET"].includes(view.id))
      .reduce((sum, view) => sum + view.items.length, 0),
    "every visible change belongs to exactly one scope view",
  );
});

test("a read layer may state why a view is empty in its own words", () => {
  const compiled = mandate([SCOPE[0]]);
  const projection = projectResearch({
    mandate: compiled,
    rules: compileMonitorRules(compiled),
    changes: [],
    runs: [],
    sources: [{ sourceId: "arcus-perps", label: "arcus-perps", state: "OK", reason: null, entitlement: "OWN_ACCOUNT" }],
    asOf: ASOF,
    viewNotes: { WATCHLIST: "Ryntra has no server-readable watchlist for this account." },
  });
  const watchlist = projection.views.find((view) => view.id === "WATCHLIST");
  assert.equal(watchlist.emptyReason, "Ryntra has no server-readable watchlist for this account.");
  /* And a view with items keeps its items rather than a note. */
  assert.equal(projection.views.find((view) => view.id === "SCHEDULED").emptyReason, null);
});

test("an empty view says whether it is calm or merely unanswerable", () => {
  const projection = project({
    scope: [SCOPE[0]],
    observations: [observation("hold-1", "arcus-perps", "101.00")],
    baselines: [baseline("hold-1", "100.00")],
  });
  const by = (id) => projection.views.find((view) => view.id === id);
  /* Answered and nothing material: a genuine pass. */
  assert.equal(by("FOR_ME").emptyTone, "CALM");
  /* No watchlist scope at all: a limit, and a green tick beside it would be a
     pass mark on something that was never measured. */
  assert.equal(by("WATCHLIST").emptyTone, "LIMITED");
});

test("every view is LIMITED when no source answered", () => {
  const projection = project({
    scope: [SCOPE[0]],
    sources: [{ sourceId: "arcus-perps", label: "arcus-perps", state: "FAILED", reason: "no answer", entitlement: "OWN_ACCOUNT" }],
  });
  for (const view of projection.views) {
    assert.equal(view.emptyTone, "LIMITED", `${view.id} cannot be calm when nothing answered`);
  }
});
