import assert from "node:assert/strict";
import test from "node:test";

import { compileResearchMandate } from "./mandate.ts";
import { compileMonitorRules, inQuietHours, notificationDecision } from "./monitor-rule.ts";

const source = (sourceId, overrides = {}) => ({
  sourceId,
  label: sourceId,
  rights: { entitlement: "OWN_ACCOUNT", storage: true, aiProcessing: true, alerting: true, redistribution: false },
  freshnessPolicy: { maxAgeSeconds: 120 },
  ...overrides,
});

const mandateInput = {
  mandateId: "home",
  ownerRef: "owner-1",
  effectiveFrom: "2026-08-23T09:00:00.000Z",
  reviewAt: null,
  expiresAt: "2026-11-23T09:00:00.000Z",
  scope: [
    { kind: "HOLDING", ref: "arcus:perp:TSLA-USD", label: "TSLA-USD" },
    { kind: "WATCHLIST", ref: "rhc:0xabc", label: "AAPL token" },
  ],
  sources: [
    source("arcus-perps"),
    source("public-web", {
      rights: { entitlement: "PUBLIC_UNTRUSTED", storage: false, aiProcessing: false, alerting: false, redistribution: false },
    }),
  ],
  freshness: { maxAgeSeconds: 120 },
  materiality: [
    { factKey: "markPrice", comparison: "RELATIVE_BPS", value: 500, severity: "MEDIUM", scopeKinds: ["HOLDING"] },
    { factKey: "oracleState", comparison: "STATE_CHANGE", value: null, severity: "HIGH", scopeKinds: null },
  ],
  cadence: { mode: "SCHEDULE", cron: "0 7 * * *", quietHours: { fromHourUtc: 22, toHourUtc: 6 }, cooldownSeconds: 3600 },
  budgets: { dataReadsPerDay: 24, aiCallsPerDay: 0, maxAlertsPerDay: 6 },
  notificationChannels: ["surface"],
};

const mandate = () => {
  const result = compileResearchMandate(mandateInput);
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.reason}`);
  return result.mandate;
};

test("one rule per scope item, in a deterministic order", () => {
  const rules = compileMonitorRules(mandate());
  assert.equal(rules.length, 2);
  assert.deepEqual(rules.map((rule) => rule.scope.kind), ["HOLDING", "WATCHLIST"]);
  assert.deepEqual(
    rules.map((rule) => rule.ruleId),
    ["home:HOLDING:arcus:perp:TSLA-USD", "home:WATCHLIST:rhc:0xabc"],
  );
});

test("a rule carries every required field", () => {
  const [holding] = compileMonitorRules(mandate());
  assert.equal(holding.mandateId, "home");
  assert.match(holding.mandateVersion, /^v1-[0-9a-f]{12}$/);
  assert.match(holding.version, /^v1-[0-9a-f]{12}$/);
  assert.equal(holding.mode, "SCHEDULE");
  assert.equal(holding.schedule, "0 7 * * *");
  assert.equal(holding.maxSourceAgeSeconds, 120);
  assert.equal(holding.cooldownSeconds, 3600);
  assert.equal(holding.maxAlerts, 6);
  assert.equal(holding.expiresAt, "2026-11-23T09:00:00.000Z");
  assert.deepEqual(holding.quietHours, { fromHourUtc: 22, toHourUtc: 6 });
  assert.equal(holding.dedupeKey, "home:HOLDING:arcus:perp:TSLA-USD");
  assert.deepEqual(holding.requiredSources, ["arcus-perps", "public-web"]);
  assert.deepEqual(holding.alertCapableSources, ["arcus-perps"]);
  assert.equal(holding.executionAuthority, "NONE");
});

test("triggers are the thresholds that apply to that scope kind, and nothing else", () => {
  const [holding, watchlist] = compileMonitorRules(mandate());
  assert.deepEqual(holding.triggers.map((trigger) => trigger.factKey), ["markPrice", "oracleState"]);
  assert.deepEqual(watchlist.triggers.map((trigger) => trigger.factKey), ["oracleState"]);
});

test("rule severity is the strongest trigger it carries, never an average", () => {
  const [holding, watchlist] = compileMonitorRules(mandate());
  assert.equal(holding.severity, "HIGH");
  assert.equal(watchlist.severity, "HIGH");
});

test("a scope item with no applicable trigger compiles no rule, rather than a rule that watches nothing", () => {
  const result = compileResearchMandate({
    ...mandateInput,
    materiality: [{ factKey: "markPrice", comparison: "RELATIVE_BPS", value: 500, severity: "MEDIUM", scopeKinds: ["HOLDING"] }],
  });
  assert.equal(result.ok, true);
  const rules = compileMonitorRules(result.mandate);
  assert.deepEqual(rules.map((rule) => rule.scope.kind), ["HOLDING"]);
});

test("the rule version changes with the mandate version and with the rule's own content", () => {
  const [first] = compileMonitorRules(mandate());
  const moved = compileResearchMandate({
    ...mandateInput,
    materiality: [
      { factKey: "markPrice", comparison: "RELATIVE_BPS", value: 250, severity: "MEDIUM", scopeKinds: ["HOLDING"] },
      { factKey: "oracleState", comparison: "STATE_CHANGE", value: null, severity: "HIGH", scopeKinds: null },
    ],
  });
  assert.equal(moved.ok, true);
  const [second] = compileMonitorRules(moved.mandate);
  assert.notEqual(second.version, first.version);
  assert.notEqual(second.mandateVersion, first.mandateVersion);
});

test("no compiled rule can carry execution authority", () => {
  for (const rule of compileMonitorRules(mandate())) {
    assert.equal(rule.executionAuthority, "NONE");
  }
});

test("quiet hours wrap midnight and are read in UTC", () => {
  const quiet = { fromHourUtc: 22, toHourUtc: 6 };
  assert.equal(inQuietHours(quiet, "2026-08-23T23:30:00.000Z"), true);
  assert.equal(inQuietHours(quiet, "2026-08-24T05:59:00.000Z"), true);
  assert.equal(inQuietHours(quiet, "2026-08-24T06:00:00.000Z"), false);
  assert.equal(inQuietHours(quiet, "2026-08-24T12:00:00.000Z"), false);
  assert.equal(inQuietHours(null, "2026-08-24T12:00:00.000Z"), false);
  assert.equal(inQuietHours(quiet, "whenever"), false);
});

test("a non-wrapping quiet window is honoured too", () => {
  const quiet = { fromHourUtc: 1, toHourUtc: 5 };
  assert.equal(inQuietHours(quiet, "2026-08-23T02:00:00.000Z"), true);
  assert.equal(inQuietHours(quiet, "2026-08-23T06:00:00.000Z"), false);
});

test("quiet hours suppress the notification and never the visibility", () => {
  const [rule] = compileMonitorRules(mandate());
  const decision = notificationDecision({
    rule,
    asOf: "2026-08-23T23:30:00.000Z",
    alertsSentToday: 0,
    lastAlertAt: null,
    alertingSources: ["arcus-perps"],
  });
  assert.equal(decision.notify, false);
  assert.equal(decision.reason, "QUIET_HOURS");
  assert.equal(decision.visible, true);
});

test("the cooldown suppresses a repeat notification but keeps the change visible", () => {
  const [rule] = compileMonitorRules(mandate());
  const decision = notificationDecision({
    rule,
    asOf: "2026-08-23T12:30:00.000Z",
    alertsSentToday: 0,
    lastAlertAt: "2026-08-23T12:00:00.000Z",
    alertingSources: ["arcus-perps"],
  });
  assert.equal(decision.notify, false);
  assert.equal(decision.reason, "COOLDOWN");
  assert.equal(decision.visible, true);
});

test("the daily alert budget is a ceiling, and exceeding it never hides the change", () => {
  const [rule] = compileMonitorRules(mandate());
  const decision = notificationDecision({
    rule,
    asOf: "2026-08-23T12:00:00.000Z",
    alertsSentToday: 6,
    lastAlertAt: null,
    alertingSources: ["arcus-perps"],
  });
  assert.equal(decision.notify, false);
  assert.equal(decision.reason, "BUDGET_EXHAUSTED");
  assert.equal(decision.visible, true);
});

test("a change built only from sources with no alerting right cannot notify", () => {
  const [rule] = compileMonitorRules(mandate());
  const decision = notificationDecision({
    rule,
    asOf: "2026-08-23T12:00:00.000Z",
    alertsSentToday: 0,
    lastAlertAt: null,
    alertingSources: ["public-web"],
  });
  assert.equal(decision.notify, false);
  assert.equal(decision.reason, "NO_ALERTING_RIGHT");
  assert.equal(decision.visible, true);
});

test("with quiet hours clear, budget free and an entitled source, the rule may notify", () => {
  const [rule] = compileMonitorRules(mandate());
  const decision = notificationDecision({
    rule,
    asOf: "2026-08-23T12:00:00.000Z",
    alertsSentToday: 0,
    lastAlertAt: null,
    alertingSources: ["arcus-perps"],
  });
  assert.equal(decision.notify, true);
  assert.equal(decision.reason, null);
  assert.equal(decision.visible, true);
});
