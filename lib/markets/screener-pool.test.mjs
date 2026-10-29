import assert from "node:assert/strict";
import test from "node:test";

import { farFromExchange, poolPriceOff, sortScreener } from "./screener.ts";

/* SOL-C5 (аудит UX 21.10, UX-155): a stock token priced by a thin pool never tops «Gainers», the hour or the price. */

const base = { icon: null, href: "/", change1h: null, marketCap: null, verified: true, suspicious: false, ageDays: null, organic: null, topHoldersPct: null, devPct: null, mintAuthorityOff: null, freezeAuthorityOff: null, issuer: null, period: null, markPremium: null, halted: false, tradable: true };
const stock = (symbol, price, change, volume, liquidity, deviation) => ({ ...base, kind: "stock", mint: symbol, symbol, name: symbol, price, change24h: change, volume24h: volume, liquidity, deviation });
const coin = (symbol, price, change, volume, liquidity) => ({ ...base, kind: "crypto", mint: symbol, symbol, name: symbol, price, change24h: change, volume24h: volume, liquidity, deviation: null });

const DELLON = stock("DELLon", 450_242, 96_775.34, 10, null, null);
const CEGX = stock("CEGx", 22_245.8, 8_279.88, 2_400, 3_100, 7_873.42);
const RTXON = stock("RTXon", 625.53, 225.39, 0, null, null);
const TSLAX = stock("TSLAx", 431.5, 3.58, 3_900_000, 1_200_000, 6.4);
const NVDAX = stock("NVDAx", 186.2, 2.1, 4_100_000, 900_000, 0.3);
const JTO = coin("JTO", 1.42, 9.6, 14_000_000, 3_000_000);
const THIN_COIN = coin("THIN", 0.0001, 900, 50, 200);

test("a stock token's price is its pool's when the pool is thin or a quarter away from the exchange", () => {
  assert.equal(poolPriceOff(DELLON), true, "$10 traded");
  assert.equal(poolPriceOff(RTXON), true, "nothing traded");
  assert.equal(poolPriceOff(CEGX), true, "+7 873 % from the exchange");
  assert.equal(poolPriceOff(stock("X", 1, 1, 5_000, 800, 0)), true, "a pool under $1K");
  assert.equal(poolPriceOff(TSLAX), false);
  assert.equal(poolPriceOff(stock("Q", 1, 1, 50, 300_000, 0.5)), false, "beside the exchange's price, a quiet day is no pool price");
  assert.equal(poolPriceOff({ ...stock("P", 1, 900, 10, 200, null), kind: "private" }), false, "a private company's token says «Not a share» instead");
  assert.equal(poolPriceOff(stock("Y", 1, 1, null, null, null)), false, "figures nobody stated are not a thin pool");
  assert.equal(poolPriceOff(THIN_COIN), false, "a coin is priced by its pools by design");
});

test("far from the exchange: more than 5 %, said as such — never a gain's or a loss's colour", () => {
  assert.equal(farFromExchange(TSLAX), true);
  assert.equal(farFromExchange(NVDAX), false);
  assert.equal(farFromExchange(stock("Z", 1, 1, 1, 1, null)), false);
});

test("«Gainers», «Losers», the hour and the price leave a pool's price below the rest; volume still ranks it", () => {
  const rows = [DELLON, CEGX, RTXON, TSLAX, NVDAX, JTO, THIN_COIN];
  assert.deepEqual(sortScreener(rows, "change24h", "desc").map((row) => row.symbol), ["THIN", "JTO", "TSLAx", "NVDAx", "DELLon", "CEGx", "RTXon"]);
  assert.deepEqual(sortScreener(rows, "change24h", "asc").slice(0, 4).map((row) => row.symbol), ["NVDAx", "TSLAx", "JTO", "THIN"]);
  assert.deepEqual(sortScreener(rows, "price", "desc").slice(0, 2).map((row) => row.symbol), ["TSLAx", "NVDAx"]);
  assert.equal(sortScreener(rows, "volume24h", "desc").at(-1).symbol, "RTXon");
});
