import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";

import { aggProvider, resetAggAdapterCache } from "./adapter.ts";

/*
 * Found 29.10 (CITY-77): AGG answered `/charts/bars` with no bars for the busiest markets at every resolution, and the
 * chart drew nothing. The series is served another way — its finalized history as files AGG signs with their SHA-256,
 * the bars after them from `/charts/bars` again — and the engine now reads it that way when the first answer is empty.
 */

const BASE = "http://agg.test";
const ID = "ne68wqb0gkcadl281jp9j5vg";
const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-29T09:00:00.000Z");
const realFetch = globalThis.fetch;
let asked = [];
let answers = {};

const bar = (t, c) => ({ t, o: c, h: c, l: c, c, v: 10 });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  process.env.AGG_APP_ID = "chart-test";
  process.env.AGG_API_BASE_URL = BASE;
  resetAggAdapterCache();
  asked = [];
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    asked.push(url.pathname + (url.searchParams.has("from") ? "?from" : ""));
    const answer = answers[url.pathname];
    if (!answer) return json({ error: "no" }, 404);
    return answer(url);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.AGG_APP_ID;
  delete process.env.AGG_API_BASE_URL;
  resetAggAdapterCache();
});

function archive(points) {
  const from = points[0].t;
  const to = points.at(-1).t + HOUR;
  const body = JSON.stringify({ version: 1, venueMarketOutcomeId: ID, venue: "polymarket", resolution: "1h", semantics: "polymarket-price-samples-v1", from, to, data: points });
  const sha256 = createHash("sha256").update(body).digest("hex");
  return {
    body,
    manifest: {
      version: 1,
      revision: "r1",
      venueMarketOutcomeId: ID,
      venue: "polymarket",
      resolution: "1h",
      semantics: "polymarket-price-samples-v1",
      from,
      to,
      finalizedThrough: to,
      chunks: [{ key: "c0", url: "https://history.agg.test/c0.json", sha256, from, to, points: points.length }],
      meta: { state: "ready", complete: true, serverTime: NOW, lastBarOpenTime: null, staleSeconds: null },
    },
  };
}

test("bars AGG gives at once are read as they are, and nothing else is asked", async () => {
  answers = { "/charts/bars": () => json({ venueMarketOutcomeId: ID, venue: "polymarket", resolution: "1h", data: [bar(NOW - 2 * HOUR, 0.7), bar(NOW - HOUR, 0.76)], meta: { state: "ready", serverTime: NOW, lastBarOpenTime: NOW - HOUR, staleSeconds: 3600 } }) };
  const got = await aggProvider.chart(ID, "1h", 168, NOW);
  assert.equal(got.ok, true);
  assert.deepEqual(got.value.bars.map((b) => b.c), [0.7, 0.76]);
  assert.deepEqual(asked, ["/charts/bars"]);
});

test("an empty answer that is still warming reads the signed history and the bars after it", async () => {
  const points = [bar(NOW - 4 * HOUR, 0.61), bar(NOW - 3 * HOUR, 0.64), bar(NOW - 2 * HOUR, 0.7)];
  const { body, manifest } = archive(points);
  manifest.finalizedThrough = NOW - HOUR;
  answers = {
    "/charts/bars": (url) =>
      url.searchParams.has("from")
        ? json({ venueMarketOutcomeId: ID, venue: "polymarket", resolution: "1h", data: [bar(NOW - HOUR, 0.765)], meta: { state: "ready", serverTime: NOW, lastBarOpenTime: NOW - HOUR, staleSeconds: 3600 } })
        : json({ venueMarketOutcomeId: ID, venue: "polymarket", resolution: "1h", data: [], meta: { state: "warming", retryAfterMs: 2000, serverTime: NOW, lastBarOpenTime: null, staleSeconds: null } }),
    "/charts/history/manifest": () => json(manifest),
    "/c0.json": () => new Response(body, { status: 200 }),
  };
  const got = await aggProvider.chart(ID, "1h", 168, NOW);
  assert.equal(got.ok, true);
  assert.deepEqual(got.value.bars.map((b) => b.c), [0.61, 0.64, 0.7, 0.765]);
  assert.equal(got.value.lastBarAt, NOW - HOUR);
  assert.deepEqual(asked, ["/charts/bars", "/charts/history/manifest", "/c0.json", "/charts/bars?from"]);
});

test("history whose bytes do not match their signature is never drawn: the first answer stands", async () => {
  const { manifest } = archive([bar(NOW - 3 * HOUR, 0.5), bar(NOW - 2 * HOUR, 0.52)]);
  answers = {
    "/charts/bars": () => json({ venueMarketOutcomeId: ID, venue: "polymarket", resolution: "1h", data: [], meta: { state: "warming", serverTime: NOW, lastBarOpenTime: null, staleSeconds: null } }),
    "/charts/history/manifest": () => json(manifest),
    "/c0.json": () => new Response(JSON.stringify({ tampered: true }), { status: 200 }),
  };
  const got = await aggProvider.chart(ID, "1h", 168, NOW);
  assert.equal(got.ok, true);
  assert.deepEqual(got.value.bars, []);
});

test("a market AGG says is empty is not asked about again another way, and an empty answer is not kept for long", async () => {
  let reads = 0;
  answers = {
    "/charts/bars": () => {
      reads++;
      return json({ venueMarketOutcomeId: ID, venue: "kalshi", resolution: "1d", data: [], meta: { state: "empty", serverTime: NOW, lastBarOpenTime: null, staleSeconds: null } });
    },
  };
  const first = await aggProvider.chart(ID, "1d", 31, NOW);
  assert.deepEqual(first.value.bars, []);
  assert.deepEqual(asked, ["/charts/bars"]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  // Within the chart's usual twenty seconds, but past the few an empty answer is kept: read again.
  const realNow = Date.now;
  Date.now = () => realNow() + 5_000;
  try {
    await aggProvider.chart(ID, "1d", 31, NOW);
  } finally {
    Date.now = realNow;
  }
  assert.equal(reads, 2);
});
