// Run from repo root: node --test "city/lib/x/*.test.mjs"
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { X_MAX, xLength } from '../moments/drafts/post.ts';
import { postIsClean, studioLink, studioText } from './post.ts';

/** Words the city never uses about money (the brandbook's list and the moments' own). */
const PROMISES = /\b(moon|mooning|100x|1000x|guarantee|guaranteed|risk[- ]free|riskless|get rich|lambo|passive income|can'?t lose|sure thing|easy money|to the moon|buy now|ape in|don'?t miss)\b/i;

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const at = '2026-10-26T11:31:11.183Z';
const FACTS = {
  hour: { template: 'hour', mint: MINT, symbol: '$DOPE', district: 'strip', change: 10.3295, mcap: 2744255, readAt: at, live: true },
  volume: { template: 'justin', metric: 'volume', value: 3068667865, towers: 82, readAt: at, live: true },
  core: { template: 'justin', metric: 'core', mint: MINT, symbol: '$JUP', mcap: 9.1e8, readAt: at, live: true },
  launch: {
    template: 'launch', mint: MINT, network: 'solana:devnet', launchedAt: '2026-10-09T21:50:05.000Z', launchTx: '2'.repeat(88),
    graduatedAt: '2026-10-09T21:51:16.000Z', graduateTx: '3'.repeat(88), seconds: 71, readAt: '2026-10-09T22:16:42.864Z',
  },
  week: { template: 'billboard', ranking: 'week', from: '2026-10-19T11:00:00.000Z', readAt: at, live: true, rows: ['$AAAAAAAAAAAA', '$BBBBBBBBBBBB', '$CCCCCCCCCCCC', '$DDDDDDDDDDDD', '$EEEEEEEEEEEE'].map((symbol, i) => ({ mint: MINT, symbol, value: 120.5 - i * 10 })) },
  busy: { template: 'billboard', ranking: 'volume', from: null, readAt: at, live: true, rows: ['$SOL', '$USDC', '$JUP', '$BONK', '$WIF'].map((symbol, i) => ({ mint: MINT, symbol, value: 1.2e9 / (i + 1) })) },
  banner: { template: 'banner', towers: 82, readAt: at, live: true },
};

test('each post: the fact, its window, its source with the read time, one link — and X’s 280', () => {
  const t = Object.fromEntries(Object.entries(FACTS).map(([k, f]) => [k, studioText(f)]));
  assert.equal(t.hour, 'Tower of the hour: $DOPE grew +10.3% in the last hour, the most of any named tower in the live Solana skyline. Jupiter data, read Oct 26 · 11:31 UTC. Not financial advice. https://ryntra.io/?coin=DOPE');
  assert.equal(t.volume, 'JUST IN: $3.07B traded in 24 hours across the 82 towers of the live Solana skyline. Jupiter data, read Oct 26 · 11:31 UTC. https://ryntra.io/');
  assert.equal(t.core, 'JUST IN: $JUP is a new tower in Sol Core, at a $910.0M market cap. Jupiter data, read Oct 26 · 11:31 UTC. Not financial advice. https://ryntra.io/?coin=JUP');
  assert.equal(t.launch, 'Launch Night: a coin launched on Ryntra and graduated into its pool 71 s later — the curve filled, the tower left the docks for the skyline. Both transactions on Solana devnet, in a Ryntra rehearsal. https://ryntra.io/');
  assert.match(t.week, /^Towers of the week, by price change since Oct 19: 1 \$AAAAAAAAAAAA \+120\.5% · 2 /);
  assert.match(t.busy, /^The busiest towers of the live Solana skyline, by 24h volume: 1 \$SOL \$1\.20B · 2 \$USDC \$600\.0M/);
  for (const [k, text] of Object.entries(t)) {
    assert.ok(xLength(text) <= X_MAX, `${k}: ${xLength(text)}`);
    assert.doesNotMatch(text, PROMISES, k);
    assert.ok(postIsClean(text), k);
    assert.equal((text.match(/https:\/\//g) ?? []).length, 1, `${k}: one link`);
    assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}!]/u, `${k}: no emoji, no exclamation`);
  }
});

test('the link picks the tower only for one named coin; an unnamed launch never names its coin', () => {
  assert.equal(studioLink(FACTS.hour), 'https://ryntra.io/?coin=DOPE');
  assert.equal(studioLink(FACTS.launch), 'https://ryntra.io/');
  assert.doesNotMatch(studioText(FACTS.launch), new RegExp(MINT));
  assert.equal(studioText({ ...FACTS.launch, network: 'solana:mainnet' }).includes('Both transactions on Solana. '), true);
});

test('no handle and no hashtag ever: partners are tagged only by the person who approves (X rules II.B.2)', () => {
  assert.equal(postIsClean('Tower of the hour with @jupiterexchange'), false);
  assert.equal(postIsClean('Tower of the hour #solana'), false);
  assert.equal(postIsClean('a $DOPE cashtag and an email-like a@b stays'), true);
  assert.equal(postIsClean('x'.repeat(281)), false);
});
