import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { coreNav } from './core-nav.ts'
import {
  badgeOf,
  CITY_PATH,
  drawnTabs,
  HOME_PATH,
  LEGACY_TAB_ROUTES,
  ORDERS_PATH,
  PAYMENTS_PATH,
  PORTFOLIO_PATH,
  SHELL,
  TAB_TITLES,
  TRADE_PATH,
} from './shell.ts'
import { holdPlaces, onPlacesFree, placesHeld } from './place-hold.ts'

const TABS = fileURLToPath(new URL('../../app/(tabs)/', import.meta.url))

test('«Місто» first (CITY-6c), then Menu 3’s five, the core’s own (decision 55): Головна · Торгівля · Гроші · Портфель · Меню', () => {
  assert.deepEqual(
    SHELL.map((entry) => TAB_TITLES.uk[entry.tab]),
    ['Місто', 'Головна', 'Торгівля', 'Гроші', 'Портфель', 'Меню'],
  )
  assert.deepEqual(
    SHELL.map((entry) => TAB_TITLES.en[entry.tab]),
    ['City', 'Home', 'Trading', 'Money', 'Portfolio', 'Menu'],
  )
  // After «Місто», the places are the core's `PHONE_BAR`, in its order.
  assert.deepEqual(
    SHELL.slice(1).map((entry) => entry.tab),
    coreNav.phoneBar,
  )
  // «Місто» is the app's own `/`, where it opens; «Головна» moved to `home`.
  assert.equal(CITY_PATH, '/(tabs)')
  assert.equal(HOME_PATH, '/(tabs)/home')
  // «Торгівля» is drawn from the screener's own address, so every Markets link opens it; «Гроші» and «Меню» keep the
  // files `payments` and `more`, the addresses older links name.
  assert.equal(TRADE_PATH, '/(tabs)/markets')
  assert.equal(PAYMENTS_PATH, '/(tabs)/payments')
  assert.equal(PORTFOLIO_PATH, '/(tabs)/portfolio')
  assert.equal(ORDERS_PATH, '/orders')
})

test('Ryntra is not a place in the bar: it is a button on the screens and a row of «Меню · Автоматика»', () => {
  assert.equal(
    SHELL.some((entry) => /agent|ryn/i.test(entry.tab) || /agent|ryn/i.test(entry.route)),
    false,
  )
  for (const locale of ['en', 'uk']) assert.equal(Object.values(TAB_TITLES[locale]).includes('Ryntra'), false)
  assert.equal(existsSync(`${TABS}agent.tsx`), false)
})

test('a reserved place is never drawn', () => {
  const reserved = SHELL.map((entry) => (entry.tab === 'money' ? { ...entry, ready: false } : entry))
  assert.deepEqual(
    drawnTabs(reserved).map((entry) => entry.tab),
    ['city', 'home', 'trading', 'portfolio', 'menu'],
  )
})

test('the older shells’ tabs lead to where they belong now', () => {
  assert.deepEqual(LEGACY_TAB_ROUTES, {
    '/(tabs)/trade': '/trade',
    '/(tabs)/strategies': '/bots',
    '/(tabs)/agent': '/ryn',
    '/(tabs)/create': '/launch',
    '/create': '/launch',
  })
})

test('the badge says nothing at zero, the count to nine, 9+ beyond', () => {
  assert.equal(badgeOf(0), undefined)
  assert.equal(badgeOf(-2), undefined)
  assert.equal(badgeOf(Number.NaN), undefined)
  assert.equal(badgeOf(1), 1)
  assert.equal(badgeOf(9), 9)
  assert.equal(badgeOf(10), '9+')
  assert.equal(badgeOf(3.7), 3)
})

test('a place opens from where the person stands — never a second bar over the first', async () => {
  const { placeMove } = await import('./shell.ts')
  assert.equal(placeMove({ inBar: true, barBeneath: true }), 'navigate', 'inside the bar: its own switch')
  assert.equal(placeMove({ inBar: true, barBeneath: false }), 'navigate')
  assert.equal(placeMove({ inBar: false, barBeneath: true }), 'dismissTo', 'over the bar: the screens above it close')
  assert.equal(
    placeMove({ inBar: false, barBeneath: false }),
    'replace',
    'opened from a link: the bar takes their place',
  )
  const opener = readFileSync(new URL('./open-place.ts', import.meta.url), 'utf8')
  assert.match(opener, /segments\[0\] === '\(tabs\)'/)
  // Where the bar stands is read from the app's own stack at the tap, under the router's container route `__root`.
  assert.match(opener, /barBeneathOf\(container\?\.getRootState\?\.\(\)/)
  const { barBeneathOf } = await import('./shell.ts')
  const stack = (...names) => ({ routes: names.map((name) => ({ name })) })
  assert.equal(barBeneathOf({ routes: [{ name: '__root', state: stack('(tabs)', 'trade') }] }), true)
  assert.equal(barBeneathOf({ routes: [{ name: '__root', state: stack('asset/[mint]', 'trade') }] }), false)
  assert.equal(barBeneathOf(stack('(tabs)', 'orders')), true, 'the stack itself, when no container route wraps it')
  assert.equal(barBeneathOf(undefined), false)
  // A push tap into a place of the bar goes the same way.
  const binder = readFileSync(new URL('../notifications/notifications-binder.tsx', import.meta.url), 'utf8')
  assert.match(binder, /if \(mapped\.path\.startsWith\('\/\(tabs\)'\)\) openPlace\(mapped\.path\)/)
  // A note, a push, the assistant and the rules' doors open the places this way — never a replace or navigate into the
  // bar. (Bots and its rules no longer open a place: their token pick is a sheet over Bots, ST-5; they never replace
  // into the bar.)
  for (const path of [
    '../../screens/monitoring/open.tsx',
    '../monitoring/use-monitoring.ts',
    '../../screens/agent/index.tsx',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /useOpenPlace\(\)/, path)
    assert.doesNotMatch(source, /router\.(replace|navigate)\(\{ pathname: '\/\(tabs\)/, path)
  }
  const bots = readFileSync(new URL('../../screens/bots/index.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(bots, /router\.(replace|navigate)\(\{ pathname: '\/\(tabs\)/)
  const rules = readFileSync(new URL('../../screens/autoinvest/rules-block.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(rules, /router\.(replace|navigate)\(\{ pathname: '\/\(tabs\)/)
  assert.doesNotMatch(rules, /useOpenPlace\(\)/)
})

test('while money is moving, a place asked for from outside waits — and opens once the last operation lets go', () => {
  let freed = 0
  const stop = onPlacesFree(() => {
    freed += 1
  })
  assert.equal(placesHeld(), false)
  const purchase = holdPlaces()
  const send = holdPlaces()
  assert.equal(placesHeld(), true)
  purchase()
  assert.equal(placesHeld(), true, 'the send still holds')
  purchase()
  assert.equal(freed, 0, 'letting go twice does nothing')
  send()
  assert.equal(placesHeld(), false)
  assert.equal(freed, 1)
  stop()
  holdPlaces()()
  assert.equal(freed, 1, 'a listener gone hears nothing')
  // A push tap and the launcher's quick action wait for it; a quick action into the bar goes through the opener.
  const binder = readFileSync(new URL('../notifications/notifications-binder.tsx', import.meta.url), 'utf8')
  assert.match(binder, /if \(ready && !placesHeld\(\)\) open\(tap\)/)
  assert.match(binder, /onPlacesFree\(flush\)/)
  const quick = readFileSync(new URL('./use-quick-actions.ts', import.meta.url), 'utf8')
  assert.match(quick, /useQuickActionRouting\(handle\)/)
  assert.match(quick, /href\.startsWith\('\/\(tabs\)'\)/)
  // Every sheet that signs money holds the places while it works.
  for (const path of [
    '../../screens/trade/index.tsx',
    '../../screens/invest/buy-sheet.tsx',
    '../../screens/invest/sell-sheet.tsx',
    '../../screens/invest/convert-sheet.tsx',
    '../../screens/money/send.tsx',
    '../../screens/money/pay-link-panel.tsx',
    '../../screens/launch/new.tsx',
    '../../screens/launch/mine.tsx',
    '../../screens/launch/trade-panel.tsx',
  ]) {
    assert.match(readFileSync(new URL(path, import.meta.url), 'utf8'), /usePlaceHold\(/, path)
  }
})
