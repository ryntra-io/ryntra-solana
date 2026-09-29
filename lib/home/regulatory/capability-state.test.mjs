import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMISSIBLE_SOURCE_KINDS,
  INADMISSIBLE_SOURCE_KINDS,
  REGULATED_OPERATIONS,
  evaluateRegulatoryCapability,
  regulatoryPerimeter,
} from "./capability-state.ts";

const AS_OF = "2026-08-24T12:00:00.000Z";

const scope = (overrides = {}) => ({
  userContextVersion: "ctx-7f3a",
  instrumentClass: "TOKENIZED_EQUITY",
  operation: "PERSONALIZED_ADVICE",
  ...overrides,
});

/** A record that is complete, admissible, in scope and current. */
const record = (overrides = {}) => ({
  recordId: "reg-1",
  source: {
    kind: "PROVIDER_CONTRACT",
    reference: "Provider agreement §4.2",
    observedAt: "2026-08-20T09:00:00.000Z",
  },
  scope: scope(),
  effectiveAt: "2026-08-20T09:00:00.000Z",
  expiresAt: "2026-12-31T00:00:00.000Z",
  reviewAt: "2026-11-30T00:00:00.000Z",
  providerRole: "ADVISER",
  limitations: ["Tokenized equity only."],
  unknowns: [],
  permits: true,
  ...overrides,
});

test("the three regulated operations are exactly the canon's three", () => {
  assert.deepEqual([...REGULATED_OPERATIONS], [
    "PERSONALIZED_ADVICE",
    "ORDER_TRANSMISSION",
    "DISCRETIONARY_MANAGEMENT",
  ]);
});

test("with no record at all the operation is BLOCKED, not permitted by default", () => {
  const state = evaluateRegulatoryCapability({ records: [], scope: scope(), asOf: AS_OF });
  assert.equal(state.state, "BLOCKED");
  assert.equal(state.code, "NO_RECORD");
  assert.match(state.reason, /no record/i);
  assert.equal(state.record, null);
});

test("a complete admissible in-scope current record is the only way to reach ALLOWED", () => {
  const state = evaluateRegulatoryCapability({ records: [record()], scope: scope(), asOf: AS_OF });
  assert.equal(state.state, "ALLOWED");
  assert.equal(state.code, "RECORDED");
  assert.equal(state.record.recordId, "reg-1");
  assert.equal(state.providerRole, "ADVISER");
});

test("advice cannot be activated from UI copy", () => {
  const state = evaluateRegulatoryCapability({
    records: [record({ source: { kind: "UI_COPY", reference: "The site says we advise", observedAt: AS_OF } })],
    scope: scope(),
    asOf: AS_OF,
  });
  assert.equal(state.state, "BLOCKED");
  assert.equal(state.code, "INADMISSIBLE_SOURCE");
  assert.match(state.reason, /copy/i);
});

test("advice cannot be activated from a generic jurisdiction label", () => {
  const state = evaluateRegulatoryCapability({
    records: [record({ source: { kind: "JURISDICTION_LABEL", reference: "User is in the EU", observedAt: AS_OF } })],
    scope: scope(),
    asOf: AS_OF,
  });
  assert.equal(state.state, "BLOCKED");
  assert.equal(state.code, "INADMISSIBLE_SOURCE");
  assert.match(state.reason, /jurisdiction/i);
});

test("an inferred record is inadmissible too, and the two lists never overlap", () => {
  const state = evaluateRegulatoryCapability({
    records: [record({ source: { kind: "INFERENCE", reference: "Derived from the venue list", observedAt: AS_OF } })],
    scope: scope(),
    asOf: AS_OF,
  });
  assert.equal(state.code, "INADMISSIBLE_SOURCE");
  for (const kind of INADMISSIBLE_SOURCE_KINDS) {
    assert.ok(!ADMISSIBLE_SOURCE_KINDS.includes(kind), kind + " cannot be both");
  }
});

test("an expired record fails closed", () => {
  const state = evaluateRegulatoryCapability({
    records: [record({ expiresAt: "2026-08-01T00:00:00.000Z" })],
    scope: scope(),
    asOf: AS_OF,
  });
  assert.equal(state.state, "BLOCKED");
  assert.equal(state.code, "EXPIRED");
});

test("a record that has not taken effect yet fails closed", () => {
  const state = evaluateRegulatoryCapability({
    records: [record({ effectiveAt: "2026-09-01T00:00:00.000Z" })],
    scope: scope(),
    asOf: AS_OF,
  });
  assert.equal(state.state, "BLOCKED");
  assert.equal(state.code, "NOT_YET_EFFECTIVE");
});

test("a record observed longer ago than its freshness policy allows is stale, and stale fails closed", () => {
  const state = evaluateRegulatoryCapability({
    records: [record({ source: { kind: "PROVIDER_CONTRACT", reference: "r", observedAt: "2025-01-01T00:00:00.000Z" } })],
    scope: scope(),
    asOf: AS_OF,
    policy: { maxAgeSeconds: 60 * 60 * 24 * 30 },
  });
  assert.equal(state.state, "BLOCKED");
  assert.equal(state.code, "STALE");
});

test("an overdue review fails closed rather than being shown as a warning on an allowed state", () => {
  const state = evaluateRegulatoryCapability({
    records: [record({ reviewAt: "2026-08-01T00:00:00.000Z" })],
    scope: scope(),
    asOf: AS_OF,
  });
  assert.equal(state.state, "BLOCKED");
  assert.equal(state.code, "REVIEW_OVERDUE");
});

test("a record carrying an unknown fails closed and names the unknown", () => {
  const state = evaluateRegulatoryCapability({
    records: [record({ unknowns: ["Whether the provider covers fractional lots."] })],
    scope: scope(),
    asOf: AS_OF,
  });
  assert.equal(state.state, "BLOCKED");
  assert.equal(state.code, "UNKNOWNS_PRESENT");
  assert.match(state.reason, /fractional lots/);
});

test("two records that disagree fail closed as a conflict, and both are kept", () => {
  const state = evaluateRegulatoryCapability({
    records: [record(), record({ recordId: "reg-2", permits: false })],
    scope: scope(),
    asOf: AS_OF,
  });
  assert.equal(state.state, "BLOCKED");
  assert.equal(state.code, "CONFLICTING_RECORDS");
  assert.deepEqual(state.conflicts.map((entry) => entry.recordId), ["reg-1", "reg-2"]);
});

test("a record for another operation, instrument class or context version does not count", () => {
  for (const mismatch of [
    { operation: "ORDER_TRANSMISSION" },
    { instrumentClass: "SPOT_CRYPTO" },
    { userContextVersion: "ctx-other" },
  ]) {
    const state = evaluateRegulatoryCapability({
      records: [record({ scope: scope(mismatch) })],
      scope: scope(),
      asOf: AS_OF,
    });
    assert.equal(state.state, "BLOCKED", JSON.stringify(mismatch));
    assert.equal(state.code, "NO_RECORD", JSON.stringify(mismatch));
  }
});

test("a record with no provider role fails closed", () => {
  const state = evaluateRegulatoryCapability({
    records: [record({ providerRole: "NONE" })],
    scope: scope(),
    asOf: AS_OF,
  });
  assert.equal(state.state, "BLOCKED");
  assert.equal(state.code, "NO_PROVIDER_ROLE");
});

test("a record whose own answer is that it does not permit the operation is BLOCKED, not absent", () => {
  const state = evaluateRegulatoryCapability({
    records: [record({ permits: false })],
    scope: scope(),
    asOf: AS_OF,
  });
  assert.equal(state.state, "BLOCKED");
  assert.equal(state.code, "NOT_PERMITTED");
  assert.equal(state.record.recordId, "reg-1");
});

test("the perimeter answers all three operations and today refuses all three", () => {
  const perimeter = regulatoryPerimeter({
    records: [],
    userContextVersion: "ctx-7f3a",
    instrumentClass: "TOKENIZED_EQUITY",
    asOf: AS_OF,
  });
  assert.equal(perimeter.operations.length, 3);
  assert.deepEqual(perimeter.operations.map((entry) => entry.operation), [...REGULATED_OPERATIONS]);
  for (const entry of perimeter.operations) {
    assert.equal(entry.state, "BLOCKED");
    assert.ok(entry.reason.length > 0);
  }
  assert.equal(perimeter.state, "BLOCKED");
});

test("the perimeter says what it is not", () => {
  const perimeter = regulatoryPerimeter({
    records: [],
    userContextVersion: "ctx-7f3a",
    instrumentClass: "TOKENIZED_EQUITY",
    asOf: AS_OF,
  });
  assert.match(perimeter.disclaimer, /not a Ryntra legal opinion/i);
  assert.match(perimeter.disclaimer, /denylist/i);
  assert.match(perimeter.disclaimer, /eligibility/i);
});

test("compilation is pure — the same inputs produce the same object twice", () => {
  const once = regulatoryPerimeter({ records: [record()], userContextVersion: "ctx-7f3a", instrumentClass: "TOKENIZED_EQUITY", asOf: AS_OF });
  const twice = regulatoryPerimeter({ records: [record()], userContextVersion: "ctx-7f3a", instrumentClass: "TOKENIZED_EQUITY", asOf: AS_OF });
  assert.deepEqual(once, twice);
});

test("an unknown operation cannot be evaluated", () => {
  assert.throws(
    () => evaluateRegulatoryCapability({ records: [], scope: scope({ operation: "ANYTHING_ELSE" }), asOf: AS_OF }),
    /operation/i,
  );
});
