import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BLOCKED_STEMS, BLOCKED_WORDS } from './blocked-names.ts'
import {
  catalogueMatches,
  editDistance,
  farFromShare,
  hitsObservedAt,
  matchStocks,
  mergeHits,
  namesShareIssuer,
  stockHit,
  stockLookalike,
  stockPoolFar,
  tickerRoot,
  tracksShare,
  typoBudget,
} from './search.ts'

const NVDA = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'
const COPY = 'Copy1111111111111111111111111111111111111'
const SOL = 'So11111111111111111111111111111111111111112'

const stock = (over = {}) => ({
  mint: NVDA,
  symbol: 'NVDAx',
  name: 'NVIDIA',
  issuer: 'xstocks',
  icon: null,
  halted: false,
  price: 211.75,
  change24h: -1.08,
  reference: 211.82,
  referenceState: 'current',
  referenceAt: '2026-09-15T07:39:00.510Z',
  deviation: -0.2,
  period: 'overnight',
  volume: 7_262_889,
  liquidity: 1_719_937,
  ...over,
})

const row = (over = {}) => ({
  mint: SOL,
  symbol: 'SOL',
  name: 'Solana',
  icon: null,
  decimals: 9,
  price: 214.4,
  change24hPct: 1.2,
  volume24hUsd: 1e9,
  liquidityUsd: 1e8,
  verified: true,
  suspicious: false,
  category: 'crypto',
  issuer: null,
  ...over,
})

test('a company name finds its stock; the empty query finds nothing', () => {
  const rows = [stock(), stock({ mint: SOL, symbol: 'AAPLx', name: 'Apple', volume: 10 })]
  assert.deepEqual(
    matchStocks(rows, 'nvidia').map((entry) => entry.symbol),
    ['NVDAx'],
  )
  assert.deepEqual(matchStocks(rows, '   '), [])
})

test('exact symbol beats a prefix beats a part, volume breaks ties', () => {
  const rows = [
    stock({ mint: SOL, symbol: 'NVDAxx', name: 'Not it', volume: 1 }),
    stock({ mint: COPY, symbol: 'XNVDAX', name: 'Also', volume: 5 }),
    stock(),
  ]
  assert.deepEqual(
    matchStocks(rows, 'nvdax').map((entry) => entry.symbol),
    ['NVDAx', 'NVDAxx', 'XNVDAX'],
  )
})

test('stocks lead, the venue follows with exact and verified first, one row per mint, a copy last', () => {
  const hits = mergeHits(
    [stock()],
    [
      row({ mint: COPY, symbol: 'NVDAx', name: 'NVIDIA', price: 0.0001, verified: false, category: 'stock' }),
      row({ mint: NVDA, symbol: 'NVDAx', name: 'NVIDIA xStock', category: 'stock' }),
      row(),
    ],
    'nvdax',
  )
  assert.deepEqual(
    hits.map((hit) => [hit.symbol, hit.origin, hit.verified]),
    [
      ['NVDAx', 'stocks', true],
      ['SOL', 'catalogue', true],
      ['NVDAx', 'catalogue', false],
    ],
  )
  assert.equal(hits[2].lookalikeOf, 'NVIDIA')
  assert.equal(hits[0].issuer.label, 'xStocks')
  assert.equal(hits[0].note, 'Overnight')
})

test('a stock with an unknown session carries no note; a halted one says so', () => {
  const [quiet, halted] = mergeHits([stock({ period: 'unknown' }), stock({ mint: SOL, halted: true })], [], 'x')
  assert.equal(quiet.note, null)
  assert.equal(halted.halted, true)
})

test('a stock hit says its session in the language asked for', () => {
  const [hit] = mergeHits([stock({ period: 'overnight' })], [], 'nvda', 'uk')
  assert.equal(hit.note, 'Нічна сесія')
  const [closed] = mergeHits([stock({ period: 'closed' })], [], 'nvda', 'uk')
  assert.equal(closed.note, 'Біржа зачинена')
})

const FAKE = 'Fake111111111111111111111111111111111111111'
const ONDO = 'Ondo111111111111111111111111111111111111111'

test("a company's ticker under the issuer's symbol: NVDAx and AAPLon, a PreStocks symbol as it is", () => {
  assert.equal(tickerRoot('NVDAx', 'xstocks'), 'nvda')
  assert.equal(tickerRoot('AAPLon', 'ondo'), 'aapl')
  assert.equal(tickerRoot('SPACEX', 'prestocks'), 'spacex')
  assert.equal(tickerRoot('x', 'xstocks'), 'x')
})

test('a verified token that takes a stock ticker and its name is not the stock, and comes after the rest', () => {
  const universe = [stock()]
  const fake = row({ mint: FAKE, symbol: 'NVDA', name: 'NVIDIA', price: 0.000131, change24hPct: null, verified: true, category: 'meme' })
  const near = row({ mint: COPY, symbol: 'NVDAI', name: 'Nvda AI agent', verified: true, category: 'meme' })
  const plain = row({ mint: SOL, symbol: 'NVDAQ', name: 'Some coin', verified: false })
  const hits = mergeHits(matchStocks(universe, 'nvda'), [fake, near, plain], 'nvda', 'uk', universe)
  assert.deepEqual(
    hits.map((hit) => [hit.symbol, hit.lookalikeOf]),
    [
      ['NVDAx', null],
      ['NVDAI', null],
      ['NVDAQ', null],
      ['NVDA', 'NVIDIA'],
    ],
  )
  // The venue's own word stays as it is: the row is verified, and still not the stock.
  assert.equal(hits[3].verified, true)
})

test('a look-alike is found by the ticker alone, by the company name alone, and with a $ before its symbol', () => {
  const universe = [stock({ name: 'NVIDIA Corp' })]
  const of = (over) => stockLookalike(row({ mint: FAKE, price: 0.0002, ...over }), universe)?.symbol ?? null
  assert.equal(of({ symbol: 'NVDA', name: 'Whatever' }), 'NVDAx')
  assert.equal(of({ symbol: '$nvda', name: 'Whatever' }), 'NVDAx')
  assert.equal(of({ symbol: 'NVDAx', name: 'Whatever' }), 'NVDAx')
  assert.equal(of({ symbol: 'GPU', name: 'Nvidia' }), 'NVDAx')
  assert.equal(of({ symbol: 'GPU', name: 'NVIDIA Token' }), 'NVDAx')
  // A name that only begins with the same letters is another name.
  assert.equal(of({ symbol: 'GPU', name: 'Nvidiax Pump' }), null)
  assert.equal(of({ symbol: 'SOL', name: 'Solana' }), null)
})

test('the stock itself and a stock token an issuer stands behind are never look-alikes', () => {
  const universe = [stock()]
  assert.equal(stockLookalike(row({ mint: NVDA, symbol: 'NVDAx', name: 'NVIDIA', category: 'stock' }), universe), null)
  const ondo = row({
    mint: ONDO,
    symbol: 'NVDAon',
    name: 'NVIDIA (Ondo Tokenized)',
    category: 'stock',
    issuer: { label: 'Ondo', tag: 'ondo' },
  })
  assert.equal(stockLookalike(ondo, universe), null)
  // A stock-looking token no issuer stands behind, priced far from the share and naming no issuer, is a look-alike.
  assert.equal(stockLookalike({ ...ondo, name: 'NVIDIA', price: 0.0003, issuer: null }, universe)?.name, 'NVIDIA')
})

test('with no universe given, the matching stocks answer, so a search alone still marks the copy', () => {
  const fake = row({ mint: FAKE, symbol: 'NVDA', name: 'NVIDIA', price: 0.0001 })
  const [first, second] = mergeHits([stock()], [fake], 'nvda')
  assert.equal(first.origin, 'stocks')
  assert.equal(second.lookalikeOf, 'NVIDIA')
})

test('a token whose name names an issuer is taken at its word only while its price may be the share', () => {
  const universe = [stock({ price: 217.4, reference: 217.2 })]
  // Priced as the share by another issuer: «NVDA · NVIDIA - Securitize · $217.51».
  const securitize = row({ mint: FAKE, symbol: 'NVDA', name: 'NVIDIA - Securitize', price: 217.51, verified: false })
  assert.equal(stockLookalike(securitize, universe), null)
  // A thin pool drifts: half to twice the share is still the issuer's word; no price stated, nothing denies it.
  for (const price of [120, 400, null]) {
    assert.equal(stockLookalike({ ...securitize, price }, universe), null, String(price))
  }
  // Far from the share, whatever issuer it names, it is not the stock.
  for (const name of ['NVIDIA xStock', 'NVIDIA (Ondo Tokenized)', 'NVIDIA Backpack', 'NVIDIA Dinari', 'NVIDIA Robinhood', 'NVIDIA PreStocks', 'NVIDIA Kraken', 'NVIDIA - Securitize']) {
    assert.equal(stockLookalike(row({ mint: FAKE, symbol: 'NVDA', name, price: 0.0001 }), universe)?.name, 'NVIDIA', name)
  }
  assert.equal(namesShareIssuer('Securitized Pump'), false)
  assert.equal(namesShareIssuer('Ondoge'), false)
  // The venue's own word stays: the unverified row is still unverified in the merged list.
  const [, hit] = mergeHits([stock()], [securitize], 'nvda')
  assert.deepEqual([hit.lookalikeOf, hit.verified], [null, false])
})

test('two «NVDAx · NVIDIA xStock» copies at $0.0000029 are not the stock; the real one at $217 stays clean', () => {
  const universe = [stock({ price: 217.4, reference: 217.2 })]
  const COPY_TWO = 'Copy2222222222222222222222222222222222222'
  const catalogue = [
    row({ mint: COPY, symbol: 'NVDAx', name: 'NVIDIA xStock', price: 0.00000292, verified: false, category: 'meme' }),
    row({ mint: COPY_TWO, symbol: 'NVDAx', name: 'NVIDIA xStock', price: 0.00000307, verified: false, category: null }),
    row({ mint: NVDA, symbol: 'NVDAx', name: 'NVIDIA xStock', price: 217.31, category: 'stock', issuer: { label: 'xStocks', tag: 'xstocks' } }),
    row({ mint: FAKE, symbol: 'NVDA', name: 'NVIDIA - Securitize', price: 217.51, verified: false }),
  ]
  const hits = mergeHits(matchStocks(universe, 'nvdax'), catalogue, 'nvdax', 'uk', universe)
  assert.deepEqual(
    hits.map((hit) => [hit.mint, hit.lookalikeOf]),
    [
      [NVDA, null],
      [FAKE, null],
      [COPY, 'NVIDIA'],
      [COPY_TWO, 'NVIDIA'],
    ],
  )
  // The confirmed stock's own mint is never marked, whatever price the catalogue states for it.
  assert.equal(stockLookalike({ ...catalogue[2], price: 0.000003, category: null, issuer: null }, universe), null)
  assert.equal(farFromShare(0.0000029, { price: 217.4, reference: null }), true)
  assert.equal(farFromShare(150, { price: 217.4, reference: null }), false)
  assert.equal(farFromShare(0.0000029, { price: null, reference: null }), false)
  assert.equal(farFromShare(null, { price: 217.4, reference: 217.2 }), false)
})

test('a token priced within ±5 % of the share tracks it and is never «not the stock»', () => {
  const universe = [stock({ price: 211.75, reference: 211.82 })]
  const at = (price) => stockLookalike(row({ mint: FAKE, symbol: 'NVDA', name: 'NVIDIA', price }), universe)?.name ?? null
  assert.equal(at(217.51), null)
  assert.equal(at(201.2), null)
  assert.equal(at(230), 'NVIDIA')
  assert.equal(at(0.000131), 'NVIDIA')
  // No price stated: nothing says it tracks the share.
  assert.equal(at(null), 'NVIDIA')
  assert.equal(tracksShare(100, { price: null, reference: 104 }), true)
  assert.equal(tracksShare(100, { price: null, reference: null }), false)
  assert.equal(tracksShare(0, { price: 0, reference: 0 }), false)
})

test('a token whose symbol or name carries a blocked word is left out of the search', () => {
  const stem = BLOCKED_STEMS[0]
  const word = BLOCKED_WORDS[0]
  const hits = mergeHits(
    [],
    [
      row({ mint: FAKE, symbol: stem.toUpperCase(), name: 'Plain name' }),
      row({ mint: COPY, symbol: 'PLAIN', name: `Some ${word} coin` }),
      row(),
    ],
    'plain',
  )
  assert.deepEqual(
    hits.map((hit) => hit.symbol),
    ['SOL'],
  )
})

test('one typo still finds the stock — by the company name and by the ticker root — after exact and prefix matches', () => {
  const TSLA = 'Tsla111111111111111111111111111111111111111'
  const universe = [
    stock(),
    stock({ mint: ONDO, symbol: 'NVDAon', name: 'NVIDIA', issuer: 'ondo', volume: 10 }),
    stock({ mint: TSLA, symbol: 'TSLAx', name: 'Tesla Inc', volume: 5 }),
    stock({ mint: SOL, symbol: 'ACx', name: 'Acme', volume: 1 }),
  ]
  const symbols = (query) => matchStocks(universe, query).map((entry) => entry.symbol)
  assert.deepEqual(symbols('nvidiaa'), ['NVDAx', 'NVDAon'])
  assert.deepEqual(symbols('nvdia'), ['NVDAx', 'NVDAon'])
  assert.deepEqual(symbols('tesal'), ['TSLAx'])
  assert.deepEqual(symbols('tsl'), ['TSLAx'])
  assert.deepEqual(symbols('tslq'), ['TSLAx'])
  // Two letters are too few to guess at: «ab» is not «AC».
  assert.deepEqual(symbols('ab'), [])
  // A three-letter ticker one letter off is another word: «pepe» is the coin, not PepsiCo.
  assert.deepEqual(
    matchStocks([stock({ mint: COPY, symbol: 'PEPx', name: 'PepsiCo' })], 'pepe').map((entry) => entry.symbol),
    [],
  )
  assert.deepEqual(symbols('nvdsx'), ['NVDAx'])
  assert.deepEqual(symbols('zzzzzz'), [])
  // Seven letters and more may stand two edits away; six, one.
  assert.deepEqual(symbols('nviidiaa'), ['NVDAx', 'NVDAon'])
  assert.deepEqual(symbols('nvidxx'), [])
  // An exact ticker comes before a name one typo away.
  const ranked = matchStocks([stock({ mint: COPY, symbol: 'NVDBx', name: 'Other', volume: 1 }), stock()], 'nvdbx')
  assert.deepEqual(
    ranked.map((entry) => entry.symbol),
    ['NVDBx', 'NVDAx'],
  )
  // A stock one typo away still leads every catalogue row, the unverified ones above all.
  const hits = mergeHits(matchStocks(universe, 'nvidiaa'), [row({ mint: FAKE, symbol: 'NVIDIAA', name: 'Nvidiaa', verified: false })], 'nvidiaa', 'uk', universe)
  assert.deepEqual(
    hits.map((hit) => [hit.symbol, hit.origin]),
    [
      ['NVDAx', 'stocks'],
      ['NVDAon', 'stocks'],
      ['NVIDIAA', 'catalogue'],
    ],
  )
})

test('edits count a swap of neighbours as one and stop past the budget', () => {
  assert.equal(editDistance('tesal', 'tesla', 1), 1)
  assert.equal(editDistance('nvidiaa', 'nvidia', 2), 1)
  assert.equal(editDistance('nvdia', 'nvidia', 1), 1)
  assert.equal(editDistance('abc', 'xyz', 1), 2)
  assert.equal(editDistance('a', 'abcdef', 2), 3)
  assert.deepEqual([typoBudget(3), typoBudget(4), typoBudget(6), typoBudget(7)], [0, 1, 1, 2])
})

test('a row of the previous answer stands under the new query only while it holds the typed words', () => {
  const backpack = row({ mint: COPY, symbol: 'BP', name: 'Backpack' })
  const bonk = row({ mint: FAKE, symbol: 'BONK', name: 'Bonk' })
  assert.equal(catalogueMatches(backpack, 'bonk'), false)
  assert.equal(catalogueMatches(bonk, 'bonk'), true)
  assert.equal(catalogueMatches(bonk, ' BON '), true)
  assert.equal(catalogueMatches(row({ symbol: 'X', name: 'Bonk Inu' }), 'bonk'), true)
  assert.equal(catalogueMatches(bonk, FAKE.toLowerCase()), true)
  assert.equal(catalogueMatches(bonk, '  '), false)
})

test('«bonk» is the coin: no Treasury ETF or bank one letter from «bond» or «bank», and the coin leads', () => {
  const universe = [
    stock({
      mint: 'Sgov111111111111111111111111111111111111111',
      symbol: 'SGOVon',
      name: 'iShares 0-3 Month Treasury Bond ETF',
      issuer: 'ondo',
    }),
    stock({
      mint: 'Tlt1111111111111111111111111111111111111111',
      symbol: 'TLTon',
      name: 'iShares 20+ Year Treasury Bond ETF',
      issuer: 'ondo',
    }),
    stock({ mint: 'Bac1111111111111111111111111111111111111111', symbol: 'BACx', name: 'Bank of America' }),
    stock({ mint: 'Gld1111111111111111111111111111111111111111', symbol: 'GLDx', name: 'SPDR Gold Trust' }),
    stock(),
  ]
  // A generic word of a company's name is never guessed at.
  assert.deepEqual(
    matchStocks(universe, 'bonk').map((entry) => entry.symbol),
    [],
  )
  assert.deepEqual(
    matchStocks(universe, 'bnak').map((entry) => entry.symbol),
    [],
  )
  assert.deepEqual(
    matchStocks(universe, 'gols').map((entry) => entry.symbol),
    [],
  )
  // The distinctive words still are: «nvidiaa» is NVIDIA; «bank of amerca» is Bank of America.
  assert.deepEqual(
    matchStocks(universe, 'nvidiaa').map((entry) => entry.symbol),
    ['NVDAx'],
  )
  assert.deepEqual(
    matchStocks(universe, 'bank of amerca').map((entry) => entry.symbol),
    ['BACx'],
  )
  const bonk = row({ mint: FAKE, symbol: 'Bonk', name: 'Bonk', verified: true })
  const hits = mergeHits(matchStocks(universe, 'bonk'), [bonk], 'bonk', 'uk', universe)
  assert.deepEqual(
    hits.map((hit) => [hit.symbol, hit.origin]),
    [['Bonk', 'catalogue']],
  )
})

test('a stock found only by a typo is left out when the venue holds the typed word, and kept when it does not', () => {
  const BONX = 'Bonx111111111111111111111111111111111111111'
  // A ticker root one letter from the coin: found by the typo, but «bonk» is the coin's own word.
  const universe = [stock({ mint: BONX, symbol: 'BONXx', name: 'Bonx Industries' }), stock()]
  assert.deepEqual(
    matchStocks(universe, 'bonk').map((entry) => entry.symbol),
    ['BONXx'],
  )
  const coin = row({ mint: FAKE, symbol: 'BONK', name: 'Bonk', verified: true })
  assert.deepEqual(
    mergeHits(matchStocks(universe, 'bonk'), [coin], 'bonk', 'en', universe).map((hit) => hit.symbol),
    ['BONK'],
  )
  // A name that starts with the word counts as well.
  const named = row({ mint: FAKE, symbol: 'BNK', name: 'Bonk Inu', verified: true })
  assert.deepEqual(
    mergeHits(matchStocks(universe, 'bonk'), [named], 'bonk', 'en', universe).map((hit) => hit.symbol),
    ['BNK'],
  )
  // An unverified copy does not hold the word: the stock stays, first.
  const copy = row({ mint: FAKE, symbol: 'BONK', name: 'Bonk', verified: false })
  assert.deepEqual(
    mergeHits(matchStocks(universe, 'bonk'), [copy], 'bonk', 'en', universe).map((hit) => [hit.symbol, hit.origin]),
    [
      ['BONXx', 'stocks'],
      ['BONK', 'catalogue'],
    ],
  )
  // A stock that holds the typed words is never dropped, and a typo-only one stands after it.
  const both = [
    stock({ mint: BONX, symbol: 'BONXx', name: 'Bonx Industries' }),
    stock({ mint: COPY, symbol: 'BONKx', name: 'Bonk Labs' }),
  ]
  assert.deepEqual(
    mergeHits(matchStocks(both, 'bonk'), [], 'bonk', 'en', both).map((hit) => hit.symbol),
    ['BONKx', 'BONXx'],
  )
  assert.deepEqual(
    mergeHits(matchStocks(both, 'bonk'), [coin], 'bonk', 'en', both).map((hit) => hit.symbol),
    ['BONKx', 'BONK'],
  )
})

test('a merged list is true at the oldest read it draws from, and only the reads it draws from', () => {
  const early = '2026-10-19T11:49:00.000Z'
  const late = '2026-10-19T12:06:00.000Z'
  const both = [{ origin: 'stocks' }, { origin: 'catalogue' }]
  assert.equal(hitsObservedAt(both, late, early), early)
  assert.equal(hitsObservedAt(both, early, late), early)
  assert.equal(hitsObservedAt([{ origin: 'catalogue' }], late, early), late)
  assert.equal(hitsObservedAt([{ origin: 'stocks' }], late, early), early)
  assert.equal(hitsObservedAt([{ origin: 'stocks' }], late, null), null)
  assert.equal(hitsObservedAt([], late, early), null)
})

test('a stock whose pool price stands far from the share is marked on its row — never without a reference (ST-5 r8)', () => {
  // SGOVx at $2 090,43 against a $100,59 share; SGOVon at $100,75 beside it is not marked.
  const sgovx = stock({ symbol: 'SGOVx', name: 'iShares 0-3 Month Treasury Bond ETF', price: 2090.43, reference: 100.59, deviation: 1978.2 })
  assert.equal(stockHit(sgovx).poolFar, true)
  assert.equal(stockHit(stock({ symbol: 'SGOVon', price: 100.75, reference: 100.59, deviation: 0.16 })).poolFar, false)
  assert.equal(stockPoolFar({ deviation: 1978.2, reference: null }), false, 'no reference, no claim')
  assert.equal(stockPoolFar({ deviation: -40, reference: 10, kind: 'pre-ipo' }), false, 'a private token has no share')
})
