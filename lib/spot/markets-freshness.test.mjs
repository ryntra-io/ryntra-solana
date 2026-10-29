import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { noteJupiterResponse, resetJupiterBudget } from "../solana/jupiter-budget.ts";
import { listFreshness, listScreenerCoins, listSpotMarkets, resetSpotMarketCaches, SPOT_LIST_STALE_AFTER_MS, spotListEdgeSeconds, spotListRefreshes } from "./markets.server.ts";

/* SOL-D1: a
   market list is stale only when the oldest read behind its rows is older
   than five minutes or held after a failed refresh — then with `lastGoodAt`. */

const SOL = "So11111111111111111111111111111111111111112";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const T0 = Date.UTC(2026, 9, 20, 9, 0, 0);
const MINUTE = 60_000;

const realFetch = globalThis.fetch;
const realNow = Date.now;
const realWarn = console.warn;
let now = T0;
let fetched = [];
/** Paths that answer 503 until cleared; a path mapped to a function runs it first (to move the clock). */
let failing = new Map();

const jupiterRow = (mint, symbol, tags, volume = 1_000_000) => ({ id: mint, name: symbol, symbol, decimals: 8, tags, isVerified: true, usdPrice: 100, stats24h: { priceChange: 1, buyVolume: volume, sellVolume: volume }, liquidity: 1_000_000, audit: {} });

/* SOL and JUP trade (the ranked lists); BONK is a meme; NVDAx a stock; the universe carries all four. */
const ROWS = {
  "/toptraded/24h?limit=100": [jupiterRow(SOL, "SOL", ["verified"], 9_000_000), jupiterRow(NVDAX, "NVDAx", ["xstocks", "stocks", "verified"], 3_000_000)],
  "/toporganicscore/24h?limit=100": [jupiterRow(JUP, "JUP", ["verified"], 5_000_000)],
  "/toptrending/24h?limit=100": [jupiterRow(BONK, "BONK", ["verified", "meme"], 4_000_000)],
  "/tag?query=verified": [jupiterRow(SOL, "SOL", ["verified"], 9_000_000), jupiterRow(JUP, "JUP", ["verified"], 5_000_000), jupiterRow(BONK, "BONK", ["verified", "meme"], 4_000_000), jupiterRow(NVDAX, "NVDAx", ["xstocks", "stocks", "verified"], 3_000_000)],
};

beforeEach(() => {
  resetSpotMarketCaches();
  resetJupiterBudget();
  fetched = [];
  failing = new Map();
  now = T0;
  Date.now = () => now;
  console.warn = () => {};
  globalThis.fetch = async (url) => {
    const path = String(url).replace(/^https:\/\/[^/]+\/tokens\/v2/, "");
    fetched.push(path);
    const fail = failing.get(path);
    if (fail) {
      if (typeof fail === "function") fail();
      return new Response("{}", { status: 503 });
    }
    return new Response(JSON.stringify(ROWS[path] ?? []), { status: 200, headers: { "content-type": "application/json" } });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
  console.warn = realWarn;
});

/** The provider's window nearly spent, so no background refresh starts. */
function windowSpent() {
  noteJupiterResponse(new Headers({ "x-ratelimit-current": "9", "x-ratelimit-remaining": "1", "x-ratelimit-reset": String(Math.floor(now / 1000) + 9) }), "shared", { now: () => now, warn: () => {} });
}

async function settle() {
  await spotListRefreshes();
}

test("a list past its minute whose refresh runs behind the answer is not stale, and the refresh lands", async () => {
  const first = await listSpotMarkets("crypto", 150);
  assert.equal(first.ok, true);
  assert.equal(first.stale, false);
  assert.equal(first.lastGoodAt, undefined);
  fetched = [];
  now = T0 + 61_000; // the ranked lists are past their minute
  const second = await listSpotMarkets("crypto", 150);
  assert.equal(second.ok, true);
  assert.equal(second.stale, false, "a minute-old read being refreshed is live, not stale");
  assert.equal(second.lastGoodAt, undefined);
  assert.ok(spotListRefreshes(), "the refresh is running behind the answer");
  await settle();
  assert.deepEqual(fetched.sort(), ["/toporganicscore/24h?limit=100", "/toptraded/24h?limit=100", "/toptrending/24h?limit=100"]);
  assert.equal(spotListRefreshes(), null, "nothing runs once the refresh landed");
  const third = await listSpotMarkets("crypto", 150);
  assert.equal(third.observedAt, new Date(T0 + 61_000).toISOString(), "the newest read is the refreshed one");
});

test("the universe's four minutes keep a category list inside five: past them it is refreshed, not called stale", async () => {
  await listSpotMarkets("meme", 150);
  fetched = [];
  now = T0 + 4 * MINUTE + 1_000;
  const read = await listSpotMarkets("meme", 150);
  assert.equal(read.stale, false);
  await settle();
  assert.ok(fetched.includes("/tag?query=verified"), "the universe is refreshed past four minutes");
});

for (const view of ["all", "crypto", "meme", "stock"]) {
  test(`${view}: stale only when the oldest read behind the rows is older than five minutes, then with lastGoodAt`, async () => {
    await listSpotMarkets(view, 150);
    now = T0 + SPOT_LIST_STALE_AFTER_MS; // exactly five minutes: not yet
    windowSpent();
    const edge = await listSpotMarkets(view, 150);
    assert.equal(edge.stale, false);
    now = T0 + SPOT_LIST_STALE_AFTER_MS + 1_000;
    windowSpent();
    fetched = [];
    const old = await listSpotMarkets(view, 150);
    assert.equal(old.ok, true);
    assert.deepEqual(fetched, [], "no refresh while the window is spent");
    assert.equal(old.stale, true);
    assert.equal(old.lastGoodAt, new Date(T0).toISOString(), "the list's last good time is its oldest read");
    assert.equal(old.oldestReadAt, new Date(T0).toISOString());
  });
}

test("a copy held after a failed refresh is stale with its time, even inside five minutes; a good refresh mends it", async () => {
  await listSpotMarkets("crypto", 150);
  now = T0 + 61_000;
  failing.set("/toptraded/24h?limit=100", true);
  const during = await listSpotMarkets("crypto", 150);
  assert.equal(during.stale, false, "the answer given while the refresh runs is not yet known to be held");
  await settle();
  now = T0 + 62_000;
  fetched = [];
  const held = await listSpotMarkets("crypto", 150);
  assert.equal(held.stale, true, "SOL's price is the copy held after the traded list failed");
  assert.equal(held.lastGoodAt, new Date(T0).toISOString());
  await settle();
  assert.deepEqual(fetched, [], "a failed source is not asked again on the next request: it cools down first");
  failing.clear();
  now = T0 + 61_000 + 16_000; // past the cooldown
  await listSpotMarkets("crypto", 150); // starts a refresh that answers
  await settle();
  const mended = await listSpotMarkets("crypto", 150);
  assert.equal(mended.stale, false);
  assert.equal(mended.lastGoodAt, undefined);
});

test("a refresh that failed because the function froze under it does not mark the copy as held", async () => {
  await listSpotMarkets("crypto", 150);
  now = T0 + 61_000;
  /* The function slept with the download open; its timer fired on the thaw, a minute later. */
  failing.set("/toptraded/24h?limit=100", () => {
    now += 60_000;
  });
  await listSpotMarkets("crypto", 150);
  await settle();
  failing.clear();
  windowSpent();
  const after = await listSpotMarkets("crypto", 150);
  assert.equal(after.stale, false, "a two-minute-old read is live, and the frozen failure says nothing of the provider");
});

test("a list that never answered leaves its rows out without aging the rest; the universe's absence is partial, not stale", async () => {
  failing.set("/toptrending/24h?limit=100", true);
  const noTrending = await listSpotMarkets("all", 150);
  assert.equal(noTrending.ok, true);
  assert.equal(noTrending.stale, false);
  assert.equal(noTrending.partial, false);
  resetSpotMarketCaches();
  failing = new Map([["/tag?query=verified", true]]);
  const noUniverse = await listSpotMarkets("crypto", 150);
  assert.equal(noUniverse.ok, true);
  assert.equal(noUniverse.partial, true);
  assert.equal(noUniverse.stale, false);
});

test("an idle instance's first answer waits briefly for a read already past five minutes, and is fresh when it lands", async () => {
  await listSpotMarkets("crypto", 150);
  now = T0 + 20 * MINUTE; // no list traffic for twenty minutes
  const first = await listSpotMarkets("crypto", 150);
  assert.equal(first.stale, false, "the refreshes answered within the wait");
  assert.equal(first.lastGoodAt, undefined);
  assert.equal(first.oldestReadAt, new Date(T0 + 20 * MINUTE).toISOString());
});

test("a refresh that does not land within the brief wait: the answer is stale with lastGoodAt, and no later caller waits again", async () => {
  await listSpotMarkets("crypto", 150);
  now = T0 + 20 * MINUTE;
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const quick = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    await held; // the provider is slow
    return quick(url, init);
  };
  try {
    const waited = now;
    const startedAt = realNow();
    const first = await listSpotMarkets("crypto", 150);
    assert.ok(realNow() - startedAt >= 3_500, "the first caller waited about four seconds");
    assert.ok(realNow() - startedAt < 6_000, "one wait for the whole list, not one per read");
    assert.equal(first.stale, true);
    assert.equal(first.lastGoodAt, new Date(T0).toISOString());
    now = waited + 5_000; // the refresh's four seconds are gone
    const secondAt = realNow();
    const second = await listSpotMarkets("crypto", 150);
    assert.ok(realNow() - secondAt < 500, "a caller joining the slow refresh answers at once");
    assert.equal(second.stale, true);
  } finally {
    release();
    await settle();
    globalThis.fetch = quick;
  }
  const mended = await listSpotMarkets("crypto", 150);
  assert.equal(mended.stale, false);
});

test("a read is dated when it was asked, not when its download ended", async () => {
  await listSpotMarkets("crypto", 150);
  now = T0 + 61_000;
  const slow = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const answer = await slow(url, init);
    now += 10_000; // the download took ten seconds
    return answer;
  };
  await listSpotMarkets("crypto", 150);
  await settle();
  globalThis.fetch = slow;
  const read = await listSpotMarkets("crypto", 150);
  assert.equal(read.observedAt, new Date(T0 + 61_000).toISOString());
});

test("a row is credited to the read whose copy the list shows, past copies its filter skips", () => {
  /* The ranked copy is unclassified (not crypto), so the crypto list shows the universe's six-minute-old copy. */
  const ranked = { rows: [{ mint: SOL, category: null }], readAt: T0 + 6 * MINUTE - 10_000, fromReserve: false };
  const universe = { rows: [{ mint: SOL, category: "crypto" }], readAt: T0, fromReserve: false };
  const crypto = (market) => market.category === "crypto";
  assert.deepEqual(listFreshness([ranked, universe], [SOL], T0 + 6 * MINUTE, crypto), { oldestReadAt: T0, stale: true });
});

test("only the reads behind the rows shown judge a list: an old read that shows nothing does not make it stale", () => {
  const old = { rows: [{ mint: BONK }], readAt: T0, fromReserve: false };
  const fresh = { rows: [{ mint: SOL }, { mint: JUP }], readAt: T0 + 5 * MINUTE, fromReserve: false };
  const at = T0 + 6 * MINUTE;
  assert.deepEqual(listFreshness([fresh, old], [SOL, JUP], at), { oldestReadAt: T0 + 5 * MINUTE, stale: false });
  assert.deepEqual(listFreshness([fresh, old], [SOL, BONK], at), { oldestReadAt: T0, stale: true });
  /* A row found in two reads is the first read's copy, as rankMarkets keeps it. */
  const universe = { rows: [{ mint: SOL }, { mint: BONK }], readAt: T0, fromReserve: false };
  assert.equal(listFreshness([fresh, universe], [SOL], at).stale, false);
  assert.equal(listFreshness([fresh, { ...old, readAt: at - MINUTE, fromReserve: true }], [BONK], at).stale, true, "a held copy is stale at any age");
  assert.deepEqual(listFreshness([fresh, old], [], at), { oldestReadAt: T0, stale: true }, "a list that shows nothing is judged by every read");
});

test("«Ринки»: the screener's coins follow the same rule", async () => {
  await listScreenerCoins({ crypto: 50, meme: 50 });
  now = T0 + 61_000;
  const live = await listScreenerCoins({ crypto: 50, meme: 50 });
  assert.equal(live.stale, false);
  assert.equal(live.lastGoodAt, undefined);
  await settle();
  resetSpotMarketCaches();
  now = T0;
  await listScreenerCoins({ crypto: 50, meme: 50 });
  now = T0 + 6 * MINUTE;
  windowSpent();
  const old = await listScreenerCoins({ crypto: 50, meme: 50 });
  assert.equal(old.stale, true);
  assert.equal(old.lastGoodAt, new Date(T0).toISOString());
});

test("the edge keeps a fresh list no longer than it stays fresh", () => {
  const read = (ageMs) => new Date(T0 - ageMs).toISOString();
  assert.deepEqual(spotListEdgeSeconds(read(0), T0), { ttl: 30, revalidate: 120 });
  assert.deepEqual(spotListEdgeSeconds(read(4 * MINUTE), T0), { ttl: 30, revalidate: 30 }, "a four-minute-old read: one minute left in all");
  assert.equal(spotListEdgeSeconds(read(4 * MINUTE + 31_000), T0), null, "too little left to keep it");
  assert.equal(spotListEdgeSeconds(read(6 * MINUTE), T0), null);
  for (const age of [0, MINUTE, 3 * MINUTE, 4 * MINUTE, 4 * MINUTE + 29_000]) {
    const edge = spotListEdgeSeconds(read(age), T0);
    assert.ok(edge === null || age + (edge.ttl + edge.revalidate) * 1_000 <= SPOT_LIST_STALE_AFTER_MS, `age ${age}`);
  }
});
