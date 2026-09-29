import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BoundedTtlCache,
  FixedWindowLimiter,
  clientIp,
  privateNoStoreHeaders,
  publicCacheHeaders,
  rateLimitHeaders,
} from "./http-control.ts";

test("fixed window allows exactly the configured limit and resets at the boundary", () => {
  let now = 10_000;
  const limiter = new FixedWindowLimiter({ limit: 2, windowMs: 1_000, maxKeys: 10, now: () => now });

  const first = limiter.consume("ip-a");
  const second = limiter.consume("ip-a");
  const blocked = limiter.consume("ip-a");

  assert.deepEqual(
    [first.allowed, second.allowed, blocked.allowed],
    [true, true, false],
  );
  assert.deepEqual(
    [first.remaining, second.remaining, blocked.remaining],
    [1, 0, 0],
  );
  assert.equal(blocked.retryAfterSeconds, 1);

  now = 11_000;
  const reset = limiter.consume("ip-a");
  assert.equal(reset.allowed, true);
  assert.equal(reset.remaining, 1);
});

test("fixed window keeps key memory bounded under an IP spray", () => {
  let now = 0;
  const limiter = new FixedWindowLimiter({ limit: 2, windowMs: 1_000, maxKeys: 2, now: () => now });
  limiter.consume("a");
  limiter.consume("b");
  limiter.consume("a");
  limiter.consume("c");
  assert.equal(limiter.size, 2);
  assert.equal(
    limiter.consume("a").allowed,
    false,
    "the recently active bucket survives capacity eviction and retains its count",
  );

  now = 2_000;
  limiter.consume("d");
  assert.equal(limiter.size, 1, "expired buckets are swept before inserting the new key");
});

test("rate-limit headers expose limit/remaining/reset and Retry-After only when blocked", () => {
  let now = 5_000;
  const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 2_500, maxKeys: 2, now: () => now });
  const allowedHeaders = rateLimitHeaders(limiter.consume("a"));
  const blockedHeaders = rateLimitHeaders(limiter.consume("a"));

  assert.deepEqual(allowedHeaders, {
    "RateLimit-Limit": "1",
    "RateLimit-Remaining": "0",
    "RateLimit-Reset": "3",
  });
  assert.deepEqual(blockedHeaders, {
    "RateLimit-Limit": "1",
    "RateLimit-Remaining": "0",
    "RateLimit-Reset": "3",
    "Retry-After": "3",
  });
});

test("bounded TTL cache coalesces concurrent misses and serves a fresh hit", async () => {
  let now = 100;
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const cache = new BoundedTtlCache({ maxEntries: 4, now: () => now });
  const load = async () => {
    calls += 1;
    await gate;
    return { value: 7 };
  };

  const a = cache.get("same", 1_000, load);
  const b = cache.get("same", 1_000, load);
  release();
  assert.deepEqual(await a, { value: 7 });
  assert.deepEqual(await b, { value: 7 });
  assert.equal(calls, 1);

  now = 999;
  assert.deepEqual(await cache.get("same", 1_000, load), { value: 7 });
  assert.equal(calls, 1);
});

test("failed loads never poison the cache and maxEntries evicts the oldest key", async () => {
  let now = 0;
  const cache = new BoundedTtlCache({ maxEntries: 2, now: () => now });
  await assert.rejects(cache.get("bad", 100, async () => { throw new Error("upstream"); }), /upstream/);
  assert.equal(cache.size, 0);

  await cache.get("a", 100, async () => "a");
  now = 1;
  await cache.get("b", 100, async () => "b");
  now = 2;
  await cache.get("c", 100, async () => "c");
  assert.equal(cache.size, 2);
  assert.equal(cache.has("a"), false);
  assert.equal(cache.has("b"), true);
  assert.equal(cache.has("c"), true);
});

test("clientIp uses Vercel-overwritten x-forwarded-for and rejects malformed values", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.2" })), "203.0.113.7");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "2001:db8::1" })), "2001:db8::1");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "attacker/../../key" })), "unknown");
  assert.equal(clientIp(new Headers()), "unknown");
});

test("cache headers separate browser/CDN freshness and private responses are never stored", () => {
  assert.deepEqual(publicCacheHeaders(5, 15), {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "CDN-Cache-Control": "public, s-maxage=5, stale-while-revalidate=15",
    "Vercel-CDN-Cache-Control": "public, s-maxage=5, stale-while-revalidate=15",
  });
  assert.deepEqual(privateNoStoreHeaders(), {
    "Cache-Control": "private, no-store, max-age=0",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
  });
});
