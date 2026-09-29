import { test } from "node:test";
import assert from "node:assert/strict";
import { ExperimentLineageSchema, changedStrategySpecTopLevelFields, createNextLineage, createRootLineage } from "./lineage.ts";

const parentRunId = "11111111-1111-4111-8111-111111111111";
const parentSpec = {
  schemaVersion: 1,
  name: "Parent strategy",
  universe: { provider: "tradingview", symbol: "BYBIT:BTCUSDT", assetClass: "crypto" },
  timeframe: "4h",
  thesis: "Original thesis",
  indicators: [{ id: "trend", kind: "ema", source: "close", length: 200 }],
  entry: { kind: "compare", left: { kind: "price", source: "close" }, operator: "above", right: { kind: "indicator", id: "trend" } },
  exit: { kind: "compare", left: { kind: "price", source: "close" }, operator: "below", right: { kind: "indicator", id: "trend" } },
  stop: { kind: "percent", value: 2 },
  sizing: { kind: "risk_percent", value: 1 },
  filters: [],
  riskPolicy: { maxDrawdownPercent: 10, maxOpenPositions: 1, allowShort: false },
  costModel: { commissionBps: 10, spreadBps: 2, slippageBps: 3, fundingBpsPerDay: 0 },
  assumptions: ["Confirmed bars."],
};

test("top-level StrategySpec changes are exact, canonical, unique, and sorted", () => {
  const child = structuredClone(parentSpec);
  child.thesis = "Edited thesis";
  child.stop.value = 3;
  child.costModel.slippageBps = 5;
  child.universe = { assetClass: "crypto", symbol: "BYBIT:BTCUSDT", provider: "tradingview" };
  assert.deepEqual(changedStrategySpecTopLevelFields(parentSpec, child), ["costModel", "stop", "thesis"]);
  assert.deepEqual(changedStrategySpecTopLevelFields(parentSpec, structuredClone(parentSpec)), []);
});

test("root lineage is the only parentless iteration and has empty change metadata", () => {
  assert.deepEqual(createRootLineage(), {
    parentRunId: null,
    hypothesis: "",
    changedFields: [],
    userAttestedTestWindowSeenBeforeChange: false,
    iterationNumber: 1,
  });
  for (const invalid of [
    { parentRunId: null, hypothesis: "Changed something.", changedFields: [], userAttestedTestWindowSeenBeforeChange: false, iterationNumber: 1 },
    { parentRunId: null, hypothesis: "", changedFields: ["stop.value"], userAttestedTestWindowSeenBeforeChange: false, iterationNumber: 1 },
    { parentRunId: null, hypothesis: "", changedFields: [], userAttestedTestWindowSeenBeforeChange: true, iterationNumber: 1 },
    { parentRunId: null, hypothesis: "", changedFields: [], userAttestedTestWindowSeenBeforeChange: false, iterationNumber: 2 },
  ]) {
    assert.equal(ExperimentLineageSchema.safeParse(invalid).success, false);
  }
});

test("next lineage trims text, deduplicates fields, and records reveal state", () => {
  const lineage = createNextLineage({
    parentRunId,
    parentIteration: 2,
    hypothesis: "  Test a slower trend filter.  ",
    changedFields: [" stop.value ", "stop.value", " indicators.ema-filter.length "],
    parentTestWindowStatus: "revealed",
  });
  assert.deepEqual(lineage, {
    parentRunId,
    hypothesis: "Test a slower trend filter.",
    changedFields: ["indicators.ema-filter.length", "stop.value"],
    userAttestedTestWindowSeenBeforeChange: true,
    iterationNumber: 3,
  });
});

test("strict child lineage rejects unknown or unsafe persistence data", () => {
  const valid = {
    parentRunId,
    hypothesis: " Test the stop parameter. ",
    changedFields: [" stop.value ", "stop.value"],
    userAttestedTestWindowSeenBeforeChange: false,
    iterationNumber: 2,
  };
  assert.deepEqual(ExperimentLineageSchema.parse(valid).changedFields, ["stop.value"]);
  assert.equal(ExperimentLineageSchema.safeParse({ ...valid, unexpected: true }).success, false);
  for (const iterationNumber of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1, 1.5]) {
    assert.equal(ExperimentLineageSchema.safeParse({ ...valid, iterationNumber }).success, false);
  }
});

test("lineage creation rejects malformed identifiers, blank fields, and unsafe iteration math", () => {
  const base = {
    parentRunId,
    parentIteration: 1,
    hypothesis: "Test the stop parameter.",
    changedFields: ["stop.value"],
    parentTestWindowStatus: "sealed",
  };
  for (const override of [
    { parentRunId: "not-a-uuid" },
    { hypothesis: "   " },
    { hypothesis: "x".repeat(501) },
    { changedFields: [] },
    { changedFields: ["stop.value", "   "] },
    { changedFields: Array.from({ length: 33 }, (_, index) => "field." + index) },
    { parentIteration: 0 },
    { parentIteration: -1 },
    { parentIteration: 1.5 },
    { parentIteration: Number.NaN },
    { parentIteration: Number.POSITIVE_INFINITY },
    { parentIteration: Number.MAX_SAFE_INTEGER },
  ]) {
    assert.throws(() => createNextLineage({ ...base, ...override }));
  }
});
