import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { INVEST_WORDS } from "./invest-words.ts";
import { SALE_MAY_FAIL } from "../../../lib/stocks/check.ts";

/**
 * «Перевірка» from the server (contract 1.20.0): the purchase's and the
 * sale's sheets draw the four lines and the reserve the quote and the order
 * answer as `check`, and count none of them; «Популярне» on Home and beside a
 * company's page is the server's one list.
 */

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const BUY_SHEET = source("../stocks/[ticker]/buy-sheet.tsx");
const SELL_SHEET = source("../stocks/[ticker]/sell-sheet.tsx");
const QUOTE_ROUTE = source("../../api/solana/swap/quote/route.ts");
const ORDER_ROUTE = source("../../api/solana/swap/order/route.ts");
/* The swap's shared safety chain, where the simulation's proven rent replaces the venue's estimate on the order. */
const GUARD = source("../../../lib/core/solana-swap/guard.ts");
const HOME = source("../home/page.tsx");
const FACTS = source("../stocks/[ticker]/company-facts-blocks.tsx");
const TICKET = source("../../solana/workspace/spot/use-spot-ticket.ts");

test("the quote and the order count «Перевірка» on the order they answer — the quote with no reserve, the order with the proven one", () => {
  assert.match(QUOTE_ROUTE, /const checkContext = readCheckContext\(input\.inputMint, input\.outputMint\);/, "the company and SOL's price read beside the venue's quote");
  assert.match(QUOTE_ROUTE, /swapCheckOf\(\{ context, basis: "quote", order, decimals,/);
  assert.match(ORDER_ROUTE, /const checkContext = readCheckContext\(input\.inputMint, input\.outputMint\);/);
  assert.match(ORDER_ROUTE, /swapCheckOf\(\{ context, basis: "order", order, decimals,/);
  /* The order's check is counted after the simulation's rent replaced the venue's estimate: the effect firewall writes the proven rent onto the pipeline's order, and the route reads that order only after the pipeline ran. */
  const firewall = GUARD.slice(GUARD.indexOf('name: "effect-firewall"'), GUARD.indexOf('name: "review-policy"'));
  assert.match(firewall, /rentFeeLamports: provenRent[\s\S]*context\.order = order;/);
  const ran = ORDER_ROUTE.indexOf("await prepareSolanaSwap(swap)");
  const read = ORDER_ROUTE.indexOf("const order = swap.order");
  assert.ok(ran > 0 && ran < read && read < ORDER_ROUTE.indexOf('basis: "order"'));
  for (const route of [QUOTE_ROUTE, ORDER_ROUTE]) {
    assert.match(route, /\n      check,\n/, "the answer carries it");
    assert.match(route, /const context = await awaitCheckContext\(checkContext\);/, "an answer otherwise ready waits for the lines a bounded moment, never longer");
  }
  assert.match(TICKET, /check\?: SwapCheck \| null;/);
});

test("the sheets draw the server's lines and count none of them", () => {
  for (const [name, sheet] of [["purchase", BUY_SHEET], ["sale", SELL_SHEET]]) {
    assert.match(sheet, /const check: SwapCheck \| null = prepared \? \(prepared\.check \?\? null\) : \(quoted\?\.check \?\? null\);/, `${name}: the order's lines once a Review is prepared, the quote's before`);
    assert.doesNotMatch(sheet, /buyCosts\(|reserveOverPurchase\(|WRAPPED_SOL_MINT|solUsd/, `${name}: no count of the costs, the reserve or SOL on the page`);
    assert.match(sheet, /costs \? approxUsd\(costs\.usd, numbers\) : "—"/, `${name}: «Усі витрати» the server's, a dash where it could not count`);
    assert.match(sheet, /costs\.issuerFee\.basisPoints/, `${name}: the issuer's fee the server read from the chain`);
    assert.match(sheet, /lines\?\.reserve\?\.usd \? approxUsd\(lines\.reserve\.usd, numbers\) : null/, `${name}: the order's proven reserve`);
    assert.match(sheet, /lines \? lines\.what\.truth\[lang\] : truth/, `${name}: «Що це» as the server says it`);
    assert.match(sheet, /data-check=\{lines \? lines\.basis : "none"\}/);
  }
  assert.match(BUY_SHEET, /const reserveFirst = reserve !== null && lines\?\.reserve\?\.first === true && paid !== null;/, "the purchase says the reserve first when the server says it is more than the purchase");
  assert.match(BUY_SHEET, /lines\.what\.note\?\.kind === "issuer-event"/);
  assert.match(SELL_SHEET, /lines\.what\.note\?\.kind === "sale-may-fail"/);
});

test("«Продати може не вийти» is one sentence — the server's and the sheet's words are the same", () => {
  assert.equal(INVEST_WORDS.saleMayFail.uk, SALE_MAY_FAIL.uk);
  assert.equal(INVEST_WORDS.saleMayFail.en, SALE_MAY_FAIL.en);
});

test("«Популярне» on Home and beside a company's page is the server's one list", () => {
  assert.match(HOME, /popularCompanies\(read\.universe\.rows, \{ limit: POPULAR_LIMIT \}\)/);
  assert.match(FACTS, /popularCompanies\(read\.universe\.rows, \{ limit: 6, exclude: mint \}\)/);
  assert.doesNotMatch(HOME + FACTS, /shelfCompanies\(/, "no second list");
});
