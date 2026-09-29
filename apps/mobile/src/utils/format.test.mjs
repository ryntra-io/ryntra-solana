import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DASH,
  formatAge,
  formatAmount,
  formatBarTime,
  formatClock,
  formatCount,
  formatDay,
  formatMoment,
  formatPercent,
  formatPrice,
  formatShare,
  formatUsd,
  formatUsdCompact,
  formatUsdSigned,
  shortAddress,
  signOf,
} from './format.ts'

test('unknown figures are dashes, never zeros', () => {
  for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(formatPrice(value), DASH)
    assert.equal(formatUsdCompact(value), DASH)
    assert.equal(formatPercent(value), DASH)
    assert.equal(formatAmount(value), DASH)
  }
  assert.equal(formatClock(null), DASH)
  assert.equal(formatClock('not a date'), DASH)
  assert.equal(formatAge(undefined), DASH)
  assert.equal(shortAddress(null), DASH)
})

test('prices keep two decimals from a dollar up and more precision below it', () => {
  assert.equal(formatPrice(763.0344392980868), '$763.03')
  assert.equal(formatPrice(0.00042), '$0.00042')
  assert.equal(formatPrice(0), '$0.00')
  // Below a millionth (a meme's per-token price): significant digits, never $0.00.
  assert.equal(formatPrice(0.0000001234567), '$0.0000001235')
  assert.equal(formatPrice(0.0000002), '$0.0000002')
})

test('volumes are compact dollars and percentages are signed', () => {
  assert.equal(formatUsdCompact(27903819.93), '$27.9M')
  assert.equal(formatUsdCompact(4726966.05), '$4.7M')
  assert.equal(formatPercent(0.2686776), '+0.27%')
  assert.equal(formatPercent(-1.2), '−1.20%')
  assert.equal(formatPercent(0), '0.00%')
  assert.equal(formatPercent(-0.0000057), '0.00%')
  assert.deepEqual([signOf(2), signOf(-2), signOf(0), signOf(null)], ['up', 'down', 'flat', 'flat'])
})

test('Ukrainian money groups with a space and a comma; the English shapes stay as they were', () => {
  // Hermes and Node may space the thousands with a no-break space or a narrow one: both are a space.
  assert.match(formatUsd(1409.69, 'uk'), /^\$1\s409,69$/)
  assert.equal(formatUsd(1409.69), '$1,409.69')
  assert.match(formatPrice(1307.8242573374764, 'uk'), /^\$1\s307,82$/)
  assert.equal(formatPrice(224.66385, 'uk'), '$224,66')
  assert.equal(formatPrice(0.00042, 'uk'), '$0,00042')
  assert.equal(formatPrice(0.0000001234567, 'uk'), '$0,0000001235')
  assert.equal(formatPrice(null, 'uk'), DASH)
  assert.equal(formatPercent(0.2686776, 'uk'), '+0,27%')
  assert.equal(formatPercent(-1.2, 'uk'), '−1,20%')
  assert.equal(formatUsdSigned(-3.09, 'uk'), '−$3,09')
  assert.equal(formatUsdSigned(3.09), '+$3.09')
  assert.equal(formatUsd(0.001, 'uk'), '<$0,01')
  assert.match(formatUsd(-12345.678, 'uk'), /^−\$12\s345,68$/)
})

test('times carry a clock and an age', () => {
  const now = Date.parse('2026-09-14T21:00:00.000Z')
  assert.equal(formatAge('2026-09-14T20:59:40.000Z', now), 'just now')
  assert.equal(formatAge('2026-09-14T20:55:14.587Z', now), '5 min ago')
  assert.equal(formatAge('2026-09-14T18:00:00.000Z', now), '3 h ago')
  assert.equal(formatAge('2026-09-12T21:00:00.000Z', now), '2 d ago')
  assert.match(formatClock('2026-09-14T20:55:14.587Z'), /^\d{2}:\d{2}$/)
})

test('addresses shorten from both ends', () => {
  assert.equal(shortAddress('XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W'), 'XsoC…DF2W')
  assert.equal(shortAddress('short'), 'short')
  assert.equal(formatAmount(1234.5678901), '1,234.56789')
})

test('counts, shares and days follow the dash rule', () => {
  assert.equal(formatCount(61517), '61,517')
  assert.equal(formatCount(null), DASH)
  assert.equal(formatShare(30.663586267557875), '30.7%')
  assert.equal(formatShare(undefined), DASH)
  assert.equal(formatDay('2025-05-10T14:20:53.000Z', Date.parse('2026-09-15T00:00:00.000Z')), '10 May 2025')
  assert.equal(formatDay('2026-06-27T14:20:53.000Z', Date.parse('2026-09-15T00:00:00.000Z')), '27 Jun')
  assert.equal(formatDay('nope'), DASH)
})

test('a bar time is a clock inside a day, a day and clock across days, a day across months', () => {
  const noon = Date.UTC(2026, 8, 14, 12, 0, 0) / 1000
  assert.match(formatBarTime(noon, 'intraday'), /^\d{2}:\d{2}$/)
  assert.match(formatBarTime(noon, 'days'), /^14 Sep \d{2}:\d{2}$/)
  assert.equal(formatBarTime(noon, 'months'), '14 Sep')
  assert.equal(formatBarTime(Number.NaN, 'months'), DASH)
})

test('a moment reads against now: the clock today, tomorrow or yesterday a day away, the day otherwise', () => {
  const now = Date.parse('2026-09-16T11:24:00.000Z')
  const local = (iso) =>
    new Date(Date.parse(iso)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  assert.equal(formatMoment('2026-09-16T18:00:00.000Z', now), local('2026-09-16T18:00:00.000Z'))
  assert.equal(formatMoment('2026-09-17T11:24:00.000Z', now), `tomorrow ${local('2026-09-17T11:24:00.000Z')}`)
  assert.equal(formatMoment('2026-09-15T09:00:00.000Z', now), `yesterday ${local('2026-09-15T09:00:00.000Z')}`)
  assert.match(formatMoment('2026-09-20T09:00:00.000Z', now), /^20 Sep /)
  assert.equal(formatMoment(null, now), '—')
  assert.equal(formatMoment('never', now), '—')
})

test('the venue’s figures in Ukrainian shape: the web’s K and M with a comma, a space between thousands', () => {
  const NBSP = ' '
  assert.equal(formatUsdCompact(110_500), '$110.5K')
  assert.equal(formatUsdCompact(110_500, 'uk'), '$110,5K')
  assert.equal(formatUsdCompact(5_000_000, 'uk'), '$5M')
  assert.equal(formatUsdCompact(null, 'uk'), DASH)
  assert.equal(formatCount(9997), '9,997')
  assert.equal(formatCount(9997, 'uk'), `9${NBSP}997`)
  assert.equal(formatShare(30.7), '30.7%')
  assert.equal(formatShare(30.7, 'uk'), '30,7%')
  assert.equal(formatAmount(1234.5, 6, 'uk'), `1${NBSP}234,5`)
  assert.equal(formatAmount(1234.5), '1,234.5')
})
