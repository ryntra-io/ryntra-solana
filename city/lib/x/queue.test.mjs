// Run from repo root: node --test "city/lib/x/*.test.mjs"
// A studio post through the real drafts queue (CITY-3): the machine key sends the facts and the clip, the server writes
// the words, a person decides. Nothing reaches the network.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createMomentsApi } from '../moments/drafts/api.ts';
import { createDoor } from '../moments/drafts/door.ts';
import { readPostEvent } from '../moments/drafts/events.ts';
import { NO_SENDER } from '../moments/drafts/sender.ts';
import { MemoryDraftStore } from '../moments/drafts/store.ts';
import { readStudioEvent } from './event.ts';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const at = '2026-10-27T12:00:00.000Z';
const KEY = 'k'.repeat(24);
const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]);
const hour = { template: 'hour', mint: MINT, symbol: '$BONK', district: 'strip', change: 12.5, mcap: 1.8e9, readAt: at, live: true };
const launch = {
  template: 'launch', mint: MINT, network: 'solana:devnet', launchedAt: '2026-10-09T21:50:05Z', launchTx: '2'.repeat(88),
  graduatedAt: '2026-10-09T21:51:16Z', graduateTx: '3'.repeat(88), seconds: 9999, readAt: '2026-10-09T22:16:42.864Z',
};

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

function setup() {
  const store = new MemoryDraftStore();
  const api = createMomentsApi({
    store,
    sender: NO_SENDER,
    now: () => new Date('2026-10-27T12:05:00Z'),
    authorize: createDoor({ secret: () => KEY, sameOrigin: () => true, operator: async () => 1, fresh: async () => ({ ok: true, actor: 1 }) }),
  });
  return { store, api };
}
const send = (api, body, key = KEY) =>
  api.events(new Request('https://ryntra.io/api/moments/events', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));

test('the facts go in with the machine key; the words are the server’s, the clip follows, a person decides', async () => {
  const { api } = setup();
  const res = await send(api, { kind: 'studio', id: 'hour-1', facts: hour });
  assert.equal(res.status, 201);
  const { draft } = await res.json();
  assert.equal(draft.kind, 'studio');
  assert.equal(draft.status, 'filming');
  assert.equal(draft.text, 'Tower of the hour: $BONK grew +12.5% in the last hour, the most of any named tower in the live Solana skyline. Jupiter data, read Oct 27 · 12:00 UTC. Not financial advice. https://ryntra.io/?coin=BONK');
  assert.equal(draft.link, 'https://ryntra.io/?coin=BONK');
  assert.equal(draft.moment.studio.template, 'hour');
  assert.equal(draft.moment.figure, '+12.5%');
  // The same facts are one draft.
  assert.equal((await send(api, { kind: 'studio', id: 'hour-1', facts: hour })).status, 200);
  const put = await api.putClip(new Request(`https://ryntra.io/api/moments/drafts/${draft.id}/clip`, { method: 'PUT', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'video/mp4' }, body: MP4 }), draft.id);
  assert.equal(put.status, 200);
  assert.equal((await put.json()).draft.status, 'ready');
  // The key never approves.
  const approve = await api.approve(new Request(`https://ryntra.io/api/moments/drafts/${draft.id}/approve`, { method: 'POST', headers: { authorization: `Bearer ${KEY}` } }), draft.id);
  assert.equal(approve.status, 403);
});

test('a sender’s own words never reach a draft: every field read, the launch’s seconds from its block times', async () => {
  const { api } = setup();
  const bad = [
    { ...hour, symbol: '@jupiter' },
    { ...hour, symbol: '$BONK https://x.co' },
    { ...hour, district: 'docks' },
    { ...hour, change: -3 },
    { ...hour, readAt: 'now' },
    { ...hour, template: 'giveaway' },
    { ...launch, network: 'solana:testnet' },
    { ...launch, launchTx: 'abc' },
    { template: 'billboard', ranking: 'week', from: null, readAt: at, live: true, rows: [] },
  ];
  for (const facts of bad) assert.equal((await send(api, { kind: 'studio', id: 'x', facts })).status, 400, JSON.stringify(facts));
  const read = readStudioEvent({ id: 'night', facts: launch });
  assert.equal(read.ok && read.event.facts.seconds, 71, 'the sent 9999 is ignored');
  const res = await send(api, { kind: 'studio', id: 'night', facts: launch });
  const { draft } = await res.json();
  assert.match(draft.text, / 71 s later /);
  assert.equal(draft.moment.symbol, null, 'a Ryntra launch is not a verified coin: never named');
  assert.ok(readPostEvent({ kind: 'studio', id: 'x', facts: hour }).ok);
});
