import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { hallSignsPlan, ledBoards, MASTS, SIGN } from './hall-signs.ts';

/*
 * CITY-241: the Hall of Fame in the city carries no empty sign and no bare mast. A sign stands only on a board with a
 * leader and shows the leader's number; a mast stands only under a sign, as tall as its top sign; the empty board's one
 * action stays in the Hall's panel.
 */

const row = { place: 1, coin: { symbol: 'BONK' }, figure: { kind: 'multiple', tenths: 34 } };
const board = (state, rows = [], span = 'week') => ({ state, span, rows, period: { from: '', to: '' }, left: {} });
const view = (boards) => ({
  boards: {
    catch: board('empty', [], 'all'),
    hunters: board('empty', [], 'all'),
    creators: board('empty', [], 'all'),
    scouts: board('no_source'),
    ...boards,
  },
});

test('nobody on any board: no sign and no mast', () => {
  const plan = hallSignsPlan(view({}));
  assert.deepEqual(plan.signs, []);
  assert.deepEqual(plan.masts, []);
});

test('a board with a leader gets its sign, and only its mast stands — as tall as that sign', () => {
  const plan = hallSignsPlan(view({ hunters: board('live', [row]) }));
  assert.deepEqual(plan.signs.map((s) => s.board), ['hunters']);
  assert.equal(plan.masts.length, 1);
  assert.equal(plan.masts[0].x, MASTS[1]);
  const sign = plan.signs[0];
  assert.ok(plan.masts[0].top > sign.y + SIGN.h / 2, 'the mast reaches over its sign');
  assert.ok(plan.masts[0].top <= sign.y + SIGN.h / 2 + 1.5, 'and no further than a cap');
});

test('a lower sign alone: the mast ends just over it, no steel standing above', () => {
  const plan = hallSignsPlan(view({ creators: board('live', [row], 'month') }));
  assert.deepEqual(plan.signs.map((s) => s.board), ['creators']);
  assert.deepEqual(plan.masts.map((m) => m.x), [MASTS[0]]);
  assert.equal(plan.masts[0].top, plan.signs[0].y + SIGN.h / 2 + 1, 'a cap over the lower sign, not up to the upper one');
});

test('a board without a public source never has a sign, even with rows', () => {
  assert.deepEqual(ledBoards(view({ scouts: board('no_source', [row]) })), []);
});

test('the scene draws the plan: no «Launch yours» sign, no empty words, no mast of its own', () => {
  const scene = readFileSync(new URL('../../components/launch/HallSigns.tsx', import.meta.url), 'utf8');
  assert.match(scene, /hallSignsPlan\(view\)/);
  assert.doesNotMatch(scene, /launchYours|emptyShort/);
  assert.doesNotMatch(scene, /MAST\.top|TOWERS\.map/);
});
