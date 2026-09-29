import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SALE_USD, isOverPosition, isWholePosition, MIN_SALE_USD, openingSaleUsd, positionUsd, rawForUsd, SALE_SHARE_PRESETS_PCT, saleAssetOf, shareRaw, shareUsd, unitsOf } from "./sale-model.ts";

/**
 * «Продати з позиції» (`RYN-BUY-FLOW-001`, subtask 1): a sum in dollars or a
 * share of the position → the raw units the one execution path takes; the
 * whole position is exactly what the wallet holds; the company's facts read
 * as the company page reads them.
 */

/* 0.05 of an Apple share at $250: raw 5 000 000 at 8 decimals, no multiplier. */
const APPLE = { raw: 5_000_000n, decimals: 8, multiplier: null, price: 250 };

test("a sale starts at a dollar, its quick choices are shares of the position, and it opens on $10 only for a position worth that", () => {
  assert.equal(MIN_SALE_USD, 1);
  assert.deepEqual([...SALE_SHARE_PRESETS_PCT], [25, 50, 75, 100]);
  assert.equal(DEFAULT_SALE_USD, 10);
  assert.equal(openingSaleUsd(12.5), 10);
  assert.equal(openingSaleUsd(10), 10);
  assert.equal(openingSaleUsd(9.99), null, "a smaller position opens on no sum — never a preselected sale of everything");
  assert.equal(openingSaleUsd(null), null);
});

test("the position in the wallet's unit and in dollars, the multiplier applied", () => {
  assert.equal(unitsOf(APPLE.raw, APPLE.decimals, APPLE.multiplier), 0.05);
  assert.equal(positionUsd(APPLE.raw, APPLE.decimals, APPLE.multiplier, APPLE.price), 12.5);
  /* SPACEX: ×5 on the chain — 2 raw tokens at 9 decimals show as 10 tokens. */
  assert.equal(unitsOf(2_000_000_000n, 9, 5), 10);
  assert.equal(positionUsd(2_000_000_000n, 9, 5, 1.97), 19.7);
  assert.equal(positionUsd(APPLE.raw, APPLE.decimals, null, null), null, "no price, no value — never zero");
  assert.equal(unitsOf(0n, 8, null), 0);
});

test("a share of the position is taken on the raw amount, never rounded up, and all of it is exactly what the wallet holds", () => {
  assert.equal(shareRaw(5_000_001n, 25), 1_250_000n);
  assert.equal(shareRaw(5_000_001n, 50), 2_500_000n);
  assert.equal(shareRaw(5_000_001n, 75), 3_750_000n);
  assert.equal(shareRaw(5_000_001n, 100), 5_000_001n);
  assert.equal(shareRaw(0n, 100), 0n);
  assert.equal(shareUsd(APPLE.raw, APPLE.decimals, null, APPLE.price, 25), 3.12, "$3.125 is $3.12 — a quick choice never promises more than it sells");
  assert.equal(shareUsd(APPLE.raw, APPLE.decimals, null, APPLE.price, 100), 12.5);
  assert.equal(shareUsd(APPLE.raw, APPLE.decimals, null, null, 50), null);
});

test("a sum in dollars sells the raw units it is worth at the price, the whole position when it reaches the value", () => {
  /* $1 of Apple at $250 is 0.004 of a share: 400 000 raw at 8 decimals. */
  assert.equal(rawForUsd(1, APPLE.raw, APPLE.decimals, null, APPLE.price), 400_000n);
  assert.equal(rawForUsd(12.5, APPLE.raw, APPLE.decimals, null, APPLE.price), APPLE.raw);
  assert.equal(rawForUsd(12.496, APPLE.raw, APPLE.decimals, null, APPLE.price), APPLE.raw, "within half a cent is the whole position");
  assert.equal(rawForUsd(20, APPLE.raw, APPLE.decimals, null, APPLE.price), APPLE.raw, "never more than is held");
  /* SPACEX ×5: $1.97 is one shown token, a fifth of a raw one — 200 000 000 raw at 9 decimals. */
  assert.equal(rawForUsd(1.97, 2_000_000_000n, 9, 5, 1.97), 200_000_000n);
  assert.equal(rawForUsd(0, APPLE.raw, APPLE.decimals, null, APPLE.price), null);
  assert.equal(rawForUsd(1, APPLE.raw, null, null, APPLE.price), null, "no decimals, no amount");
  assert.equal(rawForUsd(1, APPLE.raw, APPLE.decimals, null, null), null, "no price, no amount");
  assert.equal(rawForUsd(1, 0n, APPLE.decimals, null, APPLE.price), null, "nothing held, nothing to sell");
});

test("a sum more than the position is said as such; a sum within half a cent of it is all of it", () => {
  assert.equal(isOverPosition(12.6, 12.5), true);
  assert.equal(isOverPosition(12.504, 12.5), false);
  assert.equal(isWholePosition(12.496, 12.5), true);
  assert.equal(isWholePosition(12.49, 12.5), false);
  assert.equal(isOverPosition(5, null), false);
});

test("the company's facts for its sale read as the company page reads them — the name, the truth with the fee from the chain, the multiplier", () => {
  const asset = (over) => ({
    row: {
      representation: { mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh", symbol: "OPENAI", name: "OpenAI PreStock", underlying: { name: "OpenAI", symbol: "OPENAI" }, issuer: { id: "prestocks" }, instrument: { class: "pre-ipo", unitBasis: "token" }, tradingHalted: false, ...over?.rep },
      transferFee: { basisPoints: 300 },
      market: { priceUsd: 1100.5, icon: "https://example.test/openai.png" },
      multiplier: { current: 1.4861347 },
      ...over?.row,
    },
    onchain: { decimals: 9 },
    chainMultiplier: { current: 1.4861347 },
    ...over?.asset,
  });
  const openai = saleAssetOf(asset(), "uk");
  assert.equal(openai.name, "OpenAI");
  assert.equal(openai.unit, "token");
  assert.equal(openai.preIpo, true);
  assert.equal(openai.issuerFeeBps, 300);
  assert.equal(openai.decimals, 9);
  assert.equal(openai.multiplier, 1.4861347);
  assert.equal(openai.priceUsd, 1100.5);
  assert.equal(openai.sellable, true);
  assert.match(openai.truth, /^Це не акція OpenAI · комісія емітента 3% на кожен переказ/);
  assert.equal(saleAssetOf(asset({ rep: { tradingHalted: true } }), "en").sellable, false, "a paused token offers no sale");
  assert.equal(saleAssetOf(asset({ row: { market: { priceUsd: null, icon: null } } }), "en").sellable, false, "an unpriced token offers no sale");
  assert.equal(saleAssetOf(asset({ asset: { onchain: { error: "unread" } } }), "en").decimals, null);
  const apple = saleAssetOf(asset({ rep: { symbol: "AAPLx", name: "Apple xStock", underlying: { name: "Apple Inc.", symbol: "AAPL" }, issuer: { id: "xstocks" }, instrument: { class: "equity", unitBasis: "share" } }, row: { transferFee: null, multiplier: null } , asset: { chainMultiplier: null } }), "en");
  assert.equal(apple.name, "Apple");
  assert.equal(apple.unit, "share");
  assert.equal(apple.issuerFeeBps, null);
  assert.equal(apple.multiplier, null);
  assert.match(apple.truth, /^A token that tracks the price of Apple/);
});
