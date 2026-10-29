// Run from repo root: node --test lib/ticket/solana-ticket.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  SOL_COIN,
  assetOf,
  chainUnits,
  decimalText,
  jupiterFigures,
  priceTick,
  rawAmount,
  referenceOf,
  settledReceipt,
  solGas,
  ticketBalances,
  ticketMarket,
  ticketPrices,
  ticketQuote,
  uiUnits,
} from "./solana-ticket.ts";

/* The Solana forms say their figures in the core ticket's words: raw units stay strings and bigints, a company's token
   counts in the shares the wallet shows, and the quote speaks only for the amount it was asked. */

const USDC = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, digits: 2 };
const USDT = { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", decimals: 6, digits: 2 };
const NVDAX = { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", symbol: "NVDAx", decimals: 8, multiplier: 1.0234 };

test("a dollar price is written once as a decimal, never in an exponent", () => {
  assert.equal(decimalText(0.0000291), "0.0000291");
  assert.equal(decimalText(182.4), "182.4");
  assert.equal(decimalText(1e-12), "0.000000000001");
  assert.equal(decimalText(0), null);
  assert.equal(decimalText(Number.NaN), null);
  const prices = ticketPrices([{ coin: USDC, usd: 0.9998 }, { coin: NVDAX, usd: null }], 1_000, "Jupiter");
  assert.deepEqual(Object.keys(prices), [assetOf(USDC.mint)], "a token without a price is left out, never zero");
  assert.equal(prices[assetOf(USDC.mint)].usd, "0.9998");
});

test("a price step has four significant digits and at least cents", () => {
  assert.equal(priceTick(182.4), "0.01");
  assert.equal(priceTick(1.5), "0.001");
  assert.equal(priceTick(0.00002914), "0.00000001");
  assert.equal(priceTick(null), "0.0001");
  const market = ticketMarket({ id: "m", base: NVDAX, quote: USDC, price: 182.4, minQuoteRaw: 1_000_000n });
  assert.equal(market.symbol, "NVDAx/USDC");
  assert.equal(market.lot, "0.00000001");
  assert.deepEqual(market.min_notional, { units: "1000000", asset: assetOf(USDC.mint), decimals: 6 });
});

test("a company's token counts in the shares the wallet shows, and a whole sale is exactly what is held", () => {
  const held = 250_000_000n;
  const shown = uiUnits(held, NVDAX);
  assert.equal(shown, 255_850_000n);
  assert.equal(rawAmount(held, NVDAX).units, "255850000");
  // Back to the chain, down to a whole unit; all of it is the holding itself.
  assert.equal(chainUnits(shown, NVDAX, held), held);
  assert.equal(chainUnits(shown - 1n, NVDAX, held) < held, true);
  assert.equal(chainUnits(102_340_000n, NVDAX), 100_000_000n);
  // A token without a multiplier counts as it is held.
  assert.equal(uiUnits(5n, USDC), 5n);
  assert.equal(rawAmount("12.5", USDC), null, "a value that is not whole units is none");
});

test("balances and the network's fee come in the ticket's words; an unread balance is left out", () => {
  const balances = ticketBalances([{ coin: USDC, raw: "152340000" }, { coin: NVDAX, raw: null }]);
  assert.deepEqual(Object.keys(balances), [assetOf(USDC.mint)]);
  const gas = solGas(500_000n, 5_000n);
  assert.equal(gas.token.symbol, "SOL");
  assert.equal(gas.reserve.units, "500000");
  assert.equal(gas.txFee.units, "5000");
  assert.equal(solGas(0n).txFee, undefined);
});

test("the reference is the base's dollar price over the quote's", () => {
  assert.equal(referenceOf(150.75, 1.0001, "Jupiter", 5).price, "150.734926507349");
  assert.equal(referenceOf(null, 1, "Jupiter", 5), null);
});

const ORDER = {
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: USDT.mint,
  inAmountRaw: "10000000",
  outAmountRaw: "1500000",
  minReceivedRaw: "1492500",
  slippageBps: 50,
  totalFeeBasisPoints: 50,
  signatureFeeLamports: "5000",
  priorityFeeLamports: "1000",
  route: [{ label: "Whirlpool" }],
  router: "metis",
  platformFee: { basisPoints: 50, mint: USDT.mint },
  ryntraFee: { mechanism: "JUPITER_REFERRAL", state: "QUOTED", basisPoints: 50, requestedBasisPoints: 50, asset: USDT.mint, symbol: null, decimals: null, amountRaw: null, usd: null },
};

test("a Jupiter order's costs stand apart: the network's in lamports, Ryntra's sized on its side, Jupiter's own beyond it", () => {
  const figures = jupiterFigures(ORDER, { pay: SOL_COIN, get: USDT }, 1_000, 31_000);
  assert.deepEqual(figures.fees.gas, { units: "6000", asset: assetOf(SOL_COIN.mint), decimals: 9 });
  assert.deepEqual(figures.fees.ryntra, { units: "7500", asset: assetOf(USDT.mint), decimals: 6 }, "0,5 % of the quoted output, as Review's «≈ 0.0075 USDT»");
  assert.equal(figures.fees.venue, undefined, "Jupiter's total is Ryntra's referral: nothing beyond it");
  assert.equal(figures.route, "Whirlpool");
  const extra = jupiterFigures({ ...ORDER, totalFeeBasisPoints: 70 }, { pay: SOL_COIN, get: USDT }, 1_000, 31_000);
  assert.deepEqual(extra.fees.venue, { units: "3000", asset: assetOf(USDT.mint), decimals: 6 });
});

test("a quote speaks for the amount it was asked; a sale of scaled shares is matched to what the ticket typed", () => {
  const market = ticketMarket({ id: "sol-usdt", base: USDT, quote: SOL_COIN, price: 0.0066 });
  const figures = jupiterFigures(ORDER, { pay: SOL_COIN, get: USDT }, 1_000, 31_000);
  const quote = ticketQuote({ figures, side: "buy", market, pay: SOL_COIN, get: USDT, executor: "Jupiter", venueId: "jupiter" });
  assert.equal(quote.paid.units, "10000000");
  assert.equal(quote.quote.out_min.units, "1492500");
  assert.equal(quote.quote.expires_at, 31_000);
  const typed = { units: "102340000", asset: assetOf(NVDAX.mint), decimals: 8 };
  const sale = ticketQuote({ figures: { ...figures, inRaw: "100000000" }, side: "sell", market, pay: NVDAX, get: USDC, executor: "Jupiter", venueId: "jupiter", paid: typed });
  assert.equal(sale.paid.units, "102340000");
  assert.equal(ticketQuote({ figures: { ...figures, inRaw: "0" }, side: "buy", market, pay: SOL_COIN, get: USDT, executor: "Jupiter", venueId: "jupiter" }), null);
});

test("the receipt holds what was agreed to and what the chain moved", () => {
  const paid = rawAmount("10000000", SOL_COIN);
  const expected = rawAmount("1500000", USDT);
  const receipt = settledReceipt({
    intentId: "sig",
    venueId: "jupiter",
    marketId: "sol-usdt",
    side: "buy",
    state: "filled",
    paid,
    expected,
    atLeast: rawAmount("1492500", USDT),
    actualIn: paid,
    actualOut: rawAmount("1497000", USDT),
    fees: {},
    signature: "5x".repeat(40),
    signer: "wallet",
    executor: "Jupiter",
    at: 9,
  });
  assert.equal(receipt.schema, "ryntra.flight-log/1");
  assert.equal(receipt.amounts.actual.out.units, "1497000");
  assert.equal(receipt.amounts.diff_bps, -20);
  assert.equal(receipt.state, "filled");
});
