/**
 * The ticket of a stock's DLMM pool put in with two coins, apart from the markup: the second amount at
 * the pool's price, the wallet against both coins and the SOL kept aside, the engine's request, the Review's figures, the
 * screen's switch, the refusals' words — and the words themselves, a person's, in both languages. No network.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EARN } from "../../earn/words.ts";
import { dlmmStocksScreen, stockTicketShown } from "./flag.ts";
import { followOf, NO_TYPED, quoteSymbol, stockAddBody, stockChoice, stockFigures, stockRange, typedAfter } from "./model.ts";
import { noticeWord } from "./notice.ts";
import { DLMM_STOCK } from "./words.ts";

const ANT = "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const PERSON = "8dRtxg5xzetRyzYjyWPhcLMAVdyhbPpJo1u1J87Fh9XL";
const POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";

const read = (over = {}) => ({
  pool: POOL,
  stock: { mint: ANT, symbol: "ANT", issuer: "Backpack Securities", side: "x", decimals: 6 },
  quote: { kind: "usdc", mint: USDC, decimals: 6 },
  price: 95,
  binStepBps: 20,
  activeBin: 2280,
  paused: false,
  add: "on",
  stopped: false,
  ...over,
});
const balance = (raw) => ({ spendableRaw: String(raw), raw: String(raw) });
const holdings = ({ ant = 2_000_000n, usdc = 300_000_000n, sol = 200_000_000n } = {}) => ({
  owner: PERSON,
  sol: balance(sol),
  tokens: new Map([
    [ANT, balance(ant)],
    [USDC, balance(usdc)],
  ]),
  complete: true,
});

test("the second amount follows the first at the pool's price — the same worth of each, either way", () => {
  assert.equal(followOf(read(), "stock", "1"), "95");
  assert.equal(followOf(read(), "quote", "95"), "1");
  assert.equal(followOf(read(), "quote", "100"), "1.0526");
  assert.equal(followOf(read({ price: 0.62, quote: { kind: "sol", mint: SOL, decimals: 9 } }), "stock", "2"), "1.24");
  assert.equal(followOf(read(), "stock", ""), "");
  assert.equal(followOf(read(), "stock", "abc"), "");
  assert.deepEqual(typedAfter(read(), "quote", "190"), { stock: "2", quote: "190", lead: "quote" });
});

test("the wallet against both coins: short of the stock, of the other coin, of SOL for the position's deposit — and fits", () => {
  const typed = typedAfter(read(), "stock", "1");
  const fits = stockChoice(read(), PERSON, typed, holdings(), "even", "balanced");
  assert.equal(fits.problem, null);
  assert.equal(fits.x, "1000000", "ANT is X: its units go to X");
  assert.equal(fits.y, "95000000");
  assert.match(fits.key, /^dlmm-stock:/);
  assert.equal(stockChoice(read(), PERSON, typed, holdings({ ant: 999_999n }), "even", "balanced").problem, "stock");
  assert.equal(stockChoice(read(), PERSON, typed, holdings({ usdc: 94_000_000n }), "even", "balanced").problem, "quote");
  assert.equal(stockChoice(read(), PERSON, typed, holdings({ sol: 10_000_000n }), "even", "balanced").problem, "sol");
  assert.equal(stockChoice(read(), PERSON, NO_TYPED, holdings(), "even", "balanced").problem, "format");
  assert.equal(stockChoice(read(), PERSON, typed, null, "even", "balanced").problem, null, "a wallet not read fits: the engine has the last word");
  assert.equal(stockChoice(read(), null, typed, holdings(), "even", "balanced").key, null, "no wallet, no Review");
  /* A SOL pool: the SOL that goes in and the SOL kept aside come from one balance. */
  const solPool = read({ price: 0.62, quote: { kind: "sol", mint: SOL, decimals: 9 } });
  const both = typedAfter(solPool, "stock", "1");
  assert.equal(stockChoice(solPool, PERSON, both, holdings({ sol: 700_000_000n }), "even", "balanced").problem, null);
  assert.equal(stockChoice(solPool, PERSON, both, holdings({ sol: 650_000_000n }), "even", "balanced").problem, "quote");
  /* The stock on Y: the units change sides. */
  const flipped = stockChoice(read({ stock: { ...read().stock, side: "y" } }), PERSON, typed, holdings(), "even", "balanced");
  assert.equal(flipped.x, "95000000");
  assert.equal(flipped.y, "1000000");
});

test("the request is the engine's own add: a new position around the price, the goal's shape and the width's bins", () => {
  const choice = stockChoice(read(), PERSON, typedAfter(read(), "stock", "1"), holdings(), "near", "dense");
  assert.deepEqual(stockAddBody(read(), PERSON, choice, "near", "dense"), {
    action: "add",
    venue: "meteora-dlmm",
    range: { place: "around", half: 5 },
    request: { pool: POOL, owner: PERSON, amountX: "1000000", amountY: "95000000", shape: "curve", slippageBps: 100 },
  });
  assert.equal(stockAddBody(read(), PERSON, choice, "edges", "calm").range.half, 34);
  assert.equal(stockAddBody(read(), PERSON, choice, "edges", "calm").request.shape, "bid_ask");
  const counted = stockRange(read(), "balanced");
  assert.ok(counted.low < 95 && counted.high > 95);
  assert.ok(Math.abs(counted.upPct - (1.002 ** 16 - 1) * 100) < 1e-9);
});

test("the Review's figures: each coin that goes in, the range in the other coin per stock, the deposit that comes back and the space that does not", () => {
  const review = {
    preview: {
      action: "add",
      range: { kind: "bins", lowerPrice: "88.0", upperPrice: "102.5" },
      deposit: { x: { asset: ANT, units: "1050000", decimals: 6 }, y: { asset: USDC, units: "100000000", decimals: 6 } },
      rent: [
        { what: "position", direction: "pay", lamports: "57000000", refundable: true },
        { what: "bin_arrays", direction: "pay", lamports: "71000000", refundable: false },
      ],
    },
    transactions: [{ wireBase64: "AA==", presigned: [] }],
    networkFeeLamports: "15000",
  };
  const figures = stockFigures(review, read());
  assert.deepEqual(figures.goesIn, ["1.05 ANT", "100 USDC"]);
  assert.equal(figures.low, 88);
  assert.equal(figures.high, 102.5);
  assert.equal(figures.depositBack, 57_000_000n);
  assert.equal(figures.kept, 71_000_000n);
  assert.equal(figures.network, 15_000n);
  assert.equal(figures.reserve, 128_015_000n);
  assert.equal(figures.transactions, 1);
  /* The stock on Y: the pool says ANT per USDC — the range is turned to USDC per ANT. */
  const flipped = stockFigures({ ...review, preview: { ...review.preview, range: { kind: "bins", lowerPrice: "0.0098", upperPrice: "0.0112" }, deposit: { x: review.preview.deposit.y, y: review.preview.deposit.x } } }, read({ stock: { ...read().stock, side: "y" } }));
  assert.ok(Math.abs(flipped.low - 1 / 0.0112) < 1e-9 && Math.abs(flipped.high - 1 / 0.0098) < 1e-9);
  assert.deepEqual(flipped.goesIn, ["1.05 ANT", "100 USDC"]);
  assert.equal(quoteSymbol(read({ quote: { kind: "sol", mint: SOL, decimals: 9 } })), "SOL");
});

test("the screen's switch: off unless open or canary exactly; canary stands the ticket only where this wallet may add", () => {
  assert.equal(dlmmStocksScreen(undefined), "off");
  assert.equal(dlmmStocksScreen("OPEN"), "off");
  assert.equal(dlmmStocksScreen("open"), "open");
  assert.equal(dlmmStocksScreen("canary"), "canary");
  assert.equal(stockTicketShown("off", read()), false);
  assert.equal(stockTicketShown("open", read({ add: "off" })), true, "open: the form stands and says it is closed to this wallet");
  assert.equal(stockTicketShown("canary", read({ add: "off" })), false, "canary: a stranger sees the page as it was");
  assert.equal(stockTicketShown("canary", read()), true);
  assert.equal(stockTicketShown("open", null), false);
});

test("a refusal in the ticket's words: the stock's own for the door, Earn's for the rest, «nothing was sent» for any other", () => {
  assert.deepEqual(noticeWord("DLMM_STOCKS_CLOSED"), { book: "stock", key: "closed" });
  assert.deepEqual(noticeWord("ACTIONS_CLOSED"), { book: "stock", key: "closed" });
  assert.deepEqual(noticeWord("DLMM_STOCK_PAUSED"), { book: "stock", key: "paused" });
  assert.deepEqual(noticeWord("FRESH"), { book: "earn", key: "fresh" });
  assert.deepEqual(noticeWord("SIMULATION_FAILED"), { book: "earn", key: "fRefused" });
  assert.deepEqual(noticeWord("WHATEVER"), { book: "earn", key: "notSent" });
  for (const code of ["FRESH", "DLMM_STOCKS_STOPPED", "DLMM_STOCK_PAIR", "UNAVAILABLE", "SIMULATION_FAILED", "PREVIEW_EXPIRED", "WALLET_REFUSED", "WALLET_MISMATCH", "RATE_LIMITED", "X"]) {
    const said = noticeWord(code);
    for (const lang of ["en", "uk"]) assert.equal(typeof (said.book === "stock" ? DLMM_STOCK[lang][said.key] : EARN[lang][said.key]), "string", `${code} ${lang}`);
  }
});

test("the words: both languages, the same keys, a person's — no word of the token program, no promise of income, no campaign", () => {
  assert.deepEqual(Object.keys(DLMM_STOCK.en).sort(), Object.keys(DLMM_STOCK.uk).sort());
  for (const lang of ["en", "uk"]) {
    const w = DLMM_STOCK[lang];
    const all = Object.values(w).map((value) => (typeof value === "function" ? value("ANT") : value)).join(" ");
    assert.doesNotMatch(all, /Token-?2022|delegate|делегат|hook|хук|extension|розширенн|\bmint\b|мінт|\bbin\b|бін|tick|тік|lamport|API|engine|двигун|APY|APR|guarantee|гарант|x1000|bounty|LP Army|\$\s?\d/i, lang);
  }
});

test("the ticket draws the stock's line and the exchange's state, one amber action, and the pool page mounts it behind its switch only", () => {
  const strip = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const ticket = strip("./DlmmStockTicket.tsx");
  assert.match(ticket, /<StockPositionLine mint=\{read\.stock\.mint\} issuer=\{read\.stock\.issuer\} facts=\{given\} \/>/);
  assert.match(ticket, /\{head \? <StockPoolFacts mint=\{read\.stock\.mint\} facts=\{given\} \/> : null\}/);
  assert.match(ticket, /head = true/, "alone — a stand — the ticket carries the exchange's state itself");
  assert.equal((ticket.match(/<Action /g) ?? []).length, 2, "one amber action on the form, one on an unknown outcome");
  const side = strip("../../pool/PoolSide.tsx");
  assert.match(side, /if \(stock\.read\) return <DlmmStockTicket read=\{stock\.read\} onConnect=\{connect\} head=\{false\} \/>;/);
  /* The pool's page draws the exchange's state over its «Position» tab itself, so there it stands once, not twice. */
  assert.match(side, /tab === 'position' \? \(\s*<>\s*(?:\{[^}]*\}\s*)?<StockPoolFacts mint=\{coin\.mint\} \/>/);
  const hook = strip("./useDlmmStockPool.ts");
  assert.match(hook, /DLMM_STOCKS_SCREEN !== 'off' && pool\.venue === 'dlmm'/, "off, the page asks nothing");
});
