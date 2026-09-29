// Run from repo root: node --test lib/evidence/service.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { createEvidenceBudgetGovernor, resolveEvidenceBudget, spentOf } from "./budget.ts";
import { evidenceCacheKey } from "./cache.ts";
import { createNansenClient, readNansenHeaders } from "./providers/nansen/client.server.ts";
import { mapNansenSnapshot } from "./providers/nansen/mapper.ts";
import { callableFamilies, filterFields, NANSEN_RIGHTS } from "./rights.ts";
import { createEvidenceRuntime, readEvidenceUsage, readMarketEvidence } from "./service.server.ts";
import { metricOf } from "./snapshot.ts";

/**
 * The layer's rules, each proven on the memory store with a fake provider:
 * no paid call without budget; the rights map is the mapper's allowlist; the
 * second reader costs nothing; a failure is remembered; a stale copy is
 * served marked when the refresh fails; the key never leaks.
 */

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const KEY = "nansen-test-key-0123456789abcdef";
const NOW = Date.parse("2026-09-16T12:30:00.000Z");

const screenerRow = (address = BONK) => ({
  chain: "solana",
  token_address: address,
  token_symbol: "BONK",
  token_age_days: 1000,
  market_cap_usd: 1_000_000_000,
  liquidity: 20_000_000,
  price_usd: 0.00002,
  price_change: 1.5,
  fdv: 1_200_000_000,
  buy_volume: 3_000_000,
  sell_volume: 2_500_000,
  volume: 5_500_000,
  netflow: 500_000,
});

const flowsRow = () => ({
  public_figure_net_flow_usd: 1000,
  public_figure_wallet_count: 2,
  top_pnl_net_flow_usd: 2000,
  whale_net_flow_usd: -120_000,
  whale_avg_flow_usd: 10_000,
  whale_wallet_count: 12,
  smart_trader_net_flow_usd: 50_000,
  smart_trader_wallet_count: 20,
  exchange_net_flow_usd: 300_000,
  exchange_wallet_count: 0,
  fresh_wallets_net_flow_usd: 5000,
});

/** A fake provider: answers per path, counts calls, records what it was sent. */
function fakeProvider(overrides = {}) {
  const calls = [];
  const behaviour = {
    "/api/v1/token-screener": () => ({ status: 200, body: { data: [screenerRow()], pagination: { page: 1, per_page: 5, is_last_page: true } }, headers: { "x-nansen-credits-cost": "1", "x-nansen-credits-used": "1", "x-nansen-credits-remaining": "19999", "x-request-id": "req-screener" } }),
    "/api/v1/tgm/flow-intelligence": () => ({ status: 200, body: { data: [flowsRow()], warnings: ["Exchange wallet count is not tracked."] }, headers: { "x-nansen-credits-cost": "1", "x-nansen-credits-used": "1", "x-nansen-credits-remaining": "19998", "x-request-id": "req-flows" } }),
    ...overrides,
  };
  const fetchImpl = async (url, init) => {
    const path = url.replace("https://api.nansen.ai", "");
    calls.push({ path, headers: init.headers, body: JSON.parse(init.body) });
    const answer = behaviour[path];
    if (!answer) return new Response(JSON.stringify({ error: "not found", code: "not_found", message: "no such path" }), { status: 404, headers: { "content-type": "application/json" } });
    const out = answer(calls.length);
    if (out instanceof Error) throw out;
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { "content-type": "application/json", ...(out.headers ?? {}) } });
  };
  return { calls, fetchImpl };
}

function runtimeWith(provider, env = {}) {
  const store = createMemoryGuardStore();
  const runtime = createEvidenceRuntime({ store, env: { NANSEN_API_KEY: KEY, RYNTRA_NANSEN_DAILY_CREDITS: "50", RYNTRA_NANSEN_TOTAL_CREDITS: "100", ...env }, fetchImpl: provider.fetchImpl });
  return { store, runtime };
}

test("the rights map: three allowed families with attribution, the restricted and prohibited ones never callable", () => {
  const callable = callableFamilies(NANSEN_RIGHTS).map((family) => family.family);
  assert.deepEqual(callable, ["tgm/token-screener", "tgm/flow-intelligence"], "who-bought-sold is allowed but reads no field in this slice");
  for (const family of NANSEN_RIGHTS.families) {
    if (family.status !== "allowed-with-attribution") assert.equal(family.fields.length, 0, `${family.family} must read nothing`);
  }
  assert.equal(NANSEN_RIGHTS.attribution.text, "Powered by Nansen API");
  const kept = filterFields(NANSEN_RIGHTS.families[0], { volume: 1, buy_volume: 2, address_label: "Whale", address: "abc", token_symbol: "X" });
  assert.deepEqual(Object.keys(kept).sort(), ["buy_volume", "token_symbol", "volume"]);
});

test("the mapper reads named fields only and never a zero for an absent figure", () => {
  const snapshot = mapNansenSnapshot({
    mint: BONK,
    window: "24h",
    fetchedAtMs: NOW,
    screener: { row: screenerRow(), answered: true, warnings: [], failure: null },
    flows: { row: null, answered: true, warnings: [], failure: null },
  });
  assert.equal(metricOf(snapshot, "dex_volume_usd").value, 5_500_000);
  assert.equal(metricOf(snapshot, "dex_net_volume_usd").value, 500_000);
  assert.equal(metricOf(snapshot, "whale_wallet_count").value, null);
  assert.equal(metricOf(snapshot, "whale_wallet_count").coverage, "absent");
  assert.deepEqual(snapshot.families, ["tgm/token-screener"]);
  assert.deepEqual(snapshot.warnings, ["The source has no movement figures for this token."]);
  assert.equal(snapshot.observedAt, null, "the HTTP clock is never the observation time");
  assert.equal(snapshot.expiresAt, "2026-09-16T12:35:00.000Z", "five minutes: the screener's own window");
  assert.equal(JSON.stringify(snapshot).includes("address"), false);
  assert.equal(mapNansenSnapshot({ mint: BONK, window: "24h", fetchedAtMs: NOW, screener: { row: null, answered: true, warnings: [], failure: null }, flows: { row: null, answered: true, warnings: [], failure: null } }), null);
});

test("one read: two governed calls, the exact mint, the key in the header and nowhere else", async () => {
  const provider = fakeProvider();
  const { runtime } = runtimeWith(provider);
  const read = await readMarketEvidence({ mint: BONK, window: "24h", nowMs: NOW, runtime });
  assert.equal(read.state, "FRESH");
  assert.equal(read.served, "provider");
  assert.equal(provider.calls.length, 2);
  assert.deepEqual(provider.calls[0].body, { chains: ["solana"], timeframe: "24h", filters: { token_address: BONK }, pagination: { page: 1, per_page: 5 } });
  assert.deepEqual(provider.calls[1].body, { chain: "solana", token_address: BONK, timeframe: "1d" });
  assert.equal(provider.calls[0].headers.apikey, KEY);
  assert.equal(JSON.stringify(read).includes(KEY), false, "the key never reaches an answer");
  assert.equal(metricOf(read.snapshot, "exchange_net_flow_usd").value, 300_000);
  assert.equal(metricOf(read.snapshot, "whale_wallet_count").value, 12);
  assert.deepEqual(read.snapshot.warnings, ["Exchange wallet count is not tracked."]);
  assert.equal(read.snapshot.providerLagSeconds, 600);

  const [usage] = await readEvidenceUsage({ nowMs: NOW, runtime });
  assert.equal(usage.provider, "nansen");
  assert.equal(usage.day.requests, 2);
  assert.equal(usage.day.usedCredits, 2);
  assert.equal(usage.day.reservedCredits, 2);
  assert.equal(usage.day.remainingReported, 19998);
  assert.equal(usage.total.usedCredits, 2);
  assert.equal(usage.day.lastRequestId, "req-flows");
});

test("the second reader costs nothing; a burst is one flight; a later read after expiry pays again", async () => {
  const provider = fakeProvider();
  const { runtime } = runtimeWith(provider);
  const first = await readMarketEvidence({ mint: BONK, window: "24h", nowMs: NOW, runtime });
  const second = await readMarketEvidence({ mint: BONK, window: "24h", nowMs: NOW + 60_000, runtime });
  assert.equal(second.served, "cache");
  assert.equal(second.snapshot.fetchedAt, first.snapshot.fetchedAt);
  assert.equal(provider.calls.length, 2);

  /* Past expiry: a fresh read, from the provider. */
  const later = await readMarketEvidence({ mint: BONK, window: "24h", nowMs: NOW + 6 * 60_000, runtime });
  assert.equal(later.served, "provider");
  assert.equal(provider.calls.length, 4);

  /* A burst on an uncached window shares one flight. */
  const burst = await Promise.all([1, 2, 3, 4, 5].map(() => readMarketEvidence({ mint: BONK, window: "7d", nowMs: NOW, runtime })));
  assert.ok(burst.every((read) => read.state === "FRESH"));
  assert.equal(provider.calls.length, 6, "five concurrent readers, two calls");
  const [usage] = await readEvidenceUsage({ nowMs: NOW, runtime });
  assert.equal(usage.day.cacheHits, 1);
});

test("no budget, no call; the ceiling refuses before the spend; the settlement books the expected cost without headers", async () => {
  const provider = fakeProvider();
  const { runtime } = runtimeWith(provider, { RYNTRA_NANSEN_DAILY_CREDITS: undefined, RYNTRA_NANSEN_TOTAL_CREDITS: undefined });
  const read = await readMarketEvidence({ mint: BONK, window: "24h", nowMs: NOW, runtime });
  assert.equal(read.state, "UNAVAILABLE");
  assert.match(read.reason, /No credit budget/);
  assert.equal(provider.calls.length, 0);

  const store = createMemoryGuardStore();
  const governor = createEvidenceBudgetGovernor({ store, provider: "nansen", policy: { dailyCredits: 3, totalCredits: 10 } });
  assert.equal((await governor.reserve({ expectedCredits: 2, nowMs: NOW })).ok, true);
  const refused = await governor.reserve({ expectedCredits: 2, nowMs: NOW });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "BUDGET_EXHAUSTED");
  await governor.settle({ expectedCredits: 2, settlement: { succeeded: true, creditsUsed: null, creditsRemaining: null, requestId: null, retried: false }, nowMs: NOW });
  const ledgers = await governor.read(NOW);
  assert.equal(ledgers.day.usedCredits, 2, "a missing header books the expected cost");
  assert.equal(spentOf(ledgers.day), 2);
  assert.equal(resolveEvidenceBudget({ RYNTRA_NANSEN_DAILY_CREDITS: "0", RYNTRA_NANSEN_TOTAL_CREDITS: "5" }), null);
  assert.deepEqual(resolveEvidenceBudget({ RYNTRA_NANSEN_DAILY_CREDITS: "250", RYNTRA_NANSEN_TOTAL_CREDITS: "2000" }), { dailyCredits: 250, totalCredits: 2000, totalPeriod: "packet" });
});

test("a provider fault is UNAVAILABLE with its reason, remembered for a minute, and a stale copy is served marked", async () => {
  let fail = false;
  const provider = fakeProvider({
    "/api/v1/token-screener": () => (fail ? { status: 503, body: { error: "unavailable", code: "service_unavailable", message: "try later" }, headers: { "x-nansen-credits-used": "0" } } : { status: 200, body: { data: [screenerRow()], pagination: { page: 1, per_page: 5, is_last_page: true } }, headers: { "x-nansen-credits-used": "1", "x-nansen-credits-remaining": "100" } }),
  });
  const { runtime } = runtimeWith(provider);
  const good = await readMarketEvidence({ mint: BONK, window: "24h", nowMs: NOW, runtime });
  assert.equal(good.state, "FRESH");

  fail = true;
  const afterExpiry = NOW + 6 * 60_000;
  const stale = await readMarketEvidence({ mint: BONK, window: "24h", nowMs: afterExpiry, runtime });
  assert.equal(stale.state, "STALE", "the refresh failed; the last copy is served, marked");
  assert.equal(stale.served, "stale-cache");
  assert.match(stale.reason, /answered 503/);
  const callsAfterFailure = provider.calls.length;
  assert.equal(callsAfterFailure, 4, "the screener call retried once on 5xx, the flows call was not made");

  const again = await readMarketEvidence({ mint: BONK, window: "24h", nowMs: afterExpiry + 10_000, runtime });
  assert.equal(again.served, "stale-cache", "the failure is remembered; no new call");
  assert.equal(provider.calls.length, callsAfterFailure);

  const [usage] = await readEvidenceUsage({ nowMs: afterExpiry, runtime });
  assert.equal(usage.day.failed, 1);
  assert.deepEqual(usage.day.failures, { server: 1 }, "the failure is counted by its kind");
  assert.equal(usage.day.retries, 1);
  assert.equal(usage.day.usedCredits, 2, "the 503 reported 0 credits used");

  /* A fresh key on a token nobody covers is UNKNOWN, not a card of zeros. */
  const empty = fakeProvider({ "/api/v1/token-screener": () => ({ status: 200, body: { data: [], pagination: { page: 1, per_page: 5, is_last_page: true } }, headers: {} }), "/api/v1/tgm/flow-intelligence": () => ({ status: 200, body: { data: [] }, headers: {} }) });
  const unknown = await readMarketEvidence({ mint: "So11111111111111111111111111111111111111112", window: "24h", nowMs: NOW, runtime: runtimeWith(empty).runtime });
  assert.equal(unknown.state, "UNKNOWN");
  assert.equal(unknown.snapshot, null);
});

test("a refused key and an exhausted account are said plainly; an address that is not a mint is not asked", async () => {
  const denied = fakeProvider({ "/api/v1/token-screener": () => ({ status: 401, body: { error: "unauthorized", code: "invalid_api_key", message: `bad key ${KEY}` }, headers: {} }) });
  const { runtime } = runtimeWith(denied);
  const read = await readMarketEvidence({ mint: BONK, window: "24h", nowMs: NOW, runtime });
  assert.equal(read.state, "UNAVAILABLE");
  assert.equal(read.reason, "The provider refused the key.");
  assert.equal(denied.calls.length, 1, "the second family is not asked after a hard refusal");

  const broke = fakeProvider({ "/api/v1/token-screener": () => ({ status: 402, body: { error: "payment", code: "insufficient_credits", message: "0 left" }, headers: { "x-nansen-credits-used": "0", "x-nansen-credits-remaining": "0" } }) });
  const out = await readMarketEvidence({ mint: BONK, window: "24h", nowMs: NOW, runtime: runtimeWith(broke).runtime });
  assert.equal(out.reason, "The provider account has no credits left.");

  const junk = await readMarketEvidence({ mint: "not-a-mint", window: "24h", nowMs: NOW, runtime });
  assert.equal(junk.state, "UNKNOWN");
  assert.equal(denied.calls.length, 1);

  const unconfigured = createEvidenceRuntime({ store: createMemoryGuardStore(), env: { RYNTRA_NANSEN_DAILY_CREDITS: "5", RYNTRA_NANSEN_TOTAL_CREDITS: "5" }, fetchImpl: denied.fetchImpl });
  const none = await readMarketEvidence({ mint: BONK, window: "24h", nowMs: NOW, runtime: unconfigured });
  assert.equal(none.reason, "The provider key is not configured.");
});

test("the client refuses a family outside the rights map and scrubs the key from an error", async () => {
  const client = createNansenClient({ key: KEY, fetchImpl: async () => new Response(JSON.stringify({ code: "x", message: `leak ${KEY} here` }), { status: 500, headers: { "content-type": "application/json" } }) });
  const refused = await client.call("smart-money/inflows", {});
  assert.equal(refused.ok, false);
  assert.equal(refused.kind, "refused");
  const server = await client.call("tgm/token-screener", { chains: ["solana"] });
  assert.equal(server.ok, false);
  assert.equal(server.kind, "server");
  assert.equal(server.retried, true);
  assert.equal(server.message.includes(KEY), false);
  const headers = readNansenHeaders(new Headers({ "x-nansen-credits-cost": "1", "x-nansen-credits-used": "1", "x-nansen-credits-remaining": "19998", "x-request-id": "r1", "retry-after": "7" }));
  assert.deepEqual(headers, { creditsCost: 1, creditsUsed: 1, creditsRemaining: 19998, requestId: "r1", retryAfterSeconds: 7, rateLimitRemaining: null });
  assert.equal(evidenceCacheKey("nansen", BONK, "7d"), `nansen:solana:mainnet:${BONK}:7d`);
});
