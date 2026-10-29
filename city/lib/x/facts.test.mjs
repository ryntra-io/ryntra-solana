// Run from repo root: node --test "city/lib/x/*.test.mjs"
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { cityVolume, isFresh, launchNight, newInCore, pct, readTime, sourcesOf, towerOfHour, usd, weekBillboard } from './facts.ts';

/** The city's bundled read (`../market/bundled.ts` imports it as JSON). */
const BUNDLED_CITY = JSON.parse(readFileSync(new URL('../market/snapshot.json', import.meta.url), 'utf8'));
const at = '2026-10-27T12:00:00.000Z';
const mint = (c) => c.repeat(43) + 'A';
const tower = (id, o = {}) => ({
  id, symbol: 'T', name: 'T', icon: null, district: 'strip', price: 1, mcap: 1e6, liquidity: 1e5, holders: 10,
  change5m: 0, change1h: 0, change24h: 0, volume24h: 1e5, traders1h: 1, organic: 50, verified: true, launchedAt: null, ...o,
});
const snap = (towers, fetchedAt = at, source = 'live') => ({ towers, fetchedAt, source });
const SIG_A = '2'.repeat(88);
const SIG_B = '3'.repeat(88);

test('the tower of the hour: the named tower that grew the most in the hour, never the docks, never an unverified coin', () => {
  const s = snap([
    tower(mint('a'), { symbol: 'SLOW', change1h: 3 }),
    tower(mint('b'), { symbol: 'fast', change1h: 12.34, mcap: 2.7e6 }),
    tower(mint('c'), { symbol: 'NEW', change1h: 400, district: 'docks' }),
    tower(mint('d'), { symbol: 'ANON', change1h: 90, verified: false }),
    tower(mint('e'), { symbol: 'X Y', change1h: 50 }),
  ]);
  const f = towerOfHour(s);
  assert.equal(f.symbol, '$FAST');
  assert.equal(f.change, 12.34);
  assert.equal(f.readAt, at);
  assert.equal(f.live, true);
  // Only towers the clip can fly to.
  assert.equal(towerOfHour(s, (id) => id !== mint('b')).symbol, '$SLOW');
  // Nothing grew: no post.
  assert.equal(towerOfHour(snap([tower(mint('a'), { change1h: -2 })])), null);
  assert.equal(towerOfHour(snap([tower(mint('a'), { change1h: 5 })], 'yesterday')), null);
});

test('JUST IN: the city’s 24h volume summed over its towers, and a new named tower in Sol Core between two reads', () => {
  const s = snap([tower(mint('a'), { volume24h: 2e9 }), tower(mint('b'), { volume24h: 1.07e9 }), tower(mint('c'), { volume24h: 0 })]);
  const v = cityVolume(s);
  assert.equal(v.value, 3.07e9);
  assert.equal(v.towers, 3);
  assert.equal(usd(v.value), '$3.07B');
  const before = snap([tower(mint('a'), { district: 'core' }), tower(mint('b'))], '2026-10-27T11:00:00.000Z');
  const after = snap([tower(mint('a'), { district: 'core' }), tower(mint('b'), { district: 'core', symbol: 'jup', mcap: 9e8 })]);
  const c = newInCore(before, after);
  assert.equal(c.metric, 'core');
  assert.equal(c.symbol, '$JUP');
  assert.equal(newInCore(after, before), null, 'reads in the wrong order say nothing');
  assert.equal(newInCore(before, before), null);
});

test('Launch Night needs both transactions of the flight log: the launch and the graduation into the pool', () => {
  const j = {
    network: 'solana:devnet', token: mint('z'), observedAt: '2026-10-09T22:16:42.864Z',
    events: [
      { kind: 'FEES_SHARED', at: '2026-10-09T21:50:30Z', signature: SIG_A },
      { kind: 'GRADUATED', at: '2026-10-09T21:51:16Z', signature: SIG_B },
      { kind: 'LAUNCHED', at: '2026-10-09T21:50:05Z', signature: SIG_A },
    ],
  };
  const f = launchNight(j);
  assert.equal(f.seconds, 71);
  assert.equal(f.launchTx, SIG_A);
  assert.equal(f.graduateTx, SIG_B);
  assert.equal(launchNight({ ...j, events: j.events.filter((e) => e.kind !== 'GRADUATED') }), null, 'still on its curve: not yet a night');
  assert.equal(launchNight({ ...j, network: 'solana:testnet' }), null);
  assert.equal(launchNight({ ...j, events: [{ ...j.events[2], signature: 'abc' }, j.events[1]] }), null, 'a transaction must be one');
  assert.equal(launchNight({ ...j, events: [{ ...j.events[2], at: '2026-10-09T21:52:00Z' }, j.events[1]] }), null, 'never a negative night');
});

test('the week’s billboard compares a read 6–8 days old; without one it ranks one read by volume and says so', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map(mint);
  const now = snap(ids.map((id, i) => tower(id, { symbol: `S${i}`, price: 1 + i, volume24h: 1e6 * (6 - i) })));
  const old = snap(ids.map((id) => tower(id, { price: 1 })), '2026-10-20T11:00:00.000Z');
  const tooOld = snap(ids.map((id) => tower(id, { price: 100 })), '2026-10-10T12:00:00.000Z');
  const w = weekBillboard(now, [tooOld, old]);
  assert.equal(w.ranking, 'week');
  assert.equal(w.from, '2026-10-20T11:00:00.000Z');
  assert.deepEqual(w.rows.map((r) => r.symbol), ['$S5', '$S4', '$S3', '$S2', '$S1']);
  assert.equal(pct(w.rows[0].value), '+500.0%');
  const v = weekBillboard(now, [tooOld]);
  assert.equal(v.ranking, 'volume');
  assert.equal(v.from, null);
  assert.deepEqual(v.rows.map((r) => r.symbol), ['$S0', '$S1', '$S2', '$S3', '$S4']);
  assert.equal(weekBillboard(snap(now.towers.slice(0, 3)), []), null, 'five towers or no billboard');
});

test('every number carries its source and read time; a bundled read says it is one', () => {
  const live = towerOfHour(snap([tower(mint('a'), { symbol: 'BONK', change1h: 4.2 })]));
  const bundled = towerOfHour(snap([tower(mint('a'), { symbol: 'BONK', change1h: 4.2 })], at, 'snapshot'));
  for (const s of sourcesOf(live)) {
    assert.equal(s.readAt, at);
    assert.equal(s.source, 'Jupiter Tokens API v2');
  }
  assert.match(sourcesOf(bundled)[0].source, /bundled read/);
  assert.equal(readTime(at), 'OCT 27 · 12:00 UTC');
  assert.equal(pct(-4), '−4.0%');
});

test('facts go into the queue only while fresh for their template', () => {
  const f = towerOfHour(snap([tower(mint('a'), { change1h: 4.2 })]));
  assert.equal(isFresh(f, new Date('2026-10-27T13:30:00Z')), true);
  assert.equal(isFresh(f, new Date('2026-10-27T15:00:00Z')), false, 'the last hour, three hours later, is not news');
  assert.equal(isFresh(f, new Date('2026-10-27T11:00:00Z')), false, 'a read from the future is wrong');
});

test('the bundled city makes every market template', () => {
  assert.ok(towerOfHour(BUNDLED_CITY));
  assert.ok(cityVolume(BUNDLED_CITY));
  assert.equal(weekBillboard(BUNDLED_CITY, []).ranking, 'volume');
});
