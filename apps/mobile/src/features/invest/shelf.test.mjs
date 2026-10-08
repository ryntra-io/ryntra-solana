import assert from 'node:assert/strict'
import { test } from 'node:test'

import { INVEST_COPY } from './copy.ts'
import {
  coinName,
  coinShelf,
  companyDisplayName,
  companyShelf,
  DOLLAR_MINTS,
  isShelfCandidate,
  markPremium,
  matchCoins,
  matchShelf,
  parseShelf,
  POPULAR_COUNT,
  premiumPhrase,
  PRIVATE_ISSUER,
  serializeShelf,
  shelfCardFor,
  shelfCompanies,
  shelfPrivateCompanies,
} from './shelf.ts'

const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'

let serial = 0
/** A universe row as the route answers it, with only the fields the shelf reads. */
function stock({
  symbol,
  issuer = 'xstocks',
  underlying,
  isin = null,
  name = `${underlying} Inc.`,
  confirmation = issuer === 'xstocks' ? 'issuer-catalogue' : 'tag-only',
  klass = 'listed-equity',
  unit = klass === 'pre-ipo' ? 'token' : 'share',
  price = 100,
  change = 1.234,
  volume = 1000,
  liquidity = 10_000,
  halted = false,
  tradable = true,
  icon = null,
  premium = null,
}) {
  serial += 1
  return {
    representation: {
      mint: `Mint${String(serial).padStart(4, '0')}${symbol}`,
      symbol,
      name: `${symbol} token`,
      issuer: { id: issuer, label: issuer, catalogue: confirmation === 'issuer-catalogue' },
      issuerConfirmation: confirmation,
      instrument: { class: klass, unitBasis: unit },
      underlying: { symbol: underlying, isin, listingCountry: null, name },
      tradingHalted: halted,
    },
    market: { priceUsd: price, change24hPct: change, volume24hUsd: volume, liquidityUsd: liquidity, icon },
    markPremiumPct: premium,
    lifecycle: { state: tradable ? 'active' : 'closed', tradable },
  }
}

test('a company is named as a person names it: no legal form, no share-class boilerplate, index funds by their index', () => {
  assert.equal(companyDisplayName('Apple Inc.'), 'Apple')
  assert.equal(companyDisplayName('Applied Materials, Inc.'), 'Applied Materials')
  assert.equal(companyDisplayName('The Coca-Cola Company'), 'Coca-Cola')
  assert.equal(companyDisplayName('NVIDIA Corporation Common Stock'), 'NVIDIA')
  assert.equal(companyDisplayName('SPDR S&P 500 ETF Trust', 'SPY'), 'S&P 500')
  assert.equal(companyDisplayName('Invesco QQQ Trust', 'qqq'), 'Nasdaq 100')
  assert.equal(companyDisplayName('  Inc.  '), 'Inc.')
})

test('one company, one card: the issuer’s own catalogue first, then the deepest pool; the day’s volume of every representation', () => {
  const rows = [
    stock({ symbol: 'AAPLx', underlying: 'AAPL', liquidity: 100, volume: 300 }),
    stock({ symbol: 'AAPLbp', issuer: 'backpack', underlying: 'AAPL', liquidity: 500, volume: 200 }),
    stock({ symbol: 'AAPLon', issuer: 'ondo', underlying: 'AAPL', liquidity: 1000, volume: 100 }),
  ]
  const cards = shelfCompanies(rows)
  assert.equal(cards.length, 1)
  assert.equal(cards[0].ticker, 'AAPLx')
  assert.equal(cards[0].name, 'AAPL')
  assert.equal(cards[0].volume24h, 600)
  assert.equal(cards[0].change24h, 1.23)
})

test('a representation that cannot be bought now is no card; the next one of the company stands in', () => {
  const halted = [
    stock({ symbol: 'NVDAx', underlying: 'NVDA', halted: true }),
    stock({ symbol: 'NVDAbp', issuer: 'backpack', underlying: 'NVDA' }),
  ]
  assert.equal(shelfCompanies(halted)[0].ticker, 'NVDAbp')
  assert.equal(isShelfCandidate(halted[0]), false)
  assert.equal(isShelfCandidate(stock({ symbol: 'A', underlying: 'A', tradable: false })), false)
  assert.equal(isShelfCandidate(stock({ symbol: 'B', underlying: 'B', price: null })), false)
  assert.equal(isShelfCandidate(stock({ symbol: 'C', underlying: 'C', price: 0 })), false)
  // Ondo alone is not a beginner's shelf: the company has no card.
  assert.deepEqual(shelfCompanies([stock({ symbol: 'TSLAon', issuer: 'ondo', underlying: 'TSLA' })]), [])
})

test('two listings under one ticker are two companies when their ISINs differ; a share class is its own', () => {
  const rows = [
    stock({ symbol: 'Xa', underlying: 'X', isin: 'US0000000001' }),
    stock({ symbol: 'Xb', issuer: 'backpack', underlying: 'X', isin: 'US0000000002' }),
    stock({ symbol: 'Xc', issuer: 'backpack', underlying: 'X', isin: null }),
    stock({ symbol: 'GOOGLx', underlying: 'GOOGL' }),
    stock({ symbol: 'GOOGx', underlying: 'GOOG' }),
  ]
  const tickers = shelfCompanies(rows).map((card) => card.ticker)
  assert.equal(tickers.length, 4)
  assert.ok(tickers.includes('Xa') && tickers.includes('Xb'))
  assert.ok(!tickers.includes('Xc'), 'a row without an ISIN joins the first group it matches')
})

test('the order is the day’s volume, the same for everyone; a tie goes by name', () => {
  const rows = [
    stock({ symbol: 'Bx', underlying: 'B', name: 'Beta Inc.', volume: 50 }),
    stock({ symbol: 'Ax', underlying: 'A', name: 'Alpha Inc.', volume: 50 }),
    stock({ symbol: 'Cx', underlying: 'C', name: 'Gamma Inc.', volume: 900 }),
    stock({ symbol: 'Dx', underlying: 'D', name: 'Delta Inc.', volume: null }),
  ]
  assert.deepEqual(
    shelfCompanies(rows).map((card) => card.name),
    ['Gamma', 'Alpha', 'Beta', 'Delta'],
  )
  assert.equal(POPULAR_COUNT, 8)
})

test('private companies come through PreStocks alone: every instrument its own card with its premium, never a listed share among them', () => {
  const rows = [
    stock({
      symbol: 'OPENAI',
      issuer: 'prestocks',
      underlying: 'OPENAI',
      name: 'OpenAI',
      klass: 'pre-ipo',
      volume: 10,
      premium: 30.9412,
    }),
    stock({ symbol: 'SPACEX', issuer: 'prestocks', underlying: 'SPACEX', name: 'SpaceX', klass: 'pre-ipo', volume: 5 }),
    // Another issuer's token on the same company is not a private company Ryntra offers.
    stock({
      symbol: 'xOPENAI',
      issuer: 'another-issuer',
      underlying: 'OPENAI',
      name: 'OpenAI',
      klass: 'pre-ipo',
      volume: 30,
    }),
    stock({ symbol: 'GONE', issuer: 'prestocks', underlying: 'GONE', klass: 'pre-ipo', tradable: false }),
    stock({ symbol: 'STOP', issuer: 'prestocks', underlying: 'STOP', klass: 'pre-ipo', halted: true }),
    stock({ symbol: 'AAPLx', underlying: 'AAPL', premium: 2 }),
  ]
  const cards = shelfPrivateCompanies(rows)
  assert.deepEqual(
    cards.map((card) => `${card.name}:${card.ticker}:${card.issuer}:${card.premiumPct}`),
    ['OpenAI:OPENAI:prestocks:30.94', 'SpaceX:SPACEX:prestocks:null'],
  )
  assert.equal(PRIVATE_ISSUER, 'prestocks')
  // A pre-IPO token is never folded into a listed company's card.
  assert.deepEqual(
    shelfCompanies(rows).map((card) => card.ticker),
    ['AAPLx'],
  )
  const shelf = companyShelf({ rows, fetchedAt: '2026-09-23T17:40:04.764Z' })
  assert.equal(shelfCardFor(shelf, cards[0].mint)?.ticker, 'OPENAI')
  assert.equal(shelfCardFor(shelf, rows[2].representation.mint), null, 'another issuer’s token is no card')
  assert.equal(shelfCardFor(shelf, 'unknown'), null)
  assert.equal(shelfCardFor(null, cards[0].mint), null)
})

test('a private company’s one number: its price against PreStocks’ valuation, whole from ten per cent, one decimal below', () => {
  assert.deepEqual(markPremium(30.94), { side: 'above', pct: 31 })
  assert.deepEqual(markPremium(-22.09), { side: 'below', pct: 22 })
  assert.deepEqual(markPremium(-0.72), { side: 'below', pct: 0.7 })
  assert.deepEqual(markPremium(9.96), { side: 'above', pct: 10 })
  assert.deepEqual(markPremium(3.94), { side: 'above', pct: 3.9 })
  assert.deepEqual(markPremium(0.04), { side: 'at', pct: 0 })
  assert.equal(markPremium(null), null, 'none stated, none said — never a zero')
  assert.equal(markPremium(Number.NaN), null)
  assert.equal(premiumPhrase(30.94, 'uk', INVEST_COPY.uk), 'На 31% дорожче за оцінку PreStocks')
  assert.equal(premiumPhrase(-22.09, 'uk', INVEST_COPY.uk), 'На 22% дешевше за оцінку PreStocks')
  assert.equal(premiumPhrase(-0.72, 'uk', INVEST_COPY.uk), 'На 0,7% дешевше за оцінку PreStocks')
  assert.equal(premiumPhrase(30.94, 'en', INVEST_COPY.en), '31% above PreStocks’ valuation')
  assert.equal(premiumPhrase(-3.94, 'en', INVEST_COPY.en), '3.9% below PreStocks’ valuation')
  assert.equal(premiumPhrase(0.01, 'uk', INVEST_COPY.uk), 'Ціна дорівнює оцінці PreStocks')
  assert.equal(premiumPhrase(undefined, 'en', INVEST_COPY.en), null)
})

test('a search finds a company by its name or its token: the exact word first, then a start, then anywhere', () => {
  const cards = shelfCompanies([
    stock({ symbol: 'APPx', underlying: 'APP', name: 'AppLovin Corporation', volume: 900 }),
    stock({ symbol: 'AAPLx', underlying: 'AAPL', name: 'Apple Inc.', volume: 100 }),
    stock({ symbol: 'PINEx', underlying: 'PINE', name: 'Pineapple Energy Inc.', volume: 5000 }),
  ])
  assert.deepEqual(
    matchShelf(cards, 'apple').map((card) => card.name),
    ['Apple', 'Pineapple Energy'],
  )
  // Two starts rank by the day's volume; a match inside a word comes after them.
  assert.deepEqual(
    matchShelf(cards, 'APP').map((card) => card.ticker),
    ['APPx', 'AAPLx', 'PINEx'],
  )
  assert.equal(matchShelf(cards, '  ').length, 3)
  assert.deepEqual(matchShelf(cards, 'zzz'), [])
})

/** A market row as `/api/spot/markets` answers it. */
function coin({
  mint,
  symbol,
  name = symbol,
  category = 'crypto',
  price = 1,
  change = 0.5,
  volume = 100,
  verified = true,
  suspicious = false,
}) {
  return {
    mint,
    symbol,
    name,
    icon: null,
    decimals: 6,
    price,
    change24hPct: change,
    volume24hUsd: volume,
    liquidityUsd: null,
    verified,
    suspicious,
    category,
    issuer: null,
  }
}

test('the dollars are USDC then USDT when priced; the crypto is verified, unflagged, never a meme or a money token, by volume', () => {
  const rows = [
    coin({ mint: USDT, symbol: 'USDT', name: 'USDT', volume: 9e9 }),
    coin({ mint: USDC, symbol: 'USDC', name: 'USDC', volume: 8e9 }),
    coin({ mint: SOL, symbol: 'WSOL', name: 'Wrapped SOL', price: 212.5, volume: 5e8 }),
    coin({ mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', volume: 7e8 }),
    coin({ mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', category: 'meme', volume: 9e8 }),
    coin({ mint: 'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA', symbol: 'USDS', volume: 6e8 }),
    coin({ mint: 'Eur0000000000000000000000000000000000000001', symbol: 'EURC', volume: 6e8 }),
    coin({ mint: 'Fake000000000000000000000000000000000000001', symbol: 'FAKE', verified: false, volume: 6e9 }),
    coin({ mint: 'Flag000000000000000000000000000000000000001', symbol: 'FLAG', suspicious: true, volume: 6e9 }),
    coin({ mint: 'Zero000000000000000000000000000000000000001', symbol: 'ZERO', price: null, volume: 6e9 }),
  ]
  const shelf = coinShelf(rows)
  assert.deepEqual(
    shelf.dollars.map((c) => `${c.symbol}:${c.name}`),
    ['USDC:USD Coin', 'USDT:Tether USD'],
  )
  assert.deepEqual(
    shelf.crypto.map((c) => `${c.symbol}:${c.name}`),
    ['JUP:JUP', 'SOL:Solana'],
  )
  assert.deepEqual(DOLLAR_MINTS, [USDC, USDT])
  assert.deepEqual(
    coinShelf(rows.filter((row) => row.mint !== USDC)).dollars.map((c) => c.symbol),
    ['USDT'],
  )
  assert.equal(coinName({ mint: SOL, name: 'Wrapped SOL' }), 'Solana')
  assert.deepEqual(
    matchCoins(shelf.crypto, 'sol').map((c) => c.symbol),
    ['SOL'],
  )
})

test('the device keeps a shelf it can read back, and refuses anything else', () => {
  const shelf = companyShelf({
    rows: [
      stock({ symbol: 'AAPLx', underlying: 'AAPL', name: 'Apple Inc.' }),
      stock({ symbol: 'OPENAI', issuer: 'prestocks', underlying: 'OPENAI', klass: 'pre-ipo', premium: -4.14 }),
    ],
    fetchedAt: '2026-09-23T17:40:04.764Z',
  })
  assert.deepEqual(parseShelf(serializeShelf(shelf)), shelf)
  assert.equal(parseShelf(null), null)
  assert.equal(parseShelf('not json'), null)
  assert.equal(parseShelf(JSON.stringify({ ...shelf, fetchedAt: 'yesterday' })), null)
  assert.equal(parseShelf(JSON.stringify({ ...shelf, companies: [{ name: 'x' }] })), null)
})

test('a shelf kept before today’s rule reads by it: no other issuer’s private company, no premium invented', () => {
  const card = (issuer, ticker, extra = {}) => ({
    name: ticker,
    ticker,
    mint: `Mint${ticker}`,
    icon: null,
    price: 10,
    change24h: null,
    volume24h: 1,
    issuer,
    ...extra,
  })
  const kept = parseShelf(
    JSON.stringify({
      companies: [card('xstocks', 'AAPLx'), card('ondo', 'AAPLon')],
      privateCompanies: [card('prestocks', 'OPENAI'), card('another-issuer', 'xOPENAI')],
      fetchedAt: '2026-09-23T17:40:04.764Z',
    }),
  )
  assert.deepEqual(
    kept.companies.map((c) => c.ticker),
    ['AAPLx'],
  )
  assert.deepEqual(
    kept.privateCompanies.map((c) => `${c.ticker}:${c.premiumPct}`),
    ['OPENAI:null'],
  )
})

test('the shelf keeps the issuers’ windows the universe states — SPACEX’s swap into SPCXx — and the device reads them back whole', () => {
  const SPACEX = 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh'
  const SPCXX = 'Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8'
  const swap = {
    from: { mint: SPACEX, symbol: 'SPACEX' },
    into: { mint: SPCXX, symbol: 'SPCXx' },
    deadline: '2027-03-12T23:59:00.000Z',
    open: true,
  }
  const path = { at: 'private', steps: [{ step: 'ipo', state: 'passed', date: '2026-06-12' }], swap }
  const spacex = stock({
    symbol: 'SPACEX',
    issuer: 'prestocks',
    underlying: 'SPACEX',
    name: 'SpaceX',
    klass: 'pre-ipo',
  })
  const listed = stock({ symbol: 'SPCXx', underlying: 'SPCX', name: 'SpaceX' })
  const rows = [
    {
      ...spacex,
      representation: { ...spacex.representation, mint: SPACEX },
      lifecycle: {
        state: 'conversion-open',
        tradable: true,
        url: 'https://www.prestocks.com/spacex',
        deadline: swap.deadline,
      },
      companyPath: path,
    },
    { ...listed, representation: { ...listed.representation, mint: SPCXX }, companyPath: { ...path, at: 'solana' } },
    stock({ symbol: 'OPENAI', issuer: 'prestocks', underlying: 'OPENAI', klass: 'pre-ipo' }),
  ]
  const shelf = companyShelf({ rows, fetchedAt: '2026-09-26T08:50:00.000Z' })
  assert.deepEqual(shelf.events, [
    {
      mint: SPACEX,
      symbol: 'SPACEX',
      company: 'SpaceX',
      cause: 'ipo',
      into: { mint: SPCXX, symbol: 'SPCXx', company: 'SpaceX' },
      deadline: swap.deadline,
      open: true,
      noticeUrl: 'https://www.prestocks.com/spacex',
    },
  ])
  // SPACEX is still offered while its window is open: its card stays on the private shelf.
  assert.ok(shelf.privateCompanies.some((card) => card.mint === SPACEX))
  assert.deepEqual(parseShelf(serializeShelf(shelf)), shelf)
  const broken = JSON.parse(serializeShelf(shelf))
  broken.events.push({ ...broken.events[0], deadline: 'later' })
  assert.equal(parseShelf(JSON.stringify(broken)).events.length, 1)
  delete broken.events
  assert.deepEqual(parseShelf(JSON.stringify(broken)).events, [], 'a copy kept before the watch knew none')
})
