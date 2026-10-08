import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { badgeOf, BADGE_TAB, drawnTabs, LAUNCH_PATH, LEGACY_TAB_ROUTES, SHELL, TAB_TITLES } from './shell.ts'

const TABS = fileURLToPath(new URL('../../app/(tabs)/', import.meta.url))
const APP = fileURLToPath(new URL('../../app/', import.meta.url))

test('the bar is the web’s five, word for word: Головна · Ринки · Лаунч · Портфель · Ще', () => {
  assert.deepEqual(
    SHELL.map((entry) => TAB_TITLES.uk[entry.tab]),
    ['Головна', 'Ринки', 'Лаунч', 'Портфель', 'Ще'],
  )
  assert.deepEqual(
    SHELL.map((entry) => TAB_TITLES.en[entry.tab]),
    ['Home', 'Markets', 'Launch', 'Portfolio', 'More'],
  )
})

test('Ryntra is not a place in the bar: it is a button on the screens and a row of «Ще»', () => {
  assert.equal(
    SHELL.some((entry) => /agent|ryn/i.test(entry.tab) || /agent|ryn/i.test(entry.route)),
    false,
  )
  for (const locale of ['en', 'uk']) assert.equal(Object.values(TAB_TITLES[locale]).includes('Ryntra'), false)
  assert.equal(existsSync(`${TABS}agent.tsx`), false)
})

test('the middle «+» is an action that opens «Запустити токен», never a place of its own', () => {
  const plus = SHELL[2]
  assert.equal(plus.tab, 'launch')
  assert.equal(plus.action, LAUNCH_PATH)
  assert.equal(LAUNCH_PATH, '/launch')
  assert.ok(existsSync(`${APP}launch/index.tsx`), 'the form the «+» opens')
  // Its file under (tabs) must not share the form's address, or the router holds two `/launch`.
  assert.notEqual(plus.route, 'launch')
  assert.equal(SHELL.filter((entry) => entry.action).length, 1)
})

test('every place has a route file, and the bar draws all five in order', () => {
  const drawn = drawnTabs()
  assert.deepEqual(
    drawn.map((entry) => entry.tab),
    ['home', 'markets', 'launch', 'portfolio', 'more'],
  )
  for (const entry of drawn) assert.ok(existsSync(`${TABS}${entry.route}.tsx`), entry.route)
})

test('a reserved place is never drawn', () => {
  const reserved = SHELL.map((entry) => (entry.tab === 'launch' ? { ...entry, ready: false } : entry))
  assert.deepEqual(
    drawnTabs(reserved).map((entry) => entry.tab),
    ['home', 'markets', 'portfolio', 'more'],
  )
})

test('the first place is Home and carries the badge', () => {
  assert.equal(drawnTabs()[0]?.route, 'index')
  assert.equal(BADGE_TAB, 'home')
})

test('the older shells’ tabs lead to where they belong now', () => {
  assert.deepEqual(LEGACY_TAB_ROUTES, {
    '/(tabs)/trade': '/trade',
    '/(tabs)/strategies': '/bots',
    '/(tabs)/agent': '/ryn',
    '/(tabs)/create': '/launch',
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
