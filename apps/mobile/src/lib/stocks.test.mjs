import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ISSUER_FULL,
  ISSUER_SHORT,
  isOfferedMarket,
  isScaled,
  isSupportedIssuer,
  issuerLabel,
  judgeReference,
  judgeUniverseRow,
  REFERENCE_STALE_AFTER_MS,
  referenceWord,
  sessionWord,
  unitsLine,
  withoutRetiredIssuer,
} from './stocks.ts'

const NOW = Date.parse('2026-09-15T08:00:00.000Z')
const fresh = new Date(NOW - 60_000).toISOString()
const old = new Date(NOW - REFERENCE_STALE_AFTER_MS - 1_000).toISOString()

test('the reference state is judged from the fetch time, never promoted by the session', () => {
  assert.equal(judgeReference({ perShare: null, fetchedAt: fresh, exchangeOpen: true, nowMs: NOW }), 'unavailable')
  assert.equal(judgeReference({ perShare: 0, fetchedAt: fresh, exchangeOpen: true, nowMs: NOW }), 'unavailable')
  assert.equal(judgeReference({ perShare: 211.82, fetchedAt: old, exchangeOpen: true, nowMs: NOW }), 'stale')
  assert.equal(judgeReference({ perShare: 211.82, fetchedAt: null, exchangeOpen: true, nowMs: NOW }), 'stale')
  assert.equal(judgeReference({ perShare: 211.82, fetchedAt: fresh, exchangeOpen: true, nowMs: NOW }), 'current')
  assert.equal(
    judgeReference({ perShare: 211.82, fetchedAt: fresh, exchangeOpen: false, nowMs: NOW }),
    'last-available',
  )
  assert.equal(judgeReference({ perShare: 211.82, fetchedAt: fresh, exchangeOpen: null, nowMs: NOW }), 'last-available')
})

test('a universe row is current only in the market period', () => {
  const row = { reference: 100, referenceAt: fresh, period: 'market' }
  assert.equal(judgeUniverseRow(row, NOW), 'current')
  assert.equal(judgeUniverseRow({ ...row, period: 'overnight' }, NOW), 'last-available')
  assert.equal(judgeUniverseRow({ ...row, period: 'unknown' }, NOW), 'last-available')
  assert.equal(judgeUniverseRow({ ...row, referenceAt: old }, NOW), 'stale')
})

test('issuers have short and full names; an unknown id keeps its id', () => {
  assert.equal(issuerLabel('xstocks'), 'xStocks')
  assert.equal(issuerLabel('xstocks', 'full'), 'xStocks · Backed Finance')
  assert.equal(issuerLabel('someone'), 'someone')
})

test('the app offers four issuers’ tokens — private companies through PreStocks alone (canon v5.2 В25–В27)', () => {
  const four = ['backpack', 'ondo', 'prestocks', 'xstocks']
  assert.deepEqual(Object.keys(ISSUER_SHORT).sort(), four)
  assert.deepEqual(Object.keys(ISSUER_FULL).sort(), four)
  for (const id of four) assert.equal(isSupportedIssuer(id), true)
  assert.equal(isSupportedIssuer('another-issuer'), false)
  assert.equal(isSupportedIssuer(null), false)
  assert.equal(isSupportedIssuer(undefined), false)
})

test('a list offers a stock token only from a supported issuer; what a person keeps loses only the issuer’s name', () => {
  const row = (category, tag) => ({
    mint: 'M',
    category,
    issuer: tag ? { label: tag.toUpperCase(), tag } : null,
  })
  assert.equal(isOfferedMarket(row('stock', 'prestocks')), true)
  assert.equal(isOfferedMarket(row('stock', 'xstocks')), true)
  assert.equal(isOfferedMarket(row('stock', 'another-issuer')), false)
  assert.equal(isOfferedMarket(row('stock', null)), true, 'a stock no issuer is named for is the venue’s to say')
  assert.equal(isOfferedMarket(row('crypto', null)), true)
  assert.equal(isOfferedMarket(row(null, null)), true)
  const kept = withoutRetiredIssuer(row('stock', 'another-issuer'))
  assert.equal(kept.issuer, null)
  assert.equal(kept.mint, 'M')
  const own = row('stock', 'ondo')
  assert.equal(withoutRetiredIssuer(own), own, 'a supported row is the same row')
})

const APP = fileURLToPath(new URL('../../', import.meta.url))
// The contract client is the web line's pinned copy, kept byte for byte; its words are not the app's.
const PINNED = join(APP, 'src', 'lib', 'api', 'v1')

function sourceFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (path !== PINNED) files.push(...sourceFiles(path))
    } else if (/\.(ts|tsx|mjs|js|json)$/.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

test('the issuer disconnected by canon v5.2 (В26) is named in no file of the app — its source, its tests, its config', () => {
  // Spelled by its letters so this guard is not itself a mention of it.
  const retired = new RegExp(String.fromCharCode(116, 101, 115, 115, 101, 114, 97), 'i')
  const found = []
  for (const file of [...sourceFiles(join(APP, 'src')), join(APP, 'app.json'), join(APP, 'app.config.js')]) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (retired.test(line)) found.push(`${relative(APP, file)}:${index + 1}`)
      })
  }
  assert.deepEqual(found, [])
})

test('units are stated only through a known multiplier', () => {
  assert.equal(unitsLine('NVDAx', 'NVDA', 1.001701196801074), '1 NVDAx = 1.001701 NVDA')
  assert.equal(unitsLine('NVDAx', 'NVDA', null), null)
  assert.equal(isScaled(1), false)
  assert.equal(isScaled(1.0017), true)
  assert.equal(isScaled(null), false)
})

test('the session, the reference’s state and the units in Ukrainian — the web’s words', () => {
  assert.equal(sessionWord('overnight'), 'Overnight')
  assert.equal(sessionWord('overnight', 'uk'), 'Нічна сесія')
  assert.equal(sessionWord('unknown', 'uk'), 'Сесія —', 'unknown is a dash in either language')
  assert.equal(referenceWord('stale', 'uk'), 'Застарілий')
  assert.equal(referenceWord('current'), 'Current')
  assert.equal(unitsLine('NVDAx', 'NVDA', 1.001701196801074, 'uk'), '1 NVDAx = 1,001701 NVDA')
})
