import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The search's index route is read-only, wallet-free, rate-limited like the
 * other Solana reads, and cached at the edge only when every list answered —
 * a partial index is never served to the next visitor as if it were whole.
 */

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
/* The code alone: the route's own prose says «wallet-free», which is not a read of one. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("it answers GET and nothing else", () => {
  const handlers = [...source.matchAll(/export async function (\w+)\(/g)].map((match) => match[1]);
  assert.deepEqual(handlers, ["GET"]);
});

test("it spends a read of the Solana budget before any upstream read", () => {
  const consume = source.indexOf("consumeSolanaReadRequest(request.headers)");
  const firstRead = source.indexOf("await Promise.all(");
  assert.ok(consume > 0 && consume < firstRead);
  assert.match(source, /if \(!rate\.allowed\) return failure\(429, "RATE_LIMITED"/);
});

test("it reads no wallet, no cookie and no account", () => {
  assert.doesNotMatch(code, /cookies\(|wallet|proof|session|account/i);
});

test("a partial index is private and uncached; only a whole one is cached at the edge", () => {
  assert.match(source, /partial \? \{ \.\.\.rateLimitHeaders\(rate\), "cache-control": "private, no-store" \} : \{ \.\.\.publicCacheHeaders\(60, 300\)/);
  assert.match(source, /return failure\(503, "SEARCH_UNAVAILABLE"/);
});

test("it serves the lists Markets draws, from the same shelves", () => {
  for (const name of ["shelfCompanies", "shelfPrivateCompanies", "coinShelf", "memeShelf"]) assert.match(source, new RegExp(`\\b${name}\\(`));
});
