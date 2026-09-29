import assert from "node:assert/strict";
import test from "node:test";

import { STRATEGY_UNRECORDABLE_STATES, projectStrategies, strategyRuleFields } from "./read-model.ts";

const spec = (overrides = {}) => ({
  schemaVersion: 1,
  name: "TSLA momentum",
  universe: { provider: "tradingview", symbol: "TSLA", assetClass: "equity" },
  timeframe: "1h",
  thesis: "Momentum after a gap.",
  indicators: [],
  entry: { kind: "all", nodes: [] },
  exit: { kind: "all", nodes: [] },
  stop: { kind: "percent", value: 2 },
  sizing: { kind: "risk_percent", value: 1 },
  filters: [],
  riskPolicy: { maxDrawdownPercent: 20, maxOpenPositions: 1, allowShort: false },
  costModel: { commissionBps: 5, spreadBps: 2, slippageBps: 3, fundingBpsPerDay: 0 },
  assumptions: [],
  ...overrides,
});

const version = (number, overrides = {}) => ({
  versionId: "v" + number,
  versionNumber: number,
  recordedAt: "2026-08-2" + number + "T10:00:00.000Z",
  approvedAt: "2026-08-2" + number + "T10:00:00.000Z",
  specHash: "h" + number,
  spec: spec(),
  ...overrides,
});

const run = (overrides = {}) => ({
  runId: "run_1",
  versionId: "v1",
  createdAt: "2026-08-22T11:00:00.000Z",
  dataset: "TradingView export, TSLA 1h",
  datasetVersion: "pine-8f2c",
  engineVersion: "backtest-1",
  costsIncluded: true,
  commissionBps: 5,
  spreadBps: 2,
  slippageBps: 3,
  fundingBpsPerDay: 0,
  missingDataBars: 0,
  missingDataReason: null,
  maxDrawdownPercent: 12.5,
  outOfSample: "blind",
  forwardEvidence: true,
  parameterSensitivity: "stable",
  regimesCovered: 3,
  trades: 84,
  ...overrides,
});

const record = (overrides = {}) => ({
  strategyId: "s1",
  title: "TSLA momentum",
  createdAt: "2026-08-21T10:00:00.000Z",
  updatedAt: "2026-08-22T11:00:00.000Z",
  versions: [version(1)],
  runs: [],
  ...overrides,
});

const input = (overrides = {}) => ({
  asOf: "2026-08-23T10:00:00.000Z",
  records: [record()],
  recovery: [],
  ...overrides,
});

test("no strategy is an empty surface with a reason, not a zero", () => {
  const projection = projectStrategies(input({ records: [] }));
  assert.equal(projection.state, "EMPTY");
  assert.deepEqual(projection.strategies, []);
  assert.equal(projection.counts.strategies, 0);
});

test("a strategy with a version and no run is a Draft, and the reason says why", () => {
  const [strategy] = projectStrategies(input()).strategies;
  assert.equal(strategy.state, "DRAFT");
  assert.match(strategy.stateReason, /no backtest|no run/i);
});

test("an incomplete run is Backtest; complete evidence with forward proof is Forward paper", () => {
  const incomplete = projectStrategies(
    input({ records: [record({ runs: [run({ costsIncluded: false, forwardEvidence: false })] })] }),
  ).strategies[0];
  assert.equal(incomplete.state, "BACKTEST");

  const complete = projectStrategies(input({ records: [record({ runs: [run()] })] })).strategies[0];
  assert.equal(complete.state, "FORWARD_PAPER");
});

test("no derived state is ever Approved, Active or Review, because nothing records that transition", () => {
  const states = STRATEGY_UNRECORDABLE_STATES.map((entry) => entry.state);
  assert.deepEqual(states, ["APPROVED", "ACTIVE", "REVIEW", "PAUSED", "INVALIDATED", "EXPIRED", "ARCHIVED"]);
  for (const entry of STRATEGY_UNRECORDABLE_STATES) assert.ok(entry.reason.length > 0);

  const projection = projectStrategies(input({ records: [record({ runs: [run()] })] }));
  for (const strategy of projection.strategies) {
    assert.equal(states.includes(strategy.state), false, "a state nothing records must never be derived");
  }
  assert.deepEqual(projection.unreachable, STRATEGY_UNRECORDABLE_STATES);
});

test("a version that changed no rule is shown as one, rather than as a rule change", () => {
  const projection = projectStrategies(
    input({ records: [record({ versions: [version(1), version(2, { spec: spec({ name: "Renamed" }) })] })] }),
  );
  const [change] = projection.strategies[0].materialChanges;
  assert.equal(change.fromVersion, 1);
  assert.equal(change.toVersion, 2);
  assert.deepEqual(change.fields, []);
  assert.match(change.reason, /no rule/i);
});

test("a moved stop is a material change and is named field by field", () => {
  const moved = version(2, { spec: spec({ stop: { kind: "percent", value: 4 } }) });
  const projection = projectStrategies(input({ records: [record({ versions: [version(1), moved] })] }));
  assert.deepEqual(projection.strategies[0].materialChanges[0].fields, ["stopPercent"]);
});

test("the rule fields are flattened from the spec, so a nested change is still a rule change", () => {
  const before = strategyRuleFields(spec());
  const after = strategyRuleFields(spec({ universe: { provider: "tradingview", symbol: "AAPL", assetClass: "equity" } }));
  assert.equal(before.symbol, "TSLA");
  assert.equal(after.symbol, "AAPL");
  assert.equal(before.stopPercent, 2);
  assert.equal(before.commissionBps, 5);
});

test("the projection carries no evidence score, quality or verdict from the lab", () => {
  const text = JSON.stringify(projectStrategies(input({ records: [record({ runs: [run()] })] }))).toLowerCase();
  for (const word of ['"score"', '"quality"', '"verdict"', "confidence"]) {
    assert.equal(text.includes(word), false, "the Home projection must not carry " + word);
  }
});

test("a strategy links to its own route and never to a second editor", () => {
  const [strategy] = projectStrategies(input()).strategies;
  assert.equal(strategy.href, "/app/strategies/s1");
});

test("a failed read is carried as recovery rather than as an empty account", () => {
  const projection = projectStrategies(input({ records: [], recovery: ["The strategy read did not complete."] }));
  assert.equal(projection.state, "DEGRADED");
  assert.deepEqual(projection.recovery, ["The strategy read did not complete."]);
});

test("the same records always project the same way", () => {
  assert.deepEqual(projectStrategies(input()), projectStrategies(input()));
});

test("lifecycle authority is the user's, and the projection says so once", () => {
  assert.equal(projectStrategies(input()).lifecycleAuthority, "USER");
});
