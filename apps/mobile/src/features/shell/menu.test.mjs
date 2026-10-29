import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { coreNav } from './core-nav.ts'
import { PREDICTIONS_LIVE } from './places.ts'
import {
  groupOpen,
  MENU_AUX,
  MENU_COPY,
  MENU_DESTINATIONS,
  menuGroups,
  parseOpenGroups,
  placeDoors,
  rowLives,
} from './menu.ts'

const code = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

test('the menu is the core’s Menu 3: Home, then Торгівля · Автоматика · Заробіток · Гроші · Казна, in its order', () => {
  assert.deepEqual(
    coreNav.groups.map((group) => MENU_COPY.uk.groups[group.id]),
    ['Торгівля', 'Автоматика', 'Заробіток', 'Гроші', 'Казна'],
  )
  assert.equal(MENU_COPY.uk.menu, 'Меню')
  assert.equal(MENU_COPY.en.menu, 'Menu')
  // The words are the core's own, so the phone and the web name every row alike — «Perps» as the web says it since
  // PERP-1, until the core's own words say it too.
  for (const locale of ['en', 'uk']) {
    assert.deepEqual(MENU_COPY[locale].items, { ...coreNav.words[locale].items, futures: 'Perps' })
    assert.deepEqual(MENU_COPY[locale].groups, coreNav.words[locale].groups)
  }
  // The phone's bar and Money's four actions come from the same module.
  assert.deepEqual(coreNav.phoneBar, ['home', 'trading', 'money', 'portfolio', 'menu'])
  assert.deepEqual(coreNav.moneyActions, ['deposit', 'send', 'receive', 'bridge'])
})

test('the phone draws only what lives in it: a row without the phone’s door, and an empty group, are not there', () => {
  assert.deepEqual(
    menuGroups().map((group) => [group.id, group.rows]),
    [
      ['trading', ['swap', 'markets', 'launch', 'futures', ...(PREDICTIONS_LIVE ? ['predictions'] : [])]],
      ['automation', ['bots', 'assistant']],
      ['earning', ['rewards']],
      ['money', ['portfolio', 'deposit', 'send', 'receive', 'bridge', 'history']],
    ],
  )
  // No treasury on Solana; no Спот of its own (the phone buys from an asset's page); no agents, pools or loans yet.
  for (const id of ['spot', 'agents', 'pools', 'lend', 'treasury', 'payouts', 'recipients', 'policies'])
    assert.equal(rowLives(id), false, id)
  // A door that waits is held as false and the row comes back the day it opens.
  assert.deepEqual(
    menuGroups({ rewards: false }).map((group) => group.id),
    ['trading', 'automation', 'money'],
  )
})

test('the phone is Ryntra on Solana alone: no network row, no «Інші продукти», no row into another product', () => {
  // «в солані писати, що мережа солана і інші продукти не потрібно»; Ф'ючерси are
  // Phoenix's inside Ryntra on Solana — «Торгівля»'s own segment (decision 56, C4); so are Прогнози (decisions 57, 58, M12).
  assert.deepEqual(MENU_DESTINATIONS.futures, { kind: 'screen', path: '/(tabs)/markets?seg=futures' })
  assert.equal(rowLives('futures'), true)
  assert.deepEqual(MENU_DESTINATIONS.predictions, { kind: 'screen', path: '/(tabs)/markets?seg=predictions' })
  // Прогнози wait for the second release: held as false, drawn the day it is on.
  assert.equal(rowLives('predictions'), PREDICTIONS_LIVE)
  assert.equal(rowLives('predictions', { predictions: false }), false)
  assert.equal(rowLives('predictions', {}), true)
  assert.equal(
    placeDoors().some(
      (door) => door.destination.kind === 'site' && !/^https:\/\/ryntra\.io\/docs$/.test(door.destination.url),
    ),
    false,
    'the only site a door opens is the help',
  )
  for (const locale of ['en', 'uk']) {
    const words = JSON.stringify(MENU_COPY[locale])
    assert.doesNotMatch(words, /Other products|Інші продукти|"network"|Мережа:/)
  }
  const screen = code('screens/menu/index.tsx')
  assert.doesNotMatch(screen, /Network|otherProducts|products\b|PHONE_NETWORKS/)
  // The foot: Налаштування and Допомога, then the version alone.
  assert.deepEqual(Object.keys(MENU_AUX), ['settings', 'help'])
  assert.equal(MENU_COPY.uk.version('1.15.0'), 'Ryntra 1.15.0')
})

test('a row is a word only — no line under it, nothing to read before choosing', () => {
  const screen = code('screens/menu/index.tsx')
  assert.doesNotMatch(screen, /\bline=|caption/)
  assert.doesNotMatch(screen, /<DoorRow\b/)
})

test('a group opens and shuts by its arrow and is remembered; untouched, only Гроші is open', () => {
  assert.equal(groupOpen('money', {}), true)
  for (const group of ['trading', 'automation', 'earning', 'treasury']) assert.equal(groupOpen(group, {}), false, group)
  assert.equal(groupOpen('money', { money: false }), false)
  assert.equal(groupOpen('trading', { trading: true }), true)
  assert.deepEqual(parseOpenGroups('{"trading":true,"money":false}'), { trading: true, money: false })
  // Anything else read back opens the defaults.
  assert.deepEqual(parseOpenGroups('{"trading":"yes","nope":true}'), {})
  assert.deepEqual(parseOpenGroups('not json'), {})
  assert.deepEqual(parseOpenGroups(null), {})
  const store = code('features/shell/use-menu-groups.ts')
  assert.match(store, /createMMKV\(\{ id: 'ryntra\.menu-groups' \}\)/)
  const screen = code('screens/menu/index.tsx')
  assert.match(screen, /accessibilityState=\{\{ expanded: open \}\}/)
  assert.match(screen, /onPress=\{\(\) => groups\.toggle\(group\.id\)\}/)
})
