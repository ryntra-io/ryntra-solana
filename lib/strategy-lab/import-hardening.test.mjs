import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCostModel } from "./evidence.ts";
import { PINE_COMPILER_VERSION } from "./pine.ts";
import { deriveBenchmarkReturnPercent, parseTradingViewImport } from "./tradingview-import.ts";

const manifest = (overrides = {}) => ({
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
  ...overrides,
});
const performanceCsv = "Metric,All\nNet Profit,2\nBuy & hold return,1000\n";
const validTradesCsv = "Trade #,Type,Date/Time,Price,Contracts,Profit\n"
  + "1,Entry long,2024-12-30 00:00,100,1,\n"
  + "1,Exit long,2025-01-03 00:00,102,1,2\n";

test("benchmark return is derived from TradingView metrics, never a client field", () => {
  assert.equal(deriveBenchmarkReturnPercent({ "Buy & hold % gain": 12.5 }, 10_000), 12.5);
  assert.equal(deriveBenchmarkReturnPercent({ "Buy & hold return": 1_000 }, 10_000), 10);
  assert.equal(deriveBenchmarkReturnPercent({ "Net Profit": 2 }, 10_000), null);
});

test("TradingView imports require UTC, complete trade legs, quantity, and reported PnL", async () => {
  const cases = [
    {
      manifest: manifest({ timezone: "Europe/Paris" }),
      tradesCsv: validTradesCsv,
      error: "invalid-manifest",
    },
    {
      manifest: manifest(),
      tradesCsv: "Trade #,Type,Date/Time,Price,Contracts,Profit\n1,Entry long,2025-01-01 00:00,100,1,\n",
      error: "unsupported-trades-format",
    },
    {
      manifest: manifest(),
      tradesCsv: "Trade #,Type,Date/Time,Price,Profit\n1,Entry long,2025-01-01 00:00,100,\n1,Exit long,2025-01-03 00:00,102,2\n",
      error: "unsupported-trades-format",
    },
    {
      manifest: manifest(),
      tradesCsv: "Trade #,Type,Date/Time,Price,Contracts,Profit\n1,Entry long,2025-01-01 00:00,100,1,\n1,Exit long,2025-01-03 00:00,102,1,\n",
      error: "unsupported-trades-format",
    },
    {
      manifest: manifest(),
      tradesCsv: "Trade #,Type,Date/Time,Price,Contracts,Profit\n1,Adjustment,2025-01-01 00:00,100,1,2\n",
      error: "unsupported-trades-format",
    },
  ];

  for (const fixture of cases) {
    const result = await parseTradingViewImport({
      manifest: fixture.manifest,
      tradesCsv: fixture.tradesCsv,
      performanceCsv,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, fixture.error);
  }
});

test('TradingView manifests and trade timestamps require real calendar dates', async () => {
  const invalidManifest = await parseTradingViewImport({
    manifest: manifest({ compileWindow: { start: '2024-02-30', end: '2025-01-01' } }),
    tradesCsv: validTradesCsv,
    performanceCsv,
  });
  assert.equal(invalidManifest.ok, false);
  assert.equal(invalidManifest.error, 'invalid-manifest');

  const invalidTradeDate = await parseTradingViewImport({
    manifest: manifest(),
    tradesCsv: 'Trade #,Type,Date/Time,Price,Contracts,Profit\n'
      + '1,Entry long,2024-02-30 00:00,100,1,\n'
      + '1,Exit long,2024-03-02 00:00,102,1,2\n',
    performanceCsv,
  });
  assert.equal(invalidTradeDate.ok, false);
  assert.equal(invalidTradeDate.error, 'unsupported-trades-format');
});

test('TradingView imports reject out-of-window entries and shorts while allowing exits after the window', async () => {
  const rejected = [
    'Trade #,Type,Date/Time,Price,Contracts,Profit\n'
      + '1,Entry long,2023-12-31 00:00,100,1,\n'
      + '1,Exit long,2024-01-02 00:00,102,1,2\n',
    'Trade #,Type,Date/Time,Price,Contracts,Profit\n'
      + '1,Entry long,2025-01-01 00:00,100,1,\n'
      + '1,Exit long,2025-01-03 00:00,102,1,2\n',
    'Trade #,Type,Date/Time,Price,Contracts,Profit\n'
      + '1,Entry short,2024-12-30 00:00,100,1,\n'
      + '1,Exit short,2025-01-03 00:00,90,1,10\n',
  ];
  for (const tradesCsv of rejected) {
    const result = await parseTradingViewImport({ manifest: manifest(), tradesCsv, performanceCsv });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'unsupported-trades-format');
  }

  const exitAfterEnd = await parseTradingViewImport({
    manifest: manifest(),
    tradesCsv: validTradesCsv,
    performanceCsv,
  });
  assert.equal(exitAfterEnd.ok, true);
  assert.ok(exitAfterEnd.run.trades[0].exitAt >= Date.parse('2025-01-01T00:00:00.000Z'));
});

test("reported TradingView PnL is treated as gross and Ryntra costs are applied once", async () => {
  const imported = await parseTradingViewImport({
    manifest: manifest(),
    tradesCsv: validTradesCsv,
    performanceCsv,
  });
  assert.equal(imported.ok, true);
  assert.equal(imported.run.trades[0].grossPnl, 2);
  assert.equal(imported.run.trades[0].entryAt, Date.parse("2024-12-30T00:00:00.000Z"));

  const [adjusted] = applyCostModel(imported.run.trades, {
    commissionBps: 10,
    spreadBps: 0,
    slippageBps: 0,
    fundingBpsPerDay: 0,
  });
  assert.equal(adjusted.fees, 0.202);
  assert.equal(adjusted.netPnl, 1.798);
});
