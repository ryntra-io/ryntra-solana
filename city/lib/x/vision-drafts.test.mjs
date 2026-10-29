// Run from repo root: node --test city/lib/x/vision-drafts.test.mjs
// What each «live» and «building» claim stands on is checked against the task rows and the production record beside
// the documents, outside the city's code: docs/city/x/claims.test.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { HANDLES } from './handles.ts';
import { X_MAX } from '../moments/drafts/post.ts';
import { isMint } from '../search/mint.ts';
import {
  ALL_DRAFTS,
  asQueueItems,
  builtThisWeek,
  draftLength,
  FEATURE_POSTS,
  FEATURES,
  JUP,
  PARTNERS,
  partnersIn,
  resolveHandles,
  scenarioOf,
  VISION_THREAD,
  voiceFaults,
  WEEK_OF_OCT_27,
} from './vision-drafts.ts';

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const posts = ALL_DRAFTS.flatMap((d) => d.posts.map((p, i) => ({ ...p, where: `${d.id} ${i + 1}` })));

test('every post is within what X holds, slots at the longest handle and domains as links', () => {
  for (const p of posts) assert.ok(draftLength(p.text) <= X_MAX, `${p.where}: ${draftLength(p.text)}`);
  // A slot counts as 16 and a bare domain as a link, so the count never comes in under what X will count.
  assert.equal(draftLength('{@jupiter}'), 16);
  assert.equal(draftLength('on ryntra.io today'), 3 + 23 + 6);
  assert.equal(draftLength('https://ryntra.io'), 23);
});

test('the voice: no banned word, no promise, no exclamation mark, no emoji, no other product', () => {
  for (const p of posts) assert.deepEqual(voiceFaults(p.text), [], p.where);
  for (const bad of ['This will 100x', 'guaranteed returns', 'passive income', 'a trading bot', 'to the moon', 'ryntra arc', 'go!', 'up 🚀', 'unruggable', 'degen hours', 'floor price'])
    assert.notDeepEqual(voiceFaults(bad), [], bad);
});

test('every claim names what it stands on: a task row (CITY-…) or a line of the production record', () => {
  for (const p of posts) {
    for (const e of p.live) assert.ok(('registry' in e && /^CITY-\d+[a-z]?$/.test(e.registry)) || ('state' in e && e.state.length > 10), p.where);
    for (const id of p.building) assert.match(id, /^CITY-\d+[a-z]?$/, p.where);
  }
});

test('the words match the claims: a «Live» post names its evidence, a «Building» post its rows, never both', () => {
  for (const p of posts) {
    if (/^(Live now|Live on)/.test(p.text)) assert.ok(p.live.length && !p.building.length, p.where);
    if (/^(Building|Next on the road)/.test(p.text)) assert.ok(p.building.length && !p.live.length, p.where);
    if (/^Coming/m.test(p.text)) assert.ok(p.building.length, `${p.where}: says what comes next without its rows`);
  }
});

test('the vision thread: 10–15 posts, live first and building after, a frame of the city and the road map', () => {
  const t = VISION_THREAD.posts;
  assert.ok(t.length >= 10 && t.length <= 15, String(t.length));
  assert.equal(t[0].media?.kind, 'shot');
  assert.ok(t.some((p) => p.media?.kind === 'map'));
  const lastLive = t.map((p) => /^Live now/.test(p.text)).lastIndexOf(true);
  const firstBuilding = t.findIndex((p) => /^Building/.test(p.text));
  assert.ok(lastLive >= 0 && firstBuilding > lastLive, 'live is told first, building after');
  assert.ok(t.filter((p) => /^Building/.test(p.text)).length >= 4);
  assert.match(t.at(-1).text, /Not financial advice\. Crypto is volatile\. Non-custodial — you sign every trade\./);
});

test('a thread per live feature: 3–5 posts, its CITY-42 video first, a link to the city or the coin', () => {
  assert.deepEqual(FEATURE_POSTS.map((d) => d.feature), FEATURES);
  for (const d of FEATURE_POSTS) {
    assert.ok(d.posts.length >= 3 && d.posts.length <= 5, d.id);
    assert.deepEqual(d.posts[0].media, { kind: 'video', scenario: scenarioOf(d.feature), ratios: ['16:9', '1:1'] }, d.id);
    assert.ok(d.posts.slice(1).every((p) => p.media === null), `${d.id}: one video per thread`);
    const links = d.posts.flatMap((p) => p.text.match(/https:\/\/\S+/g) ?? []);
    assert.equal(links.length, 1, `${d.id}: one link per thread (a link costs 13x on the X API)`);
    const [link] = links;
    const coin = link.match(/^https:\/\/ryntra\.io\/c\/(\S+)$/);
    assert.ok(link === 'https://ryntra.io' || (coin && isMint(coin[1])), `${d.id}: ${link}`);
    assert.ok(d.posts.every((p) => p.live.length), `${d.id}: every post of a live feature says what it stands on`);
  }
  assert.ok(isMint(JUP));
});

test('partners only where they work, as slots a checked list fills — never a typed handle', () => {
  for (const p of posts) {
    assert.doesNotMatch(p.text.replace(/\{@[a-z]+\}/g, ''), /@\w/, `${p.where}: a handle typed in the words`);
    for (const partner of partnersIn(p.text)) assert.ok(partner in PARTNERS, `${p.where}: ${partner}`);
    assert.ok(partnersIn(p.text).length <= 2, `${p.where}: one or two tags a post`);
  }
  const tagged = new Set(posts.flatMap((p) => partnersIn(p.text)));
  assert.deepEqual([...tagged].sort(), ['jupiter', 'meteora', 'solana']);
  // Meteora is tagged where its launch curve or pools are the work; Jupiter where it routes the swap. A post that names
  // several wallets tags none of them.
  for (const p of posts) {
    if (partnersIn(p.text).includes('meteora')) assert.match(p.text, /DAMM|DLMM|curve|pool/, p.where);
    if (partnersIn(p.text).includes('jupiter')) assert.match(p.text, /route/, p.where);
    if (/Phantom, Solflare or Backpack/.test(p.text)) assert.deepEqual(partnersIn(p.text), [], p.where);
  }
});

test('a tag goes in only from the checked handle list, in a post a person approved', () => {
  const at = new Date('2026-10-28T12:00:00Z');
  const text = 'routed through {@jupiter}, signed in {@phantom}';
  // Today no partner's handle is checked: nothing resolves, and each reason is given.
  const today = resolveHandles(text, { at, approvedBy: 'operator:1' });
  assert.equal(today.ok, false);
  assert.deepEqual(today.missing, ['jupiter', 'phantom']);
  assert.ok(today.why.every((w) => /needs a check/.test(w)), today.why.join('; '));
  const checked = HANDLES.map((h) => ({ ...h, status: 'verified', checkedAt: '2026-10-27', checkedBy: 'a person', source: 'test' }));
  assert.deepEqual(resolveHandles(text, { at, approvedBy: 'operator:1', registry: checked }), { ok: true, text: 'routed through @JupiterExchange, signed in @phantom' });
  const unapproved = resolveHandles(text, { at, approvedBy: null, registry: checked });
  assert.equal(unapproved.ok, false, 'no approval, no tag');
  const stale = resolveHandles(text, { at: new Date('2026-12-31T12:00:00Z'), approvedBy: 'operator:1', registry: checked });
  assert.equal(stale.ok, false, 'a check older than 30 days does not count');
  assert.deepEqual(resolveHandles('{@helius}', { at, approvedBy: 'operator:1', registry: checked }).missing, ['helius'], 'only the partners of these drafts');
});

test('built this week: the road map up top, shipped lines live, next lines from the registry', () => {
  const w = WEEK_OF_OCT_27;
  assert.equal(w.series, 'weekly');
  assert.equal(w.posts[0].media?.kind, 'map');
  assert.match(w.posts[1].text, /^Live on ryntra\.io:\n— /);
  assert.ok(w.posts.some((p) => /^Next on the road:/.test(p.text)));
  assert.throws(() => builtThisWeek({ week: 'empty', shipped: [], next: [] }));
  // Long weeks spill into more posts, each with its heading.
  const many = builtThisWeek({
    week: 'a long week',
    shipped: Array.from({ length: 12 }, (_, i) => ({ words: `Shipped line number ${i} with enough words to fill a post`, evidence: { registry: 'CITY-1' } })),
    next: [{ words: 'Launch in the city', task: 'CITY-2' }],
  });
  const live = many.posts.filter((p) => /^Live on/.test(p.text));
  assert.ok(live.length > 1);
  for (const p of many.posts) assert.ok(draftLength(p.text) <= X_MAX);
  assert.equal(live.map((p) => p.text.split('\n— ').length - 1).reduce((a, b) => a + b), 12);
});

test('into the CITY-3 queue: one item per post, a stable id, nothing sent', () => {
  const items = ALL_DRAFTS.flatMap(asQueueItems);
  assert.equal(items.length, posts.length);
  assert.equal(new Set(items.map((i) => i.eventId)).size, items.length);
  assert.deepEqual(asQueueItems(VISION_THREAD)[0].eventId, 'vision:vision-thread:0');
  assert.equal(asQueueItems(VISION_THREAD).at(-1).link, 'https://ryntra.io');
  const source = read('city/lib/x/vision-drafts.ts');
  assert.doesNotMatch(source, /fetch\(|api\.x\.com|api\.twitter\.com|X_API|process\.env/, 'the drafts never post');
});
