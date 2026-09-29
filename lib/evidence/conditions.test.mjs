// Run from repo root: node --test lib/evidence/conditions.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { describeEvidenceCondition, formatEvidenceValue, judgeEvidenceCondition, validateEvidenceConditions, windowsOf } from "./conditions.ts";
import { EVIDENCE_METRIC_IDS, EVIDENCE_METRICS, evidenceMetric } from "./metrics.ts";

/**
 * A condition is judged, never assumed: every honest state that is not a
 * measured comparison is `unknown`, and the validator is the registry
 * applied — a cohort figure is never `required`, a required rule never
 * passes on unknown.
 */

const NOW = Date.parse("2026-09-16T12:31:00.000Z");

function snapshot(overrides = {}) {
  return {
    provider: "nansen",
    subject: { network: "solana:mainnet", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK" },
    window: "24h",
    fetchedAt: "2026-09-16T12:30:00.000Z",
    observedAt: null,
    providerLagSeconds: 600,
    expiresAt: "2026-09-16T12:35:00.000Z",
    metrics: [
      { id: "dex_volume_usd", value: 1_234_567.89, unit: "usd", window: "24h", coverage: "full", note: null },
      { id: "dex_net_volume_usd", value: -50_000, unit: "usd", window: "24h", coverage: "full", note: null },
      { id: "whale_wallet_count", value: 12, unit: "wallets", window: "24h", coverage: "full", note: null },
      { id: "exchange_net_flow_usd", value: null, unit: "usd", window: "24h", coverage: "absent", note: "The source did not answer." },
    ],
    warnings: [],
    attribution: { text: "Powered by Nansen API", href: "https://nansen.ai" },
    rightsPolicy: "nansen-guide-2025-11-18",
    families: ["tgm/token-screener", "tgm/flow-intelligence"],
    ...overrides,
  };
}

const fresh = (overrides) => ({ state: "FRESH", snapshot: snapshot(overrides), reason: null, served: "provider" });
const volumeAtLeast = (threshold, mode = "required") => ({ metric: "dex_volume_usd", window: "24h", operator: "gte", threshold, mode, onUnknown: mode === "required" ? "block" : "warn" });

test("the registry is internally consistent: every id listed, every cohort figure advisory only", () => {
  assert.deepEqual(EVIDENCE_METRICS.map((metric) => metric.id), [...EVIDENCE_METRIC_IDS]);
  for (const metric of EVIDENCE_METRICS) {
    assert.ok(metric.windows.length > 0, `${metric.id} names no window`);
    assert.ok(metric.words.en.label && metric.words.uk.label, `${metric.id} lacks words`);
    if (metric.aggregation === "cohort") assert.deepEqual(metric.conditionModes, ["advisory"], `${metric.id} is a cohort figure and must be advisory only`);
    else assert.deepEqual(metric.conditionModes, ["advisory", "required"], `${metric.id} covers the whole market and may be required`);
  }
  assert.equal(evidenceMetric("address_label"), null);
});

test("validation refuses what the registry does not serve, accepts a well-formed list", () => {
  assert.deepEqual(validateEvidenceConditions([]), []);
  assert.deepEqual(validateEvidenceConditions([volumeAtLeast(1_000_000)]), []);
  assert.deepEqual(validateEvidenceConditions([{ metric: "whale_net_flow_usd", window: "7d", operator: "lt", threshold: -1000, mode: "advisory", onUnknown: "warn" }]), []);

  const paths = (list) => validateEvidenceConditions(list).map((issue) => issue.path);
  assert.deepEqual(paths([{ metric: "smart_money_netflow", window: "24h", operator: "gte", threshold: 1, mode: "advisory", onUnknown: "warn" }]), ["evidenceConditions[0].metric"]);
  assert.deepEqual(paths([{ ...volumeAtLeast(1), window: "30d" }]), ["evidenceConditions[0].window"]);
  assert.deepEqual(paths([{ ...volumeAtLeast(1), operator: "eq" }]), ["evidenceConditions[0].operator"]);
  assert.deepEqual(paths([{ ...volumeAtLeast(Number.NaN) }]), ["evidenceConditions[0].threshold"]);
  assert.deepEqual(paths([{ ...volumeAtLeast(-5) }]), ["evidenceConditions[0].threshold"], "a volume is never below zero");
  assert.deepEqual(paths([{ metric: "whale_wallet_count", window: "24h", operator: "gte", threshold: 2.5, mode: "advisory", onUnknown: "warn" }]), ["evidenceConditions[0].threshold"], "addresses are counted whole");
  assert.deepEqual(paths([{ metric: "whale_net_flow_usd", window: "24h", operator: "gte", threshold: 0, mode: "required", onUnknown: "block" }]), ["evidenceConditions[0].mode"], "a cohort figure cannot block");
  assert.deepEqual(paths([{ ...volumeAtLeast(1), onUnknown: "warn" }]), ["evidenceConditions[0].onUnknown"], "required blocks on unknown");
  assert.deepEqual(paths([{ ...volumeAtLeast(1, "advisory"), onUnknown: "block" }]), ["evidenceConditions[0].onUnknown"], "advisory warns on unknown");
  assert.deepEqual(paths([null]), ["evidenceConditions[0]"]);
  assert.equal(paths(Array.from({ length: 11 }, () => volumeAtLeast(1)))[0], "evidenceConditions");
});

test("a measured comparison passes or fails on the exact boundary", () => {
  const read = fresh();
  assert.equal(judgeEvidenceCondition(volumeAtLeast(1_234_567.89), read, NOW).outcome, "pass", "gte is inclusive");
  assert.equal(judgeEvidenceCondition({ ...volumeAtLeast(1_234_567.89), operator: "gt" }, read, NOW).outcome, "fail", "gt is strict");
  assert.equal(judgeEvidenceCondition(volumeAtLeast(2_000_000), read, NOW).outcome, "fail");
  const failed = judgeEvidenceCondition(volumeAtLeast(2_000_000), read, NOW);
  assert.equal(failed.expected, "24h DEX trading volume ≥ $2,000,000");
  assert.equal(failed.actual, "$1,234,568 · asked 12:30 UTC");
  assert.equal(failed.value, 1_234_567.89);
  const signed = judgeEvidenceCondition({ metric: "dex_net_volume_usd", window: "24h", operator: "lte", threshold: -50_000, mode: "advisory", onUnknown: "warn" }, read, NOW);
  assert.equal(signed.outcome, "pass");
  assert.equal(signed.actual, "−$50,000 · asked 12:30 UTC");
  const wallets = judgeEvidenceCondition({ metric: "whale_wallet_count", window: "24h", operator: "gte", threshold: 12, mode: "advisory", onUnknown: "warn" }, read, NOW);
  assert.equal(wallets.outcome, "pass");
  assert.equal(wallets.expected, "24h large-holder addresses active ≥ 12 addresses");
});

test("every state that is not a measurement is unknown, with its reason", () => {
  const rule = volumeAtLeast(1);
  assert.equal(judgeEvidenceCondition(rule, { state: "UNAVAILABLE", snapshot: null, reason: "The provider did not answer in time.", served: "provider" }, NOW).reason, "The provider did not answer in time.");
  assert.equal(judgeEvidenceCondition(rule, { state: "UNKNOWN", snapshot: null, reason: "The provider has no data for this token.", served: "provider" }, NOW).actual, "no data");
  assert.equal(judgeEvidenceCondition({ ...rule, window: "7d" }, fresh(), NOW).outcome, "unknown", "another window is not an approximation");
  const absent = judgeEvidenceCondition({ metric: "exchange_net_flow_usd", window: "24h", operator: "gte", threshold: 0, mode: "advisory", onUnknown: "warn" }, fresh(), NOW);
  assert.equal(absent.outcome, "unknown");
  assert.equal(absent.reason, "The source did not answer.");
  const stale = judgeEvidenceCondition(rule, fresh(), Date.parse("2026-09-16T12:36:00.000Z"));
  assert.equal(stale.outcome, "unknown", "past expiry is not a pass, whatever the figure");
  assert.equal(stale.value, 1_234_567.89, "the last figure is still shown");
  assert.match(stale.actual, /stale/);
  assert.equal(judgeEvidenceCondition({ ...rule, metric: "nonsense" }, fresh(), NOW).outcome, "unknown");
});

test("the human sentence and the figure words", () => {
  const metric = evidenceMetric("dex_volume_usd");
  assert.equal(describeEvidenceCondition(volumeAtLeast(1_000_000), metric), "24h DEX trading volume ≥ $1,000,000");
  assert.equal(describeEvidenceCondition(volumeAtLeast(1_000_000), metric, "uk"), "24h обсяг торгів на DEX ≥ $1,000,000");
  assert.equal(formatEvidenceValue(0.5, "usd"), "$0.50");
  assert.equal(formatEvidenceValue(-1234.4, "usd"), "−$1,234");
  assert.equal(formatEvidenceValue(1, "wallets"), "1 address");
  assert.deepEqual(windowsOf([volumeAtLeast(1), { ...volumeAtLeast(2), window: "7d" }, volumeAtLeast(3)]), ["24h", "7d"]);
});
