import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  arrangeable,
  availableBlocks,
  DEFAULT_LAYOUT,
  HOME_BLOCKS,
  isDefaultLayout,
  moveBlock,
  parseLayout,
  serializeLayout,
  shownBlocks,
  toggleBlock,
} from './home-blocks.ts'

const ALL = new Set(HOME_BLOCKS)
const GUEST = new Set(['favourites'])
const ids = (layout) => layout.map((block) => block.id)

test('a new Home draws the prototype’s Обране · Мої ринки · Останнє and nothing else', () => {
  assert.deepEqual(parseLayout(undefined), DEFAULT_LAYOUT)
  assert.deepEqual(parseLayout(''), DEFAULT_LAYOUT)
  assert.deepEqual(shownBlocks(DEFAULT_LAYOUT, ALL), ['favourites', 'myMarkets', 'recent'])
  assert.equal(isDefaultLayout(DEFAULT_LAYOUT), true)
})

test('a layout survives its own round trip', () => {
  const layout = toggleBlock(moveBlock(DEFAULT_LAYOUT, 'recent', -1), 'favourites', false)
  assert.equal(serializeLayout(layout), '!favourites,recent,myMarkets')
  assert.deepEqual(parseLayout(serializeLayout(layout)), layout)
  assert.equal(isDefaultLayout(layout), false)
})

test('a stored layout is read leniently: unknown names dropped, repeats once, a new block joins on', () => {
  assert.deepEqual(parseLayout('pulse, !recent,recent,!favourites'), [
    { id: 'recent', on: false },
    { id: 'favourites', on: false },
    { id: 'myMarkets', on: true },
  ])
})

test('a layout stored with C2’s recurring buys and companies keeps its own choices; those two leave Home', () => {
  // The recurring buys live in «Боти», the popular companies in «Що купити» (the operator’s word of 2026-10-17).
  assert.deepEqual(parseLayout('popular,!autoinvest'), DEFAULT_LAYOUT)
  assert.deepEqual(parseLayout('recent,!popular,favourites,autoinvest'), [
    { id: 'recent', on: true },
    { id: 'favourites', on: true },
    { id: 'myMarkets', on: true },
  ])
})

test('a block switched off is not drawn, and keeps its place', () => {
  const layout = toggleBlock(DEFAULT_LAYOUT, 'recent', false)
  assert.deepEqual(shownBlocks(layout, ALL), ['favourites', 'myMarkets'])
  assert.deepEqual(ids(toggleBlock(layout, 'recent', true)), HOME_BLOCKS)
})

test('a block moves one step among the visible ones; at the end nothing moves', () => {
  const down = moveBlock(DEFAULT_LAYOUT, 'favourites', 1)
  assert.deepEqual(ids(down), ['myMarkets', 'favourites', 'recent'])
  assert.equal(moveBlock(DEFAULT_LAYOUT, 'recent', 1), DEFAULT_LAYOUT)
  assert.equal(moveBlock(DEFAULT_LAYOUT, 'favourites', -1), DEFAULT_LAYOUT)
})

test('a guest arranges only what a guest sees; the wallet’s blocks keep their places', () => {
  assert.deepEqual(ids(arrangeable(DEFAULT_LAYOUT, GUEST)), ['favourites'])
  assert.deepEqual(shownBlocks(DEFAULT_LAYOUT, GUEST), ['favourites'])
  assert.equal(moveBlock(DEFAULT_LAYOUT, 'favourites', 1, GUEST), DEFAULT_LAYOUT)
})

test('a wallet’s launches and operations need a wallet; the favourites are everyone’s', () => {
  assert.deepEqual([...availableBlocks(false)], ['favourites'])
  assert.deepEqual([...availableBlocks(true)], HOME_BLOCKS)
})

test('the default order is judged on what the person sees', () => {
  const moved = moveBlock(DEFAULT_LAYOUT, 'recent', -1)
  assert.equal(isDefaultLayout(moved), false)
  // A guest sees neither block that moved.
  assert.equal(isDefaultLayout(moved, GUEST), true)
})
