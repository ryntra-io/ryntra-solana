import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NO_CHOICE, backSol, choiceFor, counts, estimateSol, feeText, groupsOf, inClean, outcomeOf, reviewFresh, reviewedSol, riskMap, solFigure, toggled, unwrapOf } from './clean-view.ts';
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

test('wrapped SOL: off until the person picks it, then said apart — «unwraps … wSOL into SOL» — never in what comes back', () => {
  const whale = item({ kind: 'wrapped', symbol: 'wSOL', amountRaw: '86260508921310', decimals: 9, valueUsd: null, lamports: 1_488_443, picked: false });
  const emptyWrapped = item({ kind: 'wrapped', symbol: 'wSOL', amountRaw: '0', decimals: 9, valueUsd: null, lamports: 2_039_280, picked: true });
  const r = read([whale, emptyWrapped]);
  assert.equal(unwrapOf(r, NO_CHOICE), null, 'nothing is unwrapped unless the person picks it');
  assert.equal(estimateSol(r, NO_CHOICE), 0.00203928, 'an empty wrapped account gives its rent');
  const on = toggled(NO_CHOICE, whale, true);
  assert.deepEqual(unwrapOf(r, on), { sol: 86_260.50892131, now: true });
  assert.equal(estimateSol(r, on), 0.00203928 + 0.001488443, 'what comes back is the rent alone: the wrapped SOL is the person’s already');
  assert.equal(CLEAN.uk.unwrap('86 260,51'), 'Розгорне 86 260,51 wSOL у SOL');
  assert.equal(CLEAN.en.unwrap('86,260.51'), 'Unwraps 86,260.51 wSOL into SOL');
});

test('wrapped SOL beside a coin to swap waits for the next clean, as the engine plans it — never promised for this one', () => {
  const whale = item({ kind: 'wrapped', symbol: 'wSOL', amountRaw: '86260508921310', decimals: 9, valueUsd: null, lamports: 1_488_443, picked: false });
  const small = item({ valueUsd: 2, lamports: 2_000_000 });
  const crumb = item({ valueUsd: 0.004, lamports: 2_000_000 });
  const on = toggled(NO_CHOICE, whale, true);
  assert.deepEqual(unwrapOf(read([whale, small]), on), { sol: 86_260.50892131, now: false });
  assert.equal(estimateSol(read([whale, small], 100), on), 0.002 + 0.02, 'its rent does not come with this clean');
  assert.deepEqual(unwrapOf(read([whale, crumb]), on), { sol: 86_260.50892131, now: true }, 'a crumb under a cent is burnt, not swapped: the unwrap goes now');
  assert.deepEqual(unwrapOf(read([whale, small]), toggled(on, small, false)), { sol: 86_260.50892131, now: true }, 'the swap taken out — the unwrap goes now');
  assert.equal(CLEAN.uk.unwrapNext('86 260,51'), '86 260,51 wSOL розгорнеться наступним очищенням');
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
