import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isContractAddress,
  isDepositToken,
  marketScreenerRow,
  marketsPath,
  rowsForTab,
  SCREENER_TABS,
  screenerTabOf,
  sortRows,
  sortsFor,
  stockScreenerRow,
  tokenDestination,
  uniqueRows,
} from './screener.ts'

const SOL = 'So11111111111111111111111111111111111111112'
const NVDA = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'

const coin = (over) => ({
  mint: SOL,
  symbol: 'SOL',
  name: 'Wrapped SOL',
  icon: null,
  decimals: 9,
  price: 150,
  change24hPct: 1.5,
  volume24hUsd: 1_000_000,
  liquidityUsd: 5_000_000,
  verified: true,
  suspicious: false,
  category: 'crypto',
  issuer: null,
  ...over,
})

const stock = (over) => ({
  mint: NVDA,
  symbol: 'NVDAx',
  name: 'NVIDIA',
  issuer: 'xstocks',
  kind: 'listed-equity',
  tradable: true,
  markPremium: null,
  icon: null,
  halted: false,
  price: 239.27,
  change24h: -0.1,
  reference: 239.37,
  referenceState: 'current',
  referenceAt: null,
  deviation: -0.04,
  period: 'extended',
  volume: 30_917_870,
  liquidity: 4_701_775,
  ...over,
})

test('the web’s six tabs in the web’s order: Усі · Меми · Крипта · Акції · Приватні · Обране', () => {
  assert.deepEqual(SCREENER_TABS, ['all', 'memes', 'crypto', 'stocks', 'private', 'watchlist'])
})

test('an old link opens the tab it pointed at: the web’s stock screener and Trends, the phone’s own lists', () => {
  assert.equal(screenerTabOf({}), 'all')
  assert.equal(screenerTabOf({ tab: 'memes' }), 'memes')
  assert.equal(screenerTabOf({ tab: 'stocks', kind: 'preipo' }), 'private')
  assert.equal(screenerTabOf({ kind: 'preipo' }), 'private')
  assert.equal(screenerTabOf({ kind: 'listed' }), 'stocks')
  assert.equal(screenerTabOf({ mode: 'meme' }), 'memes')
  assert.equal(screenerTabOf({ tab: 'stock' }), 'stocks')
  assert.equal(screenerTabOf({ tab: 'meme' }), 'memes')
  assert.equal(screenerTabOf({ tab: 'companies' }), 'stocks')
  assert.equal(screenerTabOf({ tab: 'dollars' }), 'crypto')
  assert.equal(screenerTabOf({ tab: ['watchlist'] }), 'watchlist')
  assert.equal(screenerTabOf({ tab: 'nothing' }), 'all')
  assert.equal(marketsPath(), '/(tabs)/markets')
  assert.equal(marketsPath('private'), '/(tabs)/markets?tab=private')
})

test('a coin is a row by the venue’s own category; a deposit receipt and an unclassified token are not', () => {
  const row = marketScreenerRow(coin())
  assert.equal(row.kind, 'crypto')
  assert.equal(row.price, 150)
  assert.equal(row.issuer, null)
  assert.equal(marketScreenerRow(coin({ category: 'meme' })).kind, 'meme')
  assert.equal(marketScreenerRow(coin({ category: null })), null)
  assert.equal(marketScreenerRow(coin({ name: 'Jupiter Lend USDC', symbol: 'jlUSDC' })), null)
  assert.ok(isDepositToken({ name: 'jupiter lend SOL' }))
  assert.equal(isDepositToken({ name: 'Jupiter' }), false)
  // A stock the venue lists is a row only where any kind may stand — the watchlist.
  assert.equal(marketScreenerRow(coin({ category: 'stock', issuer: { label: 'xStocks', tag: 'xstocks' } })), null)
  assert.equal(
    marketScreenerRow(coin({ category: 'stock', issuer: { label: 'xStocks', tag: 'xstocks' } }), { stocks: true })
      .issuer,
    'xstocks',
  )
})

test('an unknown figure stays null — a dash on the screen, never a zero', () => {
  const row = marketScreenerRow(coin({ price: null, change24hPct: Number.NaN, volume24hUsd: undefined }))
  assert.equal(row.price, null)
  assert.equal(row.change24h, null)
  assert.equal(row.volume24h, null)
})

test('a stock carries the issuer, the session and the deviation; a private company «Це не акція» and its premium, never a deviation', () => {
  const listed = stockScreenerRow(stock())
  assert.equal(listed.kind, 'stock')
  assert.equal(listed.period, 'extended')
  assert.equal(listed.deviation, -0.04)
  assert.equal(listed.markPremium, null)
  const privateRow = stockScreenerRow(
    stock({
      kind: 'pre-ipo',
      issuer: 'prestocks',
      symbol: 'ANTHROPIC',
      period: 'unknown',
      deviation: 3,
      markPremium: 2.23,
    }),
  )
  assert.equal(privateRow.kind, 'private')
  assert.equal(privateRow.deviation, null)
  assert.equal(privateRow.period, null)
  assert.equal(privateRow.markPremium, 2.23)
  // An unknown session is no session; a token the issuer no longer offers says so.
  assert.equal(stockScreenerRow(stock({ period: 'unknown' })).period, null)
  assert.equal(stockScreenerRow(stock({ tradable: false })).tradable, false)
  assert.equal(stockScreenerRow(stock({ tradable: undefined })).tradable, true)
})

test('each tab holds its own kind; one row per mint across the reads', () => {
  const rows = uniqueRows(
    [marketScreenerRow(coin()), marketScreenerRow(coin({ mint: 'M1', category: 'meme' }))],
    [marketScreenerRow(coin({ mint: 'M1', category: 'meme' }))],
    [stockScreenerRow(stock()), stockScreenerRow(stock({ mint: 'P1', kind: 'pre-ipo', issuer: 'prestocks' }))],
  )
  assert.equal(rows.length, 4)
  assert.deepEqual(
    rowsForTab(rows, 'all').map((row) => row.kind),
    ['crypto', 'meme', 'stock', 'private'],
  )
  assert.deepEqual(
    rowsForTab(rows, 'memes').map((row) => row.mint),
    ['M1'],
  )
  assert.deepEqual(
    rowsForTab(rows, 'crypto').map((row) => row.mint),
    [SOL],
  )
  assert.deepEqual(
    rowsForTab(rows, 'stocks').map((row) => row.mint),
    [NVDA],
  )
  assert.deepEqual(
    rowsForTab(rows, 'private').map((row) => row.mint),
    ['P1'],
  )
})

test('the order is the person’s: У тренді, Зростають, Падають, Ліквідність; «До біржі» only on stocks; unknown last', () => {
  const rows = [
    marketScreenerRow(coin({ mint: 'A', volume24hUsd: 10, change24hPct: 5, liquidityUsd: 1 })),
    marketScreenerRow(coin({ mint: 'B', volume24hUsd: 30, change24hPct: -8, liquidityUsd: 3 })),
    marketScreenerRow(coin({ mint: 'C', volume24hUsd: null, change24hPct: null, liquidityUsd: null })),
    marketScreenerRow(coin({ mint: 'D', volume24hUsd: 20, change24hPct: 1, liquidityUsd: 2 })),
  ]
  const order = (sort) => sortRows(rows, sort).map((row) => row.mint)
  assert.deepEqual(order('volume'), ['B', 'D', 'A', 'C'])
  assert.deepEqual(order('rise'), ['A', 'D', 'B', 'C'])
  assert.deepEqual(order('fall'), ['B', 'D', 'A', 'C'])
  assert.deepEqual(order('liquidity'), ['B', 'D', 'A', 'C'])
  const stocks = [
    stockScreenerRow(stock({ mint: 'S1', deviation: 0.5 })),
    stockScreenerRow(stock({ mint: 'S2', deviation: -2 })),
    stockScreenerRow(stock({ mint: 'S3', deviation: null })),
  ]
  assert.deepEqual(
    sortRows(stocks, 'deviation').map((row) => row.mint),
    ['S2', 'S1', 'S3'],
  )
  assert.deepEqual(sortsFor('stocks'), ['volume', 'rise', 'fall', 'liquidity', 'deviation'])
  for (const tab of SCREENER_TABS.filter((tab) => tab !== 'stocks'))
    assert.equal(sortsFor(tab).includes('deviation'), false, tab)
  // Sorting never changes the list it was handed.
  assert.deepEqual(
    rows.map((row) => row.mint),
    ['A', 'B', 'C', 'D'],
  )
})

test('a pasted contract address is an address; anything else is a word to search', () => {
  assert.ok(isContractAddress(SOL))
  assert.ok(isContractAddress(`  ${NVDA}\n`))
  assert.equal(isContractAddress('SOL'), false)
  assert.equal(isContractAddress('0x1234567890abcdef1234567890abcdef12345678'), false)
  assert.equal(isContractAddress(`${SOL} more`), false)
  assert.equal(isContractAddress('O0Il'.repeat(10)), false)
})

test('an address finds its page in the web’s order: a stock’s page, then a launch’s, else the token’s own', () => {
  assert.deepEqual(tokenDestination(NVDA, { stockSymbol: 'NVDAx', launched: false }), {
    pathname: '/asset/[mint]',
    params: { mint: NVDA, symbol: 'NVDAx' },
  })
  assert.deepEqual(tokenDestination(SOL, { stockSymbol: null, launched: true }), {
    pathname: '/launch/[mint]',
    params: { mint: SOL },
  })
  assert.deepEqual(tokenDestination(SOL, { stockSymbol: null, launched: false }), {
    pathname: '/asset/[mint]',
    params: { mint: SOL },
  })
  // A stock wins over a launch record, as on the web.
  assert.equal(tokenDestination(NVDA, { stockSymbol: 'NVDAx', launched: true }).pathname, '/asset/[mint]')
})
