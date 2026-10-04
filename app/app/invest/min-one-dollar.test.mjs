import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BUDGET_MINIMUM_USD, BUDGET_PRESETS_USD, RULE_DEFAULT_USD, RULE_MINIMUM_USD } from "../../../lib/autoinvest/limits.ts";
import { STOCK_QUOTE_PRESETS_USD } from "../../../lib/stocks/units.ts";
import { openingSchedule } from "./autoinvest-model.ts";
import { BUY_SHARE_PRESETS_PCT, buyCosts, DEFAULT_BUY_USD, isNoRoute, MIN_BUY_USD, reserveOverPurchase, shareOfRaw, ROUTE_MINIMUM_LADDER_USD, ROUTE_MINIMUM_RETRY_MS, routeMinimumSteps } from "./company-model.ts";
import { fundingNeed, fundsOf } from "./funding-model.ts";
import { INVEST_WORDS, reserveFirstLine, reserveLine, routeMinimumLine, setMinimumWord } from "./invest-words.ts";

/**
 * «Від $1»: a purchase, an «Автоінвест» rule and the month's budget from one
 * dollar; a company without a route at the sum says its own minimum, read
 * from the live quote; the one-time reserve that opens a token's account is
 * its own line in «Перевірка», never a cost.
 */

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const BUY_SHEET = source("../stocks/[ticker]/buy-sheet.tsx");
const CONVERT_SHEET = source("../stocks/[ticker]/convert-sheet.tsx");
const RULE_SHEET = source("../stocks/[ticker]/autoinvest-sheet.tsx");
const ACTIONS = source("../stocks/[ticker]/company-actions.tsx");

test("a purchase, a rule and the month's budget start at one dollar; the purchase's quick choices are shares of the wallet's USDC", () => {
  assert.equal(MIN_BUY_USD, 1);
  assert.equal(RULE_MINIMUM_USD, 1);
  assert.equal(BUDGET_MINIMUM_USD, 1);
  /* The purchase's quick choices are shares of the wallet's USDC, not sums; the dollar examples stay only in the deal's comparison under «Деталі». */
  assert.deepEqual([...BUY_SHARE_PRESETS_PCT], [25, 50, 75, 100]);
  assert.deepEqual([...STOCK_QUOTE_PRESETS_USD], [1, 5, 10, 25]);
  /* 24.5 USDC: a quarter is $6.12 (never rounded up), all of it exactly $24.50. */
  assert.equal(shareOfRaw(24_500_000n, 6, 25), 6.12);
  assert.equal(shareOfRaw(24_500_000n, 6, 50), 12.25);
  assert.equal(shareOfRaw(24_500_000n, 6, 75), 18.37);
  assert.equal(shareOfRaw(24_500_000n, 6, 100), 24.5);
  assert.equal(shareOfRaw(0n, 6, 100), 0);
  assert.equal(shareOfRaw(3_000_000n, 6, 25), 0.75, "a share under a dollar is computed, and the sheet does not offer it");
  assert.match(BUY_SHEET, /BUY_SHARE_PRESETS_PCT\.map\(\(pct\) => \{/);
  assert.match(BUY_SHEET, /disabled=\{busy \|\| share < MIN_BUY_USD\}/);
  assert.doesNotMatch(BUY_SHEET, /STOCK_QUOTE_PRESETS_USD/, "the purchase offers no fixed sums");
  assert.doesNotMatch(RULE_SHEET, /STOCK_QUOTE_PRESETS_USD|company\.presets/, "a rule's sum is typed, any sum the person likes: no quick sums");
  /* A dollar a day never runs into the ceiling: the longest month is 31 days. */
  assert.deepEqual([...BUDGET_PRESETS_USD], [31, 50, 100, 200]);
  assert.equal(BUDGET_PRESETS_USD[0], 31 * 1);
  /* The sheets open on $10 — a default, not advice: each person buys on their own budget. */
  assert.equal(DEFAULT_BUY_USD, 10);
  assert.equal(RULE_DEFAULT_USD, 10);
  assert.match(BUY_SHEET, /const DEFAULT_USD = DEFAULT_BUY_USD;/);
  assert.match(RULE_SHEET, /: RULE_DEFAULT_USD\)\);/);
});

test("a wallet with a dollar of USDC and the network's SOL is ready to buy", () => {
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const sol = { kind: "NATIVE_SOL", mint: null, amountRaw: "20000000", decimals: 9, symbol: "SOL", catalog: { symbol: "SOL", name: "Wrapped SOL", usdPrice: "200", category: "crypto" } };
  const usdc = (dollars) => ({ kind: "TOKEN", mint: USDC, amountRaw: String(Math.round(dollars * 1e6)), decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", usdPrice: "1", category: "crypto" } });
  assert.equal(fundingNeed(fundsOf([sol, usdc(1)], true)), "ready");
  assert.equal(fundingNeed(fundsOf([sol, usdc(0.99)], true)), "usdc");
});

test("no route for the sum: the ladder above it, in order, and only «no route» is answered by a larger sum", () => {
  assert.deepEqual([...ROUTE_MINIMUM_LADDER_USD], [2, 5, 10, 25, 50, 100]);
  assert.deepEqual(routeMinimumSteps(1), [2, 5, 10, 25, 50, 100]);
  assert.deepEqual(routeMinimumSteps(5), [10, 25, 50, 100], "only sums above the one asked");
  assert.deepEqual(routeMinimumSteps(7.5), [10, 25, 50, 100]);
  assert.deepEqual(routeMinimumSteps(100), [], "nothing above the ladder is claimed");
  assert.deepEqual(routeMinimumSteps(Number.NaN), []);
  /* The quote route's own code for the venue's «no route» (`/api/solana/swap/quote`: 409 `QUOTE_NO_ROUTE`). */
  assert.equal(isNoRoute("QUOTE_NO_ROUTE"), true);
  assert.equal(isNoRoute("NO_ROUTE"), true);
  assert.equal(isNoRoute("QUOTE_RATE_LIMITED"), false, "a venue that does not answer says nothing about a minimum");
  assert.equal(isNoRoute("ASSET_NOT_OFFERED"), false);
  assert.equal(isNoRoute(null), false);
  /* An answer held back — a rate limit, or the venue's passing 400 with no code, both seen on the stand — is asked again after a pause; only «no route» moves the ladder up, and a refusal that outlasts the pauses claims no minimum. */
  assert.deepEqual([...ROUTE_MINIMUM_RETRY_MS], [1_500, 3_000, 6_000]);
  const HOOK = source("./use-route-minimum.ts");
  assert.match(HOOK, /for \(const pause of ROUTE_MINIMUM_RETRY_MS\) \{\s*if \(result\.ok \|\| isNoRoute\(result\.code\) \|\| controller\.signal\.aborted\) break;/);
  assert.match(HOOK, /if \(!isNoRoute\(result\.code\)\) break;/, "any other refusal claims no minimum");
});

test("the one-time reserve is never a cost, and the Review says it first only when it is more than the purchase", () => {
  /* $1 of an xStock the wallet does not hold: the chain-proven 179-byte Token-2022 account, 1,559,560 lamports, at SOL $200. */
  const costs = buyCosts({ spendUsd: 1, inUsdValue: "0.9998", outUsdValue: "0.9905", totalFeeBasisPoints: 50, priceImpactPct: "-0.004", signatureFeeLamports: "5000", priorityFeeLamports: "0", rentFeeLamports: "1559560", solUsd: 200 });
  assert.ok(Math.abs(costs.accountUsd - 0.311912) < 1e-9, `reserve ${costs.accountUsd}`);
  assert.ok(costs.totalUsd < 0.02, `the costs stay the costs: ${costs.totalUsd}`);
  assert.equal(reserveOverPurchase(costs.accountUsd, 1), false);
  assert.equal(reserveOverPurchase(1.2, 1), true, "a reserve above the purchase is said first");
  assert.equal(reserveOverPurchase(null, 1), false);
});

test("the words, in both languages: the reserve apart, the company's own minimum, a dollar everywhere", () => {
  assert.equal(reserveLine("uk", "≈ $0,24"), "≈ $0,24 у SOL разово лишаються в гаманці на рахунку токена");
  assert.equal(reserveLine("en", "≈ $0.24"), "≈ $0.24 in SOL, once — it stays in your wallet, on the token's account");
  assert.equal(reserveFirstLine("uk", "≈ $1,20", "$1"), "Разовий резерв ≈ $1,20 у SOL більший за саму покупку ($1). Він лишиться в гаманці на рахунку токена — це не витрата.");
  assert.match(reserveFirstLine("en", "≈ $1.20", "$1"), /^The one-time reserve, ≈ \$1\.20 in SOL, is more than the purchase itself \(\$1\)\. It stays in your wallet/);
  assert.equal(routeMinimumLine("uk", "$1", "IREN", "$5"), "На $1 маршруту зараз немає. IREN — від $5.");
  assert.equal(routeMinimumLine("en", "$1", "IREN", "$5"), "No route for $1 right now. IREN from $5.");
  assert.equal(setMinimumWord("uk", "$5"), "Поставити $5");
  assert.equal(setMinimumWord("en", "$5"), "Use $5");
  assert.equal(INVEST_WORDS.guestHeadline.uk, "Купи частинку компанії від $1");
  assert.equal(INVEST_WORDS.stepTopUp.uk, "Поповни від $1");
  assert.equal(INVEST_WORDS.minimum.uk, "Мінімум — $1");
  assert.equal(INVEST_WORDS.neededFrom.en, "needed from $1");
  for (const [key, pair] of Object.entries(INVEST_WORDS)) {
    assert.doesNotMatch(`${pair.en} ${pair.uk}`, /(from|від|Мінімум —|minimum is|needed from|потрібно від)\s*\$10(?![\d,.])/i, `${key} keeps no old minimum of $10`);
    assert.doesNotMatch(`${pair.en} ${pair.uk}`, /recommend|рекоменд/i, `${key} recommends no sum — everyone buys on their own budget`);
  }
});

test("the rule's sheet opens weekly on $10 — a default, not advice — and every day from a dollar is the person's own choice", () => {
  const now = Date.parse("2026-09-25T10:10:00.000Z");
  const opening = openingSchedule(now, "Europe/Kyiv");
  assert.deepEqual([opening.cadence, opening.weekday, opening.time], ["weekly", 5, "14:00"], "today's weekday, the next full hour on the person's clock (13:10 Kyiv)");
  const daily = openingSchedule(now, "Europe/Kyiv", "daily");
  assert.deepEqual([daily.cadence, daily.weekday], ["daily", null], "every day is one tap on «Щодня»");
  assert.match(RULE_SHEET, /openingSchedule\(Date\.now\(\), browserTimeZone\(\), mode\.kind === "compose" \? mode\.cadence : undefined\)/);
  assert.match(ACTIONS, /setSheet\(\{ kind: "compose", amountUsd, cadence: "weekly" \}\)/);
});

test("«Перевірка» keeps four rows: the reserve is a line of its own under «Усі витрати», never joined to the costs", () => {
  for (const [name, sheet] of [["buy", BUY_SHEET], ["convert", CONVERT_SHEET]]) {
    assert.doesNotMatch(sheet, /word\("and"\)|accountOnce/, `${name}: no «і … разово» after the costs`);
    assert.match(sheet, /<dd data-reserve>\{reserveLine\(locale, /, `${name}: the reserve is its own line`);
  }
  const review = BUY_SHEET.slice(BUY_SHEET.indexOf('data-sheet="review"'));
  assert.ok(review.indexOf("data-reserve-first") < review.indexOf("<dl"), "said before the rows when it is more than the purchase");
  assert.equal((review.slice(0, review.indexOf("</dl>")).match(/<dt>/g) ?? []).length, 4, "four rows");
});

test("a company with no route for the sum says its own minimum from the quote, and the one action puts it in", () => {
  assert.match(BUY_SHEET, /const noRoute = !ruleMode && valid && isNoRoute\(ticket\.quoteFailure\?\.code\);/);
  assert.match(BUY_SHEET, /useRouteMinimum\(mint, valid \? amount : null, noRoute\)/);
  assert.match(BUY_SHEET, /label: setMinimumWord\(locale, dollars\(minimumUsd, numbers\)\), disabled: false, run: \(\) => pickAmount\(minimumUsd\)/);
  /* 1.19.0: a «З кожної оплати» rule's minimum is what must route; every other kind's typed sum. */
  assert.match(RULE_SHEET, /const routedSum = kind === "payments" \? thresholdUsd : typedValid \? typed : null;/);
  assert.match(RULE_SHEET, /useQuoteRoute\(mint, routedSum, composing\)/);
  assert.match(RULE_SHEET, /run: \(\) => setAmountText\(String\(minimumUsd\)\)/);
});
