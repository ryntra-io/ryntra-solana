/**
 * Network-free tests over the evidence layer: the registry's rules, the
 * mapper reading named fields only, the judge refusing every state that is
 * not a measurement, the rights map naming what may be called, and the
 * adapter reserving and settling every call against a governor — the
 * provider replaced by a fake `fetch` that answers what the documentation
 * shows.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  EVIDENCE_METRICS,
  NANSEN_RIGHTS,
  callableFamilies,
  createMemoryGovernor,
  createNansenAdapter,
  createNansenClient,
  describeEvidenceCondition,
  evidenceMetric,
  filterFields,
  judgeEvidenceCondition,
  mapNansenSnapshot,
  metricOf,
  validateEvidenceConditions,
} from "./index.ts";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const NOW = Date.parse("2026-09-16T12:30:00.000Z");
const KEY = "example-key-that-holds-nothing";

const screenerRow = { chain: "solana", token_address: BONK, token_symbol: "BONK", liquidity: 20_000_000, price_usd: 0.00002, buy_volume: 3_000_000, sell_volume: 2_500_000, volume: 5_500_000, netflow: 500_000 };
const flowsRow = { exchange_net_flow_usd: 300_000, exchange_wallet_count: 0, whale_net_flow_usd: -120_000, whale_wallet_count: 12, smart_trader_net_flow_usd: 50_000 };

/** A fake provider that answers the documented shapes and records what it was asked. */
function fakeProvider(overrides = {}) {
  const calls = [];
  const answers = {
    "/api/v1/token-screener": { status: 200, body: { data: [screenerRow], pagination: { page: 1, per_page: 5, is_last_page: true } }, headers: { "x-nansen-credits-used": "1", "x-nansen-credits-remaining": "999", "x-request-id": "r-screener" } },
    "/api/v1/tgm/flow-intelligence": { status: 200, body: { data: [flowsRow], warnings: ["exchange_wallet_count is always 0 (not tracked)"] }, headers: { "x-nansen-credits-used": "1", "x-nansen-credits-remaining": "998", "x-request-id": "r-flows" } },
    ...overrides,
  };
  const fetchImpl = async (url, init) => {
    const path = url.replace("https://api.nansen.ai", "");
    calls.push({ path, body: JSON.parse(init.body), key: init.headers.apikey });
    const answer = answers[path] ?? { status: 404, body: { code: "not_found", message: "no such path" } };
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json", ...(answer.headers ?? {}) } });
  };
  return { calls, fetchImpl };
}

test("the registry: every figure has a unit, windows and words; a labelled group's movement can only warn", () => {
  for (const metric of EVIDENCE_METRICS) {
    assert.ok(metric.windows.length > 0);
    assert.ok(metric.words.en.label && metric.words.uk.label);
    if (metric.aggregation === "cohort") assert.deepEqual(metric.conditionModes, ["advisory"]);
  }
  assert.equal(evidenceMetric("dex_volume_usd").aggregation, "whole-market");
  assert.equal(evidenceMetric("address_label"), null);
});

test("the rights map: three families allowed with attribution, restricted and prohibited ones never callable, fields filtered by name", () => {
  assert.deepEqual(callableFamilies(NANSEN_RIGHTS).map((family) => family.family), ["tgm/token-screener", "tgm/flow-intelligence"]);
  assert.equal(NANSEN_RIGHTS.attribution.text, "Powered by Nansen API");
  const kept = filterFields(NANSEN_RIGHTS.families[0], { volume: 1, buy_volume: 2, address_label: "Whale", address: "abc" });
  assert.deepEqual(Object.keys(kept).sort(), ["buy_volume", "volume"]);
});

test("the mapper reads named fields into the registry's metrics; an absent figure is null, never zero", () => {
  const snapshot = mapNansenSnapshot({ mint: BONK, window: "24h", fetchedAtMs: NOW, screener: { row: screenerRow, answered: true, warnings: [], failure: null }, flows: { row: null, answered: true, warnings: [], failure: null } });
  assert.equal(metricOf(snapshot, "dex_volume_usd").value, 5_500_000);
  assert.equal(metricOf(snapshot, "whale_net_flow_usd").value, null);
  assert.equal(metricOf(snapshot, "whale_net_flow_usd").coverage, "absent");
  assert.equal(snapshot.observedAt, null);
  assert.equal(snapshot.expiresAt, "2026-09-16T12:35:00.000Z");
  assert.equal(JSON.stringify(snapshot).includes("address"), false);
});

test("a condition is validated on the registry and judged on the observation; unmet, stale, unknown and another window are never a pass", () => {
  const rule = { metric: "dex_volume_usd", window: "24h", operator: "gte", threshold: 1_000_000, mode: "required", onUnknown: "block" };
  assert.deepEqual(validateEvidenceConditions([rule]), []);
  assert.equal(validateEvidenceConditions([{ ...rule, metric: "whale_net_flow_usd" }])[0].path, "evidenceConditions[0].mode");
  assert.equal(validateEvidenceConditions([{ ...rule, onUnknown: "warn" }])[0].path, "evidenceConditions[0].onUnknown");
  assert.equal(describeEvidenceCondition(rule, evidenceMetric(rule.metric)), "24h DEX trading volume ≥ $1,000,000");

  const snapshot = mapNansenSnapshot({ mint: BONK, window: "24h", fetchedAtMs: NOW, screener: { row: screenerRow, answered: true, warnings: [], failure: null }, flows: { row: flowsRow, answered: true, warnings: [], failure: null } });
  const fresh = { state: "FRESH", snapshot, reason: null, served: "provider" };
  assert.equal(judgeEvidenceCondition(rule, fresh, NOW).outcome, "pass");
  assert.equal(judgeEvidenceCondition({ ...rule, threshold: 6_000_000 }, fresh, NOW).outcome, "fail");
  assert.equal(judgeEvidenceCondition(rule, fresh, NOW + 10 * 60_000).outcome, "unknown", "past expiry");
  assert.equal(judgeEvidenceCondition({ ...rule, window: "7d" }, fresh, NOW).outcome, "unknown", "another window");
  assert.equal(judgeEvidenceCondition(rule, { state: "UNAVAILABLE", snapshot: null, reason: "no answer", served: "none" }, NOW).outcome, "unknown");
});

test("the adapter reserves before each call, settles on the provider's headers, and refuses when the ceiling is reached", async () => {
  const provider = fakeProvider();
  const governor = createMemoryGovernor(3);
  const adapter = createNansenAdapter({ client: createNansenClient({ key: KEY, fetchImpl: provider.fetchImpl }), governor });
  const first = await adapter.read({ mint: BONK, window: "24h", nowMs: NOW });
  assert.equal(first.state, "FRESH");
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[0].key, KEY);
  assert.deepEqual(provider.calls[0].body, { chains: ["solana"], timeframe: "24h", filters: { token_address: BONK }, pagination: { page: 1, per_page: 5 } });
  assert.deepEqual(governor.state(), { ceiling: 3, reservedCredits: 2, usedCredits: 2, requests: 2, succeeded: 2, failed: 0, retries: 0, remainingReported: 998, lastRequestId: "r-flows", failures: {} });

  /* One credit left: the screener is read, the second family is refused by the ceiling, the snapshot says so. */
  const second = await adapter.read({ mint: BONK, window: "7d", nowMs: NOW });
  assert.equal(second.state, "FRESH");
  assert.equal(metricOf(second.snapshot, "dex_volume_usd").value, 5_500_000);
  assert.equal(metricOf(second.snapshot, "whale_net_flow_usd").value, null);
  assert.ok(second.snapshot.warnings.some((warning) => /ceiling|budget/i.test(warning)));
  assert.equal(provider.calls.length, 3);

  /* Nothing left: nothing is called. */
  const third = await adapter.read({ mint: BONK, window: "24h", nowMs: NOW });
  assert.equal(third.state, "UNAVAILABLE");
  assert.equal(provider.calls.length, 3);
});

test("the client calls only the families the rights map allows and never lets the key into an error", async () => {
  const client = createNansenClient({ key: KEY, fetchImpl: async () => new Response(JSON.stringify({ code: "x", message: `bad ${KEY}` }), { status: 401, headers: { "content-type": "application/json" } }) });
  const refused = await client.call("smart-money/inflows", {});
  assert.equal(refused.kind, "refused");
  const denied = await client.call("tgm/token-screener", { chains: ["solana"] });
  assert.equal(denied.kind, "auth");
  assert.equal(denied.message.includes(KEY), false);
});

/* ------------------------------------------------------------ the second provider: the token's structure, the recipient check */

import {
  DDXYZ_RIGHTS,
  createDdxyzAdapter,
  createDdxyzClient,
  mapAddressEvidence,
  mapTradingLiteSnapshot,
  metricsOfProvider,
  readsOf,
  structureStateOf,
  summarizeAddressEvidence,
} from "./index.ts";

const WALLET = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

/** A Trading Lite answer in the provider's own shape; the address lists synthetic. */
const tradingLite = (overrides = {}) => ({
  CA: BONK,
  DA: "",
  Top10Holders: 38.69,
  SniperPercentageOnLaunch: 0,
  SniperAddresses: [{ address: "11111111111111111111111111111111", currentHoldingPercentage: 0.01 }],
  BundlerAddresses: [],
  SniperPercentageHolding: 0.01,
  SniperConfidence: null,
  BundlerPercentageOnLaunch: 0,
  BundlerPercentageHolding: 0,
  TotalHolders: 1_016_981,
  DexScreenerPaid: false,
  DevHoldingPercentage: 0,
  DevLaunched24Hours: 0,
  mintable: false,
  freezable: true,
  analysisTimestamp: NOW - 60_000,
  buy_sell_taxes: { has_buy_tax: false, has_sell_tax: false, has_transfer_tax: false },
  pool_fees: null,
  total_effective_fee_percentage: 0.25,
  ...overrides,
});

function fakeSecurityProvider(overrides = {}) {
  const calls = [];
  const answers = {
    "trading-lite": { status: 200, body: tradingLite(), headers: { "x-webacy-cu": "4", "x-amzn-requestid": "tl-1" } },
    sanctioned: { status: 200, body: { address: WALLET, is_sanctioned: false, sanctions_status: "clean", is_sanctions_related: false, sanctions_related_status: "not_related" }, headers: { "x-webacy-cu": "1" } },
    addresses: { status: 200, body: { count: 0, medium: 0, high: 0, overallRisk: 12.5, issues: [], details: { address_info: { labels: [{ name: "x" }] } }, isContract: false, addressType: "EOA", analyzed_at: "2026-09-16T09:12:41.000Z", expiresAt: NOW + 3_600_000 }, headers: { "x-webacy-cu": "3" } },
    ...overrides,
  };
  const fetchImpl = async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    calls.push({ pathname, chain: searchParams.get("chain"), key: init.headers["x-api-key"] });
    const route = pathname.startsWith("/trading-lite/") ? "trading-lite" : pathname.startsWith("/addresses/sanctioned/") ? "sanctioned" : "addresses";
    const answer = answers[route];
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json", ...answer.headers } });
  };
  return { fetchImpl, calls };
}

test("the second provider's registry entries are point-in-time figures; the early-holder labels can only warn; every read names its provider", () => {
  const ids = metricsOfProvider("ddxyz").map((metric) => metric.id);
  assert.deepEqual(ids, ["top10_holder_share_pct", "holder_count", "mint_authority", "freeze_authority", "transfer_tax_pct", "sniper_holding_pct", "bundler_holding_pct", "dev_holding_pct"]);
  for (const metric of metricsOfProvider("ddxyz")) assert.deepEqual([...metric.windows], ["now"]);
  assert.deepEqual(validateEvidenceConditions([{ metric: "sniper_holding_pct", window: "now", operator: "lte", threshold: 5, mode: "required", onUnknown: "block" }]).map((issue) => issue.path), ["evidenceConditions[0].mode"]);
  assert.deepEqual(validateEvidenceConditions([{ metric: "mint_authority", window: "now", operator: "gt", threshold: 0.5, mode: "required", onUnknown: "block" }]).map((issue) => issue.path), ["evidenceConditions[0].threshold"]);
  assert.deepEqual(
    readsOf([
      { metric: "mint_authority", window: "now", operator: "lte", threshold: 0, mode: "required", onUnknown: "block" },
      { metric: "dex_volume_usd", window: "24h", operator: "gte", threshold: 1, mode: "required", onUnknown: "block" },
    ]),
    [
      { provider: "ddxyz", window: "now" },
      { provider: "nansen", window: "24h" },
    ],
  );
  assert.deepEqual(callableFamilies(DDXYZ_RIGHTS).map((family) => family.family), ["trading-lite", "addresses", "sanctions"]);
});

test("the structure mapper: named fields only, a zero the engine could not have measured is an absence, an authority is a flag, no address passes; the compact state counts facts", () => {
  const snapshot = mapTradingLiteSnapshot({ mint: BONK, fetchedAtMs: NOW, json: tradingLite() });
  assert.equal(snapshot.provider, "ddxyz");
  assert.equal(snapshot.window, "now");
  assert.equal(metricOf(snapshot, "top10_holder_share_pct").value, 38.69);
  assert.equal(metricOf(snapshot, "mint_authority").value, 0);
  assert.equal(metricOf(snapshot, "freeze_authority").value, 1);
  assert.equal(metricOf(snapshot, "transfer_tax_pct").value, 0);
  assert.equal(snapshot.observedAt, new Date(NOW - 60_000).toISOString());
  assert.ok(!JSON.stringify(snapshot).includes("11111111111111111111111111111111"));
  assert.deepEqual(structureStateOf(snapshot), { flags: ["freeze_authority"], unanswered: [] });
  const usdc = mapTradingLiteSnapshot({ mint: BONK, fetchedAtMs: NOW, json: tradingLite({ Top10Holders: 0, TotalHolders: 8_813_503 }) });
  assert.equal(metricOf(usdc, "top10_holder_share_pct").value, null);
  assert.equal(metricOf(usdc, "top10_holder_share_pct").coverage, "absent");
  const renounced = judgeEvidenceCondition({ metric: "mint_authority", window: "now", operator: "lte", threshold: 0, mode: "required", onUnknown: "block" }, { state: "FRESH", snapshot, reason: null, served: "provider" }, NOW);
  assert.equal(renounced.outcome, "pass");
  assert.equal(renounced.expected, "mint authority: renounced");
  const frozen = judgeEvidenceCondition({ metric: "freeze_authority", window: "now", operator: "lte", threshold: 0, mode: "required", onUnknown: "block" }, { state: "FRESH", snapshot, reason: null, served: "provider" }, NOW);
  assert.equal(frozen.outcome, "fail");
  assert.equal(frozen.reason, "present — the rule wants renounced");
});

test("the security adapter reserves the rights map's price, settles on x-webacy-cu, names chain=sol on every call, and reads a recipient through both engines — a program-owned one as unsupported, never clean", async () => {
  const provider = fakeSecurityProvider();
  const governor = createMemoryGovernor(12);
  const adapter = createDdxyzAdapter({ client: createDdxyzClient({ key: KEY, fetchImpl: provider.fetchImpl, minGapMs: 0 }), governor });
  const read = await adapter.read({ mint: BONK, window: "now", nowMs: NOW });
  assert.equal(read.state, "FRESH");
  assert.equal(provider.calls[0].chain, "sol");
  assert.equal(provider.calls[0].key, KEY);
  assert.equal(governor.state().usedCredits, 4);
  const recipient = await adapter.readAddress({ address: WALLET, nowMs: NOW });
  assert.equal(recipient.state, "FRESH");
  assert.deepEqual(provider.calls.slice(1).map((call) => call.pathname), [`/addresses/sanctioned/${WALLET}`, `/addresses/${WALLET}`]);
  assert.equal(governor.state().usedCredits, 8);
  assert.equal(summarizeAddressEvidence({ state: "FRESH", evidence: recipient.evidence, reason: null, served: "provider" }), "nothing-found");
  assert.ok(!JSON.stringify(recipient.evidence).includes("labels"));
  const refusing = fakeSecurityProvider({ addresses: { status: 400, body: { statusCode: 400, message: `Unsupported risk entity for address ${PROGRAM}` }, headers: {} } });
  const program = await createDdxyzAdapter({ client: createDdxyzClient({ key: KEY, fetchImpl: refusing.fetchImpl, minGapMs: 0 }), governor: createMemoryGovernor(12) }).readAddress({ address: PROGRAM, nowMs: NOW });
  assert.equal(program.state, "FRESH");
  assert.equal(program.evidence.findings.state, "unsupported");
  assert.equal(summarizeAddressEvidence({ state: "FRESH", evidence: program.evidence, reason: null, served: "provider" }), "unsupported");
  const gated = fakeSecurityProvider({ "trading-lite": { status: 403, body: { message: "Forbidden" }, headers: {} } });
  const closed = await createDdxyzAdapter({ client: createDdxyzClient({ key: KEY, fetchImpl: gated.fetchImpl, minGapMs: 0 }), governor: createMemoryGovernor(12) }).read({ mint: BONK, window: "now", nowMs: NOW });
  assert.equal(closed.state, "UNAVAILABLE");
  assert.match(closed.reason, /plan does not include/);
  const noBudget = await createDdxyzAdapter({ client: createDdxyzClient({ key: KEY, fetchImpl: provider.fetchImpl, minGapMs: 0 }), governor: createMemoryGovernor(0) }).read({ mint: BONK, window: "now", nowMs: NOW });
  assert.equal(noBudget.state, "UNAVAILABLE");
  assert.equal(mapAddressEvidence({ address: WALLET, fetchedAtMs: NOW, findings: { state: "unavailable", reason: "down" }, sanctions: { state: "unavailable", reason: "down" } }), null);
});
