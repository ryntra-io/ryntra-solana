// Run from repo root: node --test "city/lib/x/*.test.mjs"
// The publisher end to end: the drafts queue (in memory), the ledger (in memory), x-sender with the real HTTP client,
// and a fake X on 127.0.0.1 (`fake-x.mjs`). Nothing here reaches X.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createMomentsApi } from '../moments/drafts/api.ts';
import { MemoryDraftStore } from '../moments/drafts/store.ts';
import { createXApi } from './api.ts';
import { createXClient } from './client.ts';
import { DEFAULT_SLOTS, readXConfig } from './config.ts';
import { MemoryXLedger, mediaHash, shapeHash, textHash, textShape } from './ledger.ts';
import { dayReport } from './report.ts';
import { runSlot } from './run.ts';
import { parseSlots } from './schedule.ts';
import { createXSender } from './sender.ts';
import { KEYS, fakeX } from './fake-x.mjs';

const kyiv = (hhmm, day = '2026-10-27') => new Date(`${day}T${hhmm}:00+02:00`);
const MP4 = (seed = 1) => new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, seed, 9, 8, 7]);
const JPEG = (seed = 1) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, seed, 1, 2, 3]);
/** A coin per draft: drafts that differ only in a number are near-duplicates, and the ledger keeps them out. */
const COINS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIETT'];

let x;
afterEach(async () => {
  await x?.close();
  x = undefined;
});

async function world({ script, processing, dailyUsd = 1, connected = true, switchOn = true } = {}) {
  x = await fakeX({ script, processing });
  const store = new MemoryDraftStore();
  const ledger = new MemoryXLedger();
  const client = createXClient({ keys: KEYS, base: x.base, sleep: async () => {} });
  const sender = connected ? createXSender({ connected: true, reason: null }, client) : createXSender(readXConfig({}), null);
  const config = { slots: parseSlots(DEFAULT_SLOTS, 'Europe/Kyiv').slots, dailyUsd };
  const clock = { now: kyiv('11:05') };
  const now = () => clock.now;
  if (switchOn) await store.setSwitch({ on: true, by: 'operator:1', now: now() });
  let n = 0;
  /** An approved draft, as the desk leaves it: words, link, clip, a person's yes. */
  const approved = async ({ text = `$${COINS[n]} rose as a new tower. https://ryntra.io/`, media = { type: 'video/mp4', bytes: MP4(n + 1) }, kind = 'launch', moment = {} } = {}) => {
    n += 1;
    const { draft } = await store.put({ eventId: `${kind}:E${n}`, kind, moment, text, link: 'https://ryntra.io/', now: now() });
    await store.setMedia({ id: draft.id, type: media.type, bytes: media.bytes, now: now() });
    const r = await store.decide({ id: draft.id, decision: 'approved', by: 'operator:1', now: now() });
    assert.ok(r.ok);
    return r.draft;
  };
  const run = () => runSlot({ store, ledger, sender, config, now });
  const report = (day) => dayReport({ store, ledger, sender, config, now, day });
  return { store, ledger, sender, config, clock, now, approved, run, report };
}

test('not connected: the pass says so and touches neither the queue nor X', async () => {
  const w = await world({ connected: false });
  const d = await w.approved();
  const r = await w.run();
  assert.equal(r.state, 'not_connected');
  assert.match(r.error, /^X not connected/);
  assert.equal(x.calls.length, 0);
  assert.equal((await w.store.get(d.id)).status, 'approved');
  assert.equal(w.sender.connected, false);
  assert.deepEqual(await w.sender.send({ draftId: d.id, text: 't', link: 'l', media: null }), { ok: false, error: w.sender.reason });
});

test('switch off, or no open window: nothing goes', async () => {
  const off = await world({ switchOn: false });
  await off.approved();
  assert.equal((await off.run()).state, 'switch_off');
  await x.close();
  const w = await world();
  await w.approved();
  w.clock.now = kyiv('12:00');
  assert.equal((await w.run()).state, 'no_slot');
  assert.equal(x.calls.length, 0);
});

test('in an open slot the oldest approved draft goes out with its clip, once; the next slot takes the next one', async () => {
  const w = await world();
  const a = await w.approved();
  const b = await w.approved({ media: { type: 'image/jpeg', bytes: JPEG() } });
  const first = await w.run();
  assert.equal(first.state, 'sent');
  assert.equal(first.slot, '2026-10-27 11:00');
  assert.equal(first.draftId, a.id);
  assert.equal(x.posts.length, 1);
  assert.equal(x.posts[0].text, a.text);
  assert.equal(x.posts[0].mediaIds.length, 1);
  assert.deepEqual(new Uint8Array(x.media.get(x.posts[0].mediaIds[0]).bytes), MP4(1), 'the draft’s own clip');
  const sent = await w.store.get(a.id);
  assert.equal(sent.status, 'sent');
  assert.equal(sent.note, `posted ${first.postId}`);
  assert.equal((await w.store.get(b.id)).status, 'approved', 'one post per slot');

  w.clock.now = kyiv('11:25');
  assert.equal((await w.run()).state, 'slot_done');
  assert.equal(x.posts.length, 1);

  w.clock.now = kyiv('15:00');
  const second = await w.run();
  assert.equal(second.state, 'sent');
  assert.equal(second.draftId, b.id);
  assert.equal(x.media.get(x.posts[1].mediaIds[0]).category, 'tweet_image');

  w.clock.now = kyiv('18:05');
  assert.equal((await w.run()).state, 'empty', 'nothing approved left');
});

test('two passes at once in one slot: one post', async () => {
  const w = await world();
  await w.approved();
  await w.approved();
  const results = await Promise.all([w.run(), w.run(), w.run()]);
  assert.equal(results.filter((r) => r.state === 'sent').length, 1, results.map((r) => r.state).join(','));
  assert.equal(x.posts.length, 1);
  const drafts = await w.store.list({ status: null, limit: 10 });
  assert.deepEqual(drafts.map((d) => d.status).sort(), ['approved', 'sent'], 'the other draft is back in line, not lost');
  assert.equal((await w.ledger.day('2026-10-27')).length, 1);
});

test('a draft another pass holds (sending) is never claimed again', async () => {
  const w = await world();
  const a = await w.approved();
  assert.ok(await w.store.claim({ id: a.id, now: w.now() }));
  assert.equal((await w.run()).state, 'empty');
  assert.equal(x.calls.length, 0);
});

test('the same words twice: the second draft is failed as a duplicate, and the slot goes to the next one', async () => {
  const w = await world();
  const a = await w.approved({ text: 'BONK rose as a new tower. https://ryntra.io/?coin=BONK' });
  const b = await w.approved({ text: 'BONK  rose as a new tower.  https://ryntra.io/?coin=BONK' });
  const c = await w.approved();
  assert.equal((await w.run()).draftId, a.id);
  w.clock.now = kyiv('15:10');
  const r = await w.run();
  assert.equal(r.state, 'sent');
  assert.equal(r.draftId, c.id);
  assert.deepEqual(r.duplicates, [{ draftId: b.id, of: a.id }]);
  const dup = await w.store.get(b.id);
  assert.equal(dup.status, 'failed');
  assert.match(dup.note, new RegExp(`duplicate: the same words as draft ${a.id}`));
  assert.equal(x.posts.length, 2);
});

test('the same clip twice is a duplicate too', async () => {
  const w = await world();
  const a = await w.approved({ media: { type: 'video/mp4', bytes: MP4(9) } });
  const b = await w.approved({ media: { type: 'video/mp4', bytes: MP4(9) } });
  await w.run();
  w.clock.now = kyiv('15:10');
  const r = await w.run();
  assert.equal(r.state, 'empty');
  assert.deepEqual(r.duplicates, [{ draftId: b.id, of: a.id }]);
  assert.match((await w.store.get(b.id)).note, /the same clip/);
});

test('an error from X fails the draft with X’s reason; the slot is spent, the words are free again', async () => {
  const w = await world({ script: { tweet: [{ status: 400, body: { title: 'Invalid Request', detail: 'Your media IDs are invalid.' } }] } });
  const a = await w.approved({ text: 'Same words. https://ryntra.io/' });
  const r = await w.run();
  assert.equal(r.state, 'failed');
  const failed = await w.store.get(a.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.note, 'X 400: Your media IDs are invalid.');
  const [row] = await w.ledger.day('2026-10-27');
  assert.equal(row.status, 'failed');
  assert.equal(row.error, 'X 400: Your media IDs are invalid.');
  assert.equal((await w.run()).state, 'slot_done', 'one try per slot');
  w.clock.now = kyiv('15:05');
  const again = await w.approved({ text: 'Same words. https://ryntra.io/' });
  assert.equal((await w.run()).draftId, again.id, 'a failed post does not hold its words');
});

test('a post that may have gone out (a lost answer, then “duplicate”) is failed, unsure, counted, never sent again', async () => {
  const w = await world({ script: { tweet: [{ posted: true, status: 503 }] } });
  const a = await w.approved({ text: 'Once only. https://ryntra.io/' });
  const r = await w.run();
  assert.equal(r.state, 'unsure');
  const d = await w.store.get(a.id);
  assert.equal(d.status, 'failed');
  assert.match(d.note, /^may have posted: X 403/);
  assert.equal(x.posts.length, 1);
  w.clock.now = kyiv('15:05');
  const b = await w.approved({ text: 'Once only. https://ryntra.io/' });
  const next = await w.run();
  assert.deepEqual(next.duplicates, [{ draftId: b.id, of: a.id }], 'its words stay taken');
  const rep = await w.report('2026-10-27');
  assert.equal(rep.unsure, 1);
  assert.equal(rep.costUsd, 0.2, 'an unsure post is paid for, as far as the budget knows');
});

test('5xx then success: retried inside the pass, one post', async () => {
  const w = await world({ script: { append: [{ status: 503 }], tweet: [{ status: 502 }] } });
  await w.approved();
  assert.equal((await w.run()).state, 'sent');
  assert.equal(x.posts.length, 1);
});

test('the day’s budget: a post that would go over it is not made, and its draft waits', async () => {
  const w = await world({ dailyUsd: 0.3 });
  await w.approved();
  const b = await w.approved();
  assert.equal((await w.run()).state, 'sent');
  w.clock.now = kyiv('15:05');
  const r = await w.run();
  assert.equal(r.state, 'over_budget');
  assert.match(r.error, /\$0.2 spent of \$0.3; this post is \$0.2/);
  assert.equal((await w.store.get(b.id)).status, 'approved');
  w.clock.now = kyiv('11:05', '2026-10-28');
  assert.equal((await w.run()).state, 'sent', 'a new day, a new budget');
});

test('a post without a link is counted at $0.015', async () => {
  const w = await world();
  await w.approved({ text: 'The skyline at dusk.' });
  await w.run();
  const [row] = await w.ledger.day('2026-10-27');
  assert.equal(row.link, false);
  assert.equal(row.costUsd, 0.015);
});

test('with x-sender wired, approving only puts the draft in line: nothing posts until its slot', async () => {
  const w = await world();
  const { draft } = await w.store.put({ eventId: 'launch:Q', kind: 'launch', moment: {}, text: 'Queued. https://ryntra.io/', link: 'https://ryntra.io/', now: w.now() });
  await w.store.setMedia({ id: draft.id, type: 'video/mp4', bytes: MP4(42), now: w.now() });
  const api = createMomentsApi({ store: w.store, sender: w.sender, now: w.now, authorize: async () => ({ ok: true, by: 'operator:1', actor: 1 }) });
  const res = await (await api.approve(new Request('https://ryntra.io/x', { method: 'POST' }), draft.id)).json();
  assert.equal(res.draft.status, 'approved');
  assert.deepEqual(res.sender, { connected: true, scheduled: true });
  await api.setSwitch(new Request('https://ryntra.io/x', { method: 'POST', body: JSON.stringify({ on: true }) }));
  assert.equal(x.calls.length, 0, 'neither approving nor the switch posts');
  assert.equal((await w.run()).draftId, draft.id);
});

test('the day’s report: each slot, the posts, what they cost, what waits', async () => {
  const w = await world({ script: { tweet: [{ status: 400, body: { detail: 'nope' } }] } });
  await w.approved();
  await w.approved({ text: 'Plain words.' });
  await w.approved();
  await w.run(); // 11:00 fails
  w.clock.now = kyiv('15:05');
  await w.run(); // 15:00 posts the plain one
  w.clock.now = kyiv('18:30');
  const rep = await w.report();
  assert.equal(rep.day, '2026-10-27');
  assert.deepEqual(rep.slots.map((s) => [s.time, s.state]), [['11:00', 'failed'], ['15:00', 'sent'], ['18:00', 'open'], ['21:00', 'ahead']]);
  assert.equal(rep.posted, 1);
  assert.equal(rep.failed, 1);
  assert.equal(rep.withLink, 0);
  assert.equal(rep.costUsd, 0.015);
  assert.equal(rep.waiting, 1);
  assert.equal(rep.summary[0], 'X, 2026-10-27 (Europe/Kyiv): 1 posted, 1 failed; $0.015 of $1.00.');
  assert.equal(rep.summary[1], 'Sender connected, switch on.');
  assert.ok(rep.summary.includes('11:00 failed · X 400: nope'));
  assert.equal(rep.summary.at(-1), '1 approved draft waiting.');
  w.clock.now = kyiv('09:00', '2026-10-28');
  assert.deepEqual((await w.report('2026-10-27')).slots.map((s) => s.state), ['failed', 'sent', 'missed', 'missed']);
});

test('/api/x: the cron only with its secret, the report only for an operator', async () => {
  const w = await world();
  await w.approved();
  let operator = true;
  const api = createXApi({
    store: w.store, ledger: w.ledger, sender: w.sender, config: w.config, now: w.now,
    cronAuthorized: (req) => req.headers.get('authorization') === 'Bearer cron-secret-cron-secret',
    authorize: async () => (operator ? { ok: true, by: 'operator:1', actor: 1 } : { ok: false, status: 401, error: 'unauthorized' }),
  });
  assert.equal((await api.cron(new Request('https://ryntra.io/api/x/cron'))).status, 401);
  assert.equal(x.calls.length, 0);
  const res = await api.cron(new Request('https://ryntra.io/api/x/cron', { headers: { authorization: 'Bearer cron-secret-cron-secret' } }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.outcome.state, 'sent');
  assert.equal(body.report.posted, 1);

  assert.equal((await (await api.report(new Request('https://ryntra.io/api/x/report?day=2026-10-27'))).json()).report.posted, 1);
  assert.equal((await api.report(new Request('https://ryntra.io/api/x/report?day=27.10.2026'))).status, 400);
  operator = false;
  assert.equal((await api.report(new Request('https://ryntra.io/api/x/report'))).status, 401);
});

test('/api/x/cron without the owner’s switch: not_connected, no report, no call to X', async () => {
  const w = await world({ connected: false });
  const api = createXApi({ store: w.store, ledger: w.ledger, sender: w.sender, config: w.config, now: w.now, cronAuthorized: () => true, authorize: async () => ({ ok: true, by: 'operator:1', actor: 1 }) });
  const body = await (await api.cron(new Request('https://ryntra.io/api/x/cron'))).json();
  assert.equal(body.outcome.state, 'not_connected');
  assert.equal(body.report, undefined);
  assert.equal(x.calls.length, 0);
});

test('the ledger in memory: one row per slot; live words and clips once', async () => {
  const l = new MemoryXLedger();
  const now = new Date('2026-10-27T09:00:00Z');
  const row = (slot, draftId, text, bytes, at = now) => ({ slot, day: slot.slice(0, 10), draftId, textHash: textHash(text), shapeHash: shapeHash(text), mediaHash: mediaHash(bytes), link: true, costUsd: 0.2, now: at });
  assert.equal((await l.reserve(row('2026-10-27 11:00', 'a', 'one', MP4(1)))).ok, true);
  assert.deepEqual(await l.reserve(row('2026-10-27 11:00', 'b', 'two', MP4(2))), { ok: false, conflict: 'slot', draftId: 'a' });
  assert.deepEqual(await l.reserve(row('2026-10-27 15:00', 'b', ' ONE ', MP4(2))), { ok: false, conflict: 'text', draftId: 'a' });
  assert.deepEqual(await l.reserve(row('2026-10-27 15:00', 'b', 'two', MP4(1))), { ok: false, conflict: 'media', draftId: 'a' });
  await l.finish({ slot: '2026-10-27 11:00', status: 'failed', postId: null, error: 'x', now });
  assert.equal((await l.reserve(row('2026-10-27 15:00', 'b', 'one', MP4(1)))).ok, true, 'a failed row frees its words and clip');
  assert.equal((await l.finish({ slot: '2026-10-27 11:00', status: 'sent', postId: '1', error: null, now })).status, 'failed', 'only sending moves');
  assert.equal(mediaHash(null), null);
  // A near-duplicate: the same words but for a number, within 20 hours of a live post.
  assert.deepEqual(await l.reserve(row('2026-10-27 18:00', 'c', 'one', MP4(3))), { ok: false, conflict: 'text', draftId: 'b' });
  assert.deepEqual(await l.reserve(row('2026-10-27 18:00', 'c', 'JUST IN: $3.07B traded in 24 hours.', MP4(3))).then((r) => r.ok), true);
  assert.deepEqual(await l.reserve(row('2026-10-27 21:00', 'd', 'JUST IN: $3.11B traded in 24 hours.', MP4(4), new Date('2026-10-27T19:00:00Z'))), { ok: false, conflict: 'shape', draftId: 'c' });
  assert.equal((await l.reserve(row('2026-10-28 11:00', 'd', 'JUST IN: $3.11B traded in 24 hours.', MP4(4), new Date('2026-10-28T09:00:00Z')))).ok, true, 'the next day, 24 h on');
});

test('the shape of the words: numbers and links out, coins kept', () => {
  assert.equal(
    textShape('JUST IN: $3.07B traded in 24 hours across the 82 towers. Jupiter data, read Oct 26 · 11:31 UTC. https://ryntra.io/'),
    'just in: $# traded in # hours across the # towers. jupiter data, read oct # · # utc.',
  );
  assert.equal(shapeHash('Tower of the hour: $DOPE grew +10.3%. https://ryntra.io/?coin=DOPE'), shapeHash('Tower of the hour: $DOPE  grew +12.9%. https://ryntra.io/?coin=DOPE'));
  assert.notEqual(shapeHash('Tower of the hour: $DOPE grew +10.3%.'), shapeHash('Tower of the hour: $WIF grew +10.3%.'));
});

test('near-duplicates: the same words but for their numbers wait a day; the draft is failed as a duplicate', async () => {
  const w = await world();
  const a = await w.approved({ text: 'JUST IN: $3.07B traded in 24 hours across the 82 towers of the live Solana skyline. https://ryntra.io/' });
  const b = await w.approved({ text: 'JUST IN: $3.11B traded in 24 hours across the 84 towers of the live Solana skyline. https://ryntra.io/' });
  const c = await w.approved();
  assert.equal((await w.run()).draftId, a.id);
  w.clock.now = kyiv('15:05');
  const r = await w.run();
  assert.equal(r.draftId, c.id);
  assert.deepEqual(r.duplicates, [{ draftId: b.id, of: a.id }]);
  const dup = await w.store.get(b.id);
  assert.equal(dup.status, 'failed');
  assert.match(dup.note, /duplicate: the same words but for numbers and links, within 20 h, as draft/);
  w.clock.now = kyiv('11:05', '2026-10-28');
  const d = await w.approved({ text: 'JUST IN: $3.20B traded in 24 hours across the 85 towers of the live Solana skyline. https://ryntra.io/' });
  assert.equal((await w.run()).draftId, d.id, 'a day on, the same template with new figures goes out');
  assert.equal(x.posts.length, 3);
});

test('a studio draft whose facts are no longer fresh is failed as stale, never posted', async () => {
  const w = await world();
  const facts = (readAt) => ({ template: 'hour', mint: 'So11111111111111111111111111111111111111112', symbol: '$DOPE', district: 'core', change: 10.3, mcap: 4.2e7, readAt, live: true });
  const old = await w.approved({ kind: 'studio', moment: { studio: facts('2026-10-27T05:00:00.000Z') }, text: 'Tower of the hour: $DOPE grew +10.3% in the last hour. https://ryntra.io/?coin=DOPE' });
  const fresh = await w.approved({ kind: 'studio', moment: { studio: facts('2026-10-27T08:30:00.000Z') }, text: 'Tower of the hour: $WIF grew +7.0% in the last hour. https://ryntra.io/?coin=WIF' });
  const r = await w.run(); // 11:05 Kyiv = 09:05 UTC: 4 h after the first read, 35 min after the second
  assert.equal(r.state, 'sent');
  assert.equal(r.draftId, fresh.id);
  assert.deepEqual(r.stale, [old.id]);
  const failed = await w.store.get(old.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.note, /^stale: its facts \(hour, read 2026-10-27T05:00:00.000Z\) are too old to post$/);
  assert.equal(x.posts.length, 1);
  assert.equal(x.posts[0].text, fresh.text);
});
