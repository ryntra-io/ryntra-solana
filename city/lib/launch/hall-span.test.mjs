import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HALL_MONTH_MS,
  HALL_SPANS,
  HALL_WINDOW_MS,
  hallAction,
  hallReachesBack,
  hallTrades,
  hallView,
  readHallView,
} from './hall.ts';

/*
 * CITY-230: a board whose week counts nobody reaches back over the last 30 days, then all time, and says which; a board
 * nobody is on even over all time is one action — launch your own. The honest count, the types, the periods and the
 * proofs of CITY-9 hold over every span: a trade inside one wallet cluster, a trade nobody checked and a trade the
 * engine never read stand on no board, however far back a board reaches.
 */

const NOW = Date.parse('2026-11-08T18:00:00.000Z');
const DAY = 24 * 60 * 60_000;
const iso = (ms) => new Date(ms).toISOString();

const CREATOR = '3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL';
const CREATOR_2 = '8dHEnBmCKcdwXz2mBSyW8D5DsFRYrsU9mJJrXeckMhPk';
const HUNTER_A = '6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp';
const HUNTER_B = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const HUNTER_C = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T';
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MINT_2 = 'So11111111111111111111111111111111111111112';
const CURVE = 'DBCxV6WXcLz5GtqGsc2k1Hk1b7kFLtVKRBdpWVPtbZTn';
const USDC = { mint: '9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB', symbol: 'USDC', decimals: 6, dollar: true };

const sig = (n) => `${'5'.repeat(84)}${'ABCDEFGHJK'[n % 10]}${'abcdefghij'[Math.floor(n / 10) % 10]}${'KLMNPQRSTU'[Math.floor(n / 100) % 10]}`;

const trade = (n, daysAgo, over = {}) => ({
  signature: sig(n),
  at: iso(NOW - daysAgo * DAY),
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
  launchedAt: iso(NOW - 90 * DAY),
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
  observedAt: iso(NOW - 30_000),
  ...over,
});

/** A market read with the engine's week figure and the chain's all-time figure of its creator. */
const read = (rows, { week = '0', all = '7300000', over = {} } = {}) => ({
  row: row(over.row),
  market: market(rows, over.market),
  stats: stats(over.stats),
  weekFee: { raw: week, atLeast: false },
  allFee: all === null ? null : { raw: all, at: iso(NOW - 30_000) },
});

const judgement = (tx, cluster) => ({
  tx,
  at: iso(NOW),
  cluster,
  inside: cluster === 'inside' ? { party: 'creator', why: 'shared_funder' } : null,
  counts: Object.fromEntries(['points', 'billboards', 'war', 'prestige', 'host_share'].map((use) => [use, cluster === 'outside' ? { counted: true } : { counted: false, reason: cluster === 'inside' ? 'cluster' : 'unverified' }])),
  rules: 'test',
});

/** Every trade read judged — between two people unless the test names it otherwise. */
const judgeAll = (reads, named = {}) => new Map(hallTrades(reads, NOW, new Set(), 'all').map((t) => [t.tx, judgement(t.tx, named[t.tx] ?? 'outside')]));

const view = (reads, judgements = judgeAll(reads), exclude = new Set()) => hallView({ network: 'solana:mainnet', reads, judgements, exclude, listed: reads.length, now: NOW });

const spans = (hall) => Object.fromEntries(['catch', 'hunters', 'creators'].map((id) => [id, [hall.boards[id].state, hall.boards[id].span]]));

test('a week that counts someone stays the week: every board on it, nothing reaches back', () => {
  const hall = view([read([trade(1, 1), trade(2, 12, { trader: HUNTER_B, payer: HUNTER_B, marketCapPair: 5_000 })], { week: '4210000' })]);
  assert.deepEqual(spans(hall), { catch: ['live', 'week'], hunters: ['live', 'week'], creators: ['live', 'week'] });
  assert.deepEqual(hall.boards.catch.rows.map((r) => r.proof.id), [sig(1)], 'the older, bigger catch waits for a quiet week');
  assert.deepEqual(hall.boards.catch.period, hall.window);
  assert.equal(hall.boards.creators.rows[0].figure.raw, '4210000', 'the engine\'s week, not the all-time counters');
  assert.equal(hallReachesBack(hall), false, 'nothing older is put to the honest count');
});

test('a quiet week reaches back over the last 30 days, said as the month, with its own period', () => {
  const hall = view([read([trade(1, 12), trade(2, 20, { trader: HUNTER_B, payer: HUNTER_B, marketCapPair: 5_000 }), trade(3, 45, { trader: HUNTER_C, payer: HUNTER_C, marketCapPair: 1_000 })])]);
  assert.deepEqual(hall.boards.catch.span, 'month');
  assert.deepEqual(hall.boards.catch.period, { from: iso(NOW - HALL_MONTH_MS), to: iso(NOW) });
  assert.deepEqual(hall.boards.catch.rows.map((r) => [r.proof.id, r.figure.tenths]), [[sig(2), 68], [sig(1), 34]], 'the ×34 from 45 days ago is not this month\'s');
  assert.deepEqual(hall.boards.hunters.rows.map((r) => r.figure.tenths), [68, 34]);
  assert.equal(hall.boards.hunters.span, 'month');
  for (const r of hall.boards.catch.rows) {
    assert.equal(r.figure.kind, 'multiple', 'the type holds');
    assert.equal(r.proof.kind, 'tx');
    assert.equal(r.period.from, r.proof.id === sig(2) ? iso(NOW - 20 * DAY) : iso(NOW - 12 * DAY), 'each row keeps its own period: its buy to the read');
  }
  assert.equal(hallReachesBack(hall), true);
});

test('a quiet month reaches back over all time, from the oldest launch read', () => {
  const hall = view([read([trade(1, 45), trade(2, 60, { trader: HUNTER_B, payer: HUNTER_B, marketCapPair: 20_000 })])]);
  assert.deepEqual(spans(hall), { catch: ['live', 'all'], hunters: ['live', 'all'], creators: ['live', 'all'] });
  assert.deepEqual(hall.boards.catch.period, { from: iso(NOW - 90 * DAY), to: iso(NOW) });
  assert.deepEqual(hall.boards.catch.rows.map((r) => r.proof.id), [sig(1), sig(2)]);
});

test('nobody even over all time: the board is empty, and its one action is to launch your own', () => {
  const quiet = view([read([trade(1, 3, { marketCapPair: 33_000 })], { all: '0' })]);
  assert.deepEqual(spans(quiet), { catch: ['empty', 'all'], hunters: ['empty', 'all'], creators: ['empty', 'all'] }, '×1.03 is no catch; a fee of nothing puts nobody up');
  for (const id of ['catch', 'hunters', 'creators']) {
    assert.deepEqual(quiet.boards[id].rows, []);
    assert.equal(hallAction(quiet.boards[id], true), 'launch', 'an empty board opens a launch from the city');
    assert.equal(hallAction(quiet.boards[id], false), 'panel', 'where no launch opens here, the panel says it short');
  }
  const live = view([read([trade(1, 1)])]);
  assert.equal(hallAction(live.boards.catch, true), 'panel', 'a board with someone on it opens its table');
});

test('every step in turn: week → month → all time → the action', () => {
  const at = (daysAgo) => view([read(daysAgo === null ? [] : [trade(1, daysAgo)], { all: null })]).boards.catch;
  assert.deepEqual([at(2), at(15), at(40), at(null)].map((board) => [board.state, board.span]), [
    ['live', 'week'],
    ['live', 'month'],
    ['live', 'all'],
    ['empty', 'all'],
  ]);
  assert.deepEqual(HALL_SPANS, ['week', 'month', 'all']);
  assert.equal(HALL_MONTH_MS, 30 * DAY);
  assert.equal(HALL_WINDOW_MS, 7 * DAY);
});

test('creators reach from the engine\'s week straight to all time on the chain\'s counters — the engine has no 30 days', () => {
  const hall = view([read([trade(1, 12)], { week: '0', all: '7300000' })]);
  const board = hall.boards.creators;
  assert.equal(board.span, 'all');
  assert.equal(board.rows[0].figure.kind, 'fee');
  assert.equal(board.rows[0].figure.raw, '7300000', 'the all-time figure as the chain counts it, never the city adding up');
  assert.equal(board.rows[0].figure.atLeast, false);
  assert.deepEqual(board.rows[0].period, { from: iso(NOW - 90 * DAY), to: iso(NOW - 30_000) }, 'from the launch to the read');
  assert.deepEqual(board.rows[0].proof, { kind: 'account', id: CURVE, url: `https://solscan.io/account/${CURVE}` });
  for (const reads of [[read([trade(1, 12)])], [read([trade(1, 2)])]]) assert.notEqual(view(reads).boards.creators.span, 'month');
  const unread = view([read([trade(1, 12)], { all: null })]).boards.creators;
  assert.deepEqual([unread.state, unread.left.unread], ['empty', 1], 'a figure not read is said as not read, never as zero');
});

test('a trade inside one wallet cluster stands on no board, however far back a board reaches', () => {
  const reads = [read([trade(1, 12, { marketCapPair: 2_000 }), trade(2, 45, { trader: HUNTER_B, payer: HUNTER_B, marketCapPair: 1_000 })])];
  const hall = view(reads, judgeAll(reads, { [sig(1)]: 'inside', [sig(2)]: 'inside' }));
  assert.deepEqual(spans(hall), { catch: ['empty', 'all'], hunters: ['empty', 'all'], creators: ['empty', 'all'] });
  assert.equal(hall.boards.creators.left.cluster, 1, 'the creator\'s whole history rests on a trade inside: left out, said so');
  assert.deepEqual(hall.tallies.all, { trades: 2, counted: 0, inside: 2, unchecked: 0, insideBps: 10_000, uncheckedBps: 0 }, 'the share left out is published for the span');
  assert.deepEqual(hall.tallies.month, { trades: 1, counted: 0, inside: 1, unchecked: 0, insideBps: 10_000, uncheckedBps: 0 });
  assert.equal(hall.trades.trades, 0, 'the week saw no trade');
  /* One inside buy among people's buys: only the people's buy reaches the month's board. */
  const mixed = [read([trade(1, 12, { marketCapPair: 2_000 }), trade(2, 14, { trader: HUNTER_B, payer: HUNTER_B, marketCapPair: 8_000 })])];
  const shown = view(mixed, judgeAll(mixed, { [sig(1)]: 'inside' }));
  assert.deepEqual(shown.boards.catch.rows.map((r) => r.proof.id), [sig(2)]);
  assert.equal(shown.boards.creators.state, 'empty', 'the creator\'s all time has the inside trade in it');
});

test('not known is not counted over any span: an older trade not checked stands on no board', () => {
  const reads = [read([trade(1, 12, { marketCapPair: 2_000 }), trade(2, 40, { trader: HUNTER_B, payer: HUNTER_B, marketCapPair: 2_000 })])];
  const judgements = judgeAll(reads, { [sig(1)]: 'unknown' });
  judgements.delete(sig(2));
  const hall = view(reads, judgements);
  assert.deepEqual(spans(hall), { catch: ['empty', 'all'], hunters: ['empty', 'all'], creators: ['empty', 'all'] });
  assert.equal(hall.boards.creators.left.unchecked, 1);
  assert.deepEqual(hall.tallies.all, { trades: 2, counted: 0, inside: 0, unchecked: 2, insideBps: null, uncheckedBps: 10_000 });
});

test('a made-up trade never reaches a board: only the engine\'s reads, judged, before the read', () => {
  const reads = [read([trade(1, 12, { marketCapPair: 2_000 })])];
  /* A judgement for a trade no read carries counts nothing; a trade dated after the read is no trade of any span. */
  const judgements = judgeAll(reads);
  judgements.set(sig(99), judgement(sig(99), 'outside'));
  const hall = view(reads, judgements);
  assert.deepEqual(hall.boards.catch.rows.map((r) => r.proof.id), [sig(1)]);
  const future = [read([trade(5, -2, { marketCapPair: 2_000 })])];
  const later = view(future, judgeAll(future));
  assert.deepEqual(later.boards.catch.rows, []);
  assert.equal(later.tallies.all.trades, 0);
  /* Ryntra's own wallets and the hidden ones stay off every span. */
  const own = view(reads, judgeAll(reads), new Set([HUNTER_A]));
  assert.deepEqual(own.boards.catch.rows, []);
  /* A creator whose history was not read whole is not an all-time creator. */
  const partial = [read([trade(1, 12)], { over: { market: { trades: { rows: [trade(1, 12)], complete: false, read: 100 } } } })];
  assert.deepEqual([view(partial).boards.creators.state, view(partial).boards.creators.left.unread], ['empty', 1]);
  /* A held ticker stands on no board of any span (CITY-73). */
  const held = [read([trade(1, 40, { marketCapPair: 2_000 })], { over: { row: { symbol: '‮NEMUL' } } })];
  assert.deepEqual(spans(view(held)), { catch: ['empty', 'all'], hunters: ['empty', 'all'], creators: ['empty', 'all'] });
});

test('the honest count is asked about the week first, then the older trades the newest first, each once', () => {
  const reads = [
    read([trade(1, 1), trade(2, 12), trade(3, 45)]),
    { ...read([trade(4, 3), trade(5, 20)], { over: { row: { token: MINT_2, creator: CREATOR_2 }, market: { token: MINT_2, creator: { address: CREATOR_2, curves: 1, tradesComplete: true } }, stats: { token: MINT_2, creator: CREATOR_2 } } }) },
  ];
  assert.deepEqual(hallTrades(reads, NOW, new Set()).map((t) => t.tx), [sig(1), sig(4)], 'the week alone by default');
  assert.deepEqual(hallTrades(reads, NOW, new Set(), 'all').map((t) => t.tx), [sig(1), sig(4), sig(2), sig(5), sig(3)]);
  assert.deepEqual(hallTrades(reads, NOW, new Set(), 'month').map((t) => t.tx), [sig(1), sig(4), sig(2), sig(5)]);
  assert.deepEqual(hallTrades(reads, NOW, new Set([HUNTER_A]), 'all'), [], 'a wallet left out is never even asked about');
});

test('the browser reads the span and the period of every board, and refuses a span the Hall does not know', () => {
  const hall = JSON.parse(JSON.stringify(view([read([trade(1, 12)])])));
  const back = readHallView(hall);
  assert.deepEqual(back, view([read([trade(1, 12)])]));
  assert.equal(back.boards.catch.span, 'month');
  const unknown = structuredClone(hall);
  unknown.boards.catch.span = 'year';
  assert.equal(readHallView(unknown), null);
  const noPeriod = structuredClone(hall);
  noPeriod.boards.catch.period = { from: 'soon' };
  assert.equal(readHallView(noPeriod), null);
  const badTally = structuredClone(hall);
  badTally.tallies.month.trades = -1;
  assert.equal(readHallView(badTally), null);
  /* An answer from before CITY-230 — no span, no period, no tallies — reads as the week it was. */
  const before = structuredClone(hall);
  delete before.tallies;
  for (const board of Object.values(before.boards)) {
    delete board.span;
    delete board.period;
  }
  const old = readHallView(before);
  assert.equal(old.boards.catch.span, 'week');
  assert.deepEqual(old.boards.catch.period, hall.window);
  assert.deepEqual(old.tallies.all, hall.trades);
});

test('the sign and the panel say the span and the action in the language on screen', async () => {
  const { useLangStore } = await import('../i18n/lang.ts');
  const { boardKind, emptyShort, emptyText, launchYours, spanText, tallyText } = await import('./hall-words.ts');
  const empty = view([]);
  useLangStore.setState({ lang: 'en' });
  assert.deepEqual(HALL_SPANS.map(spanText), ['This week', 'This month', 'All time']);
  assert.equal(launchYours(), 'Launch yours');
  assert.equal(emptyShort(), 'First place is open');
  assert.equal(boardKind('creators', 'all'), 'Creator fee · all time · before costs');
  assert.equal(boardKind('creators', 'week'), 'Creator fee · 7 days · before costs');
  assert.equal(tallyText(empty.tallies.all, 'all'), 'No trades on Ryntra launches read yet');
  assert.equal(tallyText(empty.tallies.month, 'month'), 'No trades on Ryntra launches read in 30 days');
  useLangStore.setState({ lang: 'uk' });
  try {
    assert.deepEqual(HALL_SPANS.map(spanText), ['Цього тижня', 'Цього місяця', 'За весь час']);
    assert.equal(launchYours(), 'Запусти свою');
    assert.equal(emptyShort(), 'Перше місце вільне');
    assert.equal(boardKind('creators', 'all'), 'Комісія творця · за весь час · до витрат');
    assert.equal(emptyText(empty, 'catch'), 'Жоден лаунч Ryntra ще не торгувався');
    for (const text of [emptyText(empty, 'catch'), emptyText(empty, 'creators'), tallyText(empty.tallies.all, 'all')]) assert.doesNotMatch(text, /\$|×\d/, 'an empty Hall says no figure');
  } finally {
    useLangStore.setState({ lang: 'en' });
  }
});

test('the development stand-in plays each step, and never puts its cluster or unchecked trade on a board', async () => {
  const { STUB_HALLS, stubHall } = await import('./hall-stub.ts');
  assert.deepEqual(STUB_HALLS, ['stub', 'month', 'all', 'empty']);
  const expect = {
    stub: { catch: ['live', 'week'], hunters: ['live', 'week'], creators: ['live', 'week'] },
    month: { catch: ['live', 'month'], hunters: ['live', 'month'], creators: ['live', 'all'] },
    all: { catch: ['live', 'all'], hunters: ['live', 'all'], creators: ['live', 'all'] },
    empty: { catch: ['empty', 'all'], hunters: ['empty', 'all'], creators: ['empty', 'all'] },
  };
  for (const kind of STUB_HALLS) {
    const hall = stubHall(NOW, kind);
    assert.deepEqual(spans(hall), expect[kind], kind);
    const symbols = hall.boards.creators.rows.map((r) => r.coin.symbol);
    assert.ok(!symbols.includes('ECHO') && !symbols.includes('NOVA'), `${kind}: a creator resting on a trade inside or unchecked stays off`);
    assert.ok(hall.boards.catch.rows.every((r) => r.coin.symbol !== 'ECHO' || r.figure.tenths < 200), `${kind}: ECHO's first buy, inside the cluster, is no catch`);
  }
});

test('review 8.11: an empty board offers a launch only when its emptiness was read whole', () => {
  const empty = { rows: [], left: { cluster: 0, unchecked: 0, unread: 0, no_dollar: 0 } };
  assert.equal(hallAction(empty, true), 'launch');
  assert.equal(hallAction({ ...empty, left: { ...empty.left, unchecked: 3 } }, true), 'panel', 'trades not yet checked: not «nobody»');
  assert.equal(hallAction({ ...empty, left: { ...empty.left, unread: 1 } }, true), 'panel', 'a coin not read whole: not «nobody»');
  assert.equal(hallAction({ ...empty, left: { ...empty.left, cluster: 2 } }, true), 'launch', 'trades left out by the cluster rule are counted out honestly');
});
