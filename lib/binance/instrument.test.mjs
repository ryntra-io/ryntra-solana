// Run from repo root: node --test lib/binance/instrument.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  binanceInstrumentId,
  normalizeSpotSymbol,
  normalizeUsdmSymbol,
  normalizeCoinmSymbol,
  normalizeEquitySymbol,
  BINANCE_SURFACES,
} from "./instrument.ts";
import { instrumentId } from "../domain/instrument.ts";

const taxonomy = JSON.parse(readFileSync(new URL("./fixtures/instrument-taxonomy.json", import.meta.url), "utf8"));

/**
 * The whole point of this key. Binance quotes an instrument called `TSLA` and so does
 * Robinhood Chain, and they are not the same thing in any respect that matters: one is a
 * USDT-margined perpetual derivative held in a provider-custodied sub-account, the other is a
 * spot token the holder custodies. A key that lets those two collide would let a risk figure,
 * a journal row or a position be attributed to the wrong instrument.
 */
test("a Binance instrument id can never collide with a chain-scoped instrument id", () => {
  const tsla = taxonomy.usdmFutures.samples.find((s) => s.symbol === "TSLAUSDT");
  const binance = binanceInstrumentId(normalizeUsdmSymbol(tsla).key);
  const chain = instrumentId({ chain: "robinhood-chain", kind: "spot-tokenized-equity", base: "TSLA", quote: "USDG" });

  assert.notEqual(binance, chain);
  assert.ok(binance.startsWith("binance:"), `expected a venue-scoped id, got ${binance}`);
  assert.ok(!chain.startsWith("binance:"));
});

test("the same base/quote on two Binance surfaces are two different instruments", () => {
  const spotBtc = binanceInstrumentId(
    normalizeSpotSymbol(taxonomy.spot.samples.find((s) => s.symbol === "BTCUSDT")).key,
  );
  const perpBtc = binanceInstrumentId(
    normalizeUsdmSymbol(taxonomy.usdmFutures.samples.find((s) => s.symbol === "BTCUSDT")).key,
  );

  assert.notEqual(spotBtc, perpBtc, "spot BTC/USDT and the USDⓈ-M perpetual must not share an id");
  assert.match(spotBtc, /binance-spot/);
  assert.match(perpBtc, /binance-usdm-futures/);
});

/**
 * `TRADIFI_PERPETUAL` is the venue's own contract type for perpetuals on traditional-finance
 * underlyings. Flattening it into `crypto-perpetual` would erase the fact that the instrument
 * tracks an equity that has market hours, corporate actions and a different risk profile.
 */
test("TradFi perpetuals keep their own product type and underlying classification", () => {
  const tsla = normalizeUsdmSymbol(taxonomy.usdmFutures.samples.find((s) => s.symbol === "TSLAUSDT"));
  const xau = normalizeUsdmSymbol(taxonomy.usdmFutures.samples.find((s) => s.symbol === "XAUUSDT"));
  const btc = normalizeUsdmSymbol(taxonomy.usdmFutures.samples.find((s) => s.symbol === "BTCUSDT"));

  assert.equal(tsla.key.product, "tradifi-perpetual");
  assert.equal(xau.key.product, "tradifi-perpetual");
  assert.equal(btc.key.product, "crypto-perpetual");

  assert.equal(tsla.underlyingClass, "EQUITY");
  assert.equal(xau.underlyingClass, "COMMODITY");
  assert.equal(btc.underlyingClass, null);

  // An equity-backed contract does not trade against a 24/7 underlying.
  assert.equal(tsla.marketHours, "equities-rth");
  assert.equal(btc.marketHours, "24-7");
});

test("a COIN-M contract records the settlement asset that is not its quote", () => {
  const sample = taxonomy.coinmFutures.samples[0];
  const record = normalizeCoinmSymbol(sample);

  assert.equal(record.key.surface, "binance-coinm-futures");
  assert.equal(record.key.settle, sample.marginAsset);
  assert.notEqual(record.key.settle, null);
});

/**
 * Binance Stocks (`/sapi/v1/equity/*`) is a spot tokenized-security surface, entirely separate
 * from the USDⓈ-M TradFi perpetual that carries the same ticker.
 */
test("Binance Stocks tickers normalize as spot tokenized equity, not as a perpetual", () => {
  const record = normalizeEquitySymbol({ symbol: "TSLA", quoteAsset: "USDC", tradability: "BUY_SELL" });

  assert.equal(record.key.surface, "binance-equity");
  assert.equal(record.key.product, "spot-tokenized-equity");
  assert.equal(record.key.base, "TSLA");
  assert.equal(record.key.quote, "USDC");
  assert.equal(record.marketHours, "equities-rth");

  const perp = normalizeUsdmSymbol(taxonomy.usdmFutures.samples.find((s) => s.symbol === "TSLAUSDT"));
  assert.notEqual(binanceInstrumentId(record.key), binanceInstrumentId(perp.key));
});

/**
 * `tradability` is the venue's own close-only/halted signal and `status: BREAK` means the spot
 * symbol is not trading. Neither may be silently normalized away into "tradable".
 */
test("non-tradable venue states survive normalization instead of defaulting to tradable", () => {
  const halted = normalizeEquitySymbol({ symbol: "AAPL", quoteAsset: "USDC", tradability: "NONE" });
  assert.equal(halted.tradable, false);
  assert.equal(halted.tradabilityReason, "NONE");

  const closeOnly = normalizeEquitySymbol({ symbol: "AAPL", quoteAsset: "USDC", tradability: "SELL" });
  assert.equal(closeOnly.tradable, false);

  const onBreak = normalizeSpotSymbol({
    symbol: "XYZUSDT",
    status: "BREAK",
    baseAsset: "XYZ",
    quoteAsset: "USDT",
    isSpotTradingAllowed: true,
    isMarginTradingAllowed: false,
    permissionSets: [["SPOT"]],
  });
  assert.equal(onBreak.tradable, false);
});

/**
 * The spot response carries `MARGIN` inside the same symbol record as `SPOT`. Margin is a
 * separate product with separate risk, so the record must state which surfaces the symbol is
 * actually permitted on rather than collapsing them.
 */
test("margin permission is recorded as a separate surface, not folded into spot", () => {
  const btc = normalizeSpotSymbol(taxonomy.spot.samples.find((s) => s.symbol === "BTCUSDT"));

  assert.equal(btc.key.surface, "binance-spot");
  assert.ok(btc.alsoPermittedOn.includes("binance-margin"), "BTCUSDT is margin-permitted on the venue");

  const spotOnly = normalizeSpotSymbol({
    symbol: "XYZUSDT",
    status: "TRADING",
    baseAsset: "XYZ",
    quoteAsset: "USDT",
    isSpotTradingAllowed: true,
    isMarginTradingAllowed: false,
    permissionSets: [["SPOT"]],
  });
  assert.deepEqual(spotOnly.alsoPermittedOn, []);
});

test("every declared surface names its exact REST base and product family", () => {
  const ids = Object.keys(BINANCE_SURFACES);
  assert.ok(ids.length >= 5);
  for (const id of ids) {
    const surface = BINANCE_SURFACES[id];
    assert.equal(surface.id, id);
    assert.match(surface.restBaseUrl, /^https:\/\//);
    assert.ok(surface.label.length > 0);
    assert.ok(surface.products.length > 0);
  }
});
