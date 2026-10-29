import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { BRIDGE_VERSION, parseAppMessage, PRO_TIMEFRAMES } from '../pro-chart/bridge.ts'
import { bookPick, chartIdOf, chartReadOf, openInterestUsd, plainPrice, viewOnlyReason } from './futures-chart.ts'
import { FUTURES_COPY, orderTypeWord, sessionWord } from './futures-copy.ts'
import {
  accountOn,
  bookView,
  dayChangePct,
  hasAccount,
  isFuturesSymbol,
  marketOf,
  sizeDecimals,
  parseAccount,
  parseBook,
  parseCandles,
  parseMarkets,
} from './futures-model.ts'

const code = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

/* The route's own answers, as production served them on 2026-10-20 (`/api/solana/futures/*`, B7). */
const MARKETS = {
  markets: [
    {
      symbol: 'SOL',
      status: 'active',
      calendar: false,
      session: null,
      maxLeverage: 25,
      isolatedOnly: false,
      tickSize: 100,
      baseLotsDecimals: 2,
      markPrice: 108.15,
      oraclePrice: 108.06,
      prevDayMarkPrice: 104.16,
      dayVolumeUsd: 12854369.45,
    },
    {
      symbol: 'ANTHROPIC',
      status: 'active',
      calendar: true,
      session: 'afterHours',
      maxLeverage: 6,
      isolatedOnly: true,
      markPrice: 1963.8,
      oraclePrice: 1961.7,
      prevDayMarkPrice: 1960.7,
      dayVolumeUsd: 1161396.71,
    },
    {
      symbol: 'kBONK',
      status: 'gated',
      calendar: false,
      session: null,
      maxLeverage: null,
      isolatedOnly: false,
      markPrice: null,
      oraclePrice: 'x',
      prevDayMarkPrice: 0,
      dayVolumeUsd: -1,
    },
    { symbol: '../etc', status: 'active' },
    { symbol: 'sol', status: 'active' },
  ],
  observedAt: 1792505711575,
}

test('the markets are read again, not trusted: an unknown figure is null, never zero; a bad or repeated symbol is dropped', () => {
  const { markets, observedAt } = parseMarkets(MARKETS, 1)
  assert.equal(observedAt, 1792505711575)
  assert.deepEqual(
    markets.map((market) => market.symbol),
    ['SOL', 'ANTHROPIC', 'kBONK'],
  )
  const bonk = markets[2]
  assert.equal(bonk.status, 'gated')
  assert.equal(bonk.markPrice, null)
  assert.equal(bonk.oraclePrice, null)
  assert.equal(bonk.prevDayMarkPrice, null)
  assert.equal(bonk.dayVolumeUsd, null)
  assert.equal(markets[1].session, 'afterHours')
  assert.equal(markets[0].session, null)
  // A body that is not the route's: an empty list at the time it arrived.
  assert.deepEqual(parseMarkets('<html>', 42), { markets: [], observedAt: 42 })
  assert.equal(isFuturesSymbol('SOL'), true)
  assert.equal(isFuturesSymbol('SOL/USD'), false)
  assert.equal(marketOf(markets, 'kbonk')?.symbol, 'kBONK')
  assert.equal(marketOf(markets, 'ETH'), null)
})

test('the day’s move is the mark against a day ago, in percent; unknown without both', () => {
  const [sol] = parseMarkets(MARKETS).markets
  assert.ok(Math.abs(dayChangePct(sol) - (108.15 / 104.16 - 1) * 100) < 1e-9)
  assert.equal(dayChangePct({ markPrice: 1, prevDayMarkPrice: null }), null)
})

test('the book: asks over bids, the two best meeting at the spread; each level’s share of the deepest shown', () => {
  const book = parseBook(
    {
      bids: [
        { price: 108.2, size: 10 },
        { price: 108.21, size: 5 },
        { price: 'x', size: 1 },
      ],
      asks: [
        { price: 108.3, size: 20 },
        { price: 108.25, size: 2 },
      ],
      observedAt: 7,
    },
    'SOL',
  )
  assert.deepEqual(
    book.bids.map((level) => level.price),
    [108.21, 108.2],
  )
  assert.deepEqual(
    book.asks.map((level) => level.price),
    [108.25, 108.3],
  )
  const view = bookView(book)
  assert.deepEqual(
    view.asks.map((level) => level.price),
    [108.3, 108.25],
  )
  assert.deepEqual(
    view.bids.map((level) => level.price),
    [108.21, 108.2],
  )
  assert.equal(view.asks[0].share, 1)
  assert.equal(view.bids[1].share, 0.5)
  assert.ok(Math.abs(view.spread.usd - 0.04) < 1e-9)
  assert.ok(view.spread.pct > 0 && view.spread.pct < 0.05)
  assert.equal(bookView(parseBook({ bids: [], asks: [] }, 'SOL')).spread, null)
  // Eight a side at most.
  const deep = parseBook({ bids: Array.from({ length: 20 }, (_, i) => ({ price: 100 - i, size: 1 })), asks: [] }, 'SOL')
  assert.equal(bookView(deep).bids.length, 8)
  // A column of sizes keeps one count of decimals: «1 733,10» under «6 410,22», never «1 733,1».
  assert.equal(sizeDecimals([6410.22, 1733.1, 95]), 2)
  assert.equal(sizeDecimals([0.00012345, 1]), 4)
  assert.equal(sizeDecimals([3, 40]), 0)
})

test('the bars: seconds, oldest first, one per open, a broken print righted', () => {
  const { candles } = parseCandles(
    {
      timeframe: '1h',
      last: [
        { t: 7200000, o: 2, h: 1, l: 3, c: 2.5, v: 9, final: true },
        { t: 3600000, o: 1, h: 2, l: 0.5, c: 1.5, v: null },
        { t: 3600000, o: 1, h: 2, l: 0.5, c: 1.6 },
        { t: 'x', o: 1, h: 1, l: 1, c: 1 },
      ],
      mark: [{ t: 1, o: 9, h: 9, l: 9, c: 9 }],
    },
    'SOL',
  )
  assert.deepEqual(candles, [
    { time: 3600, open: 1, high: 2, low: 0.5, close: 1.6 },
    { time: 7200, open: 2, high: 3, low: 1, close: 2.5, volume: 9 },
  ])
})

test('the account by address: positions and orders per market; a wallet Phoenix never saw has none', () => {
  const account = parseAccount(
    {
      state: 'active',
      collateralUsd: 120.5,
      collateralSol: 0,
      positions: [
        { symbol: 'SOL', subaccount: 0, side: 'long', size: 1.5, entryPrice: 100 },
        { symbol: 'BTC', side: 'sideways', size: 1 },
      ],
      orders: [
        {
          id: 'o1',
          symbol: 'sol',
          side: 'sell',
          type: 'limit',
          price: 120,
          size: 1,
          reduceOnly: true,
          stop: false,
          status: 'open',
        },
      ],
    },
    'W',
  )
  assert.equal(account.state, 'active')
  assert.equal(account.positions.length, 1)
  assert.deepEqual(
    accountOn(account, 'SOL').orders.map((order) => order.id),
    ['o1'],
  )
  assert.equal(accountOn(account, 'BTC').positions.length, 0)
  assert.equal(hasAccount(account), true)
  assert.equal(hasAccount(parseAccount({ state: 'none' }, 'W')), false)
  assert.equal(parseAccount({ state: 'hacked' }, 'W').state, 'unknown')
  assert.equal(parseAccount({ collateralUsd: '5' }, 'W').collateralUsd, null)
  // `cold` holds collateral as often as not: never «Без застави» beside «Застава USDC $30 211».
  assert.equal(FUTURES_COPY.uk.states.cold, 'Неактивний')
  assert.equal(FUTURES_COPY.en.states.cold, 'Inactive')
})

test('Phoenix’s words in the person’s language — a session or type the phone does not know is never English in Ukrainian', () => {
  const uk = FUTURES_COPY.uk
  assert.equal(sessionWord('afterHours', uk), 'Поза сесією')
  assert.equal(sessionWord('active', uk), 'Сесія відкрита')
  // Beside the label «Сесія» the state alone, never «Сесія — Сесія відкрита».
  assert.equal(sessionWord('active', uk, true), 'Відкрита')
  assert.equal(sessionWord('weekend-maintenance', uk), null)
  assert.equal(orderTypeWord('post_only', uk), 'Лише мейкер')
  assert.equal(orderTypeWord('twap', uk), 'Ордер')
  const said = (value) =>
    typeof value === 'function'
      ? [said(value('bid', '1', '1')), said(value('ask', '1', '1'))]
      : typeof value === 'object'
        ? Object.values(value).map(said)
        : [value]
  const words = said(uk).flat(Infinity).join(' ')
  assert.doesNotMatch(words, /\b(?:the|and|order|price|chart|book|view|long|short|size|entry)\b/i)
})

test('view only, as the web’s page: the futures screens build, sign and send nothing — no order, no wallet signature', () => {
  for (const path of [
    'screens/futures/index.tsx',
    'screens/futures/market.tsx',
    'screens/futures/account-card.tsx',
    'features/futures/use-futures.ts',
  ]) {
    const source = code(path)
    assert.doesNotMatch(source, /signTransaction|signAndSend|transact\(|POST|Review|placeOrder|\/submit/, path)
  }
  // Only the four public reads of B7.
  const reads = code('features/futures/use-futures.ts').match(/\/api\/[a-z/]+/g) ?? []
  assert.deepEqual([...new Set(reads)], ['/api/solana/futures/', '/api/solana/futures/markets'])
  // «Торгівля» draws the segment; a market opens its own page.
  assert.match(code('screens/trade-place/index.tsx'), /segment === 'futures' \?\s*\(\s*<FuturesScreen \/>/)

  // «View only» on the list for this wallet's own reason, as the market's page says it: no Phoenix account, or the
  // gate's read word that orders are closed — never while the gate is unread.
  const list = code('screens/futures/index.tsx')
  assert.match(list, /const gate = useOrderGate\(wallet\.address\)/)
  assert.match(list, /gate\.read && !gate\.states\.open/)
  assert.match(list, /reason \? words\.viewOnly : null/)
  assert.match(list, /<HelpDot title=\{words\.helpTitle\} body=\{help\} \/>/)
})

/* C4c — a Phoenix market's page at the web's level: the head, the core's chart, the book into the ticket. */

test('a market’s leverage tiers, maintenance share and open interest are read again: a bad tier is dropped, unknown is null', () => {
  const [sol, bonk] = parseMarkets({
    markets: [
      {
        symbol: 'SOL',
        status: 'active',
        maxLeverage: 25,
        leverageTiers: [
          { maxLeverage: 25, maxSizeUnits: 5000 },
          { maxLeverage: 'x', maxSizeUnits: 1 },
          { maxLeverage: 10, maxSizeUnits: null },
          'tier',
        ],
        maintenanceRatio: 0.5,
        openInterestUnits: 123456.78,
        markPrice: 180,
      },
      { symbol: 'kBONK', status: 'active', leverageTiers: 'none', maintenanceRatio: -1, openInterestUnits: -5 },
    ],
  }).markets
  assert.deepEqual(sol.leverageTiers, [
    { maxLeverage: 25, maxSizeUnits: 5000 },
    { maxLeverage: 10, maxSizeUnits: null },
  ])
  assert.equal(sol.maintenanceRatio, 0.5)
  assert.equal(sol.openInterestUnits, 123456.78)
  assert.deepEqual(bonk.leverageTiers, [])
  assert.equal(bonk.maintenanceRatio, null)
  assert.equal(bonk.openInterestUnits, null)
  // An open interest of none is a zero Phoenix said, not an unknown.
  assert.equal(parseMarkets({ markets: [{ symbol: 'ETH', openInterestUnits: 0 }] }).markets[0].openInterestUnits, 0)
})

test('the open interest in dollars is the asset’s at the mark; unknown without either', () => {
  assert.equal(openInterestUsd({ openInterestUnits: 1000, markPrice: 180.5 }), 180500)
  assert.equal(openInterestUsd({ openInterestUnits: null, markPrice: 180.5 }), null)
  assert.equal(openInterestUsd({ openInterestUnits: 1000, markPrice: null }), null)
})

test('the chart page takes a Phoenix market by a name of an address’s shape — one symbol, one name, case kept', () => {
  const ids = ['SOL', 'kBONK', 'KBONK', 'BTC', 'FARTCOIN', 'A', 'ABCDEFGHIJKLMNOPQRST'].map(chartIdOf)
  for (const id of ids) assert.match(id, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, id)
  assert.equal(new Set(ids).size, ids.length, 'kBONK is not KBONK')
  assert.equal(chartIdOf('SOL'), chartIdOf('SOL'))
  // The page accepts the market message it names — the bridge's own reader, the page's.
  const message = parseAppMessage(
    JSON.stringify({
      v: BRIDGE_VERSION,
      type: 'market',
      mint: chartIdOf('kBONK'),
      symbol: 'kBONK-PERP',
      stock: false,
      theme: 'graphite',
      lang: 'uk',
      timeframe: '15m',
    }),
  )
  assert.equal(message?.mint, chartIdOf('kBONK'))
  assert.equal(message?.symbol, 'kBONK-PERP')
})

test('Phoenix’s bars on the core chart: the chart’s base volume is Phoenix’s own, the source Phoenix, a failed refresh stale', () => {
  const read = parseCandles(
    {
      timeframe: '15m',
      last: [
        { t: 900000, o: 100, h: 104, l: 98, c: 102, v: 3 },
        { t: 1800000, o: 102, h: 103, l: 101, c: 101.5 },
      ],
      observedAt: 1792505711575,
    },
    'SOL',
  )
  const chart = chartReadOf(read, '15m', false)
  assert.equal(chart.timeframe, '15m')
  assert.equal(chart.observedAt, 1792505711575)
  assert.equal(chart.stale, false)
  assert.equal(chart.source, 'Phoenix')
  assert.equal(chart.pool, 'SOL-PERP')
  assert.equal(chart.candles[0].time, 900)
  // The page divides the dollars by (H + L + C) / 3 again: 3 SOL, exactly.
  const typical = (104 + 98 + 102) / 3
  assert.ok(Math.abs(chart.candles[0].volume / typical - 3) < 1e-12)
  assert.equal('volume' in chart.candles[1], false, 'a bar without volume carries none, never a zero')
  assert.equal(chartReadOf(read, '15m', true).stale, true)
  // The page reads the message whole — every bar kept, oldest first.
  const said = parseAppMessage(JSON.stringify({ v: BRIDGE_VERSION, type: 'candles', ...chart }))
  assert.equal(said?.candles.length, 2)
  assert.equal(said?.source, 'Phoenix')
  // The candles route serves the chart's six intervals, and the hook asks for any of them.
  assert.match(code('features/futures/use-futures.ts'), /useFuturesCandles\(symbol: string, timeframe: ProTimeframe\)/)
  for (const tf of PRO_TIMEFRAMES) assert.match(code('features/futures/use-futures.ts'), new RegExp(`'${tf}': \\d`))
})

test('a level of the book pressed opens the ticket on Limit at its price: an ask a long, a bid a short', () => {
  assert.deepEqual(bookPick('ask', 108.25), { kind: 'open', side: 'long', price: '108.25' })
  assert.deepEqual(bookPick('bid', 108.2), { kind: 'open', side: 'short', price: '108.2' })
  // Never an exponent, which no price field reads.
  assert.equal(bookPick('ask', 1e-7).price, '0.0000001')
  assert.equal(plainPrice(0.00001234), '0.00001234')
})

test('view only while the market or the gate keeps orders closed — and the «?» says which', () => {
  const active = { status: 'active', isolatedOnly: false, tickSize: 100, baseLotsDecimals: 2 }
  assert.equal(viewOnlyReason(active, 'W', true), null)
  assert.equal(viewOnlyReason(active, 'W', false), 'gate')
  assert.equal(viewOnlyReason(active, null, true), 'wallet')
  assert.equal(viewOnlyReason({ ...active, status: 'gated' }, 'W', true), 'gated')
  assert.equal(viewOnlyReason({ ...active, isolatedOnly: true }, 'W', true), 'isolated')
  assert.equal(viewOnlyReason({ ...active, tickSize: null }, 'W', true), 'units')
  assert.equal(viewOnlyReason(null, 'W', true), null)
  // A gate not read yet (or a failed read) is no reason: the server's Review asks it again.
  assert.equal(viewOnlyReason(active, 'W', null), null)
  // A wallet Phoenix never opened an account for: view only, with the web's words — no Review the server refuses.
  assert.equal(viewOnlyReason(active, 'W', true, 'none'), 'account')
  assert.equal(viewOnlyReason(active, 'W', true, 'uninitialized'), 'account')
  assert.equal(viewOnlyReason(active, 'W', true, 'cold'), null)
  for (const words of [FUTURES_COPY.en, FUTURES_COPY.uk])
    for (const reason of ['gated', 'isolated', 'units', 'wallet', 'account', 'gate'])
      assert.ok(words.whyViewOnly[reason], reason)
  assert.match(FUTURES_COPY.uk.whyViewOnly.gate, /^Лише перегляд/)
})

test('the market’s page: the core chart in place of the line, the head without funding, the book into the ticket', () => {
  const page = code('screens/futures/market.tsx')
  assert.match(page, /<CoreChart/)
  assert.doesNotMatch(page, /PriceChart/, 'the thin line chart is gone')
  assert.match(page, /mint: chartIdOf\(symbol\)/)
  assert.match(page, /chartReadOf\(candles\.data, timeframe, candles\.isError\)/)
  // Open interest stays off the head, as on the web, until Phoenix's one-side or both-sides count is confirmed.
  assert.doesNotMatch(page, /openInterestUsd\(market\)/)
  assert.doesNotMatch(page, /funding/i, 'no funding rate in the head: its unit is unknown')
  assert.match(page, /setIntent\(bookPick\(side, price\)\)/)
  assert.match(page, /const pick = canTrade/, 'a level is pressed only where this wallet can trade')
  assert.match(
    page,
    /const reason = viewOnlyReason\(market, wallet\.address, gate\.read \? states\.open : null, account\.data\?\.state \?\? null\)/,
  )
  assert.match(page, /reason \? words\.viewOnly : null/)
  // The «?» blames the gate only for the gate; other reasons keep what Perps are.
  assert.match(page, /reason === 'gate' \? words\.help : words\.helpOrders\.slice\(0, 2\)/)
  assert.match(page, /book=\{bookRead\}/)
  assert.match(page, /onDeposit=\{\(\) => setCollateral\('deposit'\)\}/)
  assert.match(page, /<CollateralSheet/)
  for (const kind of ['protect', 'reduce', 'close', 'cancel'])
    assert.match(page, new RegExp(`onIntent\\(\\{ kind: '${kind}'`), kind)
  // One chart for the professional chart and this page: the WebView lives in one place.
  assert.doesNotMatch(page, /WebView/)
  assert.match(code('screens/pro-chart/index.tsx'), /export function CoreChart/)
  assert.match(code('screens/pro-chart/index.tsx'), /<CoreChart/)
})
