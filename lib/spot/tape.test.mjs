import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { checkStatus } from "@ryntra/core/adapters/testing";

import { TAPE_HOURS, TAPE_MARKETS, TAPE_TTL_MS, priceText, tapeIcon, tapePoints, tapeStatus, tapeTone } from "./tape.ts";

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);

test("eight markets that trade on Solana, in the tape's order, each a mint once", () => {
  assert.deepEqual(TAPE_MARKETS.map((market) => market.symbol), ["SOL", "cbBTC", "ETH", "JUP", "AAPLx", "NVDAx", "TSLAx", "SPYx"]);
  assert.equal(new Set(TAPE_MARKETS.map((market) => market.mint)).size, 8);
  for (const market of TAPE_MARKETS) assert.match(market.mint, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
});

test("a price as a decimal with no exponent, to the digits it needs", () => {
  assert.equal(priceText(81858.0583), "81858.06");
  assert.equal(priceText(103.84312), "103.8431");
  assert.equal(priceText(0.290615), "0.29062");
  assert.doesNotMatch(priceText(0.0000231), /e/);
  assert.equal(priceText(Number.NaN), "0");
});

test("a day of hourly closes, oldest first, in ms; a broken close breaks the line", () => {
  const candles = Array.from({ length: 30 }, (_, i) => ({ time: NOW / 1000 - (30 - i) * 3600, open: 1, high: 1, low: 1, close: i === 27 ? 0 : 100 + i }));
  const points = tapePoints(candles);
  assert.equal(points.length, TAPE_HOURS);
  assert.equal(points[0].t, (NOW / 1000 - 24 * 3600) * 1000);
  assert.equal(points.at(-1).v, "129.0000");
  assert.equal(points[21].v, null);
});

test("icons through Ryntra's own route; no icon, no address", () => {
  assert.equal(tapeIcon("So11111111111111111111111111111111111111112", "https://example.org/sol.png"), "/api/spot/icon?mint=So11111111111111111111111111111111111111112&u=https%3A%2F%2Fexample.org%2Fsol.png");
  assert.equal(tapeIcon("So11111111111111111111111111111111111111112", null), null);
});

test("the status names both sources, ages from the older read, and says stale when a source failed", () => {
  const fresh = tapeStatus({ observedAt: new Date(NOW - 10_000).toISOString(), linesAt: new Date(NOW - 50_000).toISOString(), stale: false }, NOW);
  assert.deepEqual(checkStatus(fresh, "customer", "tape"), []);
  assert.equal(fresh.state, "delayed");
  assert.equal(fresh.age_ms, 50_000);
  assert.equal(fresh.delay_ms, TAPE_TTL_MS);
  assert.equal(fresh.source.label, "Jupiter · GeckoTerminal");
  const stale = tapeStatus({ observedAt: new Date(NOW - 10_000).toISOString(), linesAt: null, stale: true }, NOW);
  assert.deepEqual(checkStatus(stale, "customer", "tape"), []);
  assert.equal(stale.state, "stale");
  assert.equal(stale.delay_ms, null);
  assert.equal(stale.age_ms, 10_000);
});

test("the line's colour says what the day's change says", () => {
  assert.equal(tapeTone(1.2), "up");
  assert.equal(tapeTone(-0.07), "down");
  assert.equal(tapeTone(0), "neutral");
  assert.equal(tapeTone(null), "neutral");
});

test("the server read keeps its last good answer and says it is stale when the sources fail", () => {
  const server = readFileSync(new URL("./tape.server.ts", import.meta.url), "utf8");
  assert.match(server, /import "server-only";/);
  assert.match(server, /readSpotMarketsByMint\(TAPE_MARKETS\.map/);
  assert.match(server, /readSpotCandles\(market\.mint, "1h", "page"\)/, "the tape leaves the minute's reserve to people's charts");
  assert.match(server, /kept\.value\.complete \? TAPE_TTL_MS : TAPE_PARTIAL_TTL_MS/, "a read with a line missing is kept briefly");
  assert.match(server, /await within\(pending, kept \? REFRESH_WAIT_MS : TAPE_DEADLINE_MS\)/, "a read never waits past its deadline; the last read stands while a refresh runs");
  assert.match(server, /\? kept\.value : \{ \.\.\.kept\.value, stale: true \}/, "past twice its time the last read says it is stale");
  assert.match(server, /readOnce\(\)\s*\.catch\(\(\) => null\)/, "a failure is no 500");
  assert.match(server, /if \(last && now - last\.at < LINE_GRACE_MS\) \(\{ points, at \} = last\);/, "a refused line keeps the market's last one, aged from its read");
  const route = readFileSync(new URL("../../app/api/spot/tape/route.ts", import.meta.url), "utf8");
  assert.match(route, /consumeSolanaReadRequest\(request\.headers\)/);
  assert.match(route, /if \(refresh\) after\(/, "a refresh that outran the answer finishes after it");
  assert.match(route, /read\.stale \? \{ \.\.\.rateLimitHeaders\(rate\), "cache-control": "private, no-store" \}/, "a stale read is not kept at the edge");
});
