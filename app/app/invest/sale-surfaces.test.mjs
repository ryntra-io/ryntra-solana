import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { INVEST_WORDS, heldLine, sellForWord } from "./invest-words.ts";

/**
 * «Продати з позиції»: «Продати» on the company page for a holder and on the
 * position in Portfolio — a sum in dollars or a share of the position →
 * «Перевірка» → the signature → «Продано» with the receipt, on the purchase's
 * own path, one orange action on the screen; a PreStocks token says its fee
 * from the chain and that selling may not be possible.
 */

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const SELL_SHEET = source("../stocks/[ticker]/sell-sheet.tsx");
const LIVE = source("../stocks/[ticker]/company-live.tsx");
const VIEW = source("../stocks/[ticker]/company-view.tsx");
const COMPANY_CSS = source("../stocks/[ticker]/company.module.css");
const HOLDINGS = source("../../solana/workspace/holdings/holdings-card.tsx");
const HOLDINGS_CSS = source("../../solana/workspace/holdings/holdings.module.css");
const DOCS_INVEST = source("../../docs/content/invest.ts");

test("the sale runs on the purchase's one execution path — the sale's side, into USDC, the same Review, signature and recovery", () => {
  assert.match(SELL_SHEET, /useSpotTicket\(\{\s*connection,\s*side: SPOT_SALE_SIDE,\s*baseMint: mint,/);
  assert.match(SELL_SHEET, /quote: USDC,/);
  assert.match(SELL_SHEET, /void ticket\.review\(\)/);
  assert.match(SELL_SHEET, /void ticket\.sign\(\)/);
  assert.match(SELL_SHEET, /void ticket\.recover\(\)/);
  assert.match(SELL_SHEET, /void ticket\.cancelReview\(true\)/, "a stale price is refreshed, as in the purchase");
  assert.doesNotMatch(SELL_SHEET, /\bfetch\(|\/api\/solana\/swap\//, "no second execution mechanism");
  assert.doesNotMatch(SELL_SHEET, /"SELL"|'SELL'/, "the side is an order parameter, never a word a surface says");
  /* The amount the path takes is the mint's raw units, from a sum or a share of what the wallet holds. */
  assert.match(SELL_SHEET, /plainAmount\(saleRaw\.toString\(\), baseDecimals\)/);
  assert.match(SELL_SHEET, /rawForUsd\(typed, heldRaw, baseDecimals, multiplier, price\)/);
  assert.match(SELL_SHEET, /shareRaw\(heldRaw, pct\)/);
});

test("the Review is four lines — what leaves, what arrives at least, all costs with the issuer's fee from the chain, what the token is", () => {
  const review = SELL_SHEET.slice(SELL_SHEET.indexOf('data-sheet="review"'), SELL_SHEET.indexOf("/* ------------------------------------------------------------ compose */"));
  assert.equal(review.split("<dt>").length - 1, 4);
  for (const row of ["rowSell", "rowGet", "rowCosts", "rowWhat"]) assert.match(review, new RegExp(`word\\("${row}"\\)`));
  assert.match(review, /word\("atLeast"\)/);
  assert.match(review, /data-issuer-fee/);
  /* 1.20.0: the lines are the server's — the order's `check`, the issuer's fee from the chain inside «Усі витрати» — and nothing is counted on the page. */
  assert.match(SELL_SHEET, /const check: SwapCheck \| null = prepared \? \(prepared\.check \?\? null\) : \(quoted\?\.check \?\? null\);/);
  assert.match(SELL_SHEET, /costs\.issuerFee\.basisPoints/, "the fee is the one the server read from the chain for the mint");
  assert.doesNotMatch(SELL_SHEET, /buyCosts\(|WRAPPED_SOL_MINT|solUsd/, "no count of the costs on the page, no SOL price read for it");
  assert.match(review, /data-sale-may-fail/);
  assert.match(review, /word\("priceExpired"\)/);
  assert.match(review, /word\("refreshPrice"\)/);
});

test("a PreStocks token says what it is and that selling may not be possible before any sum, in the documentation's own words", () => {
  const compose = SELL_SHEET.slice(SELL_SHEET.indexOf('data-sale-compose'));
  assert.match(compose, /\{preIpo \? \(\s*<div className=\{company\.sheetWarning\} data-sale-caution>/);
  assert.ok(compose.indexOf("<SumField") > 0 && compose.indexOf("data-sale-may-fail") < compose.indexOf("<SumField"), "said before the sum");
  assert.equal(INVEST_WORDS.saleMayFail.uk, "Продати може не вийти: емітент ліквідності не обіцяє.");
  assert.equal(INVEST_WORDS.saleMayFail.en, "Selling may not be possible: the issuer promises no liquidity.");
  assert.ok(DOCS_INVEST.includes("Продати може не вийти: емітент ліквідності не обіцяє."), "the same words as the documentation");
  assert.ok(DOCS_INVEST.includes("Selling may not be possible: the issuer promises no liquidity."));
});

test("the receipt says «Продано» with the sum and what was sold, and the way to History and the transaction", () => {
  const receipt = SELL_SHEET.slice(SELL_SHEET.indexOf("/* ------------------------------------------------------------ the receipt */"), SELL_SHEET.indexOf("/* ------------------------------------------------------------ the Review */"));
  assert.match(receipt, /`\$\{word\("sold"\)\}\$\{got !== null \? ` · \$\{formatUsdMoney\(got, numbers\)\}` : ""\}`/);
  assert.match(receipt, /unitsPhrase\(gave, unit, name, lang, numbers\)/);
  assert.match(receipt, /href="\/app\/activity"/);
  assert.match(receipt, /explorerTxUrl\("mainnet", settled\.signature\)/);
  assert.equal(INVEST_WORDS.sold.uk, "Продано");
  for (const word of ["nothingSold", "saleRejected", "saleUnknownTx"]) assert.match(receipt + SELL_SHEET, new RegExp(`word\\("${word}"\\)`));
});

test("the sale's words in both languages: the action on the sum, all of it, the position under the action", () => {
  assert.equal(sellForWord("uk", "$10"), "Продати на $10");
  assert.equal(sellForWord("en", "$10"), "Sell $10");
  assert.equal(sellForWord("uk", "$12,50", true), "Продати все · $12,50");
  assert.equal(sellForWord("en", "$12.50", true), "Sell all · $12.50");
  assert.equal(heldLine("uk", "0,05 частки Apple", "$12,50"), "У тебе 0,05 частки Apple ≈ $12,50");
  assert.equal(heldLine("en", "0.05 of a share", null), "You hold 0.05 of a share");
  for (const [key, value] of Object.entries(INVEST_WORDS)) {
    assert.ok(value.en.trim() && value.uk.trim(), `${key} has both languages`);
  }
  assert.doesNotMatch(SELL_SHEET, /рекомендовано|recommended/i, "a sum is the person's own");
});

test("the company page: «Продати» beside the holder's position, quiet — the page's one orange action stays «Купити»", () => {
  assert.match(LIVE, /className=\{`rw-btn \$\{company\.sell\}`\}/);
  assert.doesNotMatch(LIVE, /rw-btn--primary/);
  assert.match(LIVE, /const canSell = sale\?\.sellable === true;/);
  assert.match(LIVE, /<SellSheet open=\{selling\} asset=\{sale\}/);
  /* A settled sale re-reads the wallet: the sheet with its receipt outlives the position block while it is open. */
  assert.match(LIVE, /if \(!position && !\(canSell && selling\)\) return null;/);
  /* A page whose issuer event already offers the holder a sale passes none: no one sees two. */
  assert.match(VIEW, /const sale = read \? null : saleAssetOf\(asset, lang\);/);
  assert.match(VIEW, /<YourPosition [^>]*sale=\{sale\} \/>/);
  assert.match(COMPANY_CSS, /\.sell\[data-sell-open="true"\] \{\s*visibility: hidden;/, "the action steps aside while its sheet is open");
});

test("Portfolio: «Продати» on a company position, quiet, the sheet on the spot — never on crypto, dust, a retired token or a position with its own issuer event", () => {
  assert.match(HOLDINGS, /const listed = row\.category === "stock" && !row\.retired && !row\.event && row\.price !== null && row\.value !== null && row\.value >= DUST_MICRO_USD \? stockRows\?\.get\(row\.mint\) : undefined;/);
  assert.match(HOLDINGS, /const sellable = listed !== undefined && !listed\.halted;/);
  assert.match(HOLDINGS, /className=\{`rw-btn \$\{styles\.sell\}`\}/);
  assert.match(HOLDINGS, /<PositionSale mint=\{sale\?\.mint \?\? null\} placeholder=\{sale\} locale=\{locale\} onClose=\{\(\) => setSale\(null\)\} \/>/);
  assert.equal(HOLDINGS.split("rw-btn--primary").length - 1, 0, "the page's one orange action is the wallet's next step, in FundingActions");
  assert.match(SELL_SHEET, /export function PositionSale\(/);
  assert.match(SELL_SHEET, /const read = useStockAsset\(mint\);/, "the company read as its page reads it");
  assert.match(SELL_SHEET, /saleAssetOf\(current, lang\)/);
  /* The column on a desk; the details' place on a phone. */
  assert.match(HOLDINGS_CSS, /minmax\(56px, 0\.5fr\) 96px 32px;/);
  assert.match(HOLDINGS_CSS, /\.row\[data-sell="true"\] \{\s*grid-template-columns: minmax\(0, 1fr\) auto auto;\s*grid-template-areas:\s*"asset value sell"\s*"asset change sell";/);
});
