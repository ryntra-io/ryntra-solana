import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { CATALOG_SEARCH_HELD_MS, CATALOG_SEARCH_TTL_MS, resetCatalogSearch, searchCatalogShared } from "./catalog-search.server.ts";
import { ratePauseLeftMs, resetRatePauses } from "./shared-reads.ts";

/* `/api/solana/tokens/search` through the shared read layer. */

const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);
const realNow = Date.now;
let now = T0;

const JUP = { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", icon: null, isVerified: true, isSuspicious: false };
const found = (rows = [JUP]) => ({ ok: true, rows, observedAt: new Date(now).toISOString(), source: { ref: "jupiter:mainnet:tokens:search", label: "Jupiter Tokens API, pro tier" } });
const passThrough = async (_key, _seconds, read) => read();

function searcher(answer) {
  const calls = { n: 0 };
  return { calls, search: async () => { calls.n += 1; return typeof answer === "function" ? answer() : answer; } };
}

beforeEach(() => {
  resetCatalogSearch();
  resetRatePauses();
  now = T0;
  Date.now = () => now;
});
afterEach(() => {
  Date.now = realNow;
});

test("the same words at once are one call; the answer is kept half a minute and trimmed per caller", async () => {
  const { calls, search } = searcher(() => found([JUP, { ...JUP, mint: "Other1111111111111111111111111111111111111", symbol: "JUPx" }]));
  const [eight, one] = await Promise.all([searchCatalogShared("jup", 8, { search, shared: passThrough }), searchCatalogShared(" jup ", 1, { search, shared: passThrough })]);
  assert.equal(calls.n, 1);
  assert.equal(eight.ok && eight.rows.length, 2);
  assert.equal(one.ok && one.rows.length, 1);
  assert.equal(eight.ok && eight.stale, false);
  now = T0 + CATALOG_SEARCH_TTL_MS - 1;
  await searchCatalogShared("jup", 8, { search, shared: passThrough });
  assert.equal(calls.n, 1);
  now = T0 + CATALOG_SEARCH_TTL_MS;
  await searchCatalogShared("jup", 8, { search, shared: passThrough });
  assert.equal(calls.n, 2);
});

test("after Jupiter's 429: the last answer, stale, with its own time; a query never answered is a refusal with its wait; nothing asked in the pause", async () => {
  let answer = found();
  const { calls, search } = searcher(() => answer);
  await searchCatalogShared("jup", 8, { search, shared: passThrough });
  now = T0 + 45_000;
  answer = { ok: false, code: "RATE_LIMITED", reason: "Jupiter rate-limited the token catalog." };
  const held = await searchCatalogShared("jup", 8, { search, shared: passThrough });
  assert.equal(held.ok, true);
  assert.equal(held.stale, true);
  assert.equal(held.observedAt, new Date(T0).toISOString());
  assert.equal(held.rows[0].symbol, "JUP");
  assert.ok(ratePauseLeftMs("jupiter") > 0);
  const n = calls.n;
  const cold = await searchCatalogShared("bonk", 8, { search, shared: passThrough });
  assert.equal(cold.ok, false, "never an empty list that reads as «nothing found»");
  assert.equal(cold.code, "RATE_LIMITED");
  assert.ok(cold.retryAfterMs > 0);
  assert.equal(calls.n, n);
  /* Past the held limit the old answer is not served. */
  now = T0 + CATALOG_SEARCH_HELD_MS + 10_000;
  const gone = await searchCatalogShared("jup", 8, { search, shared: passThrough });
  assert.equal(gone.ok, false);
});

test("an answer the data cache kept for every instance is taken while young; an old copy is read again here", async () => {
  const { calls, search } = searcher(() => found());
  const kept = { ok: true, value: found(), readAt: T0 - 5_000 };
  const shared = async () => kept;
  const young = await searchCatalogShared("jup", 8, { search, shared });
  assert.equal(calls.n, 0, "another instance's read, not a new call");
  assert.equal(young.ok && young.observedAt, new Date(T0 - 5_000).toISOString(), "dated by when it was read");
  resetCatalogSearch();
  const old = { ok: true, value: found(), readAt: T0 - 5 * 60_000 };
  await searchCatalogShared("jup", 8, { search, shared: async () => old });
  assert.equal(calls.n, 1);
});

test("a malformed query is refused before any read", async () => {
  const { calls, search } = searcher(found());
  assert.equal((await searchCatalogShared("   ", 8, { search, shared: passThrough })).ok, false);
  assert.equal((await searchCatalogShared("x".repeat(65), 8, { search, shared: passThrough })).ok, false);
  assert.equal(calls.n, 0);
});

/* A coin passing for a stock says so, and never stands above the real one or any coin that is its own. */
test("a copy of a stock is marked and stands after the rest", async () => {
  const ANT = { mint: "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe", symbol: "ANT", name: "Anthropic - Backpack Securities", decimals: 6, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", icon: null, isVerified: true, isSuspicious: false };
  const copy = { ...ANT, mint: "4WdnFakeAnthropicCopy11111111111111111bpump", name: "Anthropic", isVerified: false };
  const named = { ...ANT, mint: "81KrFakeANThropicCopy111111111111111111pump", symbol: "ANTHRP", name: "ANThropic", isVerified: false };
  const own = { ...ANT, mint: "AntsOwnCoin11111111111111111111111111111111", symbol: "ANTS", name: "Ants", isVerified: false };
  const { search } = searcher(() => found([copy, named, ANT, own]));
  const read = await searchCatalogShared("ant", 8, { search, shared: passThrough });
  assert.equal(read.ok, true);
  assert.deepEqual(read.rows.map((row) => row.symbol), ["ANT", "ANTS", "ANT", "ANTHRP"]);
  assert.equal(read.rows[0].passesFor, null);
  assert.equal(read.rows[1].passesFor, null);
  assert.deepEqual(read.rows[2].passesFor, { ticker: "ANT", company: "Anthropic", mint: ANT.mint });
  assert.equal(read.rows[3].passesFor?.company, "Anthropic");
});
