// «buy cheaper», «sell higher» on the agent's word: one sentence read into a ladder for the coin's window.
import assert from 'node:assert/strict';
import test from 'node:test';

const { readLadderAsk } = await import('./pro-read.ts');
const { parse } = await import('../command/parse.ts');

const coin = (symbol, mint) => ({ mint, symbol, name: symbol, icon: null, tower: true });
const BONK = coin('BONK', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
const JUP = coin('JUP', 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN');
const WIF = coin('WIF', 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm');
const BOOK = { coins: [BONK, JUP, WIF] };
const read = (text, subject = null) => readLadderAsk(text, BOOK, { subject });
const told = (ask) => (ask === null ? null : { action: ask.action, coin: ask.coin.symbol, farBps: ask.farBps, rungs: ask.rungs, amount: ask.amount, pay: ask.pay, share: ask.share });

test('«buy cheaper»: the coin, how far, and what is paid — English and Ukrainian', () => {
  assert.deepEqual(told(read('buy BONK 20% cheaper for 1 SOL')), { action: 'buy', coin: 'BONK', farBps: 2_000, rungs: null, amount: '1', pay: 'SOL', share: null });
  assert.deepEqual(told(read('купи BONK дешевше на 20 % за 1 SOL')), { action: 'buy', coin: 'BONK', farBps: 2_000, rungs: null, amount: '1', pay: 'SOL', share: null });
  assert.deepEqual(told(read('buy JUP cheaper by 15% for $50')), { action: 'buy', coin: 'JUP', farBps: 1_500, rungs: null, amount: '50', pay: 'USDC', share: null });
  assert.deepEqual(told(read('купуй WIF дешевше на 0,5 sol')), { action: 'buy', coin: 'WIF', farBps: null, rungs: null, amount: '0.5', pay: 'SOL', share: null });
  assert.deepEqual(told(read('купи дешевле BONK')), { action: 'buy', coin: 'BONK', farBps: null, rungs: null, amount: null, pay: null, share: null });
  /* The coin in front of the person stands for «it». */
  assert.deepEqual(told(read('buy cheaper by 10%', JUP)), { action: 'buy', coin: 'JUP', farBps: 1_000, rungs: null, amount: null, pay: null, share: null });
});

test('«sell higher»: a ladder up from the price; «at 2x» on its own is one price', () => {
  assert.deepEqual(told(read('sell half my BONK higher')), { action: 'sell', coin: 'BONK', farBps: null, rungs: null, amount: null, pay: null, share: 50 });
  assert.deepEqual(told(read('продай половину BONK дорожче на 50 %')), { action: 'sell', coin: 'BONK', farBps: 5_000, rungs: null, amount: null, pay: null, share: 50 });
  assert.deepEqual(told(read('продай половину BONK на 2x')), { action: 'sell', coin: 'BONK', farBps: 10_000, rungs: 1, amount: null, pay: null, share: 50 });
  assert.deepEqual(told(read('sell all JUP at 3x')), { action: 'sell', coin: 'JUP', farBps: 20_000, rungs: 1, amount: null, pay: null, share: 100 });
  assert.deepEqual(told(read('sell 1000 WIF at 1.5x')), { action: 'sell', coin: 'WIF', farBps: 5_000, rungs: 1, amount: '1000', pay: null, share: null });
  /* Cyrillic «х» and a leading «x» are the same multiple. */
  assert.deepEqual(told(read('продай все BONK по 2х')), { action: 'sell', coin: 'BONK', farBps: 10_000, rungs: 1, amount: null, pay: null, share: 100 });
  assert.deepEqual(told(read('sell half BONK x2')), { action: 'sell', coin: 'BONK', farBps: 10_000, rungs: 1, amount: null, pay: null, share: 50 });
  /* With «higher», «up to» or «ladder» the multiple is where the ladder ends. */
  assert.deepEqual(told(read('sell half BONK higher up to 3x')), { action: 'sell', coin: 'BONK', farBps: 20_000, rungs: null, amount: null, pay: null, share: 50 });
  assert.deepEqual(told(read('продай чверть WIF драбиною до 5x')), { action: 'sell', coin: 'WIF', farBps: 40_000, rungs: null, amount: null, pay: null, share: 25 });
});

test('the person\'s own per cent is not the ladder\'s: «sell 30% of BONK 50% higher»', () => {
  assert.deepEqual(told(read('sell 30% BONK higher by 50%')), { action: 'sell', coin: 'BONK', farBps: 5_000, rungs: null, amount: null, pay: null, share: 30 });
  assert.deepEqual(told(read('sell 30% BONK 50% higher')), { action: 'sell', coin: 'BONK', farBps: 5_000, rungs: null, amount: null, pay: null, share: 30 });
});

test('what is not a ladder is not read as one — and is left to the line as it was', () => {
  for (const text of [
    'buy BONK for 1 SOL',
    'sell half BONK',
    'buy BONK higher',
    'sell BONK cheaper',
    'buy BONK at 2x',
    'is BONK cheaper today?',
    'why is JUP higher',
    "don't buy BONK cheaper",
    'не купуй BONK дешевше',
    'buy BONK cheaper and higher',
    'sell BONK at 2x or 3x',
    'sell BONK at 1x',
    'sell BONK at 0.5x',
    'sell BONK at 500x',
    'buy BONK 100% cheaper',
    'buy BONK 99.5% cheaper',
    'sell BONK 50% higher at 2x',
    'cheaper',
    'buy NOSUCH cheaper',
    'buy SOL cheaper',
    '',
  ]) {
    assert.equal(read(text), null, text);
  }
  /* The line's own reading of a plain order is untouched by the reader's existence. */
  assert.equal(parse('buy BONK for 1 SOL', BOOK).kind, 'buy');
});

test('a word is never guessed into money: an amount the line cannot take is left out, the ladder still read', () => {
  /* «1,000» could be a thousand or one: the window asks. */
  assert.deepEqual(told(read('sell 1,000 BONK higher by 20%')), { action: 'sell', coin: 'BONK', farBps: 2_000, rungs: null, amount: null, pay: null, share: null });
  /* A count of the coin bought cannot stand in «You pay». */
  assert.deepEqual(told(read('buy 100 JUP cheaper by 5%')), { action: 'buy', coin: 'JUP', farBps: 500, rungs: null, amount: null, pay: null, share: null });
});
