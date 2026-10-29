// Run from repo root: node --test "city/lib/moments/*.test.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dayLabel, momentFileName, momentFromCityEvent, momentFromRun, momentFromWorldEvent, momentText, nameOf, sourceTime } from './moment.ts';

const city = JSON.parse(readFileSync(new URL('../market/snapshot.json', import.meta.url), 'utf8'));
const towers = city.towers;
const dock = towers.find((t) => t.district === 'docks' && !t.verified && t.launchedAt);
const bonk = towers.find((t) => t.symbol === 'Bonk');
const at = '2026-10-26T14:02:00Z';
const engine = (kind, subject, payload = {}, sourceAt = at) => ({ id: 'e', at, source: 'engine', kind, subject, sourceAt, payload });

/** Words the city never uses about money: hype comes only from things that happened. */
const PROMISES = /\b(moon|mooning|100x|1000x|guarantee|guaranteed|risk[- ]free|easy money|to the moon|lambo|pump it|send it|not a scam)\b/i;

test('a new pool in the docks is a launch moment, anonymous, timed by its pool and not by the read', () => {
  const m = momentFromCityEvent({ id: 1, kind: 'launch', towerId: dock.id, symbol: '', value: 'UNVERIFIED', title: 'NEW TOWER', at: Date.now() }, towers);
  assert.equal(m.kind, 'launch');
  assert.equal(m.symbol, null);
  assert.equal(m.title, 'NEW TOWER');
  assert.equal(m.figure, 'UNVERIFIED · NEW POOL');
  assert.equal(m.sourceAt, new Date(dock.launchedAt).toISOString());
  assert.equal(m.source, 'Jupiter');
  assert.doesNotMatch(JSON.stringify(m), new RegExp(dock.symbol.replace(/[^a-z0-9]/gi, '') || '\u0000', 'i'), 'the pool is never named');
});

test('weather is not a feat: pumps and flares make no moment, nor a pool without a creation time', () => {
  for (const kind of ['pump', 'flare']) assert.equal(momentFromCityEvent({ id: 1, kind, towerId: bonk.id, symbol: 'Bonk', value: '+5%', title: 'PUMP', at: Date.now() }, towers), null);
  const timeless = { ...dock, launchedAt: null };
  assert.equal(momentFromCityEvent({ id: 1, kind: 'launch', towerId: dock.id, symbol: '', value: '', title: '', at: Date.now() }, [timeless]), null);
});

test('engine moments: a Ryntra launch, its graduation and its day 7, 30 and 90 checks', () => {
  const launch = momentFromWorldEvent(engine('launch', dock.id), towers);
  assert.deepEqual([launch.kicker, launch.title, launch.source, launch.fx], ['RYNTRA LAUNCH', 'NEW TOWER', 'Ryntra Launch', 'launch']);
  const graduate = momentFromWorldEvent(engine('graduate', dock.id), towers);
  assert.deepEqual([graduate.kicker, graduate.title], ['GRADUATED', 'A RYNTRA LAUNCH']);
  assert.match(graduate.figure, /\$75K/);
  assert.match(graduate.figure, /DAMM V2/);
  for (const day of [7, 30, 90]) {
    const s = momentFromWorldEvent(engine('survival', bonk.id, { day, holders: 1204 }), towers);
    assert.equal(s.kicker, `SURVIVED DAY ${day}`);
    assert.equal(s.title, '$BONK', 'a verified coin is named');
    assert.equal(s.figure, `1,204 HOLDERS · DAY ${day} CHECK`);
  }
  assert.equal(momentFromWorldEvent(engine('survival', bonk.id, { day: 14 }), towers), null, 'only the days the engine checks');
  assert.equal(momentFromWorldEvent({ ...engine('graduate', dock.id), source: 'market' }, towers), null, 'graduations come only from the engine');
  assert.equal(momentFromWorldEvent(engine('graduate', 'NoSuchMint111111111111111111111111111111111'), towers), null, 'a coin not in the city');
});

test('a moment without its source time is never made', () => {
  for (const sourceAt of ['', 'yesterday', undefined]) assert.equal(momentFromWorldEvent({ ...engine('graduate', dock.id), sourceAt }, towers), null);
});

test('a district war names the district and counts verified actions, never buys', () => {
  const war = momentFromWorldEvent({ ...engine('war', 'strip', { actions: 3412 }), source: 'world' }, towers);
  assert.deepEqual([war.kicker, war.title, war.figure, war.district], ['DISTRICT WAR', 'MEME STRIP', 'WON THE WEEK · 3,412 VERIFIED ACTIONS', 'strip']);
  assert.ok(towers.find((t) => t.id === war.towerId)?.verified, 'the camera flies to a named tower of the district');
  const world = momentFromWorldEvent({ ...engine('war', 'downtown'), source: 'world' }, towers);
  assert.equal(world.district, 'core', "a world district stands by the skyline's own");
  assert.equal(momentFromWorldEvent({ ...engine('war', 'atlantis'), source: 'world' }, towers), null);
});

test('a run: a record says so, any finish can challenge, a crash or a time out of range cannot', () => {
  const record = momentFromRun({ time: 39.92, newBest: true, form: 'flight', day: '2026-10-26', course: 'c' });
  assert.deepEqual([record.kicker, record.title, record.figure], ['NEW RECORD', '39.9 S', 'OCT 26 COURSE · FLIGHT']);
  const finish = momentFromRun({ time: 41.5, newBest: false, form: 'roofs', day: '2026-10-26', course: 'c' });
  assert.deepEqual([finish.kicker, finish.figure], ['SKYLINE RUN', 'OCT 26 COURSE · ROOFTOPS']);
  assert.equal(momentFromRun({ time: 0, newBest: false, form: 'roofs', day: '2026-10-26', course: 'c' }), null);
  assert.equal(momentFromRun({ time: 900, newBest: false, form: 'roofs', day: '2026-10-26', course: 'c' }), null);
});

test('the words: plain facts with a link, short enough for X, never a promise', () => {
  const link = `https://ryntra.io/#c=${'A'.repeat(2600)}`;
  const moments = [
    momentFromCityEvent({ id: 1, kind: 'launch', towerId: dock.id, symbol: '', value: '', title: '', at: Date.now() }, towers),
    momentFromWorldEvent(engine('graduate', bonk.id), towers),
    momentFromWorldEvent(engine('survival', dock.id, { day: 30 }), towers),
    momentFromWorldEvent({ ...engine('war', 'heights', { actions: 12 }), source: 'world' }, towers),
    momentFromRun({ time: 39.92, newBest: true, form: 'flight', day: '2026-10-26', course: 'c' }),
  ];
  for (const m of moments) {
    for (const words of [momentText(m), momentText(m, link)]) {
      assert.doesNotMatch(words, PROMISES);
      // X counts any link as 23 characters.
      const counted = words.replace(/https?:\/\/\S+/g, 'x'.repeat(23));
      assert.ok(counted.length <= 280, `${counted.length}: ${words.slice(0, 80)}`);
    }
    assert.doesNotMatch(`${m.kicker} ${m.title} ${m.figure}`, PROMISES);
    assert.match(momentText(m), /ryntra\.io$/);
  }
  assert.equal(momentText(moments[4], 'https://ryntra.io/#c=abc'), 'New record: 39.9 s through the live Solana skyline. Beat my run: https://ryntra.io/#c=abc');
  assert.match(momentText(moments[2]), /^A Ryntra launch survived day 30/, 'an unverified coin is not named in the words either');
});

test('names, days and files', () => {
  assert.equal(nameOf(bonk), '$BONK');
  assert.equal(nameOf(dock), null);
  assert.equal(dayLabel('2026-10-26'), 'OCT 26');
  assert.equal(sourceTime('2026-10-26T09:05:00Z'), 'OCT 26 · 09:05 UTC');
  assert.equal(sourceTime('nope'), '');
  const m = momentFromWorldEvent(engine('survival', bonk.id, { day: 7 }), towers);
  assert.equal(momentFileName(m, 'mp4'), 'ryntra-survival-bonk-2026-10-26.mp4');
});
