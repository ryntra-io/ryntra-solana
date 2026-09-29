import assert from 'node:assert/strict'
import { test } from 'node:test'

import { badgeOf, BADGE_TAB, drawnTabs, LEGACY_TAB_ROUTES, SHELL, TAB_TITLES } from './shell.ts'

test('the Agent tab is labelled Ryntra in both languages; every tab has its words', () => {
  assert.equal(TAB_TITLES.en.agent, 'Ryntra')
  assert.equal(TAB_TITLES.uk.agent, 'Ryntra')
  // The canon's five places, word for word (§3): Головна · Ринки · Ryntra · Портфель · Ще.
  assert.deepEqual(
    SHELL.map((entry) => TAB_TITLES.uk[entry.tab]),
    ['Головна', 'Ринки', 'Ryntra', 'Портфель', 'Ще'],
  )
  for (const locale of ['en', 'uk']) {
    for (const entry of SHELL) assert.ok(TAB_TITLES[locale][entry.tab].length > 0, `${locale}.${entry.tab}`)
  }
})

test('the shell draws the target order, the Agent tab included since M11', () => {
  assert.deepEqual(
    SHELL.map((entry) => entry.tab),
    ['home', 'markets', 'agent', 'portfolio', 'more'],
  )
  const drawn = drawnTabs()
  assert.deepEqual(
    drawn.map((entry) => entry.tab),
    ['home', 'markets', 'agent', 'portfolio', 'more'],
  )
  assert.equal(drawn.length, 5)
  assert.ok(drawn.every((entry) => entry.ready))
  assert.equal(SHELL.find((entry) => entry.tab === 'agent')?.route, 'agent')
})

test('a reserved tab is never drawn', () => {
  const reserved = SHELL.map((entry) => (entry.tab === 'agent' ? { ...entry, ready: false } : entry))
  assert.deepEqual(
    drawnTabs(reserved).map((entry) => entry.tab),
    ['home', 'markets', 'portfolio', 'more'],
  )
})

test('the first tab is Home and carries the badge', () => {
  assert.equal(drawnTabs()[0]?.route, 'index')
  assert.equal(BADGE_TAB, 'home')
})

test('the built shell doors that lost their tab redirect to the same surfaces', () => {
  assert.equal(LEGACY_TAB_ROUTES['/(tabs)/trade'], '/trade')
  assert.equal(LEGACY_TAB_ROUTES['/(tabs)/strategies'], '/plans')
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
