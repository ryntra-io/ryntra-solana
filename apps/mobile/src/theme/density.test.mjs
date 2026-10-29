import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_DENSITY, DENSITIES, isDensity, SPACE } from './density.ts'

test('the web’s two densities, regular by default', () => {
  assert.deepEqual(DENSITIES, ['regular', 'compact'])
  assert.equal(DEFAULT_DENSITY, 'regular')
  assert.equal(isDensity('compact'), true)
  assert.equal(isDensity('pro'), false)
})

test('every density names the same spacing, each a whole class name', () => {
  const shape = (space) => JSON.stringify(Object.keys(space)) + JSON.stringify(Object.keys(space.rhythm))
  assert.equal(shape(SPACE.compact), shape(SPACE.regular))
  for (const density of DENSITIES) {
    const space = SPACE[density]
    for (const name of [space.card, space.row, space.door, ...Object.values(space.rhythm)]) {
      assert.match(name, /^(gap|p|py)-[\d.]+$/)
    }
  }
})

test('compact is tighter than regular, never looser', () => {
  const size = (name) => Number(name.split('-')[1])
  const { regular, compact } = SPACE
  for (const key of ['card', 'row', 'door']) assert.ok(size(compact[key]) < size(regular[key]), key)
  for (const key of Object.keys(regular.rhythm)) assert.ok(size(compact.rhythm[key]) < size(regular.rhythm[key]), key)
})
