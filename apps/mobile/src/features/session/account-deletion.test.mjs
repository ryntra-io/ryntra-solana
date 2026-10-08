import assert from 'node:assert/strict'
import { test } from 'node:test'

import { accountDeletionMailto, SUPPORT_EMAIL } from './account-deletion.ts'

const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'

function read(url) {
  const [to, query] = url.slice('mailto:'.length).split('?')
  const params = new URLSearchParams(query)
  return { to, subject: params.get('subject'), body: params.get('body') }
}

test('the letter goes to the one inbox the privacy policy names, with the wallet the person signs in with', () => {
  const letter = read(accountDeletionMailto(WALLET, 'en'))
  assert.equal(letter.to, SUPPORT_EMAIL)
  assert.equal(letter.subject, 'Delete my Ryntra account data')
  assert.match(letter.body, new RegExp(`The wallet I sign in with: ${WALLET}`))
})

test('in Ukrainian the letter speaks Ukrainian', () => {
  const letter = read(accountDeletionMailto(WALLET, 'uk'))
  assert.equal(letter.subject, 'Видалити дані мого акаунта Ryntra')
  assert.match(letter.body, new RegExp(`Гаманець, яким я входжу: ${WALLET}`))
})

test('with no wallet connected the line asks the person to write it, never a made-up address', () => {
  assert.match(read(accountDeletionMailto(null, 'en')).body, /The wallet I sign in with: \(write its address here\)\n/)
  assert.match(read(accountDeletionMailto(null, 'uk')).body, /Гаманець, яким я входжу: \(впиши його адресу\)\n/)
})

test('spaces and line breaks are encoded for a mail app, never a raw «+»', () => {
  const url = accountDeletionMailto(WALLET, 'en')
  assert.ok(!url.includes(' '))
  assert.ok(!url.includes('+'))
  assert.ok(url.includes('%0A'))
})
