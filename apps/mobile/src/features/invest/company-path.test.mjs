import assert from 'node:assert/strict'
import { test } from 'node:test'

import { companyPathView, otherPathToken, pathDeadline, stepLines, tokenNature } from './company-path.ts'
import { COMPANY_PATH_COPY } from './company-path-copy.ts'

/*
 * «Шлях компанії»: the web's strip in the web's
 * words and days. The paths are production's answer of 2026-09-26 (contract
 * 1.19.0, registry 2026-09-25.2); the expected lines are the ones ryntra.io drew
 * the same day for SpaceX's two tokens and OpenAI, in Ukrainian and in English.
 */

const UK = COMPANY_PATH_COPY.uk
const EN = COMPANY_PATH_COPY.en
const plain = (text) => (typeof text === 'string' ? text.replace(/\s/g, ' ') : text)

const SPACEX = 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh'
const SPCXX = 'Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8'
const OPENAI = 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF'
const NOW = Date.parse('2026-09-26T14:30:00.000Z')

const step = (id, state, fields = {}) => ({
  step: id,
  state,
  date: fields.date ?? null,
  priceUsd: fields.priceUsd ?? null,
  exchange: fields.exchange ?? null,
  ticker: fields.ticker ?? null,
  token: fields.token ?? null,
})

const SOURCES = [
  {
    label: 'SEC · FWP (pricing term sheet)',
    url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026042466/spaceexplorationtechnologi.htm',
    publishedAt: '2026-06-11',
    readAt: '2026-09-25',
  },
  {
    label: 'SEC · 424B4 (prospectus)',
    url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026042639/spaceexplorationtechnologi.htm',
    publishedAt: '2026-06-12',
    readAt: '2026-09-25',
  },
  { label: 'PreStocks · SpaceX', url: 'https://www.prestocks.com/spacex', publishedAt: null, readAt: '2026-09-25' },
  {
    label: 'The Cryptonomist',
    url: 'https://en.cryptonomist.ch/2026/06/12/tokenized-spacex-shares-solana/',
    publishedAt: '2026-06-12',
    readAt: '2026-09-25',
  },
  { label: 'Jupiter', url: `https://jup.ag/tokens/${SPACEX}`, publishedAt: null, readAt: '2026-09-25' },
]

/** SpaceX's path as production states it on SPACEX's row; SPCXx's row carries the same path at `solana`. */
const spacexPath = (at = 'private', swap = {}) => ({
  at,
  steps: [
    step('private', 'passed', { date: '2025-09-16', token: { mint: SPACEX, symbol: 'SPACEX' } }),
    step('ipo', 'passed', { date: '2026-06-12', priceUsd: 135 }),
    step('exchange', 'passed', { date: '2026-06-12', exchange: 'Nasdaq', ticker: 'SPCX' }),
    step('solana', 'current', { date: '2026-06-12', token: { mint: SPCXX, symbol: 'SPCXx' } }),
  ],
  swap: {
    from: { mint: SPACEX, symbol: 'SPACEX' },
    into: { mint: SPCXX, symbol: 'SPCXx' },
    deadline: '2027-03-12T23:59:00.000Z',
    open: true,
    ...swap,
  },
  swapMonths: null,
  sources: SOURCES,
  version: '2026-09-25.2',
})

const openaiPath = {
  at: 'private',
  steps: [
    step('private', 'current', { date: '2025-09-16', token: { mint: OPENAI, symbol: 'OPENAI' } }),
    step('ipo', 'unannounced'),
    step('exchange', 'unannounced'),
    step('solana', 'unannounced'),
  ],
  swap: null,
  swapMonths: 9,
  sources: [
    { label: 'PreStocks · FAQ', url: 'https://www.prestocks.com/faq', publishedAt: null, readAt: '2026-09-25' },
    { label: 'Jupiter', url: `https://jup.ag/tokens/${OPENAI}`, publishedAt: null, readAt: '2026-09-25' },
  ],
  version: '2026-09-25.2',
}

/** What a screen reads of a step: its name, state, lines and token, as the web draws them. */
const drawn = (view) =>
  view.steps.map((entry) => ({
    name: entry.name,
    state: entry.state,
    lines: entry.lines.map(plain),
    token: entry.token
      ? { symbol: entry.token.symbol, here: entry.token.here, nature: plain(entry.token.nature) }
      : null,
  }))

test('SPACEX’s own page: the four steps in the web’s words and days, SPACEX «цей токен», SPCXx one tap away', () => {
  const view = companyPathView(spacexPath(), { mint: SPACEX, privateFeeBps: 100, holder: false, nowMs: NOW }, UK, 'uk')
  assert.equal(view.at, 'private')
  assert.deepEqual(drawn(view), [
    {
      name: 'Приватна · PreStocks',
      state: 'passed',
      lines: ['з 16.09.2025'],
      token: { symbol: 'SPACEX', here: true, nature: 'не акція · комісія 1%' },
    },
    { name: 'IPO', state: 'passed', lines: ['12.06.2026', '$135 за акцію'], token: null },
    { name: 'Біржа', state: 'passed', lines: ['Nasdaq · SPCX', 'з 12.06.2026'], token: null },
    {
      name: 'Solana',
      state: 'current',
      lines: ['з 12.06.2026'],
      token: { symbol: 'SPCXx', here: false, nature: '1:1 до акції · без голосу' },
    },
  ])
  assert.equal(view.steps[3].token.mint, SPCXX)
  assert.deepEqual(view.line, {
    kind: 'swap',
    text: 'Власникам SPACEX: обміняти на SPCXx до 12.03.2027, 23:59 UTC — після строку SPACEX згорить.',
    open: true,
  })
  assert.deepEqual(
    view.sources.map((source) => source.line),
    [
      'SEC · FWP (pricing term sheet) · 11.06.2026 · прочитано 25.09.2026',
      'SEC · 424B4 (prospectus) · 12.06.2026 · прочитано 25.09.2026',
      'PreStocks · SpaceX · прочитано 25.09.2026',
      'The Cryptonomist · 12.06.2026 · прочитано 25.09.2026',
      'Jupiter · прочитано 25.09.2026',
    ],
  )
  assert.deepEqual(
    view.sources.map((source) => source.url),
    SOURCES.map((source) => source.url),
  )
})

test('a holder on SPACEX’s own page is told to swap, with the issuer’s minute', () => {
  const view = companyPathView(spacexPath(), { mint: SPACEX, privateFeeBps: 100, holder: true, nowMs: NOW }, UK, 'uk')
  assert.equal(view.line.text, 'Обміняй SPACEX на SPCXx до 12.03.2027, 23:59 UTC — після строку токен згорить.')
  const en = companyPathView(spacexPath(), { mint: SPACEX, privateFeeBps: 100, holder: true, nowMs: NOW }, EN, 'en')
  assert.equal(
    en.line.text,
    'Swap your SPACEX for SPCXx by Mar 12, 2027, 23:59 UTC — after the deadline the token expires worthless.',
  )
})

test('SPCXx’s page: the same path, SPCXx «цей токен», SPACEX one tap away with its own fee, the line for everyone', () => {
  const view = companyPathView(
    spacexPath('solana'),
    // A wallet that holds SPCXx is no holder of SPACEX: the swap is not its own.
    { mint: SPCXX, privateFeeBps: 100, holder: true, nowMs: NOW },
    UK,
    'uk',
  )
  assert.equal(view.at, 'solana')
  assert.deepEqual(
    drawn(view).map((entry) => entry.token),
    [
      { symbol: 'SPACEX', here: false, nature: 'не акція · комісія 1%' },
      null,
      null,
      { symbol: 'SPCXx', here: true, nature: '1:1 до акції · без голосу' },
    ],
  )
  assert.equal(view.steps[0].token.mint, SPACEX)
  assert.equal(
    view.line.text,
    'Власникам SPACEX: обміняти на SPCXx до 12.03.2027, 23:59 UTC — після строку SPACEX згорить.',
  )
})

test('SPCXx’s page before SPACEX’s own row is read: the private token is «не акція», no fee guessed', () => {
  const view = companyPathView(
    spacexPath('solana'),
    { mint: SPCXX, privateFeeBps: null, holder: false, nowMs: NOW },
    UK,
    'uk',
  )
  assert.equal(view.steps[0].token.nature, 'не акція')
})

test('the same strip in English, as ryntra.io draws it', () => {
  const view = companyPathView(
    spacexPath('solana'),
    { mint: SPCXX, privateFeeBps: 100, holder: false, nowMs: NOW },
    EN,
    'en',
  )
  assert.deepEqual(drawn(view), [
    {
      name: 'Private · PreStocks',
      state: 'passed',
      lines: ['since Sep 16, 2025'],
      token: { symbol: 'SPACEX', here: false, nature: 'not a share · 1% fee' },
    },
    { name: 'IPO', state: 'passed', lines: ['Jun 12, 2026', '$135 a share'], token: null },
    { name: 'Exchange', state: 'passed', lines: ['Nasdaq · SPCX', 'since Jun 12, 2026'], token: null },
    {
      name: 'Solana',
      state: 'current',
      lines: ['since Jun 12, 2026'],
      token: { symbol: 'SPCXx', here: true, nature: 'backed 1:1 · no vote' },
    },
  ])
  assert.equal(
    view.line.text,
    'SPACEX holders: swap for SPCXx by Mar 12, 2027, 23:59 UTC — after the deadline SPACEX expires worthless.',
  )
  assert.deepEqual(
    view.sources.map((source) => source.line),
    [
      'SEC · FWP (pricing term sheet) · Jun 11, 2026 · read Sep 25, 2026',
      'SEC · 424B4 (prospectus) · Jun 12, 2026 · read Sep 25, 2026',
      'PreStocks · SpaceX · read Sep 25, 2026',
      'The Cryptonomist · Jun 12, 2026 · read Sep 25, 2026',
      'Jupiter · read Sep 25, 2026',
    ],
  )
})

test('a company still private: its token at the first step, the rest not announced, the issuer’s rule under them', () => {
  const view = companyPathView(openaiPath, { mint: OPENAI, privateFeeBps: 300, holder: false, nowMs: NOW }, UK, 'uk')
  assert.deepEqual(drawn(view), [
    {
      name: 'Приватна · PreStocks',
      state: 'current',
      lines: ['з 16.09.2025'],
      token: { symbol: 'OPENAI', here: true, nature: 'не акція · комісія 3%' },
    },
    { name: 'IPO', state: 'unannounced', lines: ['ще не оголошено'], token: null },
    { name: 'Біржа', state: 'unannounced', lines: ['ще не оголошено'], token: null },
    { name: 'Solana', state: 'unannounced', lines: ['ще не оголошено'], token: null },
  ])
  assert.deepEqual(view.line, { kind: 'rule', text: 'Після IPO — до 9 місяців, щоб обміняти токен.' })
  assert.deepEqual(
    view.sources.map((source) => source.line),
    ['PreStocks · FAQ · прочитано 25.09.2026', 'Jupiter · прочитано 25.09.2026'],
  )
  const en = companyPathView(openaiPath, { mint: OPENAI, privateFeeBps: 300, holder: false, nowMs: NOW }, EN, 'en')
  assert.deepEqual(
    drawn(en)
      .slice(0, 2)
      .map((entry) => [entry.name, entry.lines, entry.token?.nature ?? null]),
    [
      ['Private · PreStocks', ['since Sep 16, 2025'], 'not a share · 3% fee'],
      ['IPO', ['not announced yet'], null],
    ],
  )
  assert.equal(en.line.text, 'After an IPO — up to 9 months to swap the token.')
  assert.equal(EN.swapRule(1), 'After an IPO — up to 1 month to swap the token.')
  assert.equal(UK.swapRule(1), 'Після IPO — до 1 місяця, щоб обміняти токен.')
})

test('a closed window says so — by the server’s word or once the phone’s clock passes the cut-off', () => {
  const after = Date.parse('2027-03-13T00:00:00.000Z')
  const byClock = companyPathView(
    spacexPath(),
    { mint: SPACEX, privateFeeBps: 100, holder: true, nowMs: after },
    UK,
    'uk',
  )
  assert.deepEqual(byClock.line, {
    kind: 'swap',
    text: 'Строк обміну SPACEX минув 12.03.2027 — емітент більше не підтримує токен.',
    open: false,
  })
  const byServer = companyPathView(
    spacexPath('solana', { open: false }),
    { mint: SPCXX, privateFeeBps: 100, holder: false, nowMs: NOW },
    EN,
    'en',
  )
  assert.deepEqual(byServer.line, {
    kind: 'swap',
    text: 'The swap deadline for SPACEX passed on Mar 12, 2027 — the issuer no longer supports the token.',
    open: false,
  })
})

test('a swap the issuer names no target for is said without one', () => {
  const view = companyPathView(
    spacexPath('private', { into: null }),
    { mint: SPACEX, privateFeeBps: 100, holder: true, nowMs: NOW },
    UK,
    'uk',
  )
  assert.equal(view.line.text, 'Обміняй SPACEX до 12.03.2027, 23:59 UTC — після строку токен згорить.')
})

test('the other token on the path: SPCXx from SPACEX, SPACEX from SPCXx, none for a company still private', () => {
  assert.deepEqual(otherPathToken(spacexPath()), { mint: SPCXX, symbol: 'SPCXx' })
  assert.deepEqual(otherPathToken(spacexPath('solana')), { mint: SPACEX, symbol: 'SPACEX' })
  assert.equal(otherPathToken(openaiPath), null)
  assert.equal(otherPathToken(null), null)
})

test('a step’s lines by the web’s rule: «зараз» without a day, the exchange alone without its ticker, nothing empty', () => {
  assert.deepEqual(stepLines({ step: 'private', state: 'current', date: null }, UK, 'uk'), ['зараз'])
  assert.deepEqual(stepLines({ step: 'solana', state: 'passed', date: null }, UK, 'uk'), [])
  assert.deepEqual(
    stepLines({ step: 'exchange', state: 'passed', date: null, exchange: 'Nasdaq', ticker: null }, EN, 'en'),
    ['Nasdaq'],
  )
  assert.deepEqual(stepLines({ step: 'exchange', state: 'passed', date: '2026-06-12' }, UK, 'uk'), ['з 12.06.2026'])
  assert.deepEqual(stepLines({ step: 'ipo', state: 'passed', date: null, priceUsd: 40.5 }, UK, 'uk').map(plain), [
    '$40,5 за акцію',
  ])
  assert.deepEqual(stepLines({ step: 'ipo', state: 'passed', date: 'soon', priceUsd: null }, UK, 'uk'), [])
})

test('what a token is: the chain’s fee as the web writes it, «не акція» without one', () => {
  assert.equal(tokenNature('private', 100, UK, 'uk'), 'не акція · комісія 1%')
  assert.equal(plain(tokenNature('private', 150, UK, 'uk')), 'не акція · комісія 1,5%')
  assert.equal(tokenNature('private', 0, EN, 'en'), 'not a share')
  assert.equal(tokenNature('solana', 100, EN, 'en'), 'backed 1:1 · no vote')
})

test('the deadline carries the issuer’s minute in UTC; a time that does not parse carries nothing', () => {
  assert.equal(pathDeadline('2027-03-12T23:59:00.000Z', 'uk'), '12.03.2027, 23:59 UTC')
  assert.equal(pathDeadline('2027-03-12T23:59:00.000Z', 'en'), 'Mar 12, 2027, 23:59 UTC')
  assert.equal(pathDeadline('later', 'uk'), null)
})

test('what the answer states badly is not drawn: an unknown step, a token without an address, an insecure source', () => {
  const path = {
    ...spacexPath('solana'),
    steps: [
      step('private', 'passed', { date: '2025-09-16', token: { mint: 'not-a-mint', symbol: 'SPACEX' } }),
      step('delisting', 'passed', { date: '2026-06-12' }),
      step('ipo', 'someday', { date: '2026-06-12' }),
      step('solana', 'current', { date: '2026-06-12', token: { mint: SPCXX, symbol: 'SPCXx' } }),
    ],
    sources: [
      { label: 'Jupiter', url: 'http://jup.ag/tokens/x', publishedAt: null, readAt: '2026-09-25' },
      { label: ' ', url: 'https://example.com', publishedAt: null, readAt: '2026-09-25' },
      { label: 'PreStocks · SpaceX', url: 'https://www.prestocks.com/spacex', publishedAt: null, readAt: 'later' },
    ],
  }
  const view = companyPathView(path, { mint: SPCXX, privateFeeBps: 100, holder: false, nowMs: NOW }, UK, 'uk')
  assert.deepEqual(
    view.steps.map((entry) => [entry.step, entry.token?.symbol ?? null]),
    [
      ['private', null],
      ['solana', 'SPCXx'],
    ],
  )
  assert.deepEqual(
    view.sources.map((source) => source.line),
    ['PreStocks · SpaceX'],
  )
  assert.equal(
    companyPathView(
      { ...path, at: 'listed' },
      { mint: SPCXX, privateFeeBps: null, holder: false, nowMs: NOW },
      UK,
      'uk',
    ),
    null,
  )
  assert.equal(
    companyPathView({ ...path, steps: [] }, { mint: SPCXX, privateFeeBps: null, holder: false, nowMs: NOW }, UK, 'uk'),
    null,
  )
  assert.equal(companyPathView(null, { mint: SPCXX, privateFeeBps: null, holder: false, nowMs: NOW }, UK, 'uk'), null)
})

test('a token on the page’s own address is never a link to the page it is on', () => {
  const view = companyPathView(
    spacexPath('solana'),
    { mint: SPACEX, privateFeeBps: 100, holder: false, nowMs: NOW },
    UK,
    'uk',
  )
  assert.equal(view.steps[0].token.here, true)
})
