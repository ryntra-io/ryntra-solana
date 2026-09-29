// Run from repo root: node --test lib/evidence/ddxyz.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { riskBandOf, summarizeAddressEvidence } from "./address.ts";
import { resolveEvidenceBudget, totalPeriodOf } from "./budget.ts";
import { describeEvidenceCondition, formatEvidenceValue, judgeEvidenceCondition, providerOfCondition, readsOf, validateEvidenceConditions } from "./conditions.ts";
import { createMemoryGovernor } from "./governor.ts";
import { EVIDENCE_METRICS, metricsOfProvider, providerOfWindow } from "./metrics.ts";
import { createDdxyzAdapter } from "./providers/ddxyz/adapter.server.ts";
import { createDdxyzClient, readDdxyzHeaders } from "./providers/ddxyz/client.server.ts";
import { mapAddressEvidence, mapTradingLiteSnapshot, transferTaxOf } from "./providers/ddxyz/mapper.ts";
import { callableFamilies, DDXYZ_RIGHTS, filterFields, providerRights } from "./rights.ts";
import { createEvidenceRuntime, readAddressEvidence, readEvidenceUsage, readMarketEvidence } from "./service.server.ts";
import { metricOf } from "./snapshot.ts";

/**
 * The second provider's rules, each proven network-free on the shapes the
 * provider re-audit recorded: the rights map is the
 * mapper's allowlist and address lists never pass it; a zero the engine
 * could not have measured is an absence; an authority is a flag a rule can
 * name; the key sits in one header and nowhere else; `chain=sol` is named
 * on every call; the governor settles on the provider's own price; a plan
 * gate, a refused key, a rate limit, a fault or a timeout is UNAVAILABLE
 * with its reason and never green; a program-owned recipient is UNKNOWN;
 * the ordinary read of the market provider is untouched by the second.
 */

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const WALLET = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const KEY = "ddxyz-test-key-0123456789abcdef";
const NOW = Date.parse("2026-09-16T17:20:00.000Z");

/** A Trading Lite answer as the provider shaped it on 2026-09-16 — the figures of the smoke, the address lists synthetic. */
function tradingLite(overrides = {}) {
  return {
    CA: BONK,
    DA: "",
    Top10Holders: 38.69,
    SniperPercentageOnLaunch: 0,
    SniperAddresses: [],
    BundlerAddresses: [{ address: "11111111111111111111111111111111", initiallyAcquiredPercentage: 0.01, initiallyAcquiredAmount: 1, currentHoldingPercentage: 0.02, currentHoldingAmount: 2 }],
    SniperPercentageHolding: 0,
    SniperConfidence: null,
    BundlerPercentageOnLaunch: 0,
    BundlerPercentageHolding: 0.02,
    TotalHolders: 1_016_981,
    DexScreenerPaid: false,
    DevHoldingPercentage: 0,
    DevLaunched24Hours: 0,
    mintable: false,
    freezable: false,
    analysisTimestamp: NOW - 120_000,
    buy_sell_taxes: { has_buy_tax: false, has_sell_tax: false, has_transfer_tax: false },
    pool_fees: { pool_address: "11111111111111111111111111111111", dex: "raydium", pool_type: "CLMM", trade_fee_percentage: 0.25, total_fee_percentage: 0.25 },
    total_effective_fee_percentage: 0.25,
    ...overrides,
  };
}

function findings(overrides = {}) {
  return {
    count: 2,
    medium: 1,
    high: 0,
    overallRisk: 50,
    issues: [{ score: 5, riskScore: "High Risk", categories: {}, tags: [{ name: "Automated Trader", key: "automated_trading", severity: 3, type: "addressRisk", description: "…" }] }],
    details: { address_info: { flagged: false, sanctioned: false, labels: [{ name: "x", type: "y" }], sns_name: "someone.sol" } },
    expiresAt: NOW + 20 * 3600 * 1000,
    isContract: false,
    addressType: "EOA",
    analyzed_at: "2026-09-15T21:38:17.636Z",
    ...overrides,
  };
}

const sanctionsClean = (address = WALLET) => ({ address, is_sanctioned: false, sanctions_status: "clean", is_sanctions_related: false, sanctions_related_status: "not_related" });

/** A fake provider: answers per path, counts calls, records what it was sent. */
function fakeProvider(overrides = {}) {
  const calls = [];
  const behaviour = {
    "/trading-lite/": () => ({ status: 200, body: tradingLite(), headers: { "x-webacy-cu": "4", "x-amzn-requestid": "req-tl" } }),
    "/addresses/sanctioned/": () => ({ status: 200, body: sanctionsClean(), headers: { "x-webacy-cu": "1", "x-amzn-requestid": "req-sa" } }),
    "/addresses/": () => ({ status: 200, body: findings(), headers: { "x-webacy-cu": "3", "x-amzn-requestid": "req-ad" } }),
    ...overrides,
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname + "";
    const route = path.startsWith("/trading-lite/") ? "/trading-lite/" : path.startsWith("/addresses/sanctioned/") ? "/addresses/sanctioned/" : path.startsWith("/addresses/") ? "/addresses/" : path;
    const handler = behaviour[route] ?? (() => ({ status: 404, body: { message: "no such route" }, headers: {} }));
    /* Like fetch: the signal aborts a slow answer with a TimeoutError. */
    const aborted = new Promise((_, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      const fail = () => reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail, { once: true });
    });
    const answer = await Promise.race([Promise.resolve(handler(url, init)), aborted]);
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json", ...answer.headers } });
  };
  return { fetchImpl, calls };
}

function runtimeWith(provider, env = {}) {
  const store = createMemoryGuardStore();
  const runtime = createEvidenceRuntime({
    store,
    env: { DDXYZ_API_KEY: KEY, RYNTRA_DDXYZ_DAILY_CREDITS: "40", RYNTRA_DDXYZ_MONTHLY_CREDITS: "400", ...env },
    fetchImpl: async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    securityFetchImpl: provider.fetchImpl,
  });
  return { store, runtime };
}

/* ------------------------------------------------------------ the registry and the rights map */

test("the registry: eight structural figures on the point-in-time window, the cohort ones advisory, every metric naming its provider", () => {
  const ddxyz = metricsOfProvider("ddxyz");
  assert.deepEqual(
    ddxyz.map((metric) => metric.id),
    ["top10_holder_share_pct", "holder_count", "mint_authority", "freeze_authority", "transfer_tax_pct", "sniper_holding_pct", "bundler_holding_pct", "dev_holding_pct"],
  );
  for (const metric of ddxyz) assert.deepEqual([...metric.windows], ["now"], `${metric.id} has the point-in-time window only`);
  for (const metric of ddxyz.filter((entry) => entry.aggregation === "cohort")) assert.deepEqual([...metric.conditionModes], ["advisory"], `${metric.id} informs, never blocks`);
  assert.deepEqual(ddxyz.filter((entry) => entry.aggregation === "cohort").map((entry) => entry.id), ["sniper_holding_pct", "bundler_holding_pct", "dev_holding_pct"]);
  for (const metric of EVIDENCE_METRICS) assert.ok(metric.provider === "nansen" || metric.provider === "ddxyz");
  assert.equal(metricsOfProvider("nansen").length, 7, "the market provider's seven are untouched");
  assert.equal(providerOfWindow("now"), "ddxyz");
  assert.equal(providerOfWindow("24h"), "nansen");
  assert.equal(providerRights("ddxyz"), DDXYZ_RIGHTS);
});

test("the rights map: three callable families priced as the provider's own header prices them; the gated and unsupported ones are never callable; address lists never pass the filter", () => {
  const callable = callableFamilies(DDXYZ_RIGHTS).map((family) => [family.family, family.creditsPerCall]);
  assert.deepEqual(callable, [
    ["trading-lite", 4],
    ["addresses", 3],
    ["sanctions", 1],
  ]);
  const statuses = Object.fromEntries(DDXYZ_RIGHTS.families.map((family) => [family.family, family.status]));
  assert.equal(statuses["holder-analysis"], "plan-gated");
  assert.equal(statuses["token-detail"], "plan-gated");
  assert.equal(statuses["token-pools"], "plan-gated");
  assert.equal(statuses["transaction-scan"], "unsupported");
  const rights = DDXYZ_RIGHTS.families.find((family) => family.family === "trading-lite");
  const kept = filterFields(rights, tradingLite());
  assert.ok(!("SniperAddresses" in kept) && !("BundlerAddresses" in kept) && !("DA" in kept) && !("CA" in kept) && !("pool_fees" in kept), "address lists and the pool never pass the allowlist");
  assert.deepEqual(Object.keys(kept).sort(), ["BundlerPercentageHolding", "DevHoldingPercentage", "SniperPercentageHolding", "Top10Holders", "TotalHolders", "analysisTimestamp", "buy_sell_taxes", "freezable", "mintable"]);
  assert.equal(DDXYZ_RIGHTS.attribution.text, "Data provided by DD.xyz");
});

/* ------------------------------------------------------------ the mapper */

test("the mapper: a meme token's structure — the eight figures, the source's own analysis time, the ten-minute expiry, no address anywhere", () => {
  const snapshot = mapTradingLiteSnapshot({ mint: BONK, fetchedAtMs: NOW, json: tradingLite() });
  assert.ok(snapshot);
  assert.equal(snapshot.provider, "ddxyz");
  assert.equal(snapshot.window, "now");
  assert.equal(snapshot.observedAt, new Date(NOW - 120_000).toISOString(), "analysisTimestamp is the observation time");
  assert.equal(snapshot.providerLagSeconds, 300);
  assert.equal(snapshot.expiresAt, new Date(NOW + 600_000).toISOString());
  assert.equal(metricOf(snapshot, "top10_holder_share_pct").value, 38.69);
  assert.equal(metricOf(snapshot, "holder_count").value, 1_016_981);
  assert.equal(metricOf(snapshot, "mint_authority").value, 0, "renounced is 0");
  assert.equal(metricOf(snapshot, "freeze_authority").value, 0);
  assert.equal(metricOf(snapshot, "transfer_tax_pct").value, 0, "no transfer tax is a zero, stated");
  assert.equal(metricOf(snapshot, "bundler_holding_pct").value, 0.02);
  assert.equal(metricOf(snapshot, "sniper_holding_pct").value, 0);
  assert.deepEqual(snapshot.warnings, []);
  assert.deepEqual(snapshot.families, ["trading-lite"]);
  assert.equal(snapshot.rightsPolicy, "ddxyz-conservative-2026-09-16");
  const text = JSON.stringify(snapshot);
  assert.ok(!text.includes("11111111111111111111111111111111"), "no address from the lists reaches the snapshot");
  assert.ok(!text.includes("raydium"), "the pool is not read");
});

test("the mapper: a zero the engine could not have measured is an absence, never 0 % — the USDC case; an issuer-backed instrument keeps its own figures", () => {
  const usdc = mapTradingLiteSnapshot({ mint: USDC, fetchedAtMs: NOW, json: tradingLite({ CA: USDC, Top10Holders: 0, TotalHolders: 8_813_503, SniperPercentageHolding: 0.31, BundlerPercentageHolding: 0.14 }) });
  const top = metricOf(usdc, "top10_holder_share_pct");
  assert.equal(top.value, null);
  assert.equal(top.coverage, "absent");
  assert.match(top.note, /did not measure/);
  assert.deepEqual(usdc.warnings, ["The source did not measure the top-ten share for this token."]);
  assert.equal(metricOf(usdc, "holder_count").value, 8_813_503);
  const nvdax = mapTradingLiteSnapshot({ mint: NVDAX, fetchedAtMs: NOW, json: tradingLite({ CA: NVDAX, Top10Holders: 80.42, TotalHolders: 94_763, DevHoldingPercentage: 55.77 }) });
  assert.equal(metricOf(nvdax, "top10_holder_share_pct").value, 80.42);
  assert.equal(metricOf(nvdax, "dev_holding_pct").value, 55.77, "the issuer's supply as the source labels it; the card, not the mapper, says it is by design");
});

test("the mapper: the Token-2022 tax block, an authority the source did not answer, a future or absurd timestamp, an answer with nothing to read", () => {
  assert.deepEqual(transferTaxOf({ has_buy_tax: false, has_sell_tax: false, has_transfer_tax: false }), { value: 0, note: null });
  assert.deepEqual(transferTaxOf({ has_transfer_tax: true, transfer_tax_percentage: 2.5 }), { value: 2.5, note: null });
  assert.deepEqual(transferTaxOf({ has_transfer_tax: true }), { value: null, note: "The source reports a transfer tax without its size." });
  assert.deepEqual(transferTaxOf(null), { value: null, note: "The source did not answer the transfer tax." });
  const taxed = mapTradingLiteSnapshot({ mint: BONK, fetchedAtMs: NOW, json: tradingLite({ buy_sell_taxes: { has_buy_tax: true, has_sell_tax: true, has_transfer_tax: true, buy_tax_percentage: 1, sell_tax_percentage: 1, transfer_tax_percentage: 1.5 } }) });
  assert.equal(metricOf(taxed, "transfer_tax_pct").value, 1.5);
  const unanswered = mapTradingLiteSnapshot({ mint: BONK, fetchedAtMs: NOW, json: tradingLite({ mintable: undefined, freezable: "yes", analysisTimestamp: NOW + 3_600_000 }) });
  assert.equal(metricOf(unanswered, "mint_authority").value, null);
  assert.equal(metricOf(unanswered, "freeze_authority").coverage, "absent");
  assert.equal(unanswered.observedAt, null, "a timestamp an hour in the future is not an observation time");
  assert.ok(unanswered.warnings.includes("The source did not answer the authority state."));
  assert.equal(mapTradingLiteSnapshot({ mint: BONK, fetchedAtMs: NOW, json: { message: "nothing here" } }), null);
  assert.equal(mapTradingLiteSnapshot({ mint: BONK, fetchedAtMs: NOW, json: [] }), null);
  assert.equal(mapTradingLiteSnapshot({ mint: BONK, fetchedAtMs: NOW, json: null }), null);
});

test("the mapper: an address — a plain wallet's findings and screening, a program-owned account unsupported yet screened, a sanctioned one, neither engine answering", () => {
  const wallet = mapAddressEvidence({ address: WALLET, fetchedAtMs: NOW, findings: { state: "answered", json: findings() }, sanctions: { state: "answered", json: sanctionsClean() } });
  assert.equal(wallet.subject.kind, "wallet");
  assert.deepEqual(wallet.findings, { state: "answered", count: 2, high: 0, medium: 1, score: 50, band: "high" });
  assert.deepEqual(wallet.sanctions, { state: "clean", related: false });
  assert.equal(wallet.observedAt, "2026-09-15T21:38:17.636Z");
  assert.equal(wallet.expiresAt, new Date(NOW + 3_600_000).toISOString(), "an hour, the shorter of the two families");
  assert.deepEqual(wallet.families, ["addresses", "sanctions"]);
  const text = JSON.stringify(wallet);
  assert.ok(!text.includes("someone.sol") && !text.includes("Automated Trader") && !text.includes("labels"), "labels, names and tags never leave the mapper");
  assert.equal(summarizeAddressEvidence({ state: "FRESH", evidence: wallet, reason: null, served: "provider" }), "evidence-found");

  const program = mapAddressEvidence({ address: PROGRAM, fetchedAtMs: NOW, findings: { state: "unsupported", reason: "Unsupported risk entity" }, sanctions: { state: "answered", json: sanctionsClean(PROGRAM) } });
  assert.equal(program.findings.state, "unsupported");
  assert.equal(program.subject.kind, "unknown");
  assert.equal(program.sanctions.state, "clean");
  assert.equal(summarizeAddressEvidence({ state: "FRESH", evidence: program, reason: null, served: "provider" }), "unsupported", "screened clean, yet the engine could not read the address — never green");

  const listed = mapAddressEvidence({ address: WALLET, fetchedAtMs: NOW, findings: { state: "answered", json: findings({ count: 0, medium: 0, overallRisk: 5 }) }, sanctions: { state: "answered", json: { ...sanctionsClean(), is_sanctioned: true, sanctions_status: "sanctioned" } } });
  assert.equal(listed.sanctions.state, "sanctioned");
  assert.equal(summarizeAddressEvidence({ state: "FRESH", evidence: listed, reason: null, served: "provider" }), "sanctioned");

  const clean = mapAddressEvidence({ address: WALLET, fetchedAtMs: NOW, findings: { state: "answered", json: findings({ count: 0, medium: 0, high: 0, overallRisk: 8 }) }, sanctions: { state: "answered", json: sanctionsClean() } });
  assert.equal(summarizeAddressEvidence({ state: "FRESH", evidence: clean, reason: null, served: "provider" }), "nothing-found");
  const half = mapAddressEvidence({ address: WALLET, fetchedAtMs: NOW, findings: { state: "answered", json: findings({ count: 0, medium: 0, high: 0, overallRisk: 8 }) }, sanctions: { state: "unavailable", reason: "503" } });
  assert.equal(half.sanctions.state, "unavailable");
  assert.equal(summarizeAddressEvidence({ state: "FRESH", evidence: half, reason: null, served: "provider" }), "partly-checked");
  const unknownScreen = mapAddressEvidence({ address: WALLET, fetchedAtMs: NOW, findings: { state: "answered", json: findings({ count: 0, medium: 0, high: 0, overallRisk: 8 }) }, sanctions: { state: "answered", json: { ...sanctionsClean(), sanctions_status: "unknown" } } });
  assert.equal(unknownScreen.sanctions.state, "unknown", "the source's own word for a screening it could not complete");
  assert.equal(summarizeAddressEvidence({ state: "FRESH", evidence: unknownScreen, reason: null, served: "provider" }), "partly-checked");

  assert.equal(mapAddressEvidence({ address: WALLET, fetchedAtMs: NOW, findings: { state: "unavailable", reason: "down" }, sanctions: { state: "unavailable", reason: "down" } }), null);
  assert.deepEqual([riskBandOf(0), riskBandOf(24.9), riskBandOf(25), riskBandOf(49.9), riskBandOf(50), riskBandOf(74.9), riskBandOf(75), riskBandOf(100), riskBandOf(null)], ["low", "low", "medium", "medium", "high", "high", "critical", "critical", null]);
});

/* ------------------------------------------------------------ the conditions */

test("the conditions: percent, count and flag figures format, describe and validate; an authority rule is renounced or present and nothing else", () => {
  assert.equal(formatEvidenceValue(38.69, "percent"), "38.7%");
  assert.equal(formatEvidenceValue(0.05, "percent"), "0.05%");
  assert.equal(formatEvidenceValue(100, "percent"), "100%");
  assert.equal(formatEvidenceValue(1_016_981, "count"), "1,016,981");
  assert.equal(formatEvidenceValue(1, "flag"), "present");
  assert.equal(formatEvidenceValue(0, "flag"), "renounced");
  const top = { metric: "top10_holder_share_pct", window: "now", operator: "lte", threshold: 40, mode: "required", onUnknown: "block" };
  assert.equal(describeEvidenceCondition(top, EVIDENCE_METRICS.find((metric) => metric.id === "top10_holder_share_pct")), "share held by the top 10 holders ≤ 40%", "no window word on a point-in-time figure");
  const mint = { metric: "mint_authority", window: "now", operator: "lte", threshold: 0, mode: "required", onUnknown: "block" };
  assert.equal(describeEvidenceCondition(mint, EVIDENCE_METRICS.find((metric) => metric.id === "mint_authority")), "mint authority: renounced");
  assert.equal(describeEvidenceCondition({ ...mint, operator: "gte", threshold: 1 }, EVIDENCE_METRICS.find((metric) => metric.id === "mint_authority"), "uk"), "право емісії: present");
  assert.deepEqual(validateEvidenceConditions([top, mint]), []);
  assert.equal(validateEvidenceConditions([{ ...mint, operator: "gt", threshold: 0 }])[0].path, "evidenceConditions[0].threshold", "an authority is either present or renounced");
  assert.equal(validateEvidenceConditions([{ ...mint, threshold: 0.5 }])[0].path, "evidenceConditions[0].threshold");
  assert.match(validateEvidenceConditions([{ ...top, threshold: 120 }])[0].message, /at most 100/);
  assert.match(validateEvidenceConditions([{ ...top, window: "24h" }])[0].message, /window/, "a structural figure has no rolling window");
  assert.match(validateEvidenceConditions([{ metric: "holder_count", window: "now", operator: "gte", threshold: 10.5, mode: "advisory", onUnknown: "warn" }])[0].message, /whole number/);
  const sniper = { metric: "sniper_holding_pct", window: "now", operator: "lte", threshold: 5, mode: "required", onUnknown: "block" };
  assert.match(validateEvidenceConditions([sniper])[0].message, /labelled group/, "a cohort figure informs, never blocks");
  assert.deepEqual(validateEvidenceConditions([{ ...sniper, mode: "advisory", onUnknown: "warn" }]), []);
  assert.equal(providerOfCondition(top), "ddxyz");
  assert.deepEqual(readsOf([top, mint, { metric: "dex_volume_usd", window: "24h", operator: "gte", threshold: 1, mode: "required", onUnknown: "block" }, { metric: "whale_net_flow_usd", window: "24h", operator: "gt", threshold: 0, mode: "advisory", onUnknown: "warn" }]), [
    { provider: "ddxyz", window: "now" },
    { provider: "nansen", window: "24h" },
  ]);
});

test("the conditions: judged on the structure — an authority rule passes and fails in words, a stale or absent figure is unknown, a read from the other provider is unknown", () => {
  const snapshot = mapTradingLiteSnapshot({ mint: BONK, fetchedAtMs: NOW, json: tradingLite() });
  const read = { state: "FRESH", snapshot, reason: null, served: "provider" };
  const renounced = judgeEvidenceCondition({ metric: "mint_authority", window: "now", operator: "lte", threshold: 0, mode: "required", onUnknown: "block" }, read, NOW);
  assert.equal(renounced.outcome, "pass");
  assert.equal(renounced.reason, "renounced, as the rule wants");
  assert.equal(renounced.actual, "renounced · asked 17:20 UTC");
  const present = judgeEvidenceCondition({ metric: "freeze_authority", window: "now", operator: "gte", threshold: 1, mode: "advisory", onUnknown: "warn" }, read, NOW);
  assert.equal(present.outcome, "fail");
  assert.equal(present.reason, "renounced — the rule wants present");
  const top = judgeEvidenceCondition({ metric: "top10_holder_share_pct", window: "now", operator: "lte", threshold: 40, mode: "required", onUnknown: "block" }, read, NOW);
  assert.equal(top.outcome, "pass");
  assert.equal(top.reason, "38.7% ≤ 40%");
  assert.equal(top.expected, "share held by the top 10 holders ≤ 40%");
  const tight = judgeEvidenceCondition({ metric: "top10_holder_share_pct", window: "now", operator: "lte", threshold: 30, mode: "required", onUnknown: "block" }, read, NOW);
  assert.equal(tight.outcome, "fail");
  assert.equal(tight.reason, "38.7% is not ≤ 30%");
  const stale = judgeEvidenceCondition({ metric: "top10_holder_share_pct", window: "now", operator: "lte", threshold: 40, mode: "required", onUnknown: "block" }, read, NOW + 11 * 60_000);
  assert.equal(stale.outcome, "unknown");
  assert.match(stale.actual, /stale/);
  const usdc = { state: "FRESH", snapshot: mapTradingLiteSnapshot({ mint: USDC, fetchedAtMs: NOW, json: tradingLite({ CA: USDC, Top10Holders: 0 }) }), reason: null, served: "provider" };
  const absent = judgeEvidenceCondition({ metric: "top10_holder_share_pct", window: "now", operator: "lte", threshold: 40, mode: "required", onUnknown: "block" }, usdc, NOW);
  assert.equal(absent.outcome, "unknown", "a share the engine did not measure cannot pass");
  assert.equal(absent.actual, "no data");
  const market = { state: "FRESH", snapshot: { ...snapshot, provider: "nansen" }, reason: null, served: "provider" };
  assert.equal(judgeEvidenceCondition({ metric: "mint_authority", window: "now", operator: "lte", threshold: 0, mode: "required", onUnknown: "block" }, market, NOW).outcome, "unknown", "a read from another source than the one serving the figure never passes");
});

/* ------------------------------------------------------------ the client */

test("the client: the key in one header and nowhere else, chain=sol on every call, a family the rights map does not allow refused before a socket opens", async () => {
  const provider = fakeProvider();
  const client = createDdxyzClient({ key: KEY, fetchImpl: provider.fetchImpl, minGapMs: 0 });
  const call = await client.call("trading-lite", BONK);
  assert.ok(call.ok);
  assert.equal(call.headers.computeUnits, 4);
  assert.equal(call.headers.requestId, "req-tl");
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].url, `https://api.webacy.com/trading-lite/${BONK}?chain=sol`);
  assert.equal(provider.calls[0].init.headers["x-api-key"], KEY);
  assert.equal(provider.calls[0].init.method, "GET");
  assert.ok(!JSON.stringify({ url: provider.calls[0].url, json: call.json }).includes(KEY), "the key is not in the URL or the body");
  const refused = await client.call("holder-analysis", BONK);
  assert.equal(refused.ok, false);
  assert.equal(refused.kind, "refused");
  assert.equal(provider.calls.length, 1, "no socket opened for a gated family");
  const keyless = createDdxyzClient({ key: null, fetchImpl: provider.fetchImpl, minGapMs: 0 });
  assert.equal(keyless.configured, false);
  assert.equal((await keyless.call("trading-lite", BONK)).kind, "auth");
  assert.equal(readDdxyzHeaders(new Headers({ "x-webacy-cu": "3", "x-amzn-requestid": "abc", "retry-after": "7", "x-ratelimit-remaining": "5904" })).retryAfterSeconds, 7);
});

test("the client: one request a second within an instance; a retry only for a network error or a timeout, never for a 5xx that would buy the same answer twice", async () => {
  const provider = fakeProvider();
  const client = createDdxyzClient({ key: KEY, fetchImpl: provider.fetchImpl, minGapMs: 120 });
  const started = Date.now();
  await Promise.all([client.call("trading-lite", BONK), client.call("sanctions", WALLET), client.call("addresses", WALLET)]);
  assert.ok(Date.now() - started >= 230, `three calls are paced two gaps apart (${Date.now() - started} ms)`);
  assert.equal(provider.calls.length, 3);

  let faults = 0;
  const flaky = fakeProvider({ "/trading-lite/": () => (faults++ === 0 ? new TypeError("fetch failed") : { status: 200, body: tradingLite(), headers: { "x-webacy-cu": "4" } }) });
  const retried = await createDdxyzClient({ key: KEY, fetchImpl: flaky.fetchImpl, minGapMs: 0 }).call("trading-lite", BONK);
  assert.ok(retried.ok && retried.retried, "a network error is retried once");

  const down = fakeProvider({ "/trading-lite/": () => ({ status: 500, body: { statusCode: 500, message: "Internal Server Error", path: "/api/v2/trading-lite/x" }, headers: {} }) });
  const fault = await createDdxyzClient({ key: KEY, fetchImpl: down.fetchImpl, minGapMs: 0 }).call("trading-lite", BONK);
  assert.equal(fault.ok, false);
  assert.equal(fault.kind, "server");
  assert.equal(down.calls.length, 1, "a 5xx is the provider's answer for this subject; not bought twice");
});

/* ------------------------------------------------------------ the adapter and the governor */

test("the adapter: a token read reserves 4 CU, settles on the provider's own header, maps the answer; a rolling window is not this source's", async () => {
  const provider = fakeProvider();
  const governor = createMemoryGovernor(40);
  const adapter = createDdxyzAdapter({ client: createDdxyzClient({ key: KEY, fetchImpl: provider.fetchImpl, minGapMs: 0 }), governor });
  const read = await adapter.read({ mint: BONK, window: "now", nowMs: NOW });
  assert.equal(read.state, "FRESH");
  assert.equal(metricOf(read.snapshot, "holder_count").value, 1_016_981);
  assert.deepEqual({ ...governor.state(), failures: undefined }, { ceiling: 40, reservedCredits: 4, usedCredits: 4, requests: 1, succeeded: 1, failed: 0, retries: 0, remainingReported: null, lastRequestId: "req-tl", failures: undefined });
  const rolling = await adapter.read({ mint: BONK, window: "24h", nowMs: NOW });
  assert.equal(rolling.state, "UNKNOWN");
  assert.equal(provider.calls.length, 1, "no call for a window this source does not serve");
});

test("the adapter: every failure in its own words — unsupported entity is UNKNOWN; plan gate, refused key, rate limit, fault, timeout and an exhausted budget are UNAVAILABLE; none is ever a snapshot", async () => {
  const answers = {
    "unsupported → UNKNOWN": [{ status: 400, body: { statusCode: 400, message: `Unsupported risk entity for address ${BONK}` }, headers: {} }, "UNKNOWN", /does not analyse/],
    "403 plan gate": [{ status: 403, body: { message: "Forbidden" }, headers: {} }, "UNAVAILABLE", /plan does not include/],
    "401 key": [{ status: 401, body: { message: "Unauthorized" }, headers: {} }, "UNAVAILABLE", /refused the key/],
    "429 rate": [{ status: 429, body: { message: "Rate limit exceeded" }, headers: { "retry-after": "5" } }, "UNAVAILABLE", /rate limit was reached; retry after 5 s/],
    "500 fault": [{ status: 500, body: { statusCode: 500, message: "Internal Server Error" }, headers: {} }, "UNAVAILABLE", /answered 500/],
    "malformed 200": [{ status: 200, body: { hello: "world" }, headers: { "x-webacy-cu": "4" } }, "UNKNOWN", /no data/],
  };
  for (const [name, [answer, state, words]] of Object.entries(answers)) {
    const provider = fakeProvider({ "/trading-lite/": () => answer });
    const governor = createMemoryGovernor(40);
    const adapter = createDdxyzAdapter({ client: createDdxyzClient({ key: KEY, fetchImpl: provider.fetchImpl, minGapMs: 0 }), governor });
    const read = await adapter.read({ mint: BONK, window: "now", nowMs: NOW });
    assert.equal(read.state, state, name);
    assert.match(read.reason, words, name);
    assert.equal(governor.state().requests, 1, `${name}: the call is counted`);
    if (answer.status !== 200) assert.equal(governor.state().usedCredits, 4, `${name}: a failed call without a cost header books the expected price — an unknown price is never zero`);
  }
  const slow = fakeProvider({ "/trading-lite/": () => new Promise((resolve) => setTimeout(() => resolve({ status: 200, body: tradingLite(), headers: {} }), 200)) });
  const timeoutAdapter = createDdxyzAdapter({ client: createDdxyzClient({ key: KEY, fetchImpl: slow.fetchImpl, minGapMs: 0, timeoutMs: 40 }), governor: createMemoryGovernor(40) });
  const timedOut = await timeoutAdapter.read({ mint: BONK, window: "now", nowMs: NOW });
  assert.equal(timedOut.state, "UNAVAILABLE");
  assert.match(timedOut.reason, /did not answer in time/);
  assert.equal(slow.calls.length, 2, "a timeout is retried once, then reported");

  const exhausted = createMemoryGovernor(3);
  const provider = fakeProvider();
  const refused = await createDdxyzAdapter({ client: createDdxyzClient({ key: KEY, fetchImpl: provider.fetchImpl, minGapMs: 0 }), governor: exhausted }).read({ mint: BONK, window: "now", nowMs: NOW });
  assert.equal(refused.state, "UNAVAILABLE");
  assert.match(refused.reason, /budget for today is used up/);
  assert.equal(provider.calls.length, 0, "no call past the ceiling");
  const noBudget = await createDdxyzAdapter({ client: createDdxyzClient({ key: KEY, fetchImpl: provider.fetchImpl, minGapMs: 0 }), governor: createMemoryGovernor(0) }).read({ mint: BONK, window: "now", nowMs: NOW });
  assert.match(noBudget.reason, /No usage budget/);
});

test("the adapter: an address — sanctions first then findings, each governed; a program-owned account is UNKNOWN when the screening is down and unsupported evidence when it answers; a hard refusal of the first engine skips the second", async () => {
  const provider = fakeProvider();
  const governor = createMemoryGovernor(40);
  const adapter = createDdxyzAdapter({ client: createDdxyzClient({ key: KEY, fetchImpl: provider.fetchImpl, minGapMs: 0 }), governor });
  const read = await adapter.readAddress({ address: WALLET, nowMs: NOW });
  assert.equal(read.state, "FRESH");
  assert.equal(read.evidence.findings.band, "high");
  assert.equal(read.evidence.sanctions.state, "clean");
  assert.deepEqual(provider.calls.map((call) => new URL(call.url).pathname), [`/addresses/sanctioned/${WALLET}`, `/addresses/${WALLET}`]);
  assert.equal(governor.state().usedCredits, 4, "1 + 3 CU as the provider priced them");

  const programProvider = fakeProvider({ "/addresses/": () => ({ status: 400, body: { statusCode: 400, message: `Unsupported risk entity for address ${PROGRAM}` }, headers: {} }) });
  const program = await createDdxyzAdapter({ client: createDdxyzClient({ key: KEY, fetchImpl: programProvider.fetchImpl, minGapMs: 0 }), governor: createMemoryGovernor(40) }).readAddress({ address: PROGRAM, nowMs: NOW });
  assert.equal(program.state, "FRESH");
  assert.equal(program.evidence.findings.state, "unsupported");
  assert.equal(summarizeAddressEvidence({ ...program, reason: null, served: "provider" }), "unsupported");

  const bothDown = fakeProvider({ "/addresses/sanctioned/": () => ({ status: 503, body: { message: "unavailable" }, headers: {} }), "/addresses/": () => ({ status: 400, body: { message: "Unsupported risk entity" }, headers: {} }) });
  const unknown = await createDdxyzAdapter({ client: createDdxyzClient({ key: KEY, fetchImpl: bothDown.fetchImpl, minGapMs: 0 }), governor: createMemoryGovernor(40) }).readAddress({ address: PROGRAM, nowMs: NOW });
  assert.equal(unknown.state, "UNAVAILABLE", "the screening's 5xx is a hard refusal: the second engine is not asked and nothing answered");
  assert.equal(bothDown.calls.length, 1);

  const keyRefused = fakeProvider({ "/addresses/sanctioned/": () => ({ status: 401, body: { message: "Unauthorized" }, headers: {} }) });
  const auth = await createDdxyzAdapter({ client: createDdxyzClient({ key: KEY, fetchImpl: keyRefused.fetchImpl, minGapMs: 0 }), governor: createMemoryGovernor(40) }).readAddress({ address: WALLET, nowMs: NOW });
  assert.equal(auth.state, "UNAVAILABLE");
  assert.match(auth.reason, /refused the key/);
  assert.equal(keyRefused.calls.length, 1, "a refused key would meet the second engine the same way");
});

/* ------------------------------------------------------------ the service */

test("the service: window=now goes to the security provider on its own ledger; the second reader costs nothing; the market provider's read is untouched", async () => {
  const provider = fakeProvider();
  const { runtime } = runtimeWith(provider);
  const first = await readMarketEvidence({ mint: BONK, window: "now", nowMs: NOW, runtime });
  assert.equal(first.state, "FRESH");
  assert.equal(first.served, "provider");
  assert.equal(first.snapshot.provider, "ddxyz");
  const second = await readMarketEvidence({ mint: BONK, window: "now", nowMs: NOW + 60_000, runtime });
  assert.equal(second.served, "cache");
  assert.equal(provider.calls.length, 1);
  const usage = await readEvidenceUsage({ nowMs: NOW, runtime });
  const ddxyz = usage.find((entry) => entry.provider === "ddxyz");
  const nansen = usage.find((entry) => entry.provider === "nansen");
  assert.equal(ddxyz.day.usedCredits, 4);
  assert.equal(ddxyz.day.cacheHits, 1);
  assert.equal(ddxyz.day.lastRequestId, "req-tl");
  assert.ok(ddxyz.day.lastSucceededAt, "the last success is recorded (on the settlement's own clock)");
  assert.deepEqual(ddxyz.policy, { dailyCredits: 40, totalCredits: 400, totalPeriod: "month" });
  assert.equal(ddxyz.total.period, "2026-09", "the longer ledger is the UTC month for an allowance that resets monthly");
  assert.equal(nansen.day.requests, 0, "nothing of the market provider moved");
  assert.equal(nansen.configured, false);
  assert.equal(ddxyz.rights.attribution, "Data provided by DD.xyz");
  assert.deepEqual(ddxyz.rights.families.map((family) => family.status), ["allowed-with-attribution", "allowed-with-attribution", "allowed-with-attribution", "plan-gated", "plan-gated", "plan-gated", "unsupported"]);
  assert.equal(totalPeriodOf(resolveEvidenceBudget({ RYNTRA_DDXYZ_DAILY_CREDITS: "40", RYNTRA_DDXYZ_MONTHLY_CREDITS: "400" }, "ddxyz"), NOW), "2026-09");
  assert.equal(resolveEvidenceBudget({ RYNTRA_DDXYZ_DAILY_CREDITS: "40" }, "ddxyz"), null, "a daily ceiling alone is no budget");
});

test("the service: no ceilings, no call — UNAVAILABLE with the reason; a provider fault is remembered for a minute and a stale copy served marked; a stale copy outlives an expired one only inside the hold", async () => {
  const provider = fakeProvider();
  const { runtime: unbudgeted } = runtimeWith(provider, { RYNTRA_DDXYZ_DAILY_CREDITS: undefined, RYNTRA_DDXYZ_MONTHLY_CREDITS: undefined });
  const refused = await readMarketEvidence({ mint: BONK, window: "now", nowMs: NOW, runtime: unbudgeted });
  assert.equal(refused.state, "UNAVAILABLE");
  assert.match(refused.reason, /No usage budget/);
  assert.equal(provider.calls.length, 0);

  let fail = false;
  const flaky = fakeProvider({ "/trading-lite/": () => (fail ? { status: 500, body: { message: "Internal Server Error" }, headers: {} } : { status: 200, body: tradingLite(), headers: { "x-webacy-cu": "4" } }) });
  const { runtime } = runtimeWith(flaky);
  await readMarketEvidence({ mint: BONK, window: "now", nowMs: NOW, runtime });
  fail = true;
  const afterExpiry = NOW + 11 * 60_000;
  const stale = await readMarketEvidence({ mint: BONK, window: "now", nowMs: afterExpiry, runtime });
  assert.equal(stale.state, "STALE");
  assert.equal(stale.served, "stale-cache");
  assert.match(stale.reason, /answered 500/);
  const remembered = await readMarketEvidence({ mint: BONK, window: "now", nowMs: afterExpiry + 10_000, runtime });
  assert.equal(remembered.served, "stale-cache", "inside the minute the failure is remembered, the stale copy still served");
  assert.equal(flaky.calls.length, 2);
  const gone = await readMarketEvidence({ mint: BONK, window: "now", nowMs: NOW + 45 * 60_000, runtime });
  assert.equal(gone.state, "UNAVAILABLE", "past the hold the copy is dropped, not served");
  assert.equal(gone.snapshot, null);
});

test("the service: the recipient check — cached an hour, a program-owned account UNKNOWN, a not-an-address refused before anything is asked, a missing key honest", async () => {
  const provider = fakeProvider();
  const { runtime } = runtimeWith(provider);
  const first = await readAddressEvidence({ address: WALLET, nowMs: NOW, runtime });
  assert.equal(first.state, "FRESH");
  assert.equal(first.served, "provider");
  assert.equal(summarizeAddressEvidence(first), "evidence-found");
  const again = await readAddressEvidence({ address: WALLET, nowMs: NOW + 30 * 60_000, runtime });
  assert.equal(again.served, "cache");
  assert.equal(provider.calls.length, 2, "two engines, once");
  const later = await readAddressEvidence({ address: WALLET, nowMs: NOW + 61 * 60_000, runtime });
  assert.equal(later.served, "provider", "after the hour the address is asked again");
  assert.equal((await readEvidenceUsage({ nowMs: NOW, runtime })).find((entry) => entry.provider === "ddxyz").day.usedCredits, 8);

  const programProvider = fakeProvider({ "/addresses/sanctioned/": () => ({ status: 400, body: { message: "Unsupported risk entity" }, headers: {} }), "/addresses/": () => ({ status: 400, body: { message: "Unsupported risk entity" }, headers: {} }) });
  const { runtime: programRuntime } = runtimeWith(programProvider);
  const program = await readAddressEvidence({ address: PROGRAM, nowMs: NOW, runtime: programRuntime });
  assert.equal(program.state, "UNKNOWN");
  assert.equal(summarizeAddressEvidence(program), "unsupported");

  assert.equal((await readAddressEvidence({ address: "not-an-address", nowMs: NOW, runtime })).state, "UNKNOWN");
  const { runtime: keyless } = runtimeWith(provider, { DDXYZ_API_KEY: undefined });
  const noKey = await readAddressEvidence({ address: WALLET, nowMs: NOW, runtime: keyless });
  assert.equal(noKey.state, "UNAVAILABLE");
  assert.match(noKey.reason, /key is not configured/);
});
