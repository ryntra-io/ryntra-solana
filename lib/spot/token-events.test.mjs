import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";

import { USDT_MINT } from "./coin-shelf.ts";
import { EVENTS_PAGE_LIMIT, EVENTS_SCAN_BUDGET, EventsMalformed, FILL_AMOUNT_SHARE, OFF_MARKET_FACTOR, PASS_THROUGH_SHARE, eventsBody, fillUnpriced, mergeTrades, readParsed, splitOffMarket, tradeOfParsed, tradesOfEvents, unpricedOf } from "./token-events.ts";
import { isWholeTrade } from "./token-page.ts";
import { EVENTS_TRADES_TARGET, MAX_CALLS, TOKEN_EVENTS_DAILY_CREDITS, TOKEN_EVENTS_DAILY_ENV, readMintTradeEvents, resetTokenEvents, tokenEventsDaySpent, tokenEventsEndpoint, tokenEventsStats } from "./token-events.server.ts";

/*
 * The coin's trades from Helius Parsed Events Scan over its mint — read from answers in the shape Helius
 * publishes (helius-sdk 3.5.0 types, `fixtures/token-events-scan.json`). Closed unless the deployment opens it; a
 * failure answers null so the page reads GeckoTerminal; the key is never said.
 */

const fixture = JSON.parse(readFileSync(new URL("./fixtures/token-events-scan.json", import.meta.url), "utf8"));
const A = fixture.addresses;
const { first, last, budgetStop } = fixture.pages;
const KEY = "0123abcd-4567-89ef-0123-456789abcdef";
const NODE = `https://mainnet.helius-rpc.com/?api-key=${KEY}`;
const ENDPOINT = `https://mainnet.helius-rpc.com/v1/parsed-events/scan?api-key=${KEY}`;
const PRICING = { capSupply: 1_000_000_000, multiplier: null, solPriceUsd: 150 };
const close = (a, b) => Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));

test("closed unless the deployment says helius and the node is Helius's with its key", () => {
  assert.equal(tokenEventsEndpoint({}, NODE), null);
  assert.equal(tokenEventsEndpoint({ RYNTRA_SPOT_TOKEN_EVENTS: "on" }, NODE), null);
  assert.equal(tokenEventsEndpoint({ RYNTRA_SPOT_TOKEN_EVENTS: "helius" }, "https://solana-rpc.publicnode.com"), null);
  assert.equal(tokenEventsEndpoint({ RYNTRA_SPOT_TOKEN_EVENTS: "helius" }, "https://devnet.helius-rpc.com/?api-key=" + KEY), null);
  assert.equal(tokenEventsEndpoint({ RYNTRA_SPOT_TOKEN_EVENTS: " Helius " }, NODE), ENDPOINT);
});

test("a request scans the mint's own history for its balances, parsed, newest first, capped in what it scans", () => {
  assert.deepEqual(eventsBody({ mint: A.MINT }), {
    address: A.MINT,
    match: { mints: [{ mint: A.MINT, scope: "address" }] },
    returnShape: "transactions",
    limit: EVENTS_PAGE_LIMIT,
    commitment: "confirmed",
    sortOrder: "desc",
    status: "succeeded",
    tokenAccounts: "none",
    rawTransaction: "none",
    budget: { maxScannedTransactions: EVENTS_SCAN_BUDGET },
  });
  assert.equal(eventsBody({ mint: A.MINT, limit: 1_000 }).limit, 100, "Helius's ceiling");
  assert.deepEqual(eventsBody({ mint: A.MINT, sinceS: 1_794_999_999.7 }).time, { gte: 1_794_999_999 });
  assert.equal(eventsBody({ mint: A.MINT, paginationToken: "380000007:3" }).paginationToken, "380000007:3");
  assert.equal(EVENTS_SCAN_BUDGET <= 3_000, true, "a call costs at most 13 credits");
});

test("one answer → the fee payers' trades of the coin, priced from what moved the other way", () => {
  const page = tradesOfEvents(first, A.MINT, PRICING);
  assert.equal(page.next, "380000007:3");
  assert.equal(page.stoppedOn, "limit");
  assert.equal(page.scanned, 140);
  assert.equal(page.credits, 11);
  assert.deepEqual(page.trades.map((t) => [t.signature.slice(-1), t.side, t.wallet]), [
    ["1", "buy", A.BUYER],
    ["2", "buy", A.PUMPER],
    ["3", "sell", A.BUYER],
  ], "a plain transfer, an unparsed item and a failed transaction are no trades; a swap without a price is no row");

  const [jupiter, curve, usdc] = page.trades;
  /* Paid 2 wrapped SOL and a 0.0001 SOL tip; the 2 SOL into its own wrapped account is the wrapping, not a payment. */
  assert.equal(jupiter.tokenAmount, 1_000_000);
  assert.ok(close(jupiter.usd, 2.0001 * 150));
  assert.ok(close(jupiter.priceUsd, (2.0001 * 150) / 1_000_000));
  assert.ok(close(jupiter.capUsd, jupiter.priceUsd * 1_000_000_000));
  assert.equal(jupiter.feeSol, 0.000105);
  assert.equal(jupiter.at, new Date((1_795_000_000 - 10) * 1000).toISOString());
  /* Paid the curve 0.5 SOL and its fee 0.005; the rent of its own new coin account is left out. */
  assert.equal(curve.tokenAmount, 250_000);
  assert.ok(close(curve.usd, 0.505 * 150));
  assert.equal(curve.feeSol, 0.000005);
  /* Sold for 120 USDC: dollars as they moved. */
  assert.equal(usdc.usd, 120);
  assert.ok(close(usdc.priceUsd, 120 / 400_000));
  /* A swap by Helius's summary whose payment is not in the transaction: never a row with dashes, never a guess — set aside for the pools' trades to price. */
  assert.deepEqual(page.unpriced.map((u) => [u.signature.slice(-1), u.side, u.wallet, u.tokenAmount, u.why]), [["5", "sell", A.PUMPER, 50_000, "no-payment"]]);
  assert.ok(page.trades.every(isWholeTrade));
});

test("without SOL's price a SOL trade is no row; a stock's amounts read in the unit the wallet shows", () => {
  const page = tradesOfEvents(first, A.MINT, { capSupply: null, multiplier: null, solPriceUsd: null });
  assert.deepEqual(page.trades.map((t) => t.signature.slice(-1)), ["3"], "only the trade paid in dollars has a price");
  assert.equal(page.trades[0].usd, 120, "a stable side needs no price");
  assert.equal(page.trades[0].capUsd, null, "no supply, no capitalisation");
  assert.deepEqual(page.unpriced.map((u) => [u.signature.slice(-1), u.why]), [["1", "no-sol-price"], ["2", "no-sol-price"], ["5", "no-payment"]]);
  const scaled = tradesOfEvents(first, A.MINT, { ...PRICING, multiplier: 1.25 });
  assert.equal(scaled.trades[2].tokenAmount, 500_000);
  assert.ok(close(scaled.trades[2].priceUsd, 120 / 500_000));
});

test("an answer that is not the published shape is malformed, never a short list", () => {
  assert.throws(() => tradesOfEvents(null, A.MINT, PRICING), EventsMalformed);
  assert.throws(() => tradesOfEvents({ data: {}, scan: {} }, A.MINT, PRICING), EventsMalformed);
  assert.throws(() => tradesOfEvents({ data: [] }, A.MINT, PRICING), EventsMalformed, "no scan summary");
  const empty = tradesOfEvents(budgetStop, A.MINT, PRICING);
  assert.deepEqual(empty.trades, []);
  assert.equal(empty.next, "379990000:0", "an empty page with a cursor is «read on», not «no trades»");
  assert.equal(tradeOfParsed("x", { transactionStatus: "OK", feePayer: "not an address", blockTime: 1 }, A.MINT, PRICING), null);
});

test("a refresh merges onto the list read before: newest first, no trade twice", () => {
  const older = tradesOfEvents(first, A.MINT, PRICING).trades;
  const newer = [{ ...older[0], signature: "9".repeat(87), at: new Date(1_795_000_100_000).toISOString() }, older[0]];
  const merged = mergeTrades(newer, older, 300);
  assert.equal(merged.length, older.length + 1);
  assert.equal(merged[0].signature, "9".repeat(87));
  assert.equal(mergeTrades(newer, older, 2).length, 2);
});

function scripted(pages) {
  const bodies = [];
  const fetch = async (url, init) => {
    bodies.push({ url, body: JSON.parse(init.body) });
    const page = pages[bodies.length - 1];
    if (!page) throw new Error(`no page ${bodies.length}`);
    if (page.status) return new Response(page.text ?? "{}", { status: page.status });
    return new Response(JSON.stringify(page), { status: 200 });
  };
  return { fetch, bodies };
}

test("a first read follows the cursor until the history ends: the list is whole", async () => {
  resetTokenEvents();
  const { fetch, bodies } = scripted([first, last]);
  const read = await readMintTradeEvents(A.MINT, PRICING, null, { fetch, endpoint: ENDPOINT });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].body.paginationToken, "380000007:3");
  assert.equal(read.whole, true);
  assert.equal(read.calls, 2);
  assert.equal(read.credits, 22);
  assert.equal(read.trades.length, 4);
  assert.equal(read.unpriced.length, 1, "the swap without a price stands beside the list, not in it");
  assert.equal(read.trades.at(-1).usd, 45, "0.3 wrapped SOL at $150");
});

test("a first read stops at its calls: the list is not whole; an empty budget page is followed", async () => {
  resetTokenEvents();
  const { fetch, bodies } = scripted([budgetStop, { ...budgetStop, paginationToken: "379980000:0" }, first, last]);
  const read = await readMintTradeEvents(A.MINT, PRICING, null, { fetch, endpoint: ENDPOINT });
  assert.equal(bodies.length, MAX_CALLS);
  assert.equal(read.whole, false);
  assert.equal(read.trades.length, 3);
  assert.equal(EVENTS_TRADES_TARGET, 300);
});

test("a refresh asks only for what is newer than the newest trade, and merges it", async () => {
  resetTokenEvents();
  const known = { trades: tradesOfEvents(last, A.MINT, PRICING).trades, whole: true };
  const { fetch, bodies } = scripted([{ ...first, paginationToken: undefined, scan: { ...first.scan, stoppedOn: "windowEnd" } }]);
  const read = await readMintTradeEvents(A.MINT, PRICING, known, { fetch, endpoint: ENDPOINT });
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].body.time, { gte: Math.floor(Date.parse(known.trades[0].at) / 1000) });
  assert.equal(read.trades.length, 4);
  assert.equal(read.unpriced.length, 1);
  assert.equal(read.whole, true, "nothing dropped: still the whole history");
  assert.equal(read.calls, 1);

  resetTokenEvents();
  const busy = scripted([first, first, last]);
  const reread = await readMintTradeEvents(A.MINT, PRICING, known, { fetch: busy.fetch, endpoint: ENDPOINT });
  assert.equal(busy.bodies.length, 3, "more than one page newer: read afresh");
  assert.equal("time" in busy.bodies[1].body, false);
  assert.equal(reread.whole, true);
});

test("a failure answers null, rests the scan a minute, and never says the key", async () => {
  resetTokenEvents();
  const before = tokenEventsStats().failures;
  const { fetch } = scripted([{ status: 500, text: `{"error":"boom ${KEY}"}` }]);
  assert.equal(await readMintTradeEvents(A.MINT, PRICING, null, { fetch, endpoint: ENDPOINT }), null);
  assert.equal(tokenEventsStats().failures, before + 1);
  let asked = false;
  const resting = await readMintTradeEvents(A.MINT, PRICING, null, { fetch: async () => ((asked = true), new Response("{}")), endpoint: ENDPOINT });
  assert.equal(resting, null);
  assert.equal(asked, false, "the scan rests: the page reads GeckoTerminal at once");
  resetTokenEvents();
  const malformed = scripted([{ data: "nope", scan: {} }]);
  assert.equal(await readMintTradeEvents(A.MINT, PRICING, null, { fetch: malformed.fetch, endpoint: ENDPOINT }), null);
  resetTokenEvents();
  const thrown = scripted([]);
  assert.equal(await readMintTradeEvents(A.MINT, PRICING, null, { fetch: thrown.fetch, endpoint: ENDPOINT }), null);
  resetTokenEvents();
  assert.equal(await readMintTradeEvents(A.MINT, PRICING, null, { endpoint: null }), null, "closed: nothing is asked");
  assert.equal(JSON.stringify(tokenEventsStats()).includes(KEY), false);
});

test("a day's ceiling of credits per instance: past it the scan is not asked and answers null, as when closed — until the next UTC day", async () => {
  resetTokenEvents();
  assert.equal(TOKEN_EVENTS_DAILY_ENV, "RYNTRA_SPOT_TOKEN_EVENTS_DAILY_CREDITS");
  assert.equal(TOKEN_EVENTS_DAILY_CREDITS, 20_000);
  const noon = Date.parse("2026-11-20T12:00:00.000Z");
  /* A ceiling of sixty credits: a first read's worst cost is three calls of thirteen. */
  const env = { [TOKEN_EVENTS_DAILY_ENV]: "60" };
  const one = scripted([first, last]);
  const read = await readMintTradeEvents(A.MINT, PRICING, null, { fetch: one.fetch, endpoint: ENDPOINT, env, now: () => noon });
  assert.equal(read.credits, 22);
  assert.equal(tokenEventsDaySpent(noon), 22, "what the answers said they cost, each call once");

  const capped = tokenEventsStats().capped;
  const failures = tokenEventsStats().failures;
  let asked = false;
  const refuse = async () => ((asked = true), new Response("{}"));
  assert.equal(await readMintTradeEvents(A.MINT, PRICING, null, { fetch: refuse, endpoint: ENDPOINT, env, now: () => noon + 1 }), null, "22 spent and 39 more would pass 60");
  assert.equal(asked, false, "nothing is asked of Helius: the page reads GeckoTerminal");
  assert.equal(tokenEventsStats().capped, capped + 1);
  assert.equal(tokenEventsStats().failures, failures, "a ceiling is not a failure, and the scan does not rest for it");
  const known = { trades: read.trades, whole: true };
  assert.equal(await readMintTradeEvents(A.MINT, PRICING, known, { fetch: refuse, endpoint: ENDPOINT, env, now: () => Date.parse("2026-11-20T23:59:59.999Z") }), null, "a refresh neither, to the day's last moment");
  assert.equal(asked, false);

  /* Midnight UTC: the day starts from nothing. */
  const midnight = Date.parse("2026-11-21T00:00:00.000Z");
  const next = scripted([first, last]);
  const again = await readMintTradeEvents(A.MINT, PRICING, null, { fetch: next.fetch, endpoint: ENDPOINT, env, now: () => midnight });
  assert.equal(again.trades.length, 4);
  assert.equal(tokenEventsDaySpent(midnight), 22);

  /* An answered call is paid for even when its answer cannot be read; a ceiling of nought closes the scan; a setting that is no number is the default. */
  resetTokenEvents();
  assert.equal(await readMintTradeEvents(A.MINT, PRICING, null, { fetch: scripted([{ data: "nope", scan: {} }]).fetch, endpoint: ENDPOINT, env, now: () => noon }), null);
  assert.equal(tokenEventsDaySpent(noon), 10);
  resetTokenEvents();
  assert.equal(await readMintTradeEvents(A.MINT, PRICING, null, { fetch: refuse, endpoint: ENDPOINT, env: { [TOKEN_EVENTS_DAILY_ENV]: "0" }, now: () => noon }), null);
  assert.equal(asked, false);
  const open = scripted([first, last]);
  assert.equal((await readMintTradeEvents(A.MINT, PRICING, null, { fetch: open.fetch, endpoint: ENDPOINT, env: { [TOKEN_EVENTS_DAILY_ENV]: "plenty" }, now: () => noon })).calls, 2);
  resetTokenEvents();
});

/* ------------------------------------------------------------------------------------------------------------------
 * On real records (`fixtures/token-events-chain.json`): mainnet transactions of 20.11.2026 in Helius's published shape,
 * each beside what the chain's own balances say changed for its trader. The switch stood closed in production because
 * a tape of the chain's events showed rows of «Buy — 0.000069 —»: every case below is one of those rows' causes.
 * ------------------------------------------------------------------------------------------------------------------ */

const chain = JSON.parse(readFileSync(new URL("./fixtures/token-events-chain.json", import.meta.url), "utf8"));
const R = chain.records;
const SOL_USD = 70;
const isWallet = (address) => {
  try {
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
};
const REAL = { capSupply: 1_000_000_000, multiplier: null, solPriceUsd: SOL_USD, isWallet };
const near = (a, b, share) => Math.abs(a - b) <= Math.abs(b) * share;
const read = (record, pricing = REAL, change = (parsed) => parsed) => readParsed(record.signature, change(record.parsed), chain.mints[record.coin], pricing);
const SWAP = { type: "swap", description: "", parsedData: null };

test("Helius's own published answer for a Jupiter swap reads as the buy it is", () => {
  const { signature, parsed } = chain.published;
  const trade = tradeOfParsed(signature, parsed, "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", REAL);
  assert.equal(trade.side, "buy");
  assert.equal(trade.wallet, "GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52");
  assert.equal(trade.tokenAmount, 64_672_839.26195);
  /* 1 500 SOL wrapped and paid; the wrapping into its own account and that account's closing are not payments. */
  assert.ok(close(trade.usd, 1_500 * SOL_USD));
  assert.equal(trade.feeSol, 0.002005);
});

test("a sale paid in USDT is priced in dollars — the mint named as USDT was not USDT's, so such a sale had no price", () => {
  assert.equal(USDT_MINT, "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
  assert.ok(R.usdtSale.parsed.tokenTransfers.some((t) => t.mint === USDT_MINT), "the chain's own mint of USDT");
  const { trade } = read(R.usdtSale);
  assert.equal(trade.side, "sell");
  assert.equal(trade.wallet, R.usdtSale.chain.wallet);
  assert.equal(trade.tokenAmount, -R.usdtSale.chain.coin);
  assert.ok(close(trade.usd, R.usdtSale.chain.dollars), "19.900299 USDT, as its balance says");
  assert.ok(isWholeTrade(trade));
});

test("a sale on pump.fun's curve takes its SOL from the curve's own record: no transfer shows it", () => {
  const record = R.curveSale;
  const wallet = record.chain.wallet;
  assert.equal(record.parsed.nativeTransfers.some((t) => t.toUserAccount === wallet), false, "nothing is transferred to the seller");
  assert.ok(record.chain.sol > 0.16, "yet its balance grew by the sale");
  const { trade } = read(record);
  assert.equal(trade.side, "sell");
  assert.equal(trade.wallet, wallet);
  assert.equal(trade.tokenAmount, -record.chain.coin);
  /* The curve's figure with its two fees off; the wallet's own balance is a router's cut lower. */
  assert.ok(near(trade.usd / SOL_USD, record.chain.sol, 0.01), `${trade.usd / SOL_USD} SOL against ${record.chain.sol}`);
  assert.ok(isWholeTrade(trade));
  /* Without the curve's record the sale has no price: it is set aside, never a row with dashes. */
  const bare = read(record, REAL, (parsed) => ({ ...parsed, instructions: [] }));
  assert.equal(bare.trade, undefined);
  assert.equal(bare.unpriced.why, "no-payment");
  assert.equal(tradeOfParsed(record.signature, { ...record.parsed, instructions: [] }, chain.mints.BEAST, REAL), null);
  /* And without Helius's word that it is a swap, tokens that left with nothing back are a transfer. */
  assert.equal(read(record, REAL, (parsed) => ({ ...parsed, instructions: [], summary: null })), null);
});

test("a buy on the curve is the curve's figure too; a pool's and a DBC curve's trades read from the wallet's transfers", () => {
  const buy = read(R.curveBuy).trade;
  assert.equal(buy.side, "buy");
  assert.ok(near(buy.usd / SOL_USD, -R.curveBuy.chain.sol, 0.01));
  for (const name of ["poolBuy", "poolSale", "dbcBuy"]) {
    const record = R[name];
    const { trade } = read(record);
    assert.equal(trade.wallet, record.chain.wallet, name);
    assert.equal(trade.side, record.chain.coin > 0 ? "buy" : "sell", name);
    assert.ok(near(trade.tokenAmount, Math.abs(record.chain.coin), 1e-9), name);
    assert.ok(near(trade.usd / SOL_USD, Math.abs(record.chain.sol), 1e-6), `${name}: ${trade.usd / SOL_USD} SOL against ${record.chain.sol}`);
    assert.ok(isWholeTrade(trade), name);
  }
  assert.equal(read(R.usdcBuy).trade.usd, 10, "ten USDC, as they moved");
});

test("a trade whose fee a relayer paid is its trader's — the fee payer holds none of the coin", () => {
  for (const name of ["relayedSale", "curveRelayedSale"]) {
    const record = R[name];
    assert.notEqual(record.parsed.feePayer, record.chain.wallet, name);
    const { trade } = read(record);
    assert.equal(trade.wallet, record.chain.wallet, `${name}: the wallet whose coin left`);
    assert.equal(trade.side, "sell", name);
    assert.equal(trade.tokenAmount, -record.chain.coin, name);
    assert.ok(close(trade.usd, record.chain.dollars), `${name}: paid out in USDC`);
    assert.equal(trade.feeSol, 0, `${name}: the trader paid no network fee`);
    /* Without knowing a wallet from a program's account only the fee payer is read: no trade, as before. */
    assert.equal(read(record, { ...REAL, isWallet: undefined }), null, name);
  }
  /* A pool's authority is no wallet: it is never taken for the trader. */
  const pools = new Set(R.relayedSale.parsed.tokenTransfers.flatMap((t) => [t.fromUserAccount, t.toUserAccount]).filter((a) => a && !isWallet(a)));
  assert.ok(pools.size > 0);
});

test("a bot's trade paid from its program's own account: no price of its own, or a price far off the market — never a row", () => {
  /* Its sale: the SOL went to the program's account. A transfer unless Helius calls it a swap — then set aside. */
  assert.equal(read(R.custodySale), null);
  const swap = read(R.custodySale, REAL, (parsed) => ({ ...parsed, summary: SWAP }));
  assert.equal(swap.trade, undefined);
  assert.equal(swap.unpriced.why, "no-payment");
  /* Its buy: 10.3 million tokens for the tip the wallet itself paid. This curve is priced in another coin, so the curve's own figure is not SOL and is not taken. */
  const buy = read(R.custodyBuy).trade;
  assert.equal(buy.tokenAmount, 10_319_031.132941);
  assert.ok(near(buy.usd / SOL_USD, 0.00155, 1e-6));

  /* Among its real neighbours that price stands hundreds of times under the market: it and the other bot buy leave the list. */
  const page = tradesOfEvents({ data: chain.run, scan: { stoppedOn: "limit", scannedTransactions: 13, matchedTransactions: 13, creditsCharged: 11 } }, chain.mints.HCAT, REAL);
  assert.equal(page.trades.length, 13);
  const { kept, off } = splitOffMarket(page.trades);
  assert.deepEqual(off.map((t) => t.signature.slice(0, 6)).sort(), ["64Adrk", "Fei1bd"]);
  assert.equal(kept.length, 11);
  const middle = kept.map((t) => t.priceUsd).sort((a, b) => a - b)[5];
  assert.ok(kept.every((t) => t.priceUsd < middle * 3 && t.priceUsd > middle / 3), "what stays stands with the market");
  assert.ok(off.every((t) => t.priceUsd < middle / 200));
  assert.equal(OFF_MARKET_FACTOR, 10);
});

test("the market's own moves are not taken for a wrong price", () => {
  const at = (n) => new Date(1_795_000_000_000 - n * 1000).toISOString();
  const t = (n, price) => ({ signature: `${"7".repeat(80)}${String(n).padStart(4, "0")}`, at: at(n), side: "buy", wallet: A.BUYER, tokenAmount: 10, usd: price * 10, priceUsd: price, capUsd: null });
  /* A collapse to a twentieth: every trade stands with its own side of it. */
  const crash = [...Array.from({ length: 6 }, (_, i) => t(i, 0.05)), ...Array.from({ length: 6 }, (_, i) => t(6 + i, 1))];
  assert.equal(splitOffMarket(crash).off.length, 0);
  /* One wild price among steady ones is off; at the list's newest edge its one side judges it. */
  const steady = Array.from({ length: 9 }, (_, i) => t(i, 1));
  steady[4] = t(4, 0.001);
  assert.deepEqual(splitOffMarket(steady).off.map((x) => x.priceUsd), [0.001]);
  assert.deepEqual(splitOffMarket([t(0, 500), ...steady.slice(5)]).off.map((x) => x.priceUsd), [500]);
  /* Too few neighbours to judge: nothing is taken out. */
  assert.equal(splitOffMarket([t(0, 500), t(1, 1), t(2, 1)]).off.length, 0);
});

test("a swap without a price takes the pool's price for the same trade, and keeps the chain's wallet", () => {
  const custody = read(R.custodyBuy).trade;
  const aside = [unpricedOf(custody, "off-market"), { ...unpricedOf(read(R.poolSale).trade, "no-payment"), signature: "6".repeat(87) }];
  const relayer = R.relayedSale.parsed.feePayer;
  const poolTokens = custody.tokenAmount * (1 + FILL_AMOUNT_SHARE / 2);
  const pool = { signature: custody.signature, at: custody.at, side: "buy", wallet: relayer, tokenAmount: poolTokens, usd: 8.7e-6 * poolTokens, priceUsd: 8.7e-6, capUsd: 8_700 };
  const { filled, left } = fillUnpriced(aside, [pool, { ...pool, side: "sell" }]);
  assert.equal(filled.length, 1);
  assert.equal(filled[0].wallet, custody.wallet, "the chain's trader, not the pool source's fee payer");
  assert.equal(filled[0].tokenAmount, custody.tokenAmount);
  assert.equal(filled[0].priceUsd, 8.7e-6);
  assert.ok(close(filled[0].usd, 8.7e-6 * custody.tokenAmount));
  assert.equal(filled[0].capUsd, 8_700);
  assert.equal(filled[0].feeSol, custody.feeSol);
  assert.equal("why" in filled[0], false);
  assert.ok(isWholeTrade(filled[0]));
  assert.equal(left.length, 1, "no pool's trade of that signature: not shown");
  /* The same signature with other tokens is another trade (a route's leg, an arbitrage's dust): it prices nothing. */
  assert.equal(fillUnpriced(aside.slice(0, 1), [{ ...pool, tokenAmount: custody.tokenAmount / 2 }]).filled.length, 0);
  assert.equal(fillUnpriced(aside.slice(0, 1), [{ ...pool, usd: null, priceUsd: null }]).filled.length, 0, "a row without a price prices nothing");
});

test("coin that only passed through a wallet is no trade of the coin (a made-up record: a route's hop leaving dust)", () => {
  const hop = (kept) => ({
    slot: 1,
    blockTime: 1_795_000_000,
    fee: 5_000,
    feePayer: A.BUYER,
    transactionStatus: "OK",
    summary: SWAP,
    instructions: [],
    nativeTransfers: [{ fromUserAccount: A.BUYER, toUserAccount: A.POOL, amount: 1_000_000 }],
    tokenTransfers: [
      { fromUserAccount: A.POOL, toUserAccount: A.BUYER, fromTokenAccount: A.POOL_COIN, toTokenAccount: A.BUYER_COIN, rawTokenAmount: 1_000_000_000_000, decimals: 6, tokenStandard: "Fungible", mint: A.MINT },
      { fromUserAccount: A.BUYER, toUserAccount: A.POOL, fromTokenAccount: A.BUYER_COIN, toTokenAccount: A.POOL_COIN, rawTokenAmount: 1_000_000_000_000 - kept, decimals: 6, tokenStandard: "Fungible", mint: A.MINT },
    ],
  });
  assert.equal(readParsed("5".repeat(87), hop(69), A.MINT, PRICING), null, "0.000069 of a million left behind");
  assert.equal(readParsed("5".repeat(87), hop(1_000_000_000_000 * PASS_THROUGH_SHARE - 1), A.MINT, PRICING), null);
  assert.equal(readParsed("5".repeat(87), hop(500_000_000_000), A.MINT, PRICING).trade.tokenAmount, 500_000, "half of it kept is a buy");
});

test("a read sets aside what is off the market; a refresh judges only what it brought — a trade the list keeps is not judged again", async () => {
  /* The real run, read whole: the two bot buys leave the list and stand beside it. */
  resetTokenEvents();
  const run = { data: chain.run, scan: { stoppedOn: "windowEnd", scannedTransactions: 13, matchedTransactions: 13, creditsCharged: 11 } };
  const whole = await readMintTradeEvents(chain.mints.HCAT, REAL, null, { fetch: scripted([run]).fetch, endpoint: ENDPOINT });
  assert.equal(whole.trades.length, 11);
  assert.equal(whole.refreshed, false);
  assert.deepEqual(whole.unpriced.map((u) => [u.signature.slice(0, 6), u.why]).sort(), [["64Adrk", "off-market"], ["Fei1bd", "off-market"]]);
  assert.ok(whole.trades.every(isWholeTrade));

  /* A list read before that keeps a trade far from its neighbours — a pool's trade priced it then. The refresh leaves it be. */
  resetTokenEvents();
  const before = tradesOfEvents(last, A.MINT, PRICING).trades[0];
  const older = (n, usd) => ({ ...before, signature: `${"8".repeat(86)}${n}`, at: new Date(Date.parse(before.at) - n * 1000).toISOString(), usd, priceUsd: usd / before.tokenAmount });
  const known = { trades: [older(1, before.usd), older(2, before.usd * 100), older(3, before.usd), older(4, before.usd), older(5, before.usd), older(6, before.usd)], whole: false };
  const fresh = scripted([{ ...first, paginationToken: undefined, scan: { ...first.scan, stoppedOn: "windowEnd" } }]);
  const read = await readMintTradeEvents(A.MINT, PRICING, known, { fetch: fresh.fetch, endpoint: ENDPOINT });
  assert.equal(read.refreshed, true);
  assert.equal(read.trades.length, 3 + 6);
  assert.ok(read.trades.some((t) => t.signature === known.trades[1].signature), "kept as it was");
  assert.deepEqual(read.unpriced.map((u) => u.why), ["no-payment"], "only the page's own swap without a price");
  resetTokenEvents();
});

test("every row of the real records is whole: a price, a size and dollars — or it is not a row", () => {
  const all = [...Object.values(R), ...chain.run];
  let rows = 0;
  for (const record of all) {
    for (const summary of [record.parsed.summary, SWAP]) {
      const reading = read(record, REAL, (parsed) => ({ ...parsed, summary }));
      const trade = tradeOfParsed(record.signature, { ...record.parsed, summary }, chain.mints[record.coin], REAL);
      assert.equal(trade?.signature, reading?.trade?.signature);
      if (!trade) continue;
      rows += 1;
      assert.ok(isWholeTrade(trade), record.signature);
      assert.ok(trade.capUsd > 0);
    }
  }
  assert.ok(rows >= 40);
});
