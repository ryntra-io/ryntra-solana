// Run from repo root: node --test lib/domain/portfolio-heat.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePortfolioHeat, correlationFamilyOf, DEFAULT_HEAT_POLICY } from "./portfolio-heat.ts";

const inst = (base, kind = "spot-tokenized-equity") => ({
  chain: "robinhood-chain",
  kind,
  base,
  quote: "USDG",
});

const holding = (base, notionalUsd, over = {}) => ({
  instrument: inst(base, over.kind ?? "spot-tokenized-equity"),
  notionalUsd,
  valueState: over.valueState ?? "fresh",
});

test("exposure and concentration: percentages over known exposure, sorted desc", () => {
  const heat = computePortfolioHeat([holding("NVDA", 600), holding("AAPL", 300), holding("MSFT", 100)]);
  assert.equal(heat.knownNotionalUsd, 1000);
  assert.equal(heat.partialData, false);
  assert.deepEqual(heat.exposures.map((e) => e.instrument.base), ["NVDA", "AAPL", "MSFT"]);
  assert.equal(heat.exposures[0].pct, 60);
  assert.ok(heat.warnings.includes("concentration:robinhood-chain:spot-tokenized-equity:NVDA/USDG"));
  assert.equal(heat.dataState, "fresh");
});

test("INVARIANT: unknown-valued holding is never counted as zero — flagged partial, degrades dataState", () => {
  const heat = computePortfolioHeat([holding("NVDA", 500), holding("TSLA", null)]);
  assert.equal(heat.knownNotionalUsd, 500);
  assert.equal(heat.unknownCount, 1);
  assert.equal(heat.partialData, true);
  assert.ok(heat.warnings.includes("partial-data"));
  assert.equal(heat.dataState, "unknown"); // a hole in the data is a hole in the panel
});

test("INVARIANT: stale valuation propagates to the panel's dataState", () => {
  const heat = computePortfolioHeat([holding("NVDA", 500), holding("AAPL", 500, { valueState: "stale" })]);
  assert.equal(heat.dataState, "stale");
});

test("correlated family grouping: tokenized equities + rwa perps together, crypto separate", () => {
  assert.equal(correlationFamilyOf(inst("NVDA", "spot-tokenized-equity")), "equities");
  assert.equal(correlationFamilyOf(inst("NVDA", "rwa-perp")), "equities");
  assert.equal(correlationFamilyOf(inst("BTC", "spot-crypto")), "crypto");
  assert.equal(correlationFamilyOf(inst("BTC", "crypto-perp")), "crypto");

  const heat = computePortfolioHeat([
    holding("NVDA", 400),
    holding("AAPL", 300),
    holding("BTC", 300, { kind: "crypto-perp" }),
  ]);
  const eq = heat.groups.find((g) => g.family === "equities");
  assert.equal(eq.pct, 70);
  assert.ok(heat.warnings.includes("correlated:equities")); // 70 > 60 default
});

test("empty portfolio: zero totals, unknown dataState, no fake percentages", () => {
  const heat = computePortfolioHeat([]);
  assert.equal(heat.knownNotionalUsd, 0);
  assert.equal(heat.exposures.length, 0);
  assert.equal(heat.dataState, "unknown");
});

test("policy is explicit and overridable", () => {
  const holdings = [holding("NVDA", 30), holding("AAPL", 70)];
  const strict = computePortfolioHeat(holdings, { maxSingleInstrumentPct: 10, maxCorrelatedGroupPct: 99.9 });
  assert.ok(strict.warnings.some((w) => w.startsWith("concentration:")));
  const loose = computePortfolioHeat(holdings, { maxSingleInstrumentPct: 80, maxCorrelatedGroupPct: 99.9 });
  assert.ok(!loose.warnings.some((w) => w.startsWith("concentration:")));
  assert.ok(DEFAULT_HEAT_POLICY.maxSingleInstrumentPct > 0);
});

test("degenerate values (NaN, negative, zero) are excluded as unknown, not counted", () => {
  const heat = computePortfolioHeat([holding("NVDA", 100), holding("X", NaN), holding("Y", -5), holding("Z", 0)]);
  assert.equal(heat.knownNotionalUsd, 100);
  assert.equal(heat.unknownCount, 3);
  assert.equal(heat.partialData, true);
  assert.equal(heat.dataState, "unknown"); // degenerate inputs degrade the panel state too
});
