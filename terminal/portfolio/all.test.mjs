import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import {
  DUST_USD,
  addressOf,
  collectLines,
  collectable,
  dayMove,
  exitEstimate,
  exitLines,
  exitPicked,
  exitable,
  groupOf,
  groupsOf,
  loanShare,
  partial,
  platformName,
  primaryOf,
  shortAddress,
  stakeState,
  summaryOf,
  withMarket,
} from './all-view.ts';
import { ALL } from './all-words.ts';
import { DOOR_SHUT, amountFigure, doorOf, maybeSent, outcomeOf, receiveFigures, rentSol, reviewBody, reviewFresh, reviewOf } from './exit-view.ts';
import { PortfolioExitOverviewResponseSchema, PortfolioExitReviewRequestSchema, PortfolioExitReviewResponseSchema, PortfolioExitSubmitResponseSchema } from '../../lib/api/v1/contract.ts';
import { EXIT_SKIP_REASONS } from '../../lib/portfolio/exit/steps.ts';
import { EXIT_REASONS } from '../../lib/portfolio/model.ts';

/* «Everything in Solana»: the engine's one answer laid out as the screen's groups, the total with its parts, what is
   dust, what each of the three actions offers and what an exit can take — and the exit's review, read leniently. */

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const JITO = 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const SPAM = 'Spam1111111111111111111111111111111111111111';
const OWNER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

const whole = (how) => ({ oneStep: true, how, reason: null, partBps: 10_000, untilEpoch: null, untilTime: null });
const blocked = (how, reason, extra = {}) => ({ oneStep: false, how, reason, partBps: 0, untilEpoch: null, untilTime: null, ...extra });
const NO_REFS = { program: null, pool: null, position: null, nftMint: null, market: null, account: null };

const position = (over) => ({
  id: 'x',
  protocol: 'wallet',
  platform: null,
  kind: 'coin',
  state: 'read',
  origin: 'chain',
  label: null,
  value: { usd: null, sol: null },
  earned: null,
  tokens: [],
  inRange: null,
  exit: whole('swap'),
  refs: NO_REFS,
  readAt: '2026-11-17T09:00:00.000Z',
  ...over,
});

const held = (mint, symbol, decimals, amountRaw, usd, role = 'held') => ({ mint, symbol, decimals, amountRaw, usd, role });
const coin = (mint, symbol, decimals, amountRaw, usd, over = {}) => position({ id: `wallet:${mint}`, label: symbol, value: { usd, sol: null }, tokens: [held(mint, symbol, decimals, amountRaw, usd)], ...over });

const POSITIONS = [
  position({ id: 'meteora-dlmm:P1', protocol: 'meteora-dlmm', kind: 'pool', label: 'SOL–USDC', value: { usd: 12_000, sol: 80 }, earned: { usd: 124.1, sol: 0.83 }, inRange: true, exit: whole('pool-withdraw'), refs: { ...NO_REFS, position: 'P1', pool: 'Pool1' }, tokens: [held(SOL, 'SOL', 9, '40000000000', 6000), held(USDC, 'USDC', 6, '6000000000', 6000)] }),
  position({ id: 'meteora-damm-v2:P2', protocol: 'meteora-damm-v2', kind: 'pool', label: 'JUP–SOL', value: { usd: 3_000, sol: 20 }, earned: null, inRange: false, exit: blocked('pool-withdraw', 'LOCKED', { partBps: 6_000 }), refs: { ...NO_REFS, position: 'P2' }, tokens: [held(JUP, 'JUP', 6, '1', 1500), held(SOL, 'SOL', 9, '1', 1500)] }),
  coin(JITO, 'JitoSOL', 9, '10000000000', 1_800, { kind: 'lst' }),
  position({ id: 'native-stake:S1', protocol: 'native-stake', kind: 'stake', label: 'SOL', value: { usd: 750, sol: 5 }, exit: blocked('stake-deactivate', 'STAKE_ACTIVE', { untilEpoch: 912 }), refs: { ...NO_REFS, position: 'S1' }, tokens: [held(SOL, 'SOL', 9, '5000000000', 750)] }),
  position({ id: 'jupiter-lend:USDC', protocol: 'jupiter-lend', kind: 'deposit', label: 'USDC', value: { usd: 2_000, sol: null }, earned: { usd: 12, sol: null }, exit: whole('lend-withdraw'), tokens: [held(USDC, 'USDC', 6, '2000000000', 2000, 'supplied')] }),
  position({ id: 'kamino:O1:deposit', protocol: 'kamino', origin: 'provider', kind: 'deposit', label: 'SOL', value: { usd: 3_000, sol: null }, exit: blocked('lend-withdraw', 'DEBT'), refs: { ...NO_REFS, position: 'O1' }, tokens: [held(SOL, 'SOL', null, null, 3000, 'supplied')] }),
  position({ id: 'kamino:O1:borrow', protocol: 'kamino', origin: 'provider', kind: 'borrow', label: 'USDC', value: { usd: -1_200, sol: null }, exit: blocked('repay', 'REPAY'), refs: { ...NO_REFS, position: 'O1' }, tokens: [held(USDC, 'USDC', null, null, 1200, 'borrowed')] }),
  position({ id: 'other:orca:1', protocol: 'other', platform: 'orca-whirlpools', origin: 'projection', kind: 'pool', label: 'SOL–mSOL', value: { usd: 400, sol: null }, exit: blocked('none', 'PROJECTION') }),
  position({ id: 'wallet:sol', label: 'SOL', value: { usd: 300, sol: 2 }, tokens: [held(SOL, 'SOL', 9, '2000000000', 300)] }),
  coin(USDC, 'USDC', 6, '2500000', 2.5),
  coin(JUP, 'JUP', 6, '135600000', 36.1),
  coin(BONK, 'BONK', 5, '4200000000', 1.2),
  coin(SPAM, 'SPAM', 6, '1000000', null),
];

const TOTAL = 12_000 + 3_000 + 1_800 + 750 + 2_000 + 3_000 - 1_200 + 300 + 2.5 + 36.1 + 1.2;
const source = (name, state = 'read') => ({ source: name, state, reason: state === 'read' ? null : 'TIMEOUT', readAt: null, positions: 0 });
const ANSWER = {
  owner: OWNER,
  at: '2026-11-17T09:00:00.000Z',
  solUsd: 150,
  totals: { usd: TOTAL, sol: TOTAL / 150, earnedUsd: 136.1, projectedUsd: 400, complete: false },
  positions: POSITIONS,
  sources: [source('wallet'), source('meteora-dlmm'), source('kamino')],
};

test('an address is taken bare or out of a link; anything else is not one', () => {
  assert.equal(addressOf(`  ${OWNER} `), OWNER);
  assert.equal(addressOf(`https://solscan.io/account/${OWNER}?cluster=mainnet`), OWNER);
  assert.equal(addressOf('hello'), null);
  assert.equal(addressOf(''), null);
  assert.equal(addressOf(`${OWNER} ${JUP}`), null, 'two addresses — which one is not guessed');
  assert.equal(shortAddress(OWNER), '7xKX…gAsU');
});

test('the groups stand in one order, and a group with nothing in it is not there', () => {
  const groups = groupsOf(ANSWER);
  assert.deepEqual(groups.map((group) => group.id), ['pools', 'staking', 'lending', 'other', 'coins', 'dust']);
  assert.deepEqual(groupsOf({ positions: [coin(JUP, 'JUP', 6, '135600000', 36.1)] }).map((group) => group.id), ['coins']);
  assert.deepEqual(groupsOf({ positions: [] }), []);
  const by = Object.fromEntries(groups.map((group) => [group.id, group]));
  assert.equal(by.pools.count, 2);
  assert.equal(by.pools.usd, 15_000);
  assert.equal(by.staking.usd, 2_550, 'a staked coin and a stake account are both staking');
  assert.equal(by.lending.usd, 3_800, 'deposits less the loan');
  assert.equal(by.other.usd, 400);
});

test('dust is a coin under five dollars — never SOL or USDC — and a coin with no price only when the clean lists it as litter', () => {
  const sol = POSITIONS.find((p) => p.id === 'wallet:sol');
  assert.equal(groupOf({ ...sol, value: { usd: 0.4, sol: 0.003 } }), 'coins', 'a little SOL is still SOL');
  assert.equal(groupOf(coin(USDC, 'USDC', 6, '2500000', 2.5)), 'coins');
  assert.equal(groupOf(coin(BONK, 'BONK', 5, '1', DUST_USD - 0.01)), 'dust');
  assert.equal(groupOf(coin(BONK, 'BONK', 5, '1', DUST_USD)), 'dust', 'up to five dollars — the clean’s own line');
  assert.equal(groupOf(coin(BONK, 'BONK', 5, '1', DUST_USD + 0.01)), 'coins');
  const spam = coin(SPAM, 'SPAM', 6, '1000000', null);
  assert.equal(groupOf(spam), 'coins', 'a price that did not read does not make a coin dust');
  assert.equal(groupOf(spam, new Set([SPAM])), 'dust');
  assert.equal(groupOf(position({ id: 'wallet:unread:wallet', state: 'unread' })), 'coins', 'a wallet that was not read says so among the coins');
  assert.equal(groupOf(coin(JITO, 'JitoSOL', 9, '1', 1, { kind: 'lst' })), 'staking', 'staked SOL is staking, however little');
});

test('a row carries its coins, its amount and its price for the eye', () => {
  const rows = groupsOf(ANSWER).flatMap((group) => group.rows);
  const jup = rows.find((row) => row.id === `wallet:${JUP}`);
  assert.equal(jup.units, 135.6);
  assert.ok(Math.abs(jup.price - 36.1 / 135.6) < 1e-12);
  const pool = rows.find((row) => row.id === 'meteora-dlmm:P1');
  assert.deepEqual(pool.coins.map((c) => c.symbol), ['SOL', 'USDC']);
  assert.equal(pool.units, null, 'a pair has no one amount');
  assert.equal(pool.earnedUsd, 124.1);
});

test('the total is the engine’s sum with the agents beside it; its parts add up to it; other platforms stand apart', () => {
  const groups = groupsOf(ANSWER);
  const sum = summaryOf(ANSWER, groups);
  assert.ok(Math.abs(sum.usd - TOTAL) < 1e-9);
  assert.ok(Math.abs(sum.sol - TOTAL / 150) < 1e-9);
  assert.equal(sum.complete, true, 'every source answered and what works is priced — a spam coin without a price does not make it «so far»');
  assert.equal(summaryOf({ ...ANSWER, sources: [source('wallet'), source('kamino', 'stale')] }, groups).complete, false);
  assert.equal(summaryOf({ ...ANSWER, solUsd: null }, groups).complete, false);
  assert.deepEqual(sum.parts.map((part) => part.id), ['pools', 'staking', 'lending', 'coins', 'dust'], 'the legend names the dust apart, as its group does');
  const of = (id) => groups.find((group) => group.id === id).usd;
  assert.equal(sum.parts.find((part) => part.id === 'coins').usd, of('coins'), 'the legend says what the group says');
  assert.equal(sum.unread, false, 'every source answered: nothing to read again');
  assert.equal(summaryOf({ ...ANSWER, sources: [source('wallet'), source('kamino', 'unread')] }, groups).unread, true);
  assert.ok(Math.abs(sum.parts.reduce((total, part) => total + part.usd, 0) - TOTAL) < 1e-9, 'the same money never twice, and none left out');
  assert.ok(Math.abs(sum.bar.reduce((total, seg) => total + seg.share, 0) - 1) < 1e-9);
  assert.equal(sum.empty, false);

  const withAgents = summaryOf(ANSWER, groups, 57.49);
  assert.ok(Math.abs(withAgents.usd - (TOTAL + 57.49)) < 1e-9);
  assert.equal(withAgents.parts.at(-1).id, 'agents');

  const nothing = { ...ANSWER, positions: [], totals: { usd: 0, sol: 0, earnedUsd: 0, projectedUsd: 0, complete: true } };
  assert.equal(summaryOf(nothing, []).empty, true);
  assert.equal(summaryOf({ ...nothing, sources: [source('wallet', 'unread')] }, []).empty, false, 'not everything read is never «empty»');
  assert.equal(summaryOf(nothing, [], 10).empty, false, 'an agent holding money is not nothing');
});

test('the market names and prices what the engine could not: a pool whose coin had no symbol and no price', () => {
  const STNK = 'Stnk111111111111111111111111111111111111111';
  const pool = position({
    id: 'meteora-damm-v2:P9',
    protocol: 'meteora-damm-v2',
    kind: 'pool',
    label: null,
    value: { usd: null, sol: null },
    earned: { usd: 22.5, sol: 0.3 },
    inRange: true,
    exit: whole('pool-withdraw'),
    tokens: [held(STNK, null, 9, '351482631436252393', null), held(SOL, 'SOL', 9, '2845083434', 208.25), held(SOL, 'SOL', 9, '307796944', 22.5, 'fee')],
  });
  const answer = { ...ANSWER, positions: [pool, ...POSITIONS], totals: { ...ANSWER.totals } };
  const fact = (mint) => (mint === STNK ? { symbol: 'STNK', name: 'Stonk Index', icon: null, price: 7.8e-7, dayPct: null } : null);
  const groups = withMarket(groupsOf(answer), fact);
  const row = groups.find((group) => group.id === 'pools').rows.find((r) => r.id === 'meteora-damm-v2:P9');
  assert.equal(row.name, 'STNK–SOL', 'the pair by its coins — never the same coin twice');
  assert.ok(Math.abs(row.usd - (351_482_631.436252393 * 7.8e-7 + 208.25 + 22.5)) < 1e-6, 'priced at the market where every coin has a price, its fees with it as the engine counts them');
  assert.equal(row.marketPriced, true);
  const sum = summaryOf(answer, groups);
  assert.ok(Math.abs(sum.usd - (TOTAL + row.usd)) < 1e-6, 'the total counts what the screen priced, once');
  assert.equal(sum.complete, true, 'nothing that works is left without a price');
  const silent = withMarket(groupsOf(answer), () => null).find((group) => group.id === 'pools').rows.find((r) => r.id === 'meteora-damm-v2:P9');
  assert.equal(silent.usd, null, 'a coin the market does not price leaves the position unpriced');
  assert.equal(silent.name, null);
  const spam = withMarket(groupsOf(answer), () => ({ symbol: 'X', name: null, icon: null, price: 1, dayPct: null })).find((group) => group.id === 'coins').rows.find((r) => r.id === `wallet:${SPAM}`);
  assert.equal(spam.usd, null, 'a coin the engine did not price stays «No price»: the market prices only what works');
});

test('today’s move counts the coins the market moved, at their worth at the day’s start', () => {
  const rows = groupsOf(ANSWER).flatMap((group) => group.rows);
  const change = (mint) => ({ [SOL]: 5, [JUP]: -2, [JITO]: 4 })[mint] ?? null;
  const day = dayMove(rows, change);
  const expected = 300 - 300 / 1.05 + (36.1 - 36.1 / 0.98) + (1_800 - 1_800 / 1.04) + (750 - 750 / 1.05);
  assert.ok(Math.abs(day.usd - expected) < 1e-9, 'the wallet’s SOL, a coin, a staked coin and a stake — never a pool, a deposit or another platform’s row');
  assert.equal(dayMove(rows, () => null), null, 'no move read — no move said');
});

test('a stake says where it stands; a loan says its share of the deposit on the same account', () => {
  const by = Object.fromEntries(POSITIONS.map((p) => [p.id, p]));
  assert.equal(stakeState(by[`wallet:${JITO}`]), 'coin');
  assert.equal(stakeState(by['native-stake:S1']), 'active');
  assert.equal(stakeState(position({ kind: 'stake', exit: blocked('stake-withdraw', 'STAKE_COOLING', { untilEpoch: 913 }) })), 'cooling');
  assert.equal(stakeState(position({ kind: 'stake', exit: whole('stake-withdraw') })), 'free');
  assert.equal(stakeState(position({ kind: 'stake', exit: blocked('stake-withdraw', 'STAKE_LOCKUP') })), 'held');
  const rows = groupsOf(ANSWER).find((group) => group.id === 'lending').rows;
  assert.equal(loanShare(rows.find((row) => row.id === 'kamino:O1:borrow'), rows), 40);
  assert.equal(loanShare(rows.find((row) => row.id === 'kamino:O1:deposit'), rows), null, 'only a loan has a share');
  assert.equal(platformName('orca-whirlpools'), 'Orca Whirlpools');
  assert.equal(platformName(null), null);
});

test('«Collect fees» is the pools with something to collect', () => {
  const groups = groupsOf(ANSWER);
  const offer = collectable(groups);
  assert.deepEqual(offer.rows.map((row) => row.id), ['meteora-dlmm:P1']);
  assert.equal(offer.usd, 124.1);
  assert.deepEqual(collectLines(groups).map((line) => [line.id, line.can]), [['meteora-dlmm:P1', 'now']]);
  const closed = { positions: [{ ...POSITIONS[0], exit: blocked('pool-withdraw', 'CLOSED_HERE') }] };
  assert.deepEqual(collectable(groupsOf(closed)).rows, [], 'a pool the engine has no step for offers nothing to collect');
});

test('«Exit everything» is what works — never the wallet’s coins — each with how an exit takes it', () => {
  const lines = exitLines(groupsOf(ANSWER));
  assert.deepEqual(
    lines.map((line) => [line.id, line.can]),
    [
      ['meteora-dlmm:P1', 'now'],
      ['meteora-damm-v2:P2', 'part'],
      [`wallet:${JITO}`, 'now'],
      ['native-stake:S1', 'later'],
      ['jupiter-lend:USDC', 'now'],
      ['kamino:O1:deposit', 'no'],
      ['kamino:O1:borrow', 'no'],
    ],
  );
  assert.equal(lines.find((line) => line.id === 'meteora-damm-v2:P2').partPct, 60);
  assert.equal(lines.find((line) => line.id === 'native-stake:S1').untilEpoch, 912);
  const picked = exitPicked(lines, ['native-stake:S1']);
  assert.deepEqual(picked.map((line) => line.id), ['meteora-dlmm:P1', 'meteora-damm-v2:P2', `wallet:${JITO}`, 'jupiter-lend:USDC'], 'what an exit cannot take is never picked');
  assert.ok(lines.filter((line) => !exitable(line)).every((line) => !picked.includes(line)));
  assert.deepEqual(exitPicked(lines, [], ['jupiter-lend:USDC']).map((line) => line.id), ['jupiter-lend:USDC'], 'opened from a row: only that row is on — a position that appears later is not');
  assert.deepEqual(exitPicked(lines, ['jupiter-lend:USDC'], ['jupiter-lend:USDC', 'meteora-dlmm:P1']).map((line) => line.id), ['meteora-dlmm:P1']);
  assert.deepEqual(exitPicked(lines, [], ['kamino:O1:borrow']), [], 'naming a line an exit cannot take does not pick it');
});

test('the estimate before the engine built anything: the picked worth in the chosen coin, a locked part at its share', () => {
  const lines = exitLines(groupsOf(ANSWER));
  const picked = exitPicked(lines, ['native-stake:S1']);
  const usd = 12_000 + 3_000 * 0.6 + 1_800 + 2_000;
  assert.deepEqual(exitEstimate(picked, 'USDC', 150), { sol: null, usdc: usd });
  assert.deepEqual(exitEstimate(picked, 'SOL', 150), { sol: usd / 150, usdc: null });
  assert.deepEqual(exitEstimate(picked, 'SPLIT', 150), { sol: usd / 300, usdc: usd / 2 });
  assert.equal(exitEstimate(picked, 'SOL', null), null, 'no SOL price — no SOL figure');
  assert.equal(exitEstimate([], 'USDC', 150), null);
  // A stake that only starts to leave brings nothing now: with it switched on the figure is the same.
  assert.deepEqual(exitEstimate(exitPicked(lines, []), 'USDC', 150), { sol: null, usdc: usd });
  assert.deepEqual(exitEstimate(exitPicked(lines, [], ['native-stake:S1']), 'SOL', 150), { sol: 0, usdc: null });
});

test('one amber action: the one that gives this person the most; an exit is never pressed on anyone', () => {
  assert.equal(primaryOf({ own: false, collectUsd: 500, cleanUsd: 3 }), 'connect');
  assert.equal(primaryOf({ own: true, collectUsd: 124.1, cleanUsd: 3 }), 'collect');
  assert.equal(primaryOf({ own: true, collectUsd: 0.4, cleanUsd: 3 }), 'clean');
  assert.equal(primaryOf({ own: true, collectUsd: null, cleanUsd: 3 }), 'clean');
  assert.equal(primaryOf({ own: true, collectUsd: 0.001, cleanUsd: null }), 'topUp', 'a fraction of a cent is not worth an approval');
  assert.equal(primaryOf({ own: true, collectUsd: null, cleanUsd: null }), 'topUp');
});

test('a source that did not answer makes the screen offer to read again; the third party’s silence does not', () => {
  assert.equal(partial(ANSWER), false);
  assert.equal(partial({ sources: [source('wallet'), source('kamino', 'stale')] }), true);
  assert.equal(partial({ sources: [source('wallet'), source('meteora-dlmm', 'unread')] }), true);
  assert.equal(partial({ sources: [source('wallet'), source('jupiter-portfolio', 'unread')] }), false);
  // A source read only in part — the wallet's coins without its wrapped SOL — says so too.
  const inPart = { ...source('wallet'), reason: 'TIMEOUT' };
  assert.equal(partial({ sources: [inPart, source('kamino')] }), true);
  assert.equal(summaryOf({ ...ANSWER, sources: [inPart, source('kamino')] }, groupsOf(ANSWER)).unread, true);
  assert.equal(summaryOf({ ...ANSWER, sources: [inPart, source('kamino')] }, groupsOf(ANSWER)).complete, false, 'the total says «so far»');
  // A coin nobody prices is not a part not read: the engine's `complete: false` for it alone is no «Not everything was read».
  assert.equal(ANSWER.totals.complete, false);
  assert.equal(summaryOf(ANSWER, groupsOf(ANSWER)).unread, false);
});

test('wrapped SOL is a coin of its own at SOL’s price, in the coins and in the total — never dust, never SOL itself', () => {
  const wsol = coin(SOL, 'wSOL', 9, '86260508921310', 6_452_286.07);
  const answer = { ...ANSWER, positions: [...POSITIONS, wsol], totals: { ...ANSWER.totals, usd: TOTAL + 6_452_286.07 } };
  const groups = groupsOf(answer);
  const coins = groups.find((group) => group.id === 'coins');
  const row = coins.rows.find((entry) => entry.id === `wallet:${SOL}`);
  assert.ok(row, 'it stands among the coins');
  assert.equal(row.name, 'wSOL');
  assert.ok(Math.abs(row.price - 6_452_286.07 / 86_260.50892131) < 1e-6, 'priced as SOL is');
  assert.ok(coins.rows.some((entry) => entry.id === 'wallet:sol'), 'native SOL keeps its own row');
  const sum = summaryOf(answer, groups);
  assert.ok(Math.abs(sum.usd - (TOTAL + 6_452_286.07)) < 0.01);
  assert.ok(Math.abs(sum.parts.find((part) => part.id === 'coins').usd - coins.usd) < 1e-6, 'the legend is the group');
  assert.equal(groupOf(coin(SOL, 'wSOL', 9, '3000000', 0.45)), 'coins', 'a few cents of wrapped SOL is SOL, never dust');
});

/* ── the exit's review: the engine's own form ── */

const REVIEW = {
  network: 'solana:mainnet',
  owner: OWNER,
  mode: 'exit',
  target: 'SPLIT',
  ticket: 'ticket',
  transactions: ['AQID', 'BAUG'],
  kinds: ['leave', 'swap'],
  refs: ['meteora-dlmm:P1', 'wallet:x'],
  expiresAt: '2026-11-17T09:01:00.000Z',
  signableMs: 20_000,
  summary: {
    receive: { lamports: '12400000000', usdcRaw: '1904100000' },
    rentLamports: '21000000',
    feeBps: 25,
    transactions: 2,
    done: [{ id: 'meteora-dlmm:P1', action: 'leave', partBps: 10_000 }],
    later: [{ id: 'native-stake:S1', untilEpoch: 912 }],
    skipped: [{ id: 'jupiter-lend:USDC', reason: 'SIMULATION_FAILED' }],
    others: [{ mint: JUP, decimals: 6, amountRaw: '512000000', reason: 'NO_PRICE' }],
    held: [{ id: 'kamino:O1:deposit', protocol: 'kamino', kind: 'deposit', label: 'SOL', reason: 'DEBT', usd: 3000, untilEpoch: null, untilTime: null }],
  },
};

test('the door is the engine’s one switch for both actions, shut until it says otherwise', () => {
  assert.deepEqual(doorOf({ canExit: true, items: [], held: [] }), { canExit: true, canCollect: true });
  assert.deepEqual(doorOf({ canExit: false }), DOOR_SHUT);
  assert.deepEqual(doorOf({ canExit: 'yes' }), DOOR_SHUT);
  assert.deepEqual(doorOf(null), DOOR_SHUT);
});

test('a review is read as the engine sent it: what comes, the rent, the fee, what stays out', () => {
  const review = reviewOf(REVIEW);
  assert.equal(review.mode, 'exit');
  assert.equal(review.target, 'SPLIT');
  assert.equal(review.transactions.length, 2);
  assert.equal(review.signableMs, 20_000);
  const spent = reviewOf({ ...REVIEW, signableMs: 0 });
  assert.equal(spent.signableMs, 0, 'zero is the engine’s answer, not a missing one');
  assert.equal(reviewFresh(1_000, 1_001, spent.signableMs), false, 'a package that can no longer be signed is built again at the press');
  assert.deepEqual(receiveFigures(review), ['12.40 SOL', '1,904.10 USDC']);
  assert.equal(rentSol(review), 0.021);
  assert.equal(review.summary.feeBps, 25);
  assert.equal(review.summary.others, 1);
  assert.deepEqual(review.summary.left, [
    { id: 'native-stake:S1', reason: 'STAKE_ACTIVE', untilEpoch: 912 },
    { id: 'jupiter-lend:USDC', reason: 'SIMULATION_FAILED', untilEpoch: null },
  ]);
  assert.deepEqual(receiveFigures(reviewOf({ ...REVIEW, summary: { ...REVIEW.summary, receive: { lamports: '13120000000', usdcRaw: '0' } } })), ['13.12 SOL'], 'one coin for a one-coin target');
});

test('a review with nothing to sign, or a transaction that is not one, is no review; a missing figure is absent, never guessed', () => {
  assert.equal(reviewOf({ ...REVIEW, transactions: [] }), null);
  assert.equal(reviewOf({ ...REVIEW, transactions: ['AQID', 7] }), null, 'a package is signed whole or not at all');
  assert.equal(reviewOf({ ...REVIEW, ticket: '' }), null);
  assert.equal(reviewOf({ ...REVIEW, summary: null }), null);
  assert.equal(reviewOf({ error: { code: 'CAPABILITY_UNAVAILABLE' } }), null);
  const bare = reviewOf({ ticket: 't', transactions: ['AQID'], summary: {}, mode: 'collect' });
  assert.equal(bare.mode, 'collect');
  assert.equal(bare.target, null);
  assert.equal(bare.signableMs, null);
  assert.deepEqual(bare.summary, { lamports: '0', usdcRaw: '0', rentLamports: '0', feeBps: null, left: [], others: 0 });
  assert.deepEqual(receiveFigures(bare), []);
  assert.equal(rentSol(bare), null);
  assert.equal(reviewOf({ ...REVIEW, summary: { ...REVIEW.summary, receive: { lamports: '-5', usdcRaw: 'abc' } } }).summary.lamports, '0');
  assert.deepEqual(reviewOf({ ...REVIEW, summary: { ...REVIEW.summary, skipped: [{ id: 'x' }, { reason: 'NO_ROOM' }] } }).summary.left.map((left) => left.id), ['native-stake:S1'], 'a skipped step without its reason or its id says nothing');
});

test('figures for the eye, a review’s freshness, and what a relay’s answer means', () => {
  assert.equal(amountFigure(1904.1), '1,904.10');
  assert.equal(amountFigure(0.30264), '0.3026');
  assert.equal(amountFigure(0), '0');
  assert.equal(reviewFresh(1_000, 5_000), true);
  assert.equal(reviewFresh(1_000, 20_000), false);
  assert.equal(reviewFresh(0, 5), false);
  assert.equal(reviewFresh(1_000, 12_500, 20_000), true, 'twenty seconds to sign: the first twelve are the review’s');
  assert.equal(reviewFresh(1_000, 4_000, 10_000), false, 'ten seconds to sign leave two before the wallet needs the rest');
  assert.equal(outcomeOf({ results: [{ state: 'LANDED' }, { state: 'LANDED' }], settled: true }), 'done');
  assert.equal(outcomeOf({ results: [{ state: 'LANDED' }, { state: 'NOT_SENT' }] }), 'part');
  assert.equal(outcomeOf({ results: [{ state: 'UNKNOWN' }] }), 'unsure', 'sent and not confirmed is never «nothing moved»');
  assert.equal(outcomeOf({ results: [{ state: 'LANDED' }, { state: 'UNKNOWN' }] }), 'unsure');
  assert.equal(outcomeOf({ results: [{ state: 'FAILED' }, { state: 'NOT_SENT' }] }), 'none');
  // A submit that came back with an error: a lost answer may have sent the package; the engine's own refusal sent nothing.
  for (const code of ['NETWORK', 'HTTP_502', 'HTTP_504', 'UNAVAILABLE']) assert.equal(maybeSent(code), true, code);
  for (const code of ['CAPABILITY_UNAVAILABLE', 'PORTFOLIO_EXIT_TICKET_EXPIRED', 'PORTFOLIO_EXIT_SIGNED_MISMATCH', 'HTTP_404', 'VALIDATION_ERROR']) assert.equal(maybeSent(code), false, code);
  assert.equal(outcomeOf({ results: [] }), 'none', 'an answer that names nothing landed nothing');
  assert.equal(outcomeOf(null), 'none');
});

/* ── the engine's own contract (`lib/api/v1/contract.ts`) ──── */

test('what the screen asks for is what the engine takes, and what the engine answers reads as the screen reads it', () => {
  // The request: an exit names its coin, collecting does not; the positions are the ones left on.
  assert.deepEqual(PortfolioExitReviewRequestSchema.parse(reviewBody(OWNER, 'exit', 'SPLIT', ['meteora-dlmm:P1', `wallet:${JITO}`])), { owner: OWNER, mode: 'exit', target: 'SPLIT', positions: ['meteora-dlmm:P1', `wallet:${JITO}`] });
  assert.deepEqual(PortfolioExitReviewRequestSchema.parse(reviewBody(OWNER, 'collect', 'SOL', ['meteora-dlmm:P1'])), { owner: OWNER, mode: 'collect', positions: ['meteora-dlmm:P1'] });

  // The engine's package, as its schema holds it.
  const wire = 'A'.repeat(88);
  const signature = '5'.repeat(88);
  const review = PortfolioExitReviewResponseSchema.parse({
    network: 'solana:mainnet',
    owner: OWNER,
    mode: 'exit',
    target: 'SPLIT',
    ticket: 't'.repeat(48),
    transactions: [wire, wire],
    kinds: ['leave', 'swap'],
    refs: ['meteora-dlmm:P1', SOL],
    expiresAt: '2026-11-17T09:01:00.000Z',
    signableMs: 20_000,
    summary: {
      receive: { lamports: '12400000000', usdcRaw: '1904100000' },
      rentLamports: '21000000',
      feeBps: 25,
      transactions: 2,
      done: [{ id: 'meteora-dlmm:P1', action: 'leave', partBps: 10_000 }],
      later: [{ id: 'native-stake:S1', untilEpoch: 912 }],
      skipped: [{ id: 'jupiter-lend:USDC', reason: 'SIMULATION_FAILED' }],
      others: [{ mint: JUP, decimals: 6, amountRaw: '512000000', reason: 'NO_PRICE' }],
      held: [],
    },
  });
  const read = reviewOf(review);
  assert.equal(read.target, 'SPLIT');
  assert.equal(read.transactions.length, 2);
  assert.deepEqual(receiveFigures(read), ['12.40 SOL', '1,904.10 USDC']);
  assert.equal(rentSol(read), 0.021);
  assert.deepEqual(read.summary.left.map((left) => [left.id, left.reason]), [['native-stake:S1', 'STAKE_ACTIVE'], ['jupiter-lend:USDC', 'SIMULATION_FAILED']]);
  assert.equal(read.summary.others, 1);

  // The door: the overview's `canExit` opens both actions; shut otherwise.
  const overview = PortfolioExitOverviewResponseSchema.parse({ network: 'solana:mainnet', owner: OWNER, mode: 'exit', target: 'SOL', canExit: false, items: [], held: [], estimate: { usd: null, lamports: null, usdcRaw: null }, solUsd: 150, complete: true, at: '2026-11-17T09:00:00.000Z' });
  assert.deepEqual(doorOf(overview), DOOR_SHUT);
  assert.deepEqual(doorOf({ ...overview, canExit: true }), { canExit: true, canCollect: true });

  // A relay's answer: one transaction landed, one sent without an answer yet.
  const relay = PortfolioExitSubmitResponseSchema.parse({ results: [{ kind: 'leave', ref: 'meteora-dlmm:P1', signature, state: 'LANDED', reason: null }, { kind: 'sweep', ref: SOL, signature, state: 'UNKNOWN', reason: null }], settled: false });
  assert.equal(outcomeOf(relay), 'unsure');
});

test('every reason the engine can give has a person’s own words in both languages', () => {
  for (const lang of ['en', 'uk']) {
    const fallback = ALL[lang].reason('SOMETHING_NEW');
    for (const code of [...EXIT_REASONS, ...EXIT_SKIP_REASONS]) {
      const said = ALL[lang].reason(code, { pct: 60, epoch: 912, date: '1 Dec 2026' });
      assert.ok(said && said !== fallback, `${lang} ${code}`);
    }
  }
});

/* ── the words, and the screen's own form ────────────────────────────── */

test('both languages say the same things; every reason an exit can give has a person’s words in both', () => {
  assert.deepEqual(Object.keys(ALL.uk).sort(), Object.keys(ALL.en).sort());
  const reasons = ['NOT_READ', 'PROJECTION', 'NO_ROUTE', 'LOCKED', 'LIQUIDITY', 'DEBT', 'REPAY', 'STAKE_ACTIVE', 'STAKE_COOLING', 'STAKE_LOCKUP', 'NOT_WITHDRAWER', 'CLOSED_HERE', 'SIMULATION_FAILED', 'NO_ROOM', 'NOTHING_TO_DO', 'NO_PRICE', 'TOO_SMALL', 'PAUSED', 'REFUSED', 'UNAVAILABLE', 'UNVERIFIED'];
  for (const lang of ['en', 'uk']) {
    const fallback = ALL[lang].reason('SOMETHING_NEW');
    assert.ok(fallback.length > 0, 'a code the screen does not know still says something');
    for (const code of reasons) {
      const said = ALL[lang].reason(code, { pct: 60, epoch: 912, date: '1 Dec 2026' });
      assert.ok(said.length > 0 && said !== fallback, `${lang} ${code}`);
      assert.doesNotMatch(said, /[A-Z]{2,}_[A-Z]/, 'never the code itself');
    }
  }
  assert.match(ALL.uk.reason('LOCKED', { pct: 60 }), /60%/);
  assert.match(ALL.en.reason('STAKE_COOLING', { epoch: 912 }), /912/);
  assert.equal(ALL.uk.collectFact('$124,10', 3), '$124,10 у 3 пулах');
  assert.equal(ALL.uk.exitFact(1), '1 позиція → SOL, USDC або 50/50');
  assert.equal(ALL.en.exitFact(5), '5 positions → SOL, USDC or 50/50');
  assert.equal(ALL.uk.cleanFact('0,07', 1, 5), '≈ 0,07 SOL · 1 монета · 5 рахунків');
  assert.equal(ALL.en.cleanFact('0.07', 0, 1), '≈ 0.07 SOL · 1 account');
  // No technical words on screen, and nothing of the city's.
  const said = JSON.stringify(ALL.uk) + JSON.stringify(ALL.en) + ['en', 'uk'].flatMap((lang) => reasons.map((code) => ALL[lang].reason(code))).join(' ');
  assert.doesNotMatch(said, /причал|вежа|pier|tower|\bAPI\b|\bRPC\b|program id|мінт/i);
});

test('one form: «Everything in Solana» writes no corner of its own — the kit’s parts carry every one', () => {
  const css = readFileSync(new URL('./all.module.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /border(-[a-z]+)*-radius\s*:/, 'a corner is the kit’s (terminal/ui), not the screen’s');
  assert.doesNotMatch(css, /clip-path/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'colours are the terminal’s tokens');
  assert.doesNotMatch(css, /\[data-pro\]/);
});

test('one variant of the screen: no branch on «Pro» anywhere in the Portfolio', () => {
  const dir = new URL('./', import.meta.url);
  for (const name of readdirSync(dir).filter((file) => /\.tsx?$/.test(file))) {
    assert.doesNotMatch(readFileSync(new URL(name, dir), 'utf8'), /usePro\b|shell\/pro/, name);
  }
});
