import assert from 'node:assert/strict'
import { test } from 'node:test'

import { boardOf, EDGE, freshAim, liftAim } from './lift-geometry.ts'

test('the keyboard’s edge is the one the event gives — its height alone leaves out the navigation bar', () => {
  // A 890-high screen, a 300-high keyboard over a 48-high three-button bar: the edge at 542, not at 590.
  assert.deepEqual(boardOf(542, 300, 890), { top: 542, room: 348 })
  // No edge given: the height stands in.
  assert.deepEqual(boardOf(0, 300, 890), { top: 590, room: 300 })
})

test('the page scrolls so the button clears the keyboard, to an absolute place, never hiding the field', () => {
  const at = { offset: 0, frameTop: 100, keyboardTop: 542, topY: 400, bottomY: 700, bottomHeight: 52 }
  // The button's foot at 752 in the page, 442 seen above the keyboard from the frame's top: 752 + 12 − 442.
  assert.equal(liftAim(at), 752 + EDGE - 442)
  // A second look while the first scroll runs aims at the same place.
  assert.equal(liftAim({ ...at, offset: 150 }), 752 + EDGE - 442)
  // Already clear: nothing to do.
  assert.equal(liftAim({ ...at, offset: 322 }), null)
  // Too short for both: the field stays at the frame's top, the rest is the person's scroll.
  assert.equal(liftAim({ ...at, topY: 200 }), 200 - EDGE)
})

test('a scroll the page could not finish is sent again — only the very place already sent to is skipped (ST-5 r7)', () => {
  const at = { offset: 0, frameTop: 100, keyboardTop: 542, topY: 400, bottomY: 700, bottomHeight: 52 }
  const aim = liftAim(at)
  // Nothing sent yet: the aim stands.
  assert.equal(freshAim(aim, null), aim)
  // Sent, and the scroll still runs (the page reads an offset short of it): not started again.
  assert.equal(freshAim(liftAim({ ...at, offset: 150 }), aim), null)
  // The first focus: the page's end had not yet grown by the keyboard's room, the scroll stopped short and the place
  // sent was forgotten when the page grew — the same aim is sent again rather than taken as done.
  assert.equal(freshAim(liftAim({ ...at, offset: 120 }), null), aim)
  // A taller keyboard (a suggestion strip) moves the aim: sent again.
  assert.equal(freshAim(liftAim({ ...at, keyboardTop: 500 }), aim), aim + 42)
  // Already clear: nothing to do.
  assert.equal(freshAim(liftAim({ ...at, offset: 322 }), null), null)
})
