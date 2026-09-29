import assert from "node:assert/strict";
import test from "node:test";

import {
  COVERAGE_GROUPS,
  budgetState,
  coverageCount,
  projectCoverage,
} from "./coverage.ts";

const AS_OF = "2026-08-24T12:00:00.000Z";

const input = (overrides = {}) => ({
  asOf: AS_OF,
  sources: [
    { sourceId: "arcus", label: "Arcus", state: "OK", entitlement: "PROVIDER_PUBLIC", observedAt: "2026-08-24T11:59:00.000Z", reason: null },
    { sourceId: "rhj", label: "Robinhood stock tokens", state: "FAILED", entitlement: "PROVIDER_PUBLIC", observedAt: null, reason: "The venue refused the read." },
    { sourceId: "stellar", label: "Stellar", state: "NEVER_OBSERVED", entitlement: "NONE", observedAt: null, reason: "No connection has ever been made." },
  ],
  data: {
    positions: { counted: 12, total: 18, uncounted: [{ reason: "No price at the valuation instant", count: 4 }, { reason: "No identity match", count: 2 }] },
    valuations: { counted: 12, total: 18, uncounted: [{ reason: "No price at the valuation instant", count: 6 }] },
    identities: { counted: 16, total: 18, uncounted: [{ reason: "No identity match", count: 2 }] },
  },
  budgets: {
    dataReadsPerDay: { declared: 200, recorded: 41 },
    aiCallsPerDay: { declared: 20, recorded: null },
    maxAlertsPerDay: { declared: null, recorded: null },
  },
  ...overrides,
});

test("the three groups are the canon's three", () => {
  assert.deepEqual([...COVERAGE_GROUPS], ["SOURCES", "DATA", "AI_BUDGET"]);
});

test("a count is counted-of-total with the uncounted named, never a bare percentage", () => {
  const count = coverageCount({ counted: 12, total: 18, uncounted: [{ reason: "No price", count: 6 }] });
  assert.equal(count.label, "12 of 18");
  assert.equal(count.counted, 12);
  assert.equal(count.total, 18);
  assert.deepEqual(count.uncounted, [{ reason: "No price", count: 6 }]);
  assert.equal("percent" in count, false, "a percentage hides its denominator and is not offered");
});

test("a count with nothing to count says so rather than reading as complete", () => {
  const count = coverageCount({ counted: 0, total: 0, uncounted: [] });
  assert.equal(count.state, "NOTHING_IN_SCOPE");
  assert.equal(count.label, "Nothing in scope");
});

test("a complete count is COMPLETE and an incomplete one is PARTIAL", () => {
  assert.equal(coverageCount({ counted: 18, total: 18, uncounted: [] }).state, "COMPLETE");
  assert.equal(coverageCount({ counted: 12, total: 18, uncounted: [{ reason: "r", count: 6 }] }).state, "PARTIAL");
});

test("a count whose uncounted reasons do not add up to the gap is refused", () => {
  assert.throws(
    () => coverageCount({ counted: 12, total: 18, uncounted: [{ reason: "No price", count: 2 }] }),
    /uncounted|account/i,
  );
});

test("an unrecorded budget is UNRECORDED, never zero", () => {
  const state = budgetState({ declared: 20, recorded: null });
  assert.equal(state.state, "UNRECORDED");
  assert.equal(state.recorded, null);
  assert.equal(state.label, "Unrecorded");
  assert.equal(state.figure, "Limit 20", "the tile shows the ceiling, not the state word twice");
  assert.match(state.reason, /nothing recorded|no record/i);
});

test("a declared budget with recorded spend reports both numbers", () => {
  const state = budgetState({ declared: 200, recorded: 41 });
  assert.equal(state.state, "WITHIN");
  assert.equal(state.label, "41 of 200");
  assert.equal(state.figure, "41 of 200");
});

test("no budget tile prints its own state word as its value", () => {
  for (const reading of [{ declared: 20, recorded: null }, { declared: null, recorded: null }, { declared: 20, recorded: 20 }, { declared: 200, recorded: 41 }]) {
    const state = budgetState(reading);
    const chip = state.state.replace(/_/g, " ").toLowerCase();
    assert.notEqual(state.figure.toLowerCase(), chip, JSON.stringify(reading) + " prints the same word twice");
  }
});

test("a budget at or over its declared limit is EXHAUSTED", () => {
  assert.equal(budgetState({ declared: 20, recorded: 20 }).state, "EXHAUSTED");
  assert.equal(budgetState({ declared: 20, recorded: 25 }).state, "EXHAUSTED");
});

test("an undeclared budget is NOT_DECLARED and is not treated as unlimited", () => {
  const state = budgetState({ declared: null, recorded: null });
  assert.equal(state.state, "NOT_DECLARED");
  assert.match(state.reason, /declare|mandate/i);
  assert.notEqual(state.label, "Unlimited");
});

test("recorded spend against no declared limit is still reported", () => {
  const state = budgetState({ declared: null, recorded: 7 });
  assert.equal(state.state, "NOT_DECLARED");
  assert.equal(state.recorded, 7);
  assert.match(state.label, /7/);
});

test("every tile names the surface that owns its fact and links to it", () => {
  const projection = projectCoverage(input());
  assert.ok(projection.tiles.length > 0);
  for (const tile of projection.tiles) {
    assert.ok(tile.owner.surface.length > 0, tile.tileId);
    assert.match(tile.owner.href, /^\/(app|agents)/, tile.tileId);
    assert.ok(COVERAGE_GROUPS.includes(tile.group), tile.tileId);
  }
});

test("a source nobody has ever observed is NEVER_OBSERVED, distinct from failed", () => {
  const projection = projectCoverage(input());
  const never = projection.sources.find((entry) => entry.sourceId === "stellar");
  assert.equal(never.state, "NEVER_OBSERVED");
  const failed = projection.sources.find((entry) => entry.sourceId === "rhj");
  assert.equal(failed.state, "FAILED");
  assert.notEqual(never.state, failed.state);
});

test("source coverage counts answered sources against declared ones", () => {
  const projection = projectCoverage(input());
  assert.equal(projection.sourceCoverage.counted, 1);
  assert.equal(projection.sourceCoverage.total, 3);
  assert.equal(projection.sourceCoverage.label, "1 of 3");
});

test("the surface state is DEGRADED while a declared source is failing", () => {
  assert.equal(projectCoverage(input()).state, "DEGRADED");
});

test("with every source answering and every position priced the surface is CALM", () => {
  const projection = projectCoverage(input({
    sources: [{ sourceId: "arcus", label: "Arcus", state: "OK", entitlement: "PROVIDER_PUBLIC", observedAt: AS_OF, reason: null }],
    data: {
      positions: { counted: 3, total: 3, uncounted: [] },
      valuations: { counted: 3, total: 3, uncounted: [] },
      identities: { counted: 3, total: 3, uncounted: [] },
    },
  }));
  assert.equal(projection.state, "CALM");
});

test("with nothing declared at all the surface is EMPTY and says where scope comes from", () => {
  const projection = projectCoverage(input({
    sources: [],
    data: {
      positions: { counted: 0, total: 0, uncounted: [] },
      valuations: { counted: 0, total: 0, uncounted: [] },
      identities: { counted: 0, total: 0, uncounted: [] },
    },
    budgets: {
      dataReadsPerDay: { declared: null, recorded: null },
      aiCallsPerDay: { declared: null, recorded: null },
      maxAlertsPerDay: { declared: null, recorded: null },
    },
  }));
  assert.equal(projection.state, "EMPTY");
  assert.match(projection.emptyReason, /connect|mandate/i);
});

test("compilation is pure: same input, same object, twice", () => {
  assert.deepEqual(projectCoverage(input()), projectCoverage(input()));
});
