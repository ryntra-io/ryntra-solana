import assert from "node:assert/strict";
import test from "node:test";

import {
  OPERATIONS_AUTHORITY,
  OPERATION_GROUPS,
  buildOperations,
  deriveIncidents,
} from "./operations.ts";

const AS_OF = "2026-08-24T12:00:00.000Z";

const provider = (overrides = {}) => ({
  providerId: "arcus",
  label: "Arcus",
  state: "UP",
  observedAt: "2026-08-24T11:59:00.000Z",
  firstFailureAt: null,
  reason: null,
  affects: ["Portfolio valuation", "Market data"],
  degradationPolicy: "Serve the last observed quote with its age; refuse any calculation that needs a current one.",
  owner: { surface: "Connections", href: "/app/connect" },
  ...overrides,
});

const down = (overrides = {}) => provider({
  providerId: "rhj",
  label: "Robinhood stock tokens",
  state: "DOWN",
  observedAt: null,
  firstFailureAt: "2026-08-24T09:00:00.000Z",
  reason: "The venue refused the read from this jurisdiction.",
  affects: ["Corporate actions", "Stock token prices"],
  ...overrides,
});

const killSwitch = (overrides = {}) => ({
  switchId: "agent-commitments",
  label: "Agent commitments",
  state: "ARMED",
  authority: "Agent Control",
  reason: "Nothing has tripped it.",
  owner: { surface: "Agent Control", href: "/agents/workspace" },
  ...overrides,
});

const input = (overrides = {}) => ({
  asOf: AS_OF,
  providers: [provider(), down()],
  killSwitches: [killSwitch()],
  perimeter: {
    state: "BLOCKED",
    disclaimer: "This is a record… not a Ryntra legal opinion…",
    operations: [
      { operation: "PERSONALIZED_ADVICE", state: "BLOCKED", code: "NO_RECORD", reason: "No record.", instrumentClass: "TOKENIZED_EQUITY", userContextVersion: "ctx", record: null, conflicts: [], providerRole: "NONE", limitations: [], unknowns: [], effectiveAt: null, expiresAt: null, reviewAt: null },
      { operation: "ORDER_TRANSMISSION", state: "BLOCKED", code: "NO_RECORD", reason: "No record.", instrumentClass: "TOKENIZED_EQUITY", userContextVersion: "ctx", record: null, conflicts: [], providerRole: "NONE", limitations: [], unknowns: [], effectiveAt: null, expiresAt: null, reviewAt: null },
      { operation: "DISCRETIONARY_MANAGEMENT", state: "BLOCKED", code: "NO_RECORD", reason: "No record.", instrumentClass: "TOKENIZED_EQUITY", userContextVersion: "ctx", record: null, conflicts: [], providerRole: "NONE", limitations: [], unknowns: [], effectiveAt: null, expiresAt: null, reviewAt: null },
    ],
  },
  ...overrides,
});

test("the five groups are declared and the authority is read-only", () => {
  assert.deepEqual([...OPERATION_GROUPS], ["PROVIDERS", "INCIDENTS", "RECOVERY", "KILL_SWITCH", "PERIMETER"]);
  assert.equal(OPERATIONS_AUTHORITY, "READ_ONLY");
  assert.equal(buildOperations(input()).authority, "READ_ONLY");
});

test("an incident is derived from an observed failure, never authored", () => {
  const incidents = deriveIncidents({ providers: [provider(), down()], asOf: AS_OF });
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].providerId, "rhj");
  assert.equal(incidents[0].state, "OPEN");
  assert.equal(incidents[0].firstObservedAt, "2026-08-24T09:00:00.000Z");
  assert.deepEqual([...incidents[0].affects], ["Corporate actions", "Stock token prices"]);
});

test("a healthy provider produces no incident, and there is no way to add one", () => {
  assert.deepEqual(deriveIncidents({ providers: [provider()], asOf: AS_OF }), []);
  const projection = buildOperations({ ...input(), providers: [provider()], incidents: [{ incidentId: "invented", state: "OPEN" }] });
  assert.equal(projection.incidents.length, 0, "an injected incident is ignored: incidents are derived");
});

test("a degraded provider raises an incident too, in a recovering state", () => {
  const incidents = deriveIncidents({
    providers: [provider({ state: "DEGRADED", firstFailureAt: "2026-08-24T10:00:00.000Z", reason: "Answering slowly." })],
    asOf: AS_OF,
  });
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].state, "RECOVERING");
});

test("a provider that failed with no recorded first failure says so instead of guessing a start", () => {
  const incidents = deriveIncidents({ providers: [down({ firstFailureAt: null })], asOf: AS_OF });
  assert.equal(incidents[0].firstObservedAt, null);
  assert.match(incidents[0].reason, /not recorded|unknown/i);
});

test("recovery states what happens to each affected capability while the provider is down", () => {
  const projection = buildOperations(input());
  assert.ok(projection.recovery.length > 0);
  for (const entry of projection.recovery) {
    assert.ok(["REFUSED", "SERVED_STALE", "UNAVAILABLE", "UNAFFECTED"].includes(entry.behaviour), entry.capability);
    assert.ok(entry.detail.length > 0, entry.capability);
  }
  const affected = projection.recovery.find((entry) => entry.capability === "Corporate actions");
  assert.equal(affected.behaviour, "UNAVAILABLE");
});

test("a capability behind a provider that only degraded is served stale with its age, not refused", () => {
  const projection = buildOperations(input({
    providers: [provider({ state: "DEGRADED", firstFailureAt: "2026-08-24T10:00:00.000Z", observedAt: "2026-08-24T10:00:00.000Z", reason: "Slow." })],
  }));
  const entry = projection.recovery.find((item) => item.capability === "Portfolio valuation");
  assert.equal(entry.behaviour, "SERVED_STALE");
  assert.equal(entry.observedAt, "2026-08-24T10:00:00.000Z", "the age is a field, not an instant buried in a sentence");
  assert.equal(/\d{4}-\d{2}-\d{2}T/.test(entry.detail), false, "no machine instant inside a sentence a person reads");
});

test("kill switches are shown with their authority and never thrown from here", () => {
  const projection = buildOperations(input());
  assert.equal(projection.killSwitches.length, 1);
  const shown = projection.killSwitches[0];
  assert.equal(shown.state, "ARMED");
  assert.equal(shown.authority, "Agent Control");
  assert.match(shown.owner.href, /^\/agents/);
  const serialized = JSON.stringify(projection);
  for (const verb of ["trip", "pause", "resume", "revoke", "authorize", "disable"]) {
    assert.equal(serialized.includes('"' + verb), false, verb + " must not be a control on this projection");
  }
});

test("a kill switch with no owning surface is refused", () => {
  assert.throws(
    () => buildOperations(input({ killSwitches: [killSwitch({ owner: { surface: "", href: "" } })] })),
    /owner|surface/i,
  );
});

test("the perimeter is carried through with all three operations and its disclaimer", () => {
  const projection = buildOperations(input());
  assert.equal(projection.perimeter.operations.length, 3);
  assert.equal(projection.perimeter.state, "BLOCKED");
  assert.ok(projection.perimeter.disclaimer.length > 0);
});

test("the surface state is DOWN while a provider is down, DEGRADED while one is degraded, CALM otherwise", () => {
  assert.equal(buildOperations(input()).state, "DOWN");
  assert.equal(buildOperations(input({ providers: [provider({ state: "DEGRADED", firstFailureAt: AS_OF, reason: "Slow." })] })).state, "DEGRADED");
  assert.equal(buildOperations(input({ providers: [provider()] })).state, "CALM");
});

test("with no provider declared at all the surface is UNKNOWN, never CALM", () => {
  const projection = buildOperations(input({ providers: [] }));
  assert.equal(projection.state, "UNKNOWN");
  assert.match(projection.emptyReason, /connect|declare/i);
});

test("compilation is pure: same input, same object, twice", () => {
  assert.deepEqual(buildOperations(input()), buildOperations(input()));
});
