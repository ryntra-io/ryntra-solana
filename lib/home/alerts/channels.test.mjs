import assert from "node:assert/strict";
import test from "node:test";

import {
  ALERT_CHANNELS,
  CHANNEL_CONFIGURATION_STATES,
  CHANNEL_DELIVERY_STATES,
  projectAlertChannels,
  projectAlerts,
} from "./channels.ts";

const AS_OF = "2026-08-24T12:00:00.000Z";

const channelInput = (overrides = {}) => ({
  asOf: AS_OF,
  telegram: { linked: true, chatRef: "tg:1", lastDeliveredAt: "2026-08-24T08:00:00.000Z", lastFailureAt: null },
  declaredChannels: ["IN_APP", "TELEGRAM"],
  ...overrides,
});

const rule = (overrides = {}) => ({
  ruleId: "rule-1",
  ruleVersion: "v1",
  label: "TSLA-USD corporate actions",
  quietHours: { fromHourUtc: 22, toHourUtc: 6 },
  cooldownSeconds: 3600,
  dedupeKey: "rule-1",
  maxAlerts: 20,
  budgets: { dataReadsPerDay: 200, aiCallsPerDay: null, maxAlertsPerDay: 20 },
  expiresAt: null,
  ...overrides,
});

const alert = (overrides = {}) => ({
  alertId: "alert-1",
  ruleId: "rule-1",
  title: "A split was declared on TSLA-USD",
  observedAt: "2026-08-24T08:00:00.000Z",
  severity: "HIGH",
  href: "/app/research/change-1",
  surface: "Research",
  decision: { notify: true, reason: null, visible: true },
  channel: "TELEGRAM",
  ...overrides,
});

test("the channel union is closed and every declared state is a member", () => {
  assert.deepEqual([...ALERT_CHANNELS], ["IN_APP", "TELEGRAM", "EMAIL", "WEBHOOK", "PUSH"]);
  assert.deepEqual([...CHANNEL_CONFIGURATION_STATES], ["CONFIGURED", "NOT_CONFIGURED", "DEGRADED", "UNKNOWN"]);
  assert.deepEqual([...CHANNEL_DELIVERY_STATES], ["DELIVERED", "NO_DELIVERY_OBSERVED", "FAILED", "NOT_APPLICABLE"]);
});

test("every channel is answered, including the ones nobody configured", () => {
  const projection = projectAlertChannels(channelInput());
  assert.deepEqual(projection.channels.map((entry) => entry.channel), [...ALERT_CHANNELS]);
  for (const entry of projection.channels) {
    assert.ok(entry.reason.length > 0, entry.channel + " must state its reason");
  }
});

test("configuration and observed deliverability are separate fields and are never merged", () => {
  const projection = projectAlertChannels(channelInput());
  const telegram = projection.channels.find((entry) => entry.channel === "TELEGRAM");
  assert.equal(telegram.configuration, "CONFIGURED");
  assert.equal(telegram.delivery, "DELIVERED");
  assert.ok("configuration" in telegram && "delivery" in telegram);
  assert.equal("ok" in telegram, false, "there is no single merged green tick");
});

test("a configured channel with no observed delivery is NO_DELIVERY_OBSERVED, not OK", () => {
  const projection = projectAlertChannels(channelInput({
    telegram: { linked: true, chatRef: "tg:1", lastDeliveredAt: null, lastFailureAt: null },
  }));
  const telegram = projection.channels.find((entry) => entry.channel === "TELEGRAM");
  assert.equal(telegram.configuration, "CONFIGURED");
  assert.equal(telegram.delivery, "NO_DELIVERY_OBSERVED");
});

test("a channel whose last attempt failed is DEGRADED with the failure kept", () => {
  const projection = projectAlertChannels(channelInput({
    telegram: { linked: true, chatRef: "tg:1", lastDeliveredAt: "2026-08-20T08:00:00.000Z", lastFailureAt: "2026-08-24T09:00:00.000Z" },
  }));
  const telegram = projection.channels.find((entry) => entry.channel === "TELEGRAM");
  assert.equal(telegram.configuration, "DEGRADED");
  assert.equal(telegram.delivery, "FAILED");
  assert.equal(telegram.lastFailureAt, "2026-08-24T09:00:00.000Z");
});

test("an unconfigured channel names what it would take, and cannot be switched on from here", () => {
  const projection = projectAlertChannels(channelInput());
  for (const channel of ["EMAIL", "WEBHOOK", "PUSH"]) {
    const entry = projection.channels.find((item) => item.channel === channel);
    assert.equal(entry.configuration, "NOT_CONFIGURED");
    assert.equal(entry.delivery, "NOT_APPLICABLE");
    assert.ok(entry.wouldTake.length > 0, channel + " must say what it would take");
    assert.equal(entry.enableHref, null, channel + " must offer no enable control");
  }
});

test("in-app is always configured, because the surface itself is the channel", () => {
  const projection = projectAlertChannels(channelInput({ declaredChannels: [] }));
  const inApp = projection.channels.find((entry) => entry.channel === "IN_APP");
  assert.equal(inApp.configuration, "CONFIGURED");
});

test("no control on this projection enables, disables or tests a channel", () => {
  const projection = projectAlertChannels(channelInput());
  const serialized = JSON.stringify(projection);
  for (const verb of ["enable", "disable", "sendTest", "test_channel"]) {
    assert.equal(serialized.includes('"' + verb + '"'), false, verb + " must not be a field");
  }
  assert.equal(projection.authority, "READ_ONLY");
});

test("a suppressed alert is still shown, with the rule that suppressed it", () => {
  const projection = projectAlerts({
    asOf: AS_OF,
    rules: [rule()],
    alerts: [alert({ decision: { notify: false, reason: "QUIET_HOURS", visible: true } })],
  });
  assert.equal(projection.alerts.length, 1);
  const suppressed = projection.alerts[0];
  assert.equal(suppressed.delivered, false);
  assert.equal(suppressed.suppressedBy, "QUIET_HOURS");
  assert.equal(suppressed.rule.ruleId, "rule-1");
  assert.match(suppressed.suppressionReason, /quiet hours/i);
  assert.equal(projection.counts.suppressed, 1);
});

test("every suppression reason the rule engine can return has a sentence", () => {
  for (const reason of ["QUIET_HOURS", "COOLDOWN", "BUDGET_EXHAUSTED", "NO_ALERTING_RIGHT", "EXPIRED", "UNKNOWN_CLOCK"]) {
    const projection = projectAlerts({
      asOf: AS_OF,
      rules: [rule()],
      alerts: [alert({ decision: { notify: false, reason, visible: true } })],
    });
    assert.ok(projection.alerts[0].suppressionReason.length > 0, reason);
    assert.notEqual(projection.alerts[0].suppressionReason, reason, reason + " must read as a sentence, not an enum");
  }
});

test("an alert whose rule is not in the projection is refused rather than shown without its rule", () => {
  assert.throws(
    () => projectAlerts({ asOf: AS_OF, rules: [], alerts: [alert()] }),
    /rule/i,
  );
});

test("budgets and limits are shown from the rule, never redefined here", () => {
  const projection = projectAlerts({ asOf: AS_OF, rules: [rule()], alerts: [] });
  const shown = projection.rules[0];
  assert.equal(shown.maxAlerts, 20);
  assert.equal(shown.cooldownSeconds, 3600);
  assert.deepEqual(shown.quietHours, { fromHourUtc: 22, toHourUtc: 6 });
  assert.equal(shown.dedupeKey, "rule-1");
});

test("a rule with no declared limit reports UNRECORDED rather than an invented default", () => {
  const projection = projectAlerts({
    asOf: AS_OF,
    rules: [rule({ maxAlerts: null, quietHours: null, budgets: { dataReadsPerDay: null, aiCallsPerDay: null, maxAlertsPerDay: null } })],
    alerts: [],
  });
  const shown = projection.rules[0];
  assert.equal(shown.maxAlerts, null);
  assert.equal(shown.maxAlertsLabel, "Unrecorded");
  assert.equal(shown.quietHoursLabel, "None declared");
});

test("the state is ATTENTION when something was suppressed and CALM when everything was delivered", () => {
  const calm = projectAlerts({ asOf: AS_OF, rules: [rule()], alerts: [alert()] });
  assert.equal(calm.state, "CALM");
  const attention = projectAlerts({
    asOf: AS_OF,
    rules: [rule()],
    alerts: [alert({ decision: { notify: false, reason: "BUDGET_EXHAUSTED", visible: true } })],
  });
  assert.equal(attention.state, "ATTENTION");
});

test("with no rules at all the projection is EMPTY and says where rules come from", () => {
  const projection = projectAlerts({ asOf: AS_OF, rules: [], alerts: [] });
  assert.equal(projection.state, "EMPTY");
  assert.match(projection.emptyReason, /mandate|research/i);
});

test("compilation is pure: same input, same object, twice", () => {
  assert.deepEqual(
    projectAlerts({ asOf: AS_OF, rules: [rule()], alerts: [alert()] }),
    projectAlerts({ asOf: AS_OF, rules: [rule()], alerts: [alert()] }),
  );
  assert.deepEqual(projectAlertChannels(channelInput()), projectAlertChannels(channelInput()));
});
