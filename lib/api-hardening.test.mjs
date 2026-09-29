import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ARCUS_GET_KINDS,
  arcusCacheSeconds,
  arcusRateLimit,
} from "./arcus/policy.ts";
import { ARCUS_POST_MAX_BODY_BYTES, TRACK_MAX_BODY_BYTES } from "./http-control.ts";

test("Arcus policy recognizes only implemented GET kinds", () => {
  assert.equal(ARCUS_GET_KINDS.has("markets"), true);
  assert.equal(ARCUS_GET_KINDS.has("spot-candles"), true);
  assert.equal(ARCUS_GET_KINDS.has("constructor"), false);
  assert.equal(ARCUS_GET_KINDS.has("unknown"), false);
});

test("only non-user-specific Arcus reads receive a shared-cache TTL", () => {
  assert.equal(arcusCacheSeconds("markets"), 60);
  assert.equal(arcusCacheSeconds("fees"), 300);
  assert.equal(arcusCacheSeconds("spot-tokens"), 300);
  assert.equal(arcusCacheSeconds("oracle-feeds"), 3600);
  assert.equal(arcusCacheSeconds("spot-overview"), 20);
  assert.equal(arcusCacheSeconds("candles", "1m"), 5);
  assert.equal(arcusCacheSeconds("candles", "1h"), 30);
  assert.equal(arcusCacheSeconds("spot-candles", "1d"), 120);

  for (const kind of ["account", "apikeys", "spot-trades", "spot-quote"]) {
    assert.equal(arcusCacheSeconds(kind), null, `${kind} must never enter a shared cache`);
  }
});

test("Arcus abuse budgets are stricter for expensive fan-out and candle paths", () => {
  assert.equal(arcusRateLimit("account"), 40);
  assert.equal(arcusRateLimit("candles"), 90);
  assert.equal(arcusRateLimit("spot-candles"), 90);
  assert.equal(arcusRateLimit("spot-quote"), 120);
  assert.equal(arcusRateLimit("markets"), 240);
});

test("analytics body is intentionally small", () => {
  assert.equal(TRACK_MAX_BODY_BYTES, 2048);
  assert.equal(ARCUS_POST_MAX_BODY_BYTES, 32_768);
});

test("Arcus and analytics routes are wired to bounded controls and honest cache scopes", () => {
  const arcus = readFileSync(new URL("../app/api/arcus/route.ts", import.meta.url), "utf8");
  const track = readFileSync(new URL("../app/api/track/route.ts", import.meta.url), "utf8");
  const upstream = readFileSync(new URL("./arcus/public.ts", import.meta.url), "utf8");
  const db = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

  for (const symbol of [
    "FixedWindowLimiter",
    "clientIp",
    "publicCacheHeaders",
    "privateNoStoreHeaders",
    "rateLimitHeaders",
    "arcusCacheSeconds",
    "arcusRateLimit",
  ]) {
    assert.ok(arcus.includes(symbol), `Arcus route must use ${symbol}`);
  }
  assert.ok(!arcus.includes("Map<string, number[]>"), "timestamp-array limiter must be removed");
  assert.ok(arcus.includes("reportError"), "Arcus upstream failures must reach observability");
  assert.ok(arcus.includes("mutationOriginAllowed"), "authenticated Arcus POST must reject cross-site mutations");
  assert.ok(arcus.includes("ARCUS_POST_MAX_BODY_BYTES"), "authenticated Arcus POST body must be bounded");
  assert.ok(arcus.includes("postLimiter"), "authenticated Arcus POST must be user-rate-limited");
  assert.ok(arcus.includes("postLimiter.consume(String(session.telegramId))"), "POST budget must bind to the session user");

  for (const symbol of ["FixedWindowLimiter", "clientIp", "privateNoStoreHeaders", "rateLimitHeaders", "mutationOriginAllowed", "TRACK_MAX_BODY_BYTES", "reportError"]) {
    assert.ok(track.includes(symbol), `track route must use ${symbol}`);
  }
  assert.ok(track.includes("empty(413)"), "oversized analytics payloads must fail before JSON parsing");
  assert.ok(track.includes("empty(415)"), "non-JSON analytics payloads must be rejected");
  assert.ok(track.includes("TRACK_ERROR_REPORT_WINDOW_MS"), "analytics insert errors must be sampled, not amplified");

  assert.ok(upstream.includes("BoundedTtlCache"), "upstream reads need bounded, coalescing cache");
  assert.ok(upstream.includes('cached("markets", 60_000'), "markets internal TTL must not exceed its CDN contract");
  assert.ok(upstream.includes('cached("spotOverview", 20_000'), "overview internal TTL must not exceed its CDN contract");
  assert.match(upstream, /cached\(`candles:\$\{market\}:\$\{timeframe\}/, "perp candles must be cached by market/timeframe");
  assert.match(upstream, /cached\(`spotCandles:\$\{market\}:\$\{timeframe\}/, "spot candles must be cached by market/timeframe");
  assert.ok(db.includes("AbortSignal.timeout(5_000)"), "analytics DB write must have a bounded network timeout");
});
