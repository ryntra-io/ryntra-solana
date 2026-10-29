import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readFileSync } from 'node:fs'

import { PLACE_HOME_COPY } from '../home/place-copy.ts'
import { PREDICTIONS_LIVE } from '../shell/places.ts'
import { segmentOf, tradeSegmentAsked, tradeSegments } from '../shell/trade-place.ts'
import { BLOCKED_STEMS, BLOCKED_WORDS } from '../../lib/blocked-names.ts'
import { MARKETS_COPY } from './copy.ts'
import {
  askedPlaceChip,
  askedScreenerTab,
  isContractAddress,
  isDepositToken,
  marketScreenerRow,
  kindsOfChip,
  marketsPath,
  openingChip,
  PLACE_CHIPS,
  PLACE_DEFAULT,
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
  // Asked for nothing it knows — the place opens as the person left it.
  assert.equal(askedScreenerTab({ tab: 'nothing' }), null)
  assert.equal(askedScreenerTab({ seg: 'swap' }), null)
  assert.equal(askedScreenerTab({}), null)
  assert.equal(askedScreenerTab({ tab: 'all' }), 'all')
  assert.equal(marketsPath(), '/(tabs)/markets')
  // A door that says «all markets» opens «Усі»; any other names its tab.
  assert.equal(marketsPath('all'), '/(tabs)/markets?tab=all')
  assert.equal(marketsPath('private'), '/(tabs)/markets?tab=private')
})

const code = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

test('«Ринки» opens on «Усі»; a chip an address asks for wins, then the one the person chose last', () => {
  assert.equal(PLACE_DEFAULT, 'all')
  assert.equal(PLACE_CHIPS[0], 'all')
  assert.equal(PLACE_CHIPS.at(-1), 'watchlist')
  assert.equal(openingChip(null, null), 'all')
  assert.equal(openingChip(null, 'memes'), 'memes')
  assert.equal(openingChip(null, 'watchlist'), 'watchlist')
  assert.equal(openingChip('watchlist', 'stocks'), 'watchlist')
  assert.equal(openingChip('all', 'watchlist'), 'all')
  const screen = code('screens/markets/index.tsx')
  // No first visit falls back on the favourites: the opening chip is «Усі», a choice is remembered under the new key.
  assert.match(
    screen,
    /openingChip\(\s*asked,\s*readPreferenceText\(CHIP_KEY\) === null \? null : readPreference\(CHIP_KEY, PLACE_CHIPS, PLACE_DEFAULT\)/,
  )
  assert.match(screen, /const CHIP_KEY = 'markets\.place\.chip\.v2'/)
  assert.match(screen, /writePreference\(CHIP_KEY, next\)/)
  assert.doesNotMatch(screen, /watchlist\.mints\.length > 0 \? 'watchlist'/)
  // An ask is spent once read, so Home's «Обране» switches the chip again the next time; it is never remembered.
  assert.match(screen, /if \(asked\) router\.setParams\(\{ tab: undefined, kind: undefined, mode: undefined \}\)/)
})

test('every older link lands on the chip that holds what it named', () => {
  const chip = (params) => askedPlaceChip(params)
  assert.equal(chip({ tab: 'watchlist' }), 'watchlist')
  assert.equal(chip({ tab: ['watchlist'] }), 'watchlist')
  assert.equal(chip({ tab: 'all' }), 'all')
  assert.equal(chip({ tab: 'crypto' }), 'crypto')
  assert.equal(chip({ tab: 'dollars' }), 'crypto')
  assert.equal(chip({ tab: 'memes' }), 'memes')
  assert.equal(chip({ tab: 'meme' }), 'memes')
  assert.equal(chip({ mode: 'meme' }), 'memes')
  assert.equal(chip({ tab: 'stocks' }), 'stocks')
  assert.equal(chip({ tab: 'stock' }), 'stocks')
  assert.equal(chip({ tab: 'companies' }), 'stocks')
  assert.equal(chip({ tab: 'private' }), 'stocks')
  assert.equal(chip({ kind: 'preipo' }), 'stocks')
  assert.equal(chip({ kind: 'listed' }), 'stocks')
  assert.equal(chip({ mode: 'stocks' }), 'stocks')
  assert.equal(chip({ tab: 'nothing' }), null)
  assert.equal(chip({ seg: 'swap' }), null)
  assert.equal(chip({}), null)
  // What every chip it lands on lists holds what the link named.
  for (const tab of SCREENER_TABS.filter((tab) => tab !== 'watchlist')) {
    const rows = rowsForTab(
      [
        marketScreenerRow(coin()),
        marketScreenerRow(coin({ mint: 'M1', category: 'meme' })),
        stockScreenerRow(stock()),
        stockScreenerRow(stock({ mint: 'P1', kind: 'pre-ipo', issuer: 'prestocks' })),
      ],
      tab,
    )
    const kinds = kindsOfChip(askedPlaceChip({ tab }))
    for (const row of rows) assert.ok(kinds.includes(row.kind), `${tab} → ${row.kind}`)
  }
})

test('«Торгівля» on a segment: `?seg=` names it; a chip of Ринки asked opens Ринки even when the place was on Обмін', () => {
  assert.equal(tradeSegmentAsked({ seg: 'swap' }), 'swap')
  assert.equal(tradeSegmentAsked({ seg: 'markets' }), 'markets')
  assert.equal(tradeSegmentAsked({ tab: 'watchlist' }), 'markets')
  assert.equal(tradeSegmentAsked({ tab: 'stock' }), 'markets')
  assert.equal(tradeSegmentAsked({ kind: 'preipo' }), 'markets')
  assert.equal(tradeSegmentAsked({ mode: 'meme' }), 'markets')
  // `?seg=futures` opens Ф'ючерси (C4), the segment named winning over a chip; nothing asked keeps the one left.
  assert.equal(segmentOf('futures'), 'futures')
  assert.equal(tradeSegmentAsked({ seg: 'futures', tab: 'memes' }), 'futures')
  assert.equal(tradeSegmentAsked({ seg: 'futures' }), 'futures')
  assert.equal(tradeSegmentAsked({ seg: 'perps' }), null)
  // `?seg=predictions` opens Прогнози (M12), a section of Ryntra on Solana — in a build that shows them; 1.17.0 does
  // not (the second release), so the ask names no segment: the place keeps the one left, a chip asked with it opens Ринки.
  assert.equal(segmentOf('predictions', tradeSegments(true)), 'predictions')
  assert.equal(segmentOf('predictions', tradeSegments(false)), null)
  assert.equal(tradeSegmentAsked({ seg: 'predictions' }), PREDICTIONS_LIVE ? 'predictions' : null)
  assert.equal(tradeSegmentAsked({ seg: 'predictions', tab: 'memes' }), PREDICTIONS_LIVE ? 'predictions' : 'markets')
  assert.equal(tradeSegmentAsked({ tab: 'nothing' }), null)
  assert.equal(tradeSegmentAsked({}), null)
  const place = code('screens/trade-place/index.tsx')
  assert.match(place, /const asked = tradeSegmentAsked\(params\)/)
  // The place spends `seg`; on any segment but Ринки a chip asked with it is spent too, never pulling the place to Ринки.
  assert.match(
    place,
    /if \(segAsked && segAsked !== 'markets'\)\s*router\.setParams\(\{ seg: undefined, tab: undefined, kind: undefined, mode: undefined \}\)\s*else if \(segAsked\) router\.setParams\(\{ seg: undefined \}\)/,
  )
})

test('«Крипто» lists the coins without the memes; «Меми» the memes; «Усі» every kind, a meme marked «Мем»', () => {
  const screen = code('screens/markets/index.tsx')
  assert.match(screen, /const crypto = useMarkets\('crypto', wantsCrypto\)/)
  assert.match(screen, /const memes = useMarkets\('meme', wantsMemes\)/)
  assert.match(screen, /const stocks = useStockUniverse\(wantsStocks\)/)
  assert.match(screen, /rows: rows\.filter\(\(row\) => kinds\.includes\(row\.kind\)\)/)
  // The meme's risk under «Меми» only; where kinds are mixed («Усі», «Обране») a meme's row says «Мем».
  assert.match(screen, /const line = tab === 'memes' \? words\.memesRisk : null/)
  // What a tokenized stock is sits behind «?» in the head under «Акції» — never a line on the list (ST-4).
  assert.match(
    screen,
    /\{tab === 'stocks' \? <HelpDot title=\{sheet\.stocksTitle\} body=\{sheet\.stocksNote\} \/> : null\}/,
  )
  assert.match(screen, /rowOf\(row, locale, words, tab === 'all' \|\| tab === 'watchlist', sharedPeriod\)/)
  // One session for every stock is said once in the head, not on each row (ST-4).
  assert.match(screen, /row\.period && row\.period !== sharedPeriod/)
  assert.match(screen, /if \(mixed && row\.kind === 'meme'\) notes\.push\(words\.memeMark\)/)
  assert.equal(MARKETS_COPY.uk.memeMark, 'Мем')
  assert.equal(MARKETS_COPY.en.memeMark, 'Meme')
  // A read of «Усі» that did not answer is named — the crypto, the memes (both lost: one notice) or the stocks.
  assert.match(
    screen,
    /cryptoFailed && memesFailed\s*\? words\.coinsDown\s*: cryptoFailed\s*\? words\.cryptoDown\s*: memesFailed\s*\? words\.memesDown\s*: null,\s*stocksFailed \? words\.stocksDown : null/,
  )
  assert.equal(MARKETS_COPY.uk.cryptoDown, 'Крипто зараз не відповідає.')
  assert.equal(MARKETS_COPY.uk.coinsDown, 'Крипто й меми зараз не відповідають.')
  // No list draws «Ціни (монет) не оновлюються» — its prices stand and are read again quietly (ST-7).
  assert.doesNotMatch(screen, /list\.stale|words\.stale|words\.coinsStale|words\.refreshFailed|words\.partial/)
  // An empty «Обране» has nothing to order.
  assert.match(screen, /\{tab === 'launches' \|\| emptyWatchlist \? null : \(/)
  // A row opens the token's own page — a company's with its sheets, a coin's with Купити · Продати · Ліміт.
  assert.match(screen, /pathname: '\/asset\/\[mint\]'/)
  assert.match(code('screens/launch/markets.tsx'), /router\.push\(`\/launch\/\$\{row\.token\}`/)
})

test('Home’s «Обране» door says where it goes — «Усе обране» → «Ринки · Обране» — and is not drawn over an empty list', () => {
  const blocks = code('screens/home/place-blocks.tsx')
  assert.match(blocks, /const openAll = \(\) => router\.navigate\(marketsPath\('watchlist'\) as never\)/)
  assert.match(
    blocks,
    /action=\{watchlist\.mints\.length > 0 \? \{ label: words\.allFavourites, onPress: openAll \} : undefined\}/,
  )
  // An empty «Обране» leads to every market, as does «Що купити»'s «Усі ринки».
  assert.match(blocks, /onPress=\{\(\) => router\.navigate\(marketsPath\('all'\) as never\)\}/)
  assert.match(code('screens/home/buy-pick-sheet.tsx'), /openPlace\(marketsPath\('all'\)\)/)
  assert.equal(PLACE_HOME_COPY.uk.allFavourites, 'Усе обране')
  assert.equal(PLACE_HOME_COPY.en.allFavourites, 'All favourites')
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
  // The company as a person knows it, without the issuer's legal form — the row's line is never cut.
  assert.equal(
    stockScreenerRow(stock({ name: 'Trump Media & Technology Group Corp. Common Stock' })).name,
    'Trump Media & Technology Group',
  )
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

test('a coin whose symbol or name carries a blocked word is not a row of Markets', () => {
  assert.equal(marketScreenerRow(coin({ category: 'meme', symbol: BLOCKED_STEMS[0].toUpperCase() })), null)
  assert.equal(marketScreenerRow(coin({ category: 'meme', name: `Baby ${BLOCKED_WORDS[0]}` })), null)
  assert.notEqual(marketScreenerRow(coin({ category: 'meme', symbol: 'SPICY', name: 'Spicy Raccoon' })), null)
})

test('a stock row carries whether its pool price stands far from the share; a venue row never claims it (ST-5 r8)', () => {
  assert.equal(stockScreenerRow(stock({ reference: 100.59, deviation: 1978.2 })).poolFar, true)
  assert.equal(stockScreenerRow(stock({ reference: null, deviation: 1978.2 })).poolFar, false)
  assert.equal(stockScreenerRow(stock({ deviation: -0.04 })).poolFar, false)
  assert.equal(marketScreenerRow(coin()).poolFar, false)
})
