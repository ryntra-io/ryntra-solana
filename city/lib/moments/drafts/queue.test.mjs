// Run from repo root: node --test "city/lib/moments/drafts/*.test.mjs"
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createMomentsApi } from './api.ts';
import { createDoor } from './door.ts';
import { NO_SENDER, NOT_CONNECTED } from './sender.ts';
import { MemoryDraftStore } from './store.ts';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const TX = '5'.repeat(88);
const at = '2026-10-27T12:00:00.000Z';
const NOW = new Date('2026-10-27T12:05:00.000Z');

const EVENTS = {
  launch: { kind: 'launch', id: 'L1', mint: BONK, symbol: 'BONK', named: true, district: 'docks', sourceAt: at },
  graduate: { kind: 'graduate', id: 'G1', mint: BONK, symbol: 'BONK', named: true, district: 'docks', sourceAt: at },
  bigx: { kind: 'bigx', id: 'X1', mint: JUP, symbol: 'JUP', named: true, district: 'heights', sourceAt: at, multiple: 12.4, tx: TX },
  agent: { kind: 'agent', id: 'A1', mint: JUP, symbol: 'JUP', named: true, district: 'heights', sourceAt: at, agent: 'Scout 7', rule: 'liquidity doubled', change: 42, window: '1H' },
};

const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

/** No test may reach the network: a sender that slipped through would show here. */
let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('the queue must never call the network');
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const KEY = 'k'.repeat(24);

/**
 * The queue behind the real door (`door.ts`), with its parts faked: `operator` is the admin session (null: none),
 * `fresh` whether its second factor is fresh ('reverify': not), `secret` the desk's secret.
 */
function setup({ sender = NO_SENDER, operator = 1, fresh = true, secret = KEY } = {}) {
  const store = new MemoryDraftStore();
  const audits = [];
  const api = createMomentsApi({
    store,
    sender,
    now: () => NOW,
    audit: async (e) => {
      audits.push(e);
    },
    authorize: createDoor({
      secret: () => secret,
      sameOrigin: (req) => req.headers.get('origin') === new URL(req.url).origin,
      operator: async () => operator,
      fresh: async () => (operator === null ? { ok: false, reason: 'unauthorized' } : fresh === true ? { ok: true, actor: operator } : { ok: false, reason: 'reverify' }),
    }),
  });
  return { store, api, audits };
}

/** A sender that records what it was given and says it posted. */
function recordingSender() {
  const sent = [];
  return { sent, sender: { connected: true, async send(post) { sent.push(post); return { ok: true, postId: `x${sent.length}` }; } } };
}

// The desk's own calls: same origin, the session's cookie (faked by `operator` above).
const ORIGIN = { origin: 'https://ryntra.io' };
const post = (path, body, headers = ORIGIN) => new Request(`https://ryntra.io/api/moments${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
const get = (path, headers = {}) => new Request(`https://ryntra.io/api/moments${path}`, { headers });
const put = (path, type, bytes, headers = ORIGIN) => new Request(`https://ryntra.io/api/moments${path}`, { method: 'PUT', headers: { 'content-type': type, ...headers }, body: bytes });
const bearer = (key = KEY) => ({ authorization: `Bearer ${key}` });

async function event(api, e) {
  const res = await api.events(post('/events', e));
  return { status: res.status, body: await res.json() };
}

async function ready(api, e, media = MP4, type = 'video/mp4') {
  const { body } = await event(api, e);
  const res = await api.putClip(put(`/drafts/${body.draft.id}/clip`, type, media), body.draft.id);
  assert.equal(res.status, 200);
  return (await res.json()).draft;
}

test('each of the four happenings becomes a draft with its words, its link and the clip still to film', async () => {
  const { api } = setup();
  for (const [kind, e] of Object.entries(EVENTS)) {
    const { status, body } = await event(api, e);
    assert.equal(status, 201, kind);
    assert.equal(body.created, true);
    const d = body.draft;
    assert.equal(d.kind, kind);
    assert.equal(d.status, 'filming');
    assert.equal(d.media, null);
    assert.equal(d.eventId, `${kind}:${e.id}`);
    assert.equal(d.moment.towerId, e.mint, 'the clip flies to the coin');
    assert.ok(d.text.endsWith(d.link), 'the words end on the link');
    assert.match(d.link, /^https:\/\/ryntra\.io\/\?coin=(BONK|JUP)$/);
  }
});

test('the same happening sent twice is one draft', async () => {
  const { api, store } = setup();
  const first = await event(api, EVENTS.launch);
  const again = await event(api, EVENTS.launch);
  assert.equal(again.status, 200);
  assert.equal(again.body.created, false);
  assert.equal(again.body.draft.id, first.body.draft.id);
  assert.equal((await store.list({ status: null, limit: 10 })).length, 1);
});

test('what is not a post is refused: a small win, an unverified coin’s win or find, a malformed event', async () => {
  const { api, store } = setup();
  assert.equal((await event(api, { ...EVENTS.bigx, multiple: 3 })).status, 422);
  assert.equal((await event(api, { ...EVENTS.bigx, id: 'X2', named: false })).status, 422);
  assert.equal((await event(api, { ...EVENTS.agent, named: false })).status, 422);
  const bad = await event(api, { ...EVENTS.launch, mint: 'not a mint' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'mint');
  assert.equal((await event(api, { ...EVENTS.agent, rule: 'see https://x.com' })).body.field, 'rule');
  assert.equal((await event(api, { ...EVENTS.launch, kind: 'pump' })).body.field, 'kind');
  const res = await api.events(new Request('https://ryntra.io/api/moments/events', { method: 'POST', headers: ORIGIN, body: '{' }));
  assert.equal(res.status, 400);
  const huge = await api.events(post('/events', { ...EVENTS.launch, pad: 'x'.repeat(9000) }));
  assert.equal(huge.status, 413);
  assert.equal((await store.list({ status: null, limit: 10 })).length, 0);
});

test('an unnamed launch is still a draft, and says nothing of the coin', async () => {
  const { api } = setup();
  const { body } = await event(api, { ...EVENTS.launch, id: 'L9', named: false });
  assert.equal(body.draft.moment.symbol, null);
  assert.doesNotMatch(body.draft.text, /BONK/i);
  assert.equal(body.draft.link, 'https://ryntra.io/');
});

test('the clip makes a draft ready; only an MP4, a PNG or a JPEG that is what it says, and not too big', async () => {
  const { api } = setup();
  const { body } = await event(api, EVENTS.launch);
  const id = body.draft.id;
  assert.equal((await api.putClip(put(`/drafts/${id}/clip`, 'video/webm', MP4), id)).status, 415);
  assert.equal((await api.putClip(put(`/drafts/${id}/clip`, 'video/mp4', PNG), id)).status, 415, 'a PNG called an MP4');
  const big = new Uint8Array(4 * 1024 * 1024 + 1);
  big.set(MP4);
  assert.equal((await api.putClip(put(`/drafts/${id}/clip`, 'video/mp4', big), id)).status, 413);
  const ok = await api.putClip(put(`/drafts/${id}/clip`, 'video/mp4', MP4), id);
  const draft = (await ok.json()).draft;
  assert.equal(draft.status, 'ready');
  assert.deepEqual(draft.media, { type: 'video/mp4', bytes: MP4.byteLength });
  const back = await api.getClip(get(`/drafts/${id}/clip`), id);
  assert.equal(back.headers.get('content-type'), 'video/mp4');
  assert.equal(back.headers.get('cache-control'), 'no-store');
  assert.deepEqual(new Uint8Array(await back.arrayBuffer()), MP4);
  assert.equal((await api.putClip(put('/drafts/nope/clip', 'video/mp4', MP4), 'nope')).status, 404);
});

test('a draft is approved only once it has its clip; approve and reject say who decided', async () => {
  const { api } = setup();
  const filming = (await event(api, EVENTS.launch)).body.draft;
  const early = await api.approve(post(`/drafts/${filming.id}/approve`), filming.id);
  assert.equal(early.status, 409);
  assert.equal((await early.json()).error, 'not_ready');

  const a = await ready(api, EVENTS.graduate);
  const res = await api.approve(post(`/drafts/${a.id}/approve`), a.id);
  const body = await res.json();
  assert.equal(body.draft.status, 'approved');
  assert.equal(body.draft.decidedBy, 'operator:1');
  assert.equal(body.draft.decidedAt, NOW.toISOString());
  const again = await api.approve(post(`/drafts/${a.id}/approve`), a.id);
  assert.equal(again.status, 200, 'approving twice is the same answer');
  const againBody = await again.json();
  assert.equal(againBody.draft.status, 'approved');
  assert.equal(againBody.already, true);
  assert.equal(againBody.draft.decidedAt, NOW.toISOString());
  assert.equal((await api.putClip(put(`/drafts/${a.id}/clip`, 'video/mp4', MP4), a.id)).status, 409, 'a decided clip stays');

  const b = await ready(api, EVENTS.bigx, PNG, 'image/png');
  const rej = await (await api.reject(post(`/drafts/${b.id}/reject`), b.id)).json();
  assert.equal(rej.draft.status, 'rejected');
  const flip = await api.approve(post(`/drafts/${b.id}/approve`), b.id);
  assert.equal(flip.status, 409, 'a rejected draft is not approved after all');
  assert.equal((await api.reject(post(`/drafts/${a.id}/reject`), a.id)).status, 409, 'nor an approved one rejected');
  assert.equal((await api.approve(post('/drafts/x/approve'), '00000000-0000-4000-8000-999999999999')).status, 404);
});

test('approve all approves every ready draft and nothing else', async () => {
  const { api, store } = setup();
  const filming = (await event(api, EVENTS.launch)).body.draft;
  const a = await ready(api, EVENTS.graduate);
  const b = await ready(api, EVENTS.bigx);
  const c = await ready(api, EVENTS.agent);
  await api.reject(post(`/drafts/${c.id}/reject`), c.id);
  const res = await (await api.approveAll(post('/drafts/approve-all'))).json();
  assert.equal(res.approved, 2);
  assert.deepEqual(res.drafts.map((d) => d.id).sort(), [a.id, b.id].sort());
  assert.equal((await store.get(filming.id)).status, 'filming');
  assert.equal((await store.get(c.id)).status, 'rejected');
  const again = await (await api.approveAll(post('/drafts/approve-all'))).json();
  assert.equal(again.approved, 0);
});

test('the switch is off by default and approving with it off sends nothing, even with a sender connected', async () => {
  const { sent, sender } = recordingSender();
  const { api } = setup({ sender });
  const sw = await (await api.getSwitch(get('/switch'))).json();
  assert.equal(sw.switch.on, false);
  assert.equal(sw.sender.connected, true);
  const a = await ready(api, EVENTS.launch);
  const body = await (await api.approve(post(`/drafts/${a.id}/approve`), a.id)).json();
  assert.equal(body.draft.status, 'approved');
  await api.approveAll(post('/drafts/approve-all'));
  assert.equal(sent.length, 0);
});

test('with the switch on, approved drafts go to the sender with their words, link and clip; off again stops it', async () => {
  const { sent, sender } = recordingSender();
  const { api } = setup({ sender });
  const waiting = await ready(api, EVENTS.launch);
  await api.approve(post(`/drafts/${waiting.id}/approve`), waiting.id);
  const on = await (await api.setSwitch(post('/switch', { on: true }))).json();
  assert.equal(on.switch.on, true);
  assert.equal(on.switch.changedBy, 'operator:1');
  assert.equal(sent.length, 1, 'turning it on sends what was approved meanwhile');
  assert.equal(sent[0].draftId, waiting.id);
  assert.deepEqual(sent[0].media, { type: 'video/mp4', bytes: MP4 });

  const b = await ready(api, EVENTS.bigx);
  const body = await (await api.approve(post(`/drafts/${b.id}/approve`), b.id)).json();
  assert.equal(body.draft.status, 'sent');
  assert.equal(body.draft.note, 'posted x2');
  assert.equal(sent[1].text, b.text);
  assert.equal(sent[1].link, b.link);

  await api.setSwitch(post('/switch', { on: false }));
  const c = await ready(api, EVENTS.agent);
  const after = await (await api.approve(post(`/drafts/${c.id}/approve`), c.id)).json();
  assert.equal(after.draft.status, 'approved');
  assert.equal(sent.length, 2);
});

test('the wired sender is not connected: switch on, approved, nothing leaves', async () => {
  const { api } = setup();
  assert.equal(NO_SENDER.connected, false);
  assert.deepEqual(await NO_SENDER.send({ draftId: 'd', text: 't', link: 'l', media: null }), { ok: false, error: NOT_CONNECTED });
  await api.setSwitch(post('/switch', { on: true }));
  const a = await ready(api, EVENTS.graduate);
  const body = await (await api.approve(post(`/drafts/${a.id}/approve`), a.id)).json();
  assert.equal(body.draft.status, 'approved');
  assert.equal(body.sender.connected, false);
  const all = await (await api.approveAll(post('/drafts/approve-all'))).json();
  assert.equal(all.sender.connected, false);
});

test('a failed post is kept with the sender’s reason', async () => {
  const sender = { connected: true, async send() { return { ok: false, error: 'rate limited' }; } };
  const { api } = setup({ sender });
  await api.setSwitch(post('/switch', { on: true }));
  const a = await ready(api, EVENTS.launch);
  const body = await (await api.approve(post(`/drafts/${a.id}/approve`), a.id)).json();
  assert.equal(body.draft.status, 'failed');
  assert.equal(body.draft.note, 'rate limited');
});

test('the switch takes only true or false', async () => {
  const { api } = setup();
  assert.equal((await api.setSwitch(post('/switch', { on: 'yes' }))).status, 400);
  assert.equal((await api.setSwitch(new Request('https://ryntra.io/api/moments/switch', { method: 'POST', headers: ORIGIN, body: 'x' }))).status, 400);
  assert.equal((await (await api.getSwitch(get('/switch'))).json()).switch.on, false);
});

test('the list is newest first, filters by status and refuses an unknown one', async () => {
  const { api } = setup();
  await event(api, EVENTS.launch);
  await ready(api, EVENTS.graduate);
  const all = await (await api.list(get('/drafts'))).json();
  assert.equal(all.drafts.length, 2);
  assert.equal(all.switch.on, false);
  const r = await (await api.list(get('/drafts?status=ready'))).json();
  assert.deepEqual(r.drafts.map((d) => d.kind), ['graduate']);
  assert.equal((await api.list(get('/drafts?status=posted'))).status, 400);
});

test('nobody without a session or the key gets anything', async () => {
  const { api, store } = setup({ operator: null });
  const id = '00000000-0000-4000-8000-000000000001';
  assert.equal((await api.events(post('/events', EVENTS.launch))).status, 401);
  assert.equal((await api.putClip(put(`/drafts/${id}/clip`, 'video/mp4', MP4), id)).status, 401);
  assert.equal((await api.list(get('/drafts'))).status, 401);
  assert.equal((await api.getClip(get(`/drafts/${id}/clip`), id)).status, 401);
  assert.equal((await api.approve(post(`/drafts/${id}/approve`), id)).status, 401);
  assert.equal((await api.approveAll(post('/drafts/approve-all'))).status, 401);
  assert.equal((await api.getSwitch(get('/switch'))).status, 401);
  assert.equal((await api.setSwitch(post('/switch', { on: true }))).status, 401);
  assert.equal((await store.list({ status: null, limit: 10 })).length, 0);
  assert.equal((await store.switch()).on, false);
});

test('the key opens the machine routes and nothing a person decides', async () => {
  const { sender, sent } = recordingSender();
  const { api, store } = setup({ sender, operator: null });
  const made = await api.events(post('/events', EVENTS.graduate, bearer()));
  assert.equal(made.status, 201);
  const { draft } = await made.json();
  assert.equal((await api.putClip(put(`/drafts/${draft.id}/clip`, 'video/mp4', MP4, bearer()), draft.id)).status, 200);
  for (const [name, res] of [
    ['list', api.list(get('/drafts', bearer()))],
    ['clip', api.getClip(get(`/drafts/${draft.id}/clip`, bearer()), draft.id)],
    ['approve', api.approve(post(`/drafts/${draft.id}/approve`, {}, bearer()), draft.id)],
    ['reject', api.reject(post(`/drafts/${draft.id}/reject`, {}, bearer()), draft.id)],
    ['approve all', api.approveAll(post('/drafts/approve-all', {}, bearer()))],
    ['switch', api.getSwitch(get('/switch', bearer()))],
    ['switch on', api.setSwitch(post('/switch', { on: true }, bearer()))],
    ['switch off', api.setSwitch(post('/switch', { on: false }, bearer()))],
  ]) {
    const r = await res;
    assert.equal(r.status, 403, name);
    assert.equal((await r.json()).error, 'operator_only', name);
  }
  assert.equal((await store.get(draft.id)).status, 'ready', 'the key approved nothing');
  assert.equal((await store.switch()).on, false, 'nor turned the switch on');
  assert.equal(sent.length, 0);
  // A wrong key, a short secret or none set: the machine routes stay shut.
  assert.equal((await api.events(post('/events', EVENTS.launch, bearer('w'.repeat(24))))).status, 401);
  assert.equal((await setup({ secret: 'short' }).api.events(post('/events', EVENTS.launch, bearer('short')))).status, 401);
  assert.equal((await setup({ secret: '' }).api.events(post('/events', EVENTS.launch, bearer(KEY)))).status, 401);
});

test('a session decides, from this origin only', async () => {
  const { api, store } = setup();
  const a = await ready(api, EVENTS.launch);
  const cross = await api.approve(post(`/drafts/${a.id}/approve`, {}, { origin: 'https://evil.example' }), a.id);
  assert.equal(cross.status, 403);
  assert.equal((await api.approve(post(`/drafts/${a.id}/approve`, {}, {}), a.id)).status, 403, 'no origin, no change');
  assert.equal((await store.get(a.id)).status, 'ready');
  assert.equal((await api.list(get('/drafts'))).status, 200, 'a read needs no origin');
  assert.equal((await api.approve(post(`/drafts/${a.id}/approve`), a.id)).status, 200);
});

test('approve all and switching on need a fresh second factor; switching off does not', async () => {
  const { sender, sent } = recordingSender();
  const { api, store, audits } = setup({ sender, fresh: 'reverify' });
  const a = await ready(api, EVENTS.launch);
  const all = await api.approveAll(post('/drafts/approve-all'));
  assert.equal(all.status, 403);
  assert.equal((await all.json()).error, 'reverify');
  assert.equal((await store.get(a.id)).status, 'ready');
  const on = await api.setSwitch(post('/switch', { on: true }));
  assert.equal(on.status, 403);
  assert.equal((await on.json()).error, 'reverify');
  assert.equal((await store.switch()).on, false);
  assert.equal((await api.setSwitch(post('/switch', { on: false }))).status, 200, 'off is one tap');
  assert.equal(sent.length, 0);
  assert.deepEqual(audits.map((e) => [e.action, e.outcome]), [
    ['moments_switch', 'rejected'],
    ['moments_switch', 'attempt'],
    ['moments_switch', 'ok'],
  ]);
});

test('each decision is on the audit trail with who made it', async () => {
  const { api, audits } = setup();
  const a = await ready(api, EVENTS.launch);
  const b = await ready(api, EVENTS.graduate);
  await ready(api, EVENTS.bigx);
  await api.approve(post(`/drafts/${a.id}/approve`), a.id);
  await api.reject(post(`/drafts/${b.id}/reject`), b.id);
  await api.approveAll(post('/drafts/approve-all'));
  await api.setSwitch(post('/switch', { on: true }));
  assert.deepEqual(audits.map((e) => [e.action, e.outcome, e.actor]), [
    ['moments_decide', 'ok', 1],
    ['moments_decide', 'ok', 1],
    ['moments_approve_all', 'attempt', 1],
    ['moments_approve_all', 'ok', 1],
    ['moments_switch', 'attempt', 1],
    ['moments_switch', 'ok', 1],
  ]);
  assert.deepEqual(audits[1].payload, { id: b.id, decision: 'rejected' });
  assert.equal(audits[3].payload.count, 1);
  assert.equal(audits[5].payload.on, true);
});

test('a draft is claimed before it is sent: two deliveries at once post it once', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const sent = [];
  const sender = { connected: true, async send(p) { sent.push(p.draftId); await gate; return { ok: true, postId: `x${sent.length}` }; } };
  const { api, store } = setup({ sender });
  await api.setSwitch(post('/switch', { on: true }));
  const a = await ready(api, EVENTS.launch);
  const first = api.approve(post(`/drafts/${a.id}/approve`), a.id);
  while (!sent.length) await new Promise((r) => setTimeout(r, 1));
  assert.equal((await store.get(a.id)).status, 'sending', 'held while the sender works');
  // Meanwhile: the same draft approved again, the switch turned on again — neither sends it a second time.
  const again = await api.approve(post(`/drafts/${a.id}/approve`), a.id);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).draft.status, 'sending');
  await api.setSwitch(post('/switch', { on: true }));
  release();
  assert.equal((await (await first).json()).draft.status, 'sent');
  assert.deepEqual(sent, [a.id]);
});

test('the claim is atomic, needs the switch on, and only a claimed draft is marked', async () => {
  const store = new MemoryDraftStore();
  const { draft } = await store.put({ eventId: 'launch:Z', kind: 'launch', moment: {}, text: 't', link: 'https://ryntra.io/', now: NOW });
  await store.setMedia({ id: draft.id, type: 'video/mp4', bytes: MP4, now: NOW });
  await store.decide({ id: draft.id, decision: 'approved', by: 'operator:1', now: NOW });
  assert.equal(await store.claim({ id: draft.id, now: NOW }), null, 'switch off: no claim');
  assert.equal((await store.delivered({ id: draft.id, delivery: { status: 'sent', note: 'x' }, now: NOW })).status, 'approved', 'not claimed, not marked');
  await store.setSwitch({ on: true, by: 'operator:1', now: NOW });
  const [one, two] = await Promise.all([store.claim({ id: draft.id, now: NOW }), store.claim({ id: draft.id, now: NOW })]);
  assert.equal([one, two].filter(Boolean).length, 1);
  assert.equal((one ?? two).status, 'sending');
  assert.equal((await store.delivered({ id: draft.id, delivery: { status: 'sent', note: 'posted 1' }, now: NOW })).status, 'sent');
  assert.equal(await store.claim({ id: draft.id, now: NOW }), null, 'sent is never claimed again');
});

test('a sender that throws leaves the draft failed, never back in line', async () => {
  const sender = { connected: true, async send() { throw new Error('socket hang up'); } };
  const { api } = setup({ sender });
  await api.setSwitch(post('/switch', { on: true }));
  const a = await ready(api, EVENTS.launch);
  const body = await (await api.approve(post(`/drafts/${a.id}/approve`), a.id)).json();
  assert.equal(body.draft.status, 'failed');
  assert.match(body.draft.note, /socket hang up/);
});

test('a store that fails answers 503, never a half answer', async () => {
  const { DraftStoreUnavailable } = await import('./store.ts');
  const store = new MemoryDraftStore();
  store.list = async () => {
    throw new DraftStoreUnavailable('down');
  };
  const api = createMomentsApi({ store, sender: NO_SENDER, authorize: async () => ({ ok: true, by: 'operator:1', actor: 1 }) });
  assert.equal((await api.list(get('/drafts'))).status, 503);
});
