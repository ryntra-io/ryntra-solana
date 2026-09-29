import assert from 'node:assert/strict'
import { test } from 'node:test'

import { matchStocks, mergeHits } from './search.ts'

const NVDA = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'
const COPY = 'Copy1111111111111111111111111111111111111'
const SOL = 'So11111111111111111111111111111111111111112'

const stock = (over = {}) => ({
  mint: NVDA,
  symbol: 'NVDAx',
  name: 'NVIDIA',
  issuer: 'xstocks',
  icon: null,
  halted: false,
  price: 211.75,
  change24h: -1.08,
  reference: 211.82,
  referenceState: 'current',
  referenceAt: '2026-09-15T07:39:00.510Z',
  deviation: -0.2,
  period: 'overnight',
  volume: 7_262_889,
  liquidity: 1_719_937,
  ...over,
})

const row = (over = {}) => ({
  mint: SOL,
  symbol: 'SOL',
  name: 'Solana',
  icon: null,
  decimals: 9,
  price: 214.4,
  change24hPct: 1.2,
  volume24hUsd: 1e9,
  liquidityUsd: 1e8,
  verified: true,
  suspicious: false,
  category: 'crypto',
  issuer: null,
  ...over,
})

test('a company name finds its stock; the empty query finds nothing', () => {
  const rows = [stock(), stock({ mint: SOL, symbol: 'AAPLx', name: 'Apple', volume: 10 })]
  assert.deepEqual(
    matchStocks(rows, 'nvidia').map((entry) => entry.symbol),
    ['NVDAx'],
  )
  assert.deepEqual(matchStocks(rows, '   '), [])
})

test('exact symbol beats a prefix beats a part, volume breaks ties', () => {
  const rows = [
    stock({ mint: SOL, symbol: 'NVDAxx', name: 'Not it', volume: 1 }),
    stock({ mint: COPY, symbol: 'XNVDAX', name: 'Also', volume: 5 }),
    stock(),
  ]
  assert.deepEqual(
    matchStocks(rows, 'nvdax').map((entry) => entry.symbol),
    ['NVDAx', 'NVDAxx', 'XNVDAX'],
  )
})

test('stocks lead, the venue follows with exact and verified first, one row per mint', () => {
  const hits = mergeHits(
    [stock()],
    [
      row({ mint: COPY, symbol: 'NVDAx', name: 'NVIDIA xStock', verified: false, category: 'stock' }),
      row({ mint: NVDA, symbol: 'NVDAx', name: 'NVIDIA xStock', category: 'stock' }),
      row(),
    ],
    'nvdax',
  )
  assert.deepEqual(
    hits.map((hit) => [hit.symbol, hit.origin, hit.verified]),
    [
      ['NVDAx', 'stocks', true],
      ['NVDAx', 'catalogue', false],
      ['SOL', 'catalogue', true],
    ],
  )
  assert.equal(hits[0].issuer.label, 'xStocks')
  assert.equal(hits[0].note, 'Overnight')
})

test('a stock with an unknown session carries no note; a halted one says so', () => {
  const [quiet, halted] = mergeHits([stock({ period: 'unknown' }), stock({ mint: SOL, halted: true })], [], 'x')
  assert.equal(quiet.note, null)
  assert.equal(halted.halted, true)
})

test('a stock hit says its session in the language asked for', () => {
  const [hit] = mergeHits([stock({ period: 'overnight' })], [], 'nvda', 'uk')
  assert.equal(hit.note, 'Нічна сесія')
  const [closed] = mergeHits([stock({ period: 'closed' })], [], 'nvda', 'uk')
  assert.equal(closed.note, 'Закрито')
})
