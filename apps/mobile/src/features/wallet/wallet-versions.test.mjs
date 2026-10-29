import assert from 'node:assert/strict'
import { test } from 'node:test'

import { forgetSignsV1, rememberSignsV1, signsV1Known, signsV1Of } from './wallet-versions.ts'

test('a wallet signs v1 only when its capabilities name version 1', () => {
  assert.equal(signsV1Of({ supported_transaction_versions: ['legacy', 0, 1] }), true)
  assert.equal(signsV1Of({ supported_transaction_versions: ['legacy', 0] }), false)
  assert.equal(signsV1Of({ supported_transaction_versions: [] }), false)
  assert.equal(signsV1Of({}), false)
  assert.equal(signsV1Of(null), false)
})

test('unknown until asked, kept, and forgotten with the wallet', () => {
  forgetSignsV1()
  assert.equal(signsV1Known(), null)
  rememberSignsV1(false)
  assert.equal(signsV1Known(), false)
  rememberSignsV1(true)
  assert.equal(signsV1Known(), true)
  forgetSignsV1()
  assert.equal(signsV1Known(), null)
})
