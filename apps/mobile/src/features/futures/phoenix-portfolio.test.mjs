import assert from 'node:assert/strict'
import { test } from 'node:test'

import { phoenixHolding, positionResultUsd, valueWithPhoenix } from './phoenix-portfolio.ts'

const position = (over) => ({
  symbol: 'BTC',
  subaccount: 0,
  side: 'long',
  size: 0.0018,
  entryPrice: 81_580,
  tpPrice: null,
  slPrice: null,
  ...over,
})

// A `cold` account: $7.29 of USDC, a BTC long opened on the web.
const account = (over = {}) => ({
  wallet: '4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n',
  state: 'cold',
  collateralUsd: 7.287169,
  collateralSol: 0,
  positions: [position()],
  orders: [],
  margin: { portfolioUsd: 5.47, initialMarginUsd: 3.63, maintenanceMarginUsd: 1.81, riskTier: 'safe' },
  observedAt: 1_792_836_434_186,
  ...over,
})

test("C4f: a position's result at the mark — a long gains as it rises, a short as it falls; unknown is null", () => {
  assert.ok(Math.abs(positionResultUsd(position(), 80_550) - -1.854) < 1e-9)
  assert.ok(Math.abs(positionResultUsd(position({ side: 'short' }), 80_550) - 1.854) < 1e-9)
  assert.equal(positionResultUsd(position(), null), null)
  assert.equal(positionResultUsd(position({ entryPrice: null }), 80_550), null)
})

test('C4f: the account in Portfolio — its collateral, what is free, each position at its mark, the result together', () => {
  const held = phoenixHolding(account(), [{ symbol: 'BTC', markPrice: 80_550 }])
  assert.equal(held.collateralUsd, 7.287169)
  assert.ok(Math.abs(held.freeUsd - (5.47 - 3.63)) < 1e-9)
  assert.equal(held.positions.length, 1)
  assert.ok(Math.abs(held.resultUsd - -1.854) < 1e-9)
  // A position with no mark: the result together is a dash, never the part read.
  const unmarked = phoenixHolding(account({ positions: [position(), position({ symbol: 'SOL' })] }), [
    { symbol: 'BTC', markPrice: 80_550 },
  ])
  assert.equal(unmarked.resultUsd, null)
  // No account, or one that holds nothing: nothing drawn.
  assert.equal(phoenixHolding(account({ state: 'none' }), []), null)
  assert.equal(phoenixHolding(account({ state: 'uninitialized' }), []), null)
  assert.equal(phoenixHolding(account({ collateralUsd: 0, positions: [] }), []), null)
  assert.equal(phoenixHolding(null, []), null)
  // An order alone is shown.
  assert.ok(phoenixHolding(account({ collateralUsd: 0, positions: [], orders: [{ id: '1', symbol: 'SOL' }] }), []))
})

test("C4f: Portfolio's value counts the collateral on Phoenix, as the web's SOL-C6 — never a silent drop", () => {
  const ready = { status: 'success', account: account() }
  assert.deepEqual(valueWithPhoenix(100, ready, 101), { total: 107.287169, phoenixUsd: 7.287169, phoenix: 'counted' })
  // SOL posted counts at the wallet's SOL price; without one the part is not read.
  const sol = { status: 'success', account: account({ collateralSol: 0.5 }) }
  assert.ok(Math.abs(valueWithPhoenix(100, sol, 100).total - 157.287169) < 1e-9)
  assert.equal(valueWithPhoenix(100, sol, null).phoenix, 'unread')
  assert.equal(valueWithPhoenix(100, sol, null).total, 100)
  // Reading, failed, no account, no wallet.
  assert.deepEqual(valueWithPhoenix(100, { status: 'pending', account: undefined }, 101), {
    total: 100,
    phoenixUsd: null,
    phoenix: 'reading',
  })
  assert.equal(valueWithPhoenix(100, { status: 'error', account: undefined }, 101).phoenix, 'unread')
  assert.equal(valueWithPhoenix(100, { status: 'success', account: account({ state: 'none' }) }, 101).phoenix, 'none')
  assert.equal(valueWithPhoenix(100, null, 101).phoenix, 'none')
  // An account that did not state its dollars is not read, never $0.
  assert.equal(
    valueWithPhoenix(100, { status: 'success', account: account({ collateralUsd: null }) }, 101).phoenix,
    'unread',
  )
  // The wallet decides whether there is a number: none — none, and nothing said to be «in» it.
  assert.deepEqual(valueWithPhoenix(null, ready, 101), { total: null, phoenixUsd: null, phoenix: 'none' })
  // A failed refresh that keeps the last account still counts it.
  assert.equal(valueWithPhoenix(100, { status: 'error', account: account() }, 101).phoenix, 'counted')
  // An empty wallet with collateral: the collateral is the value.
  assert.equal(valueWithPhoenix(0, ready, 101).total, 7.287169)
})
