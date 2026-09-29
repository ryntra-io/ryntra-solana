import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { beforeEach } from "node:test";
import { assembleStockLiquidity, counterKindOf, isMeaningful, MEANINGFUL_TVL_USD, primaryOf, rankPools } from "./model.ts";
import { mapMeteoraPage, mapMeteoraPool } from "./meteora/mapper.ts";
import { meteoraPoolsUrl, METEORA_TIMEOUT_MS, readMeteoraPools } from "./meteora/client.server.ts";
import { LIQUIDITY_GRACE_MS, LIQUIDITY_NEGATIVE_TTL_MS, LIQUIDITY_TTL_MS, primeStockLiquidity, readStockLiquidity, resetStockLiquidityCache } from "./service.server.ts";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./meteora/fixtures/${name}`, import.meta.url), "utf8"));
const TOPENAI = "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const TSLAX = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const STOCKS = new Set([TOPENAI, NVDAX, TSLAX]);

/* ------------------------------------------------------------ the mapper */

test("the tOpenAI DLMM list maps to three pools with the venue's own figures and the stock on side x", () => {
  const page = mapMeteoraPage(fixture("dlmm-tOpenAI-2026-09-21.json"), "dlmm", TOPENAI, STOCKS);
  assert.ok(page);
  assert.equal(page.total, 3);
  assert.equal(page.pools.length, 3);
  const [pool] = rankPools(page.pools);
  assert.equal(pool.address, "2ZWxT3niYjyudmDMDVar9ajNE42RkwYdzZBh6TiMuKQY");
  assert.equal(pool.name, "tOpenAI-USDC");
  assert.equal(pool.kind, "dlmm");
  assert.equal(pool.stockSide, "x");
  assert.equal(pool.stock.mint, TOPENAI);
  assert.equal(pool.stock.symbol, "tOpenAI");
  assert.equal(pool.counter.mint, USDC);
  assert.equal(pool.counterKind, "stablecoin");
  assert.equal(pool.tvlUsd, 585402.4014203063);
  assert.equal(pool.volume24hUsd, 323865.8476141055);
  assert.equal(pool.fees24hUsd, 36.141107305839945);
  assert.equal(pool.baseFeePct, 0.01);
  assert.equal(pool.dynamicFeePct, 0);
  assert.equal(pool.stockAmount, 261.667495478);
  assert.equal(pool.counterAmount, 332084.542056);
  assert.equal(pool.createdAt, new Date(1782391951000).toISOString());
  assert.equal(pool.blacklisted, false);
  assert.equal(pool.source.api, "https://dlmm.datapi.meteora.ag/pools/2ZWxT3niYjyudmDMDVar9ajNE42RkwYdzZBh6TiMuKQY");
  assert.equal(pool.source.page, "https://app.meteora.ag/dlmm/2ZWxT3niYjyudmDMDVar9ajNE42RkwYdzZBh6TiMuKQY");
});

test("a pool with the stock on side y keeps the stock on its side and the other token as the counter", () => {
  const page = mapMeteoraPage(fixture("dlmm-NVDAx-2026-09-21.json"), "dlmm", NVDAX, STOCKS);
  assert.ok(page);
  const aven = page.pools.find((pool) => pool.name === "AVEN-NVDAx");
  assert.ok(aven);
  assert.equal(aven.stockSide, "y");
  assert.equal(aven.stock.mint, NVDAX);
  assert.equal(aven.stock.symbol, "NVDAx");
  assert.equal(aven.counter.symbol, "AVEN");
  assert.equal(aven.counterKind, "other");
  const tsla = page.pools.find((pool) => pool.name === "NVDAx-TSLAx");
  assert.ok(tsla);
  assert.equal(tsla.counterKind, "stock", "another confirmed stock token is money-like for the ranking");
  const sol = page.pools.find((pool) => pool.name === "NVDAx-SOL");
  assert.ok(sol);
  assert.equal(sol.counterKind, "sol");
  assert.equal(mapMeteoraPage(fixture("dlmm-NVDAx-2026-09-21.json"), "dlmm", NVDAX, new Set()).pools.find((pool) => pool.name === "NVDAx-TSLAx").counterKind, "other", "without the universe a stock counter is not known as one");
});

test("DAMM v2 memecoin pools quoted in NVDAx are listed but never primary; the DLMM SOL pool leads", () => {
  const dlmm = mapMeteoraPage(fixture("dlmm-NVDAx-2026-09-21.json"), "dlmm", NVDAX, STOCKS).pools;
  const damm = mapMeteoraPage(fixture("damm-v2-NVDAx-quote-2026-09-21.json"), "damm-v2", NVDAX, STOCKS).pools;
  assert.equal(damm.length, 5);
  for (const pool of damm) {
    assert.equal(pool.stockSide, "y");
    assert.equal(pool.counterKind, "other");
    assert.equal(pool.dynamicFeePct, null, "DAMM v2 states no current dynamic rate");
  }
  const gpucat = damm.find((pool) => pool.name === "GPUCAT-NVDAx");
  assert.equal(gpucat.baseFeePct, 2);
  assert.equal(gpucat.fees24hUsd, 61.5808705205454);
  const ranked = rankPools([...dlmm, ...damm]);
  assert.equal(ranked[0].name, "NVDAx-SOL");
  assert.equal(ranked[1].name, "GPUCAT-NVDAx", "ranked by TVL, the memecoin pool is second");
  assert.equal(primaryOf(ranked).name, "NVDAx-SOL");
  assert.equal(primaryOf(damm), null, "no money-like pool among the memecoin pairs → no primary");
});

test("a record that does not carry the mint on either side is not this stock's pool; malformed figures become null, never a number", () => {
  const raw = fixture("dlmm-tOpenAI-2026-09-21.json").data[0];
  assert.equal(mapMeteoraPool(raw, "dlmm", NVDAX, STOCKS), null);
  const broken = { ...raw, tvl: "585402", volume: { "24h": -1 }, fees: null, pool_config: { base_fee_pct: Number.NaN }, created_at: "yesterday", is_blacklisted: "no" };
  const pool = mapMeteoraPool(broken, "dlmm", TOPENAI, STOCKS);
  assert.ok(pool);
  assert.equal(pool.tvlUsd, null);
  assert.equal(pool.volume24hUsd, null);
  assert.equal(pool.fees24hUsd, null);
  assert.equal(pool.baseFeePct, null);
  assert.equal(pool.createdAt, null);
  assert.equal(pool.blacklisted, false);
  assert.equal(mapMeteoraPool({ ...raw, address: "not-base58" }, "dlmm", TOPENAI, STOCKS), null);
  assert.equal(mapMeteoraPool({ ...raw, token_x: { symbol: "x" } }, "dlmm", TOPENAI, STOCKS), null);
  assert.equal(mapMeteoraPage({ pools: [] }, "dlmm", TOPENAI, STOCKS), null);
  assert.equal(mapMeteoraPage("[]", "dlmm", TOPENAI, STOCKS), null);
});

test("the same pool twice in one page is listed once", () => {
  const body = fixture("dlmm-tOpenAI-2026-09-21.json");
  const page = mapMeteoraPage({ ...body, data: [...body.data, body.data[0]] }, "dlmm", TOPENAI, STOCKS);
  assert.equal(page.pools.length, 3);
});

/* ------------------------------------------------------- the assembly */

test("the dust line is $1,000 TVL; the totals sum the meaningful pools only; the state names what answered", () => {
  const dlmm = mapMeteoraPage(fixture("dlmm-tOpenAI-2026-09-21.json"), "dlmm", TOPENAI, STOCKS).pools;
  const damm = mapMeteoraPage(fixture("damm-v2-tOpenAI-2026-09-21.json"), "damm-v2", TOPENAI, STOCKS).pools;
  assert.equal(MEANINGFUL_TVL_USD, 1000);
  assert.equal(dlmm.filter(isMeaningful).length, 1, "two of the three DLMM pools are test dust");
  const fresh = { ok: true, stale: false, fetchedAt: "2026-09-21T08:19:00.000Z", reason: null };
  const read = assembleStockLiquidity({ mint: TOPENAI, pools: [...dlmm, ...damm], sources: { dlmm: fresh, "damm-v2": { ...fresh, fetchedAt: "2026-09-21T08:19:01.000Z" } } });
  assert.equal(read.state, "current");
  assert.equal(read.pools.length, 7);
  assert.equal(read.meaningfulCount, 1);
  assert.equal(read.dustCount, 6);
  assert.equal(read.primary.name, "tOpenAI-USDC");
  assert.equal(read.totals.tvlUsd, 585402.4014203063);
  assert.equal(read.totals.volume24hUsd, 323865.8476141055);
  assert.equal(read.totals.fees24hUsd, 36.141107305839945);
  assert.equal(read.fetchedAt, "2026-09-21T08:19:01.000Z");

  const partial = assembleStockLiquidity({ mint: TOPENAI, pools: dlmm, sources: { dlmm: fresh, "damm-v2": { ok: false, stale: false, fetchedAt: null, reason: "Meteora answered 503." } } });
  assert.equal(partial.state, "partial");
  const stale = assembleStockLiquidity({ mint: TOPENAI, pools: dlmm, sources: { dlmm: { ...fresh, stale: true }, "damm-v2": fresh } });
  assert.equal(stale.state, "stale");
  const none = assembleStockLiquidity({ mint: TOPENAI, pools: [], sources: { dlmm: { ok: false, stale: false, fetchedAt: null, reason: "x" }, "damm-v2": { ok: false, stale: false, fetchedAt: null, reason: "y" } } });
  assert.equal(none.state, "unavailable");
  assert.equal(none.primary, null);
  assert.equal(none.totals.tvlUsd, null);
  assert.equal(none.fetchedAt, null);
  assert.equal(assembleStockLiquidity({ mint: NVDAX, pools: dlmm, sources: { dlmm: fresh, "damm-v2": fresh } }).pools.length, 0, "pools of another mint never enter a read");
});

/* A pool as the mapper would hand it over, for a pair no fixture holds. */
const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const GMEX = "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc";
const SOL = "So11111111111111111111111111111111111111112";
const token = (mint, symbol) => ({ mint, symbol, name: symbol, decimals: null });
const poolOf = ({ address, name, counter, counterKind, tvlUsd, volume24hUsd, blacklisted = false }) => ({
  provider: "meteora",
  kind: "dlmm",
  address,
  name,
  stockSide: "x",
  stock: token(SPYX, "SPYx"),
  counter,
  counterKind,
  tvlUsd,
  volume24hUsd,
  fees24hUsd: null,
  baseFeePct: null,
  dynamicFeePct: null,
  stockAmount: null,
  counterAmount: null,
  createdAt: null,
  blacklisted,
  launchpad: null,
  source: { api: `https://dlmm.datapi.meteora.ag/pools/${address}`, page: `https://app.meteora.ag/dlmm/${address}` },
});

test("a pool paired with money leads before a deeper pool paired with another stock (SPYx, 2026-09-23)", () => {
  const gme = poolOf({ address: "GmexPoo1111111111111111111111111111111111111", name: "SPYx-GMEx", counter: token(GMEX, "GMEx"), counterKind: "stock", tvlUsd: 7_567.28, volume24hUsd: 2.94 });
  const sol = poolOf({ address: "So1Poo11111111111111111111111111111111111111", name: "SPYx-SOL", counter: token(SOL, "SOL"), counterKind: "sol", tvlUsd: 5_900, volume24hUsd: 16_000 });
  const ranked = rankPools([gme, sol]);
  assert.equal(ranked[0].name, "SPYx-GMEx", "by TVL the stock pair still ranks first in the list");
  assert.equal(primaryOf(ranked).name, "SPYx-SOL");
  const fresh = { ok: true, stale: false, fetchedAt: "2026-09-23T06:25:00.000Z", reason: null };
  const read = assembleStockLiquidity({ mint: SPYX, pools: [gme, sol], sources: { dlmm: fresh, "damm-v2": fresh } });
  assert.equal(read.primary.name, "SPYx-SOL");
  assert.equal(read.meaningfulCount, 2, "the stock pair is still listed and counted");
});

test("a pool paired with another stock leads only when no money pool holds $1,000", () => {
  const usdc = token(USDC, "USDC");
  const gme = poolOf({ address: "GmexPoo1111111111111111111111111111111111111", name: "SPYx-GMEx", counter: token(GMEX, "GMEx"), counterKind: "stock", tvlUsd: 7_567.28, volume24hUsd: 2.94 });
  const thinSol = poolOf({ address: "So1Poo11111111111111111111111111111111111111", name: "SPYx-SOL", counter: token(SOL, "SOL"), counterKind: "sol", tvlUsd: 999, volume24hUsd: 16_000 });
  assert.equal(primaryOf(rankPools([gme, thinSol])).name, "SPYx-GMEx", "under the dust line the SOL pool cannot lead");
  const edgeUsdc = poolOf({ address: "UsdcPoo1111111111111111111111111111111111111", name: "SPYx-USDC", counter: usdc, counterKind: "stablecoin", tvlUsd: MEANINGFUL_TVL_USD, volume24hUsd: 70 });
  assert.equal(primaryOf(rankPools([gme, thinSol, edgeUsdc])).name, "SPYx-USDC", "exactly $1,000 is meaningful, so the stablecoin pool leads");
  const barred = { ...edgeUsdc, tvlUsd: 50_000, blacklisted: true };
  assert.equal(primaryOf(rankPools([gme, barred])).name, "SPYx-GMEx", "a blacklisted money pool is not meaningful");
  const meme = poolOf({ address: "MemePoo1111111111111111111111111111111111111", name: "PAIRS-SPYx", counter: token("AnZ68QisLMiMBQMVdx9Amu95mjMCBoLkszaXtDDjpair", "PAIRS"), counterKind: "other", tvlUsd: 90_000, volume24hUsd: 8_000 });
  assert.equal(primaryOf(rankPools([meme, thinSol])), null, "a memecoin pair is never primary, however deep");
});

test("counter classification is by mint", () => {
  assert.equal(counterKindOf(USDC, new Set()), "stablecoin");
  assert.equal(counterKindOf("So11111111111111111111111111111111111111112", new Set()), "sol");
  assert.equal(counterKindOf(TSLAX, STOCKS), "stock");
  assert.equal(counterKindOf(TSLAX, new Set()), "other");
});

/* --------------------------------------------------------- the client */

const jsonResponse = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("the URL is the venue's filter for both sides of the pair, deep pools first", () => {
  const url = new URL(meteoraPoolsUrl("dlmm", TOPENAI));
  assert.equal(url.origin, "https://dlmm.datapi.meteora.ag");
  assert.equal(url.searchParams.get("filter_by"), `token_x=${TOPENAI} || token_y=${TOPENAI}`);
  assert.equal(url.searchParams.get("sort_by"), "tvl:desc");
  assert.equal(url.searchParams.get("page_size"), "200");
  assert.equal(new URL(meteoraPoolsUrl("damm-v2", TOPENAI)).origin, "https://damm-v2.datapi.meteora.ag");
});

test("a 429 is not retried; a fast 5xx is retried once; a timeout is never retried; a bad body is a shape failure", async () => {
  let calls = 0;
  const limited = await readMeteoraPools("dlmm", TOPENAI, STOCKS, { fetchImpl: async () => { calls += 1; return jsonResponse({ message: "slow down" }, 429); }, sleep: async () => {} });
  assert.equal(limited.ok, false);
  assert.equal(limited.code, "RATE_LIMITED");
  assert.equal(calls, 1);

  calls = 0;
  const failed = await readMeteoraPools("dlmm", TOPENAI, STOCKS, { fetchImpl: async () => { calls += 1; return jsonResponse({ message: "boom" }, 503); }, sleep: async () => {} });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "HTTP");
  assert.equal(calls, 2);

  calls = 0;
  const recovered = await readMeteoraPools("dlmm", TOPENAI, STOCKS, { fetchImpl: async () => { calls += 1; return calls === 1 ? jsonResponse("", 500) : jsonResponse(fixture("dlmm-tOpenAI-2026-09-21.json")); }, sleep: async () => {} });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.pools.length, 3);
  assert.equal(calls, 2);

  calls = 0;
  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";
  const silent = await readMeteoraPools("dlmm", TOPENAI, STOCKS, { fetchImpl: async () => { calls += 1; throw timeout; }, sleep: async () => {} });
  assert.equal(silent.ok, false);
  assert.equal(silent.code, "TIMEOUT");
  assert.equal(calls, 1);
  assert.match(silent.reason, new RegExp(String(METEORA_TIMEOUT_MS)));

  const html = await readMeteoraPools("dlmm", TOPENAI, STOCKS, { fetchImpl: async () => jsonResponse("<html>maintenance</html>") });
  assert.equal(html.ok, false);
  assert.equal(html.code, "SHAPE");
  const list = await readMeteoraPools("dlmm", TOPENAI, STOCKS, { fetchImpl: async () => jsonResponse({ total: 1, pools: [] }) });
  assert.equal(list.ok, false);
  assert.equal(list.code, "SHAPE");
});

/* --------------------------------------------------------- the reader */

const NOW = Date.parse("2026-09-21T09:00:00.000Z");
const clock = (ms) => () => new Date(ms);
const fetchFor = (byHost) => async (url) => {
  const host = new URL(url).host;
  const answer = byHost[host];
  if (!answer) throw new Error("unexpected host " + host);
  return typeof answer === "function" ? answer() : answer;
};
const DLMM_HOST = "dlmm.datapi.meteora.ag";
const DAMM_HOST = "damm-v2.datapi.meteora.ag";

beforeEach(() => resetStockLiquidityCache());

test("a fresh read asks both venues once, caches for the TTL and dedupes reads in flight", async () => {
  const calls = { dlmm: 0, damm: 0 };
  const fetchImpl = fetchFor({
    [DLMM_HOST]: () => { calls.dlmm += 1; return jsonResponse(fixture("dlmm-tOpenAI-2026-09-21.json")); },
    [DAMM_HOST]: () => { calls.damm += 1; return jsonResponse(fixture("damm-v2-tOpenAI-2026-09-21.json")); },
  });
  const [a, b] = await Promise.all([readStockLiquidity(TOPENAI, { stockMints: STOCKS, meteora: { fetchImpl }, now: clock(NOW) }), readStockLiquidity(TOPENAI, { stockMints: STOCKS, meteora: { fetchImpl }, now: clock(NOW) })]);
  assert.equal(a, b);
  assert.equal(calls.dlmm, 1);
  assert.equal(calls.damm, 1);
  assert.equal(a.state, "current");
  assert.equal(a.primary.name, "tOpenAI-USDC");
  assert.equal(a.pools.length, 7);
  assert.equal(a.sources.dlmm.fetchedAt, new Date(NOW).toISOString());
  const again = await readStockLiquidity(TOPENAI, { stockMints: STOCKS, meteora: { fetchImpl }, now: clock(NOW + LIQUIDITY_TTL_MS - 1) });
  assert.equal(again, a);
  assert.equal(calls.dlmm, 1);
  await readStockLiquidity(TOPENAI, { stockMints: STOCKS, meteora: { fetchImpl }, now: clock(NOW + LIQUIDITY_TTL_MS) });
  assert.equal(calls.dlmm, 2, "past the TTL the venue is asked again");
});

test("one venue silent: its grace copy is served stale with its own time while the other is read fresh; without a copy the read is partial", async () => {
  const firstFetch = fetchFor({ [DLMM_HOST]: () => jsonResponse(fixture("dlmm-tOpenAI-2026-09-21.json")), [DAMM_HOST]: () => jsonResponse(fixture("damm-v2-tOpenAI-2026-09-21.json")) });
  const first = await readStockLiquidity(TOPENAI, { stockMints: STOCKS, meteora: { fetchImpl: firstFetch }, now: clock(NOW) });
  assert.equal(first.state, "current");
  const timeout = new Error("timed out");
  timeout.name = "TimeoutError";
  const later = NOW + LIQUIDITY_TTL_MS + 1000;
  const damm = { calls: 0 };
  const secondFetch = fetchFor({ [DLMM_HOST]: () => { throw timeout; }, [DAMM_HOST]: () => { damm.calls += 1; return jsonResponse(fixture("damm-v2-tOpenAI-2026-09-21.json")); } });
  const second = await readStockLiquidity(TOPENAI, { stockMints: STOCKS, meteora: { fetchImpl: secondFetch, sleep: async () => {} }, now: clock(later) });
  assert.equal(second.state, "stale");
  assert.equal(second.sources.dlmm.stale, true);
  assert.equal(second.sources.dlmm.fetchedAt, new Date(NOW).toISOString(), "the copy keeps its own read time");
  assert.match(second.sources.dlmm.reason, /did not answer/);
  assert.equal(second.sources["damm-v2"].stale, false);
  assert.equal(second.sources["damm-v2"].fetchedAt, new Date(later).toISOString());
  assert.equal(damm.calls, 1);
  assert.equal(second.primary.name, "tOpenAI-USDC", "the stale DLMM pools are still listed");

  /* Inside the negative TTL the venue is left alone; after it, asked again. */
  const third = await readStockLiquidity(TOPENAI, { stockMints: STOCKS, meteora: { fetchImpl: secondFetch, sleep: async () => {} }, now: clock(later + LIQUIDITY_NEGATIVE_TTL_MS - 1) });
  assert.equal(third, second);
  assert.equal(damm.calls, 1);
  await readStockLiquidity(TOPENAI, { stockMints: STOCKS, meteora: { fetchImpl: secondFetch, sleep: async () => {} }, now: clock(later + LIQUIDITY_NEGATIVE_TTL_MS) });
  assert.equal(damm.calls, 2);

  /* Past the grace window the copy is gone: the read is partial, the DLMM source honestly failed. */
  resetStockLiquidityCache();
  primeStockLiquidity(first, NOW);
  const old = NOW + LIQUIDITY_GRACE_MS + 1;
  const fourth = await readStockLiquidity(TOPENAI, { stockMints: STOCKS, meteora: { fetchImpl: secondFetch, sleep: async () => {} }, now: clock(old) });
  assert.equal(fourth.state, "partial");
  assert.equal(fourth.sources.dlmm.ok, false);
  assert.equal(fourth.pools.every((pool) => pool.kind === "damm-v2"), true);
  assert.equal(fourth.primary, null, "the DAMM v2 pools of tOpenAI are dust; no primary is invented");
});

test("both venues silent and no copy: unavailable, no figure, remembered for a minute only", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse("down", 502); };
  const read = await readStockLiquidity(NVDAX, { stockMints: STOCKS, meteora: { fetchImpl, sleep: async () => {} }, now: clock(NOW) });
  assert.equal(read.state, "unavailable");
  assert.equal(read.pools.length, 0);
  assert.equal(read.primary, null);
  assert.equal(read.totals.tvlUsd, null);
  assert.equal(read.fetchedAt, null);
  assert.equal(calls, 4, "two venues, one retry each on a fast 5xx");
  const cached = await readStockLiquidity(NVDAX, { stockMints: STOCKS, meteora: { fetchImpl, sleep: async () => {} }, now: clock(NOW + LIQUIDITY_NEGATIVE_TTL_MS - 1) });
  assert.equal(cached, read);
  assert.equal(calls, 4);
  await readStockLiquidity(NVDAX, { stockMints: STOCKS, meteora: { fetchImpl, sleep: async () => {} }, now: clock(NOW + LIQUIDITY_NEGATIVE_TTL_MS) });
  assert.equal(calls, 8);
});

test("the reader never throws: a fetch that rejects becomes a network failure in the read", async () => {
  const read = await readStockLiquidity(NVDAX, { stockMints: STOCKS, meteora: { fetchImpl: async () => { throw new Error("ECONNRESET"); }, sleep: async () => {} }, now: clock(NOW) });
  assert.equal(read.state, "unavailable");
  assert.match(read.sources.dlmm.reason, /ECONNRESET/);
});
