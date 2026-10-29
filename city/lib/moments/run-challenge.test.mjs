// Run from repo root: node --test "city/lib/moments/*.test.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The run store logs to /api/run and keeps bests in localStorage: both stand in here.
const kept = new Map();
globalThis.localStorage = {
  get length() {
    return kept.size;
  },
  key: (i) => [...kept.keys()][i] ?? null,
  getItem: (k) => (kept.has(k) ? kept.get(k) : null),
  setItem: (k, v) => kept.set(k, String(v)),
  removeItem: (k) => kept.delete(k),
};
globalThis.fetch = async () => new Response(null, { status: 204 });

const { useCity } = await import('../city/store.ts');
const { useRun } = await import('../run/store.ts');
const { dayKey } = await import('../run/world.ts');

const city = JSON.parse(readFileSync(new URL('../market/snapshot.json', import.meta.url), 'utf8'));
// The challenger's world: the same city read at another time, its towers a little taller.
const theirs = { ...city, fetchedAt: '2026-10-25T08:00:00.000Z', source: 'live', towers: city.towers.map((t) => ({ ...t, mcap: t.mcap * 1.3 })) };
const ghost = (seconds) => new Float32Array(Math.round(seconds * 60) * 4);
const finish = (t) => ({ status: 'finished', t, s: useRun.getState().course.finishS, reason: '', node: 'none', routes: [], hits: 0 });

function reset(challenge) {
  kept.clear();
  useCity.getState().setSnapshot(city);
  useRun.setState({ phase: 'off', challenge, best: null, own: null, last: null, result: null, course: null, world: null, attempt: 0 });
}

test('without a challenge the run is in today’s frozen city, with no ghost to chase', () => {
  reset(null);
  useRun.getState().start('home');
  const s = useRun.getState();
  assert.equal(s.course.day, dayKey());
  assert.equal(s.world, city);
  assert.equal(s.best, null);
});

test('a full challenge runs in the challenger’s city on their day, and their run is the ghost', () => {
  reset({ beat: 40, form: 'flight', day: '2026-10-25', world: theirs, ghost: ghost(40) });
  useRun.getState().start('home');
  let s = useRun.getState();
  assert.equal(s.form, 'flight');
  assert.equal(s.course.day, '2026-10-25');
  assert.ok(s.course.id.startsWith('2026-10-25:flight:'));
  assert.equal(s.world, theirs);
  assert.equal(s.best.time, 40, 'the challenger’s run flies with you');
  assert.equal(s.own, null);

  // Slower than the challenge: still your first finish on this course, and the gap to beat.
  s.complete(finish(41.2), ghost(41.2));
  s = useRun.getState();
  assert.equal(s.result.newBest, true);
  assert.equal(s.result.toBeat, 1.2);
  assert.equal(s.result.toBest, null);
  assert.equal(s.own.time, 41.2);
  assert.equal(s.best.time, 40, 'the faster ghost stays the challenger’s');
  assert.equal(s.last.time, 41.2);

  // Run again: your best on a past day's course lives in memory; then you beat them.
  s.showResult();
  useRun.getState().start('result');
  assert.equal(useRun.getState().own.time, 41.2);
  useRun.getState().complete(finish(39), ghost(39));
  s = useRun.getState();
  assert.equal(s.result.toBeat, -1);
  assert.equal(s.result.toBest, -2.2);
  assert.equal(s.best.time, 39, 'now the ghost to chase is yours');
  assert.equal(s.last.time, 39);
});

test('an old link (time and form only) keeps the visitor’s own city and day, and still counts the gap', () => {
  reset({ beat: 31.4, form: 'roofs' });
  useRun.getState().start('home');
  let s = useRun.getState();
  assert.equal(s.form, 'roofs');
  assert.equal(s.course.day, dayKey());
  assert.equal(s.world, city);
  assert.equal(s.best, null, 'no ghost without the challenger’s world');
  s.complete(finish(30), ghost(30));
  s = useRun.getState();
  assert.equal(s.result.toBeat, -1.4);
});

test('a crash beats nothing and leaves the last finished run for the link', () => {
  reset({ beat: 40, form: 'flight', day: '2026-10-25', world: theirs, ghost: ghost(40) });
  useRun.getState().start('home');
  useRun.getState().complete(finish(42), ghost(42));
  useRun.getState().showResult();
  useRun.getState().start('result');
  useRun.getState().complete({ ...finish(12), status: 'crashed', reason: 'a beam' }, ghost(12));
  const s = useRun.getState();
  assert.equal(s.result.status, 'crash');
  assert.equal(s.result.toBeat, null);
  assert.equal(s.last.time, 42);
});
