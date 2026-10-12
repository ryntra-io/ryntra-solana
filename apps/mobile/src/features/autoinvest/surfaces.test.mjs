import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/*
 * «Автоінвест» made clear on the phone — the
 * web's own (`app/app/invest/autoinvest-surfaces.test.mjs`): the block on
 * Home and in Portfolio for every connected wallet, the rule's purchase first
 * while its reminder is open and the ordinary purchase second, saying the
 * reminder stays open — on a company's page and on Trade — and the month's
 * budget as its own line, never the rule's sum. Words and the order of
 * actions only: the purchase's path, its checks and the contract do not move.
 */

// The source without its comments: a block comment first (a JSX one leaves its braces empty), then whole-line ones.
const code = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

const HOME = code('screens/home/investor.tsx')
const PORTFOLIO = code('screens/portfolio/index.tsx')
const BOTS = code('screens/bots/index.tsx')
const BLOCK = code('screens/autoinvest/rules-block.tsx')
const ROW = code('screens/autoinvest/budget-row.tsx')
const RULE_SHEET = code('screens/autoinvest/autoinvest-sheet.tsx')
const BUDGET_SHEET = code('screens/autoinvest/budget-sheet.tsx')
const ASSET = code('screens/asset/index.tsx')
const BUY = code('screens/invest/buy-sheet.tsx')
const TRADE = code('screens/trade/index.tsx')
const NOTICE = code('screens/autoinvest/rule-reminder-notice.tsx')

test('«Автоінвест» is on Home for every connected wallet — not held back until it signs in', () => {
  assert.match(HOME, /\{state === 'guest' \? null : <RulesBlock session=\{account\.session\} place="home" \/>\}/)
  assert.doesNotMatch(HOME, /state === 'signed-in' && account\.session \? <RulesBlock/)
  // A wallet not signed in reads one line and a quiet way in; its rules are read behind its session.
  assert.match(
    BLOCK,
    /session \? <SignedInRules session=\{session\} place=\{place\} copy=\{copy\} \/> : <SignInForRules copy=\{copy\} \/>/,
  )
  assert.match(BLOCK, /copy\.signInForRules/)
  assert.doesNotMatch(BLOCK, /<Button[^>]*\n?[^>]*variant="primary"/, 'nothing in the block is orange')
})

test('the rules live in «Боти → Мої боти»: the same block, before the plans; Portfolio keeps only the door', () => {
  assert.match(BOTS, /import \{ RulesBlock \} from '@\/screens\/autoinvest\/rules-block'/)
  assert.match(BOTS, /<RulesBlock session=\{account\.session\} place="bots" \/>/)
  assert.ok(BOTS.indexOf('<RulesBlock') < BOTS.indexOf('<MyPlans />'), 'the rules first, then the plans')
  assert.ok(BOTS.includes('<SessionGate'), 'the rules are read behind the wallet’s session')
  // Portfolio no longer draws the block: «Боти · N активні» is its door, counted only from what was read.
  assert.doesNotMatch(PORTFOLIO, /<RulesBlock/)
  assert.match(PORTFOLIO, /activeCount\(rules\.data\?\.rules \?\? null, plans\.data\?\.plans \?\? null\)/)
})

test('the month’s budget is its own line: «Бюджет не задано · Задати» or «Бюджет місяця $10 з $50 · Змінити»', () => {
  assert.match(ROW, /budgetView\(budget\)/)
  assert.match(ROW, /copy\.budgetNotSet/)
  assert.match(ROW, /unset \? copy\.setShort : copy\.changeShort/)
  assert.match(ROW, /unset \? copy\.setBudget : copy\.changeBudget/)
  assert.match(
    ROW,
    /copy\.monthBudget[\s\S]*dollarsText\(view\.countedUsd, locale\)\} \$\{copy\.of\} \$\{dollarsText\(view\.capUsd, locale\)\}/,
  )
  assert.match(ROW, /`\$\{copy\.budgetSpent\} · \$\{copy\.rulesStand\}`/)
  assert.match(
    BLOCK,
    /<BudgetRow budget=\{budget\} copy=\{copy\} locale=\{locale\} onEdit=\{\(\) => setBudgetOpen\(true\)\} \/>/,
  )
  // The line bounds rules: it shows once there is a rule or a ceiling already set.
  assert.match(BLOCK, /const showBudget = budget !== null && \(list\.length > 0 \|\| budget\.capUsd !== null\)/)
  assert.doesNotMatch(BLOCK, /BudgetBar|noBudgetYet|thisMonth/, 'the quiet «без стелі» beside the month’s sum is gone')
})

test('a rule’s sheet: its sum is «Кожна купівля», the budget its own line and its own sheet — no ceilings beside the sum', () => {
  assert.match(RULE_SHEET, /accessibilityLabel=\{copy\.eachPurchase\}/)
  assert.match(RULE_SHEET, /\{copy\.eachPurchase\}/)
  assert.match(RULE_SHEET, /<BudgetRow budget=\{budget\} copy=\{copy\} locale=\{locale\} onEdit=\{onChangeBudget\} \/>/)
  assert.doesNotMatch(
    RULE_SHEET,
    /capChoices|NO_CAP|noCap|forAllRules|budgetRequest|setBudget\(|clearBudget\(/,
    'the budget is never chosen beside the rule’s sum',
  )
  // The budget's sheet is a sibling of the rule's, stacked over it by the screen — never drawn inside it.
  assert.doesNotMatch(RULE_SHEET, /<BudgetSheet/)
  assert.match(ASSET, /onChangeBudget=\{openBudget\}/)
  assert.match(BUDGET_SHEET, /accessibilityLabel=\{copy\.atMostPerMonth\}/)
  assert.match(BUDGET_SHEET, /\{copy\.atMostPerMonth\}/)
})

test('while a rule’s reminder is open, the company’s first action is the rule’s purchase and the ordinary one says it stays open', () => {
  assert.match(ASSET, /const offer = reminderOffer\(companyRule, budget, now\)/)
  assert.match(ASSET, /when: unbrokenParts\(`\$\{ruleWords\.timeToBuy\} · \$\{ruleWhenLine\(companyRule, locale\)\}`\)/)
  // The reminder's own sum (1.19.0): what a «З оплат» rule gathered; the rule's sum for the other kinds.
  assert.match(ASSET, /buy: ruleWords\.buyByRule\(dollarsText\(offerUsd, locale\)\)/)
  const branch = ASSET.slice(
    ASSET.indexOf('} else if (company && companyRule && offer && offerWords) {'),
    ASSET.indexOf('} else if (company) {'),
  )
  const context = branch.indexOf('{offerWords.when}')
  const first = branch.indexOf('title={offerWords.buy}')
  const second = branch.indexOf('title={ruleWords.plainPurchase}')
  const note = branch.indexOf('{ruleWords.reminderStaysOpen}')
  assert.ok(
    context > 0 && first > context && second > first && note > second,
    'when, the rule’s purchase, the ordinary one, its line',
  )
  assert.match(branch, /onPress=\{\(\) => buyUnder\(companyRule, offer\)\}/)
  assert.match(
    branch.slice(second),
    /variant="secondary"/,
    'the ordinary purchase is quiet — one orange action on the screen',
  )
  // The rule's purchase is the orange one — unless the wallet holds a token whose issuer's swap is open: then
  // the swap above is the page's one orange action and every purchase steps back.
  assert.match(
    branch.slice(first, second),
    /variant=\{swapFirst \? 'secondary' : 'primary'\}/,
    'the rule’s purchase is the orange one',
  )
  // While the reminder speaks through its purchase, the rule's card steps back.
  assert.match(ASSET, /\{\(company \|\| !isStock\) && offer \? null : companyRule \? \(/)
  // The ordinary purchase says so before any sum; the reminder's own sheet buys «$X за правилом».
  assert.match(ASSET, /openReminder=\{offerUsd !== null \? \{ amountUsd: offerUsd \} : null\}/)
  assert.match(
    BUY,
    /openLine=\{openReminder \? ruleWords\.plainLeavesOpen\(dollarsText\(openReminder\.amountUsd, buy\.locale\)\) : null\}/,
  )
  const compose = BUY.slice(BUY.indexOf('function Compose('), BUY.indexOf('function RuleCompose('))
  assert.ok(
    compose.indexOf('{openLine}') > 0 && compose.indexOf('{openLine}') < compose.indexOf('<TextInput'),
    'before any sum',
  )
  assert.match(BUY, /title: ruleWords\.buyByRule\(dollarsText\(action\.usd, locale\)\)/)
  assert.match(RULE_SHEET, /title=\{copy\.buyByRule\(dollarsText\(purchaseSumUsd\(rule, due\), locale\)\)\}/)
})

test('Trade says it too: a Buy there leaves the reminder open, with the way to the rule’s own purchase', () => {
  assert.match(TRADE, /import \{ RuleReminderNotice \} from '@\/screens\/autoinvest\/rule-reminder-notice'/)
  // Not beside the rule's own purchase (1.31.0): there the ticket is it; on a token the notice turns the ticket into it.
  assert.match(
    TRADE,
    /mode === 'buy' && account\.session && !ruleAsk \? \(\s*<RuleReminderNotice\s+session=\{account\.session\}\s+mint=\{legs\.receive\?\.mint \?\? null\}\s+onBuy=\{\(binding\) => setRuleAsk\(binding\)\}/,
  )
  assert.ok(TRADE.indexOf('<RuleReminderNotice') < TRADE.indexOf('<BottomAction'), 'said before the action')
  assert.match(NOTICE, /useRules\(session\)/)
  assert.match(NOTICE, /reminderOffer\(rule, rules\.data\?\.budget \?\? null, now\)/)
  assert.match(
    NOTICE,
    /if \(onBuy && isListedToken\(rule\.asset\)\) onBuy\(\{ ruleId: rule\.id, dueAt: due\.dueAt \}\)\s*else router\.push\(ruleBuyRouteOf\(rule, due\.dueAt\) as never\)/,
    'the company’s page, bound to the rule — a token’s, this ticket',
  )
  assert.match(
    NOTICE,
    /copy\.reminderOpenHere[\s\S]*copy\.plainHereLeavesOpen[\s\S]*onPress=\{buyByRule\}[\s\S]*copy\.buyByRule\(usd\)/,
  )
  assert.doesNotMatch(NOTICE, /<Button/, 'a line, never a second orange action')
})

/*
 * «З кожної оплати» on the phone — the web's,
 * contract 1.19.0: a third kind in the rule's sheet,
 * a reminder bought on exactly the sum it gathered wherever it is offered, the
 * newest payments in the rule's sheet with «Мій рахунок» asked once more — and
 * nothing that names the other side of a transfer.
 */
const CARD = code('screens/autoinvest/rule-card.tsx')
const API = code('lib/api.ts')

test('a new rule’s sheet offers a third kind, «З оплат», and writes it on the least its reminders open at', () => {
  assert.match(RULE_SHEET, /const KINDS: readonly RuleKind\[\] = \['schedule', 'dip', 'payments'\]/)
  assert.match(
    RULE_SHEET,
    /value === 'payments'\s*\? copy\.fromPayments\s*: variant === 'panel'\s*\? copy\.scheduleShort\s*: copy\.regularly/,
  )
  // What to set aside, from the server's own bounds; the example on the tick's own arithmetic.
  assert.match(RULE_SHEET, /const payBounds = usePaymentBounds\(\)/)
  assert.match(RULE_SHEET, /copy\.modeRoundup[\s\S]*copy\.modeFixed[\s\S]*copy\.modePercent/)
  assert.match(RULE_SHEET, /const example = exampleOf\(terms\)/)
  assert.match(
    RULE_SHEET,
    /setAsideExample\(example\.direction, example\.amountUsd, example\.addUsd, company\.name, locale\)/,
  )
  // A dollar must route into the company, or its own minimum is the least a reminder opens at.
  assert.match(RULE_SHEET, /const routedSum = paying \? RULE_MIN_USD : amount/)
  assert.match(
    RULE_SHEET,
    /paymentsRequest\(\{ mint: company\.mint, minimumUsd: thresholdUsd, terms, timeZone, locale, limitPct \}\)/,
  )
  // «Умова ціни» and the month's budget stand for every kind: neither sits inside a kind's own branch.
  assert.ok(RULE_SHEET.indexOf('{reference !== null ? (') > RULE_SHEET.indexOf(") : kind === 'dip' ? ("))
  assert.match(
    RULE_SHEET,
    /<CountsLine text=\{payMode === 'percent' \? copy\.incomingCount : copy\.paymentsCount\} help=\{copy\.paymentsHelp\} \/>/,
  )
})

test('a reminder is bought on its own sum wherever it is offered — the order route refuses any other', () => {
  assert.match(BUY, /purchaseSumUsd\(read, ruleState && 'occurrence' in ruleState \? ruleState\.occurrence : null\)/)
  assert.match(BUY, /useBuy\(company, ruleState \? \{ amountUsd: ruleSum, binding \} : null\)/)
  assert.match(ASSET, /const offerUsd = companyRule && offer \? purchaseSumUsd\(companyRule, offer\) : null/)
  assert.match(ASSET, /buy: ruleWords\.buyByRule\(dollarsText\(offerUsd, locale\)\)/)
  assert.match(ASSET, /openReminder=\{offerUsd !== null \? \{ amountUsd: offerUsd \} : null\}/)
  assert.match(NOTICE, /dollarsText\(purchaseSumUsd\(rule, due\), locale\)/)
  assert.match(BLOCK, /`\$\{copy\.timeToBuy\} · \$\{dollarsText\(purchaseSumUsd\(rule, face\.occurrence\), locale\)\}`/)
  assert.match(CARD, /`\$\{copy\.timeToBuy\} · \$\{dollarsText\(purchaseSumUsd\(rule, face\.occurrence\), locale\)\}`/)
  assert.match(RULE_SHEET, /copy\.buyByRule\(dollarsText\(purchaseSumUsd\(rule, due\), locale\)\)/)
})

test('its sheet lists the newest payments, and «Мій рахунок» is asked once more before it is written', () => {
  assert.match(RULE_SHEET, /<PaymentEvents\s+payments=\{payments\}/)
  assert.match(RULE_SHEET, /copy\.myAccountConfirm/)
  assert.match(
    RULE_SHEET,
    /onConfirm=\{\(signature\) =>\s*void change\(\s*'marking',\s*\(\) => writes\.markOwn\(rule\.id, signature\),\s*\(\) => setAsking\(null\),?\s*\)/,
  )
  assert.match(RULE_SHEET, /event\.waiting \? \(\s*asking === event\.signature/, 'only an event still waiting')
  assert.match(API, /apiRequest<RuleListResponse>\('POST', '\/api\/v1\/rules\/payments\/own', \{ signature \}/)
  // The other side of a transfer never reaches the phone, and no shop is named.
  for (const source of [RULE_SHEET, BLOCK, CARD]) assert.doesNotMatch(source, /counterparty|merchant|shopName/)
})

test('the rule’s open sheet reads the rule as the wallet’s list holds it now', () => {
  assert.match(BLOCK, /rule: list\?\.find\(\(row\) => row\.id === managing\.id\) \?\? managing/)
  assert.match(ASSET, /rules\.data\?\.rules\.find\(\(row\) => row\.id === autoinvest\.rule\.id\) \?\? autoinvest\.rule/)
  assert.match(
    RULE_SHEET,
    /written && Date\.parse\(written\.updatedAt\) >= Date\.parse\(initial\.updatedAt\) \? written : initial/,
  )
})

test('the path is the same: nothing here orders, signs or executes', () => {
  for (const [name, source] of [
    ['block', BLOCK],
    ['row', ROW],
    ['notice', NOTICE],
    ['card', CARD],
  ]) {
    assert.doesNotMatch(
      source,
      /signTransaction|signAndSend|\/execute|\.review\(|\.sign\(/,
      `${name} reaches the execution path`,
    )
  }
})
