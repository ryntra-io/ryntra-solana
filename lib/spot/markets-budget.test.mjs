import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { noteJupiterResponse, resetJupiterBudget } from "../solana/jupiter-budget.ts";
import { listSpotMarkets, readSpotMarket, resetSpotMarketCaches } from "./markets.server.ts";

const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const T0 = Date.UTC(2026, 8, 15, 1, 0, 0);

const realFetch = globalThis.fetch;
const realNow = Date.now;
let now = T0;
let fetched = [];

/** One Tokens V2 row, enough for a market. */
const jupiterRow = (mint, symbol, tags) => ({ id: mint, name: symbol, symbol, decimals: 8, tags, isVerified: true, usdPrice: 212, stats24h: { priceChange: -1.2, buyVolume: 1_000_000, sellVolume: 900_000 }, liquidity: 1_700_000, audit: {} });

function stubFetch(rowsFor) {
  globalThis.fetch = async (url) => {
    const path = String(url).replace(/^https:\/\/[^/]+\/tokens\/v2/, "");
    fetched.push(path);
    return new Response(JSON.stringify(rowsFor(path)), { status: 200, headers: { "content-type": "application/json", "x-ratelimit-current": "1", "x-ratelimit-remaining": "59", "x-ratelimit-reset": String(Math.floor(now / 1000) + 60) } });
  };
}

beforeEach(() => {
  resetSpotMarketCaches();
  resetJupiterBudget();
  fetched = [];
  now = T0;
  Date.now = () => now;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

const stockRows = (path) => (path.startsWith("/tag?query=verified") ? [jupiterRow(NVDAX, "NVDAx", ["xstocks", "stocks", "verified"])] : path.startsWith("/toptraded") ? [jupiterRow(NVDAX, "NVDAx", ["xstocks", "stocks", "verified"])] : []);

test("the stock view asks for the traded list and the verified universe only; the all view asks for all four", async () => {
  stubFetch(stockRows);
  const stock = await listSpotMarkets("stock", 150);
  assert.equal(stock.ok, true);
  assert.deepEqual(fetched.sort(), ["/tag?query=verified", "/toptraded/24h?limit=100"]);
  assert.equal(stock.rows.length, 1);
  assert.equal(stock.stale, false);
  fetched = [];
  resetSpotMarketCaches();
  const all = await listSpotMarkets("all", 150);
  assert.equal(all.ok, true);
  assert.equal(fetched.length, 4);
});

test("while the provider's window is nearly spent, a list past its minute is served as it is and no refresh is started", async () => {
  stubFetch(stockRows);
  await listSpotMarkets("stock", 150);
  fetched = [];
  now = T0 + 61_000; // the traded list is past its minute
  noteJupiterResponse(new Headers({ "x-ratelimit-current": "58", "x-ratelimit-remaining": "2", "x-ratelimit-reset": String(Math.floor(now / 1000) + 30) }), "shared", { now: () => now, warn: () => {} });
  const read = await listSpotMarkets("stock", 150);
  assert.equal(read.ok, true);
  assert.equal(read.stale, false, "a minute-old read is not stale: that starts past five minutes (SOL-D1)");
  assert.deepEqual(fetched, [], "no background refresh spent the window");
  /* The window resets: the same read now refreshes in the background. */
  now = T0 + 95_000;
  const later = await listSpotMarkets("stock", 150);
  assert.equal(later.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(fetched, ["/toptraded/24h?limit=100"]);
});

test("the market header: a two-minute-old detail is served stale while the window is nearly spent, then refreshed", async () => {
  stubFetch((path) => (path.startsWith("/search?query=") ? [jupiterRow(NVDAX, "NVDAx", ["xstocks", "stocks", "verified"])] : []));
  const first = await readSpotMarket(NVDAX);
  assert.equal(first.ok, true);
  assert.equal(first.stale, false);
  fetched = [];
  now = T0 + 30_000;
  noteJupiterResponse(new Headers({ "x-ratelimit-current": "59", "x-ratelimit-remaining": "1", "x-ratelimit-reset": String(Math.floor(now / 1000) + 30) }), "shared", { now: () => now, warn: () => {} });
  const low = await readSpotMarket(NVDAX);
  assert.equal(low.ok, true);
  assert.equal(low.stale, true);
  assert.deepEqual(fetched, []);
  now = T0 + 70_000; // the window has reset
  const fresh = await readSpotMarket(NVDAX);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.stale, false);
  assert.equal(fetched.length, 1);
});
