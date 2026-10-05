import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  EMPTY_WIDGET,
  parseWidgetState,
  wantsRead,
  widgetFace,
  WIDGET_FRESH_MS,
  WIDGET_STALE_MS,
} from './widget-model.ts'

const WALLET = 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W'
const now = new Date(2026, 9, 5, 15, 0).getTime()
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString()
const figures = (over = {}) => ({
  owner: WALLET,
  observedAt: at(2),
  total: 1234.5,
  dayUsd: 12.3,
  dayPct: 1.01,
  whole: true,
  ...over,
})
/** The formatters space thousands with a no-break space; the assertions read it as a space. */
const plain = (text) => text.replace(/\s/g, ' ')
const face = (state, over = {}) => widgetFace(state, { locale: 'uk', now, hidden: false, ...over })

test('no wallet: the widget asks for one, in the app language', () => {
  assert.deepEqual(face(EMPTY_WIDGET).kind, 'connect')
  assert.equal(face(EMPTY_WIDGET).line, 'Під’єднай гаманець')
  assert.equal(widgetFace(EMPTY_WIDGET, { locale: 'en', now, hidden: false }).line, 'Connect your wallet')
})

test("the wallet's value, its day and its time, as Home says them", () => {
  const shown = face({ wallet: WALLET, figures: figures(), failedAt: null })
  assert.equal(shown.kind, 'value')
  assert.equal(plain(shown.value), '$1 234,50')
  assert.equal(shown.known, true)
  assert.equal(plain(shown.change.text), '+$12,30 · +1,01% за день')
  assert.equal(shown.change.move, 'up')
  assert.match(shown.time, /^\d{2}:\d{2}$/)
  assert.equal(shown.note, null)
})

test('hidden amounts stay hidden; the move keeps only its percent', () => {
  const shown = face({ wallet: WALLET, figures: figures(), failedAt: null }, { hidden: true })
  assert.equal(shown.value, '••••')
  assert.equal(shown.known, false)
  assert.equal(plain(shown.change.text), '+1,01% за день')
  assert.ok(!plain(shown.label).includes('1 234'))
})

test('a read that could not be refreshed, or is over an hour old, says so; a partial read too', () => {
  const failed = face({ wallet: WALLET, figures: figures(), failedAt: at(1) })
  assert.equal(failed.note, 'не оновлено')
  const old = face({
    wallet: WALLET,
    figures: figures({ observedAt: at(WIDGET_STALE_MS / 60_000 + 1) }),
    failedAt: null,
  })
  assert.equal(old.note, 'не оновлено')
  const earlierFailure = face({ wallet: WALLET, figures: figures(), failedAt: at(10) })
  assert.equal(earlierFailure.note, null)
  const partial = face({ wallet: WALLET, figures: figures({ whole: false }), failedAt: null })
  assert.equal(partial.note, 'не все прочитано')
})

test('a read from yesterday names its day', () => {
  const shown = face({ wallet: WALLET, figures: figures({ observedAt: at(16 * 60) }), failedAt: null })
  assert.match(shown.time, /^вчора \d{2}:\d{2}$/)
  // Its day's move is not «за день» any more.
  assert.equal(shown.change, null)
})

test("another wallet's figures are never shown; unknown is a dash", () => {
  const shown = face({
    wallet: WALLET,
    figures: figures({ owner: 'Other1111111111111111111111111111111' }),
    failedAt: null,
  })
  assert.equal(shown.value, '—')
  assert.equal(shown.time, '—')
  assert.equal(face({ wallet: WALLET, figures: figures({ total: null }), failedAt: null }).value, '—')
})

test('the launcher asks the wallet again only when the read is not fresh', () => {
  assert.equal(wantsRead(EMPTY_WIDGET, now), false)
  assert.equal(wantsRead({ wallet: WALLET, figures: null, failedAt: null }, now), true)
  assert.equal(wantsRead({ wallet: WALLET, figures: figures(), failedAt: null }, now), false)
  assert.equal(
    wantsRead({ wallet: WALLET, figures: figures({ observedAt: at(WIDGET_FRESH_MS / 60_000) }), failedAt: null }, now),
    true,
  )
})

test('a state read back from the device is checked, never trusted', () => {
  assert.deepEqual(parseWidgetState(undefined), EMPTY_WIDGET)
  assert.deepEqual(parseWidgetState('{not json'), EMPTY_WIDGET)
  assert.deepEqual(parseWidgetState(JSON.stringify({ wallet: WALLET, figures: { owner: WALLET, observedAt: 'x' } })), {
    wallet: WALLET,
    figures: null,
    failedAt: null,
  })
})
