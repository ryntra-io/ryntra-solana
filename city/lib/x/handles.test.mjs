// The handle registry (CITY-41): no unchecked, stale, uninvolved or unapproved tag gets into a post.
//   node --test "city/lib/x/*.test.mjs"
import assert from 'node:assert/strict';
import test from 'node:test';

import { HANDLES, HANDLE_FRESH_DAYS, HandleError, handleProblem, mention, mentionKeys, rawMentions, resolveMentions } from './handles.ts';

const at = new Date('2026-10-27T13:30:00Z');
const fresh = (key, extra = {}) =>
  HANDLES.map((h) => (h.key === key ? { ...h, status: 'verified', checkedAt: '2026-10-25', checkedBy: 'a person', source: 'test', ...extra } : h));

test('every row says who, what, where it takes part, when checked and where from', () => {
  const keys = new Set();
  for (const h of HANDLES) {
    assert.ok(!keys.has(h.key), `duplicate key ${h.key}`);
    keys.add(h.key);
    assert.match(h.handle, /^[A-Za-z0-9_]{1,15}$/, `${h.key}: an X handle, without @`);
    assert.ok(h.who && h.does && h.source, h.key);
    assert.ok(h.involvedIn.length > 0, h.key);
    if (h.status === 'verified') assert.match(h.checkedAt ?? '', /^\d{4}-\d{2}-\d{2}$/, `${h.key}: a verified row has its check date`);
    else assert.equal(h.checkedAt, null, `${h.key}: an unchecked row has no date`);
  }
  for (const k of ['meteora', 'jupiter', 'solana', 'phantom', 'helius']) assert.ok(keys.has(k), `${k} is in the registry`);
});

test('Helius is marked as needing a check: the research did not confirm it', () => {
  const helius = HANDLES.find((h) => h.key === 'helius');
  assert.equal(helius.status, 'needs-check');
  assert.ok(handleProblem(helius, at));
});

test('an unchecked handle never passes, even approved and involved', () => {
  for (const h of HANDLES.filter((x) => x.status !== 'verified')) {
    assert.throws(() => mention(h.key, { at, involvement: h.involvedIn, approvedBy: 'owner' }), HandleError, h.key);
  }
});

test('today nothing in the registry may be tagged: partners are unchecked, our own check is older than the window', () => {
  for (const h of HANDLES) assert.ok(handleProblem(h, at), `${h.key} would pass on ${at.toISOString()}`);
});

test('a fresh check passes only with a person\'s approval and real involvement', () => {
  const registry = fresh('meteora');
  assert.equal(mention('meteora', { at, involvement: ['launch'], approvedBy: 'owner', registry }), '@MeteoraAG');
  assert.throws(() => mention('meteora', { at, involvement: ['launch'], approvedBy: null, registry }), /approved/);
  assert.throws(() => mention('meteora', { at, involvement: ['launch'], approvedBy: '  ', registry }), /approved/);
  assert.throws(() => mention('meteora', { at, involvement: ['swap', 'market-data'], approvedBy: 'owner', registry }), /no part/);
  assert.throws(() => mention('nobody', { at, involvement: ['launch'], approvedBy: 'owner', registry }), /no handle/);
});

test('a check goes stale after HANDLE_FRESH_DAYS, and a date in the future is refused', () => {
  const day = (n) => new Date(Date.parse('2026-10-25T00:00:00Z') + n * 86_400_000);
  const h = fresh('jupiter').find((x) => x.key === 'jupiter');
  assert.equal(handleProblem(h, day(HANDLE_FRESH_DAYS)), null);
  assert.match(handleProblem(h, day(HANDLE_FRESH_DAYS + 1)), /recheck/);
  assert.match(handleProblem(h, day(-1)), /future/);
});

test('resolveMentions fills {@key} slots or throws; hand-written @tags are found', () => {
  const text = 'On a {@meteora} curve, routed by {@jupiter}.';
  assert.deepEqual(mentionKeys(text), ['meteora', 'jupiter']);
  assert.throws(() => resolveMentions(text, { at, involvement: ['launch', 'swap'], approvedBy: 'owner' }), HandleError);
  const registry = fresh('jupiter', {}).map((h) => (h.key === 'meteora' ? { ...h, status: 'verified', checkedAt: '2026-10-26' } : h));
  assert.equal(resolveMentions(text, { at, involvement: ['launch', 'swap'], approvedBy: 'owner', registry }), 'On a @MeteoraAG curve, routed by @JupiterExchange.');
  assert.deepEqual(rawMentions('hi @MeteoraAG and {@jupiter}, mail me at a@b.io'), ['MeteoraAG']);
});
