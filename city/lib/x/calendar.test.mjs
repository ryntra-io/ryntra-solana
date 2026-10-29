// The X calendar (CITY-41): 3–5 posts a day, never the same format twice in a row, words that keep the brand's voice.
//   node --test "city/lib/x/*.test.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DAYS,
  FORMATS,
  MAX_PER_DAY,
  MIN_PER_DAY,
  NEVER,
  WEEK,
  dayOf,
  fillText,
  formatShares,
  mayReply,
  needs,
  neverIn,
  pickEvent,
  planDay,
  slotsFor,
  textProblems,
  weekInOrder,
} from './calendar.ts';

const noRepeats = (slots) => {
  for (let i = 1; i < slots.length; i++) {
    assert.notEqual(slots[i].format, slots[i - 1].format, `${slots[i - 1].day} ${slots[i - 1].utc} → ${slots[i].day} ${slots[i].utc}: ${slots[i].format} twice`);
  }
};

test('every day has 3 to 5 slots, on valid UTC times, in time order', () => {
  for (const day of DAYS) {
    const slots = slotsFor(day);
    assert.ok(slots.length >= MIN_PER_DAY && slots.length <= MAX_PER_DAY, `${day}: ${slots.length} slots`);
    for (const s of slots) {
      assert.match(s.utc, /^([01]\d|2[0-3]):[0-5]\d$/, `${day} ${s.utc}`);
      assert.ok(s.audience.length > 0, `${day} ${s.utc} has an audience`);
    }
    assert.equal(new Set(slots.map((s) => s.utc)).size, slots.length, `${day}: two slots at one time`);
  }
});

test('no two same formats in a row, within a day and across days, Sunday night into Monday included', () => {
  for (const day of DAYS) noRepeats(slotsFor(day));
  const week = weekInOrder();
  noRepeats([...week, week[0]]);
});

test('every audience gets posts every day: the Americas, Europe and Asia', () => {
  for (const day of DAYS) {
    const reached = new Set(slotsFor(day).flatMap((s) => s.audience));
    for (const a of ['americas', 'europe', 'asia']) assert.ok(reached.has(a), `${day} misses ${a}`);
  }
});

test('when events are missing, fallbacks keep 3–5 a day and still no repeats', () => {
  const evergreen = new Set(['tower-hour', 'skyline', 'explainer']);
  const scenarios = {
    'everything has an event': () => true,
    'no launches, agents, quarters, wars or releases': (f) => evergreen.has(f),
    'only Tower of the hour and the skyline': (f) => f === 'tower-hour' || f === 'skyline' || f === 'explainer',
  };
  for (const [name, available] of Object.entries(scenarios)) {
    const week = DAYS.flatMap((d) => planDay(d, available));
    for (const day of DAYS) {
      const n = week.filter((s) => s.day === day).length;
      assert.ok(n >= MIN_PER_DAY && n <= MAX_PER_DAY, `${name}: ${day} has ${n}`);
    }
    noRepeats([...week, week[0]]);
  }
});

test('every format in the week is defined, every defined format is used, rituals are in place', () => {
  const used = new Set(WEEK.map((s) => s.format));
  assert.deepEqual([...used].sort(), Object.keys(FORMATS).sort());
  for (const [id, f] of Object.entries(FORMATS)) {
    assert.equal(f.id, id);
    assert.match(f.template, /^x\.[a-z-]+\.[a-z0-9-]+$/, `${id}: template id is a string for the CITY-38 factory`);
    assert.ok(f.texts.length > 0);
    if (f.pick.fallback) assert.ok(FORMATS[f.pick.fallback], `${id} falls back to a defined format`);
  }
  assert.equal(WEEK.filter((s) => s.format === 'week-in-city').length, 1);
  assert.equal(WEEK.find((s) => s.format === 'week-in-city').day, 'sun');
  assert.equal(WEEK.filter((s) => s.format === 'launch-night').length, 1);
  assert.ok(WEEK.filter((s) => s.format === 'tower-hour').length >= 7, 'Tower of the hour every day');
  for (const day of DAYS) assert.ok(slotsFor(day).some((s) => s.format === 'tower-hour'), `${day} has Tower of the hour`);
  const shares = formatShares();
  assert.equal(shares.reduce((a, s) => a + s.slots, 0), WEEK.length);
  assert.ok(shares[0].share <= 0.4, 'no format takes more than 40% of the week');
});

test('the lineup comes before Launch Night on the same day', () => {
  const thu = WEEK.filter((s) => s.format === 'lineup' || s.format === 'launch-night');
  assert.equal(thu[0].day, thu[1].day);
  assert.equal(thu[0].format, 'lineup');
  assert.ok(thu[0].utc < thu[1].utc);
});

test('every template text keeps the voice once filled, and names the market data source where it has numbers', () => {
  for (const f of Object.values(FORMATS)) {
    for (const text of f.texts) {
      const values = Object.fromEntries(needs(text).map((n) => [n, '12']));
      values.link = 'https://ryntra.io/?coin=BONK';
      const filled = fillText(text.replace(/\{@([a-z]+)\}/g, '@$1'), values);
      assert.deepEqual(neverIn(filled), [], `${f.id}: ${filled}`);
      if (f.involvement.includes('market-data')) assert.match(text, /Market data: Jupiter · not financial advice/);
    }
  }
});

// The brandbook's list, read from the brandbook itself (its voice section), so a word added there is a word NEVER must
// catch; the product's forbidden words for posts come on top. Read as text: a city test imports nothing from scripts/.
const BRANDBOOK = readFileSync(new URL('../../../docs/city/brand/BRANDBOOK.md', import.meta.url), 'utf8');
const BANNED = [...(BRANDBOOK.split('\n').find((l) => l.startsWith('Слова, яких місто не каже:')) ?? '').matchAll(/«([^»]+)»/g)].map((m) => m[1]);
const FORBIDDEN = ['unruggable', 'floor price', 'guaranteed', 'passive income', '100x', 'degen', 'ryntra arc'];

test('the city\'s never-words include every word the brandbook bans and every forbidden word of a post', () => {
  assert.ok(BANNED.length >= 10, `the brandbook's list was read (${BANNED.length} words)`);
  for (const w of [...BANNED, ...FORBIDDEN]) assert.deepEqual(neverIn(`say ${w} here`), [w], `NEVER misses "${w}"`);
  assert.ok(NEVER.global, 'neverIn finds every word, not the first');
});

test('textProblems refuses promises, hype marks, holes, hand-written tags, bare multipliers, length and duplicates', () => {
  const ok = 'Tower of the hour: BONK, +8.2% in the last 60 minutes.\n\nMarket data: Jupiter · not financial advice\nhttps://ryntra.io/?coin=BONK';
  assert.deepEqual(textProblems(ok), []);
  assert.ok(textProblems('BONK to the moon').some((p) => p.includes('to the moon')));
  assert.ok(textProblems('Guaranteed 100x').length >= 2);
  assert.ok(textProblems('New tower!').includes('no exclamation marks'));
  assert.ok(textProblems('New tower \u{1F680}').includes('no emoji'));
  assert.ok(textProblems('Price {price}').some((p) => p.startsWith('unfilled')));
  assert.ok(textProblems('On a {@meteora} curve').includes('a partner tag is not resolved'));
  assert.ok(textProblems('Thanks @MeteoraAG').some((p) => p.startsWith('tags written by hand')));
  assert.deepEqual(textProblems('On a @MeteoraAG curve', [], ['MeteoraAG']), [], 'a tag resolveMentions put in is fine');
  assert.ok(textProblems('@MeteoraAG @JupiterExchange @solana', [], ['MeteoraAG', 'JupiterExchange', 'solana']).includes('at most two partner tags'));
  assert.ok(!textProblems('@MeteoraAG and @JupiterExchange', [], ['MeteoraAG', 'JupiterExchange']).includes('at most two partner tags'));
  assert.ok(textProblems('A degen play').some((p) => p.includes('degen')), 'the product’s forbidden words too');
  assert.ok(textProblems('Visit ryntra.io ' + 'a'.repeat(260)).some((p) => p.startsWith('longer than 280')), 'a bare domain counts as a link');
  assert.ok(textProblems('BONK did 3x today').some((p) => p.includes('multiplier')));
  assert.deepEqual(textProblems('BONK ×3.4 since liftoff').filter((p) => p.includes('multiplier')), []);
  assert.ok(textProblems('#Solana #memecoin').includes('at most one hashtag'));
  assert.ok(textProblems('a'.repeat(281)).some((p) => p.startsWith('longer than 280')));
  assert.ok(textProblems(ok.replace('https://ryntra.io/?coin=BONK', 'https://ryntra.io/'), [ok]).includes('the same text went out before'));
});

test('fillText refuses a hole rather than posting a made-up number', () => {
  assert.throws(() => fillText('{symbol} {change_1h}', { symbol: 'BONK' }), /change_1h/);
  assert.equal(fillText('{symbol} {change_1h}', { symbol: 'BONK', change_1h: '+3%' }), 'BONK +3%');
});

test('pickEvent: verified, thick enough, fresh, not featured lately, biggest move wins', () => {
  const now = new Date('2026-10-27T13:30:00Z');
  const c = (id, extra) => ({ id, kind: 'tower', subject: id, at: '2026-10-27T13:29:00Z', verified: true, liquidityUsd: 1e6, volumeUsd: 1e5, change: 0.05, ...extra });
  const candidates = [
    c('thin', { liquidityUsd: 10_000, change: 0.9 }),
    c('unverified', { verified: false, change: 0.8 }),
    c('stale', { at: '2026-10-27T11:00:00Z', change: 0.7 }),
    c('drop', { change: -0.12 }),
    c('up', { change: 0.09 }),
    c('featured', { change: 0.5 }),
  ];
  const featured = [{ format: 'tower-hour', subject: 'featured', at: '2026-10-27T08:00:00Z' }];
  assert.equal(pickEvent('tower-hour', candidates, now, featured).id, 'drop');
  assert.equal(pickEvent('tower-hour', [], now), null);
  assert.equal(pickEvent('explainer', candidates, now), null, 'editorial slots are a person\'s pick');
});

test('replies only to people who addressed us first, never to search results', () => {
  assert.equal(mayReply({ text: '@Ryntra_io how do towers grow?', foundBy: 'mention' }), true);
  assert.equal(mayReply({ text: 'nice', repliesToUs: true, foundBy: 'reply' }), true);
  assert.equal(mayReply({ text: 'look at this', quotesUs: true, foundBy: 'quote' }), true);
  assert.equal(mayReply({ text: 'anyone know a solana city app', foundBy: 'search' }), false);
  assert.equal(mayReply({ text: '@Ryntra_io hi', foundBy: 'search' }), false);
  assert.equal(mayReply({ text: '@Ryntra_iox hi', foundBy: 'mention' }), false);
});

test('dayOf maps UTC days, Monday first', () => {
  assert.equal(dayOf(new Date('2026-10-26T00:10:00Z')), 'mon');
  assert.equal(dayOf(new Date('2026-11-01T23:59:00Z')), 'sun');
});
