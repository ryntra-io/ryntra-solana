import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { resetJupiterBudget } from "../solana/jupiter-budget.ts";
import { readSpotMarket, readSpotMarketsByMint, readSpotTokenFacts, resetSpotMarketCaches, searchSpotMarkets } from "./markets.server.ts";
import { ratePauseLeftMs } from "./shared-reads.ts";

/* CITY-208: the coin window's reads of one mint are one Jupiter call; after a 429 nothing is asked for the pause and the
   last good answer is served stale with its own time. */

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);

const realFetch = globalThis.fetch;
const realNow = Date.now;
let now = T0;
let fetched = [];
let status = 200;
let price = 0.00002;

const row = (mint, symbol) => ({ id: mint, name: symbol, symbol, decimals: 5, tags: ["verified"], isVerified: true, usdPrice: price, dev: "Dev1111111111111111111111111111111111111111", stats24h: { priceChange: 1.2, buyVolume: 1_000_000, sellVolume: 900_000 }, liquidity: 9_000_000, audit: {} });

beforeEach(() => {
  resetSpotMarketCaches();
  resetJupiterBudget();
  fetched = [];
  status = 200;
  price = 0.00002;
  now = T0;
  Date.now = () => now;
  globalThis.fetch = async (url) => {
    const path = String(url).replace(/^https:\/\/[^/]+\/tokens\/v2/, "");
    fetched.push(path);
    /* A refusal names a zero-second retry so the one in-line second ask does not slow the test. */
    if (status === 429) return new Response("{}", { status: 429, headers: { "retry-after": "0", "x-ratelimit-current": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(now / 1000) + 6) } });
    const query = decodeURIComponent(path.split("query=")[1] ?? "");
    const rows = query.split(",").map((mint) => (mint === BONK ? row(BONK, "Bonk") : mint === WIF ? row(WIF, "WIF") : mint.toLowerCase() === "bonk" ? row(BONK, "Bonk") : null)).filter(Boolean);
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

test("a coin's window — the header, the overview's facts, the chart's price check — asking one mint at once is one Jupiter call", async () => {
  const [header, facts, check] = await Promise.all([readSpotMarket(BONK), readSpotTokenFacts(BONK), readSpotMarket(BONK)]);
  assert.equal(fetched.length, 1, "three reads, one call");
  assert.equal(header.ok && header.market?.symbol, "Bonk");
  assert.equal(check.ok && check.market?.price, 0.00002);
  assert.equal(facts.ok && facts.market?.symbol, "Bonk");
  assert.ok(facts.ok && facts.facts, "the token facts travel with the shared read");
  now = T0 + 14_000;
  await readSpotMarket(BONK);
  assert.equal(fetched.length, 1, "inside fifteen seconds the detail is not asked again");
});

test("after a 429 the detail is the last good read, stated stale with its time; no call is made while the pause runs", async () => {
  const first = await readSpotMarket(BONK);
  assert.equal(first.ok && first.stale, false);
  now = T0 + 20_000;
  status = 429;
  const refused = await readSpotMarket(BONK);
  assert.equal(refused.ok, true);
  assert.equal(refused.stale, true);
  assert.equal(refused.observedAt, new Date(T0).toISOString(), "the time of the read shown, not of the answer");
  assert.equal(refused.market.price, 0.00002, "the price that was read — not a zero, not a guess");
  const asked = fetched.length;
  assert.ok(ratePauseLeftMs("jupiter") > 0);

  /* Inside the pause: a mint never read is a refusal with its wait — not an empty market — and nothing is asked. */
  now = T0 + 21_000;
  const cold = await readSpotMarket(WIF);
  assert.equal(cold.ok, false);
  assert.equal(cold.code, "RATE_LIMITED");
  assert.ok(cold.retryAfterMs > 0);
  assert.equal(fetched.length, asked, "no provider call inside the pause");

  /* The window resets: read again, fresh. */
  status = 200;
  price = 0.000021;
  now = T0 + 30_000;
  const fresh = await readSpotMarket(BONK);
  assert.equal(fresh.ok && fresh.stale, false);
  assert.equal(fresh.market.price, 0.000021);
});

test("the same search typed at once is one call, kept half a minute; after a 429 the last answer is served stale with its time", async () => {
  const [a, b] = await Promise.all([searchSpotMarkets("bonk", 10), searchSpotMarkets(" bonk ", 10)]);
  assert.equal(fetched.length, 1);
  assert.equal(a.ok && a.rows[0]?.symbol, "Bonk");
  assert.deepEqual(a.ok && a.rows, b.ok && b.rows);
  now = T0 + 29_000;
  await searchSpotMarkets("bonk", 10);
  assert.equal(fetched.length, 1);
  now = T0 + 31_000;
  status = 429;
  const held = await searchSpotMarkets("bonk", 10);
  assert.equal(held.ok, true);
  assert.equal(held.stale, true);
  assert.equal(held.lastGoodAt, new Date(T0).toISOString());
  assert.equal(held.rows[0].symbol, "Bonk");
});

test("mints by the hundred: one call for the same set at once; the held copy only for a caller that asks for it", async () => {
  await Promise.all([readSpotMarketsByMint([BONK, WIF]), readSpotMarketsByMint([WIF, BONK])]);
  assert.equal(fetched.length, 1, "the same set in another order is the same read");
  now = T0 + 20_000;
  status = 429;
  const own = await readSpotMarketsByMint([BONK, WIF]);
  assert.equal(own.ok, false, "a caller with its own memory never takes an old read for a new one");
  const route = await readSpotMarketsByMint([BONK, WIF], 8_000, { held: true });
  assert.equal(route.ok, true);
  assert.equal(route.stale, true);
  assert.equal(route.observedAt, new Date(T0).toISOString());
  assert.equal(route.byMint.size, 2);
});

test("a burst refused together asks again once, not once per read: the rest answer at once with the wait", async () => {
  /* A short pause (one second) — the first read refused asks again after it; the others do not. */
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
  };
  const mints = ["So11111111111111111111111111111111111111112", BONK, WIF, "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL"];
  const reads = await Promise.all(mints.map((mint) => readSpotMarket(mint)));
  for (const read of reads) {
    assert.equal(read.ok, false);
    assert.equal(read.code, "RATE_LIMITED");
  }
  assert.equal(fetched.length, mints.length + 1, "five refused together, one second ask");
  /* Inside the pause nothing more is asked. */
  await readSpotMarket(BONK);
  assert.equal(fetched.length, mints.length + 1);
});
