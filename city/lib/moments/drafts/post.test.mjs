// Run from repo root: node --test "city/lib/moments/drafts/*.test.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { postFromCityEvent, LAUNCH_VALUE, SKYLINE_TITLE } from './city-events.ts';
import { momentForPost, readPostEvent } from './events.ts';
import { postLink, postText, X_MAX, xLength } from './post.ts';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const TX = '4'.repeat(88);
const at = '2026-10-27T12:00:00Z';
const base = { mint: BONK, symbol: 'BONK', named: true, district: 'docks', sourceAt: at };

/** Words the city never uses about money: hype comes only from things that happened. */
const PROMISES = /\b(moon|mooning|100x|1000x|guarantee|guaranteed|risk[- ]free|easy money|to the moon|lambo|pump it|send it|not a scam|buy now|ape in|don'?t miss)\b/i;

const moment = (e) => {
  const read = readPostEvent(e);
  assert.ok(read.ok, JSON.stringify(read));
  return momentForPost(read.event);
};

const FOUR = {
  launch: { ...base, kind: 'launch', id: 'L1' },
  graduate: { ...base, kind: 'graduate', id: 'G1' },
  bigx: { ...base, kind: 'bigx', id: 'X1', multiple: 12.4, tx: TX },
  agent: { ...base, kind: 'agent', id: 'A1', agent: 'Scout 7', rule: 'liquidity doubled', change: 42, window: '1H' },
};

test('the four posts: plain facts with their window and source, the link, within what X holds', () => {
  const words = Object.fromEntries(Object.entries(FOUR).map(([k, e]) => [k, postText(moment(e))]));
  assert.equal(words.launch, '$BONK launched on Ryntra and rose as a new tower in the Launch Docks of the live Solana skyline. https://ryntra.io/?coin=BONK');
  assert.equal(words.graduate, '$BONK graduated: past $75K on its curve, now a DAMM v2 pool with its liquidity locked. https://ryntra.io/?coin=BONK');
  assert.equal(words.bigx, '$BONK: a trade in Ryntra City closed at 12.4x its entry, on chain. https://ryntra.io/?coin=BONK');
  assert.equal(words.agent, 'A Ryntra agent spotted $BONK in the live Solana skyline: +42.0% · 1h · liquidity doubled. A lead to check, not advice. https://ryntra.io/?coin=BONK');
  for (const [kind, text] of Object.entries(words)) {
    assert.doesNotMatch(text, PROMISES, kind);
    assert.ok(xLength(text) <= X_MAX, kind);
  }
});

test('the clip’s recipe is the moment: the tower, its effect and its real figure with the source time', () => {
  const m = moment(FOUR.graduate);
  assert.equal(m.kind, 'graduate');
  assert.equal(m.towerId, BONK);
  assert.equal(m.figure, 'PAST $75K ON THE CURVE · NOW A DAMM V2 POOL');
  assert.equal(m.sourceAt, '2026-10-27T12:00:00.000Z');
  assert.equal(moment(FOUR.bigx).figure, '12.4X · ENTRY TO EXIT · ON CHAIN');
  assert.equal(moment({ ...FOUR.bigx, multiple: 240.6 }).figure, '241X · ENTRY TO EXIT · ON CHAIN');
  assert.equal(moment(FOUR.agent).kicker, 'SCOUT 7 FOUND');
  assert.equal(moment({ ...FOUR.agent, change: -12 }).fx, 'flare');
});

test('a big x never names the trader and needs at least 5x; a win or find of an unverified coin is no post', () => {
  const m = moment(FOUR.bigx);
  assert.doesNotMatch(`${m.kicker} ${m.title} ${m.figure} ${postText(m)}`, new RegExp(TX), 'the transaction stays out of the words');
  assert.ok(m.id.includes(TX), 'only the id keeps it, so the same trade is one draft');
  assert.equal(moment({ ...FOUR.bigx, multiple: 4.9 }), null);
  assert.equal(moment({ ...FOUR.bigx, named: false }), null);
  assert.equal(moment({ ...FOUR.agent, named: false }), null);
  // An unnamed launch is still news of Ryntra, said without the coin.
  const anon = moment({ ...FOUR.launch, named: false });
  assert.equal(anon.symbol, null);
  assert.equal(postText(anon), 'A new coin launched on Ryntra and rose as a new tower in the Launch Docks of the live Solana skyline. https://ryntra.io/');
  assert.equal(postLink(anon), 'https://ryntra.io/');
});

test('an event is read field by field: no links, handles or tags slip into the words', () => {
  const bad = [
    [{ ...FOUR.agent, rule: '@someone says buy' }, 'rule'],
    [{ ...FOUR.agent, agent: 'http://x' }, 'agent'],
    [{ ...FOUR.agent, window: '2H' }, 'window'],
    [{ ...FOUR.launch, symbol: 'BONK #1' }, 'symbol'],
    [{ ...FOUR.launch, district: 'moon' }, 'district'],
    [{ ...FOUR.launch, sourceAt: 'yesterday' }, 'sourceAt'],
    [{ ...FOUR.launch, id: 'a b' }, 'id'],
    [{ ...FOUR.bigx, tx: 'abc' }, 'tx'],
    [{ ...FOUR.bigx, multiple: '12' }, 'multiple'],
    [[], 'not_an_object'],
  ];
  for (const [e, field] of bad) assert.deepEqual(readPostEvent(e), { ok: false, error: field }, field);
  // A symbol alone does not name a coin.
  assert.equal(readPostEvent({ ...FOUR.launch, symbol: '', named: true }).event.named, false);
});

test('X counts a link as 23; a figure that grew is cut before the link, never past 280', () => {
  assert.equal(xLength('hi https://ryntra.io/?coin=AVERYLONGTICKER'), 3 + 23);
  const long = { ...moment(FOUR.agent), figure: `+1.0% · 1H · ${'LONG RULE '.repeat(40)}` };
  const text = postText(long);
  assert.ok(xLength(text) <= X_MAX, String(xLength(text)));
  assert.ok(text.endsWith(' https://ryntra.io/?coin=BONK'));
});

test('the city’s own feed: a Ryntra launch and its move into the skyline, nothing else', () => {
  const tower = { id: BONK, symbol: 'BONK', district: 'docks', verified: false };
  const ev = (kind, title, value) => ({ id: 1, kind, towerId: BONK, symbol: 'BONK', title, value, at: Date.parse(at) });
  const launch = postFromCityEvent(ev('launch', 'New tower', LAUNCH_VALUE), tower);
  assert.deepEqual(launch, { kind: 'launch', id: BONK, mint: BONK, symbol: '', named: false, district: 'docks', sourceAt: '2026-10-27T12:00:00.000Z' });
  assert.equal(postFromCityEvent(ev('pump', SKYLINE_TITLE, 'POOL OPEN'), { ...tower, verified: true, district: 'strip' }).kind, 'graduate');
  assert.equal(postFromCityEvent(ev('pump', SKYLINE_TITLE, 'POOL OPEN'), { ...tower, verified: true }).named, true);
  assert.equal(postFromCityEvent(ev('launch', 'NEW TOWER', 'UNVERIFIED'), tower), null, 'a new pool elsewhere is weather');
  assert.equal(postFromCityEvent(ev('pump', 'PUMP', '+12% · 1H'), tower), null);
  assert.equal(postFromCityEvent(ev('flare', 'SOLAR FLARE', '−9% · 1H'), tower), null);
  assert.equal(postFromCityEvent({ ...ev('launch', 'x', LAUNCH_VALUE), towerId: 'stub-1' }, tower), null);
});

test('the words the feed matches are the launch line’s own', () => {
  const source = readFileSync(new URL('../../launch/moments.ts', import.meta.url), 'utf8');
  assert.ok(source.includes(`value: '${LAUNCH_VALUE}'`));
  assert.ok(source.includes(`title: '${SKYLINE_TITLE}'`));
});
