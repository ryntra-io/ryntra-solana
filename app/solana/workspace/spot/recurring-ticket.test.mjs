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
const TICKET = read("./spot-ticket.tsx");
const WORKSPACE = read("./spot-workspace.tsx");
const PAGE = read("./page.tsx");
const SHEET = read("../../../app/stocks/[ticker]/autoinvest-sheet.tsx");
const BLOCK = read("../../../app/invest/autoinvest-block.tsx");
const CATALOG = read("../i18n/catalog.ts");

test("«Регулярно» stands beside the order on every token: the rule's own flow in the ticket's place", () => {
  assert.match(TICKET, /data-recurring-open/);
  assert.match(TICKET, /text\("Recurring buy"\)/);
  assert.match(TICKET, /onClick=\{\(\) => setRecurring\(true\)\}/);
  assert.match(TICKET, /<AutoinvestPanel[\s\S]*token=\{!isStockMarket\}/, "a coin, a meme or a new token reads its standing; a company its reference");
  assert.match(TICKET, /mode=\{tokenRule \? \{ kind: "manage", rule: tokenRule \} : \{ kind: "compose", amountUsd: null \}\}/, "a token with a rule manages it; one without composes");
  assert.match(TICKET, /<BudgetSheet open=\{budgetOpen\}/, "the month's budget opens over the ticket, never beside the rule's sum");
  assert.match(TICKET, /text\("Back to the order"\)/, "and the way back to the order");
  for (const key of ["Recurring buy", "Back to the order", "By your rule", "Your rule", "Not under this rule", "Reading the rule…"]) {
    assert.ok(CATALOG.includes(`"${key}":`), `«${key}» has its Ukrainian line`);
  }
});

test("a reminder's link makes the ticket the rule's purchase: buy, in USDC, the rule's sum held, origin.rule only while it is open", () => {
  assert.match(PAGE, /RULE_ID\.test\(params\.rule\) && Number\.isFinite\(dueMs\)/, "a well-formed rule id and an instant, or nothing");
  assert.match(WORKSPACE, /useState<RuleBinding \| null>\(initialRule\)/);
  assert.match(WORKSPACE, /ruleBinding=\{ruleBinding\}[\s\S]*onRuleBuy=\{buyByRule\}[\s\S]*onLeaveRule=\{leaveRule\}/);
  assert.match(TICKET, /ruleBinding: underRule \? ruleBinding : null/, "the binding travels only while the reminder is open");
  assert.match(TICKET, /reminderOpenNow\(boundRule, clockMs\)\?\.dueAt === boundOccurrence\.dueAt/);
  assert.match(TICKET, /setQuoteMint\(SPOT_QUOTE_ASSETS\[0\]\.mint\);[\s\S]{0,160}side: "buy", type: "market", unit: "token", amount: Number\.isInteger\(ruleSumUsd\)/);
  /* The sum is set after the new market's reset, which runs in the same commit — otherwise it is wiped as soon as it is written. */
  assert.ok(TICKET.indexOf("/* A new market is a new ticket. */") < TICKET.indexOf("amount: Number.isInteger(ruleSumUsd)"));
  assert.match(TICKET, /const onDraftChangeAllowed = !\(underRule \|\| busy \|\| limitBusy\);/, "the rule's sum, its side and its type are not typed over");
  assert.match(TICKET, /onDraftChange=\{onDraftChangeAllowed \? changeDraft : undefined\}/);
  assert.match(TICKET, /if \(underPlan && \(next\.side === "sell" \|\| next\.type === "limit"\)\) return;/, "a plan's purchase is never a sale");
  assert.match(TICKET, /onReview=\{boundWait \? undefined : onReview\}/, "no plain order stands in for a reminder that is not open");
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
