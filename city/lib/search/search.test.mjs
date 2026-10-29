import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { coinLink, coinPath } from "../share/coin-link.ts";
import { bareSymbol, isMint, pastedMint } from "./mint.ts";
import { catalogHits, cityHits, indexHits, launchHits, matchScore, mergeHits, spotIcon } from "./rank.ts";
import { factsFromCatalog, factsFromLaunch, factsFromMarket, parseCatalog, parseIndex, readCoinFacts, searchCatalog } from "./sources.ts";

/* The city as last read into the repository: the towers the first frame paints. */
const BUNDLED = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const LAUNCH = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER = "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D";
const POOL = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R";

test("a mint is base58 of 32 to 44 characters, and a paste is trimmed of its spaces and quotes", () => {
  assert.equal(isMint(JUP), true);
  assert.equal(isMint("So11111111111111111111111111111111111111112"), true);
  for (const bad of ["", "JUP", "0".repeat(40), `${JUP}x`.padEnd(45, "a"), "O".repeat(32), "l".repeat(32), "../../etc/passwd", null, 42]) assert.equal(isMint(bad), false, String(bad));
  assert.equal(pastedMint(`  "${JUP}"\n`), JUP);
  assert.equal(pastedMint("JUP"), null);
  assert.equal(bareSymbol(" $wif "), "WIF");
});

test("a coin's link is ryntra.io/c/<mint>; anything that is not a mint links the city", () => {
  assert.equal(coinLink(JUP), `https://ryntra.io/c/${JUP}`);
  assert.equal(coinPath(JUP), `/c/${JUP}`);
  assert.equal(coinLink("not a mint"), "https://ryntra.io");
  assert.equal(coinLink(`${JUP}/../admin`), "https://ryntra.io");
});

test("a ticker finds its tower first: the whole ticker, then its start, then names", () => {
  const towers = cityHits(BUNDLED.towers);
  const hits = mergeHits([towers], "JUP");
  assert.equal(hits[0].mint, JUP);
  assert.equal(hits[0].inCity, true);
  assert.ok(hits.some((hit) => hit.symbol === "JUPSOL"), "a ticker that starts with it follows");
  assert.equal(mergeHits([towers], "$wif")[0].symbol, "WIF", "a typed $ and case do not matter");
  const hit = { mint: JUP, symbol: "JUP", name: "Jupiter", icon: null, inCity: true, source: "city", verified: true, launch: false };
  assert.ok(matchScore(hit, "jup") > matchScore(hit, "jupit"));
  assert.ok(matchScore(hit, "Jupiter") > 0);
  assert.equal(matchScore(hit, "bonk"), 0);
  assert.equal(matchScore(hit, ""), 0);
});

test("a pasted mint finds its own coin and nothing else", () => {
  const hits = mergeHits([cityHits(BUNDLED.towers)], `  ${JUP} `);
  assert.deepEqual(hits.map((hit) => hit.mint), [JUP]);
  assert.deepEqual(mergeHits([cityHits(BUNDLED.towers)], OTHER), []);
});

test("one coin from several sources is one row, and a tower is said as one", () => {
  const inCity = new Set([JUP]);
  const merged = mergeHits(
    [
      cityHits([{ id: JUP, symbol: "JUP", name: "Jupiter", icon: "https://static.jup.ag/jup/icon.png", verified: true }]),
      indexHits([{ mint: JUP, symbol: "JUP", name: "Jupiter", icon: "https://static.jup.ag/jup/icon.png" }], inCity),
      catalogHits([{ mint: JUP, symbol: "JUP", name: "Jupiter", icon: null, isVerified: true, isSuspicious: false }, { mint: OTHER, symbol: "jupUSD", name: "Jupiter USD", icon: null, isVerified: true, isSuspicious: false }], inCity),
    ],
    "jup",
  );
  assert.deepEqual(merged.map((hit) => [hit.mint, hit.inCity, hit.source]), [[JUP, true, "city"], [OTHER, false, "catalog"]]);
  assert.equal(merged[0].icon, `/api/icon/${JUP}`);
});

test("among equal matches a tower comes first, then a launch, then the index and the catalogue", () => {
  const a = indexHits([{ mint: OTHER, symbol: "ABC", name: "Abc", icon: null }], new Set());
  const b = launchHits([{ token: LAUNCH, symbol: "ABC", name: "Abc launch", image: null }], new Set());
  const c = cityHits([{ id: JUP, symbol: "ABC", name: "Abc tower", icon: null, verified: true }]);
  assert.deepEqual(mergeHits([a, b, c], "abc").map((hit) => hit.mint), [JUP, LAUNCH, OTHER]);
});

test("a pool the city shows without a name is found by its address only, and stays without a name", () => {
  const towers = cityHits([{ id: POOL, symbol: "SCAM", name: "Scam coin", icon: "https://x.example/logo.png", verified: false }]);
  assert.deepEqual(mergeHits([towers], "scam"), []);
  const catalog = catalogHits([{ mint: POOL, symbol: "SCAM", name: "Scam coin", icon: "https://x.example/logo.png", isVerified: false, isSuspicious: true }], new Set([POOL]));
  const [hit] = mergeHits([towers, catalog], POOL);
  assert.equal(hit.symbol, null);
  assert.equal(hit.name, null);
  assert.equal(hit.icon, null);
  assert.equal(hit.inCity, true);
  /* A Ryntra launch standing in the city keeps its name, though Jupiter has not verified it. */
  const launch = cityHits([{ id: LAUNCH, symbol: "MOON", name: "Moon", icon: null, verified: false }], new Set([LAUNCH]));
  assert.equal(mergeHits([launch], "moon")[0].symbol, "MOON");
});

test("a catalogue picture goes through the engine's icon route, https only", () => {
  assert.equal(spotIcon(JUP, "https://static.jup.ag/jup/icon.png"), `/api/spot/icon?mint=${JUP}&u=${encodeURIComponent("https://static.jup.ag/jup/icon.png")}`);
  assert.equal(spotIcon(JUP, "http://static.jup.ag/jup/icon.png"), null);
  assert.equal(spotIcon(JUP, "javascript:alert(1)"), null);
  assert.equal(spotIcon(JUP, null), null);
});

test("the engine's answers are read as they are, and anything else reads as nothing", () => {
  assert.deepEqual(parseIndex({ coins: [{ mint: JUP, symbol: "JUP", name: "Jupiter", icon: null, price: 1 }], memes: [{ mint: "bad", symbol: "X" }], dollars: null }), [{ mint: JUP, symbol: "JUP", name: "Jupiter", icon: null }]);
  assert.deepEqual(parseIndex(null), []);
  assert.deepEqual(parseCatalog({ tokens: [{ mint: OTHER, symbol: "jlUSDC", name: "Jupiter Lend USDC", icon: "https://cdn.example/usdc.png", isVerified: true, isSuspicious: false }, { mint: "nope" }] }), [
    { mint: OTHER, symbol: "jlUSDC", name: "Jupiter Lend USDC", icon: "https://cdn.example/usdc.png", isVerified: true, isSuspicious: false },
  ]);
  assert.deepEqual(parseCatalog({ error: { code: "RATE_LIMITED" } }), []);
  const sha = "a".repeat(64);
  assert.deepEqual(factsFromLaunch(LAUNCH, { token: LAUNCH, symbol: "MOON", name: "Moon", image: `https://ryntra.io/api/launch/image/${sha}` }), { mint: LAUNCH, symbol: "MOON", name: "Moon", icon: `/api/launch/image/${sha}`, launch: true, verified: false });
  assert.equal(factsFromLaunch(LAUNCH, { token: OTHER, symbol: "MOON", name: "Moon" }), null, "another token's answer is not this one's");
  assert.equal(factsFromLaunch(LAUNCH, { error: { code: "LAUNCH_NOT_FOUND" } }), null);
  assert.deepEqual(factsFromMarket(JUP, { market: { mint: JUP, symbol: "JUP", name: "Jupiter", icon: "https://static.jup.ag/jup/icon.png", verified: true } }), { mint: JUP, symbol: "JUP", name: "Jupiter", icon: spotIcon(JUP, "https://static.jup.ag/jup/icon.png"), launch: false, verified: true });
  assert.equal(factsFromMarket(JUP, { market: null }), null);
});

function engine(answers) {
  const asked = [];
  return {
    asked,
    fetch: async (url, init = {}) => {
      asked.push({ url, method: init.method ?? "GET", body: init.body ?? null });
      const answer = answers[url.split("?")[0]];
      if (!answer) return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
      return new Response(JSON.stringify(answer), { status: 200 });
    },
  };
}

test("a mint is named by its Ryntra launch first, else by Jupiter's market, else by nothing", async () => {
  const both = engine({ [`/api/v1/launch/${LAUNCH}`]: { token: LAUNCH, symbol: "MOON", name: "Moon", image: null }, "/api/spot/market": { market: { mint: LAUNCH, symbol: "MOON2", name: "Other", icon: "https://cdn.example/m.png", verified: false } } });
  const launched = await readCoinFacts(LAUNCH, both);
  assert.equal(launched.symbol, "MOON");
  assert.equal(launched.launch, true);
  assert.equal(launched.icon, spotIcon(LAUNCH, "https://cdn.example/m.png"), "the market's picture when the launch has none");
  const market = engine({ "/api/spot/market": { market: { mint: JUP, symbol: "JUP", name: "Jupiter", icon: null, verified: true } } });
  assert.equal((await readCoinFacts(JUP, market)).symbol, "JUP");
  assert.equal(await readCoinFacts(OTHER, engine({})), null);
  /* The market did not answer (Jupiter's budget spent): the catalogue's row of this very mint names it. */
  const catalogue = engine({ "/api/solana/tokens/search": { tokens: [{ mint: JUP, symbol: "JUP", name: "Jupiter", icon: null, isVerified: true, isSuspicious: false }, { mint: OTHER, symbol: "jlUSDC", name: "Jupiter Lend USDC", icon: null, isVerified: true, isSuspicious: false }] } });
  assert.deepEqual(await readCoinFacts(OTHER, catalogue), { mint: OTHER, symbol: "jlUSDC", name: "Jupiter Lend USDC", icon: null, launch: false, verified: true });
  assert.equal(factsFromCatalog(OTHER, [{ mint: JUP, symbol: "JUP", name: "Jupiter", icon: null, isVerified: true, isSuspicious: false }]), null, "another mint's row does not name this one");
  const none = engine({});
  assert.equal(await readCoinFacts("not-a-mint", none), null);
  assert.equal(none.asked.length, 0, "a string that is not a mint is never asked about");
});

test("the catalogue is asked by POST with the query, and an aborted read stays aborted", async () => {
  const gen = engine({ "/api/solana/tokens/search": { tokens: [{ mint: JUP, symbol: "JUP", name: "Jupiter", icon: null, isVerified: true, isSuspicious: false }] } });
  const rows = await searchCatalog(" jup ", gen);
  assert.equal(rows[0].mint, JUP);
  assert.deepEqual(gen.asked[0], { url: "/api/solana/tokens/search", method: "POST", body: JSON.stringify({ query: "jup", limit: 8 }) });
  const abort = new AbortController();
  abort.abort();
  const aborting = { fetch: async () => Promise.reject(new DOMException("aborted", "AbortError")), signal: abort.signal };
  await assert.rejects(() => searchCatalog("jup", aborting));
  assert.deepEqual(await searchCatalog("", gen), []);
});
