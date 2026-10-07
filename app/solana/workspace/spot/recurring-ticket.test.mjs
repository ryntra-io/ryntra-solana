// Run from repo root: node --test app/solana/workspace/spot/recurring-ticket.test.mjs
/**
 * «Регулярно» beside «Ринок» in every token's order (1.31.0): the rule's flow
 * inside Spot's ticket, the reminder's link that turns the ticket into the
 * rule's purchase, and the sheet that reads a token's floor and facts of risk
 * before its button. Read from the sources: nothing here renders or trades.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const TICKET = read("./order-ticket.tsx");
const WORKSPACE = read("./spot-workspace.tsx");
const PAGE = read("./page.tsx");
const SHEET = read("../../../app/stocks/[ticker]/autoinvest-sheet.tsx");
const BLOCK = read("../../../app/invest/autoinvest-block.tsx");
const CATALOG = read("../i18n/catalog.ts");

test("the order types sit side by side on every token: «Ринок» and «Регулярно», the rule's own flow inside the ticket", () => {
  assert.match(TICKET, /role="tablist"\s*aria-label=\{text\("Order type"\)\}/);
  assert.match(TICKET, /event\.key !== "ArrowLeft" && event\.key !== "ArrowRight"/, "the arrows move between the order types");
  assert.match(TICKET, /text\("Market"\)[\s\S]*text\("Recurring"\)/);
  assert.match(TICKET, /<AutoinvestPanel[\s\S]*token=\{!isStockMarket\}/, "a coin, a meme or a new token reads its standing; a company its reference");
  assert.match(TICKET, /mode=\{tokenRule \? \{ kind: "manage", rule: tokenRule \} : \{ kind: "compose", amountUsd: null \}\}/, "a token with a rule manages it; one without composes");
  assert.match(TICKET, /<BudgetSheet open=\{budgetOpen\}/, "the month's budget opens over the ticket, never beside the rule's sum");
  for (const key of ["Order type", "Recurring", "By your rule", "Your rule", "Bought by your rule", "Not under this rule", "Reading the rule…"]) {
    assert.ok(CATALOG.includes(`"${key}":`), `«${key}» has its Ukrainian line`);
  }
});

test("a reminder's link makes the ticket the rule's purchase: buy, in USDC, the rule's sum held, origin.rule only while it is open", () => {
  assert.match(PAGE, /RULE_ID\.test\(params\.rule\) && Number\.isFinite\(dueMs\)/, "a well-formed rule id and an instant, or nothing");
  assert.match(WORKSPACE, /useState<RuleBinding \| null>\(initialRule\)/);
  assert.match(WORKSPACE, /ruleBinding=\{ruleBinding\}[\s\S]*onRuleBuy=\{buyByRule\}[\s\S]*onLeaveRule=\{leaveRule\}/);
  assert.match(TICKET, /ruleBinding: underRule \? ruleBinding : null/, "the binding travels only while the reminder is open");
  assert.match(TICKET, /reminderOpenNow\(boundRule, clockMs\)\?\.dueAt === boundOccurrence\.dueAt/);
  assert.match(TICKET, /setSide\("BUY"\);\s*setQuoteMint\(SPOT_QUOTE_ASSETS\[0\]\.mint\);/);
  /* The sum is set after the new market's reset, which runs in the same commit — otherwise it is wiped as soon as it is written. */
  assert.ok(TICKET.indexOf("/* A new market is a new ticket. */") < TICKET.indexOf("setAmount(Number.isInteger(ruleSumUsd)"));
  assert.match(TICKET, /disabled=\{busy \|\| !baseMint \|\| underRule\}/, "the rule's sum is not typed over");
  assert.match(TICKET, /\(underPlan \|\| underRule\) && entry === "SELL"/, "a rule's purchase is never a sale");
  assert.match(TICKET, /if \(ruleState && ruleState !== "ready" && action !== "RECOVER" && phase !== "SETTLED"\)/, "no plain order stands in for a reminder that is not open");
  assert.match(TICKET, /code === "RULE_LIQUIDITY_LOW"/, "the floor's refusal is said in the person's words");
});

test("a token's sheet: the floor and, for a meme or a new token, the facts of risk before the button; a token no rule can name offers nothing to fill in", () => {
  assert.match(SHEET, /useRuleAsset\(mint, token && mode\.kind === "compose"\)/);
  assert.ok(SHEET.indexOf("<RiskFacts read={tokenFacts}") < SHEET.indexOf("className={company.kindSwitch}"), "the facts come before the rule's controls");
  assert.match(SHEET, /if \(token && tokenBlock\) \{/, "a blocked token returns before the composer");
  assert.match(SHEET, /useState<number \| null>\(token \|\| conditionReference === null \? null : PRICE_CONDITION_DEFAULT_PCT\)/, "a token opens on «Без умови»");
  assert.match(SHEET, /anchorNowLine\(tokenPrice, limitPct, lang\)/, "a token's condition says the ceiling the price now makes");
  assert.match(SHEET, /ticket \? word\("scheduleShort"\) : word\("regularly"\)/, "inside the ticket the tab already says «Регулярно»");
  assert.match(SHEET, /compact=\{ticket\}/, "in Spot the facts the market's header states are not repeated");
});

test("«Мої боти» and Home: any token the wallet holds may get a rule — never the dollars it pays with — and a token's card opens its market", () => {
  assert.match(BLOCK, /holding\.catalog\?\.category === "stock" \|\| holding\.catalog\?\.category === "crypto" \|\| holding\.catalog\?\.category === "meme"/);
  assert.match(BLOCK, /holding\.mint !== SOLANA_MAINNET_USDC_MINT/);
  assert.match(BLOCK, /due \? rulePurchaseHref\(rule, due\.dueAt\) : ruleAssetHref\(rule\)/);
  assert.match(BLOCK, /token=\{picked\?\.token \?\? false\}/);
});
