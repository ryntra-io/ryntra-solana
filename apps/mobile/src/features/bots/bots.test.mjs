import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { activeCount, BOTS_COPY, BOTS_TABS, botsTabOf, planResultLine } from './bots.ts'

const WORDS = {
  open: 'Позиція відкрита',
  closed: 'Позиція закрита',
  costBasis: 'Вартість входу',
  realised: 'Реалізовано',
  noTrade: { 'entry-bound-unmet': 'Твоя ціна не настала', 'liquidity-unavailable': 'Ліквідність нижча за поріг' },
  usd: (value) => `$${value}`,
  signed: (value) => `${value > 0 ? '+' : '−'}$${Math.abs(value)}`,
}

const feed = (over) => ({ address: 'w', results: [], sync: { pending: 0 }, outcomes: [], positions: [], ...over })
const position = (planId, state, figures) => ({
  planId,
  asset: { symbol: 'NVDAx' },
  status: 'active',
  version: 1,
  position: { state, realisedUsd: null, costBasisUsd: null, ...figures },
})

test('«Боти» is the web’s: Мої боти · Каталог, the web’s words', () => {
  assert.deepEqual(BOTS_TABS, ['mine', 'catalog'])
  assert.deepEqual(Object.values(BOTS_COPY.uk.tabs), ['Мої боти', 'Каталог'])
  assert.deepEqual(Object.values(BOTS_COPY.en.tabs), ['My bots', 'Catalog'])
  assert.equal(BOTS_COPY.uk.recurring, 'Регулярна купівля')
  assert.equal(BOTS_COPY.uk.plans, 'Плани угод')
  // Any token with liquidity (1.31.0), the floor of a meme or a new token said with it — the web's words.
  assert.equal(
    BOTS_COPY.uk.recurringFor,
    'Акції, монети й меми. Мем чи новий токен — від $25 000 ліквідності й 24 годин на ринку.',
  )
  assert.equal(BOTS_COPY.uk.pickToken, 'Обрати токен')
  assert.equal(botsTabOf('catalog'), 'catalog')
  assert.equal(botsTabOf(undefined), 'mine')
  assert.equal(botsTabOf('anything'), 'mine')
  for (const locale of ['en', 'uk'])
    assert.doesNotMatch(JSON.stringify(BOTS_COPY[locale]), /\bRyn\b|Автоінвест|Autoinvest/)
})

test('a plan’s card says its result as the server counts it — and nothing where the results are silent', () => {
  const closed = feed({ positions: [position('p1', 'closed', { realisedUsd: 1.2 })] })
  assert.deepEqual(planResultLine(closed, 'p1', WORDS), {
    text: 'Позиція закрита · Реалізовано +$1.2',
    tone: 'success',
  })
  const lost = feed({ positions: [position('p1', 'closed', { realisedUsd: -0.5 })] })
  assert.equal(planResultLine(lost, 'p1', WORDS).tone, 'danger')
  const unknown = feed({ positions: [position('p1', 'closed', { realisedUsd: null })] })
  assert.deepEqual(planResultLine(unknown, 'p1', WORDS), { text: 'Позиція закрита', tone: 'muted' })
  const open = feed({ positions: [position('p1', 'open', { costBasisUsd: 10 })] })
  assert.deepEqual(planResultLine(open, 'p1', WORDS), { text: 'Позиція відкрита · Вартість входу $10', tone: 'fg' })
  const none = feed({ outcomes: [{ planId: 'p2', reason: 'liquidity-unavailable' }] })
  assert.deepEqual(planResultLine(none, 'p2', WORDS), { text: 'Ліквідність нижча за поріг', tone: 'muted' })
  assert.equal(planResultLine(none, 'p3', WORDS), null)
  assert.equal(planResultLine(null, 'p1', WORDS), null)
})

test('«N активні» counts only what was read: the rules that are on and the plans that are active', () => {
  assert.equal(activeCount(null, null), null)
  assert.equal(activeCount([{ status: 'active' }, { status: 'paused' }], null), 1)
  assert.equal(
    activeCount([{ status: 'active' }], [{ status: 'active' }, { status: 'draft' }, { status: 'closed' }]),
    2,
  )
  assert.equal(activeCount([], []), 0)
})

test('the screen: «Мої боти» behind the wallet’s session, the rules before the plans, the results a tap deeper; the catalog for everyone', () => {
  const code = readFileSync(new URL('../../screens/bots/index.tsx', import.meta.url), 'utf8')
  assert.match(code, /<SessionGate what=\{bots\.gateWhat\}>/)
  assert.equal(BOTS_COPY.uk.gateWhat, 'Твої боти')
  // Until a tap or a link chooses, the tab follows the session as it loads — never frozen at a cold start.
  assert.match(code, /const tab: BotsTab = chosen \?\? \(account\.session \? 'mine' : 'catalog'\)/)
  assert.ok(code.indexOf('<RulesBlock') < code.indexOf('<MyPlans />'))
  assert.match(code, /router\.push\('\/results'\)/)
  assert.match(code, /result=\{resultOf\(plan\)\}/)
  // The catalog's recurring buy names any token with liquidity: the search sheet over Bots, titled for the rule, and the
  // token chosen opens on its page with its rule's sheet — never the Markets tab with no word of what it is for (ST-5).
  assert.match(code, /<AssetPickerSheet[\s\S]*?title=\{bots\.pickTokenFor\}/)
  assert.match(code, /autoinvest: '1'/)
  assert.doesNotMatch(code, /marketsPath\('all'\)/)
  assert.equal(BOTS_COPY.uk.pickTokenFor, 'Токен для регулярної купівлі')
  assert.equal(BOTS_COPY.en.pickTokenFor, 'Token for a recurring buy')
  assert.match(code, /router\.push\('\/plans\/pick'\)/)
  // No orange on the catalog: its actions are quiet (one orange action per screen).
  assert.doesNotMatch(code.slice(code.indexOf('function Catalog')), /variant="primary"/)
})
