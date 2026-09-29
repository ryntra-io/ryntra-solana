import assert from "node:assert/strict";
import test from "node:test";

import {
  INVESTOR_CONTEXT_MAX_VERSIONS,
  createInvestorContextVersion,
  missingInvestorContextFields,
} from "./investor-context.ts";

const draft = {
  displayCurrency: "USD",
  horizon: "THREE_TO_SEVEN_YEARS",
  liquidityNeed: "MEDIUM",
  lossCapacity: "MEDIUM",
  riskTolerance: "LOW",
  goals: ["CAPITAL_PRESERVATION", "TRADING_DISCIPLINE"],
  excludedActivities: ["AUTOMATED_EXECUTION", "LEVERAGE"],
  notes: "User-declared context for paper and manual planning.",
};

function create(history, nextDraft = draft, sequence = history.length + 1) {
  return createInvestorContextVersion(history, nextDraft, {
    id: `ictx_${String(sequence).padStart(3, "0")}`,
    now: `2026-08-22T02:${String(sequence).padStart(2, "0")}:00.000Z`,
  });
}

test("the first InvestorContext is an immutable user declaration, never an opinion", () => {
  const result = create([]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.version, {
    id: "ictx_001",
    version: 1,
    declaredBy: "USER",
    createdAt: "2026-08-22T02:01:00.000Z",
    supersedesVersion: null,
    ...draft,
  });
  assert.equal(Object.hasOwn(result.version, "country"), false);
  assert.equal(Object.hasOwn(result.version, "eligibility"), false);
  assert.equal(Object.hasOwn(result.version, "recommendation"), false);
});

test("a material declaration creates a successor while the prior bytes remain unchanged", () => {
  const first = create([]);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const priorJson = JSON.stringify(first.history[0]);

  const second = create(first.history, { ...draft, liquidityNeed: "HIGH" }, 2);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.version.version, 2);
  assert.equal(second.version.supersedesVersion, 1);
  assert.equal(second.version.liquidityNeed, "HIGH");
  assert.equal(JSON.stringify(second.history[0]), priorJson);
});

test("normalization makes a semantically unchanged save a no-op", () => {
  const first = create([]);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const unchanged = create(first.history, {
    ...draft,
    goals: ["TRADING_DISCIPLINE", "CAPITAL_PRESERVATION"],
    excludedActivities: ["LEVERAGE", "AUTOMATED_EXECUTION"],
    notes: `  ${draft.notes}  `,
  }, 2);
  assert.deepEqual(unchanged, { ok: false, error: "UNCHANGED_CONTEXT" });
});

test("malformed, overlong and conclusion-shaped values are refused", () => {
  const invalid = [
    { ...draft, displayCurrency: "BTC" },
    { ...draft, horizon: "NEXT_WEEK" },
    { ...draft, goals: [] },
    { ...draft, goals: ["BUY_SOLANA"] },
    { ...draft, notes: "x".repeat(501) },
    { ...draft, notes: "bad\u0000note" },
    { ...draft, country: "US" },
    { ...draft, eligibility: "ELIGIBLE" },
  ];
  for (const candidate of invalid) {
    assert.equal(create([], candidate).ok, false, JSON.stringify(candidate));
  }
});

test("the version history has a hard bound", () => {
  const history = Array.from({ length: INVESTOR_CONTEXT_MAX_VERSIONS }, (_, index) => ({
    id: `ictx_${index + 1}`,
    version: index + 1,
    declaredBy: "USER",
    createdAt: `2026-08-21T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    supersedesVersion: index === 0 ? null : index,
    ...draft,
    notes: `Version ${index + 1}`,
  }));
  assert.deepEqual(create(history, { ...draft, notes: "One more" }, 51), {
    ok: false,
    error: "CONTEXT_VERSION_LIMIT_REACHED",
  });
});

test("missing fields remain explicit rather than becoming defaults", () => {
  assert.deepEqual(
    missingInvestorContextFields({
      ...draft,
      displayCurrency: "UNDECLARED",
      horizon: "UNDECLARED",
      goals: ["UNDECLARED"],
    }),
    ["displayCurrency", "horizon", "goals"],
  );
});
