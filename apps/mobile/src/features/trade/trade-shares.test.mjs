import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PAY_SHARES_PCT, shareOfRaw, unitsForField } from './trade-model.ts'

test('the quick shares are 25 · 50 · 75 · 100 % of what the wallet can spend, rounded down — never more', () => {
  assert.deepEqual([...PAY_SHARES_PCT], [25, 50, 75, 100])
  assert.equal(shareOfRaw('1000000', 25), '250000')
  assert.equal(shareOfRaw('1000000', 100), '1000000')
  // An odd amount rounds down: three quarters of 7 units is 5, not 6.
  assert.equal(shareOfRaw('7', 75), '5')
  assert.equal(shareOfRaw('0', 50), '0')
  // Not a whole raw amount: no share is offered.
  assert.equal(shareOfRaw('', 50), null)
  assert.equal(shareOfRaw('1.5', 50), null)
  // What the field shows: 12.5 USDC as typed, without grouping.
  assert.equal(unitsForField(shareOfRaw('50000000', 25), 6, 'en'), '12.5')
  assert.equal(unitsForField(shareOfRaw('5000000000', 50), 6, 'uk'), '2500')
})
