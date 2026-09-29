import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { noteJupiterResponse, resetJupiterBudget } from "../solana/jupiter-budget.ts";
import { primeStockUniverse, readStockUniverse, resetStockUniverseCache } from "./universe.server.ts";

const T0 = Date.UTC(2026, 8, 15, 1, 0, 0);
const realNow = Date.now;
let now = T0;

beforeEach(() => { resetStockUniverseCache(); resetJupiterBudget(); now = T0; Date.now = () => now; });
afterEach(() => { Date.now = realNow; });

const universe = { rows: [], marketsObservedAt: new Date(T0).toISOString(), issuerCatalogue: { ok: true, reason: null }, fetchedAt: new Date(T0).toISOString() };

test("a minute-old universe is served from memory, untouched, while the provider's window is nearly spent — no rebuild is started", async () => {
  primeStockUniverse(universe, T0);
  now = T0 + 61_000; // past the memory's minute, inside its grace
  noteJupiterResponse(new Headers({ "x-ratelimit-current": "58", "x-ratelimit-remaining": "2", "x-ratelimit-reset": String(Math.floor(now / 1000) + 30) }), "shared", { now: () => now, warn: () => {} });
  const read = await readStockUniverse();
  assert.equal(read.ok, true);
  assert.equal(read.universe, universe, "the memory's own copy, not a rebuild");
});

test("inside the memory's minute the copy is served regardless of the window", async () => {
  primeStockUniverse(universe, T0);
  now = T0 + 10_000;
  const read = await readStockUniverse();
  assert.equal(read.ok, true);
  assert.equal(read.universe, universe);
});

test("a partial venue list — the ranked rows without the verified universe — is a failed build, never a universe", async () => {
  const { buildStockUniverse } = await import("./universe.server.ts");
  const { resetSpotMarketCaches } = await import("../spot/markets.server.ts");
  resetSpotMarketCaches();
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    asked.push(u);
    if (u.includes("/tokens/v2/tag?query=verified")) return new Response("upstream failed", { status: 502 });
    if (u.includes("/tokens/v2/toptraded")) {
      return new Response(JSON.stringify([{ id: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", name: "NVIDIA xStock", symbol: "NVDAx", decimals: 8, tags: ["xstocks", "stocks", "verified"], isVerified: true, usdPrice: 212, stats24h: {}, audit: {} }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not in this test", { status: 503 });
  };
  try {
    const built = await buildStockUniverse();
    assert.equal(built.ok, false);
    assert.equal(built.code, "MARKETS_PARTIAL");
    assert.match(built.reason, /verified list did not answer/);
    assert.ok(asked.some((u) => u.includes("/toptraded")), "the traded list was read");
    assert.ok(!asked.some((u) => u.includes("/tokens/v2/search")), "no per-mint reads were spent on a partial list");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the shared build is one build: concurrent revalidations coalesce, and a failure cools down before the next attempt", async () => {
  const { buildSharedUniverse, BUILD_COOLDOWN_MS } = await import("./universe.server.ts");
  let builds = 0;
  let outcome = { ok: false, code: "MARKETS_RATE_LIMITED", reason: "Jupiter rate-limited the token catalogue." };
  const build = async () => { builds += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return outcome; };
  now = T0;
  const results = await Promise.allSettled([buildSharedUniverse({ now: () => now, build }), buildSharedUniverse({ now: () => now, build }), buildSharedUniverse({ now: () => now, build })]);
  assert.deepEqual(results.map((r) => r.status), ["rejected", "rejected", "rejected"]);
  assert.equal(builds, 1, "three arrivals, one build");
  assert.match(results[0].reason.message, /MARKETS_RATE_LIMITED/);
  now = T0 + 5_000;
  await assert.rejects(buildSharedUniverse({ now: () => now, build }), /MARKETS_RATE_LIMITED/);
  assert.equal(builds, 1, "inside the cool-down the refusal is repeated, nothing is spent");
  now = T0 + BUILD_COOLDOWN_MS + 1;
  outcome = { ok: true, universe };
  const built = await buildSharedUniverse({ now: () => now, build });
  assert.equal(built, universe);
  assert.equal(builds, 2);
});

test("a venue list without the issuer's catalogue is a failed build too — a universe missing every xStocks row is not the universe", async () => {
  const { buildStockUniverse } = await import("./universe.server.ts");
  const { resetSpotMarketCaches } = await import("../spot/markets.server.ts");
  const { resetXStocksCaches } = await import("./issuer-xstocks.server.ts");
  resetSpotMarketCaches();
  resetXStocksCaches();
  const realFetch = globalThis.fetch;
  const row = { id: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", name: "NVIDIA xStock", symbol: "NVDAx", decimals: 8, tags: ["xstocks", "stocks", "verified"], isVerified: true, usdPrice: 212, stats24h: {}, audit: {} };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.xstocks.fi")) return new Response("slow", { status: 503 });
    if (u.includes("/tokens/v2/")) return new Response(JSON.stringify([row]), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("not in this test", { status: 503 });
  };
  try {
    const built = await buildStockUniverse();
    assert.equal(built.ok, false);
    assert.match(built.code, /^ISSUER_CATALOGUE_/);
    assert.match(built.reason, /issuer's catalogue did not answer/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
