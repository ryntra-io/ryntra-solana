// Run from repo root: node --test "city/lib/x/*.test.mjs"
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASPECTS, HOOK_BY, checkStoryboard, frameTimes, storyboard } from './timeline.ts';
import { captionAt } from './overlay.ts';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const at = '2026-10-26T11:31:11.183Z';
const hour = { template: 'hour', mint: MINT, symbol: '$DOPE', district: 'strip', change: 10.33, mcap: 2744255, readAt: at, live: true };
const launch = {
  template: 'launch', mint: MINT, network: 'solana:devnet', launchedAt: '2026-10-09T21:50:05.000Z', launchTx: '2'.repeat(88),
  graduatedAt: '2026-10-09T21:51:16.000Z', graduateTx: '3'.repeat(88), seconds: 71, readAt: '2026-10-09T22:16:42.864Z',
};
const volume = { template: 'justin', metric: 'volume', value: 3.07e9, towers: 82, readAt: at, live: true };
const busy = { template: 'billboard', ranking: 'volume', from: null, readAt: at, live: true, rows: ['$SOL', '$USDC', '$JUP', '$BONK', '$WIF'].map((symbol) => ({ mint: MINT, symbol, value: 1e8 })) };

test('the formats X takes: 4:5 and 1:1 at 1080 wide', () => {
  assert.deepEqual(ASPECTS['4:5'], { width: 1080, height: 1350 });
  assert.deepEqual(ASPECTS['1:1'], { width: 1080, height: 1080 });
  assert.equal(frameTimes(9, 30).length, 270);
  assert.equal(frameTimes(9, 60).length, 540);
  assert.equal(frameTimes(9, 30)[1], 1 / 30);
});

test('the tower of the hour: 6–12 s, the figure from the first frames, the camera already flying at frame one', () => {
  const s = storyboard(hour);
  assert.deepEqual(checkStoryboard(s), []);
  assert.ok(s.seconds >= 6 && s.seconds <= 12);
  assert.equal(s.hook.figure, '+10.3%');
  assert.equal(s.hook.kicker, 'TOWER OF THE HOUR');
  assert.ok(s.captions[0].from <= HOOK_BY);
  assert.ok(s.cues[0].do === 'fly' && s.cues[0].at < 0, 'the flight starts in the preroll');
  assert.ok(s.cues.filter((c) => c.do === 'fx').length >= 2, 'fireworks');
  assert.match(s.chip, /^JUPITER · OCT 26 · 11:31 UTC$/);
  assert.match(s.footnote, /not financial advice/);
});

test('Launch Night: from the docks to the pool, the curve meter, the move at graduation, DEVNET said on screen', () => {
  const s = storyboard(launch);
  assert.deepEqual(checkStoryboard(s), []);
  assert.ok(s.seconds <= 60);
  assert.equal(s.hook.figure, '71 S');
  assert.equal(s.hook.kicker, 'LAUNCH NIGHT · DEVNET');
  const kinds = s.cues.map((c) => c.do);
  assert.ok(kinds.indexOf('graduate') > kinds.indexOf('fx'), 'the launch light first, the pool after');
  assert.ok(s.meter && s.meter.to <= s.cues.find((c) => c.do === 'graduate').at);
  assert.match(s.captions.at(-1).text, /Graduated into its pool · OCT 9 · 21:51 UTC/);
  assert.equal(storyboard({ ...launch, network: 'solana:mainnet' }).hook.kicker, 'LAUNCH NIGHT');
});

test('the cards are one frame, the director’s cues before it', () => {
  for (const f of [volume, busy]) {
    const s = storyboard(f);
    assert.deepEqual(checkStoryboard(s), []);
    assert.equal(s.seconds, 0);
    assert.ok(s.cues.every((c) => c.at < 0));
  }
  assert.equal(storyboard(volume).hook.figure, '$3.07B');
  assert.equal(storyboard(busy).hook.title, 'BUSIEST TOWERS');
  assert.equal(storyboard({ template: 'banner', towers: 82, readAt: at, live: true }), null);
});

test('the rules catch a clip that breaks them', () => {
  const s = storyboard(hour);
  assert.ok(checkStoryboard({ ...s, seconds: 61, endAt: 59 }).some((p) => /length|6–12/.test(p)));
  assert.ok(checkStoryboard({ ...s, captions: [{ ...s.captions[0], from: 0.9 }, ...s.captions.slice(1)] }).includes('the first caption comes after the hook'));
  assert.ok(checkStoryboard({ ...s, captions: [{ from: 0.1, to: 2, text: 'x'.repeat(60) }] }).some((p) => /too long/.test(p)));
  assert.ok(checkStoryboard({ ...s, cues: [...s.cues].reverse() }).includes('cues out of order'));
});

test('a caption fades in and out at its edges, and only one shows', () => {
  const s = storyboard(hour);
  assert.equal(captionAt(s.captions, 0), null);
  assert.equal(captionAt(s.captions, 1).text, '$DOPE grew the most in the last hour');
  assert.equal(captionAt(s.captions, 1).k, 1);
  assert.ok(captionAt(s.captions, 0.2).k < 1);
  assert.equal(captionAt(s.captions, 3.5).text, '+10.3% in one hour · $2.7M market cap');
});
