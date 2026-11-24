import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test, { afterEach, beforeEach } from "node:test";

import { resetJupiterBudget } from "../solana/jupiter-budget.ts";
import { POOL_TRADES_TTL_MS, resetSpotCandleCaches } from "./candles.server.ts";
import { resetSpotMarketCaches } from "./markets.server.ts";
import { resetTokenEvents } from "./token-events.server.ts";
import { isWholeTrade } from "./token-page.ts";
import { readTokenHolders, readTokenTrades, resetTokenPageCaches } from "./token-page.server.ts";
import { readTokenTraders, resetTokenTraders } from "./token-traders.server.ts";
import { resetWalletAges } from "./wallet-labels.server.ts";

/*
 * With the switches closed the page reads what
 * it read before and only gains optional fields; with them open the trades are the chain's events and a small coin's
 * holders are read whole.
 */

const MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const SOL = "So11111111111111111111111111111111111111112";
const DEV = "JUPhop9E8ZfdJ5FNHhxQt4uAih822Vs4QpqsWcewFbq";
const WHALE = "MriyaNN8TMp6qRWjfr723PK7xgQK7yCt7Kg2v2PQu7X";
const FRESH = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const AGENT = "E1w1XFq33ft6rGz19qTSzKKNuFvChbrUCZuY47adMfLV";
const POOL = "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj";
/* Raydium's AMM authority: a program's address, off the curve. */
const POOL_AUTHORITY = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const ACCOUNTS = ["4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh"];
const KEY = "0123abcd-4567-89ef-0123-456789abcdef";
const NODE = `https://mainnet.helius-rpc.com/?api-key=${KEY}`;
const NOW = Date.now();
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString();
const sig = (n) => `${"4".repeat(86)}${n}`;

const jupiterRow = (id, symbol, price, extra = {}) => ({
  id,
  symbol,
  name: symbol,
  decimals: 6,
  usdPrice: price,
  liquidity: 200_000,
  mcap: 500_000,
  holderCount: 1_500,
  circSupply: 1_000_000,
  totalSupply: 1_000_000,
  dev: DEV,
  audit: { devMints: 3, devMigrations: 1 },
  stats24h: { priceChange: 1, buyVolume: 10_000, sellVolume: 9_000 },
  ...extra,
});
const ROWS = { [MINT]: [jupiterRow(MINT, "COIN", 0.5)], [SOL]: [jupiterRow(SOL, "SOL", 150, { dev: undefined, holderCount: undefined })] };

const poolsBody = {
  data: [{
    attributes: { address: POOL, name: "COIN / SOL", reserve_in_usd: "200000", volume_usd: { h24: "19000" }, transactions: { h24: { buys: 40, sells: 30 } } },
    relationships: { base_token: { data: { id: `solana_${MINT}` } }, quote_token: { data: { id: `solana_${SOL}` } }, dex: { data: { id: "raydium" } } },
  }],
};
const geckoTrade = (n, wallet, side, tokens, usd, minutesAgo) => ({
  id: `t${n}`,
  attributes: {
    tx_hash: sig(n),
    block_timestamp: iso(minutesAgo),
    tx_from_address: wallet,
    from_token_address: side === "buy" ? SOL : MINT,
    to_token_address: side === "buy" ? MINT : SOL,
    from_token_amount: String(side === "buy" ? usd / 150 : tokens),
    to_token_amount: String(side === "buy" ? tokens : usd / 150),
    price_to_in_usd: side === "buy" ? String(usd / tokens) : "150",
    price_from_in_usd: side === "buy" ? "150" : String(usd / tokens),
    volume_in_usd: String(usd),
  },
});
const tradesBody = {
  data: [
    geckoTrade(1, WHALE, "sell", 2_000, 1_200, 2),
    geckoTrade(2, FRESH, "buy", 1_000, 450, 5),
    geckoTrade(3, AGENT, "buy", 100, 45, 8),
    geckoTrade(4, WHALE, "buy", 10_000, 4_000, 20),
    geckoTrade(5, DEV, "buy", 6_000, 3_000, 40),
  ],
};

const b64 = (address) => Buffer.from(new PublicKeyBytes(address)).toString("base64");
function PublicKeyBytes(address) {
  /* base58 → 32 bytes, enough for the owner slice of a token account. */
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const char of address) value = value * 58n + BigInt(ALPHABET.indexOf(char));
  const bytes = new Uint8Array(32);
  for (let i = 31; i >= 0; i -= 1) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}
const LARGEST = [
  { account: ACCOUNTS[0], owner: POOL_AUTHORITY, amount: "400000000000" },
  { account: ACCOUNTS[1], owner: WHALE, amount: "8000000000" },
  { account: ACCOUNTS[2], owner: DEV, amount: "6000000000" },
];

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };
let asked = [];
let scanPages = [];
let extraGecko = [];

function rpcAnswer(method, params) {
  if (method === "getTokenLargestAccounts") return { context: { slot: 1 }, value: LARGEST.map((row) => ({ address: row.account, amount: row.amount, decimals: 6, uiAmount: Number(row.amount) / 1e6, uiAmountString: String(Number(row.amount) / 1e6) })) };
  if (method === "getTokenSupply") return { context: { slot: 1 }, value: { amount: "1000000000000", decimals: 6, uiAmount: 1_000_000, uiAmountString: "1000000" } };
  if (method === "getMultipleAccounts") {
    return { context: { slot: 1 }, value: params[0].map((account) => ({ data: [b64(LARGEST.find((row) => row.account === account).owner), "base64"], executable: false, lamports: 2_039_280, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", rentEpoch: 0, space: 165 })) };
  }
  if (method === "getSignaturesForAddress") {
    const young = Math.floor(NOW / 1000) - 3_600;
    const count = params[0] === FRESH ? 2 : params[1].limit;
    return Array.from({ length: count }, (_, i) => ({ signature: sig(100 + i), slot: 10 + i, err: null, memo: null, blockTime: young - i, confirmationStatus: "finalized" }));
  }
  if (method === "getTokenAccounts") return { total: 3, limit: 1000, page: 1, token_accounts: LARGEST.map((row) => ({ address: row.account, mint: MINT, owner: row.owner, amount: Number(row.amount), delegated_amount: 0, frozen: false })) };
  throw new Error(`unexpected ${method}`);
}

beforeEach(() => {
  resetSpotMarketCaches();
  resetSpotCandleCaches();
  resetJupiterBudget();
  resetTokenPageCaches();
  resetTokenEvents();
  resetWalletAges();
  resetTokenTraders();
  asked = [];
  scanPages = [];
  extraGecko = [];
  process.env.RYNTRA_SOLANA_RPC_MAINNET = NODE;
  delete process.env.RYNTRA_SOLANA_RPC_MAINNET_FALLBACK;
  delete process.env.RYNTRA_SPOT_TOKEN_EVENTS;
  delete process.env.RYNTRA_SPOT_TOKEN_HOLDERS;
  process.env.RYNTRA_SPOT_WALLET_AGES = "on";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/tokens/v2/search")) {
      const query = new URL(url).searchParams.get("query");
      asked.push(`jupiter:${query.slice(0, 4)}`);
      return Response.json(ROWS[query] ?? []);
    }
    if (url.startsWith("https://api.geckoterminal.com/")) {
      asked.push(`gecko:${url.includes("/trades") ? "trades" : url.includes("/pools") ? "pools" : "other"}`);
      return Response.json(url.includes("/trades") ? { data: [...tradesBody.data, ...extraGecko] } : url.includes("/pools") ? poolsBody : {});
    }
    if (url.includes("/v1/parsed-events/scan")) {
      asked.push("helius:scan");
      return Response.json(scanPages.shift() ?? { data: [], scan: { stoppedOn: "windowEnd", scannedTransactions: 0, matchedTransactions: 0, creditsCharged: 10 } });
    }
    if (url.startsWith("https://mainnet.helius-rpc.com/")) {
      const body = JSON.parse(init.body);
      asked.push(`rpc:${body.method}`);
      return Response.json({ jsonrpc: "2.0", id: body.id, result: rpcAnswer(body.method, body.params) });
    }
    return new Response("{}", { status: 404 });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const name of ["RYNTRA_SOLANA_RPC_MAINNET", "RYNTRA_SPOT_TOKEN_EVENTS", "RYNTRA_SPOT_TOKEN_HOLDERS"]) {
    if (realEnv[name] === undefined) delete process.env[name];
    else process.env[name] = realEnv[name];
  }
});

const examples = {};

test("switches closed: GeckoTerminal's trades as before, each with its marks; nothing of Helius's events is asked", async () => {
  const read = await readTokenTrades(MINT);
  assert.equal(read.ok, true);
  assert.equal(read.source, "geckoterminal");
  assert.equal(read.pool.address, POOL);
  assert.equal(read.creator, DEV);
  assert.equal(asked.includes("helius:scan"), false);
  const marks = Object.fromEntries(read.trades.map((trade) => [trade.signature.slice(-1), trade.labels ?? []]));
  assert.deepEqual(marks, {
    1: ["top-holder", "big"],
    2: ["fresh"],
    3: ["ryntra-agent"],
    4: ["top-holder", "big"],
    5: ["creator", "top-holder", "big"],
  });
  assert.equal(read.trades[2].wallet, AGENT);
  assert.deepEqual(read.labelBasis, { creator: true, topHolders: 2, agents: true, fresh: 2, bigTradeUsd: 1_000, freshRule: { maxAgeHours: 72, maxTransactions: 40 } });
  assert.deepEqual(read.topHolders, [WHALE, DEV], "the field it always had, unchanged");
  for (const field of ["signature", "at", "side", "wallet", "tokenAmount", "usd", "priceUsd", "capUsd"]) assert.ok(field in read.trades[0], `${field} stays`);
  assert.equal(asked.filter((entry) => entry === "rpc:getSignaturesForAddress").length, 2, "only the buyers not marked otherwise are aged");
  examples.trades = { ...read, ok: undefined, trades: read.trades.slice(0, 2) };
});

test("holders: their worth in dollars and how far the list reaches — the node's twenty largest, said so", async () => {
  const read = await readTokenHolders(MINT);
  assert.equal(read.ok, true);
  assert.deepEqual(read.reach, { listed: 3, ceiling: 20, source: "largest-accounts", whole: false, holders: 1_500 });
  assert.deepEqual(read.holders.map((row) => [row.owner, row.amount, row.valueUsd, row.labels]), [
    [POOL_AUTHORITY, 400_000, 200_000, ["program"]],
    [WHALE, 8_000, 4_000, []],
    [DEV, 6_000, 3_000, ["creator"]],
  ]);
  examples.holders = { ...read, ok: undefined };
});

test("traders: each wallet's buys, sales, average prices and honest result over the span read", async () => {
  const read = await readTokenTraders(MINT);
  assert.equal(read.ok, true);
  assert.equal(read.basis.source, "geckoterminal");
  assert.equal(read.basis.whole, false);
  assert.equal(read.basis.trades, 5);
  assert.equal(read.basis.fees, "estimate");
  assert.equal(read.basis.exit.depthUsd, 100_000, "half the coin's liquidity");
  const whale = read.traders.find((row) => row.wallet === WHALE);
  assert.equal(whale.buys, 1);
  assert.equal(whale.sells, 1);
  assert.equal(whale.avgBuyPriceUsd, 0.4);
  assert.equal(whale.avgSellPriceUsd, 0.6);
  assert.ok(whale.realizedUsd > 0);
  assert.ok(whale.resultUsd !== null);
  assert.deepEqual(whale.labels, ["top-holder"]);
  const again = await readTokenTraders(MINT);
  assert.equal(again, read, "the same trades, the same table");
  examples.traders = { ...read, ok: undefined, traders: read.traders.slice(0, 2) };
});

const scanFixture = JSON.parse(readFileSync(new URL("./fixtures/token-events-scan.json", import.meta.url), "utf8"));
/* The fixture's one swap without a price of its own: a sale of 50 000 by the second wallet. */
const UNPRICED_SIGNATURE = `${"5".repeat(86)}5`;
const pricedOnly = (page) => ({ ...page, data: page.data.filter((item) => item.signature !== UNPRICED_SIGNATURE) });

test("events open: the chain's trades over every pool, whole from the coin's first trade", async () => {
  process.env.RYNTRA_SPOT_TOKEN_EVENTS = "helius";
  assert.ok(scanFixture.pages.first.data.some((item) => item.signature === UNPRICED_SIGNATURE));
  scanPages = [pricedOnly(scanFixture.pages.first), scanFixture.pages.last];
  const read = await readTokenTrades(MINT);
  assert.equal(read.ok, true);
  assert.equal(read.source, "helius");
  assert.equal(read.whole, true);
  assert.equal(read.trades.length, 4);
  assert.deepEqual(read.events, { filled: 0, hidden: 0 });
  assert.equal(asked.includes("gecko:trades"), false, "GeckoTerminal's trades are not read");
  assert.ok(read.trades.every((trade) => typeof trade.feeSol === "number"));
  assert.ok(read.trades.every(isWholeTrade));
  const traders = await readTokenTraders(MINT);
  assert.equal(traders.basis.source, "helius");
  assert.equal(traders.basis.whole, true);
  assert.equal(traders.basis.fees, "chain");
  examples.tradesHelius = { source: read.source, whole: read.whole, trades: read.trades.slice(0, 1) };
});

test("events open, a swap without a price: it takes the pool's price by its signature — a whole row, the marks and the filters as before", async () => {
  process.env.RYNTRA_SPOT_TOKEN_EVENTS = "helius";
  scanPages = [scanFixture.pages.first, scanFixture.pages.last];
  /* The pools' source lists the same sale — under another address, as it does for a relayed trade. */
  const same = geckoTrade(9, AGENT, "sell", 50_000, 30, 3);
  extraGecko = [{ ...same, attributes: { ...same.attributes, tx_hash: UNPRICED_SIGNATURE } }];
  const read = await readTokenTrades(MINT);
  assert.equal(read.source, "helius");
  assert.deepEqual(read.events, { filled: 1, hidden: 0 });
  assert.equal(read.whole, true, "nothing is left out");
  assert.equal(read.trades.length, 5);
  assert.ok(read.trades.every(isWholeTrade), "no row with a dash");
  const filled = read.trades.find((trade) => trade.signature === UNPRICED_SIGNATURE);
  assert.equal(filled.wallet, scanFixture.addresses.PUMPER, "the chain's trader");
  assert.equal(filled.tokenAmount, 50_000);
  assert.equal(filled.usd, 30);
  assert.equal(filled.priceUsd, 30 / 50_000);
  assert.equal(asked.filter((entry) => entry === "gecko:trades").length, 1, "one read of the pools' trades, no more credits");
  assert.equal(asked.filter((entry) => entry === "helius:scan").length, 2);
  /* The marks stand on the same reads as before: the creator named, the holders ranked, the big trades by their dollars. */
  assert.equal(read.labelBasis.creator, true);
  assert.equal(read.labelBasis.topHolders, 2);
  assert.equal(read.labelBasis.bigTradeUsd, 1_000);
  assert.ok(read.trades.some((trade) => trade.labels?.includes("top-holder")), "«Top holders» keeps its rows");
  assert.ok(read.trades.every((trade) => (trade.usd >= 1_000) === Boolean(trade.labels?.includes("big"))), "«Big» is every trade of a thousand dollars");
  /* A refresh with nothing new keeps the row and what the tape says of itself: one call, the price not asked for again. */
  const realNow = Date.now;
  Date.now = () => realNow() + POOL_TRADES_TTL_MS + 5_000;
  try {
    scanPages = [{ data: [], scan: { stoppedOn: "windowEnd", scannedTransactions: 0, matchedTransactions: 0, creditsCharged: 10 } }];
    const again = await readTokenTrades(MINT);
    assert.equal(again.source, "helius");
    assert.deepEqual(again.events, { filled: 1, hidden: 0 });
    assert.equal(again.trades.length, 5);
    assert.ok(again.trades.every(isWholeTrade));
    assert.equal(asked.filter((entry) => entry === "helius:scan").length, 3);
    assert.equal(asked.filter((entry) => entry === "gecko:trades").length, 1);
  } finally {
    Date.now = realNow;
  }
});

test("events open, too many swaps without a price: the pools' trades are the tape, and the events rest without credits", async () => {
  process.env.RYNTRA_SPOT_TOKEN_EVENTS = "helius";
  scanPages = [scanFixture.pages.first, scanFixture.pages.last];
  const read = await readTokenTrades(MINT);
  assert.equal(read.ok, true);
  assert.equal(read.source, "geckoterminal", "one of five without a price is past a tenth: a tape with holes is not shown");
  assert.equal(read.trades.length, 5);
  assert.ok(read.trades.every(isWholeTrade));
  assert.equal(read.events, undefined);
  assert.equal(asked.filter((entry) => entry === "helius:scan").length, 2);
  assert.equal(asked.filter((entry) => entry === "gecko:trades").length, 1, "the read made for the prices serves the tape");
  /* Past the tape's own keep the coin is read again: its events are not asked for a while. */
  const realNow = Date.now;
  Date.now = () => realNow() + POOL_TRADES_TTL_MS + 5_000;
  try {
    scanPages = [scanFixture.pages.first, scanFixture.pages.last];
    const again = await readTokenTrades(MINT);
    assert.equal(again.source, "geckoterminal");
    assert.equal(asked.filter((entry) => entry === "helius:scan").length, 2, "no credits while the coin's events rest");
  } finally {
    Date.now = realNow;
  }
});

test("events open, a swap no source prices: not shown, counted once however often the refreshes meet it, and the tape says so", async () => {
  process.env.RYNTRA_SPOT_TOKEN_EVENTS = "helius";
  const A = scanFixture.addresses;
  /* Twelve plain buys of a thousand tokens for a tenth of a SOL, the newest first, in the shape of the fixture's own items. */
  const buy = (n) => ({
    signature: `${"3".repeat(86)}${"ABCDEFGHJKLM"[n]}`,
    parserStatus: "OK",
    parsed: {
      slot: 380_000_100 - n,
      blockTime: 1_795_000_500 - n * 10,
      fee: 5_000,
      feePayer: A.BUYER,
      transactionStatus: "OK",
      nativeTransfers: [{ fromUserAccount: A.BUYER, toUserAccount: A.CURVE, amount: 100_000_000 }],
      tokenTransfers: [{ fromUserAccount: A.CURVE, toUserAccount: A.BUYER, fromTokenAccount: A.POOL_COIN, toTokenAccount: A.BUYER_COIN, rawTokenAmount: 1_000_000_000, decimals: 6, tokenStandard: "Fungible", mint: A.MINT }],
      summary: null,
      instructions: [],
    },
  });
  const scan = (data) => ({ data, scan: { stoppedOn: "windowEnd", scannedTransactions: data.length, matchedTransactions: data.length, creditsCharged: 10 } });
  /* The fixture's swap without a price, made the newest of all: every refresh asks from the newest trade listed and meets it again. */
  const fixtureSwap = scanFixture.pages.first.data.find((item) => item.signature === UNPRICED_SIGNATURE);
  const lost = { ...fixtureSwap, parsed: { ...fixtureSwap.parsed, blockTime: 1_795_000_600 } };
  scanPages = [scan([lost, ...Array.from({ length: 12 }, (_, n) => buy(n))])];
  const read = await readTokenTrades(MINT);
  assert.equal(read.source, "helius");
  assert.equal(read.trades.length, 12);
  assert.ok(read.trades.every(isWholeTrade));
  assert.deepEqual(read.events, { filled: 0, hidden: 1 }, "one of thirteen: under a tenth, the tape stands");
  assert.equal(read.whole, false, "a tape that leaves a trade out is not the whole history");
  const realNow = Date.now;
  try {
    for (const turn of [1, 2]) {
      Date.now = () => realNow() + turn * (POOL_TRADES_TTL_MS + 5_000);
      scanPages = [scan([lost, buy(0)])];
      const again = await readTokenTrades(MINT);
      assert.equal(again.source, "helius", `refresh ${turn}`);
      assert.deepEqual(again.events, { filled: 0, hidden: 1 }, `refresh ${turn}: the same swap is one swap`);
      assert.equal(again.trades.length, 12);
      assert.equal(again.whole, false);
    }
    assert.equal(asked.filter((entry) => entry === "helius:scan").length, 3, "a call a refresh");
  } finally {
    Date.now = realNow;
  }
});

test("events open but failing: GeckoTerminal answers at once", async () => {
  process.env.RYNTRA_SPOT_TOKEN_EVENTS = "helius";
  scanPages = [{ data: "broken" }];
  const read = await readTokenTrades(MINT);
  assert.equal(read.ok, true);
  assert.equal(read.source, "geckoterminal");
  assert.equal(read.trades.length, 5);
});

test("holders open: a small coin read whole lists up to a hundred, said so", async () => {
  process.env.RYNTRA_SPOT_TOKEN_HOLDERS = "das";
  const read = await readTokenHolders(MINT);
  assert.equal(read.ok, true);
  assert.deepEqual(read.reach, { listed: 3, ceiling: 100, source: "all-accounts", whole: true, holders: 1_500 });
  assert.equal(asked.includes("rpc:getTokenLargestAccounts"), false);
  assert.equal(asked.includes("rpc:getMultipleAccounts"), false, "DAS names the owners");
  assert.deepEqual(read.holders.map((row) => row.labels), [["program"], [], ["creator"]]);
  if (process.env.CITY346_EXAMPLES) writeFileSync(process.env.CITY346_EXAMPLES, JSON.stringify(examples, null, 2));
});
