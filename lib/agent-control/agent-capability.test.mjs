// Run from repo root: node --test lib/agent-control/agent-capability.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

const {
  AGENT_CAPABILITY_STATES,
  agentPassportDisplayName,
  agentPassportSearchText,
  deriveAgentCapabilities,
} = await import("./agent-capability.ts");

const OBSERVED_AT = "2026-08-21T10:00:00.000Z";

function source(id, kind, availability = "AVAILABLE", members = []) {
  return {
    id,
    kind,
    availability,
    observedAt: OBSERVED_AT,
    members,
  };
}

function fact(field, value, sourceIds, declaration = "PROVIDER_DECLARED") {
  return { id: `claim_${field}`, field, value, sourceIds, declaration, limitation: "Provider authority only." };
}

function passport(overrides = {}) {
  return {
    createdAt: OBSERVED_AT,
    request: { address: "agent1example" },
    sources: [
      source("agentverse-registry", "REGISTRY"),
      source("agentverse-search", "SEARCH"),
      source("agentverse-manifests", "MANIFESTS", "AVAILABLE", [
        { id: "manifest-a", availability: "AVAILABLE" },
      ]),
    ],
    providerClaims: [
      fact("address", "agent1example", ["agentverse-registry"]),
      fact("name", "Evidence operator", ["agentverse-search"]),
      fact("protocols", ["chat@1"], ["agentverse-registry"]),
      fact("endpoints", ["https://declared.invalid"], ["agentverse-registry"]),
      fact("rating", 4.5, ["agentverse-search"], "PROVIDER_REPORTED_METRIC"),
    ],
    ryntraObservations: [
      { kind: "ADDRESS_MATCH", value: true },
      { kind: "DECLARED_ENDPOINT_FETCH", value: false },
      { kind: "LIVENESS", value: "NOT_TESTED" },
    ],
    conflicts: [],
    unknowns: [],
    ...overrides,
  };
}

function byId(rows, id) {
  const row = rows.find((entry) => entry.id === id);
  assert.ok(row, `missing ${id}`);
  return row;
}

test("capability validation keeps discovery, observation and declaration separate", () => {
  const rows = deriveAgentCapabilities(passport());

  assert.equal(byId(rows, "address-binding").state, "OBSERVED");
  assert.equal(byId(rows, "public-profile").state, "DISCOVERED");
  assert.equal(byId(rows, "protocol-publication").state, "OBSERVED");
  assert.equal(byId(rows, "declared-endpoints").state, "DECLARED");
  assert.equal(byId(rows, "declared-endpoints").observed, "UNKNOWN");
  assert.equal(byId(rows, "provider-metrics").state, "DECLARED");
  assert.equal(byId(rows, "provider-metrics").observed, "UNKNOWN");
  assert.equal(rows.some((row) => row.state === "PROVEN"), false);
  assert.deepEqual(AGENT_CAPABILITY_STATES, [
    "DECLARED",
    "DISCOVERED",
    "OBSERVED",
    "PROVEN",
    "UNAVAILABLE",
    "CONFLICTING",
    "UNKNOWN",
  ]);
  assert.equal(rows.some((row) => "score" in row || "rank" in row), false);
});

test("conflicts and unavailable evidence never collapse into a weak success", () => {
  const conflicting = passport({
    conflicts: [{
      field: "endpoints",
      sourceIds: ["agentverse-registry", "agentverse-search"],
      reason: "Provider records disagree.",
    }],
  });
  assert.equal(byId(deriveAgentCapabilities(conflicting), "declared-endpoints").state, "CONFLICTING");

  const unavailable = passport({
    sources: [
      source("agentverse-registry", "REGISTRY"),
      source("agentverse-search", "SEARCH"),
      source("agentverse-manifests", "MANIFESTS", "UNAVAILABLE"),
    ],
  });
  const protocol = byId(deriveAgentCapabilities(unavailable), "protocol-publication");
  assert.equal(protocol.claimed, "DECLARED");
  assert.equal(protocol.observed, "UNAVAILABLE");
  assert.equal(protocol.state, "UNAVAILABLE");
});

test("display and filter text are projections of provider facts, not a second profile", () => {
  const value = passport();
  assert.equal(agentPassportDisplayName(value), "Evidence operator");
  assert.match(agentPassportSearchText(value), /evidence operator/);
  assert.match(agentPassportSearchText(value), /agent1example/);
  assert.match(agentPassportSearchText(value), /chat@1/);
});
