import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NO_CHOICE, backSol, choiceFor, counts, estimateSol, feeText, groupsOf, inClean, outcomeOf, reviewFresh, reviewedSol, riskMap, solFigure, toggled } from './clean-view.ts';
import { CLEAN } from './clean-words.ts';

const item = (over = {}) => ({
  account: `acc${Math.random().toString(36).slice(2, 10)}`,
  mint: 'mint',
  program: 'prog',
  kind: 'small',
  symbol: 'COIN',
  name: null,
  icon: null,
  amountRaw: '1',
  decimals: 6,
  valueUsd: 1,
  lamports: 2_000_000,
  risk: [],
  picked: true,
  ...over,
});

const read = (items, solUsd = 100) => ({ owner: 'o', items, risky: [], backLamports: 0, smallUsd: 0, solUsd, priced: true, canClean: true, at: '2026-11-16T00:00:00Z' });

test('the choice: a marked coin goes in only when switched on, any item comes out when switched off', () => {
  const marked = item({ picked: false, risk: ['unverified'] });
  const plain = item();
  assert.equal(inClean(marked, NO_CHOICE), false);
  const on = toggled(NO_CHOICE, marked, true);
  assert.equal(inClean(marked, on), true);
  const off = toggled(on, plain, false);
  assert.equal(inClean(plain, off), false);
  assert.equal(inClean(marked, toggled(off, marked, false)), false);
  assert.deepEqual(toggled(toggled(NO_CHOICE, plain, false), plain, true), NO_CHOICE);
});

test('a choice keeps only what still stands in the read', () => {
  const a = item();
  assert.deepEqual(choiceFor(read([a]), { add: ['gone'], drop: [a.account] }), { add: [], drop: [a.account] });
});

test('the estimate: rent of every account taken and the small coins at the price of SOL; nothing taken — null', () => {
  const small = item({ valueUsd: 2 });
  const empty = item({ kind: 'empty', valueUsd: 0 });
  const marked = item({ picked: false, risk: ['thin'], valueUsd: 4 });
  const r = read([small, empty, marked], 100);
  assert.equal(estimateSol(r, NO_CHOICE), 0.004 + 0.02);
  assert.deepEqual(counts(r, NO_CHOICE), { coins: 1, accounts: 1 });
  assert.equal(estimateSol(read([marked]), NO_CHOICE), null);
});

test('groups: coins into SOL with wrapped SOL, litter, empty accounts', () => {
  const g = groupsOf([item({ kind: 'wrapped' }), item(), item({ kind: 'litter' }), item({ kind: 'empty' })]);
  assert.deepEqual([g.small.length, g.litter.length, g.empty.length], [2, 1, 1]);
});

test('figures: SOL to four places under one, the fee in percent, the review older than its margin built again', () => {
  assert.equal(solFigure(0.0213456), '0.02135');
  assert.equal(solFigure(1.5), '1.50');
  assert.equal(feeText(10), '0.1 %');
  assert.equal(feeText(null), null);
  assert.equal(reviewedSol({ summary: { receiveLamports: '25000000' } }), 0.025);
  assert.equal(backSol(0), null);
  assert.equal(reviewFresh(100_000, 105_000), true);
  assert.equal(reviewFresh(100_000, 115_000), false);
  assert.equal(reviewFresh(0, 1), false);
});

test('the relay\'s answer: all landed, part, none', () => {
  const r = (...states) => ({ results: states.map((state) => ({ state })) });
  assert.equal(outcomeOf(r('LANDED', 'LANDED')), 'done');
  assert.equal(outcomeOf(r('LANDED', 'FAILED')), 'part');
  assert.equal(outcomeOf(r('NOT_SENT')), 'none');
  assert.deepEqual([...riskMap({ risky: [{ mint: 'm', risk: ['hook'] }] })], [['m', ['hook']]]);
});

test('every reason has words in both languages', () => {
  for (const reason of ['unverified', 'mint', 'freeze', 'delegate', 'thin', 'score', 'fee', 'hook']) {
    assert.ok(CLEAN.en.reason(reason));
    assert.ok(CLEAN.uk.reason(reason));
  }
});
