import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LAUNCH_WORDS, launchWords } from './copy.ts'
import { presetRules, presetRuleText, presetsAlike, RULE_KEEPING, usd } from './preset-view.ts'

const USDC = { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 }

/** Production's «Захищений», as `GET /api/v1/launch/presets` answered on 2026-10-10. */
const PROTECTED = {
  id: 'protected',
  name: { uk: 'Захищений', en: 'Protected' },
  pair: USDC,
  startMarketCapUsd: 5000,
  graduationMarketCapUsd: 75000,
  sniperFee: { startBps: 5000, endBps: 100, seconds: 600 },
  creatorTradingFeePct: 40,
  graduationFee: { pct: 2, creatorPct: 40 },
  firstBuyCapBps: 200,
  lpLockedForeverPct: 100,
}

const NOW = Date.parse('2026-10-10T12:00:00.000Z')
const uk = launchWords('uk')
const en = launchWords('en')

test('the rules before the signature: what a buyer asks first, then the way out, then the one policy every launch gets', () => {
  const rules = presetRules(PROTECTED, null, NOW)
  assert.deepEqual(
    rules.map((rule) => rule.code),
    [
      'MINT_REVOKED',
      'NO_FREEZE',
      'CURVE_HOLDS_FUNDS',
      'CONFIG_FIXED',
      'METADATA_FIXED',
      'NO_TRANSFER_HOOK',
      'GRADUATION_AT_THRESHOLD',
      'LP_LOCKED_FOREVER',
      'CREATOR_FIRST_BUY_CAP',
    ],
  )
  for (const rule of rules) {
    assert.deepEqual({ enforcement: rule.enforcement, by: rule.by }, RULE_KEEPING[rule.code])
    // No account exists before the wallet signs: nothing to open on Solscan.
    assert.equal(rule.source, null)
  }
  // Rules first, policies after — the market's page orders them the same way.
  const firstPolicy = rules.findIndex((rule) => rule.enforcement === 'policy')
  assert.ok(rules.slice(firstPolicy).every((rule) => rule.enforcement === 'policy'))
  // Not what the server lists only while something runs or was read — the executor, its ladder, the marks —
  // nor a sharing of fees the phone does not build, nor a lock not chosen.
  for (const code of [
    'GRADUATION_BY_RYNTRA',
    'FEE_FUNDED_LADDER',
    'CREATOR_SALE_MARK',
    'CONCENTRATION_MARK',
    'CREATOR_FEES_SHARED',
    'CREATOR_LOCK',
  ])
    assert.ok(!rules.some((rule) => rule.code === code), code)
})

test('a lock the creator chose is a rule, until its cliff and its end counted from now', () => {
  const rules = presetRules(PROTECTED, { cliffDays: 90, vestDays: 180 }, NOW)
  const lock = rules[0]
  assert.equal(lock.code, 'CREATOR_LOCK')
  assert.equal(lock.enforcement, 'rule')
  assert.equal(lock.values.cliffAt, NOW / 1000 + 90 * 86_400)
  assert.equal(lock.values.endsAt, NOW / 1000 + 270 * 86_400)
  assert.match(presetRuleText(lock, PROTECTED, uk, 'uk', NOW), /^Покупка творця під замком до /)
})

test('each rule said in words with the preset’s own figures — never a code, never an empty line', () => {
  const rules = presetRules(PROTECTED, { cliffDays: 30, vestDays: 90 }, NOW)
  for (const word of [uk, en]) {
    for (const rule of rules) {
      const text = presetRuleText(rule, PROTECTED, word, word === uk ? 'uk' : 'en', NOW)
      assert.ok(text.length > 0, rule.code)
      assert.ok(!/[A-Z]{3,}_[A-Z]/.test(text), text)
      assert.ok(!text.includes('{'), text)
    }
  }
  const text = (code) =>
    presetRuleText(
      rules.find((rule) => rule.code === code),
      PROTECTED,
      uk,
      'uk',
      NOW,
    )
  assert.equal(text('GRADUATION_AT_THRESHOLD'), 'Вихід на DEX — на капіталізації $75 000; надіслати його може будь-хто')
  assert.equal(text('CREATOR_FIRST_BUY_CAP'), 'Перша покупка творця — не більше 2 % емісії')
  // No pool exists yet: said as what happens once on the DEX.
  assert.equal(text('LP_LOCKED_FOREVER'), 'Коли токен перейде у свій пул, ліквідність пулу буде замкнено назавжди')
  assert.equal(text('MINT_REVOKED'), 'Нових токенів не випустить ніхто')
})

test('a preset the phone has not seen (Micro, once the server lists it) is said by its own figures', () => {
  const micro = {
    ...PROTECTED,
    id: 'micro',
    name: { uk: 'Мікро', en: 'Micro' },
    graduationMarketCapUsd: 3600,
    firstBuyCapBps: 150,
  }
  const rules = presetRules(micro, null, NOW)
  assert.equal(rules.length, 9)
  const way = rules.find((rule) => rule.code === 'GRADUATION_AT_THRESHOLD')
  assert.equal(presetRuleText(way, micro, en, 'en', NOW), 'Moves to the DEX at a $3,600 market cap; anyone can send it')
  const cap = rules.find((rule) => rule.code === 'CREATOR_FIRST_BUY_CAP')
  assert.equal(presetRuleText(cap, micro, en, 'en', NOW), "The creator's first buy: at most 1.5% of the supply")
  // Its pool not locked for ever: not said.
  assert.ok(
    !presetRules({ ...micro, lpLockedForeverPct: 50 }, null, NOW).some((rule) => rule.code === 'LP_LOCKED_FOREVER'),
  )
})

test('the preset’s way in whole dollars; the new words in both languages', () => {
  assert.equal(usd(75000, 'en'), '$75,000')
  assert.equal(usd(5000, 'uk'), '$5 000')
  assert.equal(
    uk('presetWay', { start: usd(5000, 'uk'), end: usd(75000, 'uk') }),
    'Капіталізація: старт $5 000, вихід на DEX — $75 000',
  )
  for (const key of [
    'presetWay',
    'hRulesBefore',
    'rule_GRADUATION_AT_CAP',
    'rule_CREATOR_FIRST_BUY_CAP_before',
    'presetLpForever',
    'mineBySource',
  ]) {
    assert.ok(LAUNCH_WORDS[key].en && LAUNCH_WORDS[key].uk, key)
  }
})

test('what every preset says alike is said once; a preset that differs brings its line back onto each card', () => {
  const classic = {
    ...PROTECTED,
    id: 'classic',
    sniperFee: { startBps: 2000, endBps: 100, seconds: 120 },
    firstBuyCapBps: 500,
  }
  assert.deepEqual(presetsAlike([classic, PROTECTED]), { way: true, lpForever: true })
  const micro = { ...PROTECTED, id: 'micro', graduationMarketCapUsd: 3600 }
  assert.deepEqual(presetsAlike([classic, PROTECTED, micro]), { way: false, lpForever: true })
  // One preset alone: its card says everything itself.
  assert.deepEqual(presetsAlike([PROTECTED]), { way: false, lpForever: false })
})
