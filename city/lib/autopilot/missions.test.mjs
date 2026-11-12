// CITY-70 — the agent's mission on its card, its three controls and its walk between towers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { useMandate } from '../bots/mandate.ts';
import { openOrderOf, tapCancelOrders, tapFreeze, useControls } from './controls.ts';
import { booksLine, canWithdraw, missionFace, tradeWord } from './mission.ts';
import { isBooks, isMission, readAgentView, useAutopilot } from './store.ts';
import { DWELL_MS, HOVER, TRADE_STAY_MS, planWalk, stopAt } from './walk.ts';
import { AUTOPILOT } from './words.ts';

const en = AUTOPILOT.en;
const uk = AUTOPILOT.uk;
const RECORD = {
  owner: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
  settings: 'So11111111111111111111111111111111111111112',
  vault: 'Sysvar1nstructions1111111111111111111111111',
  policy: 'SysvarRent111111111111111111111111111111111',
  budget: 'SysvarC1ock11111111111111111111111111111111',
  perTrade: '20000000',
  perDay: '100000000',
  expiresAt: '1900000000',
};
const WHO = { wallet: 'phantom', owner: RECORD.owner };
const NOW = 1_800_000_000_000;

const view = (extra = {}) => ({
  status: 'working',
  strategy: 'steady',
  receiveMint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  everyMs: 17_280_000,
  result: { trades: 1, spentRaw: '20000000', boughtRaw: '1', worthRaw: '20000000', earnedRaw: '0', multiple: 1 },
  last: [],
  updatedAt: NOW,
  ...extra,
});

test('the card says what the agent does now — and a trade being confirmed is never «failed»', () => {
  assert.deepEqual(missionFace(view({ mission: { state: 'waiting', reason: 'interval', nextAt: NOW + 1 } }), en), { text: 'Working', tone: 'live', line: null, nextAt: NOW + 1 });
  assert.equal(missionFace(view({ mission: { state: 'confirming', reason: null, nextAt: null } }), en).text, 'Confirming a trade');
  assert.equal(missionFace(view({ mission: { state: 'frozen', reason: null, nextAt: null } }), uk).text, 'Заморожено');
  assert.equal(missionFace(view({ status: 'paused', mission: { state: 'paused', reason: 'mismatch', nextAt: null } }), en).line, en.pausedMismatch);
  assert.equal(missionFace(view({ mission: { state: 'stopped', reason: null, nextAt: null } }), en).text, 'Stopped');
  /* An engine of before: the book's state as it was. */
  assert.equal(missionFace(view(), en).text, 'Working');
  assert.equal(tradeWord('unknown', false, en), 'Confirming');
  assert.equal(tradeWord('unknown', false, uk), 'Підтверджується');
  assert.equal(tradeWord('held', false, en), 'Day’s budget used');
  assert.equal(tradeWord(undefined, false, en), 'Didn’t go through', 'an engine of before: a failed trade as before');
  assert.notEqual(tradeWord('unknown', false, en), tradeWord('failed', false, en));
});

test('the money in one line only when it adds up exactly; a trade on its way says so', () => {
  const sol = (raw) => (Number(raw) / 1e9).toString();
  const books = { state: 'exact', budgetRaw: '100000000', spentRaw: '40000000', leftRaw: '60000000', pendingRaw: '0', gapRaw: '0' };
  assert.equal(booksLine(books, en, sol), 'Budget 0.1 SOL = spent 0.04 + left 0.06 SOL');
  assert.equal(booksLine(books, uk, sol), 'Бюджет 0.1 SOL = витрачено 0.04 + залишок 0.06 SOL');
  assert.equal(booksLine({ ...books, state: 'settling' }, en, sol), en.booksSettling);
  assert.equal(booksLine({ ...books, state: 'unread', leftRaw: null }, en, sol), null);
  assert.equal(canWithdraw(false, { ...books, state: 'more' }), true, 'the vault still holds money: withdraw has something to take');
  assert.equal(canWithdraw(false, { ...books, state: 'closed' }), false);
  assert.ok(isBooks(books) && !isBooks({ ...books, leftRaw: '-1' }) && isMission({ state: 'frozen', reason: null, nextAt: null }) && !isMission({ state: 'gone' }));
});

test('the engine view is read strictly: a mission or books not of the engine are left out', async () => {
  const answer = view({ mission: { state: 'confirming', reason: null, nextAt: null }, books: { state: 'nope' }, frozen: true });
  const read = await readAgentView(RECORD, async () => new Response(JSON.stringify(answer), { status: 200 }));
  assert.deepEqual([read.mission.state, read.books, read.frozen], ['confirming', undefined, true]);
});

test('an order is open only while a sale waits in her vault', () => {
  assert.equal(openOrderOf(null), null);
  assert.equal(openOrderOf(view({ lastSale: { policy: 'p', status: 'sold' } })), null);
  assert.equal(openOrderOf(view({ lastSale: { policy: 'p', status: 'signed' } })), 'p');
  assert.equal(openOrderOf(view({ lastSale: { policy: 'q', status: 'failed' } })), 'q');
});

test('«Freeze» is one tap: no transaction, the wallet proves itself once when asked, and the card turns at once', async () => {
  useAutopilot.getState().setView(RECORD.policy, view());
  const asked = [];
  let proven = false;
  const fetch = async (url, init) => {
    asked.push([url, JSON.parse(init?.body ?? 'null')]);
    if (url.startsWith('/api/bots/mandate/freeze')) return proven ? new Response(JSON.stringify({ frozen: true }), { status: 200 }) : new Response(JSON.stringify({ error: { message: 'No proven wallet.' } }), { status: 401 });
    return new Response(JSON.stringify(view({ frozen: true, mission: { state: 'frozen', reason: null, nextAt: null } })), { status: 200 });
  };
  let signed = 0;
  const ok = await tapFreeze(WHO, RECORD, true, { fetch, prove: async () => ((proven = true), { ok: true }), sign: async () => ((signed += 1), { ok: false }) });
  assert.equal(ok, true);
  assert.equal(signed, 0, 'freezing signs no transaction');
  assert.deepEqual(asked.filter(([url]) => url.includes('freeze')).map(([, body]) => body), [{ owner: RECORD.owner, policy: RECORD.policy, frozen: true }, { owner: RECORD.owner, policy: RECORD.policy, frozen: true }]);
  assert.equal(useAutopilot.getState().views[RECORD.policy].frozen, true);
  assert.equal(useControls.getState().note, 'frozen');
  /* The wallet says no to the proof: nothing changes, and it is told as her answer. */
  proven = false;
  assert.equal(await tapFreeze(WHO, RECORD, false, { fetch, prove: async () => ({ ok: false, state: 'declined', message: 'no' }) }), false);
  assert.equal(useControls.getState().note, 'walletNo');
});

test('«Cancel orders» calls off the waiting sale with one signature of hers; nothing open is told as such', async () => {
  const posted = [];
  const fetch = async (url) => {
    posted.push(url);
    if (url === '/api/bots/mandate/sell/back') return new Response(JSON.stringify({ transactions: ['AQ=='] }), { status: 200 });
    return new Response('null', { status: 404 });
  };
  /* The wallet's one prompt; a transaction that is not hers is refused before it — here, the check refuses it. */
  const ok = await tapCancelOrders(WHO, RECORD, 'SalePolicy1111111111111111111111111111111111', { fetch, sign: async () => ({ ok: false, reason: 'no' }) });
  assert.equal(ok, false);
  assert.deepEqual(posted.slice(0, 1), ['/api/bots/mandate/sell/back']);
  assert.ok(['refused', 'walletNo'].includes(useControls.getState().note));
  const none = await tapCancelOrders(WHO, RECORD, 'SalePolicy1111111111111111111111111111111111', { fetch: async (url) => (url === '/api/bots/mandate/sell/back' ? new Response(JSON.stringify({ error: { message: 'Nothing left to take back.' } }), { status: 422 }) : new Response('null', { status: 404 })) });
  assert.equal(none, false);
  assert.equal(useControls.getState().note, 'nothing');
  assert.equal(useControls.getState().busy, null);
  void useMandate;
});

test('the agent walks home and its towers; a trade holds it over the tower; frozen it stays home; paused it is not out', () => {
  const home = { x: 0, y: 4, z: 0 };
  const tower = { x: 50, y: 30, z: 10 };
  const other = { x: -40, y: 20, z: 5 };
  const walk = planWalk([{ tower, mission: 'waiting', lastTradeAt: NOW - TRADE_STAY_MS - 1 }, { tower: other, mission: 'working', lastTradeAt: null }], home, NOW);
  assert.equal(walk.mood, 'walk');
  assert.deepEqual(walk.stops, [{ x: 0, y: 4 + HOVER, z: 0 }, { x: 50, y: 30 + HOVER, z: 10 }, { x: -40, y: 20 + HOVER, z: 5 }]);
  assert.deepEqual([0, DWELL_MS * 2, DWELL_MS * 4, DWELL_MS * 6].map((ms) => stopAt(walk.stops, ms)), [0, 1, 2, 0]);
  assert.deepEqual(planWalk([{ tower, mission: 'waiting', lastTradeAt: NOW - 1_000 }], home, NOW), { mood: 'trade', stops: [{ x: 50, y: 30 + HOVER, z: 10 }] });
  assert.equal(planWalk([{ tower, mission: 'confirming', lastTradeAt: null }], home, NOW).mood, 'trade');
  assert.deepEqual(planWalk([{ tower, mission: 'frozen', lastTradeAt: null }], home, NOW), { mood: 'frozen', stops: [{ x: 0, y: 4 + HOVER, z: 0 }] });
  assert.equal(planWalk([{ tower, mission: 'paused', lastTradeAt: null }], home, NOW), null);
  assert.equal(planWalk([{ tower: null, mission: 'working', lastTradeAt: null }], home, NOW), null, 'a coin with no tower in the city: not out');
  assert.deepEqual(planWalk([{ tower, mission: 'working', lastTradeAt: null }], null, NOW).stops, [{ x: 50, y: 30 + HOVER, z: 10 }]);
});

test('every word of the mission and the controls is there in English and Ukrainian', () => {
  for (const key of ['missionConfirming', 'missionFrozen', 'missionPaused', 'missionDone', 'missionStopped', 'freeze', 'resume', 'cancelOrders', 'withdraw', 'noteFrozen', 'noteResumed', 'noteCancelled', 'noteNothingOpen', 'pausedMismatch', 'booksSettling', 'tradeUnknown', 'factControls']) {
    assert.equal(typeof en[key], 'string', key);
    assert.equal(typeof uk[key], 'string', key);
    assert.notEqual(en[key], uk[key], key);
  }
  /* No technical words on the card. */
  for (const text of [en.factControls, uk.factControls, en.frozenLine, en.confirmingLine]) assert.doesNotMatch(text, /API|engine|policy|signature id|cron|RPC/u);
});
