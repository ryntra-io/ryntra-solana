import assert from 'node:assert/strict'
import { test } from 'node:test'

import { redirectSystemPath } from '../monitoring/deep-link.ts'
import { quickActions } from './quick-actions.ts'

test('four doors, search first, in the language of the app', () => {
  assert.deepEqual(
    quickActions('uk').map((action) => action.title),
    ['Пошук', 'Ринки', 'Спитати Ryntra', 'Портфель'],
  )
  assert.deepEqual(
    quickActions('en').map((action) => action.title),
    ['Search', 'Markets', 'Ask Ryntra', 'Portfolio'],
  )
})

test("each door is one of the app's own places, as the link mapper leaves it", () => {
  for (const action of quickActions('en')) {
    assert.equal(redirectSystemPath({ path: action.params.href, initial: false }), action.params.href)
    assert.match(action.icon, /^shortcut_[a-z]+$/)
  }
})
