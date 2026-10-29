import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RETRY_AFTER_MAX_SECONDS, retryAfterSecondsOf } from './api.ts'

const headersOf = (entries) => {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name) => map.get(name.toLowerCase()) ?? null }
}
const NOW = Date.parse('2026-10-19T12:00:00Z')

test('Retry-After in seconds is the wait, rounded up and capped at a minute', () => {
  assert.equal(retryAfterSecondsOf(headersOf({ 'Retry-After': '7' }), NOW), 7)
  assert.equal(retryAfterSecondsOf(headersOf({ 'Retry-After': '1.2' }), NOW), 2)
  assert.equal(retryAfterSecondsOf(headersOf({ 'Retry-After': '0' }), NOW), 0)
  assert.equal(retryAfterSecondsOf(headersOf({ 'Retry-After': '3600' }), NOW), RETRY_AFTER_MAX_SECONDS)
  assert.equal(RETRY_AFTER_MAX_SECONDS, 60)
})

test('Retry-After as an HTTP date is the time until then; a past date is no wait', () => {
  assert.equal(retryAfterSecondsOf(headersOf({ 'Retry-After': 'Mon, 19 Oct 2026 12:00:12 GMT' }), NOW), 12)
  assert.equal(retryAfterSecondsOf(headersOf({ 'Retry-After': 'Mon, 19 Oct 2026 11:59:00 GMT' }), NOW), 0)
})

test('without Retry-After the Ratelimit-Reset is read: a delay, or a Unix time', () => {
  assert.equal(retryAfterSecondsOf(headersOf({ 'Ratelimit-Reset': '23' }), NOW), 23)
  assert.equal(retryAfterSecondsOf(headersOf({ 'RateLimit-Reset': String(NOW / 1000 + 9) }), NOW), 9)
  assert.equal(retryAfterSecondsOf(headersOf({ 'Retry-After': '4', 'Ratelimit-Reset': '40' }), NOW), 4)
  assert.equal(retryAfterSecondsOf(headersOf({ 'Retry-After': 'soon', 'Ratelimit-Reset': '40' }), NOW), 40)
})

test('no wait named, or nothing readable, is null', () => {
  assert.equal(retryAfterSecondsOf(headersOf({}), NOW), null)
  assert.equal(retryAfterSecondsOf(null, NOW), null)
  assert.equal(retryAfterSecondsOf(headersOf({ 'Retry-After': '', 'Ratelimit-Reset': 'later' }), NOW), null)
  assert.equal(retryAfterSecondsOf(headersOf({ 'Ratelimit-Reset': 'Mon, 19 Oct 2026 12:00:12 GMT' }), NOW), null)
})
