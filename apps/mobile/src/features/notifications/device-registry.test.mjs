import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  describeDevice,
  OnceSet,
  phoneState,
  recordFor,
  recordOf,
  REFRESH_AFTER_MS,
  registrationNeeded,
  registrationOf,
} from './device-registry.ts'

const NOW = Date.parse('2026-09-21T20:00:00.000Z')
const TOKEN = 'fcm-token-0123456789abcdef0123456789abcdef'
const ADDRESS = 'Cttqcn7SsFjg1D8qLtHBjBAoxg6wfhzMRf9E5fcb6JLG'
const OTHER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'

const quiet = { start: '22:00', end: '07:00', timezone: 'Europe/Kyiv' }

const record = (over = {}) => ({
  address: ADDRESS,
  deviceId: 'dev_004eced36a985574a0f28fc4',
  token: TOKEN,
  appVersion: '1.3.0',
  locale: 'uk',
  categories: ['plan'],
  quietHours: quiet,
  registeredAt: '2026-09-21T19:42:44.190Z',
  refreshedAt: '2026-09-21T19:42:44.190Z',
  ...over,
})

const input = (over = {}) => ({
  address: ADDRESS,
  token: TOKEN,
  appVersion: '1.3.0',
  locale: 'uk',
  quietHours: quiet,
  record: record(),
  now: NOW,
  ...over,
})

test("the registration says every field the contract's strict schema wants, and only those", () => {
  assert.deepEqual(registrationOf({ token: TOKEN, appVersion: '1.3.0', locale: 'en', quietHours: null }), {
    platform: 'android',
    token: TOKEN,
    appVersion: '1.3.0',
    locale: 'en',
    categories: ['plan'],
    quietHours: null,
  })
})

test('no token, no registration; no record, a first registration', () => {
  assert.equal(registrationNeeded(input({ token: null })), null)
  assert.equal(registrationNeeded(input({ token: null, record: null })), null)
  assert.deepEqual(
    registrationNeeded(input({ record: null })),
    registrationOf({ token: TOKEN, appVersion: '1.3.0', locale: 'uk', quietHours: quiet }),
  )
})

test('a record that says what the server holds is left alone until a day passed', () => {
  assert.equal(registrationNeeded(input()), null)
  assert.notEqual(registrationNeeded(input({ now: NOW + REFRESH_AFTER_MS })), null)
  assert.notEqual(registrationNeeded(input({ record: record({ refreshedAt: 'not a date' }) })), null)
})

test('a rotated token, another version, language or quiet hours re-register the same phone', () => {
  assert.equal(
    registrationNeeded(input({ token: 'rotated-token-0123456789abcdef' }))?.token,
    'rotated-token-0123456789abcdef',
  )
  assert.equal(registrationNeeded(input({ appVersion: '1.4.0' }))?.appVersion, '1.4.0')
  assert.equal(registrationNeeded(input({ locale: 'en' }))?.locale, 'en')
  assert.deepEqual(registrationNeeded(input({ quietHours: null }))?.quietHours, null)
  assert.deepEqual(registrationNeeded(input({ quietHours: { ...quiet, end: '08:00' } }))?.quietHours, {
    ...quiet,
    end: '08:00',
  })
  assert.deepEqual(registrationNeeded(input({ record: record({ categories: ['plan', 'system'] }) }))?.categories, [
    'plan',
  ])
})

test("another wallet's record is never this wallet's: it registers afresh and is never handed out", () => {
  assert.notEqual(registrationNeeded(input({ record: record({ address: OTHER }) })), null)
  assert.equal(recordFor(record({ address: OTHER }), ADDRESS), null)
  assert.equal(recordFor(record(), ADDRESS)?.deviceId, 'dev_004eced36a985574a0f28fc4')
  assert.equal(recordFor(record(), null), null)
})

test("the record after the server's answer carries its id and time, and a description never carries the token", () => {
  const registration = registrationOf({ token: TOKEN, appVersion: '1.3.0', locale: 'uk', quietHours: quiet })
  const kept = recordOf(
    registration,
    { deviceId: 'dev_004eced36a985574a0f28fc4', registeredAt: '2026-09-21T19:42:44.190Z' },
    ADDRESS,
    NOW,
  )
  assert.equal(kept.deviceId, 'dev_004eced36a985574a0f28fc4')
  assert.equal(kept.refreshedAt, '2026-09-21T20:00:00.000Z')
  assert.equal(kept.token, TOKEN)
  assert.equal(describeDevice(kept).includes(TOKEN), false)
  assert.equal(describeDevice(null), 'no device')
})

test('a tap is taken once, however many times the same response arrives', () => {
  const once = new OnceSet(2)
  assert.equal(once.take('a'), true)
  assert.equal(once.take('a'), false)
  assert.equal(once.take('b'), true)
  assert.equal(once.take('c'), true)
  // The oldest is forgotten past the limit; the recent ones are still held.
  assert.equal(once.take('b'), false)
  assert.equal(once.take('c'), false)
})

test('the phone state says why notes do or do not reach it', () => {
  assert.equal(phoneState({ record: record(), permission: 'granted', tokenAvailable: true, serverPush: true }), 'on')
  assert.equal(phoneState({ record: null, permission: 'granted', tokenAvailable: true, serverPush: true }), 'off')
  assert.equal(
    phoneState({ record: record(), permission: 'denied', tokenAvailable: true, serverPush: true }),
    'off_permission',
  )
  assert.equal(
    phoneState({ record: null, permission: 'undetermined', tokenAvailable: false, serverPush: true }),
    'off_no_config',
  )
  assert.equal(
    phoneState({ record: record(), permission: 'granted', tokenAvailable: true, serverPush: false }),
    'off_web',
  )
  assert.equal(phoneState({ record: record(), permission: null, tokenAvailable: null, serverPush: null }), 'unknown')
})
