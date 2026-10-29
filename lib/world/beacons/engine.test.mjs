import assert from "node:assert/strict";
import test from "node:test";

import { FRESH_STATE, RULE_LIMIT, firingKey, fresh, inQuiet, levelTruth, ruleId, sanitizeFrame, sanitizeList, slackOf, stepRule } from "./engine.ts";

/*
 * The engine's behaviour, carried over with it from the terminal's alerts,
 * on a family of one level and one happening: a level fires on its crossing, holds, pauses, arms again past
 * its slack; a happening fires on itself.
 */

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);

const KIT = {
  isEvent: (condition) => condition.kind === "event",
  truth(condition, world, rule, loose) {
    if (condition.kind === "event") return world.events.includes(condition.name);
    const value = world.at === null ? null : (fresh({ at: world.at, value: world.value }, world.now, 90_000)?.value ?? null);
    return levelTruth(value, condition.op, condition.value, loose ? slackOf(condition.value, rule.hysteresis, 0) : 0);
  },
};

const sanitizeCondition = (raw) =>
  raw && raw.kind === "level" && (raw.op === "above" || raw.op === "below") && Number.isFinite(raw.value)
    ? { kind: "level", op: raw.op, value: raw.value }
    : raw && raw.kind === "event" && typeof raw.name === "string"
      ? { kind: "event", name: raw.name }
      : null;

const rule = (over = {}) =>
  sanitizeFrame(
    { id: "rule01", version: 1, groups: [[{ kind: "level", op: "above", value: 100 }]], holdSeconds: 0, hysteresis: 0.01, cooldownSeconds: 0, repeat: true, expiresAt: null, quiet: null, on: true, createdAt: T0, ...over },
    sanitizeCondition,
  );

const world = ({ now = T0, value = 90, at = now, events = [] } = {}) => ({ now, value, at, events });

function run(r, values) {
  let state = FRESH_STATE;
  const fired = [];
  values.forEach((value, i) => {
    const step = stepRule(KIT, r, state, world({ now: T0 + i * 1000, value }));
    state = step.state;
    if (step.fire) fired.push(i);
  });
  return fired;
}

test("a level fires when it starts to hold, not when it already holds on first sight", () => {
  assert.deepEqual(run(rule(), [90, 95, 101, 102]), [2]);
  assert.deepEqual(run(rule(), [101, 102, 103]), []);
  assert.deepEqual(run(rule(), [101, 90, 101]), [2]);
});

test("hysteresis: a level hovering on the line fires once; it arms again only past the slack", () => {
  assert.deepEqual(run(rule(), [90, 101, 99.5, 101, 98.9, 101]), [1, 5]);
  assert.deepEqual(run(rule(), [99.5, 100.5]), [1]);
});

test("hold and pause", () => {
  assert.deepEqual(run(rule({ holdSeconds: 2 }), [90, 101, 101, 101]), [3]);
  assert.deepEqual(run(rule({ holdSeconds: 2 }), [90, 101, 101, 99, 101, 101]), []);
  assert.deepEqual(run(rule({ cooldownSeconds: 3 }), [90, 101, 90, 101, 101, 101]), [1, 4]);
});

test("not known: neither fires nor arms, and the hold starts over", () => {
  const r = rule();
  let state = stepRule(KIT, r, FRESH_STATE, world({ value: 90 })).state;
  const stale = stepRule(KIT, r, state, world({ now: T0 + 1000, value: 150, at: T0 - 100_000 }));
  assert.equal(stale.fire, false);
  assert.equal(stale.status, "unknown");
  assert.equal(stepRule(KIT, r, stale.state, world({ now: T0 + 2000, value: 150 })).fire, true);
  /* A view from the future is not believed either. */
  assert.equal(stepRule(KIT, r, stale.state, world({ now: T0 + 2000, value: 150, at: T0 + 60_000 })).fire, false);
});

test("off and expired rules do nothing", () => {
  assert.deepEqual(run(rule({ on: false }), [90, 101]), []);
  assert.deepEqual(run(rule({ expiresAt: T0 + 500 }), [90, 101]), []);
});

test("and / or: a group holds only whole; any group fires; not known and false is not known", () => {
  const r = rule({ groups: [[{ kind: "level", op: "above", value: 100 }, { kind: "level", op: "below", value: 200 }], [{ kind: "level", op: "below", value: 50 }]] });
  assert.deepEqual(run(r, [90, 101]), [1]);
  assert.deepEqual(run(r, [90, 250]), []);
  assert.deepEqual(run(r, [90, 40]), [1]);
  const state = stepRule(KIT, r, FRESH_STATE, world({ value: 90 })).state;
  assert.equal(stepRule(KIT, r, state, world({ now: T0 + 1000, value: 150, at: null })).status, "unknown");
});

test("a happening fires on itself, past the pause; beside a level it never makes the level fire while it merely holds", () => {
  const r = rule({ cooldownSeconds: 10, groups: [[{ kind: "event", name: "whale" }]] });
  let step = stepRule(KIT, r, FRESH_STATE, world({ events: ["whale"] }));
  assert.equal(step.fire, true);
  step = stepRule(KIT, r, step.state, world({ now: T0 + 2000, events: ["whale"] }));
  assert.equal(step.fire, false, "inside the pause");
  assert.equal(stepRule(KIT, r, step.state, world({ now: T0 + 11_000, events: ["whale"] })).fire, true);
  const mixed = rule({ groups: [[{ kind: "event", name: "whale" }], [{ kind: "level", op: "above", value: 100 }]] });
  assert.deepEqual(run(mixed, [150, 150, 150]), []);
  assert.deepEqual(run(mixed, [90, 101, 102]), [1]);
  const holding = stepRule(KIT, mixed, FRESH_STATE, world({ value: 150 })).state;
  assert.equal(stepRule(KIT, mixed, holding, world({ now: T0 + 1000, value: 150, events: ["whale"] })).fire, true);
});

test("checked: groups and conditions within their limits, a list within its own", () => {
  assert.equal(rule({ groups: [] }), null);
  assert.equal(rule({ groups: [[{ kind: "eval", code: "1" }]] }), null);
  assert.equal(rule({ groups: [[1, 2, 3, 4, 5].map(() => ({ kind: "level", op: "above", value: 1 }))] }), null);
  assert.equal(rule({ id: "<script>" }), null);
  assert.equal(rule({ version: 0 }), null);
  assert.equal(rule({ hysteresis: 5 }).hysteresis, 0.002);
  assert.equal(rule({ quiet: { from: 60, to: 60, zone: "Europe/Kyiv" } }).quiet, null);
  assert.deepEqual(rule({ quiet: { from: 1380, to: 420, zone: "Europe/Kyiv" } }).quiet, { from: 1380, to: 420, zone: "Europe/Kyiv" });
  const many = Array.from({ length: RULE_LIMIT + 5 }, (_, i) => ({ ...rule(), id: `rule${String(i).padStart(3, "0")}` }));
  assert.equal(sanitizeList(many, (raw) => sanitizeFrame(raw, sanitizeCondition)).length, RULE_LIMIT);
  assert.deepEqual(sanitizeList("nope", (raw) => raw), []);
});

test("quiet hours across midnight, the firing key, a rule's id", () => {
  const night = { from: 1380, to: 420, zone: "UTC" };
  assert.equal(inQuiet(night, Date.UTC(2026, 9, 16, 23, 30)), true);
  assert.equal(inQuiet(night, Date.UTC(2026, 9, 16, 12, 0)), false);
  assert.equal(firingKey({ id: "rule01", version: 3 }, T0), `rule01:3:${T0}`);
  assert.match(ruleId(() => 0.5, T0), /^[a-z0-9]{4,24}$/);
});
