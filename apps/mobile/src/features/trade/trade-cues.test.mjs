import assert from 'node:assert/strict'
import { test } from 'node:test'

import { failureCue, settlementCue } from './trade-cues.ts'

const settlement = (state, observation = null) => ({
  state,
  signature: '5x',
  observation,
  facts: null,
  receipt: null,
})

test('a filled operation feels like success; one still on its way, a firm tap', () => {
  assert.equal(settlementCue(settlement('MATCHED')), 'done')
  assert.equal(settlementCue(settlement('RECOVERED', { actualInputRaw: '1', actualOutputRaw: '2' })), 'done')
  assert.equal(settlementCue(settlement('SUBMITTED_UNKNOWN')), 'sent')
})

test('nothing moved, or not filled, feels like an error', () => {
  assert.equal(settlementCue(settlement('EXPIRED_BEFORE_SUBMIT')), 'failed')
  assert.equal(settlementCue(settlement('EXPIRED_AFTER_SUBMIT')), 'failed')
  assert.equal(settlementCue(settlement('FAILED_ON_CHAIN')), 'failed')
})

test("the wallet's own «no» is a warning; any other refusal, an error", () => {
  assert.equal(failureCue('WALLET_REFUSED'), 'declined')
  assert.equal(failureCue('USER_REJECTED'), 'declined')
  assert.equal(failureCue('NETWORK'), 'failed')
  assert.equal(failureCue('INSUFFICIENT_BALANCE'), 'failed')
})
