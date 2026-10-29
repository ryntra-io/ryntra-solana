import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  ProChartFeed,
  PRICE_BASIS,
  onTick,
  priceDecimals,
  resolutionOf,
  tickFor,
  timeframeOf,
  withLivePrice,
} from '../../../chart-page/feed.ts'
import {
  BRIDGE_VERSION,
  injectionOf,
  MAX_CANDLES,
  PAGE_RECEIVER,
  parseAppMessage,
  parsePageMessage,
  PRO_TIMEFRAMES,
} from './bridge.ts'
import { PRO_CHART_COPY } from './copy.ts'
import { assetActionsOf, assetPageBeneath, offerAssetActions } from './asset-actions.ts'
import { coverOf, PAGE_ORIGIN, pageHtmlFor, pageMayLoad, pageSpeaks, pageThemeOf } from './page-view.ts'

const code = (path) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

const SOL = 'So11111111111111111111111111111111111111112'
const SECONDS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3_600, '4h': 14_400, '1d': 86_400 }
/* A Tuesday, 12:00:00 UTC — every interval's boundary lies on whole minutes from it. */
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0)

/** The candles route's shape (unix seconds, dollar volume), oldest first, ending at the bucket before `NOW`. */
function candles(timeframe, count, price = 182.4) {
  const size = SECONDS[timeframe]
  const end = Math.floor(NOW / 1000 / size) * size
  const out = []
  let close = price
  for (let i = count; i >= 1; i -= 1) {
    const open = close
    close = open * (1 + Math.sin(i) * 0.01)
    out.push({
      time: end - i * size,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: 1_000 + i * 10,
    })
  }
  return out
}

const market = (extra = {}) =>
  JSON.stringify({
    v: 1,
    type: 'market',
    mint: SOL,
    symbol: 'SOL',
    stock: false,
    theme: 'graphite',
    lang: 'uk',
    timeframe: '1h',
    ...extra,
  })

test('the page can say three things only — ready, an interval, failed — and nothing it says can trade', () => {
  assert.deepEqual(parsePageMessage(JSON.stringify({ v: 1, type: 'ready' })), { v: 1, type: 'ready' })
  assert.deepEqual(parsePageMessage(JSON.stringify({ v: 1, type: 'failed', why: 'x' })), { v: 1, type: 'failed' })
  assert.deepEqual(parsePageMessage(JSON.stringify({ v: 1, type: 'timeframe', timeframe: '15m' })), {
    v: 1,
    type: 'timeframe',
    timeframe: '15m',
  })
  for (const raw of [
    JSON.stringify({ v: 1, type: 'timeframe', timeframe: '1s' }),
    JSON.stringify({ v: 2, type: 'ready' }),
    JSON.stringify({ v: 1, type: 'intent', side: 'buy', price: '1' }),
    JSON.stringify({ v: 1, type: 'order', side: 'buy' }),
    JSON.stringify({ v: 1, type: 'open', url: 'https://example.com' }),
    JSON.stringify([{ v: 1, type: 'ready' }]),
    '{"v":1,"type":"ready"',
    '',
    null,
    42,
  ])
    assert.equal(parsePageMessage(raw), null, String(raw))
})

test('the app’s market message is read strictly: an address, a known theme, language and interval', () => {
  assert.deepEqual(parseAppMessage(market()), {
    v: 1,
    type: 'market',
    mint: SOL,
    symbol: 'SOL',
    stock: false,
    theme: 'graphite',
    lang: 'uk',
    timeframe: '1h',
  })
  assert.equal(parseAppMessage(market({ mint: 'not-a-mint' })), null)
  assert.equal(parseAppMessage(market({ theme: 'dark' })), null)
  assert.equal(parseAppMessage(market({ lang: 'de' })), null)
  assert.equal(parseAppMessage(market({ timeframe: '1w' })), null)
  assert.equal(parseAppMessage(market({ symbol: 'x'.repeat(500) })).symbol, '—', 'an overlong name is not drawn')
  assert.equal(parseAppMessage(market({ stock: 'yes' })).stock, false, 'only true is a stock')
})

test('a read keeps only the candles a chart may draw, oldest first, and never more than the bridge carries', () => {
  const good = candles('1h', 5)
  const broken = [
    good[0],
    { ...good[1], high: good[1].low / 2 },
    { ...good[2], open: -1 },
    { ...good[3], time: good[0].time },
    { ...good[3], close: Number.NaN },
    good[4],
  ]
  const read = parseAppMessage(
    JSON.stringify({ v: 1, type: 'candles', timeframe: '1h', candles: broken, observedAt: NOW, stale: false }),
  )
  assert.deepEqual(
    read.candles.map((candle) => candle.time),
    [good[0].time, good[4].time],
  )
  assert.equal(read.pool, null)
  assert.equal(read.source, null)
  const tooMany = Array.from({ length: MAX_CANDLES + 1 }, (_, index) => ({ ...good[0], time: index + 1 }))
  assert.equal(
    parseAppMessage(JSON.stringify({ v: 1, type: 'candles', timeframe: '1h', candles: tooMany, observedAt: NOW })),
    null,
  )
  assert.deepEqual(parseAppMessage(JSON.stringify({ v: 1, type: 'live', price: -3, at: NOW })), {
    v: 1,
    type: 'live',
    price: null,
    at: NOW,
  })
})

test('a message reaches the page as data: the injected script only calls the receiver with a string', () => {
  const hostile = { v: BRIDGE_VERSION, ...JSON.parse(market({ symbol: '");alert(1);(" </script>' })) }
  const script = injectionOf(hostile)
  assert.ok(script.startsWith(`window.${PAGE_RECEIVER}&&window.${PAGE_RECEIVER}(`))
  assert.ok(!script.includes(' '), 'a line separator is escaped, never raw in the script')
  const heard = []
  const window = { [PAGE_RECEIVER]: (raw) => heard.push(raw) }
  new Function('window', script)(window)
  assert.equal(heard.length, 1)
  assert.equal(typeof heard[0], 'string')
  assert.deepEqual(parseAppMessage(heard[0]), parseAppMessage(JSON.stringify(hostile)))
})

test('the WebView loads the page and nothing else, in the app’s look', () => {
  assert.equal(pageMayLoad(PAGE_ORIGIN), true)
  assert.equal(pageMayLoad('about:blank'), true)
  for (const url of [
    'https://ryntra.io/',
    'https://chart.ryntra.invalid/other',
    'https://chart.ryntra.invalid.evil.com/',
    'javascript:alert(1)',
    'file:///data/data/io.ryntra.app/',
    'intent://wallet#Intent;end',
    'solana-wallet:/v1/associate',
    'data:text/html,hi',
  ])
    assert.equal(pageMayLoad(url), false, url)
  assert.ok(PAGE_ORIGIN.includes('.invalid/'), 'an origin that never resolves')
  assert.equal(pageThemeOf('dark'), 'graphite')
  assert.equal(pageThemeOf('light'), 'porcelain')
  const page = '<!doctype html>\n<html lang="uk" data-theme="graphite">\n<head></head></html>'
  assert.equal(
    pageHtmlFor(page, 'porcelain', 'en'),
    '<!doctype html>\n<html lang="en" data-theme="porcelain">\n<head></head></html>',
  )
  assert.throws(() => pageHtmlFor('<html>', 'graphite', 'uk'), /no <html> head/)
})

test('only the page speaks: Android names it by its origin, an older WebView by its address', () => {
  assert.equal(pageSpeaks('https://chart.ryntra.invalid'), true, 'the origin, as WebMessageListener gives it')
  assert.equal(pageSpeaks('https://chart.ryntra.invalid/'), true, 'the page’s address')
  for (const url of [
    'https://ryntra.io',
    'https://chart.ryntra.invalid.evil.com',
    'http://chart.ryntra.invalid',
    'https://evil.com/https://chart.ryntra.invalid/',
    'null',
    '',
    undefined,
  ])
    assert.equal(pageSpeaks(url), false, String(url))
})

test('the app’s words cover the chart only until it has drawn; then its switch is always in reach', () => {
  const at = (state) => coverOf({ pageFailed: false, ready: false, drawn: false, firstTrouble: null, ...state })
  assert.equal(at({}), 'loading')
  assert.equal(at({ ready: true }), 'loading', 'ready, but no read of the interval yet')
  assert.equal(at({ firstTrouble: 'offline' }), 'offline')
  assert.equal(at({ ready: true, firstTrouble: 'down' }), 'down')
  assert.equal(at({ ready: true, drawn: true }), 'none')
  assert.equal(at({ ready: true, drawn: true, firstTrouble: 'offline' }), 'none', 'a later failure is a strip')
  assert.equal(at({ pageFailed: true, ready: true, drawn: true }), 'failed')
})

test('the pro chart offers only what the asset page right under it offers, and runs that page’s own action', () => {
  const ran = []
  const mint = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
  assert.equal(assetActionsOf(null), null, 'no page beneath: nothing offered')
  const lower = offerAssetActions('asset-lower', {
    buy: true,
    sell: false,
    warning: null,
    run: (a) => ran.push(`lower:${a}`),
  })
  const upper = offerAssetActions('asset-upper', {
    buy: false,
    sell: true,
    warning: 'x',
    run: (a) => ran.push(`upper:${a}`),
  })
  assert.equal(assetActionsOf('asset-lower').buy, true, 'the same asset open twice keeps both offers')
  assetActionsOf('asset-upper').run('sell')
  upper()
  assert.equal(assetActionsOf('asset-upper'), null)
  assert.equal(assetActionsOf('asset-lower').buy, true, 'a page leaving takes only its own offer')
  assetActionsOf('asset-lower').run('buy')
  assert.deepEqual(ran, ['upper:sell', 'lower:buy'])
  lower()
  const route = (key, name, params) => ({ key, name, params })
  const chart = route('c', 'chart/[mint]', { mint })
  const asset = route('a', 'asset/[mint]', { mint })
  assert.equal(assetPageBeneath({ routes: [asset, chart] }, 'c', mint), 'a')
  assert.equal(
    assetPageBeneath({ routes: [asset, chart, route('t', 'trade', {})] }, 'c', mint),
    'a',
    'by its own route',
  )
  assert.equal(assetPageBeneath({ routes: [route('a', 'asset/[mint]', { mint: SOL }), chart] }, 'c', mint), null)
  assert.equal(
    assetPageBeneath({ routes: [asset, route('r', 'ryn', {}), chart] }, 'c', mint),
    null,
    'the page further down is not run under another screen',
  )
  assert.equal(assetPageBeneath({ routes: [chart] }, 'c', mint), null, 'a chart opened by a link')
  assert.equal(assetPageBeneath({ routes: [asset] }, 'c', mint), null, 'the chart already gone')
})

test('the intervals are the candles route’s, and each maps to the engine’s resolution and back', () => {
  assert.deepEqual([...PRO_TIMEFRAMES], ['1m', '5m', '15m', '1h', '4h', '1d'])
  for (const timeframe of PRO_TIMEFRAMES) assert.equal(timeframeOf(resolutionOf(timeframe)), timeframe)
  assert.equal(timeframeOf({ kind: 'time', unit: 'second', span: 1 }), null, 'no second the route does not serve')
  assert.equal(timeframeOf({ kind: 'tick', count: 100 }), null)
})

test('the price step follows the price’s size, and a price prints on it without an exponent', () => {
  assert.equal(priceDecimals(182.4), 2)
  assert.equal(priceDecimals(0.1408), 4)
  assert.equal(priceDecimals(0.0000231), 8)
  assert.equal(tickFor(182.4), '0.01')
  assert.equal(tickFor(0.0000231), '0.00000001')
  assert.equal(onTick(0.00002317, '0.00000001'), '0.00002317')
  assert.equal(onTick(1e-9, '0.000000001'), '0.000000001')
})

test('the live price closes the bar of the moment, and a price a quarter away is a broken print', () => {
  const bars = candles('1h', 3)
  const now = NOW / 1000
  const opened = withLivePrice(bars, bars[2].close * 1.01, now, 3_600)
  assert.equal(opened.length, 4)
  assert.equal(opened[3].time, now)
  assert.equal(opened[3].open, bars[2].close)
  assert.equal(opened[3].volume, undefined, 'a bar the live price opened has no volume yet')
  assert.equal(withLivePrice(bars, bars[2].close * 2, now, 3_600).length, 3)
  assert.equal(withLivePrice(bars, null, now, 3_600).length, 3)
})

test('every interval loads in pages the way the engine asks, with the state, the source and its age', async () => {
  const feed = new ProChartFeed({ mint: SOL, symbol: 'SOL', stock: false }, () => NOW)
  for (const timeframe of PRO_TIMEFRAMES)
    feed.put(timeframe, candles(timeframe, 120), NOW - 5_000, false, 'SOL / USDC', 'GeckoTerminal')
  const instrument = await feed.source.instrument(SOL)
  assert.equal(instrument.kind, 'spot')
  assert.equal(instrument.network, 'solana')
  assert.deepEqual(instrument.bases, [PRICE_BASIS])
  await assert.rejects(feed.source.instrument('other'))
  for (const timeframe of PRO_TIMEFRAMES) {
    const request = {
      instrument: SOL,
      resolution: resolutionOf(timeframe),
      basis: PRICE_BASIS,
      load: 'init',
      timestamp: null,
      limit: 50,
    }
    const first = await feed.source.history(request)
    assert.equal(first.bars.length, 50)
    assert.equal(first.more.forward, true)
    assert.equal(first.display_step, '0.01')
    assert.equal(first.status.state, 'delayed')
    assert.equal(first.status.age_ms, 5_000)
    assert.equal(first.status.source.label, 'GeckoTerminal · SOL / USDC')
    assert.ok(first.status.delay_ms > 0)
    for (const bar of first.bars) for (const price of [bar.o, bar.h, bar.l, bar.c]) assert.match(price, /^\d+\.\d{2}$/)
    const older = await feed.source.history({ ...request, load: 'forward', timestamp: first.bars[0].t })
    assert.equal(older.bars.length, 50)
    assert.ok(older.bars.at(-1).t < first.bars[0].t)
  }
  feed.dispose()
})

test('a stale read says so and keeps the last good time; an interval not read yet is waited for', async () => {
  const clock = { now: NOW }
  const feed = new ProChartFeed({ mint: SOL, symbol: 'SOL', stock: true }, () => clock.now)
  assert.equal((await feed.source.instrument(SOL)).kind, 'stock')
  const request = {
    instrument: SOL,
    resolution: resolutionOf('1h'),
    basis: PRICE_BASIS,
    load: 'init',
    timestamp: null,
    limit: 500,
  }
  const pending = feed.source.history(request)
  feed.put('1h', candles('1h', 10), NOW - 60_000, false)
  assert.equal((await pending).bars.length, 10)
  clock.now = NOW + 120_000
  feed.put('1h', candles('1h', 10), NOW + 110_000, true)
  const stale = await feed.source.history(request)
  assert.equal(stale.status.state, 'stale')
  assert.equal(stale.status.age_ms, 180_000, 'aged from the last good read, not the failed one')
  assert.equal(stale.status.delay_ms, null)
  const controller = new AbortController()
  const waiting = feed.source.history({ ...request, resolution: resolutionOf('4h') }, { signal: controller.signal })
  controller.abort()
  await assert.rejects(waiting, { name: 'AbortError' })
  await assert.rejects(feed.source.history({ ...request, basis: { ...PRICE_BASIS, measure: 'market_cap' } }))
  feed.dispose()
})

test('the live price goes out at most once a second, and a changed older bar comes as a correction', async () => {
  const clock = { now: NOW }
  const feed = new ProChartFeed({ mint: SOL, symbol: 'SOL', stock: false }, () => clock.now)
  feed.put('1m', candles('1m', 120), NOW - 5_000, false)
  const first = await feed.source.history({
    instrument: SOL,
    resolution: resolutionOf('1m'),
    basis: PRICE_BASIS,
    load: 'init',
    timestamp: null,
    limit: 500,
  })
  const events = []
  const stop = feed.source.subscribe({ instrument: SOL, resolution: resolutionOf('1m'), basis: PRICE_BASIS }, (event) =>
    events.push(event),
  )
  const lastClose = Number(first.bars.at(-1).c)
  clock.now = NOW + 10_000
  feed.live(lastClose * 1.01, clock.now)
  assert.equal(events.length, 1)
  assert.equal(events[0].bar.t, NOW)
  assert.equal(events[0].bar.c, onTick(lastClose * 1.01, '0.01'))
  clock.now = NOW + 10_300
  feed.live(lastClose * 1.02, clock.now)
  assert.equal(events.length, 1, 'held for the rest of the second')
  clock.now = NOW + 11_100
  await new Promise((resolve) => setTimeout(resolve, 800))
  assert.equal(events.length, 2)
  const next = candles('1m', 120)
  next[100] = { ...next[100], close: next[100].close * 1.05, high: next[100].high * 1.05 }
  feed.put('1m', next, clock.now, false)
  assert.ok(events.some((event) => event.type === 'corrected' && event.correction.instrument === SOL))
  stop()
  feed.dispose()
})

test('an interval with no candles names no source and takes the server’s time it was given', async () => {
  const feed = new ProChartFeed({ mint: SOL, symbol: 'SOL', stock: false }, () => NOW)
  feed.put('5m', [], NOW - 30_000, false, null, null)
  const page = await feed.source.history({
    instrument: SOL,
    resolution: resolutionOf('5m'),
    basis: PRICE_BASIS,
    load: 'init',
    timestamp: null,
    limit: 500,
  })
  assert.equal(page.bars.length, 0)
  assert.equal(page.status.source.label, '—', 'never a source that said nothing')
  assert.equal(page.status.at, NOW - 30_000)
  assert.equal(page.status.age_ms, 30_000)
  feed.dispose()
})

test('the live price closes the bar of its own moment, by the server’s time — never the phone’s clock', async () => {
  // The phone's clock runs five hours ahead of the server.
  const feed = new ProChartFeed({ mint: SOL, symbol: 'SOL', stock: false }, () => NOW + 5 * 3_600_000)
  feed.put('1h', candles('1h', 10), NOW - 5_000, false, 'SOL / USDC', 'GeckoTerminal')
  const lastClose = candles('1h', 10).at(-1).close
  feed.live(lastClose * 1.01, NOW + 60_000)
  const page = await feed.source.history({
    instrument: SOL,
    resolution: resolutionOf('1h'),
    basis: PRICE_BASIS,
    load: 'init',
    timestamp: null,
    limit: 500,
  })
  assert.equal(page.bars.length, 11, 'one bar opened by the price')
  assert.equal(page.bars.at(-1).t, NOW, 'in the hour of the price, not five hours later')
  assert.match(page.status.source.label, / · Jupiter$/)
  feed.live(lastClose * 2, NOW + 120_000)
  const far = await feed.source.history({
    instrument: SOL,
    resolution: resolutionOf('1h'),
    basis: PRICE_BASIS,
    load: 'init',
    timestamp: null,
    limit: 500,
  })
  assert.equal(far.bars.length, 10, 'a price a quarter away is not drawn')
  assert.doesNotMatch(far.status.source.label, /Jupiter/, 'and not named')
  feed.dispose()
})

test('a withdrawn live price takes its bar and its name with it: the feed asks the chart to load again', async () => {
  const feed = new ProChartFeed({ mint: SOL, symbol: 'SOL', stock: false }, () => NOW)
  feed.put('1h', candles('1h', 10), NOW - 5_000, false, 'SOL / USDC', 'GeckoTerminal')
  const request = {
    instrument: SOL,
    resolution: resolutionOf('1h'),
    basis: PRICE_BASIS,
    load: 'init',
    timestamp: null,
    limit: 500,
  }
  const lastClose = candles('1h', 10).at(-1).close
  assert.equal(feed.live(lastClose * 1.01, NOW + 60_000), false)
  const opened = await feed.source.history(request)
  assert.equal(opened.bars.length, 11)
  const stop = feed.source.subscribe({ instrument: SOL, resolution: resolutionOf('1h'), basis: PRICE_BASIS }, () => {})
  assert.equal(feed.live(null), true, 'the bar the price opened is gone: load again')
  const after = await feed.source.history(request)
  assert.equal(after.bars.length, 10)
  assert.doesNotMatch(after.status.source.label, /Jupiter/)
  assert.equal(feed.live(null), false, 'once')
  assert.equal(feed.live(lastClose, NOW + 60_000), false)
  assert.equal(feed.live(lastClose, NOW + 3_700_000), false, 'the same price later still moves its moment')
  assert.equal((await feed.source.history(request)).bars.at(-1).t, NOW + 3_600_000)
  stop()
  feed.dispose()
})

test('a reload is asked once, never again for an interval drawn empty, nor for a late answer', async () => {
  const feed = new ProChartFeed({ mint: SOL, symbol: 'SOL', stock: false }, () => NOW)
  const request = {
    instrument: SOL,
    resolution: resolutionOf('1m'),
    basis: PRICE_BASIS,
    load: 'init',
    timestamp: null,
    limit: 500,
  }
  feed.put('1m', candles('1m', 10), NOW - 5_000, false, 'SOL / USDC', 'GeckoTerminal')
  await feed.source.history(request)
  const stop = feed.source.subscribe({ instrument: SOL, resolution: resolutionOf('1m'), basis: PRICE_BASIS }, () => {})
  // The interval answers empty after it was drawn: one reload, then quiet.
  assert.equal(feed.put('1m', [], NOW, false), true)
  assert.equal((await feed.source.history(request)).bars.length, 0)
  assert.equal(feed.put('1m', [], NOW + 20_000, false), false)
  assert.equal(feed.live(100, NOW + 20_000), false)
  assert.equal(feed.live(101, NOW + 40_000), false)
  // A late answer of the market (older than the one held) changes nothing.
  assert.equal(feed.live(99, NOW + 10_000), false)
  stop()
  feed.dispose()
})

test('candles that come after an empty read are drawn: the feed asks the chart to load the interval again', async () => {
  const feed = new ProChartFeed({ mint: SOL, symbol: 'SOL', stock: false }, () => NOW)
  const request = {
    instrument: SOL,
    resolution: resolutionOf('15m'),
    basis: PRICE_BASIS,
    load: 'init',
    timestamp: null,
    limit: 500,
  }
  assert.equal(feed.put('15m', [], NOW - 1_000, false), false)
  assert.equal((await feed.source.history(request)).bars.length, 0)
  assert.equal(feed.put('15m', candles('15m', 3), NOW, false, 'SOL / USDC', 'GeckoTerminal'), true, 'load again')
  assert.equal(feed.put('15m', candles('15m', 4), NOW, false), false, 'once')
  assert.equal(feed.put('1h', candles('1h', 4), NOW, false), false, 'an interval drawn before needs no reload')
  feed.dispose()
})

test('the chart page is the core’s chart with no trading layer and no network', () => {
  const page = code('chart-page/main.tsx')
  assert.match(page, /from '@ryntra\/core\/chart'/)
  assert.match(page, /<RyntraChart/)
  assert.match(page, /if \(reload\) setRevision/, 'the chart loads an interval again when the feed asks')
  assert.match(page, /if \(current\.feed\.live\(message\.price, message\.at\)\) setRevision/)
  for (const banned of [
    /\btrading=/,
    /\bonIntent\b/,
    /\bladder=/,
    /\bplan=/,
    /\bfetch\(/,
    /XMLHttpRequest/,
    /WebSocket/,
  ])
    assert.doesNotMatch(page, banned, String(banned))
  const feed = code('chart-page/feed.ts')
  assert.doesNotMatch(feed, /\bfetch\(|XMLHttpRequest|WebSocket/)
  assert.match(feed, /import type \{[^}]*\} from '@ryntra\/core\/adapters'/, 'the contract’s types')
  assert.doesNotMatch(feed, /^import \{[^}]*\} from '@ryntra\/core/m, 'no code of the core: the tests run it in Node')
})

test('the built page carries the core, its mark and a policy that allows no connection', async () => {
  const { CHART_PAGE_HTML, CHART_PAGE_CORE, CHART_PAGE_NOTICES } = await import('../../../chart-page/page.generated.ts')
  const engine = CHART_PAGE_NOTICES.find((entry) => entry.name === 'KLineChart')
  assert.ok(engine, 'the engine’s notice travels with the app')
  assert.equal(engine.license, 'Apache-2.0')
  assert.match(engine.notice, /TradingView/, 'the engine’s NOTICE whole, the TradingView line included')
  assert.match(engine.licenseText, /Apache License/)
  assert.match(code('src/screens/pro-chart/index.tsx'), /CHART_PAGE_NOTICES\.map/)
  assert.match(CHART_PAGE_CORE, /^\d+\.\d+\.\d+$/)
  assert.match(CHART_PAGE_HTML, /^<!doctype html>/)
  const policy = CHART_PAGE_HTML.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)
  assert.ok(policy, 'a page policy')
  assert.match(policy[1], /default-src 'none'/)
  assert.match(policy[1], /connect-src 'none'/)
  assert.doesNotMatch(policy[1], /https?:/, 'no site is allowed')
  assert.doesNotMatch(CHART_PAGE_HTML, /<script[^>]+src=|<link[^>]+href=|<iframe/i, 'nothing loaded from outside')
  assert.match(CHART_PAGE_HTML, /ryntra-chart__mark/, 'the core draws the Ryntra mark itself (CH-Р9)')
  assert.match(CHART_PAGE_HTML, /font-family:"Geist"/)
})

test('the screen trades only through the app’s ticket, and the asset page opens it', () => {
  const screen = code('src/screens/pro-chart/index.tsx')
  assert.match(screen, /assetPageBeneath\(useNavigation\(\)\.getState\(\) \?\? \{ routes: \[\] \}, own, mint\)/)
  assert.match(screen, /if \(!actions \|\| acted\.current\) return/, 'one tap acts once')
  assert.match(screen, /useAssetActions\(beneath\)/)
  assert.match(screen, /<BuyWarning text=\{warning\} \/>/, 'the page’s own warning over «Купити»')
  assert.match(screen, /actions\.run\(action\)/)
  assert.doesNotMatch(screen, /pathname: '\/trade'/, 'no ticket of its own: the asset page’s own flow')
  for (const banned of [/signTransaction/, /signAndSend/, /sendTransaction/, /useWallet/, /transact\(/])
    assert.doesNotMatch(screen, banned, String(banned))
  assert.match(screen, /originWhitelist=\{\['\*'\]\}/)
  assert.match(screen, /onShouldStartLoadWithRequest=\{\(request\) => pageMayLoad\(request\.url\)\}/)
  assert.match(screen, /allowFileAccess=\{false\}/)
  assert.match(screen, /if \(!pageSpeaks\(event\.nativeEvent\.url\)\) return/, 'only the page the app opened speaks')
  assert.match(screen, /key=\{instance\}/, 'one WebView instance at a time')
  assert.match(screen, /setReadyFor\(instance\)/, 'ready belongs to the instance that said it')
  const asset = code('src/screens/asset/index.tsx')
  assert.match(asset, /pathname: '\/chart\/\[mint\]'/)
  assert.match(asset, /pro=\{\{ symbol:/)
  assert.match(asset, /offerAssetActions\(routeKey, \{/)
  assert.match(asset, /const proBuy = pinned\?\.buy \?\? null/, 'the purchase only where the page pins one')
})

test('the words are in both languages and say no advice', () => {
  const en = PRO_CHART_COPY.en
  const uk = PRO_CHART_COPY.uk
  assert.deepEqual(Object.keys(uk).sort(), Object.keys(en).sort())
  const all = [...Object.values(en), ...Object.values(uk)].flat().filter((value) => typeof value === 'string')
  for (const line of all) assert.doesNotMatch(line, /signal|profit|сигнал|профіт|прибут|guarant|гарант/i, line)
  assert.equal(uk.doorA11y('SOL'), 'Відкрити професійний графік SOL')
})
