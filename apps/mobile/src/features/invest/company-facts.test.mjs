import assert from 'node:assert/strict'
import { test } from 'node:test'

import { COMPANY_COPY } from './company-copy.ts'
import {
  aboutFacts,
  backingPct,
  buyShare,
  companyHead,
  countShort,
  dayNumeric,
  dayShort,
  exchangeShort,
  issuerFeeText,
  moneyShort,
  multiplierWord,
  pathDay,
  pctShort,
  privateStats,
  publicSinceOf,
  tradingDay,
  truthTopicOf,
  whatYouBuyFacts,
  yearPoints,
  yearRange,
  yearStartsLate,
} from './company-facts.ts'
import { TRUTH_TOPICS, truthTopicText } from './truth-topics.ts'

/*
 * A company's facts at rest (M23): the web's company page (`RYN-COMPANY-PAGE-001`)
 * in the phone's words and figures. The expected lines are the ones production
 * showed for NVIDIA, the S&P 500 and SpaceX on 2026-09-26 at 390 px.
 */

const UK = COMPANY_COPY.uk
const EN = COMPANY_COPY.en
/** Intl writes the Ukrainian groups with a no-break space; the checks read it as a space. */
const plain = (text) => (typeof text === 'string' ? text.replace(/\s/g, ' ') : text)

const NVDA_EXCHANGE = { mic: 'XNAS', name: 'Nasdaq Stock Market', timezone: 'America/New_York' }
const NVDA_RESERVES = {
  symbol: 'NVDAx',
  sharesHeld: '186664.24989831',
  circulatingSupply: '186396.90245183678673',
  observedAt: '2026-09-26T12:51:13.890Z',
  custodians: ['Alpaca'],
}
const SPACEX_PATH = {
  at: 'private',
  steps: [
    { step: 'private', state: 'passed', date: '2025-09-16' },
    { step: 'ipo', state: 'passed', date: '2026-06-12' },
    { step: 'exchange', state: 'passed', date: '2026-06-12' },
    { step: 'solana', state: 'passed', date: '2026-06-12' },
  ],
  swap: {
    from: { mint: 'SPACEX-mint', symbol: 'SPACEX' },
    into: { mint: 'SPCXx-mint', symbol: 'SPCXx' },
    deadline: '2027-03-12T23:59:00.000Z',
    open: true,
  },
}

test('money in the web’s short form: трлн, млрд, млн, тис. in Ukrainian, T, B, M, K in English', () => {
  assert.equal(plain(moneyShort(5.41e12, 'uk')), '$5,41 трлн')
  assert.equal(plain(moneyShort(303e9, 'uk')), '$303 млрд')
  assert.equal(plain(moneyShort(24_595_479, 'uk')), '$24,6 млн')
  assert.equal(plain(moneyShort(3_427_408, 'uk')), '$3,43 млн')
  assert.equal(plain(moneyShort(912_000, 'uk')), '$912 тис.')
  assert.equal(plain(moneyShort(2_970, 'uk')), '$2,97 тис.')
  assert.equal(moneyShort(41, 'uk'), '$41')
  assert.equal(moneyShort(0.5, 'uk'), '$0,5')
  assert.equal(plain(moneyShort(-1.2e9, 'uk')), '−$1,2 млрд')
  assert.equal(moneyShort(1.93e12, 'en'), '$1.93T')
  assert.equal(moneyShort(110_400, 'en'), '$110K')
  assert.equal(moneyShort(null, 'uk'), null, 'unknown is not drawn, never $0')
  assert.equal(moneyShort(Number.NaN, 'en'), null)
})

test('people and trades whole: «113 тис.», «15,1 тис.», «9 996»', () => {
  assert.equal(plain(countShort(112_843, 'uk')), '113 тис.')
  assert.equal(plain(countShort(15_136, 'uk')), '15,1 тис.')
  assert.equal(plain(countShort(169_604, 'uk')), '170 тис.')
  assert.equal(plain(countShort(9_996, 'uk')), '9 996')
  assert.equal(plain(countShort(1_200_000, 'uk')), '1,2 млн')
  assert.equal(countShort(15_136, 'en'), '15.1K')
  assert.equal(countShort(79, 'en'), '79')
  assert.equal(countShort(-1, 'uk'), null)
  assert.equal(countShort(null, 'uk'), null)
})

test('a share with two decimals under one per cent and one above', () => {
  assert.equal(pctShort(100.1434, 'uk'), '100,1%')
  assert.equal(pctShort(0.1234, 'uk'), '0,12%')
  assert.equal(pctShort(48.29, 'uk'), '48,3%')
  assert.equal(pctShort(1, 'en'), '1.0%')
  assert.equal(pctShort(null, 'en'), null)
})

test('days as the web writes them: the source’s day, the chart’s day, the path’s day', () => {
  assert.equal(plain(dayShort('2026-09-26T12:51:13.890Z', 'uk')), '26 вер. 2026 р.')
  assert.equal(dayShort('2026-09-26T12:51:13.890Z', 'en'), 'Sep 26, 2026')
  assert.equal(plain(dayShort('2025-06-27T10:14:51.000Z', 'uk')), '27 черв. 2025 р.')
  assert.equal(dayShort('not a day', 'uk'), null)
  assert.equal(dayShort(null, 'uk'), null)
  const noon = new Date(2026, 2, 30, 12).getTime()
  assert.equal(dayNumeric(noon, 'uk'), '30.03.2026')
  assert.equal(dayNumeric(noon, 'en'), '03/30/2026')
  assert.equal(pathDay('2026-06-12', 'uk'), '12.06.2026')
  assert.equal(pathDay('2026-06-12', 'en'), 'Jun 12, 2026')
  assert.equal(pathDay('not a day', 'uk'), null)
})

test('the exchange’s short name from its MIC, else its stated name without the boilerplate', () => {
  assert.equal(exchangeShort(NVDA_EXCHANGE), 'Nasdaq')
  assert.equal(exchangeShort({ mic: 'ARCX', name: 'NYSE Arca' }), 'NYSE Arca')
  assert.equal(exchangeShort({ mic: 'XNYS', name: 'New York Stock Exchange' }), 'NYSE')
  assert.equal(exchangeShort({ mic: 'XTKS', name: 'Tokyo Stock Exchange' }), 'Tokyo')
  assert.equal(exchangeShort(null), null)
})

test('under the name: the ticker on its exchange; a private company’s standing; a public one’s token', () => {
  const nvidia = companyHead(
    { preIpo: false, symbol: 'NVDAx', ticker: 'NVDA', exchange: NVDA_EXCHANGE, path: null },
    UK,
    'uk',
  )
  assert.deepEqual(nvidia, { subline: 'NVDA · Nasdaq', status: null, exchange: 'Nasdaq', ticker: 'NVDA' })
  // Ondo and Backpack state no exchange: the ticker alone, never a guessed venue.
  const apple = companyHead({ preIpo: false, symbol: 'AAPLon', ticker: 'AAPL', exchange: null, path: null }, UK, 'uk')
  assert.equal(apple.subline, 'AAPL')
  assert.equal(apple.exchange, null)
  const openai = companyHead({ preIpo: true, symbol: 'OPENAI', ticker: 'OPENAI', exchange: null, path: null }, UK, 'uk')
  assert.deepEqual(openai, { subline: 'Приватна компанія', status: 'Приватна компанія', exchange: null, ticker: null })
  const spacex = companyHead(
    { preIpo: true, symbol: 'SPACEX', ticker: 'SPACEX', exchange: null, path: SPACEX_PATH },
    UK,
    'uk',
  )
  assert.equal(spacex.subline, 'SPACEX · токен PreStocks')
  assert.equal(spacex.status, 'Публічна з 12.06.2026')
  const english = companyHead(
    { preIpo: true, symbol: 'SPACEX', ticker: 'SPACEX', exchange: null, path: SPACEX_PATH },
    EN,
    'en',
  )
  assert.equal(english.subline, 'SPACEX · PreStocks token')
  assert.equal(english.status, 'Public since Jun 12, 2026')
  // A path without a swap says nothing of a listing.
  assert.equal(publicSinceOf({ ...SPACEX_PATH, swap: null }), null)
})

test('«Про компанію» as far as the contract says it: the exchange and ticker, a private company’s status', () => {
  const nvidia = companyHead(
    { preIpo: false, symbol: 'NVDAx', ticker: 'NVDA', exchange: NVDA_EXCHANGE, path: null },
    UK,
    'uk',
  )
  assert.deepEqual(
    aboutFacts(nvidia, UK).map(({ label, value }) => [label, value]),
    [['Біржа', 'Nasdaq · NVDA']],
  )
  const spacex = companyHead(
    { preIpo: true, symbol: 'SPACEX', ticker: 'SPACEX', exchange: null, path: SPACEX_PATH },
    UK,
    'uk',
  )
  assert.deepEqual(
    aboutFacts(spacex, UK).map(({ label, value }) => [label, value]),
    [['Статус', 'Публічна з 12.06.2026']],
  )
  const apple = companyHead({ preIpo: false, symbol: 'AAPLon', ticker: 'AAPL', exchange: null, path: null }, UK, 'uk')
  assert.deepEqual(aboutFacts(apple, UK), [], 'nothing to say beyond the head: the block is not drawn')
})

test('«Що ти купуєш» for NVIDIA: the issuer, the backing with its day, the dividends in the amount, no fee', () => {
  const facts = whatYouBuyFacts(
    {
      issuer: 'xstocks',
      issuerLabel: 'xStocks · Backed Finance',
      reserves: NVDA_RESERVES,
      multiplier: 1.001701196801074,
      feeBps: null,
      chainRead: true,
    },
    UK,
    'uk',
  )
  assert.deepEqual(
    facts.map(({ label, value, note }) => [label, plain(value), plain(note)]),
    [
      ['Емітент', 'xStocks · Backed Finance', null],
      ['Забезпечення', '100,1%', '186 664 акцій у Alpaca · резерви на 26 вер. 2026 р.'],
      ['Дивіденди', 'Уже в кількості токена', '×1,0017'],
      ['Комісія емітента за переказ', 'Немає', null],
    ],
  )
  const english = whatYouBuyFacts(
    {
      issuer: 'xstocks',
      issuerLabel: 'xStocks · Backed Finance',
      reserves: NVDA_RESERVES,
      multiplier: 1,
      feeBps: null,
      chainRead: true,
    },
    EN,
    'en',
  )
  assert.deepEqual(
    english.map(({ value, note }) => [value, note]),
    [
      ['xStocks · Backed Finance', null],
      ['100.1%', '186,664 shares held by Alpaca · reserves at Sep 26, 2026'],
      ['Already in the token amount', null],
      ['None', null],
    ],
  )
})

test('«Що ти купуєш» for a private token: no dividends, the chain’s own fee; an unread chain says nothing of a fee', () => {
  const spacex = whatYouBuyFacts(
    { issuer: 'prestocks', issuerLabel: 'PreStocks', reserves: null, multiplier: 5, feeBps: 100, chainRead: true },
    UK,
    'uk',
  )
  assert.deepEqual(
    spacex.map(({ label, value, note }) => [label, value, note]),
    [
      ['Емітент', 'PreStocks', null],
      ['Дивіденди', 'Немає', null],
      ['Комісія емітента за переказ', '1,0%', null],
    ],
  )
  const ondo = whatYouBuyFacts(
    {
      issuer: 'ondo',
      issuerLabel: 'Ondo Global Markets',
      reserves: null,
      multiplier: 1.0034,
      feeBps: null,
      chainRead: false,
    },
    UK,
    'uk',
  )
  assert.deepEqual(
    ondo.map(({ value, note }) => [value, note]),
    [
      ['Ondo Global Markets', null],
      ['Уже в ціні токена', null],
    ],
  )
  assert.equal(issuerFeeText(300, 'uk'), '3,0%')
  assert.equal(issuerFeeText(0, 'uk'), null)
  assert.equal(multiplierWord(5, 'en'), '×5')
  assert.equal(multiplierWord(1, 'uk'), null)
  assert.equal(backingPct('', '1'), null)
  assert.equal(backingPct('1', '0'), null)
})

test('the label is the issuer’s: one topic per issuer, none for an issuer no document was read for', () => {
  assert.equal(truthTopicOf('xstocks'), 'truthXStocks')
  assert.equal(truthTopicOf('ondo'), 'truthOndo')
  assert.equal(truthTopicOf('backpack'), 'truthBackpack')
  assert.equal(truthTopicOf('prestocks'), 'truthPreStocks')
  assert.equal(truthTopicOf('someone-else'), null)
  assert.equal(truthTopicText('truthXStocks', 'uk').title, 'Трекер із забезпеченням')
  assert.equal(
    truthTopicText('truthXStocks', 'uk').short,
    'Відстежує ціну акції. Акцію тримає кастодіан. Голосу немає.',
  )
  // Two lines at most (M27): the issuer's fee and its power to freeze are said under the company's name and in the
  // facts below, so the label's line says only what the token is not.
  assert.equal(
    truthTopicText('truthPreStocks', 'uk', '1,0%').short,
    'Ні власності, ні голосу, ні дивідендів. Продати може не вийти.',
  )
  assert.equal(
    truthTopicText('truthPreStocks', 'en', null).short,
    'No ownership, no vote, no dividends. Selling may not be possible.',
  )
})

test('the truth topics say the same in both languages, the English without a Cyrillic word', () => {
  const ids = Object.keys(TRUTH_TOPICS.en)
  assert.deepEqual(Object.keys(TRUTH_TOPICS.uk), ids)
  // The Ukrainian keeps only the issuers' own names and terms in Latin letters (and the fee's place).
  const kept = ['{fee}', 'xStocks', 'Backed Assets', 'SPYx', 'SPY', 'Ondo', 'ETF', 'ADR', 'Backpack', 'KYC', 'mint']
  for (const id of ids) {
    const en = TRUTH_TOPICS.en[id]
    const uk = TRUTH_TOPICS.uk[id]
    assert.equal(uk.example.length, en.example.length)
    for (const line of [en.title, en.short, en.what, ...en.example, en.important])
      assert.doesNotMatch(line, /[А-Яа-яІіЇїЄєҐґ]/, `${id}: Cyrillic in the English`)
    for (const line of [uk.title, uk.short, uk.what, ...uk.example, uk.important]) {
      let rest = line
      for (const name of kept) rest = rest.split(name).join(' ')
      assert.deepEqual(rest.match(/[A-Za-z]{2,}/g) ?? [], [], `${id}: English in the Ukrainian — ${line}`)
    }
  }
})

test('«Торги на Solana» for NVIDIA: the day’s figures, buying against selling, since when on Solana', () => {
  const day = tradingDay(
    {
      volume24hUsd: 24_547_609.77,
      liquidityUsd: 3_404_783.29,
      holders: 112_843,
      firstPoolAt: '2025-06-27T10:14:51.000Z',
      stats: { h24: { buys: 81_701, sells: 87_903, traders: 15_136 } },
    },
    UK,
    'uk',
  )
  assert.deepEqual(
    day.stats.map(({ label, value }) => [label, plain(value)]),
    [
      ['Обсяг', '$24,5 млн'],
      ['Ліквідність', '$3,4 млн'],
      ['Власників', '113 тис.'],
      ['Трейдерів', '15,1 тис.'],
      ['Угод', '170 тис.'],
    ],
  )
  assert.equal(day.pressure?.buys, '48,2%')
  assert.equal(day.pressure?.sells, '51,8%')
  assert.equal(plain(day.since), 'На Solana з 27 черв. 2025 р.')
  const unread = tradingDay(
    {
      volume24hUsd: null,
      liquidityUsd: null,
      holders: null,
      firstPoolAt: null,
      stats: { h24: { buys: null, sells: null, traders: null } },
    },
    EN,
    'en',
  )
  assert.deepEqual(unread, { stats: [], pressure: null, since: null }, 'nothing read, nothing drawn — never zeros')
  assert.equal(buyShare(0, 0), null)
  assert.equal(buyShare(null, 3), null)
})

test('the price over the year: anchored to the page’s price, its low and high with their days, where the price stands', () => {
  const now = Date.UTC(2026, 8, 26, 13)
  const day = 86_400_000
  // Six months of daily closes, the pool's last one a per cent above the page's price.
  const candles = Array.from({ length: 183 }, (_, index) => ({
    time: Math.floor((now - (183 - index) * day) / 1000),
    open: 1,
    high: 1,
    low: 1,
    close: index === 3 ? 160 : index === 50 ? 240 : 200 + (index % 7),
  }))
  candles[candles.length - 1] = { ...candles[candles.length - 1], close: 202 }
  const points = yearPoints(candles, 200, now)
  assert.equal(points.length, 183)
  assert.ok(Math.abs(points[points.length - 1].price - 200) < 1e-9, 'the line ends at the page’s price')
  const range = yearRange(points, 200, now)
  assert.ok(range)
  assert.ok(Math.abs(range.low - 160 * (200 / 202)) < 1e-9)
  assert.ok(Math.abs(range.high - 240 * (200 / 202)) < 1e-9)
  assert.equal(range.lowAt, candles[3].time * 1000)
  assert.ok(range.position > 0 && range.position < 1)
  assert.equal(yearStartsLate(range, now), true, 'half a year says since when, never «a year»')
  // A live price beyond the line is the year's new end, dated now.
  const higher = yearRange(points, 300, now)
  assert.equal(higher.high, 300)
  assert.equal(higher.highAt, now)
  assert.equal(higher.position, 1)
  assert.equal(yearRange(points.slice(0, 1), 200, now), null, 'one point is a figure, not a range')
  assert.deepEqual(yearPoints([], 200, now), [])
})

test('a private company’s key figures: PreStocks’ valuation and the one its token’s price implies, with their time', () => {
  const stats = privateStats(
    { valuationUsd: 1.93e12, impliedValuationUsd: 1.51e12, fetchedAt: '2026-09-26T13:07:00.000Z', stale: false },
    'PreStocks',
    UK,
    'uk',
  )
  assert.deepEqual(
    stats.map(({ label, value }) => [label, plain(value)]),
    [
      ['Оцінка компанії', '$1,93 трлн'],
      ['За ціною токена', '$1,51 трлн'],
    ],
  )
  assert.match(stats[0].hint, /^PreStocks · на \d{2}:\d{2}$/)
  const stale = privateStats(
    { valuationUsd: 1.93e12, impliedValuationUsd: null, fetchedAt: '2026-09-26T13:07:00.000Z', stale: true },
    'PreStocks',
    EN,
    'en',
  )
  assert.equal(stale.length, 1)
  assert.match(stale[0].hint, /^PreStocks · at \d{2}:\d{2} · not updated$/)
  assert.deepEqual(privateStats(null, 'PreStocks', UK, 'uk'), [])
})
