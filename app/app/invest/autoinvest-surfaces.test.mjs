// Run from repo root: node --test app/app/invest/autoinvest-surfaces.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * «Автоінвест» made clear: the block on Home and in Portfolio for every
 * connected wallet, the rule's purchase first while its reminder is open, the
 * ordinary purchase second and saying the reminder stays open — on a company's
 * page and in Spot — and the month's budget as its own line, never the rule's
 * sum. Words and the order of actions only: the execution path, the checks and
 * the contract do not move.
 */

const read = (path) => readFileSync(new URL("../../../" + path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ");

const HOME = code("app/app/home/home-surface.tsx");
const ASIDE = code("app/app/home/home-aside.tsx");
const BLOCK = code("app/app/invest/autoinvest-block.tsx");
const ROW = code("app/app/invest/budget-row.tsx");
const HOLDINGS = code("app/solana/workspace/holdings/holdings-card.tsx");
const HOLDINGS_CSS = read("app/solana/workspace/holdings/holdings.module.css");
const ACTIONS = code("app/app/stocks/[ticker]/company-actions.tsx");
const BUY = code("app/app/stocks/[ticker]/buy-sheet.tsx");
const RULE_SHEET = code("app/app/stocks/[ticker]/autoinvest-sheet.tsx");
const BUDGET_SHEET = code("app/app/invest/budget-sheet.tsx");
const TICKET = code("app/solana/workspace/spot/order-ticket.tsx");
const NOTICE = code("app/app/invest/rule-reminder-notice.tsx");

test("«Автоінвест» is on Home for every connected wallet — not held back until the wallet can buy", () => {
  /* The block stands in Home's right column — beside the main one on a desk, under it on a phone. */
  assert.match(HOME, /<HomeAside locale=\{locale\} \/>/, "Home draws its right column");
  assert.match(ASIDE, /import \{ AutoinvestBlock \} from "@\/app\/app\/invest\/autoinvest-block"/);
  const call = ASIDE.indexOf("<AutoinvestBlock locale={locale} compact />");
  assert.ok(call > 0, "the column draws the block");
  const line = ASIDE.slice(ASIDE.lastIndexOf("\n", call), call);
  assert.match(line, /\{connection \? $/, "for a connected wallet; a guest reads what it is in one line");
  assert.doesNotMatch(line, /&&|funds|need/, "the block is drawn with no condition on the wallet's funds");
});

test("Portfolio lists the rules — the same block, under the value on a desk and after the positions on a phone", () => {
  assert.match(HOLDINGS, /import \{ AutoinvestBlock \} from "@\/app\/app\/invest\/autoinvest-block"/);
  assert.match(HOLDINGS, /<div className=\{styles\.autoinvest\}>\s*<AutoinvestBlock locale=\{locale\} \/>\s*<\/div>/);
  assert.ok(HOLDINGS.indexOf("<AutoinvestBlock") > HOLDINGS.indexOf("<WalletGate"), "a guest reads the wallet gate; the rules are a connected wallet's");
  assert.match(HOLDINGS_CSS, /grid-template-areas:\s*"value holdings"\s*"rules holdings";/);
  assert.match(HOLDINGS_CSS, /grid-template-areas:\s*"value"\s*"holdings"\s*"rules";/);
  assert.match(HOLDINGS_CSS, /\.autoinvest \{[^}]*grid-area: rules;/);
});

test("the month's budget is its own line: «Бюджет не задано · Задати» or «Бюджет місяця $10 з $50 · Змінити»", () => {
  assert.match(ROW, /budgetView\(budget\)/);
  assert.match(ROW, /word\("budgetNotSet"\)/);
  assert.match(ROW, /word\("setShort"\)/);
  assert.match(ROW, /aria-label=\{word\("setBudget"\)\}/);
  assert.match(ROW, /word\("monthBudget"\)[\s\S]*usdWord\(view\.countedUsd, lang\)\} \$\{word\("of"\)\} \$\{usdWord\(view\.capUsd, lang\)\}/);
  assert.match(ROW, /aria-label=\{word\("changeBudget"\)\}/);
  assert.match(BLOCK, /<BudgetRow budget=\{state\.budget\} locale=\{locale\} variant="block"/);
  /* The line bounds rules: it shows once there is a rule or a ceiling already set. */
  assert.match(BLOCK, /const showBudget = state\.budget !== null && \(state\.rules\.length > 0 \|\| state\.budget\.capUsd !== null\)/);
  assert.doesNotMatch(BLOCK, /BudgetBar|noBudgetYet/, "the quiet «без стелі» beside the month's sum is gone");
});

test("a rule's sheet: its sum is «Кожна купівля», the budget its own line and its own sheet — no ceilings beside the sum", () => {
  assert.match(RULE_SHEET, /word\("eachPurchase"\)/);
  assert.match(RULE_SHEET, /<BudgetRow budget=\{budget\} locale=\{locale\} variant="sheet" onEdit=\{onEditBudget\} \/>/);
  assert.doesNotMatch(RULE_SHEET, /budgetChips|noCap|BUDGET_PRESETS_USD|onSetBudget|onClearBudget/, "the budget is never chosen beside the rule's sum");
  /* The budget's sheet is a sibling of the rule's, never inside it: a dialog's close inside another would close both. */
  assert.doesNotMatch(RULE_SHEET, /<BudgetSheet/);
  assert.match(ACTIONS, /onEditBudget=\{\(\) => setBudgetOpen\(true\)\}/);
  assert.match(BLOCK, /onEditBudget=\{\(\) => setBudgetOpen\(true\)\}/);
  assert.match(BUDGET_SHEET, /word\("atMostPerMonth"\)/);
});

test("while a rule's reminder is open, the company's first action is the rule's purchase and the ordinary one says the reminder stays open", () => {
  assert.match(ACTIONS, /const due = rule \? reminderOpenNow\(rule, nowMs\) : null;/);
  /* 1.19.0: on the reminder's own sum — a «З кожної оплати» reminder's gathered sum, every other rule's sum. */
  assert.match(ACTIONS, /const ruleOffer: RuleOffer \| null = rule && due \? \{ amountUsd: purchaseSumUsd\(rule, due\), context: `\$\{word\("timeToBuy"\)\} · \$\{ruleWhenLine\(rule, lang\)\}`, onBuy: \(\) => buyNow\(rule, due\) \} : null;/);
  assert.match(ACTIONS, /ruleOffer=\{ruleOffer\}/);
  const offer = BUY.slice(BUY.indexOf("{ruleOffer ? ("), BUY.indexOf("<dialog"));
  const first = offer.indexOf("rw-btn--primary");
  const second = offer.indexOf('word("plainPurchase")');
  assert.ok(first > 0 && second > first, "the orange action first, the ordinary purchase after it");
  assert.match(offer, /onClick=\{ruleOffer\.onBuy\}[\s\S]*buyByRuleWord\(props\.locale, ruleOffer\.amountUsd\)/);
  assert.match(offer, /className=\{`rw-btn \$\{company\.plainBuy\}`\}/, "the ordinary purchase is quiet — one orange action on the screen");
  assert.match(offer, /word\("reminderStaysOpen"\)/);
  /* Its sheet says so before any sum, and the reminder's own sheet buys «$X за правилом». */
  assert.match(BUY, /data-rule-open>\s*\{plainLeavesOpenLine\(locale, ruleOffer\.amountUsd\)\}/);
  assert.match(BUY, /label: buyByRuleWord\(locale, ruleSum \?\? rule\.amountUsd\)/);
  assert.match(BUY, /const ruleSum = rule \? purchaseSumUsd\(rule, occurrence\) : null;/);
  assert.match(RULE_SHEET, /buyByRuleWord\(locale, purchaseSumUsd\(rule, due\)\)/);
});

test("an ordinary purchase closed beside an open reminder does not end the rule's purchase pressed next", () => {
  assert.match(BUY, /if \(wasOpen\.current && !open\) closedOnRule\.current = ruleKey !== null;/);
});

test("Spot says it too: a purchase there leaves the reminder open, with the way to the rule's own purchase", () => {
  assert.match(TICKET, /import \{ RuleReminderNotice \} from "@\/app\/app\/invest\/rule-reminder-notice"/);
  assert.match(TICKET, /connection && side === "BUY" \? <RuleReminderNotice mint=\{baseMint\} proven=\{proven\} locale=\{locale\} className=\{styles\.ruleReminder\} \/> : null/);
  assert.ok(TICKET.indexOf("<RuleReminderNotice") < TICKET.indexOf("className={styles.cta} disabled={cta.disabled}"), "said before the action");
  assert.match(NOTICE, /useAutoinvestRules\(proven\)/);
  assert.match(NOTICE, /reminderOpenNow\(rule, nowMs\)/);
  assert.match(NOTICE, /word\("reminderOpenHere"\)[\s\S]*word\("plainHereLeavesOpen"\)[\s\S]*rulePurchaseHref\(rule, due\.dueAt\)[\s\S]*buyByRuleWord\(locale, purchaseSumUsd\(rule, due\)\)/);
  assert.doesNotMatch(NOTICE, /rw-btn--primary/, "a line, never a second orange action");
});

test("the path is the same: nothing here orders, signs, executes or changes the contract", () => {
  for (const [name, source] of [["block", BLOCK], ["row", ROW], ["notice", NOTICE]]) {
    assert.doesNotMatch(source, /\/api\/solana\/swap|signTransaction|\/execute/, `${name} reaches the execution path`);
  }
});
