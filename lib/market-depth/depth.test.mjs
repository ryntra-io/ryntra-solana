import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEPTH_LIMIT, TRENDING_MIN_TRADES, changeOf, depthCoinOf, inKind, kindOf, listCoins, listPaths, mergeCoins, movers, stableOf } from "./model.ts";

/** Jupiter's own answers of 17.11.2026, as read (trimmed to the fields the depth reads). */
const RECORDED = JSON.parse(readFileSync(new URL("./fixtures/jupiter-2026-11-17.json", import.meta.url), "utf8"));

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

test("every coin carries its logo, verified or not — only over https", () => {
  const coin = depthCoinOf(token(MINT_A, { isVerified: undefined }));
  assert.equal(coin.verified, false);
  assert.equal(coin.icon, "https://static.datapi.jup.ag/a.webp");
  assert.equal(depthCoinOf(token(MINT_A, { icon: "http://x/a.png" })).icon, null);
  assert.equal(depthCoinOf(token(MINT_A, { icon: `https://x/${"a".repeat(400)}.png` })).icon, null);
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
  assert.deepEqual(listPaths("trending", "6h", []), [`toptrending/6h?limit=${DEPTH_LIMIT}`, `toptraded/6h?limit=${DEPTH_LIMIT}`]);
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
  const made = mergeCoins([[token(MINT_A), token(MINT_B, { isVerified: undefined, audit: null, stats6h: null, holderCount: undefined, launchpad: "pump.fun" })]]);
  const parsed = MarketDepthResponseSchema.safeParse({ list: "trending", kind: "all", window: "1h", coins: made, readAt: new Date().toISOString() });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3)));
  // Jupiter's own answers, as the server builds every list from them.
  for (const list of ["trending", "traded", "gainers", "losers"]) {
    const coins = listCoins(list, "1h", [RECORDED.toptrending1h, RECORDED.toptraded1h], new Set());
    assert.ok(coins.length > 0, list);
    const answer = MarketDepthResponseSchema.safeParse({ list, kind: "all", window: "1h", coins, readAt: new Date().toISOString() });
    assert.ok(answer.success, `${list}: ${JSON.stringify(answer.error?.issues?.slice(0, 3))}`);
  }
  assert.match(API_CONTRACT_VERSION, /^1\.\d+\.0$/);
});

test("«Trending» on Jupiter's recorded answers: the window's real volume, no stock, no currency", () => {
  const coins = listCoins("trending", "1h", [RECORDED.toptrending1h, RECORDED.toptraded1h], new Set());
  assert.ok(coins.length >= 30, String(coins.length));
  // The most traded coins of the hour lead, as the window's volume ranks them.
  assert.deepEqual(coins.slice(0, 5).map((c) => c.symbol), ["cbBTC", "ZEC", "HYPE", "PUMP", "JUP"]);
  for (let i = 1; i < coins.length; i += 1) assert.ok(coins[i - 1].stats["1h"].volume >= coins[i].stats["1h"].volume);
  for (const coin of coins) {
    assert.equal(coin.stock, false, coin.symbol);
    assert.equal(coin.stable, false, coin.symbol);
    assert.ok(coin.stats["1h"].buys + coin.stats["1h"].sells >= TRENDING_MIN_TRADES["1h"], coin.symbol);
    assert.ok(coin.liquidity >= 10_000, coin.symbol);
  }
  // Jupiter's trending answer put stocks and a euro coin among the coins; none of them stands here.
  const names = new Set(coins.map((c) => c.symbol));
  for (const gone of ["NVDAx", "TTWO", "TSLA", "STRCx", "GOOGLx", "SNDK", "EUROP"]) assert.equal(names.has(gone), false, gone);
});

test("stocks and currencies are told by Jupiter's tags, a currency also by its name and a still price", () => {
  const all = mergeCoins([RECORDED.toptrending1h, RECORDED.toptraded1h, RECORDED.toporganicscore1h]);
  const by = (symbol) => all.find((c) => c.symbol === symbol);
  for (const stable of ["USDC", "USDT", "CASH", "JupUSD", "USDG", "EUROP"]) assert.equal(by(stable).stable, true, stable);
  for (const coin of ["SOL", "cbBTC", "HYPE", "JUP", "MET"]) assert.equal(by(coin).stable, false, coin);
  for (const stock of ["NVDAx", "TTWO", "STRCx", "ANTHROPIC", "TSLA"]) assert.equal(by(stock).stock, true, stock);
  assert.equal(stableOf([], "VCHF", 0.2, 1.25), true);
  assert.equal(stableOf([], "USDGO", -0.1, 0.999), true);
  // A currency's ticker that moves, or sits far from a peg, is not pegged; a name that only sounds like money neither.
  assert.equal(stableOf([], "EURO", 12, 1.1), false);
  assert.equal(stableOf([], "HYPE", 0.1, 1), false);
  for (const meme of ["AUDIO", "TRYHARD", "CADDY", "ZARA", "PHPX", "XAUt"]) assert.equal(stableOf([], meme, 0.3, 0.04), false, meme);
  assert.equal(stableOf([], "AUDIO", 0.3, 1.02), false);
});

test("«Most trades» counts the window's trades; rising and falling name no stock", () => {
  const traded = listCoins("traded", "1h", [RECORDED.toptraded1h], new Set());
  const trades = (c) => c.stats["1h"].buys + c.stats["1h"].sells;
  for (let i = 1; i < traded.length; i += 1) assert.ok(trades(traded[i - 1]) >= trades(traded[i]));
  assert.ok(traded.every((c) => !c.stock && !c.stable));
  const up = listCoins("gainers", "1h", [RECORDED.toptrending1h, RECORDED.toptraded1h], new Set());
  assert.ok(up.length > 0 && up.every((c) => !c.stock && !c.stable));
});

test("the launchpad a coin was born on, and the known name an unverified coin borrows", () => {
  const all = mergeCoins([RECORDED.toptrending1h, RECORDED.toptraded1h, RECORDED.toporganicscore1h]);
  const by = (symbol) => all.find((c) => c.symbol === symbol);
  assert.equal(by("mihao").launchpad, "pump.fun");
  assert.equal(by("mihao").venue, "pump");
  assert.equal(by("MET").launchpad, "Meteora");
  assert.equal(by("cbBTC").launchpad, null);
  // «Big Titty Coin» takes Bitcoin's ticker; an unverified «HYPE» copies the verified HYPE of the same answers.
  assert.equal(by("BTC").copyOf, "Bitcoin");
  assert.equal(by("HYGG").copyOf, "HYPE");
  assert.equal(by("HYPE").copyOf, null);
  assert.ok(all.filter((c) => !c.verified).every((c) => c.icon === null || c.icon.startsWith("https://")));
  assert.ok(all.filter((c) => !c.verified && c.icon).length > 20);
});

const ALL = () => mergeCoins([RECORDED.toptrending1h, RECORDED.toptraded1h, RECORDED.toporganicscore1h, RECORDED.searchPrestocks, RECORDED.searchSpacex]);

test("every coin has one kind — meme, crypto, stock or pre-IPO — by Jupiter's tags", () => {
  const all = ALL();
  const by = (symbol, verified = true) => all.find((c) => c.symbol === symbol && c.verified === verified);
  // Pre-IPO: PreStocks' tokens — OpenAI, Anthropic, Polymarket…
  for (const symbol of ["OPENAI", "ANTHROPIC", "POLYMARKET", "NEURALINK"]) assert.equal(by(symbol).kind, "preipo", symbol);
  // Stocks: listed companies' tokens — SpaceX listed on 12.06.2026 (the engine's lifecycle record), so its tokens are stocks.
  for (const symbol of ["NVDAx", "TTWO", "SPCX", "SPCXx", "TSLA"]) assert.equal(by(symbol).kind, "stock", symbol);
  // Memes: Jupiter's meme tag, or a coin born on a launchpad.
  for (const symbol of ["Fartcoin", "TRUMP", "ANSEM"]) assert.equal(by(symbol).kind, "meme", symbol);
  assert.equal(by("mihao", false).kind, "meme");
  // Crypto: the rest — MET was born on DBC but is Meteora's own coin.
  for (const symbol of ["SOL", "cbBTC", "ZEC", "HYPE", "JUP", "MET", "PUMP"]) assert.equal(by(symbol).kind, "crypto", symbol);
  // A pump.fun coin that borrows PreStocks' name carries no PreStocks tag: it is a meme, never a pre-IPO token.
  assert.ok(all.filter((c) => !c.verified && /prestocks/i.test(c.name)).every((c) => c.kind === "meme"));
  assert.equal(kindOf(["verified", "defi"], "met-dbc", "x"), "crypto");
  assert.equal(kindOf(["unknown"], "pump.fun", "x"), "meme");
});

test("the disconnected issuer's tokens and an expired one are no coins of the Market", () => {
  const all = ALL();
  assert.ok(!all.some((c) => c.symbol === "tSpaceX"), "Tessera is retired");
  assert.ok(!all.some((c) => c.id === "PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx"), "xAI's PreStocks expired");
});

test("each kind's list holds only its kind; «all» is the memes and the crypto; no currency anywhere", () => {
  const answers = [RECORDED.toptrending1h, RECORDED.toptraded1h];
  for (const kind of ["all", "meme", "crypto"]) {
    for (const list of ["trending", "gainers", "losers", "traded"]) {
      const coins = listCoins(list, "1h", answers, new Set(), kind);
      assert.ok(coins.every((c) => inKind(c, kind) && !c.stable), `${kind}/${list}`);
    }
  }
  assert.ok(listCoins("trending", "1h", answers, new Set(), "meme").length > 5);
  assert.ok(listCoins("trending", "1h", answers, new Set(), "crypto").some((c) => c.symbol === "JUP"));
  const pre = listCoins("trending", "1h", [RECORDED.searchPrestocks], new Set(), "preipo");
  assert.ok(pre.length >= 5 && pre.every((c) => c.kind === "preipo" && c.verified));
  /* Anthropic went public on 19.11, so its PreStocks token is no private company's — the most traded of the
     rest stands first, and neither SPACEX nor ANTHROPIC stands at all. */
  assert.equal(pre[0].symbol, "OPENAI", "the most traded private company first");
  assert.ok(!pre.some((c) => c.symbol === "ANTHROPIC" || c.symbol === "SPACEX"));
  const stocks = listCoins("trending", "1h", [RECORDED.searchSpacex, RECORDED.toptraded1h], new Set(), "stock");
  assert.ok(stocks.length >= 5 && stocks.every((c) => c.kind === "stock"));
  assert.deepEqual(listPaths("trending", "1h", [], "preipo"), ["search?query=prestocks"]);
  assert.ok(listPaths("trending", "1h", ["A"], "stock")[0].startsWith("search?query=A"));
});
