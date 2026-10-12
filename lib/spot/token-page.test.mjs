import assert from "node:assert/strict";
import test from "node:test";

import { holdersOf, honeypotOf, marksOf, poolsOf, riskFactsOf, snapToBars, tokenFactsOf, tradesOf, tradesPoolOf, tradesSpan, TOKEN_PAGE_SOURCES } from "./token-page.ts";
import { fairPriceOf, ISSUER_TERMS } from "../stocks/issuer-terms.ts";

/**
 * The token page: every figure is a source's own,
 * a missing one stays null, the trades carry who, how much and the
 * capitalisation at the trade, the holders their share and the net of their
 * own trades, and «Ризик» is facts with sources — never a verdict.
 */

const MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const SOL = "So11111111111111111111111111111111111111112";
const DEV = "JUPhop9E8ZfdJ5FNHhxQt4uAih822Vs4QpqsWcewFbq";
const WALLET = "MriyaNN8TMp6qRWjfr723PK7xgQK7yCt7Kg2v2PQu7X";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const jupiterRow = {
  id: MINT,
  symbol: "JUP",
  name: "Jupiter",
  dev: DEV,
  circSupply: 3_319_369_204.37,
  totalSupply: 6_861_486_187.95,
  launchpad: "met-dbc",
  graduatedAt: "2026-10-10T10:00:00Z",
  createdAt: "2024-01-29T17:33:29Z",
  discord: "https://discord.gg/jup",
  instagram: "http://insecure.example",
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 15.4, devMints: 1, devMigrations: 0 },
  stats5m: { priceChange: -0.3, holderChange: -0.0001, liquidityChange: -0.1, buyVolume: 9076.2, sellVolume: 39760.1, numBuys: 194, numSells: 271, numTraders: 127 },
  stats1h: { priceChange: 1, buyVolume: 10, sellVolume: 5 },
  stats24h: { priceChange: 0.41, holderChange: 0.15, liquidityChange: -42, buyVolume: 1_000_000, sellVolume: 700_000 },
};

test("Jupiter's row gives the page its four windows, its supply, its creator and the creator's own https links", () => {
  const facts = tokenFactsOf(jupiterRow);
  assert.equal(facts.mint, MINT);
  assert.equal(facts.dev, DEV);
  assert.equal(facts.circulatingSupply, 3_319_369_204.37);
  assert.equal(facts.devMints, 1);
  assert.equal(facts.windows.m5.volumeUsd, 9076.2 + 39760.1);
  assert.equal(facts.windows.m5.buys, 194);
  assert.equal(facts.windows.h24.liquidityChangePct, -42);
  /* A window Jupiter did not state is nulls, never zeros. */
  assert.equal(facts.windows.h6.volumeUsd, null);
  assert.equal(facts.windows.h6.priceChangePct, null);
  assert.deepEqual(facts.socials, [{ kind: "discord", url: "https://discord.gg/jup" }]);
  assert.equal(tokenFactsOf({ id: "not-a-mint" }), null);
  assert.equal(tokenFactsOf(null), null);
});

const pool = (address, base, quote, reserve, volume, extra = {}) => ({
  attributes: { address, name: `${base === MINT ? "JUP" : "X"} / SOL`, reserve_in_usd: String(reserve), volume_usd: { h24: volume === null ? null : String(volume) }, transactions: { h24: { buys: 10, sells: 12 } }, pool_created_at: "2024-03-19T03:11:43Z", ...extra },
  relationships: { base_token: { data: { id: `solana_${base}` } }, quote_token: { data: { id: `solana_${quote}` } }, dex: { data: { id: "meteora" } } },
});

test("the pools are the mint's own, deepest first; the trades are of the pool that traded most, whatever it is paired against", () => {
  const body = { data: [
    pool("C8Gr6AUuq9hEdSYJzoEpNcdjpojPZwqG5MtQbeouNNwg", MINT, SOL, 2_250_574, 1_721_802),
    pool("2pspvjWWaf3dNgt3jsgSzFCNvMGPb7t8FrEYvLGjvcCe", SOL, MINT, 9_000_000, 300),
    pool("7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm", OTHER, SOL, 1_000_000_000, 5_000_000),
    pool("8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj", MINT, OTHER, 100, 0),
  ] };
  const pools = poolsOf(body, MINT);
  assert.deepEqual(pools.map((entry) => entry.address), ["2pspvjWWaf3dNgt3jsgSzFCNvMGPb7t8FrEYvLGjvcCe", "C8Gr6AUuq9hEdSYJzoEpNcdjpojPZwqG5MtQbeouNNwg", "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj"]);
  assert.equal(pools[0].side, "quote");
  assert.equal(pools[1].buys24h, 10);
  assert.equal(tradesPoolOf(pools).address, "C8Gr6AUuq9hEdSYJzoEpNcdjpojPZwqG5MtQbeouNNwg");
  assert.equal(tradesPoolOf([pools[2]]), null, "a pool that did not trade has nothing to list");
});

const trade = (hash, kind, at, from, amount, usd, price, wallet = WALLET) => ({
  attributes: {
    tx_hash: hash,
    block_timestamp: at,
    tx_from_address: wallet,
    kind,
    from_token_address: kind === "buy" ? SOL : MINT,
    to_token_address: kind === "buy" ? MINT : SOL,
    from_token_amount: kind === "buy" ? "1" : String(amount),
    to_token_amount: kind === "buy" ? String(amount) : "1",
    price_from_in_usd: kind === "buy" ? "111" : String(price),
    price_to_in_usd: kind === "buy" ? String(price) : "111",
    volume_in_usd: String(usd),
  },
});

test("a trade says who, which side, how many tokens, the dollars and the capitalisation at the trade's own price", () => {
  const body = { data: [
    trade("sigA", "buy", "2026-10-11T20:53:35Z", SOL, 233.83, 85.37, 0.365),
    trade("sigB", "sell", "2026-10-11T20:55:00Z", MINT, 1000, 360, 0.36, DEV),
    trade("sigA", "buy", "2026-10-11T20:53:35Z", SOL, 233.83, 85.37, 0.365),
    { attributes: { tx_hash: "sigC", block_timestamp: "2026-10-11T20:00:00Z", tx_from_address: WALLET, from_token_address: OTHER, to_token_address: SOL } },
  ] };
  const trades = tradesOf(body, MINT, 1_000_000);
  assert.equal(trades.length, 2, "a leg repeated and a trade of other tokens are not listed");
  assert.equal(trades[0].signature, "sigB", "newest first");
  assert.equal(trades[0].side, "sell");
  assert.equal(trades[0].tokenAmount, 1000);
  assert.equal(trades[0].capUsd, 0.36 * 1_000_000);
  assert.equal(trades[1].side, "buy");
  assert.equal(trades[1].wallet, WALLET);
  assert.deepEqual(tradesSpan(trades), { from: "2026-10-11T20:53:35.000Z", to: "2026-10-11T20:55:00.000Z" });
  /* A tokenized stock: no capitalisation, the amounts and prices in the unit the wallet shows. */
  const stock = tradesOf(body, MINT, null, 1.25);
  assert.equal(stock[0].capUsd, null);
  assert.equal(stock[0].tokenAmount, 1250);
  assert.equal(stock[0].priceUsd, 0.36 / 1.25);
});

test("the holders merge by owner, carry their share of the supply, what the chain says they are, and the net of their own trades", () => {
  const trades = tradesOf({ data: [
    trade("s1", "buy", "2026-10-11T20:00:00Z", SOL, 50, 20, 0.4),
    trade("s2", "sell", "2026-10-11T20:10:00Z", MINT, 20, 8, 0.4),
  ] }, MINT, null);
  const read = holdersOf({
    accounts: [
      { account: "a1", owner: WALLET, amountRaw: "100000000" },
      { account: "a2", owner: WALLET, amountRaw: "50000000" },
      { account: "a3", owner: DEV, amountRaw: "300000000" },
      { account: "a4", owner: OTHER, amountRaw: "0" },
      { account: "a5", owner: "PoolAuthority1111111111111111111111111111111", amountRaw: "500000000" },
    ],
    decimals: 6,
    supplyRaw: "1000000000",
    programOwners: new Set(["PoolAuthority1111111111111111111111111111111"]),
    dev: DEV,
    trades,
  });
  assert.deepEqual(read.holders.map((row) => row.owner), ["PoolAuthority1111111111111111111111111111111", DEV, WALLET]);
  assert.equal(read.supply, 1000);
  const wallet = read.holders.find((row) => row.owner === WALLET);
  assert.equal(wallet.amount, 150);
  assert.equal(wallet.sharePct, 15);
  assert.equal(wallet.change, 30, "bought 50, sold 20");
  assert.equal(wallet.trades, 2);
  assert.deepEqual(read.holders[0].labels, ["program"]);
  assert.deepEqual(read.holders[1].labels, ["creator"]);
  assert.equal(read.holders[1].change, null, "no trade in the span is no change read, not zero");
  assert.equal(read.programPct, 50, "what the program's account holds is said beside the list");
  const unknownSupply = holdersOf({ accounts: [{ account: "a1", owner: WALLET, amountRaw: "1" }], decimals: 0, supplyRaw: null, programOwners: new Set(), dev: null, trades: [] });
  assert.equal(unknownSupply.holders[0].sharePct, null);
  assert.equal(unknownSupply.programPct, null);
});

const market = (overrides = {}) => ({
  verified: false,
  liquidityUsd: 12_000,
  organicScoreLabel: "low",
  firstPoolAt: "2026-10-11T00:00:00Z",
  category: "meme",
  audit: { mintAuthorityDisabled: false, freezeAuthorityDisabled: true, topHoldersPct: 60, devBalancePct: 4, suspicious: true },
  ...overrides,
});

test("«Ризик» is facts with sources: powers over holders and flags are notices, the rest plain, and nothing adds up to a verdict", () => {
  const facts = riskFactsOf({ market: market(), facts: tokenFactsOf(jupiterRow), honeypot: false, now: Date.parse("2026-10-11T12:00:00Z") });
  const byCode = Object.fromEntries(facts.map((fact) => [fact.code, fact]));
  assert.equal(byCode.MINT_AUTHORITY.tone, "notice");
  assert.equal(byCode.MINT_AUTHORITY.state, "active");
  assert.equal(byCode.FREEZE_AUTHORITY.tone, "plain");
  assert.equal(byCode.FLAGGED.tone, "notice");
  assert.equal(byCode.TOP10.value, 60, "one concentration figure on the page: the catalogue's, as the header shows it");
  assert.equal(byCode.TOP10.source, "jupiter");
  assert.equal(byCode.CREATOR_TOKENS.value, 1);
  assert.equal(byCode.LIQUIDITY_CHANGE.value, -42);
  assert.equal(Math.round(byCode.AGE.value * 2) / 2, 0.5);
  assert.equal(byCode.HONEYPOT.state, "no");
  assert.equal(byCode.HONEYPOT.tone, "plain");
  for (const fact of facts) assert.ok(fact.tone === "notice" || fact.tone === "plain");
  assert.ok(!facts.some((fact) => /safe|scam|score/i.test(String(fact.state ?? ""))), "no verdict word");
  /* A tokenized stock: its issuer's rights are the instrument's design — plain facts, no concentration figures. */
  const stock = riskFactsOf({ market: market({ category: "stock" }), facts: null, honeypot: null, now: Date.now() });
  assert.equal(stock.find((fact) => fact.code === "MINT_AUTHORITY").tone, "plain");
  assert.ok(!stock.some((fact) => fact.code === "TOP10" || fact.code === "CREATOR_HOLDS"));
  assert.equal(honeypotOf({ data: { attributes: { is_honeypot: "yes" } } }), true);
  assert.equal(honeypotOf({ data: { attributes: { is_honeypot: "no" } } }), false);
  assert.equal(honeypotOf({ data: { attributes: {} } }), null);
  const unread = riskFactsOf({ market: market(), facts: null, honeypot: null, now: Date.now() });
  assert.equal(unread.find((fact) => fact.code === "HONEYPOT").state, "unread", "a check not read is said, not left out");
  assert.ok(!riskFactsOf({ market: market(), facts: null, now: Date.now() }).some((fact) => fact.code === "HONEYPOT"), "a check not asked has no row");
});

test("the chart's marks: the largest trades, the creator's own with the share of supply, the curve's exit, a deep fall in liquidity", () => {
  const trades = tradesOf({ data: [
    trade("big1", "buy", "2026-10-11T10:00:00Z", SOL, 10_000, 5_000, 0.5),
    trade("small", "buy", "2026-10-11T10:01:00Z", SOL, 1, 0.5, 0.5),
    trade("dev", "sell", "2026-10-11T11:00:00Z", MINT, 120, 60, 0.5, DEV),
  ] }, MINT, 1000);
  const marks = marksOf({ trades, facts: tokenFactsOf(jupiterRow), supply: 1000, now: Date.parse("2026-10-11T12:00:00Z") });
  assert.deepEqual(marks.map((mark) => mark.kind), ["dex", "big-buy", "creator-sell", "liquidity-drop"]);
  assert.equal(marks.find((mark) => mark.kind === "creator-sell").pct, 12);
  assert.equal(marks.find((mark) => mark.kind === "liquidity-drop").pct, -42);
  assert.equal(snapToBars([100, 200, 300], 250), 200);
  assert.equal(snapToBars([100, 200, 300], 300), 300);
  assert.equal(snapToBars([100, 200, 300], 50), null, "before the first bar is off the chart");
});

test("every source shown on the page names its attribution as its terms ask", () => {
  assert.equal(TOKEN_PAGE_SOURCES.jupiter.attribution, "Powered by Jupiter");
  assert.equal(TOKEN_PAGE_SOURCES.geckoterminal.attribution, "Powered by GeckoTerminal");
  assert.equal(TOKEN_PAGE_SOURCES.chain.attribution, null);
});

test("«Ціна чесна» is one word from the deviation, and each issuer's terms cite a document", () => {
  assert.equal(fairPriceOf(0.3), "fair");
  assert.equal(fairPriceOf(-0.5), "fair");
  assert.equal(fairPriceOf(0.8), "slightly-dearer");
  assert.equal(fairPriceOf(2), "dear");
  assert.equal(fairPriceOf(-1.2), "cheaper");
  assert.equal(fairPriceOf(null), "no-reference");
  for (const terms of Object.values(ISSUER_TERMS)) {
    assert.match(terms.document.url, /^https:\/\//);
    assert.match(terms.dividends.document.url, /^https:\/\//);
    assert.equal(terms.document.readOn, "2026-10-11");
    assert.ok(terms.excluded.length > 0);
    for (const place of [...terms.excluded, ...terms.limited]) assert.ok(place.en && place.uk);
  }
  assert.equal(ISSUER_TERMS.backpack.issuerOwn, false, "the platform's list is named as the platform's");
  assert.equal(ISSUER_TERMS.prestocks.dividends.kind, "none");
  assert.equal(ISSUER_TERMS.prestocks.excluded.length, 36);
});
