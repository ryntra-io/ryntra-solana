import assert from 'node:assert/strict';
import test from 'node:test';

import { deadline, inTime, KeptWork } from './hall-guard.ts';

/*
 * The Hall's guard keeps one Hall's work inside the function's minute: one budget for all of it, one work in flight,
 * the last whole Hall standing (marked) when the engine fails, and a pause before asking a down engine again.
 */

const never = () => new Promise(() => undefined);
const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test('a read past its time answers null and does not wait for the work', async () => {
  const started = Date.now();
  assert.equal(await inTime(never(), 20), null);
  assert.ok(Date.now() - started < 1_000);
  assert.equal(await inTime(Promise.resolve(7), 20), 7);
  assert.equal(await inTime(Promise.resolve(7), 0), null, 'no time left reads nothing');
});

test('one budget bounds every read: what is left of it, never more than its own cap', async () => {
  let clock = 1_000;
  const budget = deadline(45_000, () => clock);
  assert.equal(budget.left(), 45_000);
  clock += 44_990;
  assert.equal(budget.left(), 10);
  assert.equal(await budget.within(never(), 12_000), null, 'the read waits only the 10 ms left');
  clock += 20;
  assert.equal(budget.over(), true);
  assert.equal(await budget.within(Promise.resolve('late'), 12_000), null, 'past the budget nothing is read');
});

const options = (work, extra = {}) => ({ keepMs: 1_000, pauseMs: 5_000, answerMs: 200, failCode: 'UNAVAILABLE', work, ...extra });

test('one work in flight: every ask at once shares it', async () => {
  let runs = 0;
  const guard = new KeptWork(options(async () => (runs++, later(20, { ok: true, view: 'hall', partial: false }))));
  const answers = await Promise.all([guard.refresh(0), guard.refresh(0), guard.read(0, () => undefined)]);
  assert.equal(runs, 1);
  for (const answer of answers) assert.deepEqual(answer, { ok: true, view: 'hall', mark: 'fresh' });
});

test('a work cut by its budget is marked partial; an older Hall standing in is marked stale', async () => {
  let next = { ok: true, view: 'cut', partial: true };
  const guard = new KeptWork(options(async () => next));
  assert.deepEqual(await guard.refresh(0), { ok: true, view: 'cut', mark: 'partial' });
  assert.deepEqual(await guard.read(500, () => undefined), { ok: true, view: 'cut', mark: 'partial' });
  next = { ok: false, code: 'UNAVAILABLE' };
  assert.deepEqual(await guard.refresh(2_000), { ok: true, view: 'cut', mark: 'stale' }, 'the engine down: the last Hall stands, marked');
});

test('after a failure the engine is not asked again until the pause is over', async () => {
  let runs = 0;
  const guard = new KeptWork(options(async () => (runs++, { ok: false, code: 'UNAVAILABLE' })));
  assert.deepEqual(await guard.refresh(0), { ok: false, code: 'UNAVAILABLE' });
  assert.deepEqual(await guard.refresh(1_000), { ok: false, code: 'UNAVAILABLE' });
  assert.deepEqual(await guard.read(4_999, () => assert.fail('no work behind during the pause')), { ok: false, code: 'UNAVAILABLE' });
  assert.equal(runs, 1);
  await guard.refresh(5_000);
  assert.equal(runs, 2, 'asked again once the pause is over');
});

test('a work that throws is a failure, not a crash', async () => {
  const guard = new KeptWork(options(async () => {
    throw new Error('engine down');
  }));
  assert.deepEqual(await guard.refresh(0), { ok: false, code: 'UNAVAILABLE' });
});

test('a caller waits at most its answer time; the work goes on, is kept, and is not started twice', async () => {
  let runs = 0;
  const guard = new KeptWork(options(async () => (runs++, later(300, { ok: true, view: 'slow', partial: false })), { answerMs: 30 }));
  assert.deepEqual(await guard.refresh(0), { ok: false, code: 'UNAVAILABLE' }, 'nothing kept yet: unavailable now');
  assert.equal(guard.busy, true);
  await guard.refresh(0);
  assert.equal(runs, 1, 'the work in flight is joined, not started again');
  await later(320);
  assert.deepEqual(await guard.read(100, () => undefined), { ok: true, view: 'slow', mark: 'fresh' });
});

test('a kept Hall past its minutes is answered at once and worked out again behind', async () => {
  let runs = 0;
  const guard = new KeptWork(options(async () => (runs++, { ok: true, view: `hall ${runs}`, partial: false })));
  await guard.refresh(0);
  const behind = [];
  assert.deepEqual(await guard.read(1_500, (work) => behind.push(work())), { ok: true, view: 'hall 1', mark: 'stale' });
  await Promise.all(behind);
  assert.equal(runs, 2);
  assert.deepEqual(await guard.read(1_600, () => assert.fail('fresh: no work behind')), { ok: true, view: 'hall 2', mark: 'fresh' });
});
