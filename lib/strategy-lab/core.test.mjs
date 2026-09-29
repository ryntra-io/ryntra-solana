import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStrategySpec } from "./validation.ts";
import { compilePineV6, PINE_COMPILER_VERSION } from "./pine.ts";
import { parseTradingViewImport } from "./tradingview-import.ts";
import { applyCostModel, evaluateEvidence } from "./evidence.ts";
import { createNextLineage } from "./lineage.ts";

const validSpec = (overrides = {}) => ({
  schemaVersion: 1,
  name: "BTC RSI mean reversion",
  universe: { provider: "tradingview", symbol: "BYBIT:BTCUSDT", assetClass: "crypto" },
  timeframe: "4h",
  thesis: "Buy oversold reversals only when the broader trend remains constructive.",
  indicators: [
    { id: "rsi-main", kind: "rsi", source: "close", length: 14 },
    { id: "ema-filter", kind: "ema", source: "close", length: 200 },
  ],
  entry: {
    kind: "all",
    rules: [
      { kind: "compare", left: { kind: "indicator", id: "rsi-main" }, operator: "crosses_above", right: { kind: "number", value: 30 } },
      { kind: "compare", left: { kind: "price", source: "close" }, operator: "above", right: { kind: "indicator", id: "ema-filter" } },
    ],
  },
  exit: {
    kind: "any",
    rules: [
      { kind: "compare", left: { kind: "indicator", id: "rsi-main" }, operator: "above", right: { kind: "number", value: 55 } },
    ],
  },
  stop: { kind: "percent", value: 2.5 },
  sizing: { kind: "risk_percent", value: 1 },
  filters: [],
  riskPolicy: { maxDrawdownPercent: 12, maxOpenPositions: 1, allowShort: false },
  costModel: { commissionBps: 10, spreadBps: 5, slippageBps: 8, fundingBpsPerDay: 0 },
  assumptions: ["Signals execute on confirmed bar close."],
  ...overrides,
});

test("StrategySpec accepts the supported bounded AST", () => {
  const result = validateStrategySpec(validSpec());
  assert.equal(result.ok, true);
  assert.equal(result.value.indicators.length, 2);
});

test("StrategySpec rejects unsupported indicators and arbitrary code", () => {
  const result = validateStrategySpec(validSpec({
    indicators: [{ id: "unsafe", kind: "custom_code", source: "close", code: "strategy.entry('x')" }],
  }));
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "unsupported-indicator"));
});

test("StrategySpec rejects undefined indicator references and unsafe risk", () => {
  const spec = validSpec();
  spec.entry.rules[0].left.id = "missing";
  spec.sizing.value = 25;
  const result = validateStrategySpec(spec);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "unknown-indicator"));
  assert.ok(result.issues.some((issue) => issue.code === "risk-out-of-range"));
});

test('StrategySpec rejects rule ASTs deeper than eight levels without throwing', () => {
  let rule = { kind: 'compare', left: { kind: 'price', source: 'close' }, operator: 'above', right: { kind: 'number', value: 1 } };
  for (let index = 0; index < 8; index += 1) rule = { kind: 'all', rules: [rule] };
  let result;
  assert.doesNotThrow(() => { result = validateStrategySpec(validSpec({ entry: rule })); });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'unsupported-rule' && issue.message.includes('depth')));
});

test('StrategySpec rejects rule ASTs above 128 nodes before recursive parsing', () => {
  const leaf = () => ({ kind: 'compare', left: { kind: 'price', source: 'close' }, operator: 'above', right: { kind: 'number', value: 1 } });
  const rule = { kind: 'all', rules: Array.from({ length: 12 }, () => ({ kind: 'all', rules: Array.from({ length: 11 }, leaf) })) };
  const result = validateStrategySpec(validSpec({ entry: rule }));
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'unsupported-rule' && issue.message.includes('128')));
});

test('StrategySpec issue collection is bounded for cyclic malformed values', () => {
  const left = { kind: 'indicator', id: 'rsi-main' };
  left.self = left;
  let result;
  assert.doesNotThrow(() => {
    result = validateStrategySpec(validSpec({
      entry: { kind: 'compare', left, operator: 'above', right: { kind: 'number', value: 1 } },
    }));
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'invalid-spec'));
});

test('StrategySpec enforces the V1 single-position contract and canonical risk floors', () => {
  const boundary = validSpec();
  boundary.stop.value = 0.1;
  boundary.sizing.value = 0.05;
  boundary.riskPolicy.maxDrawdownPercent = 1;
  assert.equal(validateStrategySpec(boundary).ok, true);

  const invalid = [
    (spec) => { spec.stop.value = 0.05; },
    (spec) => { spec.sizing.value = 0.01; },
    (spec) => { spec.riskPolicy.maxDrawdownPercent = 0.5; },
    (spec) => { spec.riskPolicy.maxOpenPositions = 2; },
  ];
  for (const mutate of invalid) {
    const spec = validSpec();
    mutate(spec);
    const result = validateStrategySpec(spec);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === 'risk-out-of-range'));
  }
});

test("Pine compiler is deterministic, versioned, and emits only the safe subset", () => {
  const a = compilePineV6(validSpec(), { start: "2024-01-01", end: "2025-01-01" }, { initialCapital: 25_000 });
  const b = compilePineV6(validSpec(), { start: "2024-01-01", end: "2025-01-01" }, { initialCapital: 25_000 });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.code, b.code);
  assert.equal(a.compilerVersion, PINE_COMPILER_VERSION);
  assert.match(a.code, /@version=6/);
  assert.match(a.code, /barstate\.isconfirmed/);
  assert.doesNotMatch(a.code, /lookahead_on|request\.security|calc_on_every_tick|timenow/);
  assert.match(a.code, /initial_capital=25000/);
  assert.match(a.code, /commission_value=0/);
});

test('Pine compiler rejects calendar dates that do not round-trip', () => {
  const invalid = compilePineV6(validSpec(), { start: '2025-02-29', end: '2025-03-02' }, { initialCapital: 10_000 });
  assert.equal(invalid.ok, false);
  const leapDay = compilePineV6(validSpec(), { start: '2024-02-29', end: '2024-03-02' }, { initialCapital: 10_000 });
  assert.equal(leapDay.ok, true);
});

test('Pine compiler keeps a non-empty safe title and rejects capital rounded to zero', () => {
  const nonLatin = compilePineV6(validSpec({ name: 'Стратегія ризику' }), { start: '2024-01-01', end: '2025-01-01' }, { initialCapital: 10_000 });
  assert.equal(nonLatin.ok, true);
  assert.match(nonLatin.code, /strategy\("Ryntra Strategy"/);
  const tinyCapital = compilePineV6(validSpec(), { start: '2024-01-01', end: '2025-01-01' }, { initialCapital: 0.000000001 });
  assert.equal(tinyCapital.ok, false);
});

test("TradingView import binds trades and metrics to the manifest hashes", async () => {
  const tradesCsv = "Trade #,Type,Signal,Date/Time,Price,Contracts,Profit\n1,Exit long,Close,2025-01-03 00:00,102,1,2\n1,Entry long,Long,2024-12-30 00:00,100,1,\n";
  const performanceCsv = "Metric,All\nNet Profit,2\nMax Drawdown,1\nTotal Trades,1\n";
  const parsed = await parseTradingViewImport({
    manifest: {
      schemaVersion: 1,
      provider: "tradingview",
      strategyVersionId: "11111111-1111-4111-8111-111111111111",
      compilerVersion: PINE_COMPILER_VERSION,
      pineHash: "a".repeat(64),
      symbol: "BYBIT:BTCUSDT",
      timeframe: "4h",
      timezone: "UTC",
      compileWindow: { start: "2024-01-01", end: "2025-01-01" },
      initialCapital: 10_000,
      exportedAt: "2026-07-13T10:00:00.000Z",
    },
    tradesCsv,
    performanceCsv,
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.run.trades.length, 1);
  assert.equal(parsed.run.trades[0].entryPrice, 100);
  assert.equal(parsed.run.trades[0].exitPrice, 102);
  assert.match(parsed.run.manifest.tradesFileHash, /^[a-f0-9]{64}$/);
  assert.match(parsed.run.manifest.metricsFileHash, /^[a-f0-9]{64}$/);
  assert.equal(parsed.run.rawFilesStored, false);
});

test("TradingView import rejects malformed, oversized, and mixed-version packages", async () => {
  const base = {
    schemaVersion: 1,
    provider: "tradingview",
    strategyVersionId: "11111111-1111-4111-8111-111111111111",
    pineHash: "a".repeat(64),
    compilerVersion: PINE_COMPILER_VERSION,
    symbol: "BYBIT:BTCUSDT",
    timeframe: "4h",
    timezone: "UTC",
    exportedAt: "2026-07-13T10:00:00.000Z",
    compileWindow: { start: "2024-01-01", end: "2025-01-01" },
    initialCapital: 10_000,
  };
  const malformed = await parseTradingViewImport({ manifest: base, tradesCsv: "wrong,headers\n1,2", performanceCsv: "Metric,All\nNet Profit,2" });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error, "unsupported-trades-format");

  const oversized = await parseTradingViewImport({ manifest: base, tradesCsv: "x".repeat(1_000_001), performanceCsv: "Metric,All\nNet Profit,2" });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.error, "file-too-large");
});

test("Evidence quality is independent from positive returns and capped without forward evidence", () => {
  const report = evaluateEvidence({
    trades: Array.from({ length: 80 }, (_, i) => ({
      id: String(i + 1), side: "long", entryAt: i * 2, exitAt: i * 2 + 1,
      entryPrice: 100, exitPrice: i % 3 === 0 ? 98 : 103, quantity: 1,
      grossPnl: i % 3 === 0 ? -2 : 3, fees: 0.2, netPnl: i % 3 === 0 ? -2.2 : 2.8,
    })),
    initialCapital: 10_000,
    maxAllowedClosedTradeDrawdownPercent: 12,
    benchmarkReturnPercent: 8,
    protocol: { oos: "self-attested", costsIncluded: true, regimesCovered: 2, parameterSensitivity: "not-tested", forwardEvidence: false },
    leakage: { repaintRisk: "low", usesSyntheticPrices: false, usesLookahead: false, usesIntrabarAssumptions: false },
    reproducible: true,
    executionRealism: "medium",
  });
  assert.equal(report.quality === "strong", false);
  assert.equal(report.verdict, "mixed-evidence");
  assert.ok(report.warnings.includes("forward-evidence-missing"));
  assert.ok(Number.isFinite(report.metrics.maxDrawdownPercent));
  assert.equal("profitable" in report, false);
});

test("Unknown repaint risk can never produce a positive paper-forward verdict", () => {
  const report = evaluateEvidence({
    trades: [], initialCapital: 10_000, benchmarkReturnPercent: 0,
    maxAllowedClosedTradeDrawdownPercent: 12,
    protocol: { oos: "none", costsIncluded: false, regimesCovered: 0, parameterSensitivity: "not-tested", forwardEvidence: false },
    leakage: { repaintRisk: "unknown", usesSyntheticPrices: false, usesLookahead: false, usesIntrabarAssumptions: false },
    reproducible: false, executionRealism: "low",
  });
  assert.equal(report.quality, "incomplete");
  assert.equal(report.verdict, "blocked");
});

test('Evidence reports closed-trade drawdown limits and blocks a breached risk budget', () => {
  const report = evaluateEvidence({
    trades: [
      { id: '1', side: 'long', entryAt: 1, exitAt: 2, entryPrice: 100, exitPrice: 110, quantity: 1, grossPnl: 10, fees: 0, netPnl: 10 },
      { id: '2', side: 'long', entryAt: 3, exitAt: 4, entryPrice: 110, exitPrice: 90, quantity: 1, grossPnl: -20, fees: 0, netPnl: -20 },
    ],
    initialCapital: 100,
    maxAllowedClosedTradeDrawdownPercent: 10,
    benchmarkReturnPercent: 0,
    protocol: { oos: 'blind', costsIncluded: true, regimesCovered: 4, parameterSensitivity: 'stable', forwardEvidence: true },
    leakage: { repaintRisk: 'none', usesSyntheticPrices: false, usesLookahead: false, usesIntrabarAssumptions: false },
    reproducible: true,
    executionRealism: 'high',
  });
  assert.equal(report.metrics.maxDrawdownPercent, 18.18);
  assert.ok(report.warnings.includes('intratrade-drawdown-unavailable'));
  assert.ok(report.warnings.includes('closed-trade-drawdown-exceeds-risk-budget'));
  assert.equal(report.verdict, 'blocked');
});

test('Derived numeric overflow fails closed before an evidence report can be issued', () => {
  const overflowingTrade = {
    id: 'overflow', side: 'long', entryAt: 1, exitAt: 2,
    entryPrice: Number.MAX_VALUE, exitPrice: Number.MAX_VALUE, quantity: 2,
    grossPnl: 1, fees: 0, netPnl: 1,
  };
  assert.throws(() => applyCostModel([overflowingTrade], {
    commissionBps: 0, spreadBps: 0, slippageBps: 0, fundingBpsPerDay: 0,
  }), TypeError);
  const hugeFiniteNotional = {
    ...overflowingTrade,
    entryPrice: 1e100,
    exitPrice: 1e100,
    quantity: 1e100,
  };
  assert.throws(() => applyCostModel([hugeFiniteNotional], {
    commissionBps: 0, spreadBps: 0, slippageBps: 0, fundingBpsPerDay: 0,
  }), TypeError);

  const hugePnl = { ...overflowingTrade, entryPrice: 1, exitPrice: 1, quantity: 1, netPnl: Number.MAX_VALUE };
  assert.throws(() => evaluateEvidence({
    trades: [hugePnl, { ...hugePnl, id: 'overflow-2', entryAt: 3, exitAt: 4 }],
    initialCapital: 1,
    maxAllowedClosedTradeDrawdownPercent: 50,
    benchmarkReturnPercent: 0,
    protocol: { oos: 'blind', costsIncluded: true, regimesCovered: 4, parameterSensitivity: 'stable', forwardEvidence: true },
    leakage: { repaintRisk: 'none', usesSyntheticPrices: false, usesLookahead: false, usesIntrabarAssumptions: false },
    reproducible: true,
    executionRealism: 'high',
  }), TypeError);
  assert.throws(() => evaluateEvidence({
    trades: [{ ...hugePnl, netPnl: 1e200 }],
    initialCapital: 1,
    maxAllowedClosedTradeDrawdownPercent: 50,
    benchmarkReturnPercent: 0,
    protocol: { oos: 'blind', costsIncluded: true, regimesCovered: 4, parameterSensitivity: 'stable', forwardEvidence: true },
    leakage: { repaintRisk: 'none', usesSyntheticPrices: false, usesLookahead: false, usesIntrabarAssumptions: false },
    reproducible: true,
    executionRealism: 'high',
  }), TypeError);
});

test("Experiment lineage records test exposure and increments immutable iterations", () => {
  const next = createNextLineage({
    parentRunId: "22222222-2222-4222-8222-222222222222",
    parentIteration: 3,
    hypothesis: "Raise the RSI recovery threshold from 30 to 32.",
    changedFields: ["entry.rules.0.right.value"],
    parentTestWindowStatus: "revealed",
  });
  assert.equal(next.iterationNumber, 4);
  assert.equal(next.userAttestedTestWindowSeenBeforeChange, true);
  assert.deepEqual(next.changedFields, ["entry.rules.0.right.value"]);
});
test("TradingView import verifies declared hashes and rejects duplicate trade legs", async () => {
  const manifest = {
    schemaVersion: 1,
    provider: "tradingview",
    strategyVersionId: "11111111-1111-4111-8111-111111111111",
    pineHash: "a".repeat(64),
    symbol: "BYBIT:BTCUSDT",
    compilerVersion: PINE_COMPILER_VERSION,
    timeframe: "4h",
    timezone: "UTC",
    compileWindow: { start: "2024-01-01", end: "2025-01-01" },
    initialCapital: 10_000,
    exportedAt: "2026-07-13T10:00:00.000Z",
  };
  const tradesCsv = "Trade #,Type,Date/Time,Price,Contracts,Profit\n1,Entry long,2024-12-30 00:00,100,1,\n1,Exit long,2025-01-03 00:00,102,1,2\n";
  const performanceCsv = "Metric,All\nNet Profit,2\n";
  const mismatch = await parseTradingViewImport({
    manifest: { ...manifest, tradesFileHash: "0".repeat(64) },
    tradesCsv,
    performanceCsv,
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error, "file-hash-mismatch");

  const duplicate = await parseTradingViewImport({
    manifest,
    tradesCsv: "Trade #,Type,Date/Time,Price,Contracts,Profit\n1,Entry long,2024-12-29 00:00,100,1,\n1,Entry long,2024-12-30 00:00,101,1,\n1,Exit long,2025-01-03 00:00,102,1,2\n",
    performanceCsv,
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, "unsupported-trades-format");
});

test("TradingView import accepts BOM, quoted fields, and decimal-comma values", async () => {
  const parsed = await parseTradingViewImport({
    manifest: {
      schemaVersion: 1,
      provider: "tradingview",
      strategyVersionId: "11111111-1111-4111-8111-111111111111",
      pineHash: "a".repeat(64),
      symbol: "BYBIT:BTCUSDT",
      timeframe: "4h",
      compilerVersion: PINE_COMPILER_VERSION,
      timezone: "UTC",
      compileWindow: { start: "2024-01-01", end: "2025-01-02" },
      initialCapital: 10_000,
      exportedAt: "2026-07-13T10:00:00.000Z",
    },
    tradesCsv: "\uFEFFTrade #,Type,Date/Time,Price,Contracts,Profit\n1,Entry long,2025-01-01 00:00,\"1.234,50\",\"0,5\",\n1,Exit long,2025-01-03 00:00,\"1.244,50\",\"0,5\",\"5,00\"\n",
    performanceCsv: "\uFEFFMetric,All\nNet Profit,\"5,00\"\n",
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.run.trades[0].entryPrice, 1234.5);
  assert.equal(parsed.run.trades[0].quantity, 0.5);
  assert.equal(parsed.run.metrics["Net Profit"], 5);
});

test("Cost model deterministically applies both legs and time-based funding", () => {
  const adjusted = applyCostModel([
    {
      id: "1",
      side: "long",
      entryAt: Date.parse("2025-01-01T00:00:00Z"),
      exitAt: Date.parse("2025-01-03T00:00:00Z"),
      entryPrice: 100,
      exitPrice: 110,
      quantity: 2,
      grossPnl: 20,
      fees: 0,
      netPnl: 20,
    },
  ], {
    commissionBps: 10,
    spreadBps: 5,
    slippageBps: 5,
    fundingBpsPerDay: 2,
  });
  assert.equal(adjusted.length, 1);
  assert.equal(adjusted[0].fees, 0.92);
  assert.equal(adjusted[0].netPnl, 19.08);
});
