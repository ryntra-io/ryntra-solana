import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEPTH_LIMIT, changeOf, depthCoinOf, listCoins, listPaths, mergeCoins, movers } from "./model.ts";

const MINT_A = "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb";
const MINT_B = "So11111111111111111111111111111111111111112";
const MINT_C = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const stats = (change, extra = {}) => ({ priceChange: change, buyVolume: 100, sellVolume: 50, numBuys: 7, numSells: 3, numTraders: 5, ...extra });
const token = (id, over = {}) => ({
  id,
  symbol: "AAA",
  name: "Aaa",
  icon: "https://static.datapi.jup.ag/a.webp",
  usdPrice: 1.5,
  mcap: 1_000_000,
  liquidity: 50_000,
  holderCount: 1234,
  organicScore: 80,
  isVerified: true,
  tags: ["verified"],
  firstPool: { createdAt: "2026-06-11T17:17:20Z" },
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 27.4 },
  stats5m: stats(0.5),
  stats1h: stats(1.5),
  stats6h: stats(-2),
  stats24h: stats(10),
  ...over,
});

test("a coin carries Jupiter's figures, and «null» for what Jupiter did not send", () => {
  const coin = depthCoinOf(token(MINT_A, { stats6h: null, holderCount: undefined }));
  assert.equal(coin.price, 1.5);
  assert.equal(coin.holders, null);
  assert.equal(coin.stats["6h"], null);
  assert.deepEqual(coin.stats["1h"], { change: 1.5, volume: 150, buys: 7, sells: 3, traders: 5 });
  assert.equal(coin.bornAt, "2026-06-11T17:17:20.000Z");
  assert.equal(coin.mint, "off");
  assert.equal(coin.freeze, "off");
  assert.equal(coin.topHolders, 27.4);
  // Half a volume is not the volume.
  assert.equal(depthCoinOf(token(MINT_A, { stats1h: { priceChange: 1, buyVolume: 100 } })).stats["1h"].volume, null);
});

test("mint and freeze rights: disabled, an authority named, or unknown", () => {
  assert.equal(depthCoinOf(token(MINT_A, { audit: {}, mintAuthority: "HK6jF79duLLLfCMRQFBSgo6CgQ5mF4tFMFU7CmKcXctZ" })).mint, "on");
  assert.equal(depthCoinOf(token(MINT_A, { audit: null })).mint, null);
  assert.equal(depthCoinOf(token(MINT_A, { audit: { freezeAuthorityDisabled: false } })).freeze, "on");
});

test("a coin nobody verified is drawn by its letter, never by its own picture", () => {
  const coin = depthCoinOf(token(MINT_A, { isVerified: undefined }));
  assert.equal(coin.verified, false);
  assert.equal(coin.icon, null);
  assert.equal(depthCoinOf(token(MINT_A, { icon: "http://x/a.png" })).icon, null);
});

test("an answer that is not a coin is dropped; a coin named twice stands once", () => {
  assert.equal(depthCoinOf({ id: "not a mint", symbol: "X" }), null);
  assert.equal(depthCoinOf({ id: MINT_A }), null);
  const coins = mergeCoins([[token(MINT_A), token(MINT_B)], [token(MINT_A, { symbol: "DUP" })]]);
  assert.deepEqual(coins.map((c) => c.id), [MINT_A, MINT_B]);
  assert.equal(coins[0].symbol, "AAA");
});

test("rising and falling: a measured move the asked way, past the liquidity floor, biggest first", () => {
  const coins = mergeCoins([
    [
      token(MINT_A, { stats1h: stats(5) }),
      token(MINT_B, { stats1h: stats(12) }),
      token(MINT_C, { stats1h: stats(-3) }),
      token("Ce2gx9KGXJ6C9Mp5b5x1sn9Mg87JwEbrQby4Zqo3pump", { stats1h: stats(900), liquidity: 300 }),
    ],
  ]);
  assert.deepEqual(movers(coins, "1h", "up").map((c) => c.id), [MINT_B, MINT_A]);
  assert.deepEqual(movers(coins, "1h", "down").map((c) => c.id), [MINT_C]);
  assert.equal(changeOf(coins[0], "1h"), 5);
});

test("each list names its Jupiter paths, bounded", () => {
  assert.deepEqual(listPaths("trending", "6h", []), [`toptrending/6h?limit=${DEPTH_LIMIT}`]);
  assert.deepEqual(listPaths("fresh", "5m", []), [`recent?limit=${DEPTH_LIMIT}`]);
  assert.equal(listPaths("gainers", "1h", []).length, 3);
  assert.ok(listPaths("stocks", "1h", [MINT_A])[0].startsWith(`search?query=${MINT_A}`));
  assert.ok(DEPTH_LIMIT <= 100);
});

test("«Stocks» keeps only stocks: the engine's own, or Jupiter's stocks tag", () => {
  const coins = listCoins("stocks", "24h", [[token(MINT_A)], [token(MINT_B, { tags: ["stocks"] }), token(MINT_C)]], new Set([MINT_A]));
  assert.deepEqual(coins.map((c) => c.id), [MINT_A, MINT_B]);
});

test("the route reads through the bounded server read and refuses an unknown list", () => {
  const route = readFileSync(new URL("../../app/api/v1/market/depth/route.ts", import.meta.url), "utf8");
  assert.match(route, /consumeSolanaReadRequest/);
  assert.match(route, /isDepthList\(list\)/);
  assert.match(route, /isDepthWindow\(window\)/);
  const read = readFileSync(new URL("./read.server.ts", import.meta.url), "utf8");
  assert.match(read, /RYNTRA_JUPITER_API_KEY/);
  assert.match(read, /AbortSignal\.timeout/);
  assert.match(read, /MAX_BYTES/);
});

test("an answer the server builds is what the contract describes", async () => {
  const { MarketDepthResponseSchema, API_CONTRACT_VERSION } = await import("../api/v1/contract.ts");
  const coins = listCoins("trending", "1h", [[token(MINT_A), token(MINT_B, { isVerified: undefined, audit: null, stats6h: null, holderCount: undefined })]], new Set());
  const parsed = MarketDepthResponseSchema.safeParse({ list: "trending", window: "1h", coins, readAt: new Date().toISOString() });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3)));
  assert.match(API_CONTRACT_VERSION, /^1\.\d+\.0$/);
});
