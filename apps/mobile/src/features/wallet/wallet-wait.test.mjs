import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { signInFailureLine, SIGNING_COPY } from './signing-copy.ts'
import {
  ledgerBlindSigning,
  ledgerCanSign,
  transactionVersion,
  waitForWallet,
  walletCancel,
  WALLET_WAIT_MS,
} from './wallet-wait.ts'

const code = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

/** One signature slot, then a message whose first byte is `first`. */
function wire(first) {
  const bytes = new Uint8Array(1 + 64 + 4)
  bytes[0] = 1
  bytes[65] = first
  return btoa(String.fromCharCode(...bytes))
}

test('the wallet’s wait is never cut before ninety seconds, ends on «Скасувати», and drops what comes after', async () => {
  assert.equal(WALLET_WAIT_MS, 90_000)
  const asked = []
  const never = () => new Promise(() => {})
  // A Review with ten seconds left still waits the full ninety for a Ledger.
  const timeout = await waitForWallet(never(), { waitMs: 10_000, sleep: async (ms) => void asked.push(ms) })
  assert.deepEqual(timeout, { kind: 'timeout' })
  assert.deepEqual(asked, [90_000])
  // A longer window is kept as it is.
  const longer = []
  await waitForWallet(never(), { waitMs: 120_000, sleep: async (ms) => void longer.push(ms) })
  assert.deepEqual(longer, [120_000])

  const cancel = walletCancel()
  const waiting = waitForWallet(never(), { sleep: never, cancel })
  cancel.cancel()
  assert.deepEqual(await waiting, { kind: 'cancelled' })
  // Already pressed when the wait begins: it ends at once, and the wallet's answer is never taken.
  assert.deepEqual(await waitForWallet(Promise.resolve('late'), { sleep: never, cancel }), { kind: 'cancelled' })

  assert.deepEqual(await waitForWallet(Promise.resolve('signed'), { sleep: never }), {
    kind: 'signed',
    value: 'signed',
  })
  await assert.rejects(waitForWallet(Promise.reject(new Error('declined')), { sleep: never }), /declined/)
  // A refusal after the wait ended has nobody to hear it, and is no unhandled rejection either.
  let refuse = () => undefined
  const late = new Promise((_, reject) => {
    refuse = () => reject(new Error('late'))
  })
  assert.deepEqual(await waitForWallet(late, { sleep: async () => undefined }), { kind: 'timeout' })
  refuse()
})

test('only bytes a Ledger can sign reach the wallet: legacy and v0, never a later version (PLAN §8)', () => {
  assert.equal(transactionVersion(wire(0x01)), 'legacy')
  assert.equal(transactionVersion(wire(0x80)), 0)
  assert.equal(transactionVersion(wire(0x81)), 1)
  assert.equal(ledgerCanSign(wire(0x01)), true)
  assert.equal(ledgerCanSign(wire(0x80)), true)
  assert.equal(ledgerCanSign(wire(0x81)), false)
  // A Transaction V1 wire (SIMD-0385) opens with its version byte and carries its signatures at the end.
  const v1 = btoa(String.fromCharCode(0x81, 1, 0, 0, 2, ...new Array(80).fill(7)))
  assert.equal(transactionVersion(v1), 1)
  assert.equal(ledgerCanSign(v1), false)
  // Bytes the phone cannot read go on to the wallet, which reads them itself.
  assert.equal(transactionVersion('not base64!'), null)
  assert.equal(ledgerCanSign('not base64!'), true)
})

test('Ledger’s 6808 (Blind signing off) is told apart from a refusal', () => {
  assert.equal(ledgerBlindSigning(new Error('Ledger device: UNKNOWN_ERROR (0x6808)')), true)
  assert.equal(ledgerBlindSigning(new Error('Please enable Blind signing in the Solana app')), true)
  assert.equal(ledgerBlindSigning(Object.assign(new Error('x'), { code: '6808' })), true)
  assert.equal(ledgerBlindSigning(Object.assign(new Error('x'), { code: 26632 })), true)
  assert.equal(ledgerBlindSigning(Object.assign(new Error('declined'), { code: -3 })), false)
  assert.equal(ledgerBlindSigning(new Error('Transaction 16808 failed')), false)
})

test('«Підпис і Ledger»: four short items in Settings, the detail behind «?», and a refused sign-in said in one sentence', () => {
  for (const locale of ['en', 'uk']) {
    const copy = SIGNING_COPY[locale]
    assert.equal(copy.lines.length, 4)
    assert.match(copy.lines[1].body, /90/)
    // One short line on the screen; the detail behind «?» keeps every fact.
    for (const line of copy.lines) assert.ok(line.line.length <= 60 && line.line.length < line.body.length, line.line)
    assert.match(copy.lines[2].body, /Blind signing/)
    assert.equal(copy.signInRefused.split(/(?<=[.!?])\s/).length, 1, 'one sentence')
  }
  assert.equal(SIGNING_COPY.uk.title, 'Підпис і Ledger')
  const refused = { kind: 'cancelled', step: 'sign', message: 'The wallet did not sign the sign-in…', hint: 'ledger' }
  assert.equal(signInFailureLine(refused, 'uk'), SIGNING_COPY.uk.signInRefused)
  const other = { kind: 'network', step: 'verify', message: 'Sign-in needs the network.' }
  assert.equal(signInFailureLine(other, 'uk'), 'Sign-in needs the network.')
  const settings = code('screens/settings/index.tsx')
  assert.match(settings, /label=\{signing\.title\}[\s\S]*?onPress=\{\(\) => router\.push\('\/signing'\)\}/)
  // No sign-in by a transaction is drawn while request 56 is open.
  assert.doesNotMatch(JSON.stringify(SIGNING_COPY), /by a transaction|транзакцією/)
})

test('every signature waits the same way: the Ledger line and «Скасувати» in the sheet, the transfer and the limit', () => {
  assert.match(
    code('screens/trade/index.tsx'),
    /<WaitBody sending=\{trade\.sending\} onCancel=\{trade\.cancelSigning\} \/>/,
  )
  assert.match(
    code('screens/money/send-parts.tsx'),
    /<WaitBody sending=\{phase === 'sending'\} onCancel=\{onCancelWait\} \/>/,
  )
  assert.match(code('screens/trade/limit-panel.tsx'), /<WaitBody sending=\{sent\} onCancel=\{onCancelWait\} \/>/)
  const parts = code('screens/trade/sheet-parts.tsx')
  assert.match(parts, /\{!sending && onCancel \? \(\s*<Button\s+title=\{words\.cancelWait\}[\s\S]*?size="lg"/)
})
