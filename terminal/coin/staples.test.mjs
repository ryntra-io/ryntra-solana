import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SOL, USDC } from "../../city/lib/trade/tiles.ts";
import { sumText } from "../ui/figures.ts";
import { MAIN_MINTS, MONEY, USDC_LOGO, USDT, USDT_MINT, coinLogo, inMainOrder, paidRows, payLogo, payRows, quickSums, saleMoney, spotLogo } from "./staples.ts";

/* The Spot desk pays with any coin: SOL, USDC and USDT always, the wallet's coins beside them, a logo on each. */

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const coin = (mint, symbol, spendableRaw, icon = null) => ({ asset: { mint, symbol, decimals: 6, icon }, spendableRaw });
const mints = (rows) => rows.map((asset) => asset.mint);

test("a buy is paid with SOL, USDC or USDT — never the coin bought — and Tether is a dollar of six decimals", () => {
  assert.equal(USDT.mint, "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
  assert.equal(USDT.decimals, 6);
  assert.deepEqual(mints(MONEY), [SOL.mint, USDC.mint, USDT_MINT]);
  assert.deepEqual(mints(payRows({ towerMint: JUP, held: [], picked: SOL })), [SOL.mint, USDC.mint, USDT_MINT]);
  assert.deepEqual(mints(payRows({ towerMint: SOL.mint, held: [], picked: USDC })), [USDC.mint, USDT_MINT], "the SOL desk is paid in dollars");
  assert.deepEqual(mints(payRows({ towerMint: USDT_MINT, held: [], picked: SOL })), [SOL.mint, USDC.mint]);
});

test("the wallet's coins with something to spend follow the money, each once; an empty balance or the coin bought is not offered", () => {
  const held = [coin(BONK, "BONK", "1500000"), coin(WIF, "WIF", "0"), coin(USDT_MINT, "USDT", "9000000"), coin(JUP, "JUP", "42"), coin("bad", "X", "-1")];
  assert.deepEqual(mints(payRows({ towerMint: JUP, held, picked: SOL })), [SOL.mint, USDC.mint, USDT_MINT, BONK]);
  // No more than the list allows.
  const many = Array.from({ length: 20 }, (_, i) => coin(`M${i}`, `C${i}`, "1"));
  assert.equal(payRows({ towerMint: JUP, held: many, picked: SOL, most: 4 }).length, 3 + 4);
  // A coin kept from the Swap screen stays in the list it was picked from.
  const kept = { mint: WIF, symbol: "WIF", decimals: 6, icon: null };
  assert.deepEqual(mints(payRows({ towerMint: JUP, held: [], picked: kept })), [SOL.mint, USDC.mint, USDT_MINT, WIF]);
});

test("a sale is paid in SOL, USDC or USDT on choice", () => {
  assert.deepEqual(mints(paidRows(JUP, SOL)), [SOL.mint, USDC.mint, USDT_MINT]);
  assert.deepEqual(mints(paidRows(SOL.mint, USDC)), [USDC.mint, USDT_MINT]);
  assert.deepEqual(mints(paidRows(JUP, USDT)), [SOL.mint, USDC.mint, USDT_MINT], "Tether picked is not listed twice");
});

test("quick sums are in what pays: tenths of SOL, or dollars in USDC and USDT; another coin has its shares only", () => {
  assert.deepEqual(quickSums(SOL.mint), { sums: ["0.1", "0.5", "1", "5"], dollars: false });
  assert.deepEqual(quickSums(USDC.mint), { sums: ["10", "50", "100", "500"], dollars: true });
  assert.deepEqual(quickSums(USDT_MINT), quickSums(USDC.mint));
  assert.equal(quickSums(BONK), null);
});

test("a buy turned into a sale is paid in money: a wallet coin picked to pay with gives way to SOL, or USDC on the SOL desk", () => {
  assert.equal(saleMoney(JUP, BONK), SOL);
  assert.equal(saleMoney(SOL.mint, BONK), USDC);
  assert.equal(saleMoney(JUP, USDT_MINT), null, "Tether is money: it stays");
  assert.equal(saleMoney(JUP, USDC.mint), null);
  // The pick is the trade card's own; the turn is caught in the beat the side changes, however it changed, never under
  // a signature (the market's or a limit's), and a buy gets its coin back while the wallet holds it.
  const ticket = read("./Ticket.tsx");
  assert.match(ticket, /const pickPay = \(asset: PayAsset\): void => useTrade\.getState\(\)\.pickCoin\(asset\);/);
  assert.match(ticket, /return useTrade\.subscribe\(\(card, was\) => \{/);
  assert.match(ticket, /if \(!SPOT_IDLE\.has\(useSpot\.getState\(\)\.phase\)\) return;/);
  assert.match(ticket, /const money = saleMoney\(tower\.mint, pay\.mint\);/);
  assert.match(ticket, /pay\.mint === back\.money && held && held\.spendableRaw !== '0'\) pickPay\(back\.coin\);/);
});

test("every coin of the lists wears a logo address; a letter stands only where the engine answers it has none", () => {
  assert.equal(payLogo(USDC), USDC_LOGO);
  assert.equal(payLogo(SOL), `/api/icon/${SOL.mint}`);
  assert.equal(payLogo(USDT), `/api/spot/icon?mint=${USDT_MINT}`);
  assert.equal(payLogo({ mint: BONK, icon: null }), spotLogo(BONK));
  assert.equal(payLogo({ mint: BONK, icon: "/api/spot/icon?mint=x&u=y" }), "/api/spot/icon?mint=x&u=y");
  // The coin's own logo where an amount is written in it: the market's address through the engine, never a bare URL.
  assert.equal(coinLogo({ mint: JUP, icon: "https://static.jup.ag/jup/icon.png" }), `/api/spot/icon?mint=${JUP}&u=${encodeURIComponent("https://static.jup.ag/jup/icon.png")}`);
  assert.equal(coinLogo({ mint: JUP, icon: `/api/icon/${JUP}` }), `/api/icon/${JUP}`);
  assert.equal(coinLogo({ mint: JUP, icon: null }), spotLogo(JUP));
  assert.equal(coinLogo({ mint: JUP, icon: "http://insecure.example/x.png" }), spotLogo(JUP));
});

test("«Main» names the money first, then the coins people trade most, each a Solana mint once", () => {
  assert.deepEqual(MAIN_MINTS.slice(0, 3), [SOL.mint, USDC.mint, USDT_MINT]);
  for (const mint of ["J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", JUP, BONK, WIF, "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL", "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3"]) {
    assert.ok(MAIN_MINTS.includes(mint), mint);
  }
  assert.equal(new Set(MAIN_MINTS).size, MAIN_MINTS.length);
  assert.ok(MAIN_MINTS.every((mint) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)));
  assert.ok(MAIN_MINTS.length <= 50, "the Market's read of named coins takes fifty at most");
  // The read's rows in the list's order; a coin the read did not bring is not guessed.
  const rows = [{ id: BONK }, { id: "other" }, { id: USDC.mint }, { id: SOL.mint }];
  assert.deepEqual(inMainOrder(rows).map((row) => row.id), [SOL.mint, USDC.mint, BONK]);
});

test("a trade worth less than a dollar is «<$1» in the trades, never «$0»", () => {
  assert.equal(sumText(0.12, "en"), "<$1");
  assert.equal(sumText(0.7, "en"), "$1");
  assert.equal(sumText(18, "uk"), "$18");
  assert.equal(sumText(0, "en"), "$0");
  assert.match(read("./Tape.tsx"), /sumText\(trade\.usd, lang\)/);
  assert.match(read("./MarketTabs.tsx"), /sumText\(trade\.usd, lang\)/);
  assert.match(read("./MarketTabs.tsx"), /sumText\(Math\.abs\(trader\.net\), lang\)/);
});

test("the ticket's lists and the picker ask their logos at once, and the picker opens on «Main»", () => {
  const ticket = read("./Ticket.tsx");
  assert.match(ticket, /payRows\(\{ towerMint: tower\.mint/);
  assert.match(ticket, /paidRows\(tower\.mint, choice\.pay\)/);
  assert.match(ticket, /<CoinLogo src=\{payLogo\(asset\)\} symbol=\{symbol\} size="s" eager \/>/);
  // What a sale is paid in stands whatever the price does — not only once a figure came.
  assert.match(ticket, /\{side === 'sell' \? \(\s*<span className=\{s\.anchor\} ref=\{paidBox\}>/);
  const head = read("./CoinHead.tsx");
  assert.match(head, /useState<PickTab>\('main'\)/);
  assert.match(head, /return MONEY\.map\(/, "«Main» without its read still shows the money");
  // A search never offers a «USDT» that is not Tether's, nor a coin Jupiter marks suspicious.
  assert.match(head, /row\.symbol && !row\.isSuspicious && !lookalikeOf\(row\.symbol, row\.mint\)/);
  assert.match(head, /size="m" eager \/>/);
  assert.match(read("../ui/CoinLogo.tsx"), /loading=\{eager \? 'eager' : 'lazy'\}/);
  // The limit's price is written in the coin paid with, wearing its logo.
  assert.match(read("./LimitStop.tsx"), /asset=\{\{ symbol: unit, icon: payLogo\(choice\.pay\) \}\}/);
});
