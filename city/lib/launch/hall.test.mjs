import assert from 'node:assert/strict';
import test from 'node:test';

import { judgeCityTrade } from '../../../lib/city-economy/honest-count.ts';
import {
  catchTenths,
  cityTradeOf,
  FIGURE_KINDS,
  HALL_MARKETS_MAX,
  HALL_ROWS,
  HALL_WINDOW_MS,
  hallCandidates,
  hallOpen,
  hallTrades,
  hallView,
  rawToMicros,
  readHallView,
} from './hall.ts';

/*
 * The Hall of Fame counts only what the honest count lets a billboard count, and every number it shows says what it
 * is: its type, its period, the transaction or account behind it and when the engine read it.
 */

const NOW = Date.parse('2026-10-27T12:00:00.000Z');
const DAY = 24 * 60 * 60_000;
const iso = (ms) => new Date(ms).toISOString();

const CREATOR = '3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL';
const CREATOR_2 = '8dHEnBmCKcdwXz2mBSyW8D5DsFRYrsU9mJJrXeckMhPk';
const HUNTER_A = '6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp';
const HUNTER_B = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const HUNTER_C = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T';
const RYNTRA = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MINT_2 = 'So11111111111111111111111111111111111111112';
const CURVE = 'DBCxV6WXcLz5GtqGsc2k1Hk1b7kFLtVKRBdpWVPtbZTn';
const POOL = 'PooLa9bMxkYJ2r7yR2n5Wq8f3vVdHHzv5yUkr6b3cXHi';
const USDC = { mint: '9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB', symbol: 'USDC', decimals: 6, dollar: true };
const COMMUNITY = { mint: '9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB', symbol: 'BONK', decimals: 5, dollar: false };

const masked = (wallet) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
const sig = (n) => `${'5'.repeat(84)}${'ABCDEFGHJK'[n % 10]}${'abcdefghij'[Math.floor(n / 10) % 10]}${'KLMNPQRSTU'[Math.floor(n / 100) % 10]}`;

const trade = (n, over = {}) => ({
  signature: sig(n),
  at: iso(NOW - DAY),
  side: 'buy',
  venue: 'curve',
  trader: HUNTER_A,
  payer: over.trader ?? HUNTER_A,
  traderLabels: [],
  tokensRaw: '1000000',
  pairRaw: '25000000',
  feeRaw: '250000',
  marketCapPair: 10_000,
  ...over,
});

const row = (over = {}) => ({
  token: MINT,
  name: 'Lumen',
  symbol: 'LUMEN',
  image: null,
  preset: 'classic',
  launchedAt: iso(NOW - 5 * DAY),
  creator: CREATOR,
  technicalValidation: false,
  pair: USDC,
  read: true,
  ...over,
});

const market = (rows, over = {}) => ({
  network: 'solana:mainnet',
  token: MINT,
  pair: USDC,
  marketCap: { pair: 34_000, usd: 34_000 },
  trades: { rows: [...rows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), complete: true, read: rows.length },
  creator: { address: CREATOR, curves: 1, tradesComplete: true },
  observedAt: iso(NOW - 60_000),
  ...over,
});

const stats = (over = {}) => ({
  network: 'solana:mainnet',
  token: MINT,
  creator: CREATOR,
  pair: USDC,
  links: { curve: CURVE, pool: null, position: null, lock: null },
  revenue: {
    day: { curve: { raw: '1000000', atLeast: false }, graduation: { raw: '0', atLeast: false }, lp: { raw: '0', atLeast: false } },
    week: { curve: { raw: '4210000000', atLeast: false }, graduation: { raw: '0', atLeast: false }, lp: { raw: '0', atLeast: false } },
  },
  observedAt: iso(NOW - 30_000),
  ...over,
});

/** A judgement as the honest count gives it, for the trades the test names. */
const judgement = (tx, cluster, counted = cluster === 'outside') => ({
  tx,
  at: iso(NOW - DAY),
  cluster,
  inside: cluster === 'inside' ? { party: 'creator', why: 'shared_funder' } : null,
  counts: Object.fromEntries(['points', 'billboards', 'war', 'prestige', 'host_share'].map((use) => [use, counted ? { counted: true } : { counted: false, reason: cluster === 'inside' ? 'cluster' : 'unverified' }])),
  rules: 'test',
});

const judgeAll = (reads, cluster = 'outside') => new Map(hallTrades(reads, NOW, new Set()).map((t) => [t.tx, judgement(t.tx, cluster)]));

const view = (reads, judgements = judgeAll(reads), exclude = new Set(), listed = reads.length) => hallView({ network: 'solana:mainnet', reads, judgements, exclude, listed, now: NOW });

test('every number says its type: a catch is a multiple since the buy, a creator a fee — never a profit', () => {
  const reads = [{ row: row(), market: market([trade(1, { marketCapPair: 10_000 })]), stats: stats(), weekFee: { raw: '4210000000', atLeast: false } }];
  const hall = view(reads);
  const [top] = hall.boards.catch.rows;
  assert.deepEqual(top.figure, { kind: 'multiple', tenths: 34, since: 'buy' });
  const [creator] = hall.boards.creators.rows;
  assert.equal(creator.figure.kind, 'fee');
  assert.equal(creator.figure.of, 'creator');
  assert.equal(creator.figure.raw, '4210000000');
  for (const board of Object.values(hall.boards)) {
    for (const r of board.rows) {
      assert.ok(FIGURE_KINDS.includes(r.figure.kind), `${r.figure.kind} is one of the types a billboard may show`);
      assert.notEqual(r.figure.kind, 'net', 'nothing on the Hall is passed off as a result');
    }
  }
});

test('a multiple is rounded down, never more than it is, and needs the coin up since the buy', () => {
  assert.equal(catchTenths(34_000, 10_000), 34);
  assert.equal(catchTenths(33_999, 10_000), 33);
  assert.equal(catchTenths(10_000, 10_000), 10);
  assert.equal(catchTenths(0, 10_000), null);
  assert.equal(catchTenths(10_000, 0), null);
  const reads = [{ row: row(), market: market([trade(1, { marketCapPair: 33_000 })]), stats: null, weekFee: null }];
  assert.deepEqual(view(reads).boards.catch.rows, [], '×1.03 is not a catch');
});

test('the creator figure is the engine\'s own total, never the city adding the sources up', () => {
  const engineStats = stats({ revenue: { day: stats().revenue.day, week: { curve: { raw: '1000000', atLeast: false }, graduation: { raw: '2000000', atLeast: false }, lp: { raw: '0', atLeast: true } } } });
  const reads = [{ row: row(), market: market([trade(1)]), stats: engineStats, weekFee: { raw: '3000000', atLeast: true } }];
  const [creator] = view(reads).boards.creators.rows;
  assert.equal(creator.figure.raw, '3000000');
  assert.equal(creator.figure.atLeast, true);
});

test('every number has its period: a catch from its buy to the read, a creator the engine\'s seven days up to its read', () => {
  const buyAt = iso(NOW - 2 * DAY);
  const m = market([trade(1, { at: buyAt })]);
  const s = stats();
  const hall = view([{ row: row(), market: m, stats: s, weekFee: { raw: '5000000', atLeast: false } }]);
  assert.deepEqual(hall.boards.catch.rows[0].period, { from: buyAt, to: m.observedAt });
  assert.equal(hall.boards.catch.rows[0].readAt, m.observedAt);
  assert.deepEqual(hall.boards.creators.rows[0].period, { from: iso(Date.parse(s.observedAt) - HALL_WINDOW_MS), to: s.observedAt });
  assert.deepEqual(hall.window, { from: iso(NOW - HALL_WINDOW_MS), to: iso(NOW) });
  assert.equal(hall.readAt, m.observedAt, 'the Hall says its oldest read');
});

test('every number has where to check it: the buy\'s transaction, the creator\'s curve or pool', () => {
  const hall = view([{ row: row(), market: market([trade(7)]), stats: stats(), weekFee: { raw: '5000000', atLeast: false } }]);
  assert.deepEqual(hall.boards.catch.rows[0].proof, { kind: 'tx', id: sig(7), url: `https://solscan.io/tx/${sig(7)}` });
  assert.deepEqual(hall.boards.creators.rows[0].proof, { kind: 'account', id: CURVE, url: `https://solscan.io/account/${CURVE}` });
  const graduated = view([{ row: row(), market: market([trade(7)]), stats: stats({ links: { curve: CURVE, pool: POOL, position: null, lock: null } }), weekFee: { raw: '5000000', atLeast: false } }]);
  assert.equal(graduated.boards.creators.rows[0].proof.id, POOL);
  const devnet = hallView({ network: 'solana:devnet', reads: [{ row: row(), market: market([trade(7)]), stats: null, weekFee: null }], judgements: judgeAll([{ row: row(), market: market([trade(7)]) }]), exclude: new Set(), listed: 1, now: NOW });
  assert.equal(devnet.boards.catch.rows[0].proof.url, `https://solscan.io/tx/${sig(7)}?cluster=devnet`);
});

test('the week is the last seven days: an older buy is no catch of this week and not in its tally', () => {
  const reads = [{ row: row(), market: market([trade(1, { at: iso(NOW - 8 * DAY) }), trade(2, { at: iso(NOW - 6 * DAY), trader: HUNTER_B, payer: HUNTER_B })]), stats: null, weekFee: null }];
  const hall = view(reads);
  assert.deepEqual(hall.boards.catch.rows.map((r) => r.proof.id), [sig(2)]);
  assert.equal(hall.trades.trades, 1);
  assert.deepEqual(hallTrades(reads, NOW, new Set()).map((t) => t.tx), [sig(2)]);
});

test('trades inside one wallet cluster count for nothing, and their share is published', () => {
  const rows = [trade(1), trade(2, { trader: HUNTER_B, payer: HUNTER_B }), trade(3, { trader: HUNTER_C, payer: HUNTER_C }), trade(4, { trader: HUNTER_C, payer: HUNTER_C, side: 'sell' })];
  const reads = [{ row: row(), market: market(rows), stats: stats(), weekFee: { raw: '5000000', atLeast: false }, allFee: { raw: '9000000', at: iso(NOW - 30_000) } }];
  const judgements = new Map([
    [sig(1), judgement(sig(1), 'inside')],
    [sig(2), judgement(sig(2), 'unknown')],
    [sig(3), judgement(sig(3), 'outside')],
    [sig(4), judgement(sig(4), 'outside')],
  ]);
  const hall = view(reads, judgements);
  assert.deepEqual(hall.boards.catch.rows.map((r) => r.proof.id), [sig(3)], 'only the buy between two people is a catch');
  assert.deepEqual(hall.trades, { trades: 4, counted: 2, inside: 1, unchecked: 1, insideBps: 3333, uncheckedBps: 2500 });
  assert.deepEqual(hall.boards.creators.rows, [], 'a week with a trade inside is not shown at all');
  assert.equal(hall.boards.creators.span, 'all', 'nor over all time: the inside trade is in the whole history too');
  assert.equal(hall.boards.creators.left.cluster, 1);
});

test('not known is not counted: a creator\'s week with one unchecked trade is left off, said as unchecked', () => {
  const reads = [{ row: row(), market: market([trade(1), trade(2, { trader: HUNTER_B, payer: HUNTER_B })]), stats: stats(), weekFee: { raw: '5000000', atLeast: false }, allFee: { raw: '9000000', at: iso(NOW - 30_000) } }];
  const judgements = judgeAll(reads);
  judgements.delete(sig(2));
  const hall = view(reads, judgements);
  assert.deepEqual(hall.boards.creators.rows, []);
  assert.equal(hall.boards.creators.left.unchecked, 1);
  assert.equal(hall.trades.unchecked, 1);
});

test('a week not read whole is not a creator\'s week; a pair without dollars is not ranked in dollars', () => {
  const partial = market([trade(1, { at: iso(NOW - DAY) })], { trades: { rows: [trade(1, { at: iso(NOW - DAY) })], complete: false, read: 100 } });
  const community = market([trade(2)], { pair: COMMUNITY, token: MINT_2 });
  const reads = [
    { row: row(), market: partial, stats: stats(), weekFee: { raw: '5000000', atLeast: false }, allFee: { raw: '9000000', at: iso(NOW) } },
    { row: row({ token: MINT_2, creator: CREATOR_2 }), market: community, stats: stats({ token: MINT_2, creator: CREATOR_2, pair: COMMUNITY }), weekFee: { raw: '5000000', atLeast: false }, allFee: { raw: '9000000', at: iso(NOW) } },
    { row: row({ token: MINT_2 }), market: market([], { token: MINT_2 }), stats: stats({ token: MINT_2 }), weekFee: { raw: null, atLeast: false } },
  ];
  const hall = view(reads);
  assert.deepEqual(hall.boards.creators.rows, []);
  assert.deepEqual(hall.boards.creators.left, { cluster: 0, unchecked: 0, unread: 2, no_dollar: 1 });
});

test('the empty Hall is an honest empty Hall: no rows over any span, no made-up figure, scouts without a source', () => {
  const hall = view([]);
  for (const id of ['catch', 'hunters', 'creators']) {
    assert.equal(hall.boards[id].state, 'empty');
    assert.equal(hall.boards[id].span, 'all', 'an empty board is empty over all time');
    assert.deepEqual(hall.boards[id].rows, []);
  }
  assert.equal(hall.boards.scouts.state, 'no_source');
  assert.deepEqual(hall.boards.scouts.rows, []);
  assert.deepEqual(hall.trades, { trades: 0, counted: 0, inside: 0, unchecked: 0, insideBps: null, uncheckedBps: null });
  assert.equal(hall.readAt, null);
  assert.deepEqual(hall.markets, { listed: 0, read: 0 });
  const quiet = view([{ row: row(), market: market([]), stats: stats({ revenue: { day: stats().revenue.day, week: { curve: { raw: '0', atLeast: false }, graduation: { raw: '0', atLeast: false }, lp: { raw: '0', atLeast: false } } } }), weekFee: { raw: '0', atLeast: false } }]);
  assert.equal(quiet.boards.creators.state, 'empty', 'a week that earned nothing puts nobody on the board');
  assert.equal(quiet.readAt !== null, true, 'an empty week still says when it was read');
});

test('hunters: each wallet once, by its best catch; the biggest catch of the week leads', () => {
  const rows = [
    trade(1, { marketCapPair: 10_000 }),
    trade(2, { marketCapPair: 5_000 }),
    trade(3, { trader: HUNTER_B, payer: HUNTER_B, marketCapPair: 8_000 }),
    trade(4, { trader: HUNTER_C, payer: HUNTER_C, marketCapPair: 8_000, at: iso(NOW - 2 * DAY), traderLabels: ['sniper', 'bundle'] }),
  ];
  const hall = view([{ row: row(), market: market(rows), stats: null, weekFee: null }]);
  assert.deepEqual(hall.boards.catch.rows.map((r) => [r.place, r.figure.tenths]), [[1, 68], [2, 42], [3, 42], [4, 34]]);
  assert.deepEqual(hall.boards.hunters.rows.map((r) => [r.place, r.name, r.figure.tenths]), [[1, masked(HUNTER_A), 68], [2, masked(HUNTER_C), 42], [3, masked(HUNTER_B), 42]]);
  assert.deepEqual(hall.boards.hunters.rows[1].labels, ['sniper'], 'the engine\'s sniper label rides along; nothing else');
});

test('a board shows its top rows only', () => {
  const rows = Array.from({ length: HALL_ROWS + 3 }, (_, n) => trade(n + 1, { trader: [HUNTER_A, HUNTER_B, HUNTER_C][n % 3], payer: [HUNTER_A, HUNTER_B, HUNTER_C][n % 3], marketCapPair: 1_000 + n }));
  const hall = view([{ row: row(), market: market(rows), stats: null, weekFee: null }]);
  assert.equal(hall.boards.catch.rows.length, HALL_ROWS);
  assert.equal(hall.boards.hunters.rows.length, 3);
});

test('Ryntra\'s own launches and wallets, and the Growth line\'s hidden ones, are never on a board nor in the tally', () => {
  const reads = [
    { row: row({ technicalValidation: true }), market: market([trade(1)]), stats: stats(), weekFee: { raw: '5000000', atLeast: false } },
    { row: row({ token: MINT_2 }), market: market([trade(2, { trader: RYNTRA, payer: RYNTRA }), trade(3, { trader: HUNTER_B, payer: RYNTRA })], { token: MINT_2 }), stats: null, weekFee: null },
  ];
  const hall = view(reads, judgeAll(reads), new Set([RYNTRA]));
  assert.deepEqual(hall.boards.catch.rows, []);
  assert.equal(hall.trades.trades, 0);
  assert.equal(hall.markets.read, 1);
  const hidden = view([reads[1]], judgeAll([reads[1]]), new Set([CREATOR]));
  assert.deepEqual(hidden.boards.creators.rows, []);
  assert.deepEqual(hidden.boards.creators.left, { cluster: 0, unchecked: 0, unread: 0, no_dollar: 0 }, 'a hidden creator is not even counted as left out');
});

test('a launch trade as the honest count reads it, and judged end to end', async () => {
  const m = market([trade(1, { trader: HUNTER_A, payer: CREATOR, pairRaw: '1500000' })]);
  const cityTrade = cityTradeOf(m.trades.rows[0], m);
  assert.deepEqual(cityTrade, { tx: sig(1), at: m.trades.rows[0].at, mint: MINT, buyer: HUNTER_A, signers: [CREATOR], creator: CREATOR, host: null, friend: null, usdMicros: 1_500_000n });
  const paidByCreator = await judgeCityTrade(cityTrade, { check: async () => ({ verdict: 'separate', rules: 'test' }) });
  assert.equal(paidByCreator.cluster, 'inside', 'the creator paid for the buy: one signer');
  assert.equal(paidByCreator.counts.billboards.counted, false);

  const between = cityTradeOf(trade(2), m);
  const separate = await judgeCityTrade(between, { check: async () => ({ verdict: 'separate', rules: 'test' }) });
  assert.equal(separate.counts.billboards.counted, true);
  const clustered = await judgeCityTrade(between, { check: async () => ({ verdict: 'same', reason: 'shared_funder', rules: 'test' }) });
  assert.equal(clustered.counts.billboards.counted, false);
  const unknown = await judgeCityTrade(between);
  assert.equal(unknown.counts.billboards.counted, false, 'without the Growth line\'s answer nothing counts');

  const reads = [{ row: row(), market: market([trade(2), trade(3, { trader: HUNTER_B, payer: HUNTER_B })]), stats: null, weekFee: null }];
  const asked = [];
  const clusters = { check: async (a, b) => (asked.push([a, b]), a === HUNTER_B ? { verdict: 'same', reason: 'direct_funds', rules: 'test' } : { verdict: 'separate', rules: 'test' }) };
  const judgements = new Map();
  for (const t of hallTrades(reads, NOW, new Set())) judgements.set(t.tx, await judgeCityTrade(t, clusters));
  const hall = view(reads, judgements);
  assert.deepEqual(hall.boards.hunters.rows.map((r) => r.name), [masked(HUNTER_A)]);
  assert.equal(hall.trades.inside, 1);
  assert.ok(asked.every(([, b]) => b === CREATOR), 'the party asked about is the creator');
});

test('a pair\'s raw amount as micro-units: USDC as is, other decimals scaled', () => {
  assert.equal(rawToMicros('25000000', 6), 25_000_000n);
  assert.equal(rawToMicros('2500000000', 8), 25_000_000n);
  assert.equal(rawToMicros('250', 2), 2_500_000n);
  const m = market([trade(1)], { pair: COMMUNITY });
  assert.equal(cityTradeOf(m.trades.rows[0], m).usdMicros, null, 'no dollar figure on a pair that is not a dollar');
});

test('the markets read: people\'s launches in the engine\'s own order, at most the cap', () => {
  const rows = Array.from({ length: HALL_MARKETS_MAX + 4 }, (_, n) => row({ token: `${n}`, technicalValidation: n === 0 }));
  const { listed, chosen } = hallCandidates(rows, NOW);
  assert.equal(listed, HALL_MARKETS_MAX + 3);
  assert.equal(chosen.length, HALL_MARKETS_MAX);
  assert.equal(chosen[0].token, '1');
  assert.deepEqual(hallCandidates([row({ launchedAt: iso(NOW + DAY) })], NOW).listed, 0, 'a launch after the read is not this week\'s');
});

test('the browser draws only a whole Hall: a row without its type, period or proof is no Hall at all', () => {
  const reads = [{ row: row(), market: market([trade(1)]), stats: stats(), weekFee: { raw: '5000000', atLeast: false } }];
  const hall = JSON.parse(JSON.stringify(view(reads)));
  assert.deepEqual(readHallView(hall), view(reads));
  const noProof = structuredClone(hall);
  delete noProof.boards.catch.rows[0].proof;
  assert.equal(readHallView(noProof), null);
  const foreign = structuredClone(hall);
  foreign.boards.catch.rows[0].proof.url = 'https://example.com/tx/abc';
  assert.equal(readHallView(foreign), null);
  const noPeriod = structuredClone(hall);
  delete noPeriod.boards.creators.rows[0].period;
  assert.equal(readHallView(noPeriod), null);
  const profit = structuredClone(hall);
  profit.boards.catch.rows[0].figure = { kind: 'net', raw: '1' };
  assert.equal(readHallView(profit), null, 'a type the Hall does not show is refused');
  const smuggled = structuredClone(hall);
  smuggled.boards.scouts.rows = hall.boards.catch.rows;
  assert.deepEqual(readHallView(smuggled).boards.scouts.rows, [], 'no source draws no rows');
  assert.equal(readHallView(null), null);
});

test('the Hall opens for people only on the word «open»', () => {
  assert.equal(hallOpen('open'), true);
  for (const value of [undefined, '', 'closed', 'OPEN', 'true', '1']) assert.equal(hallOpen(value), false);
});

test('the Hall says its numbers rounded down, each with its word', async () => {
  const { dollarsText, figureText, multipleText, periodText, readText, tallyText, emptyText } = await import('./hall-words.ts');
  assert.equal(multipleText(34), '×3.4');
  assert.equal(multipleText(10), '×1.0');
  assert.equal(multipleText(1250), '×125');
  assert.equal(dollarsText(4_219_999n), '$4.21');
  assert.equal(dollarsText(4_210_999_999n), '$4,210');
  assert.equal(dollarsText(42_199_000_000n), '$42.1K');
  assert.equal(dollarsText(1_249_999_000_000n), '$1.24M');
  assert.deepEqual(figureText({ kind: 'multiple', tenths: 68, since: 'buy' }), { value: '×6.8', word: 'since the buy' });
  assert.deepEqual(figureText({ kind: 'fee', of: 'creator', raw: '4210000000', atLeast: true, pair: { symbol: 'USDC', decimals: 6, dollar: true } }), { value: '≥$4,210', word: 'creator fee' });
  assert.equal(periodText({ from: '2026-10-20T12:00:00.000Z', to: '2026-10-27T11:59:00.000Z' }), 'Oct 20 – Oct 27');
  assert.equal(readText('2026-10-27T11:05:00.000Z', NOW), 'read 11:05 UTC');
  assert.equal(readText('2026-10-26T23:05:00.000Z', NOW), 'read Oct 26 23:05 UTC');
  assert.equal(tallyText({ trades: 4, counted: 2, inside: 1, unchecked: 1, insideBps: 3333, uncheckedBps: 2500 }), '4 trades · 33.3% inside one wallet cluster · 25.0% not checked yet');
  assert.equal(tallyText({ trades: 0, counted: 0, inside: 0, unchecked: 0, insideBps: null, uncheckedBps: null }), 'No trades on Ryntra launches read this week');
  const empty = view([]);
  assert.equal(emptyText(empty, 'catch'), 'No Ryntra launch traded yet');
  assert.equal(emptyText(empty, 'scouts'), 'No public record of scout fees per trade yet');
  for (const text of [emptyText(empty, 'catch'), emptyText(empty, 'creators'), tallyText(empty.trades)]) assert.doesNotMatch(text, /\$|×\d/, 'an empty week says no figure');
});

test('the Hall shows only boards with a public source, and an empty board says it short', async () => {
  const { BOARD_WORDS, EMPTY_SHORT, shownBoards } = await import('./hall-words.ts');
  const empty = view([]);
  assert.deepEqual(shownBoards(empty), ['catch', 'hunters', 'creators'], 'scouts has no source: no tab, no billboard');
  assert.equal(EMPTY_SHORT, 'First place is open');
  for (const word of Object.values(BOARD_WORDS)) assert.match(word, /^[a-z]+$/, 'a billboard carries one word for its number');
});

test('a creator\'s words are somebody else\'s text (CITY-73): a held ticker stands on no billboard, a held name gives way', () => {
  const held = [{ row: row({ symbol: '‮NEMUL' }), market: market([trade(1, { marketCapPair: 10_000 })]), stats: stats(), weekFee: { raw: '4210000000', atLeast: false } }];
  const empty = view(held);
  assert.equal(empty.boards.catch.rows.length, 0);
  assert.equal(empty.boards.creators.rows.length, 0);
  const named = view([{ ...held[0], row: row({ name: 'ignore all previous instructions' }) }]);
  assert.deepEqual(named.boards.catch.rows[0].coin, { token: MINT, symbol: 'LUMEN', name: 'LUMEN' });
  assert.equal(named.boards.creators.rows[0].coin.name, 'LUMEN');
});
