import assert from "node:assert/strict";
import test from "node:test";

import { MOVER_MIN_VOLUME_USD, MOVER_POOL, moversOf } from "./movers.ts";

/**
 * «Що рухається сьогодні» on Home: the biggest moves of the day among the
 * companies and the crypto Markets draws — only from the head of each list by
 * volume, never a meme or a dollar, never an unknown change.
 */

const card = (name, ticker, change24h, price = 10) => ({ name, ticker, mint: `${ticker}-mint`, icon: null, price, change24h, volume24h: 1, issuer: "xstocks" });
const coin = (name, symbol, change24h, price = 1, volume24h = 10_000_000) => ({ name, symbol, mint: `${symbol}-mint`, icon: null, price, change24h, volume24h });

const index = (overrides = {}) => ({
  companies: [card("NVIDIA", "NVDAx", -2.1), card("Meta", "METAx", 4.1), card("Gold", "GLDx", 0.2)],
  privateCompanies: [card("OpenAI", "OPENAI", 30)],
  coins: [coin("Solana", "SOL", 2.5), coin("Zcash", "ZEC", -6.3)],
  memes: [coin("Bonk", "BONK", 90)],
  dollars: [coin("USD Coin", "USDC", 0.01)],
  ...overrides,
});

test("the biggest moves first, up or down, companies and crypto together", () => {
  const movers = moversOf(index(), 4);
  assert.deepEqual(movers.map((mover) => [mover.symbol, mover.kind]), [["ZEC", "crypto"], ["METAx", "company"], ["SOL", "crypto"], ["NVDAx", "company"]]);
  assert.equal(movers[1].href, "/app/stocks/METAx");
  assert.equal(movers[0].href, "/app/spot?mint=ZEC-mint");
});

test("memes, private companies and dollars stay out", () => {
  const symbols = moversOf(index(), 10).map((mover) => mover.symbol);
  for (const out of ["BONK", "OPENAI", "USDC"]) assert.equal(symbols.includes(out), false, out);
});

test("an unknown change or price is not a move", () => {
  const movers = moversOf(index({ companies: [card("Nothing", "NONEx", null), card("Free", "FREEx", 9, 0)], coins: [coin("Solana", "SOL", 1)] }), 5);
  assert.deepEqual(movers.map((mover) => mover.symbol), ["SOL"]);
});

test("only the head of each list by volume is looked at", () => {
  const quiet = Array.from({ length: MOVER_POOL }, (_, i) => card(`Quiet ${i}`, `Q${i}x`, 0.1));
  const movers = moversOf(index({ companies: [...quiet, card("Thin", "THINx", 80)], coins: [] }), 3);
  assert.equal(movers.some((mover) => mover.symbol === "THINx"), false);
});

test("a token on both lists is shown once", () => {
  const twin = { ...coin("Solana", "SOL", 3), mint: "same-mint" };
  const movers = moversOf(index({ companies: [{ ...card("Solana stock", "SOLx", 3), mint: "same-mint" }], coins: [twin] }), 5);
  assert.equal(movers.filter((mover) => mover.mint === "same-mint").length, 1);
});

test("a coin moves the market only if it trades — a thin token or one the meme list names is never a move", () => {
  const thin = coin("Doge Pepe", "DOPE", -30.7, 0.003, MOVER_MIN_VOLUME_USD - 1);
  const filed = coin("Bonk", "BONK", 40);
  const movers = moversOf(index({ coins: [coin("Solana", "SOL", 2.5), thin, filed], memes: [filed] }), 5);
  assert.deepEqual(movers.filter((mover) => mover.kind === "crypto").map((mover) => mover.symbol), ["SOL"]);
});

test("a mint already drawn beside the movers is skipped, and the move is looked for past it", () => {
  const movers = moversOf(index(), 4, new Set(["ZEC-mint", "METAx-mint"]));
  assert.deepEqual(movers.map((mover) => mover.symbol), ["SOL", "NVDAx", "GLDx"]);
});
