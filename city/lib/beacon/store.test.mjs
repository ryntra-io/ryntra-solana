import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { conditionOf, lineText, parseLine, suggestLine } from './form.ts';
import { beaconsOn, refreshGlow, setBeaconEnv, useBeacons } from './store.ts';

/*
 * The city's beacons: kept on the device at once, adopted by the account after a sign-in, checked on every market
 * read, lit when one fires, dark again half an hour later; a list changed on another device wins over this one.
 */

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const T0 = Date.parse('2026-10-28T12:00:00.000Z');

const rule = (over = {}) => ({
  id: 'beacon01', version: 1, groups: [[{ kind: 'price', op: 'above', value: 1.1 }]], holdSeconds: 0, hysteresis: 0.002,
  cooldownSeconds: 3600, repeat: true, expiresAt: null, quiet: null, on: true, createdAt: T0, mint: MINT, symbol: 'BONK', notify: true, ...over,
});

const snapshot = (price, at, source = 'live') => ({
  towers: [{ id: MINT, symbol: 'BONK', name: 'Bonk', icon: null, district: 'core', price, mcap: 1, liquidity: 1e6, holders: 1, change5m: 0, change1h: 0, change24h: 0, volume24h: 0, traders1h: 0, organic: 50, verified: true, launchedAt: null }],
  fetchedAt: new Date(at).toISOString(),
  source,
});

let clock;
let disk;
let calls;
let server;

const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  clock = T0;
  disk = new Map();
  calls = [];
  server = { revision: 0, rules: [], states: {}, telegram: 'unlinked', down: false };
  setBeaconEnv({
    server: true,
    now: () => clock,
    storage: () => ({ getItem: (k) => disk.get(k) ?? null, setItem: (k, v) => disk.set(k, v) }),
    open: (url) => calls.push({ open: url }),
    fetch: async (url, init = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
      if (server.down) return answer(503, { error: { code: 'UNAVAILABLE' } });
      if (url === '/api/account/notifications') return answer(200, { ok: true, link: 'https://t.me/ryntra_bot?start=abc' });
      if (init.method === 'POST') {
        const body = JSON.parse(init.body);
        if (body.revision !== server.revision) return answer(409, { error: { code: 'VERSION_CONFLICT' }, revision: server.revision, rules: server.rules, states: server.states });
        server.revision += 1;
        server.rules = body.rules;
        return answer(200, { revision: server.revision, rules: server.rules, states: server.states });
      }
      return answer(200, { revision: server.revision, rules: server.rules, states: server.states, telegram: server.telegram });
    },
  });
  useBeacons.setState({ rules: [], states: {}, revision: null, sync: 'local', signedIn: false, telegram: null, openFor: null, glow: new Map(), loaded: false });
});

test('a visitor keeps beacons on the device; a reload brings them back', async () => {
  useBeacons.getState().load();
  assert.equal(await useBeacons.getState().save([rule()]), true);
  assert.equal(calls.length, 0, 'not signed in: nothing goes to the server');
  assert.equal(useBeacons.getState().glow.get(MINT), 'set');
  useBeacons.setState({ rules: [], loaded: false });
  useBeacons.getState().load();
  assert.equal(useBeacons.getState().rules.length, 1);
  assert.deepEqual(beaconsOn(useBeacons.getState().rules, MINT).map((r) => r.id), ['beacon01']);
});

test('a sign-in adopts the device beacons when the account has none, then saves at the server revision', async () => {
  useBeacons.getState().load();
  await useBeacons.getState().save([rule()]);
  await useBeacons.getState().pull(true);
  assert.equal(server.revision, 1);
  assert.equal(server.rules.length, 1);
  assert.equal(useBeacons.getState().sync, 'synced');
  assert.equal(useBeacons.getState().telegram, 'unlinked');
  await useBeacons.getState().save([rule(), rule({ id: 'beacon02' })]);
  assert.equal(server.revision, 2);
  assert.equal(useBeacons.getState().revision, 2);
});

test('the account wins over the device; a list changed elsewhere replaces this one', async () => {
  server.revision = 4;
  server.rules = [rule({ id: 'server01' })];
  useBeacons.getState().load();
  await useBeacons.getState().save([rule()]);
  await useBeacons.getState().pull(true);
  assert.deepEqual(useBeacons.getState().rules.map((r) => r.id), ['server01']);
  server.revision = 5;
  server.rules = [rule({ id: 'server02' })];
  assert.equal(await useBeacons.getState().save([rule()]), false);
  assert.deepEqual(useBeacons.getState().rules.map((r) => r.id), ['server02']);
  assert.equal(useBeacons.getState().revision, 5);
});

test('the server down: beacons stay on the device and keep working', async () => {
  server.down = true;
  useBeacons.getState().load();
  await useBeacons.getState().pull(true);
  assert.equal(useBeacons.getState().revision, null);
  assert.equal(await useBeacons.getState().save([rule()]), true);
  assert.equal(useBeacons.getState().sync, 'local');
  assert.equal(useBeacons.getState().rules.length, 1);
});

test('every market read checks the beacons: lit on the crossing, dark again after half an hour; a snapshot fires nothing', async () => {
  useBeacons.getState().load();
  await useBeacons.getState().save([rule()]);
  useBeacons.getState().check(snapshot(1.2, clock, 'snapshot'));
  useBeacons.getState().check(snapshot(1, clock));
  clock += 60_000;
  useBeacons.getState().check(snapshot(1.2, clock, 'snapshot'));
  assert.equal(useBeacons.getState().glow.get(MINT), 'set', 'the bundled snapshot is not a reading');
  clock += 60_000;
  useBeacons.getState().check(snapshot(1.2, clock));
  assert.equal(useBeacons.getState().glow.get(MINT), 'lit');
  clock += 31 * 60_000;
  refreshGlow();
  assert.equal(useBeacons.getState().glow.get(MINT), 'set');
});

test('Telegram: the bot link opens in a new tab, only a t.me link', async () => {
  assert.equal(await useBeacons.getState().linkTelegram(), true);
  assert.deepEqual(calls.at(-1), { open: 'https://t.me/ryntra_bot?start=abc' });
  assert.deepEqual(calls.at(-2).body, { action: 'start' });
});

test('the editor field reads what people type', () => {
  assert.equal(parseLine('$1,200'), 1200);
  assert.equal(parseLine('1.5M'), 1_500_000);
  assert.equal(parseLine('−5%'), -5);
  assert.equal(parseLine('.00002'), 0.00002);
  assert.equal(parseLine('abc'), null);
  assert.equal(parseLine(''), null);
  assert.equal(lineText(0.0000246), '0.0000246');
  assert.equal(lineText(0.00000012), '0.00000012');
  assert.equal(lineText(1500000), '1500000');
  assert.equal(suggestLine('move', 'below', '1h', { price: 1, liquidity: 1, change5m: 0, change1h: 0, change24h: 0 }), -5);
  assert.equal(suggestLine('liquidity', 'above', '1h', { price: 1, liquidity: 2_000_000, change5m: 0, change1h: 0, change24h: 0 }), 2_100_000);
  assert.deepEqual(conditionOf('move', 'below', '24h', '-8'), { kind: 'move', period: '24h', op: 'below', value: -8 });
  assert.equal(conditionOf('price', 'above', '1h', '-1'), null, 'a price is above zero');
});

test('a build where the account keeps no beacons: the device keeps them, the server is never asked', async () => {
  setBeaconEnv({ server: false });
  try {
    useBeacons.getState().load();
    await useBeacons.getState().pull(true);
    assert.equal(useBeacons.getState().sync, 'local');
    assert.equal(useBeacons.getState().revision, null);
    assert.equal(await useBeacons.getState().save([rule()]), true);
    assert.equal(await useBeacons.getState().linkTelegram(), false);
    assert.deepEqual(calls, [], 'no call to the beacons or Telegram');
    assert.equal(useBeacons.getState().rules.length, 1);
  } finally {
    setBeaconEnv({ server: true });
  }
});
