import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  base64ToBytes,
  bytesToBase64,
  signedWhatWasIssued,
  signInPayloadFrom,
  siwsMessageText,
  textBytes,
  verifyBodyFrom,
  walletBytes,
} from './siws.ts'

const ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const input = {
  domain: 'ryntra.io',
  address: ADDRESS,
  statement: 'Confirm sign-in to Ryntra. This message does not move funds or allow trading on your behalf.',
  uri: 'https://ryntra.io',
  version: '1',
  chainId: 'solana:mainnet',
  nonce: 'abc123DEF',
  issuedAt: '2026-09-15T09:00:00.000Z',
  expirationTime: '2026-09-15T09:05:00.000Z',
}

test('the message text is the web format, line for line', () => {
  assert.equal(
    siwsMessageText(input),
    [
      'ryntra.io wants you to sign in with your Solana account:',
      ADDRESS,
      '',
      input.statement,
      '',
      'URI: https://ryntra.io',
      'Version: 1',
      'Chain ID: solana:mainnet',
      'Nonce: abc123DEF',
      'Issued At: 2026-09-15T09:00:00.000Z',
      'Expiration Time: 2026-09-15T09:05:00.000Z',
    ].join('\n'),
  )
})

test('the sign-in payload carries the server fields and nothing else', () => {
  assert.deepEqual(Object.keys(signInPayloadFrom(input)).sort(), [
    'address',
    'chainId',
    'domain',
    'expirationTime',
    'issuedAt',
    'nonce',
    'statement',
    'uri',
    'version',
  ])
  assert.equal(signInPayloadFrom(input).nonce, 'abc123DEF')
})

test('only the issued text counts as signed', () => {
  assert.equal(signedWhatWasIssued(textBytes(siwsMessageText(input)), input), true)
  assert.equal(signedWhatWasIssued(textBytes(siwsMessageText({ ...input, nonce: 'other' })), input), false)
  assert.equal(signedWhatWasIssued(new Uint8Array([0xff, 0xfe]), input), false)
})

test('base64 matches the standard alphabet with padding', () => {
  assert.equal(bytesToBase64(new Uint8Array([])), '')
  assert.equal(bytesToBase64(textBytes('f')), 'Zg==')
  assert.equal(bytesToBase64(textBytes('fo')), 'Zm8=')
  assert.equal(bytesToBase64(textBytes('foo')), 'Zm9v')
  assert.equal(bytesToBase64(textBytes('foobar')), 'Zm9vYmFy')
  assert.equal(bytesToBase64(new Uint8Array([0xfb, 0xff, 0xbf])), '+/+/')
})

test('the verify body needs a 64-byte signature and a non-empty message', () => {
  const signature = new Uint8Array(64).fill(7)
  const body = verifyBodyFrom({ address: ADDRESS, signedMessage: textBytes('hello'), signature })
  assert.ok(body)
  assert.deepEqual(
    Object.keys(body).sort(),
    ['address', 'signature', 'signedMessage'],
    'the client adds the identity; nothing else is sent',
  )
  assert.equal(body.address, ADDRESS)
  assert.equal(body.signedMessage, 'aGVsbG8=')
  assert.equal(body.signature.length, 88)
  assert.equal(
    verifyBodyFrom({ address: ADDRESS, signedMessage: textBytes('hello'), signature: new Uint8Array(63) }),
    null,
  )
  assert.equal(verifyBodyFrom({ address: ADDRESS, signedMessage: new Uint8Array(0), signature }), null)
})

test("base64 decodes back to the same bytes; the adapter's base64-as-bytes is unwrapped, raw bytes pass through", () => {
  const raw = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 10, 32, 61])
  assert.deepEqual(base64ToBytes(bytesToBase64(raw)), raw)
  assert.deepEqual(base64ToBytes(bytesToBase64(raw).replace(/=+$/, '')), raw)
  assert.equal(base64ToBytes('not base64!'), null)
  assert.equal(base64ToBytes(''), null)
  const message = textBytes(siwsMessageText(input))
  assert.deepEqual(walletBytes(message), message, 'a signed-in message is never mistaken for base64')
  assert.deepEqual(
    walletBytes(textBytes(bytesToBase64(message))),
    message,
    'the base64 text of the message is unwrapped',
  )
  const signature = new Uint8Array(64).fill(9)
  assert.deepEqual(walletBytes(textBytes(bytesToBase64(signature))), signature)
  assert.equal(walletBytes(textBytes(bytesToBase64(signature))).length, 64)
  // URL-safe and unpadded base64, as some wallets answer, unwrap the same.
  const urlSafe = (bytes) => bytesToBase64(bytes).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, '')
  const odd = new Uint8Array([251, 255, 254, 253, 62, 63, 1])
  assert.deepEqual(base64ToBytes(urlSafe(odd)), odd)
  assert.deepEqual(walletBytes(textBytes(urlSafe(message))), message)
  assert.deepEqual(walletBytes(textBytes(urlSafe(signature))), signature)
})
