import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { MONEY_COPY } from '../money/copy.ts'
import { webHrefOf } from '../monitoring/deep-link.ts'
import {
  CHANGES_PATH,
  DOOR_DESTINATIONS,
  FORMER_PRO_SCREENS,
  isMarketsList,
  listsPath,
  MARKETS_TOOL_PATHS,
  MARKETS_TOOLS,
  MONEY_PAGES,
  MORE_PAGES,
  placeDoors,
  PLACES_COPY,
  PORTFOLIO_DOORS,
} from './places.ts'

const SRC = fileURLToPath(new URL('../../', import.meta.url))
const APP = join(SRC, 'app')
const PINNED = join(SRC, 'lib', 'api', 'v1')

function appFiles(dir = SRC) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (path !== PINNED) files.push(...appFiles(path))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

const pathname = (path) => path.split('?')[0]

test('«Ще» holds «Гроші» first, then the web’s pages in the Owner’s order, in both languages', () => {
  assert.deepEqual(MONEY_PAGES, ['topUp', 'send', 'receive', 'link'])
  assert.deepEqual(
    MONEY_PAGES.map((page) => MONEY_COPY.uk.pages[page]),
    ['Поповнити', 'Надіслати', 'Отримати', 'Посилання на оплату'],
  )
  assert.deepEqual(
    MONEY_PAGES.map((page) => MONEY_COPY.en.pages[page]),
    ['Top up', 'Send', 'Receive', 'Payment link'],
  )
  // Send, Receive and a payment link are the phone's own screens now (M31); the top-up is the phone's own sheet.
  assert.deepEqual(DOOR_DESTINATIONS.topUp, { kind: 'sheet', sheet: 'top-up' })
  assert.deepEqual(DOOR_DESTINATIONS.send, { kind: 'screen', path: '/money/send' })
  assert.deepEqual(DOOR_DESTINATIONS.receive, { kind: 'screen', path: '/money/receive' })
  assert.deepEqual(DOOR_DESTINATIONS.link, { kind: 'screen', path: '/money/receive?tab=link' })
  assert.deepEqual(MORE_PAGES, ['swap', 'bridge', 'rewards', 'predictions'])
  assert.deepEqual(
    MORE_PAGES.map((page) => PLACES_COPY.uk.pages[page]),
    ['Обмін', 'Міст', 'Винагороди', 'Демо-прогнози'],
  )
  assert.deepEqual(
    MORE_PAGES.map((page) => PLACES_COPY.en.pages[page]),
    ['Swap', 'Bridge', 'Rewards', 'Demo predictions'],
  )
})

test('Markets’ «Для досвідчених» is Спот · Акції · Тренди: Trade and M2’s lists', () => {
  assert.equal(PLACES_COPY.uk.experienced, 'Для досвідчених')
  assert.deepEqual(MARKETS_TOOLS, ['spot', 'stocks', 'trends'])
  assert.deepEqual(
    MARKETS_TOOLS.map((tool) => PLACES_COPY.uk.tools[tool]),
    ['Спот', 'Акції', 'Тренди'],
  )
  assert.deepEqual(MARKETS_TOOL_PATHS, { spot: '/trade', stocks: '/lists?tab=stock', trends: '/lists?tab=crypto' })
  assert.equal(listsPath('watchlist'), '/lists?tab=watchlist')
  for (const list of ['watchlist', 'stock', 'crypto', 'meme']) assert.ok(isMarketsList(list), list)
  for (const other of ['', 'stocks', 'memes', 'Watchlist', null, 1]) assert.equal(isMarketsList(other), false)
})

test('Portfolio’s doors beside the positions: Стратегії · Результати · Історія', () => {
  assert.deepEqual(
    PORTFOLIO_DOORS.map((door) => PLACES_COPY.uk.doors[door]),
    ['Стратегії', 'Результати', 'Історія'],
  )
  assert.deepEqual(DOOR_DESTINATIONS.strategies, { kind: 'screen', path: '/plans' })
  assert.deepEqual(DOOR_DESTINATIONS.history, { kind: 'screen', path: '/history' })
})

test('every screen «Профі» drew as a place is one door into one of the five — two taps with the tab’s own', () => {
  const doors = placeDoors()
  for (const screen of FORMER_PRO_SCREENS) {
    const reach = doors.filter(
      (door) => door.destination.kind === 'screen' && pathname(door.destination.path) === screen,
    )
    assert.ok(reach.length > 0, `${screen} has no door`)
  }
  assert.deepEqual(
    doors.filter((door) => door.place === 'home').map((door) => door.destination),
    [{ kind: 'screen', path: CHANGES_PATH }],
  )
})

test('a door opens a route the router knows, a sheet, or a ryntra.io page — never a dead row', () => {
  for (const { door, destination } of placeDoors()) {
    if (destination.kind === 'screen') {
      const route = pathname(destination.path).slice(1)
      assert.ok(
        existsSync(join(APP, `${route}.tsx`)) || existsSync(join(APP, route, 'index.tsx')),
        `${door}: no route file for ${destination.path}`,
      )
    } else if (destination.kind === 'web') {
      assert.equal(webHrefOf(destination.path), `https://ryntra.io${destination.path}`, door)
    } else {
      assert.equal(destination.sheet, 'top-up')
    }
  }
  // The Academy has no page a customer can open yet: not a row until it has one (canon §0.0 rule 10).
  assert.equal(
    placeDoors().some((door) => /academ/i.test(door.door)),
    false,
  )
})

test('both languages carry every word', () => {
  for (const locale of ['en', 'uk']) {
    const copy = PLACES_COPY[locale]
    for (const key of ['whatChanged', 'experienced', 'onWeb', 'openInSpot', 'createPlan']) {
      assert.ok(copy[key].length > 0, `${locale}.${key}`)
    }
    for (const tool of MARKETS_TOOLS) assert.ok(copy.tools[tool] && copy.toolLines[tool], `${locale}.${tool}`)
    for (const door of PORTFOLIO_DOORS) assert.ok(copy.doors[door], `${locale}.${door}`)
    for (const page of MORE_PAGES) assert.ok(copy.pages[page], `${locale}.${page}`)
    assert.match(copy.watchFull(20), /20/)
    assert.doesNotMatch(JSON.stringify(copy), /\bRyn\b/)
  }
})

test('one version: nothing on the phone reads a depth, and no screen offers «Простий» or «Профі»', () => {
  const found = []
  for (const file of appFiles()) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (
          /use-depth|shell\/depth|ProductDepth|useDepth\(|setDepth\(|['"`](?:Простий|Профі|Simple|Pro)['"`]/.test(line)
        ) {
          found.push(`${relative(SRC, file)}:${index + 1}`)
        }
      })
  }
  assert.deepEqual(found, [])
})

test('the phone has no network switch and no workspaces to hide: mainnet only, one Ryntra', () => {
  const found = []
  for (const file of appFiles()) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (/devnet|testnet|workspace switch/i.test(line)) found.push(`${relative(SRC, file)}:${index + 1}`)
      })
  }
  assert.deepEqual(found, [])
})
