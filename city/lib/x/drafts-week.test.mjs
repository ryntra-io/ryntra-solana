// The first week of X drafts (CITY-41): 21 drafts, three a day, each on a calendar slot, in the brand's voice,
// with every number named and no tag that could slip through unchecked.
//   node --test "city/lib/x/*.test.mjs"
import assert from 'node:assert/strict';
import test from 'node:test';

import { DAYS, FORMATS, neverIn, textProblems } from './calendar.ts';
import { DRAFTS_WEEK, draftNeeds, draftTags, renderDraft, slotOf } from './drafts-week.ts';
import { HANDLES, HandleError } from './handles.ts';

const at = new Date('2026-10-28T17:00:00Z');
const sample = (d) => ({ ...Object.fromEntries(draftNeeds(d).map((n) => [n, '12'])), link: 'https://ryntra.io/?coin=BONK' });
const checked = HANDLES.map((h) => ({ ...h, status: 'verified', checkedAt: '2026-10-27', checkedBy: 'a person', source: 'test' }));

test('21 drafts: three a day, each on a real slot of the calendar with its format', () => {
  assert.equal(DRAFTS_WEEK.length, 21);
  for (const day of DAYS) assert.equal(DRAFTS_WEEK.filter((d) => d.day === day).length, 3, day);
  assert.equal(new Set(DRAFTS_WEEK.map((d) => d.id)).size, 21);
  for (const d of DRAFTS_WEEK) {
    const slot = slotOf(d);
    assert.ok(slot, `${d.id} sits on a calendar slot`);
    assert.equal(slot.format, d.format, d.id);
    assert.equal(d.template, FORMATS[d.format].template);
    assert.equal(d.media, FORMATS[d.format].media);
  }
});

test('the drafts of a day never repeat a format back to back', () => {
  for (const day of DAYS) {
    const formats = DRAFTS_WEEK.filter((d) => d.day === day).sort((a, b) => a.utc.localeCompare(b.utc)).map((d) => d.format);
    for (let i = 1; i < formats.length; i++) assert.notEqual(formats[i], formats[i - 1], `${day}: ${formats}`);
  }
});

test('every number a draft needs is named with where it comes from, and nothing extra', () => {
  for (const d of DRAFTS_WEEK) assert.deepEqual(Object.keys(d.numbers).sort(), draftNeeds(d).sort(), d.id);
  for (const d of DRAFTS_WEEK) assert.match(d.text, /\{link\}$/, `${d.id} ends on its link`);
});

test('in English, in the voice: no banned words, no hype marks, within 280, no two drafts alike', () => {
  const done = [];
  for (const d of DRAFTS_WEEK) {
    assert.deepEqual(neverIn(d.text), [], d.id);
    assert.doesNotMatch(d.text, /[\u0400-\u04FF]/, `${d.id} is English`);
    const words = renderDraft(d, sample(d), { at, approvedBy: 'owner', registry: checked });
    const tagged = draftTags(d).map((k) => HANDLES.find((h) => h.key === k).handle);
    assert.deepEqual(textProblems(words, done, tagged), [], `${d.id}: ${words}`);
    done.push(words);
  }
});

test('market numbers always carry their source line', () => {
  for (const d of DRAFTS_WEEK.filter((x) => FORMATS[x.format].involvement.includes('market-data'))) {
    assert.match(d.text, /Market data: Jupiter · not financial advice/, d.id);
  }
});

test('a draft that tags a partner cannot be rendered today: no handle is checked yet', () => {
  const tagged = DRAFTS_WEEK.filter((d) => draftTags(d).length);
  assert.ok(tagged.length > 0);
  for (const d of tagged) {
    assert.throws(() => renderDraft(d, sample(d), { at, approvedBy: 'owner' }), HandleError, d.id);
    assert.throws(() => renderDraft(d, sample(d), { at, approvedBy: null, registry: checked }), HandleError, `${d.id}: unapproved`);
    assert.ok(d.checks.some((c) => /handles\.ts/.test(c)), `${d.id} tells the approver to check the handle`);
  }
});

test('tags only where the partner takes part: Meteora on launches and graduations, never on market posts', () => {
  for (const d of DRAFTS_WEEK) {
    for (const key of draftTags(d)) {
      const h = HANDLES.find((x) => x.key === key);
      assert.ok(h.involvedIn.some((i) => FORMATS[d.format].involvement.includes(i)), `${d.id} tags ${key}`);
    }
  }
});
