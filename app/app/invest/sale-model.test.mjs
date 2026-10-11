import assert from "node:assert/strict";
import test from "node:test";

import { coinSaleAssetOf, coinSaleLines, coinTruth, DEFAULT_SALE_USD, SOL_SALE_RESERVE_LAMPORTS, solForSale, isOverPosition, isWholePosition, MIN_SALE_USD, openingSaleUsd, positionUsd, rawForUsd, SALE_SHARE_PRESETS_PCT, saleAssetOf, shareRaw, shareUsd, unitsOf } from "./sale-model.ts";

/**
 * «Продати з позиції»: a sum in dollars or a share of the position → the raw
 * units the one execution path takes; the whole position is exactly what the
 * wallet holds; the company's facts read as the company page reads them.
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

/* ------------------------------------------------------------ a coin */

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", icon: null, decimals: 6, price: 0.5, verified: true, category: "crypto", audit: { suspicious: false } };

test("a coin is sold from the same sheet: said by its symbol, what it is from the catalogue's facts, sellable while priced", () => {
  const asset = coinSaleAssetOf(JUP, "uk", SOL_MINT);
  assert.equal(asset.unit, "coin");
  assert.equal(asset.multiplier, null);
  assert.equal(asset.issuerFeeBps, null);
  assert.equal(asset.sellable, true);
  assert.equal(asset.truth, "Монета Solana · ціну задає ринок · перевірена Jupiter");
  assert.equal(asset.truthCaution, false);
  assert.equal(coinSaleAssetOf({ ...JUP, price: null }, "en", SOL_MINT).sellable, false, "no price, no sale");
  assert.deepEqual(coinTruth({ ...JUP, category: "meme", verified: false }, "en", SOL_MINT), { line: "A Solana meme coin · the market sets its price · not verified by Jupiter — check the address", caution: true });
  assert.equal(coinTruth({ ...JUP, audit: { suspicious: true } }, "uk", SOL_MINT).caution, true);
  assert.equal(coinTruth({ ...JUP, mint: SOL_MINT }, "en", SOL_MINT).line, "SOL, the Solana network's own coin · the market sets its price");
});

test("a coin's «Перевірка» is counted by the server's rules from the order it answered — a figure it cannot count is null", () => {
  const asset = coinSaleAssetOf(JUP, "en", SOL_MINT);
  const order = {
    inAmountRaw: "20000000", outAmountRaw: "9950000", minReceivedRaw: "9900000",
    inUsdValue: "10.00", outUsdValue: "9.95", totalFeeBasisPoints: 25, priceImpactPct: "0.01",
    signatureFeeLamports: "5000", priorityFeeLamports: "0", rentFeeLamports: "2039280",
  };
  const quote = coinSaleLines({ order, basis: "quote", asset, solUsd: 200, usdcMint: USDC_MINT });
  assert.equal(quote.spend.amount, 20);
  assert.equal(quote.spend.usd, 10);
  assert.equal(quote.get.amount, 9.95);
  assert.equal(quote.get.atLeast, 9.9);
  assert.ok(Math.abs(quote.costs.usd - (0.05 + 0.001)) < 1e-9, "the venue's values' difference and the network's fee at SOL's price");
  assert.equal(quote.reserve, null, "no reserve on a quote — only the order's simulation proves one");
  assert.equal(quote.what.truth.en, asset.truth);
  const placed = coinSaleLines({ order, basis: "order", asset, solUsd: 200, usdcMint: USDC_MINT });
  assert.equal(placed.reserve.lamports, "2039280");
  assert.ok(Math.abs(placed.reserve.usd - 0.407856) < 1e-9);
  assert.equal(coinSaleLines({ order, basis: "quote", asset, solUsd: null, usdcMint: USDC_MINT }).costs, null, "without SOL's price the costs are unknown, never smaller");
  assert.equal(coinSaleLines({ order, basis: "quote", asset: { ...asset, decimals: null }, solUsd: 200, usdcMint: USDC_MINT }), null);
});

test("a sale of SOL leaves 0.01 SOL to carry it; «100 %» is everything above", () => {
  assert.equal(SOL_SALE_RESERVE_LAMPORTS, 10_000_000n);
  assert.equal(solForSale(120_000_000n), 110_000_000n);
  assert.equal(solForSale(9_000_000n), 0n, "a wallet with less than the reserve has none to sell");
  assert.equal(coinSaleAssetOf({ ...JUP, mint: SOL_MINT, name: "Wrapped SOL", symbol: "SOL" }, "en", SOL_MINT).name, "SOL");
  assert.equal(coinSaleAssetOf({ ...JUP, mint: SOL_MINT }, "en", SOL_MINT).nativeSol, true);
});
