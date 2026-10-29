// Run from repo root: node --test "city/lib/x/*.test.mjs"
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SLOTS, KEY_NAMES, readXConfig } from './config.ts';
import { hasLink, postCost, sumUsd, X_PRICE_USD } from './pricing.ts';
import { daySlots, dueSlot, localTime, parseSlots, SLOT_WINDOW_MIN } from './schedule.ts';

const KYIV = 'Europe/Kyiv';
const slots = (spec = DEFAULT_SLOTS, tz = KYIV) => {
  const r = parseSlots(spec, tz);
  assert.ok(r.ok, r.error);
  return r.slots;
};
// 27.10.2026: Kyiv is on winter time since 25.10, UTC+2.
const kyiv = (hhmm, day = '2026-10-27') => new Date(`${day}T${hhmm}:00+02:00`);

test('3 to 5 times a day, HH:MM, an hour apart at least, in a real zone', () => {
  assert.deepEqual(slots('21:00, 11:00,15:00,18:00').times, [660, 900, 1080, 1260], 'sorted');
  assert.ok(parseSlots('09:00,12:00,15:00,18:00,21:00', KYIV).ok, 'five');
  assert.ok(parseSlots('09:00,15:00,21:00', KYIV).ok, 'three');
  assert.match(parseSlots('09:00,15:00', KYIV).error, /3 to 5 times, has 2/);
  assert.match(parseSlots('08:00,10:00,12:00,14:00,16:00,18:00', KYIV).error, /has 6/);
  assert.match(parseSlots('09:00,09:30,15:00', KYIV).error, /09:00 and 09:30 under 60 minutes/);
  assert.match(parseSlots('00:10,12:00,23:50', KYIV).error, /23:50 and 00:10 under 60 minutes/, 'across midnight too');
  assert.match(parseSlots('9am,12:00,15:00', KYIV).error, /"9am", not HH:MM/);
  assert.match(parseSlots('24:00,12:00,15:00', KYIV).error, /not HH:MM/);
  assert.match(parseSlots('09:00,12:00,15:00', 'Mars/Olympus').error, /not a time zone/);
});

test('a slot is due for 45 minutes from its time, in the zone’s own clock', () => {
  const s = slots();
  assert.equal(dueSlot(kyiv('10:59'), s), null);
  assert.deepEqual(dueSlot(kyiv('11:00'), s), { key: '2026-10-27 11:00', day: '2026-10-27', time: '11:00' });
  assert.equal(dueSlot(kyiv('11:44'), s)?.key, '2026-10-27 11:00');
  assert.equal(dueSlot(kyiv(`11:${SLOT_WINDOW_MIN}`), s), null, 'the window closes');
  assert.equal(dueSlot(kyiv('18:10'), s)?.key, '2026-10-27 18:00');
  assert.equal(dueSlot(new Date('2026-10-27T19:05:00Z'), s)?.key, '2026-10-27 21:00', '19:05 UTC is 21:05 in Kyiv');
  assert.equal(dueSlot(new Date('2026-10-27T19:05:00Z'), slots(DEFAULT_SLOTS, 'UTC')), null, 'the same instant in UTC is no slot');
});

test('a window open across midnight belongs to the day it opened', () => {
  const s = slots('08:00,14:00,23:30');
  assert.equal(dueSlot(kyiv('23:40'), s)?.key, '2026-10-27 23:30');
  assert.deepEqual(dueSlot(kyiv('00:10', '2026-10-28'), s), { key: '2026-10-27 23:30', day: '2026-10-27', time: '23:30' });
  assert.equal(dueSlot(kyiv('00:15', '2026-10-28'), s), null);
  assert.equal(dueSlot(kyiv('00:10', '2026-11-01'), s)?.key, '2026-10-31 23:30', 'across a month');
});

test('the day’s slots: ahead, open, over', () => {
  const s = slots();
  assert.deepEqual(daySlots('2026-10-27', kyiv('15:20'), s).map((x) => x.window), ['over', 'open', 'ahead', 'ahead']);
  assert.deepEqual(daySlots('2026-10-26', kyiv('15:20'), s).map((x) => x.window), ['over', 'over', 'over', 'over']);
  assert.deepEqual(localTime(kyiv('15:20'), KYIV), { day: '2026-10-27', minutes: 920 });
});

test('without the switch and the keys the sender is not connected, and says why', () => {
  const none = readXConfig({});
  assert.equal(none.connected, false);
  assert.match(none.reason, /^X not connected: the sender is off/);
  assert.equal(none.keys, null);
  assert.deepEqual(none.slots.times, [660, 900, 1080, 1260]);
  assert.equal(none.slots.tz, KYIV);
  assert.equal(none.dailyUsd, 1);

  const switchOnly = readXConfig({ RYNTRA_X_SENDER: 'on', RYNTRA_X_API_KEY: 'a' });
  assert.equal(switchOnly.connected, false);
  assert.equal(switchOnly.reason, 'X not connected: missing RYNTRA_X_API_SECRET, RYNTRA_X_ACCESS_TOKEN, RYNTRA_X_ACCESS_SECRET.');

  const keys = Object.fromEntries(KEY_NAMES.map((k) => [k, `${k}-value`]));
  assert.equal(readXConfig(keys).connected, false, 'keys without the switch: off');
  assert.equal(readXConfig({ ...keys, RYNTRA_X_SENDER: 'yes' }).connected, false, 'only "on" is on');
  const on = readXConfig({ ...keys, RYNTRA_X_SENDER: 'on', RYNTRA_X_SLOTS: '10:00,14:00,19:00', RYNTRA_X_TZ: 'UTC', RYNTRA_X_DAILY_USD: '0.5' });
  assert.equal(on.connected, true);
  assert.equal(on.reason, null);
  assert.equal(on.keys.apiKey, 'RYNTRA_X_API_KEY-value');
  assert.deepEqual(on.slots, { times: [600, 840, 1140], tz: 'UTC' });
  assert.equal(on.dailyUsd, 0.5);
  const badSlots = readXConfig({ ...keys, RYNTRA_X_SENDER: 'on', RYNTRA_X_SLOTS: '10:00' });
  assert.equal(badSlots.connected, false);
  assert.match(badSlots.reason, /RYNTRA_X_SLOTS needs 3 to 5 times/);
});

test('cost: $0.015 a post, $0.20 with a link — a URL or a bare domain', () => {
  assert.equal(postCost('BONK rose as a new tower in the Launch Docks.'), X_PRICE_USD.post);
  assert.equal(postCost('BONK rose. https://ryntra.io/?coin=BONK'), X_PRICE_USD.postWithLink);
  assert.equal(postCost('BONK rose. ryntra.io'), X_PRICE_USD.postWithLink);
  assert.equal(hasLink('closed at 12.4x its entry, past $75K, DAMM v2.'), false);
  assert.equal(sumUsd([0.015, 0.015, 0.015, 0.2, 0.2]), 0.445);
  assert.equal(sumUsd(Array(5).fill(0.2)), 1);
});
