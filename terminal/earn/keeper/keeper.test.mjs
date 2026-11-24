// The stock pool's keeper on the position screen: which pools it shows on, the door's one line, the bounds a
// screen may send, the words in both languages, and the client's flow (Review → one signature → relay; Stop).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DEFAULT_KEEPER_CHOICE } from '../../../lib/care/stock-keeper-terms.ts';
import { COST_IDS, MODE_WORD, PACE_IDS, PACE_WORD, WIDTH_IDS, WIDTH_WORD, choiceFor, costSolOf, doorLine, failureOf, keeperOf, keeperPool, modesOf, movesOf, pctOf, sameChoice, widthOf } from './model.ts';
import { setKeeperReach, useKeeper } from './store.ts';
import { KEEPER } from './words.ts';

const view = (extra = {}) => ({ key: 'k:devnet:o:n', nftMint: 'n', pool: 'p', status: 'working', stoppedBy: null, mode: 'pull', choice: DEFAULT_KEEPER_CHOICE, hours: 'open', shape: null, wait: null, waiting: false, movesToday: 0, lastAt: null, ...extra });

test('shows on a stock pool, or a stand pool the deployment names — never where the keeper is not served', () => {
  const status = { standPools: ['stand'] };
  assert.equal(keeperPool({ address: 'x', stock: { issuer: 'Backpack Securities' } }, status), true);
  assert.equal(keeperPool({ address: 'stand', stock: null }, status), true);
  assert.equal(keeperPool({ address: 'x', stock: null }, status), false);
  assert.equal(keeperPool({ address: 'x', stock: { issuer: 'Backpack Securities' } }, null), false, 'no status read — the keeper is not served here');
  assert.equal(keeperOf({ keepers: [view()] }, 'n')?.key, 'k:devnet:o:n');
  assert.equal(keeperOf({ keepers: [view()] }, 'other'), null);
});

test('the door says what the keeper does now, in the person’s terms', () => {
  assert.equal(doorLine(null), 'off');
  assert.equal(doorLine(view({ status: 'stopped' })), 'stopped');
  assert.equal(doorLine(view({ hours: 'open', mode: 'shift' })), 'narrow');
  assert.equal(doorLine(view({ hours: 'closing', mode: 'shift' })), 'wide');
  assert.equal(doorLine(view({ hours: 'closed', mode: 'shift' })), 'wide');
  assert.equal(doorLine(view({ hours: 'open' })), 'pullOpen', 'a keeper that only takes out lays no narrow range');
  assert.equal(doorLine(view({ hours: 'closed' })), 'pullClosed');
  assert.equal(doorLine(view({ hours: 'unknown' })), 'reading');
  assert.equal(doorLine(view({ wait: 'dividend-hold' })), 'hold');
  assert.equal(doorLine(view({ waiting: true, mode: 'pull' })), 'waits');
  assert.equal(doorLine(view({ wait: 'approval', mode: 'shift' })), 'waitsYou');
  for (const line of ['narrow', 'wide', 'pullOpen', 'pullClosed', 'hold', 'waits', 'waitsYou', 'reading']) {
    assert.ok(KEEPER.en[line] && KEEPER.uk[line], line);
  }
});

test('the bounds a screen may send: laying back only where it is served; the figures each choice shows', () => {
  assert.deepEqual(modesOf({ modes: ['pull'] }), ['pull']);
  assert.deepEqual(modesOf({ modes: ['pull', 'shift'] }), ['pull', 'shift']);
  assert.deepEqual(modesOf(null), ['pull']);
  assert.equal(choiceFor({ ...DEFAULT_KEEPER_CHOICE, putBack: true }, ['pull']).putBack, false, 'mainnet: only take out');
  assert.equal(choiceFor({ ...DEFAULT_KEEPER_CHOICE, putBack: true }, ['pull', 'shift']).putBack, true);
  assert.equal(sameChoice(DEFAULT_KEEPER_CHOICE, { ...DEFAULT_KEEPER_CHOICE }), true);
  assert.equal(sameChoice(DEFAULT_KEEPER_CHOICE, { ...DEFAULT_KEEPER_CHOICE, width: 'tight' }), false);
  assert.deepEqual(widthOf('usual'), { day: '1%', night: '5%' });
  assert.equal(pctOf(50), '0.5%');
  assert.equal(movesOf('usual'), 8);
  assert.equal(costSolOf('usual'), '0.02 SOL');
  for (const id of WIDTH_IDS) assert.ok(KEEPER.en[WIDTH_WORD[id]] && KEEPER.uk[WIDTH_WORD[id]], id);
  for (const id of PACE_IDS) assert.ok(KEEPER.en[PACE_WORD[id]] && KEEPER.uk[PACE_WORD[id]], id);
  for (const id of ['pull', 'shift']) assert.ok(KEEPER.en[MODE_WORD[id]] && KEEPER.uk[MODE_WORD[id]], id);
  assert.equal(COST_IDS.length, 3);
  assert.equal(failureOf('KEEPER_POOL'), 'failKeeperPool');
  assert.equal(failureOf('SOMETHING_ELSE'), 'failUnavailable');
  assert.equal(failureOf('toString'), 'failUnavailable');
  /* Every refusal the server gives has its words. */
  const server = readFileSync(new URL('../../../lib/care/stock-keeper.server.ts', import.meta.url), 'utf8');
  for (const [, code] of server.matchAll(/fail\("([A-Z_]+)"/g)) {
    if (code === 'BAD_REQUEST') continue;
    assert.ok(KEEPER.en[failureOf(code)] && failureOf(code) !== 'failUnavailable', code);
  }
});

test('words: the same keys in both languages, no machinery, no promise', () => {
  const keys = (dict) => Object.keys(dict).sort();
  assert.deepEqual(keys(KEEPER.en), keys(KEEPER.uk));
  const text = JSON.stringify([KEEPER.en, KEEPER.uk]) + [KEEPER.en.widthLine('1%', '5%'), KEEPER.uk.widthLine('1%', '5%'), KEEPER.en.pullWidthLine('5%'), KEEPER.uk.pullWidthLine('5%'), KEEPER.en.mayPutBack('1 ANT'), KEEPER.uk.mayPutBack('1 ANT')].join(' ');
  for (const word of [/\bbins?\b/i, /delegat/i, /program id/i, /\bapi\b/i, /devnet/i, /\bengine\b/i, /двигун/i, /guarantee/i, /risk-free/i, /\b100x\b/i, /!/, /approval layer/i, /receipt/i, /квитанц/i]) {
    assert.doesNotMatch(text, word, String(word));
  }
});

test('the screen holds no word of its own in its markup, and draws only the kit and the ticket’s parts', () => {
  const source = readFileSync(new URL('./KeeperMount.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(aria-label|title|placeholder|alt)="[^"{]/, 'every label comes from the words');
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no colour by hand');
  assert.match(source, /from '@\/terminal\/ui'/);
  /* One amber action on the panel. */
  assert.equal((source.match(/<Action\b/g) ?? []).length, 1);
});

test('flow: the Review follows the choice; one signature; the relay; a cancelled signature changes nothing', async () => {
  const posted = [];
  let signs = 0;
  const answers = {
    status: { ok: true, network: 'devnet', modes: ['pull', 'shift'], standPools: [], keepers: [] },
    review: { ok: true, key: 'k:devnet:o:n', network: 'devnet', transactions: ['AAA'], mode: 'pull', terms: { mode: 'pull', may: [], mayNot: [], approval: null, approvalOutsideThePool: false, narrowestBps: 100, widestBps: 500, maxShiftsPerDay: 8 }, coins: { x: { symbol: 'ANT', decimals: 9 }, y: { symbol: 'SOL', decimals: 9 } } },
    submit: { ok: true, signatures: ['sig'], seen: true },
    stop: { ok: true, transactions: ['BBB'] },
    relay: { ok: true, signatures: ['sig2'] },
  };
  setKeeperReach({
    post: async (body) => (posted.push(body), answers[body.action]),
    sign: async (_wallet, unsigned) => ((signs += 1), signs === 2 ? null : unsigned.map((wire) => `${wire}-signed`)),
    /* The wallet's proof comes before each change: written down in the same line as the posts. */
    prove: async (wallet) => (posted.push({ action: 'prove', owner: wallet.address }), 'ok'),
  });
  const wallet = { wallet: 'Test', address: 'o' };
  await useKeeper.getState().load('o');
  assert.equal(useKeeper.getState().loaded.status, 'ready');
  useKeeper.getState().openFor('n', null);
  await useKeeper.getState().prepare(wallet, { pool: 'p', nftMint: 'n' });
  assert.equal(useKeeper.getState().review?.key, 'k:devnet:o:n');
  assert.deepEqual(posted.at(-1).choice, DEFAULT_KEEPER_CHOICE);
  assert.deepEqual(posted.slice(-2).map((body) => body.action), ['prove', 'review'], 'the wallet proves itself before the Review is built');
  await useKeeper.getState().confirm(wallet);
  assert.equal(useKeeper.getState().phase, 'done');
  assert.deepEqual(posted.find((body) => body.action === 'submit').signed, ['AAA-signed']);

  /* A changed bound throws the old Review away. */
  useKeeper.getState().openFor('n', null);
  await useKeeper.getState().prepare(wallet, { pool: 'p', nftMint: 'n' });
  useKeeper.getState().setChoice({ width: 'tight' });
  assert.equal(useKeeper.getState().review, null);
  /* The second signature is cancelled: nothing is relayed. */
  await useKeeper.getState().prepare(wallet, { pool: 'p', nftMint: 'n' });
  const before = posted.filter((body) => body.action === 'submit').length;
  await useKeeper.getState().confirm(wallet);
  assert.equal(useKeeper.getState().phase, 'cancelled');
  assert.equal(posted.filter((body) => body.action === 'submit').length, before);

  /* Stop: built on the server first, then signed and relayed. */
  useKeeper.getState().again();
  await useKeeper.getState().stop(wallet, 'k:devnet:o:n');
  assert.equal(useKeeper.getState().phase, 'stopped');
  assert.deepEqual(posted.filter((body) => body.action !== 'status').map((body) => body.action).slice(-3), ['prove', 'stop', 'relay']);

  /* The wallet says no to the proof: nothing is asked of the server. */
  useKeeper.getState().again();
  const asked = posted.length;
  setKeeperReach({ prove: async () => 'declined' });
  await useKeeper.getState().stop(wallet, 'k:devnet:o:n');
  assert.equal(useKeeper.getState().phase, 'cancelled');
  assert.equal(posted.length, asked);
  setKeeperReach({ prove: async () => 'ok' });
});

test('the Review built while the bounds are read never opens the wallet for its proof: without one it waits for the tap', async () => {
  const posted = [];
  const asks = [];
  setKeeperReach({
    post: async (body) => (posted.push(body), body.action === 'review' ? { ok: true, key: 'k:devnet:o:n', network: 'devnet', transactions: ['AAA'], mode: 'pull', terms: {}, coins: {} } : { ok: true }),
    prove: async (_wallet, ask) => (asks.push(ask), ask ? 'ok' : 'unproven'),
  });
  const wallet = { wallet: 'Test', address: 'o' };
  useKeeper.getState().openFor('n', null);
  await useKeeper.getState().prepare(wallet, { pool: 'p', nftMint: 'n' }, true);
  assert.deepEqual(asks, [false], 'asked quietly, the wallet not opened');
  assert.equal(useKeeper.getState().quiet, 'n');
  assert.equal(useKeeper.getState().phase, 'idle');
  assert.equal(useKeeper.getState().review, null);
  assert.deepEqual(posted, [], 'nothing asked of the server without the proof');
  /* The person's tap asks the wallet, then builds the Review. */
  await useKeeper.getState().prepare(wallet, { pool: 'p', nftMint: 'n' });
  assert.deepEqual(asks, [false, true]);
  assert.equal(useKeeper.getState().review?.key, 'k:devnet:o:n');
  const mount = readFileSync(new URL('./KeeperMount.tsx', import.meta.url), 'utf8');
  assert.match(mount, /quiet === boat\.nftMint\) return;/);
  assert.match(mount, /prepare\(connection, \{ pool: pier\.address, nftMint: boat\.nftMint \}, true\), AUTO_REVIEW_MS\)/);
  setKeeperReach({ prove: async () => 'ok' });
});
