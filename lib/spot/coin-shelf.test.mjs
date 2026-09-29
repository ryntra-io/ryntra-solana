import assert from "node:assert/strict";
import test from "node:test";

import { coinShelf, memeShelf, USDC_MINT, USDT_MINT } from "./coin-shelf.ts";

/**
 * Dollars and crypto on «Простий»'s Markets (canon v5.0 §3): the two dollar
 * tokens in the canon's order, and the venue's verified crypto by the day's
 * volume — never a meme, never a suspicious token, never a dollar again.
 */

const SOL = "So11111111111111111111111111111111111111112";

function listRow({ mint, symbol, name = symbol, category = "crypto", verified = true, suspicious = false, price = 1, volume = 1 }) {
  return { mint, symbol, name, icon: null, decimals: 6, tokenProgram: null, price, change24hPct: 0.5, volume24hUsd: volume, liquidityUsd: 1, verified, suspicious, category, issuer: null };
}

test("dollars are USDC then USDT, and crypto is verified crypto by the day's volume", () => {
  const rows = [
    listRow({ mint: USDT_MINT, symbol: "USDT", volume: 900 }),
    listRow({ mint: USDC_MINT, symbol: "USDC", volume: 1_000 }),
    listRow({ mint: SOL, symbol: "SOL", name: "Wrapped SOL", price: 200, volume: 800 }),
    listRow({ mint: "JUPmint", symbol: "JUP", name: "Jupiter", volume: 300 }),
    listRow({ mint: "BONKmint", symbol: "BONK", category: "meme", volume: 5_000 }),
    listRow({ mint: "FAKEmint", symbol: "FAKE", suspicious: true, volume: 9_000 }),
    listRow({ mint: "UNVmint", symbol: "UNV", verified: false, volume: 9_000 }),
    listRow({ mint: "USDEmint", symbol: "USDe", volume: 7_000 }),
    listRow({ mint: "NOPRICE", symbol: "NOP", price: null, volume: 7_000 }),
  ];
  const shelf = coinShelf(rows);
  assert.deepEqual(shelf.dollars.map((coin) => coin.symbol), ["USDC", "USDT"]);
  assert.deepEqual(shelf.crypto.map((coin) => coin.symbol), ["SOL", "JUP"]);
  /* SOL is named the way people know it, not as its wrapped form. */
  assert.equal(shelf.crypto[0].name, "Solana");
});

test("a dollar token the venue did not price is not a card", () => {
  const shelf = coinShelf([listRow({ mint: USDC_MINT, symbol: "USDC", price: null })]);
  assert.deepEqual(shelf.dollars, []);
});

test("memes are the venue's verified memes by the day's volume — never a suspicious one, never crypto, never twice", () => {
  const rows = [
    listRow({ mint: "WIFmint", symbol: "WIF", category: "meme", volume: 400 }),
    listRow({ mint: "BONKmint", symbol: "BONK", category: "meme", volume: 900 }),
    listRow({ mint: "BONKmint", symbol: "BONK", category: "meme", volume: 900 }),
    listRow({ mint: "RUGmint", symbol: "RUG", category: "meme", suspicious: true, volume: 9_000 }),
    listRow({ mint: "UNVmint", symbol: "UNV", category: "meme", verified: false, volume: 9_000 }),
    listRow({ mint: "NOPmint", symbol: "NOP", category: "meme", price: null, volume: 9_000 }),
    listRow({ mint: "JUPmint", symbol: "JUP", name: "Jupiter", volume: 5_000 }),
  ];
  assert.deepEqual(memeShelf(rows).map((coin) => coin.symbol), ["BONK", "WIF"]);
});
