import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { mapDeepLink } from '../monitoring/deep-link.ts'
import { orderTypeOf, RULE_TICKET_COPY, ticketRuleLine, ticketRuleRefusal, ticketRuleState } from '../trade/rule-ticket.ts'
import { AUTOINVEST_COPY } from './copy.ts'
import {
  ageWord,
  floorHeld,
  floorLine,
  floorMetLine,
  floorStanding,
  isListedToken,
  riskRows,
  tokenBlockOf,
  tokenWriteFailure,
} from './floor.ts'
import { anchorNowLine, anchorStandingLine, checkPriceCondition, conditionShort } from './price-condition.ts'
import { isMintRef, ruleBuyRoute, ruleBuyRouteOf, ruleRefusalOf, symbolOfIdentity } from './rule-model.ts'
import { priceWord } from './words.ts'

/*
 * «Регулярна купівля для всього» on the phone: a rule names any token with
 * liquidity, a token stands on the floor, a meme's facts of risk come before
 * the button, a token's condition stands against the price when the rule was
 * turned on, and its reminder is bought in Trade, the ticket as the rule's
 * purchase.
 */

const SOL = 'So11111111111111111111111111111111111111112'
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const RULE = 'rule_0123456789abcdef0123456789abcdef'
const DUE = '2026-10-08T16:00:00.000Z'
const code = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

const floor = (verdict, liquidityUsd, ageHours) => ({
  verdict,
  liquidityUsd,
  floorUsd: 25_000,
  ageHours,
  minAgeHours: 24,
  dataAt: '2026-10-07T10:00:00.000Z',
  checkedAt: '2026-10-07T10:00:05.000Z',
})

test('the floor in the web’s words: what a token stands on, or why it does not', () => {
  assert.equal(
    floorLine(floor('below', 18_400, 400), 'NEWT', 'uk'),
    'NEWT: ліквідність $18 400 — нижче порогу $25 000'.replace(/ (?=\d{3}\b)/g, ' '),
  )
  assert.equal(floorLine(floor('below', 18_400, 400), 'NEWT', 'en'), 'NEWT: liquidity $18,400 — below the floor of $25,000')
  assert.equal(floorLine(floor('below', 90_000, 5), '', 'uk'), 'На ринку 5 год — поріг 24 годин')
  assert.equal(floorLine(floor('unavailable', null, null), '', 'en'), 'Liquidity cannot be read right now')
  assert.equal(floorMetLine(floor('met', 7_200_000, 24_528), 'en'), 'Met · $7.2M · 1,022 d on the market')
  assert.equal(floorMetLine(floor('met', 7_200_000, 24_528), 'uk'), 'Виконано · $7,2 млн · 1 022 дн. на ринку')
  assert.equal(floorStanding(floor('met', 30_000, 30), 'en'), 'Met · $30K · 30 h on the market')
  assert.equal(ageWord(47, 'uk'), '47 год')
  assert.equal(ageWord(72, 'en'), '3 d')
  // The floor that holds a deferred purchase is said first; a floor that is met holds nothing.
  assert.equal(floorHeld({ floor: floor('met', 30_000, 30) }), null)
  assert.equal(floorHeld({ floor: floor('below', 1, 30) })?.verdict, 'below')
  assert.equal(floorHeld({}), null)
})

const RISK_WORDS = AUTOINVEST_COPY.uk

test('a meme’s facts of risk before the button — facts, a caution where the venue’s figure is one to weigh, never a verdict', () => {
  const read = {
    class: 'meme',
    risk: {
      verified: false,
      ageHours: 30,
      liquidityUsd: 61_000,
      topHoldersPct: 62.4,
      mintAuthorityDisabled: false,
      freezeAuthorityDisabled: true,
      organicScore: 18.6,
    },
  }
  const rows = riskRows(read, RISK_WORDS, 'uk')
  assert.deepEqual(
    rows.map((row) => row.key),
    ['age', 'liquidity', 'holders', 'mint', 'freeze', 'organic', 'verified'],
  )
  assert.deepEqual(
    rows.filter((row) => row.caution).map((row) => row.key),
    ['holders', 'mint', 'verified'],
  )
  assert.equal(rows.find((row) => row.key === 'mint').value, 'відкрито')
  assert.equal(rows.find((row) => row.key === 'freeze').value, 'закрито')
  assert.equal(rows.find((row) => row.key === 'organic').value, '19 / 100')
  assert.equal(rows.find((row) => row.key === 'verified').value, 'не перевірено')
  // Inside Trade the token's page already states its age, liquidity and holders.
  assert.deepEqual(
    riskRows(read, RISK_WORDS, 'uk', true).map((row) => row.key),
    ['mint', 'freeze', 'organic', 'verified'],
  )
  // Unknown is said as unknown, never as a pass.
  const unknown = riskRows(
    { class: 'meme', risk: { ...read.risk, mintAuthorityDisabled: null, organicScore: null } },
    AUTOINVEST_COPY.en,
    'en',
  )
  assert.equal(unknown.find((row) => row.key === 'mint').value, 'not stated')
  assert.equal(unknown.find((row) => row.key === 'organic').value, 'not stated')
  // A coin the venue verified, and a company, carry no facts of risk.
  assert.equal(riskRows({ class: 'crypto', risk: read.risk }, RISK_WORDS, 'uk'), null)
  assert.equal(riskRows({ class: 'stock', risk: null }, RISK_WORDS, 'uk'), null)
})

test('a token no rule can name says why before the button — refused, unread, under the floor, flagged', () => {
  const ok = { refusal: null, floor: floor('met', 30_000, 30) }
  assert.equal(tokenBlockOf('ready', ok), null)
  assert.equal(tokenBlockOf('reading', null), null)
  assert.equal(tokenBlockOf('refused', null), 'noRule')
  assert.equal(tokenBlockOf('failed', null), 'unreadable')
  assert.equal(tokenBlockOf('ready', { ...ok, refusal: { code: 'RULE_LIQUIDITY_LOW', message: '' } }), 'noRule')
  assert.equal(tokenBlockOf('ready', { ...ok, refusal: { code: 'ASSET_UNCONFIRMED', message: '' } }), 'flagged')
  assert.equal(tokenBlockOf('ready', { refusal: null, floor: floor('unavailable', null, null) }), 'unreadable')
  // A write refused on a token, in its words: the floor on create and on turning on again, unread figures, a flag.
  assert.equal(tokenWriteFailure('RULE_LIQUIDITY_LOW', 'create'), 'noRuleOnToken')
  assert.equal(tokenWriteFailure('RULE_LIQUIDITY_LOW', 'change'), 'floorRefusesTurnOn')
  assert.equal(tokenWriteFailure('ASSET_UNCONFIRMED', 'change'), 'tokenNotSupported')
  assert.equal(tokenWriteFailure('UNAVAILABLE', 'create'), 'tokenUnreadable')
  assert.equal(tokenWriteFailure('RULE_LIMIT_REACHED', 'create'), null)
  for (const key of ['noRuleOnToken', 'floorRefusesTurnOn', 'tokenNotSupported', 'tokenUnreadable'])
    assert.ok(AUTOINVEST_COPY.uk[key] && AUTOINVEST_COPY.en[key], key)
  assert.equal(ruleRefusalOf('RULE_LIQUIDITY_LOW'), 'floor')
})

test('a token’s condition stands against the price when the rule was turned on — its age is the rule’s, only the price now must be fresh', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z')
  const facts = {
    reference: 'enabled',
    priceUsd: 160,
    priceAtMs: now - 60_000,
    referenceUsd: 150,
    // Turned on a month ago: never stale for that.
    referenceAtMs: now - 30 * 24 * 3_600_000,
    referenceStale: false,
  }
  const above = checkPriceCondition(5, facts, now)
  assert.equal(above.verdict, 'above')
  assert.equal(above.deviationPct, 6.7)
  assert.equal(checkPriceCondition(10, facts, now).verdict, 'met')
  assert.equal(checkPriceCondition(10, { ...facts, priceAtMs: now - 3_600_000 }, now).verdict, 'stale')
  assert.equal(conditionShort(5, 'enabled', 'uk'), 'не дорожче за ціну при ввімкненні правила більш ніж на 5 %')
  assert.equal(anchorNowLine(150, 5, 'uk'), 'Орієнтир — ціна зараз $150,00: правило не купить дорожче за $157,50.')
  assert.equal(anchorNowLine(150, 5, 'en'), 'The reference is the price now, $150.00: the rule won’t buy above $157.50.')
  assert.equal(anchorStandingLine(150, 5, 'uk'), '$150,00 · купує до $157,50')
  assert.equal(anchorStandingLine(150, 5, 'en'), '$150.00 · buys up to $157.50')
  // A meme's price under a cent keeps four significant digits, as the web's.
  assert.equal(priceWord(0.00001834, 'en'), '$0.00001834')
  assert.equal(priceWord(0.2461, 'en'), '$0.2461')
})

test('a token’s reminder is bought in Trade, the ticket as the rule’s purchase; a company’s on its page', () => {
  assert.equal(isListedToken({ kind: 'crypto' }), true)
  assert.equal(isListedToken({ kind: 'meme' }), true)
  assert.equal(isListedToken({ kind: 'stock' }), false)
  assert.equal(isListedToken({}), false)
  assert.deepEqual(ruleBuyRoute({ mint: SOL, symbol: 'SOL', token: true, ruleId: RULE, dueAt: DUE }), {
    pathname: '/trade',
    params: { mint: SOL, symbol: 'SOL', side: 'buy', rule: RULE, due: DUE },
  })
  assert.deepEqual(
    ruleBuyRouteOf({ id: RULE, asset: { mint: SOL, symbol: 'NVDAx', kind: 'stock' } }, DUE),
    { pathname: '/asset/[mint]', params: { mint: SOL, symbol: 'NVDAx', category: 'stock', rule: RULE, due: DUE } },
  )
  // A gone rule's note carries the token's mint after `@`: the token itself, and no mint is ever taken for a symbol.
  assert.equal(symbolOfIdentity(`autoinvest:${RULE}:${DUE}@${BONK}`), BONK)
  assert.equal(symbolOfIdentity(`autoinvest:${RULE}:${DUE}@NVDAx`), 'NVDAx')
  assert.equal(isMintRef(BONK), true)
  assert.equal(isMintRef('NVDAx'), false)
  assert.deepEqual(ruleBuyRoute({ mint: BONK, symbol: BONK, token: true, ruleId: RULE, dueAt: null }).params, {
    mint: BONK,
    side: 'buy',
    rule: RULE,
  })
  // The web's link of a token's reminder lands on the same ticket.
  const mapped = mapDeepLink(`/app/spot?mint=${SOL}&rule=${RULE}&due=${encodeURIComponent(DUE)}`)
  assert.equal(mapped.kind, 'native')
  const url = new URL(`ryntra://x${mapped.path}`)
  assert.equal(url.pathname, '/trade')
  assert.equal(url.searchParams.get('mint'), SOL)
  assert.equal(url.searchParams.get('side'), 'buy')
  assert.equal(url.searchParams.get('rule'), RULE)
  assert.equal(url.searchParams.get('due'), DUE)
  // A malformed rule is no rule: the market alone.
  assert.equal(mapDeepLink(`/app/spot?mint=${SOL}&rule=rule_x`).path, `/asset/${SOL}`)
})

const rule = (state, openUntil = '2026-10-08T22:00:00.000Z') => ({
  id: RULE,
  asset: { mint: SOL, symbol: 'SOL', kind: 'crypto' },
  status: 'active',
  amountUsd: 1,
  occurrences: [{ dueAt: DUE, openUntil, state, amountUsd: null }],
})

test('the ticket under a rule: only its open reminder on its own market buys; anything else says why', () => {
  const nowMs = Date.parse('2026-10-08T17:00:00.000Z')
  const base = { read: 'ready', dueAt: DUE, budget: null, nowMs }
  assert.equal(ticketRuleState({ ...base, rule: rule('due'), mint: SOL }).kind, 'open')
  assert.equal(ticketRuleState({ ...base, rule: rule('due'), mint: BONK }).kind, 'wrong-market')
  assert.equal(ticketRuleState({ ...base, rule: rule('bought'), mint: SOL }).kind, 'bought')
  assert.equal(ticketRuleState({ ...base, rule: rule('deferred'), mint: SOL }).kind, 'deferred')
  assert.equal(ticketRuleState({ ...base, rule: null, mint: SOL }).kind, 'gone')
  assert.equal(ticketRuleState({ ...base, read: 'reading', rule: null, mint: SOL }).kind, 'reading')
  const words = RULE_TICKET_COPY.uk
  assert.equal(ticketRuleLine({ kind: 'wrong-market' }, words), 'Цей ринок — не токен правила.')
  assert.equal(ticketRuleLine({ kind: 'gone' }, words), 'Цього правила вже немає у твоєму гаманці.')
  assert.equal(ticketRuleRefusal('RULE_LIQUIDITY_LOW'), 'floorWaits')
  assert.equal(ticketRuleRefusal('RULE_PRICE_CONDITION'), 'conditionWaits')
  assert.equal(ticketRuleRefusal('RULE_NOT_DUE'), 'reminderNoLonger')
  assert.equal(ticketRuleRefusal('ASSET_NOT_OFFERED'), 'tokenFlagged')
  assert.equal(ticketRuleRefusal('ORDER_NO_ROUTE'), null)
  assert.equal(RULE_TICKET_COPY.uk.boughtByRule, 'Куплено за правилом')
  assert.equal(RULE_TICKET_COPY.uk.yourRule, 'Твоє правило')
  assert.deepEqual([RULE_TICKET_COPY.uk.market, RULE_TICKET_COPY.uk.recurring], ['Ринок', 'Регулярно'])
  assert.equal(orderTypeOf('recurring'), 'recurring')
  assert.equal(orderTypeOf('anything'), 'market')
})

test('the surfaces: «Регулярно» beside «Ринок» in Trade, beside «Купити» on a coin’s page, the reads header on every request', () => {
  const trade = code('screens/trade/index.tsx')
  assert.match(trade, /const showOrderTypes = mode === 'buy' && !ruleAsk && !planBinding && asset !== null/)
  assert.match(trade, /<RecurringPanel/)
  // In «Регулярно» the rule's own button is the one action; under a rule the sum is the rule's, in USDC, and held.
  assert.match(trade, /\{recurring \? null : \(\s*<BottomAction/)
  assert.match(trade, /const quoteAsset = ruleAsk\s*\? USDC_ASSET/)
  assert.match(trade, /const ticketAmount = ruleSum !== null \? ruleSumText\(ruleSum, locale\) : ruleAsk \? '' : amountText/)
  assert.match(trade, /rule: ruleBinding \}\)/)
  assert.match(trade, /ruleLine=\{reviewRuleLine\}/)
  // The field shows the sum the ticket quotes and signs; «МАКС» changes nothing under a rule.
  assert.match(trade, /value=\{ruleAsk \? ticketAmount : amountText\}/)
  assert.match(trade, /disabled=\{ruleAsk !== null\}\s*hitSlop=\{6\}/)
  // A token's card in «Мої боти» opens its trade with «Регулярно»; a company's opens its rule's sheet.
  const block = code('screens/autoinvest/rules-block.tsx')
  assert.match(block, /else if \(isListedToken\(rule\.asset\)\)\s*router\.push\(\{\s*pathname: '\/trade',[\s\S]*?order: 'recurring'/)
  // Whether the ticket's token is a company is the server's word, never a missing category.
  const panel = code('screens/trade/recurring-panel.tsx')
  assert.match(panel, /standing\.read\s*\? standing\.read\.class !== 'stock'/)
  const asset = code('screens/asset/index.tsx')
  assert.match(asset, /token: !isStock,/)
  assert.match(asset, /\(company \|\| \(!isStock && !retired\)\) && \(!session \|\| rules\.data \|\| rules\.isError\)/)
  assert.match(asset, /if \(isListedToken\(rule\.asset\)\) \{\s*router\.push\(ruleBuyRouteOf\(rule, occurrence\.dueAt\) as never\)/)
  const sheet = code('screens/autoinvest/autoinvest-sheet.tsx')
  assert.match(sheet, /const tokenRead = useRuleAsset\(company\.mint, token\)/)
  assert.match(sheet, /pickedLimit === undefined \? \(token \? null : bounds\.defaultPct\) : pickedLimit/)
  assert.match(sheet, /<TokenStanding read=\{tokenFacts\}/)
  const api = code('lib/api.ts')
  assert.match(api, /'X-Ryntra-Reads': 'rule-reference-enabled'/)
  assert.match(api, /for \(const \[name, value\] of Object\.entries\(READS_HEADER\)\) headers\.set\(name, value\)/)
  assert.match(api, /asset: \(mint, signal\) => v1\(\(\) => v1Client\(null, signal\)\.rules\.asset\(mint\)\)/)
})
