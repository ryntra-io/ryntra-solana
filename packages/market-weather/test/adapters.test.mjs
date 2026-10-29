/* The adapters on recorded and documented-shape answers (fixtures/PROVENANCE.md). No test touches the network. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  WSOL,
  meteoraPoolsUrl,
  parseMeteoraPools,
  parsePriceV3,
  parseTokensV2,
  poolPriceReading,
  poolsDepth,
  readJson,
  readMarketWeather,
} from "../src/index.ts";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const TOPENAI = "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const LAUNCH = "MWDemoLaunch1111111111111111111111111111111";
const POOL = "MWDemoPoo1Graduated1111111111111111111111111";
const SNEAKY = "MWDemoUnverified111111111111111111111111111";
const READ_AT = "2026-09-21T12:00:30.000Z";
const NOW = Date.parse("2026-09-21T12:01:00Z");

test("Price V3: one reading per mint, priced at the time of reading, re-readable by its own URL", () => {
  const prices = parsePriceV3({ ...fixture("jupiter-price-v3.shape.json"), "not-a-mint": { usdPrice: 1 } }, READ_AT);
  assert.equal(prices.size, 5);
  const nvdax = prices.get(NVDAX);
  assert.equal(nvdax.price.source, "jupiter-price-v3");
  assert.equal(nvdax.price.timeFrom, "read");
  assert.equal(nvdax.price.observedAt, READ_AT);
  assert.equal(nvdax.price.url, `https://lite-api.jup.ag/price/v3?ids=${NVDAX}`);
  assert.deepEqual(nvdax.change24h.value, { state: "measured", value: 2.6 });
  const zero = parsePriceV3({ [USDC]: { usdPrice: 0 } }, READ_AT).get(USDC);
  assert.equal(zero.price.value.state, "not_measured", "a zero price is not a price");
  assert.equal(zero.change24h.value.state, "not_measured", "a move left out is not a zero move");
});

test("Tokens V2: depth, move and authorities, at the time the source states", () => {
  const tokens = parseTokensV2(fixture("jupiter-tokens-v2.shape.json"), READ_AT);
  assert.equal(tokens.size, 6);
  const nvdax = tokens.get(NVDAX);
  assert.equal(nvdax.liquidity.timeFrom, "source");
  assert.equal(nvdax.liquidity.observedAt, "2026-09-21T12:00:00.000Z");
  assert.deepEqual(nvdax.authorities.map((read) => [read.authority, read.state]), [["mint", "active"], ["freeze", "active"]]);
  assert.deepEqual(tokens.get(WSOL).authorities.map((read) => read.state), ["revoked", "revoked"]);
  assert.deepEqual(tokens.get(SNEAKY).authorities.map((read) => read.state), ["not_measured", "not_measured"], "an audit that does not say is silence, not «revoked»");
  const launch = tokens.get(LAUNCH);
  assert.equal(launch.launchpad, "met-dbc");
  assert.equal(launch.graduatedPool, POOL);
  assert.equal(launch.graduatedAt, "2026-09-01T09:30:00.000Z");
  assert.equal(parseTokensV2({ not: "a list" }, READ_AT).size, 0);
});

test("Meteora DLMM (recorded): the pool's own price, its depth, and the token's freeze authority", () => {
  const pools = parseMeteoraPools(fixture("meteora-dlmm-NVDAx.recorded-2026-09-21.json"), "dlmm", NVDAX, READ_AT);
  assert.equal(pools.length, 5);
  const sol = pools.find((pool) => pool.address === "FCn5zw4gAcfRpQgst5ThFuzBGXbbJ6RocVErgC4vJ9j1");
  assert.equal(sol.side, "x");
  assert.equal(sol.counterMint, WSOL);
  assert.equal(sol.freeze.state, "active");
  assert.equal(sol.freeze.source, "meteora-dlmm");
  assert.equal(sol.url, "https://dlmm.datapi.meteora.ag/pools/FCn5zw4gAcfRpQgst5ThFuzBGXbbJ6RocVErgC4vJ9j1");
  const reading = poolPriceReading(pools, { minTvlUsd: 50_000, solUsd: 112.85721942177028 });
  assert.equal(reading.source, "meteora-dlmm");
  assert.equal(reading.derivation, "pool price in SOL × SOL/USD");
  assert.ok(Math.abs(reading.value.value - 224.72) < 0.01, String(reading.value.value));
  assert.equal(poolPriceReading(pools, { minTvlUsd: 50_000, solUsd: null }), null, "a SOL pool without SOL's price is not a dollar price");
  assert.equal(poolPriceReading(pools, { minTvlUsd: 100_000, solUsd: 112 }), null, "no pool deep enough");
});

test("Meteora DLMM (recorded): a dollar pool prices the token directly", () => {
  const pools = parseMeteoraPools(fixture("meteora-dlmm-tOpenAI.recorded-2026-09-21.json"), "dlmm", TOPENAI, READ_AT);
  const reading = poolPriceReading(pools, { minTvlUsd: 50_000, solUsd: null });
  assert.equal(reading.derivation, "pool price in a dollar stablecoin");
  assert.ok(Math.abs(reading.value.value - 968.63) < 0.01);
});

test("Meteora DAMM v2 (recorded): a token on the Y side reads the inverse price; odd counters are not dollar prices", () => {
  const pools = parseMeteoraPools(fixture("meteora-damm-v2-NVDAx-quote.recorded-2026-09-21.json"), "damm-v2", NVDAX, READ_AT);
  assert.equal(pools.length, 5);
  const gpucat = pools.find((pool) => pool.address && pool.side === "y" && pool.priceInCounter.state === "measured");
  assert.ok(gpucat.priceInCounter.value > 1e6, "NVDAx priced in a meme coin is a large number");
  assert.equal(poolPriceReading(pools, { minTvlUsd: 0, solUsd: 112 }), null);
});

test("Meteora DAMM v2 (recorded): a blacklisted pool and empty pools add no depth and no price", () => {
  const pools = parseMeteoraPools(fixture("meteora-damm-v2-tOpenAI.recorded-2026-09-21.json"), "damm-v2", TOPENAI, READ_AT);
  assert.equal(pools.filter((pool) => pool.blacklisted).length, 1);
  assert.equal(poolPriceReading(pools, { minTvlUsd: 1, solUsd: 112 }), null);
  assert.ok(poolsDepth(pools).value < 1);
  assert.equal(poolsDepth([]).state, "not_measured");
  assert.equal(parseMeteoraPools(fixture("meteora-damm-v2-NVDAx-base.recorded-2026-09-21.json"), "damm-v2", TOPENAI, READ_AT).length, 0, "a pool that does not hold the mint");
});

test("readJson: GET only, https only, no retry on 429, a byte ceiling, and nothing throws", async () => {
  const calls = [];
  const fake = (status, body) => async (url, init) => {
    calls.push([url, init.method]);
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  const now = () => NOW;
  assert.equal((await readJson("http://lite-api.jup.ag/price/v3", { fetch: fake(200, "{}"), now })).code, "URL");
  assert.equal((await readJson("https://user:pw@example.org/", { fetch: fake(200, "{}"), now })).code, "URL");
  calls.length = 0;
  const limited = await readJson("https://example.org/a", { fetch: fake(429, ""), now });
  assert.equal(limited.code, "RATE_LIMITED");
  assert.equal(calls.length, 1);
  assert.equal((await readJson("https://example.org/a", { fetch: fake(503, ""), now })).code, "HTTP");
  assert.equal((await readJson("https://example.org/a", { fetch: fake(200, "x".repeat(20)), maxBytes: 10, now })).code, "TOO_LARGE");
  assert.equal((await readJson("https://example.org/a", { fetch: fake(200, "{not json"), now })).code, "SHAPE");
  const timeout = async () => {
    throw Object.assign(new Error("slow"), { name: "TimeoutError" });
  };
  assert.equal((await readJson("https://example.org/a", { fetch: timeout, now })).code, "TIMEOUT");
  const ok = await readJson("https://example.org/a", { fetch: fake(200, '{"a":1}'), now });
  assert.deepEqual([ok.ok, ok.body, ok.readAt], [true, { a: 1 }, new Date(NOW).toISOString()]);
  assert.ok(calls.every(([, method]) => method === "GET"));
});

/** A fake network that answers from the fixtures, and remembers every call it was asked. */
function fixtureNetwork() {
  const calls = [];
  const empty = { total: 0, data: [] };
  const routes = [
    [/lite-api\.jup\.ag\/price\/v3/, () => fixture("jupiter-price-v3.shape.json")],
    [/lite-api\.jup\.ag\/tokens\/v2\/search/, () => fixture("jupiter-tokens-v2.shape.json")],
    [new RegExp(`dlmm\\.datapi\\.meteora\\.ag/pools\\?.*${NVDAX}`), () => fixture("meteora-dlmm-NVDAx.recorded-2026-09-21.json")],
    [new RegExp(`dlmm\\.datapi\\.meteora\\.ag/pools\\?.*${TOPENAI}`), () => fixture("meteora-dlmm-tOpenAI.recorded-2026-09-21.json")],
    [new RegExp(`damm-v2\\.datapi\\.meteora\\.ag/pools\\?.*${NVDAX}`), () => fixture("meteora-damm-v2-NVDAx-quote.recorded-2026-09-21.json")],
    [new RegExp(`damm-v2\\.datapi\\.meteora\\.ag/pools\\?.*${TOPENAI}`), () => fixture("meteora-damm-v2-tOpenAI.recorded-2026-09-21.json")],
    [new RegExp(`damm-v2\\.datapi\\.meteora\\.ag/pools/${POOL}$`), () => fixture("meteora-damm-v2-graduated.shape.json")],
    [/datapi\.meteora\.ag\/pools\?/, () => empty],
  ];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers });
    const route = routes.find(([pattern]) => pattern.test(decodeURIComponent(url)));
    if (!route) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => JSON.stringify(route[1]()) };
  };
  return { fetch, calls };
}

test("end to end on fixtures: prices from two providers, moves, badges, the launch and the sky", async () => {
  const network = fixtureNetwork();
  const { weather, failures } = await readMarketWeather([NVDAX, TOPENAI, WSOL, USDC, LAUNCH, SNEAKY], { fetch: network.fetch, now: () => NOW });
  assert.deepEqual(failures, []);
  assert.ok(network.calls.every((call) => call.method === "GET" && !("x-api-key" in call.headers) && !("authorization" in call.headers)));
  const byId = new Map(weather.assets.map((asset) => [asset.asset, asset]));

  const nvdax = byId.get(NVDAX);
  assert.equal(nvdax.price.status, "live", "Jupiter and the recorded DLMM pool agree within 2 %");
  assert.deepEqual(nvdax.price.reads.map((read) => read.source), ["jupiter-price-v3", "meteora-dlmm"]);
  assert.equal(nvdax.move.status, "live");
  assert.equal(nvdax.badges.freeze.state, "active");
  assert.deepEqual(nvdax.badges.freeze.reads.map((read) => read.source), ["jupiter-tokens-v2", "meteora-dlmm", "meteora-damm-v2"]);
  assert.equal(nvdax.label, "NVDAx");

  assert.equal(byId.get(TOPENAI).price.status, "live");
  assert.equal(byId.get(WSOL).price.status, "single_read", "no SOL pool in the fixtures: one provider only");
  assert.equal(byId.get(WSOL).badges.mint.state, "revoked");

  const launch = byId.get(LAUNCH);
  assert.equal(launch.label, null, "unverified: no name in the city");
  assert.equal(launch.lifecycle.stage, "graduated");
  assert.equal(launch.lifecycle.pool.confirmed, true, "Meteora's DAMM v2 record confirms what Jupiter states");
  assert.deepEqual(launch.lifecycle.survival.map((check) => check.state), ["alive", "pending", "pending"]);

  const sneaky = byId.get(SNEAKY);
  assert.equal(sneaky.label, null);
  assert.equal(sneaky.price.status, "not_measured", "Jupiter priced nothing for it");
  assert.equal(sneaky.move.status, "thin", "its move is read, its market is too shallow to show it");
  assert.equal(sneaky.badges.mint.state, "not_measured");

  assert.equal(weather.delayed, false);
  assert.equal(weather.counted, 5);
  assert.deepEqual(weather.breadth, { state: "measured", value: 0.8 });
  assert.equal(weather.state, "clear", "four assets up, the launch down 12 %: no sun");
  assert.equal(JSON.parse(JSON.stringify(weather)).schemaVersion, "1.0.0", "the weather is plain JSON");
});

test("end to end: a provider that fails is listed, and what was read still stands", async () => {
  const network = fixtureNetwork();
  const failing = async (url, init) => (url.includes("tokens/v2") ? { ok: false, status: 429, text: async () => "" } : network.fetch(url, init));
  const { weather, failures } = await readMarketWeather([NVDAX, TOPENAI, WSOL], { fetch: failing, now: () => NOW });
  assert.deepEqual(failures.map((failure) => failure.code), ["RATE_LIMITED"]);
  const nvdax = weather.assets.find((asset) => asset.asset === NVDAX);
  assert.equal(nvdax.move.status, "single_read", "one Jupiter move left");
  assert.equal(nvdax.verified, false, "without the token record nothing vouches for it");
  assert.equal(weather.state, "not_measured");
});

test("end to end: when Jupiter's token records stop updating, the city is in fog, not in yesterday's sun", async () => {
  const network = fixtureNetwork();
  const { weather } = await readMarketWeather([NVDAX, TOPENAI, WSOL, USDC], { fetch: network.fetch, now: () => NOW });
  /* The same answers a day later: Price V3 and Meteora are stamped when read, Tokens V2 states its own `updatedAt`. */
  const tomorrow = await readMarketWeather([NVDAX, TOPENAI, WSOL, USDC], { fetch: network.fetch, now: () => NOW + 86_400_000 });
  assert.equal(weather.state, "sun");
  assert.equal(tomorrow.weather.assets[0].move.status, "delayed");
  assert.equal(tomorrow.weather.state, "fog");
  assert.equal(tomorrow.weather.delayed, true);
});

test("the Meteora list URL is the venue's own filter, deepest first", () => {
  assert.equal(
    meteoraPoolsUrl("dlmm", NVDAX),
    `https://dlmm.datapi.meteora.ag/pools?page_size=10&sort_by=tvl:desc&filter_by=${encodeURIComponent(`token_x=${NVDAX} || token_y=${NVDAX}`)}`,
  );
});
