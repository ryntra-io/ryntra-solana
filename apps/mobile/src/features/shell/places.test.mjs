import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { MONEY_COPY } from '../money/copy.ts'
import { webHrefOf } from '../monitoring/deep-link.ts'
import {
  BOTS_CATALOG_PATH,
  BOTS_PATH,
  CHANGES_PATH,
  DOOR_DESTINATIONS,
  MONEY_PAGES,
  MONEY_PATH,
  MORE_ROWS,
  placeDoors,
  PLACES_COPY,
  PORTFOLIO_DOORS,
  SETTINGS_PATH,
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

test('«Ще» opens Торгувати · Боти · Гроші · Винагороди · Ryntra · Налаштування, with the web’s captions', () => {
  assert.deepEqual(MORE_ROWS, ['trade', 'bots', 'money', 'rewards', 'ryntra', 'settings'])
  assert.deepEqual(
    MORE_ROWS.map((row) => PLACES_COPY.uk.rows[row].label),
    ['Торгувати', 'Боти', 'Гроші', 'Винагороди', 'Ryntra', 'Налаштування'],
  )
  assert.deepEqual(
    MORE_ROWS.map((row) => PLACES_COPY.en.rows[row].label),
    ['Trade', 'Bots', 'Money', 'Rewards', 'Ryntra', 'Settings'],
  )
  // The web's captions (`MENU_SECTIONS`, `ASSISTANT`), word for word.
  assert.deepEqual(
    MORE_ROWS.map((row) => PLACES_COPY.uk.rows[row].caption),
    ['Спот і обмін', 'Регулярна купівля, плани', 'Поповнення й перекази', 'Бали, таблиці, сезон', 'ШІ-помічник', null],
  )
  assert.deepEqual(DOOR_DESTINATIONS.trade, { kind: 'screen', path: '/trade' })
  assert.deepEqual(DOOR_DESTINATIONS.bots, { kind: 'screen', path: BOTS_PATH })
  assert.deepEqual(DOOR_DESTINATIONS.money, { kind: 'screen', path: MONEY_PATH })
  assert.deepEqual(DOOR_DESTINATIONS.ryntra, { kind: 'screen', path: '/ryn' })
  assert.deepEqual(DOOR_DESTINATIONS.settings, { kind: 'screen', path: SETTINGS_PATH })
  assert.equal(BOTS_CATALOG_PATH, '/bots?tab=catalog')
})

test('nothing that is not on production is a row: no Pools, no Perps, no prediction demo, no Launch row (the bar holds it)', () => {
  const words = JSON.stringify([PLACES_COPY.en.rows, PLACES_COPY.uk.rows])
  assert.doesNotMatch(words, /Pools|Пули|Perps|Перпи|Безстрокові|predictions|прогноз|Launch|Лаунч/i)
})

test('«Гроші» holds the web’s tabs Поповнити · Надіслати · Отримати · Між мережами, the payment link beside Отримати', () => {
  assert.deepEqual(MONEY_PAGES, ['topUp', 'send', 'receive', 'link', 'bridge'])
  assert.deepEqual(
    MONEY_PAGES.filter((page) => page !== 'bridge').map((page) => MONEY_COPY.uk.pages[page]),
    ['Поповнити', 'Надіслати', 'Отримати', 'Посилання на оплату'],
  )
  assert.equal(PLACES_COPY.uk.bridge, 'Між мережами')
  assert.equal(PLACES_COPY.en.bridge, 'Cross-chain')
  // Send, Receive and a payment link are the phone's own screens; the top-up is the phone's own sheet.
  assert.deepEqual(DOOR_DESTINATIONS.topUp, { kind: 'sheet', sheet: 'top-up' })
  assert.deepEqual(DOOR_DESTINATIONS.send, { kind: 'screen', path: '/money/send' })
  assert.deepEqual(DOOR_DESTINATIONS.receive, { kind: 'screen', path: '/money/receive' })
  assert.deepEqual(DOOR_DESTINATIONS.link, { kind: 'screen', path: '/money/receive?tab=link' })
  assert.deepEqual(DOOR_DESTINATIONS.bridge, { kind: 'web', path: '/app/bridge' })
})

test('Portfolio’s doors beside the positions: Боти · Історія — plans and results left for «Боти»', () => {
  assert.deepEqual(
    PORTFOLIO_DOORS.map((door) => PLACES_COPY.uk.doors[door]),
    ['Боти', 'Історія'],
  )
  assert.deepEqual(DOOR_DESTINATIONS.history, { kind: 'screen', path: '/history' })
  assert.equal(PLACES_COPY.uk.active(1), '1 активний')
  assert.equal(PLACES_COPY.uk.active(2), '2 активні')
  assert.equal(PLACES_COPY.uk.active(5), '5 активних')
  assert.equal(PLACES_COPY.uk.active(12), '12 активних')
  assert.equal(PLACES_COPY.uk.active(21), '21 активний')
  assert.equal(PLACES_COPY.en.active(2), '2 active')
  assert.deepEqual(
    placeDoors()
      .filter((door) => door.place === 'home')
      .map((door) => door.destination),
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
  // The Academy has no page a customer can open yet: not a row until it has one.
  assert.equal(
    placeDoors().some((door) => /academ/i.test(door.door)),
    false,
  )
})

test('both languages carry every word', () => {
  for (const locale of ['en', 'uk']) {
    const copy = PLACES_COPY[locale]
    for (const key of ['whatChanged', 'bridge', 'onWeb', 'openInSpot', 'createPlan', 'watchAdd', 'watchRemove']) {
      assert.ok(copy[key].length > 0, `${locale}.${key}`)
    }
    for (const row of MORE_ROWS) assert.ok(copy.rows[row].label, `${locale}.${row}`)
    for (const door of PORTFOLIO_DOORS) assert.ok(copy.doors[door], `${locale}.${door}`)
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
