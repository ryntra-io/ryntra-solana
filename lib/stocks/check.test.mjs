// Run from repo root: node --test lib/stocks/check.test.mjs
//
// «Перевірка» from the server (contract 1.20.0):
// the four lines and the reserve the quote and the order answer as `check`
// are the figures the web's two sheets counted by until now — the purchase's
// and the sale's own formulas, restated below as they stood in the sheets,
// are the oracle — and the one deliberate difference (no SOL price: no total,
// never a smaller one) is pinned.
import assert from "node:assert/strict";
import test from "node:test";

import { SwapCheckSchema } from "../api/v1/contract.ts";
import { buildSwapCheck, buyCosts, checkSide, reserveOverPurchase, SALE_MAY_FAIL, unitsFromRaw, USDC_DECIMALS } from "./check.ts";
import { awaitCheckContext, buyerEventLine, swapCheckOf } from "./check.server.ts";
import { truthLine } from "./truth.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const OPENAI = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const SPACEX = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const SOL_USD = 213.2;
const SOL_AT = "2026-09-27T12:00:00.000Z";

const apple = { mint: AAPLX, symbol: "AAPLx", name: "Apple", issuer: "xstocks", unit: "share", privateCompany: false, decimals: 8, multiplier: 1.0118, issuerFeeBps: null };
const openai = { mint: OPENAI, symbol: "OPENAI", name: "OpenAI", issuer: "prestocks", unit: "token", privateCompany: true, decimals: 9, multiplier: null, issuerFeeBps: 300 };

/** A $10 purchase of Apple as the venue quotes it: 0.0431 shares out, Ryntra's 25 bps, the network's fee and, on the order, the proven reserve. */
const appleBuy = {
  inAmountRaw: "10000000",
  outAmountRaw: "4263421",
  minReceivedRaw: "4220787",
  inUsdValue: "9.9987",
  outUsdValue: "9.9612",
  totalFeeBasisPoints: 25,
  priceImpactPct: "0.0118",
  signatureFeeLamports: "5000",
  priorityFeeLamports: "43210",
  rentFeeLamports: "2074080",
};

/** A sale of OpenAI tokens worth ≈ $15.20 into USDC, the issuer's 3 % on the transfer inside the venue's values. */
const openaiSale = {
  inAmountRaw: "10134000",
  outAmountRaw: "14651870",
  minReceivedRaw: "14505351",
  inUsdValue: "15.2010",
  outUsdValue: "14.6518",
  totalFeeBasisPoints: 25,
  priceImpactPct: "0.02",
  signatureFeeLamports: "5000",
  priorityFeeLamports: "40000",
  rentFeeLamports: "0",
};

/** The purchase sheet's own count until 1.20.0, restated: `buyCosts` on the typed sum, the order's proven rent only once a Review is prepared, the reserve said first when it is more than the purchase. */
function webPurchase(order, company, prepared, solUsd = SOL_USD) {
  const amount = Number(order.inAmountRaw) / 10 ** USDC_DECIMALS;
  const estimate = buyCosts({ spendUsd: amount, inUsdValue: order.inUsdValue, outUsdValue: order.outUsdValue, totalFeeBasisPoints: order.totalFeeBasisPoints, priceImpactPct: order.priceImpactPct, signatureFeeLamports: order.signatureFeeLamports, priorityFeeLamports: order.priorityFeeLamports, rentFeeLamports: prepared ? order.rentFeeLamports : null, solUsd, issuerFeeBasisPoints: company.issuerFeeBps });
  return {
    inUsdc: amount,
    outUnits: unitsFromRaw(order.outAmountRaw, company.decimals, company.multiplier),
    minUnits: unitsFromRaw(order.minReceivedRaw, company.decimals, company.multiplier),
    totalUsd: estimate.totalUsd,
    issuerFeeUsd: estimate.issuerFeeUsd,
    accountUsd: estimate.accountUsd,
    reserveFirst: estimate.accountUsd !== null && reserveOverPurchase(estimate.accountUsd, amount),
  };
}

/** The sale sheet's own count until 1.20.0, restated: `buyCosts` on the venue's value of what the sale gives. */
function webSale(order, company, prepared, solUsd = SOL_USD) {
  const inUsd = Number(order.inUsdValue);
  const estimate = buyCosts({ spendUsd: inUsd, inUsdValue: order.inUsdValue, outUsdValue: order.outUsdValue, totalFeeBasisPoints: order.totalFeeBasisPoints, priceImpactPct: order.priceImpactPct, signatureFeeLamports: order.signatureFeeLamports, priorityFeeLamports: order.priorityFeeLamports, rentFeeLamports: prepared ? order.rentFeeLamports : null, solUsd, issuerFeeBasisPoints: company.issuerFeeBps });
  return {
    sellUnits: unitsFromRaw(order.inAmountRaw, company.decimals, company.multiplier),
    inUsd,
    outUsdc: unitsFromRaw(order.outAmountRaw, 6, null),
    minUsdc: unitsFromRaw(order.minReceivedRaw, 6, null),
    totalUsd: estimate.totalUsd,
    issuerFeeUsd: estimate.issuerFeeUsd,
    accountUsd: estimate.accountUsd,
  };
}

test("a pair is a company bought with USDC or sold into it — anything else has no check", () => {
  assert.deepEqual(checkSide(USDC, AAPLX), { side: "buy", stockMint: AAPLX });
  assert.deepEqual(checkSide(OPENAI, USDC), { side: "sell", stockMint: OPENAI });
  assert.equal(checkSide(OPENAI, AAPLX), null, "a swap between two tokens is not a purchase or a sale");
  assert.equal(checkSide(USDC, USDC), null);
});

test("the purchase's Review: the server's four lines are the figures the sheet counted, to the last digit", () => {
  const web = webPurchase(appleBuy, apple, true);
  const check = buildSwapCheck({ side: "buy", basis: "order", order: appleBuy, company: apple, solUsd: SOL_USD, solObservedAt: SOL_AT });
  SwapCheckSchema.parse(check);
  assert.deepEqual([check.spend.unit, check.spend.amount, check.spend.usd], ["usdc", web.inUsdc, web.inUsdc], "Спишеться: the dollars");
  assert.deepEqual([check.get.unit, check.get.amount, check.get.atLeast], ["share", web.outUnits, web.minUnits], "Отримаєш: through the multiplier, and at least");
  assert.equal(check.get.usd, 9.9612, "what arrives, as the venue values it");
  assert.equal(check.costs.usd, web.totalUsd, "Усі витрати");
  assert.equal(check.costs.issuerFee, null, "a listed company's mint withholds nothing");
  assert.deepEqual(check.reserve, { lamports: "2074080", usd: web.accountUsd, first: web.reserveFirst }, "the proven reserve, its own line");
  assert.equal(check.reserve.first, false, "$0.44 is not more than $10");
  assert.deepEqual(check.what, { truth: { en: truthLine("xstocks", "Apple", "en"), uk: truthLine("xstocks", "Apple", "uk") }, note: null, caution: false });
  assert.deepEqual(check.sol, { usd: SOL_USD, observedAt: SOL_AT });
});

test("the purchase's estimate on the quote: the same figures, and no reserve before the order proves one", () => {
  const web = webPurchase(appleBuy, apple, false);
  const check = buildSwapCheck({ side: "buy", basis: "quote", order: appleBuy, company: apple, solUsd: SOL_USD, solObservedAt: SOL_AT });
  assert.equal(check.basis, "quote");
  assert.equal(check.get.amount, web.outUnits);
  assert.equal(check.costs.usd, web.totalUsd);
  assert.equal(web.accountUsd, null, "the sheet never said the venue's estimate");
  assert.equal(check.reserve, null, "neither does the server");
});

test("a $1 purchase whose reserve is more than the purchase says it first", () => {
  const dollar = { ...appleBuy, inAmountRaw: "1000000", outAmountRaw: "426342", minReceivedRaw: "422078", inUsdValue: "0.9998", outUsdValue: "0.9961", rentFeeLamports: "7074080" };
  const web = webPurchase(dollar, apple, true);
  const check = buildSwapCheck({ side: "buy", basis: "order", order: dollar, company: apple, solUsd: SOL_USD, solObservedAt: SOL_AT });
  assert.equal(web.reserveFirst, true);
  assert.deepEqual(check.reserve, { lamports: "7074080", usd: web.accountUsd, first: true });
  const small = buildSwapCheck({ side: "buy", basis: "order", order: { ...dollar, rentFeeLamports: "2074080" }, company: apple, solUsd: SOL_USD, solObservedAt: SOL_AT });
  assert.equal(small.reserve.first, false, "≈ $0.44 is not more than $1");
});

test("a private company's sale: the issuer's fee from the chain inside «Усі витрати», «Продати може не вийти» under the truth", () => {
  const web = webSale(openaiSale, openai, true);
  const check = buildSwapCheck({ side: "sell", basis: "order", order: openaiSale, company: openai, solUsd: SOL_USD, solObservedAt: SOL_AT });
  SwapCheckSchema.parse(check);
  assert.deepEqual([check.spend.unit, check.spend.amount, check.spend.usd], ["token", web.sellUnits, web.inUsd], "Спишеться: the tokens, ≈ their dollars");
  assert.deepEqual([check.get.unit, check.get.amount, check.get.atLeast, check.get.usd], ["usdc", web.outUsdc, web.minUsdc, web.outUsdc], "Отримаєш: USDC, and at least");
  assert.equal(check.costs.usd, web.totalUsd);
  assert.deepEqual(check.costs.issuerFee, { basisPoints: 300, usd: web.issuerFeeUsd });
  assert.ok(Math.abs(check.costs.issuerFee.usd - 0.45603) < 1e-12, "3 % of what the sale gives");
  assert.equal(check.reserve, null, "the wallet already holds a USDC account");
  assert.deepEqual(check.what.note, { kind: "sale-may-fail", ...SALE_MAY_FAIL });
  assert.equal(check.what.caution, true);
  assert.equal(check.what.truth.uk, "Це не акція OpenAI · комісія емітента 3% на кожен переказ · емітент може заморозити чи забрати токен");
});

test("a listed company's sale says no «Продати може не вийти», and a sale the venue gave no dollar value has no total — as the sheet had none", () => {
  const listed = buildSwapCheck({ side: "sell", basis: "order", order: openaiSale, company: apple, solUsd: SOL_USD, solObservedAt: SOL_AT });
  assert.equal(listed.what.note, null);
  const unvalued = buildSwapCheck({ side: "sell", basis: "quote", order: { ...openaiSale, inUsdValue: null }, company: openai, solUsd: SOL_USD, solObservedAt: SOL_AT });
  assert.equal(unvalued.spend.usd, null);
  assert.equal(unvalued.costs, null);
});

test("without SOL's price the server states no total and no reserve in dollars — never a smaller figure", () => {
  const check = buildSwapCheck({ side: "buy", basis: "order", order: appleBuy, company: apple, solUsd: null, solObservedAt: SOL_AT });
  assert.equal(check.costs, null, "the network's fee is part of «Усі витрати»; unknown, the total is unknown");
  assert.deepEqual(check.reserve, { lamports: "2074080", usd: null, first: false });
  assert.deepEqual(check.sol, { usd: null, observedAt: null });
  assert.equal(check.get.amount, webPurchase(appleBuy, apple, true).outUnits, "what arrives needs no SOL");
});

test("a purchase says the issuer's event under the truth; a sale never does", () => {
  const event = { en: "SpaceX went public. SPACEX you buy must be swapped by 12 March 2027 — after the deadline the token expires worthless.", uk: "SpaceX вийшла на біржу. Куплений SPACEX треба обміняти до 12 березня 2027 — після строку токен згорить." };
  const spacex = { ...openai, mint: SPACEX, symbol: "SPACEX", name: "SpaceX" };
  const buy = buildSwapCheck({ side: "buy", basis: "quote", order: appleBuy, company: spacex, solUsd: SOL_USD, solObservedAt: SOL_AT, event });
  assert.deepEqual(buy.what.note, { kind: "issuer-event", ...event });
  const sale = buildSwapCheck({ side: "sell", basis: "quote", order: openaiSale, company: spacex, solUsd: SOL_USD, solObservedAt: SOL_AT, event });
  assert.equal(sale.what.note.kind, "sale-may-fail");
});

/** A universe row as `swapCheckOf` reads it — the representation, the multiplier, the fee the chain states. */
function rowOf({ mint, symbol, name, issuer, preIpo, multiplier, feeBps }) {
  return {
    representation: {
      mint,
      symbol,
      name: `${name} token`,
      issuer: { id: issuer, label: issuer },
      instrument: { class: preIpo ? "pre-ipo" : "listed-equity", unitBasis: preIpo ? "token" : "share" },
      underlying: { name: preIpo ? name : `${name} Inc.`, symbol: preIpo ? symbol : "AAPL" },
    },
    multiplier: multiplier === null ? null : { current: multiplier, pending: null, effectiveAt: null },
    transferFee: feeBps === null ? null : { basisPoints: feeBps, maximumFeeRaw: "18446744073709551615", configUsed: "NEWER", epoch: "860", pending: null, source: "chain" },
  };
}

test("the route's count: the company as its page names it, the decimals read for the answer, the universe's multiplier and fee", () => {
  const row = rowOf({ mint: AAPLX, symbol: "AAPLx", name: "Apple", issuer: "xstocks", preIpo: false, multiplier: 1.0118, feeBps: null });
  const check = swapCheckOf({ context: { side: "buy", stockMint: AAPLX, row, solUsd: SOL_USD, solObservedAt: SOL_AT }, basis: "order", order: appleBuy, decimals: { [USDC]: 6, [AAPLX]: 8 }, mintRead: null, nowMs: Date.parse(SOL_AT) });
  SwapCheckSchema.parse(check);
  assert.deepEqual(check.company, { mint: AAPLX, symbol: "AAPLx", name: "Apple", issuer: "xstocks", unit: "share", privateCompany: false, decimals: 8, multiplier: 1.0118 });
  assert.deepEqual(check, buildSwapCheck({ side: "buy", basis: "order", order: appleBuy, company: apple, solUsd: SOL_USD, solObservedAt: SOL_AT }));
  assert.equal(swapCheckOf({ context: null, basis: "quote", order: appleBuy, decimals: {}, mintRead: null, nowMs: 0 }), null, "no company, no check");
  assert.equal(swapCheckOf({ context: { side: "buy", stockMint: AAPLX, row, solUsd: SOL_USD, solObservedAt: SOL_AT }, basis: "quote", order: appleBuy, decimals: { [USDC]: 6 }, mintRead: null, nowMs: 0 }), null, "decimals unread: nothing is counted on a guess");
  const broken = rowOf({ mint: AAPLX, symbol: "AAPLx", name: "Apple", issuer: "xstocks", preIpo: false, multiplier: Number.POSITIVE_INFINITY, feeBps: null });
  assert.equal(swapCheckOf({ context: { side: "buy", stockMint: AAPLX, row: broken, solUsd: SOL_USD, solObservedAt: SOL_AT }, basis: "order", order: appleBuy, decimals: { [USDC]: 6, [AAPLX]: 8 }, mintRead: null, nowMs: 0 }), null, "a figure out of every range is no check — never a refused order");
});

test("the issuer's event is said to a buyer only while its window is open, and only for a private company's token", () => {
  const spacex = rowOf({ mint: SPACEX, symbol: "SPACEX", name: "SpaceX", issuer: "prestocks", preIpo: true, multiplier: null, feeBps: 100 });
  const open = buyerEventLine(spacex, Date.parse("2026-09-27T12:00:00.000Z"));
  assert.match(open.uk, /Куплений SPACEX треба обміняти до 12 березня 2027/);
  assert.match(open.en, /SPACEX you buy must be swapped by/);
  assert.equal(buyerEventLine(spacex, Date.parse("2027-03-13T00:00:00.000Z")), null, "after the cut-off nothing is offered to a buyer");
  assert.equal(buyerEventLine(rowOf({ mint: AAPLX, symbol: "AAPLx", name: "Apple", issuer: "xstocks", preIpo: false, multiplier: 1, feeBps: null }), Date.parse(SOL_AT)), null);
});

test("an answer otherwise ready waits for the check's reads a bounded moment: late, it goes without its lines; failed, the same", async () => {
  const context = { side: "buy", stockMint: AAPLX, row: {}, solUsd: SOL_USD, solObservedAt: SOL_AT };
  assert.equal(await awaitCheckContext(Promise.resolve(context), 50), context, "in time: the reads are used");
  const started = Date.now();
  assert.equal(await awaitCheckContext(new Promise(() => {}), 60), null, "never answered: no check, and no wait past the bound");
  assert.ok(Date.now() - started < 1_000);
  assert.equal(await awaitCheckContext(Promise.reject(new Error("universe down")), 50), null, "a failed read is no check, never a refused order");
});
