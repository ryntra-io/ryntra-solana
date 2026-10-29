import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { MARKETS_COPY, pricesLine } from './copy.ts'
import { OPEN_FRESH_MS, readsToRefresh } from './refresh.ts'

const code = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

/* The places that drew «Ціни (монет) не оновлюються · останні відомі». */
const PLACES = [
  'screens/markets/index.tsx',
  'screens/markets/search.tsx',
  'screens/home/buy-pick-sheet.tsx',
  'screens/trade/asset-picker.tsx',
  'screens/autoinvest/rules-block.tsx',
  'screens/plans/pick-stock.tsx',
]

test('no list of prices says «Ціни не оновлюються»: the words are gone and no place reads the stale flag for them', () => {
  for (const locale of ['uk', 'en']) {
    const words = MARKETS_COPY[locale]
    for (const key of ['stale', 'coinsStale', 'refreshFailed', 'partial', 'staleMark']) {
      assert.equal(words[key], undefined, key)
    }
    assert.doesNotMatch(JSON.stringify(words), /не оновлюються|not updating|Не оновилося|Refresh failed/)
  }
  for (const path of PLACES) {
    const source = code(path)
    assert.doesNotMatch(source, /coinsStale|words\.stale\b|markets\.stale\b|refreshFailed|\.data\??\.stale/, path)
    assert.doesNotMatch(source, /notUpdated/, path)
    // Nor any other way of reading the flag — `data!.stale`, `{ stale }`: no word «stale» but React Query's `staleTime`.
    assert.doesNotMatch(source, /\bstale\b(?!Time)/, path)
  }
})

test('a list carries its time and nothing else: «Ціни о 11:49»; nothing read, no line', () => {
  const time = '2026-10-20T11:49:00.000Z'
  assert.equal(
    pricesLine(MARKETS_COPY.uk, time, (iso) => `о ${iso.slice(11, 16)}`),
    'Ціни о 11:49',
  )
  assert.equal(
    pricesLine(MARKETS_COPY.en, time, (iso) => `at ${iso.slice(11, 16)}`),
    'Prices at 11:49',
  )
  assert.equal(
    pricesLine(MARKETS_COPY.uk, null, (iso) => iso),
    null,
  )
})

test('the prices are read again quietly every 60 s, and when the screen opens', () => {
  const hooks = code('hooks/use-markets.ts')
  // The coin lists, the stocks and a typed search: each asks again every minute by itself.
  for (const name of ['useMarkets', 'useStockUniverse', 'useMarketSearch']) {
    const body = hooks.slice(hooks.indexOf(`export function ${name}(`))
    assert.match(body.slice(0, body.indexOf('\n}\n')), /refetchInterval: 60_000/, name)
  }
  // «Ринки» and Search read their lists again when they open and when the app comes back; a sheet when it is shown.
  const open = code('hooks/use-refresh-on-open.ts')
  assert.match(open, /useFocusEffect\(useCallback\(\(\) => refreshNowAndOnReturn\(/)
  assert.match(open, /AppState\.addEventListener\('change', \(state\) => \{\s*if \(state === 'active'\) refresh\(\)/)
  assert.match(open, /useEffect\(\(\) => \(shown \? refreshNowAndOnReturn\(/)
  assert.match(code('screens/markets/index.tsx'), /useRefreshOnOpen\(reads\)/)
  assert.match(code('screens/markets/search.tsx'), /useRefreshOnOpen\(/)
  // «Що купити» reads its coins and companies when it opens and when the app comes back to it, and every minute.
  const pick = code('screens/home/buy-pick-sheet.tsx')
  assert.match(pick, /useMarkets\('crypto', visible && needle\.length === 0\)/)
  assert.match(pick, /usePopularCompanies\(visible \? 60_000 : 120_000\)/)
  assert.match(pick, /useRefreshWhenShown\(visible && needle\.length === 0, \[coins, popular\]\)/)
  assert.doesNotMatch(pick, /eslint-disable/)
})

test('only a list already on screen and past its fresh time is asked again — never one being asked, never one unread', () => {
  const now = Date.parse('2026-10-20T10:30:00Z')
  const read = (over) => ({
    data: { rows: [] },
    dataUpdatedAt: now - 31_000,
    isFetching: false,
    refetch: async () => null,
    ...over,
  })
  const old = read({})
  assert.equal(OPEN_FRESH_MS, 30_000)
  assert.deepEqual(readsToRefresh([old], now), [old])
  // Counted by the answer's own age: the app back after 50 s in the background asks again (seen on the emulator).
  assert.equal(readsToRefresh([read({ dataUpdatedAt: now - 50_000 })], now).length, 1)
  assert.deepEqual(readsToRefresh([read({ dataUpdatedAt: now - 10_000 })], now), [])
  assert.deepEqual(readsToRefresh([read({ isFetching: true })], now), [])
  assert.deepEqual(readsToRefresh([read({ data: undefined, dataUpdatedAt: 0 })], now), [])
})

test('a list that never answered keeps «Ринки не завантажилися» with «Спробувати ще»; a failed refresh draws nothing', () => {
  const screen = code('screens/markets/index.tsx')
  assert.match(screen, /rows\.length === 0 && failed\.length > 0/)
  assert.match(screen, /title=\{isNetworkError\(error\) \? words\.noConnection : words\.listDown\}/)
  assert.match(screen, /action=\{\{ title: words\.tryAgain, onPress: refetch, loading: fetching \}\}/)
  assert.equal(MARKETS_COPY.uk.listDown, 'Ринки не завантажилися')
  assert.equal(MARKETS_COPY.uk.tryAgain, 'Спробувати ще')
  // The head keeps the list's time and age whatever the server's flag says; a list that never answered says so once,
  // in its own screen, not again in the head.
  assert.match(
    screen,
    /const subtitle =\s*emptyWatchlist \|\| \(rows\.length === 0 && failed\.length > 0\)\s*\? ''\s*: list\.observedAt/,
  )
  // Search carries its answer's time and age, as Markets' head does.
  assert.match(
    code('screens/markets/search.tsx'),
    /formatClock\(observedAt\)\} · \$\{formatAge\(observedAt, now, locale\)\}/,
  )
  // Search says its catalogue is down only when it never answered the query, not when a quiet refresh failed.
  assert.match(
    code('screens/markets/search.tsx'),
    /const catalogueLost = catalogue\.isError && catalogue\.data === undefined/,
  )
})
