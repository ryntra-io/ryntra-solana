import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_LOCALE_PREFERENCE, LOCALE_PREFERENCES, resolveLocale } from './locale.ts'

test('the phone opens in English until the person chooses, whatever the system speaks', () => {
  assert.equal(DEFAULT_LOCALE_PREFERENCE, 'en')
  assert.equal(resolveLocale(DEFAULT_LOCALE_PREFERENCE, 'uk'), 'en')
  assert.equal(resolveLocale(DEFAULT_LOCALE_PREFERENCE, 'en'), 'en')
})

test('Ukrainian and the system language stay choices in More', () => {
  assert.deepEqual([...LOCALE_PREFERENCES], ['en', 'uk', 'system'])
  assert.equal(resolveLocale('uk', 'en'), 'uk')
  assert.equal(resolveLocale('en', 'uk'), 'en')
  assert.equal(resolveLocale('system', 'uk'), 'uk')
  assert.equal(resolveLocale('system', 'en'), 'en')
})
