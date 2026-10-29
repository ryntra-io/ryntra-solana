import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BYTES_LIFE_MS,
  MAX_SIGNABLE_MS,
  MIN_WALLET_WINDOW_MS,
  SUBMIT_MARGIN_MS,
  afterLateAnswer,
  mayOpenWallet,
  msUntilBytesDie,
  signableMsOf,
  signableWindowClosed,
} from './bytes-life.ts'

test('bytes live 150 blocks × 200 ms; the window keeps a margin to land', () => {
  assert.equal(BYTES_LIFE_MS, 30_000)
  assert.equal(MAX_SIGNABLE_MS, BYTES_LIFE_MS - SUBMIT_MARGIN_MS)
  assert.equal(signableMsOf(undefined), MAX_SIGNABLE_MS)
  assert.equal(signableMsOf(18_000), 18_000)
  assert.equal(signableMsOf(-1), MAX_SIGNABLE_MS)
})

test('the wallet opens only with its window left, counted from arrival', () => {
  assert.equal(mayOpenWallet({ receivedAtMs: 0, signableMs: 25_000, nowMs: 15_000 }), true)
  assert.equal(mayOpenWallet({ receivedAtMs: 0, signableMs: 25_000, nowMs: 15_001 }), false)
  assert.equal(mayOpenWallet({ receivedAtMs: 0, signableMs: Number.NaN, nowMs: 0 }), false)
  assert.ok(MIN_WALLET_WINDOW_MS < MAX_SIGNABLE_MS)
})

for (const seconds of [25, 30, 40, 60, 90]) {
  test(`a signature back after ${seconds} s is past the window and never sent`, () => {
    assert.equal(signableWindowClosed({ receivedAtMs: 0, signableMs: 25_000, nowMs: seconds * 1_000 }), true)
  })
}

test('the chain is asked only once the bytes should be dead', () => {
  assert.equal(msUntilBytesDie({ receivedAtMs: 0, signableMs: 20_000, nowMs: 10_000 }), 15_000)
  assert.equal(msUntilBytesDie({ receivedAtMs: 0, signableMs: 20_000, nowMs: 60_000 }), 0)
})

test('one rebuild by itself, then the person is told', () => {
  assert.equal(afterLateAnswer(1), 'rebuild')
  assert.equal(afterLateAnswer(2), 'tell')
})
