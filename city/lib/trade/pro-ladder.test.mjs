// One slider and a ladder: the arithmetic of the panel in the coin's window.
import assert from 'node:assert/strict';
import test from 'node:test';

const { LADDER_SOL_ROOM_LAMPORTS, SLIDER_START_BPS, bpsAt, endsOf, orderProgress, positionOf, problemOf, quoteKey, rawOfText, reachText, spendable, textOfRaw } = await import('./pro-ladder.ts');

const MARKET = {
  network: 'devnet',
  pool: 'pool',
  coin: { mint: 'coin', decimals: 6 },
  quote: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
  price: 0.00000003,
  bonus: { feeBps: 100, ownerBps: 40, referralBps: 10 },
  reach: { buyBps: 9_900, sellBps: 990_000 },
  placing: true,
  collector: 'agent',
  cap: { maxRaw: '1000000000', minRungRaw: '2000000' },
};

test('the slider: a buy goes down a per cent a step to −80 %, a sale up by multiples to ×10 — and both stop where the pool stops', () => {
  const buy = endsOf('buy', MARKET);
  const sell = endsOf('sell', MARKET);
  assert.deepEqual([buy, sell], [{ min: 100, max: 8_000 }, { min: 500, max: 90_000 }]);
  assert.deepEqual([bpsAt(0, 'buy', buy), bpsAt(50, 'buy', buy), bpsAt(100, 'buy', buy)], [100, 4_100, 8_000]);
  assert.deepEqual([bpsAt(0, 'sell', sell), bpsAt(100, 'sell', sell)], [500, 90_000]);
  /* Every stop of a buy is a whole per cent; of a sale 5 % under twice the price and a quarter of the price over it. */
  for (let at = 0; at <= 100; at += 1) {
    assert.equal(bpsAt(at, 'buy', buy) % 100, 0);
    const up = bpsAt(at, 'sell', sell);
    assert.equal(up % (up < 10_000 ? 500 : 2_500), 0, String(up));
    if (at > 0) assert.ok(up >= bpsAt(at - 1, 'sell', sell) && bpsAt(at, 'buy', buy) >= bpsAt(at - 1, 'buy', buy), 'never back');
  }
  /* Out of range is held to the ends. */
  assert.deepEqual([bpsAt(-5, 'buy', buy), bpsAt(140, 'sell', sell)], [100, 90_000]);
  /* A pool with less room: the slider ends there; with none, there is no slider. */
  assert.deepEqual(endsOf('sell', { reach: { buyBps: 9_900, sellBps: 17_180 } }), { min: 500, max: 17_180 });
  assert.equal(bpsAt(100, 'sell', { min: 500, max: 17_180 }), 17_180);
  assert.equal(endsOf('sell', { reach: { buyBps: 9_900, sellBps: 0 } }), null);
  assert.equal(endsOf('buy', { reach: { buyBps: 50, sellBps: 990_000 } }), null);
});

test('a reach said in a sentence puts the slider where it reads the same', () => {
  const buy = endsOf('buy', MARKET);
  const sell = endsOf('sell', MARKET);
  for (const bps of [100, 500, 2_000, 5_000, 8_000]) assert.equal(bpsAt(positionOf(bps, 'buy', buy), 'buy', buy), bps);
  for (const bps of [500, 5_000, 10_000, 20_000, 40_000, 90_000]) assert.equal(bpsAt(positionOf(bps, 'sell', sell), 'sell', sell), bps);
  /* Farther than the slider goes: its end. */
  assert.equal(positionOf(9_500, 'buy', buy), 100);
  assert.equal(positionOf(400_000, 'sell', sell), 100);
  assert.equal(positionOf(1, 'buy', buy), 0);
  assert.ok(SLIDER_START_BPS.buy === 2_000 && SLIDER_START_BPS.sell === 10_000);
});

test('the reach reads as a person says it', () => {
  assert.equal(reachText(2_000, 'buy'), '−20%');
  assert.equal(reachText(100, 'buy'), '−1%');
  assert.equal(reachText(5_000, 'sell'), '+50%');
  assert.equal(reachText(10_000, 'sell'), '×2');
  assert.equal(reachText(15_000, 'sell'), '×2.5');
  assert.equal(reachText(90_000, 'sell'), '×10');
});

test('an amount typed is the coin\'s smallest units, cut and never rounded up; nothing else is an amount', () => {
  assert.equal(rawOfText('1', 9), 1_000_000_000n);
  assert.equal(rawOfText('0.5', 9), 500_000_000n);
  assert.equal(rawOfText('1.', 6), 1_000_000n);
  assert.equal(rawOfText('0.1234567', 6), 123_456n);
  assert.equal(rawOfText('0.0000009', 6), null, 'less than the smallest unit is nothing');
  for (const text of ['', '0', '0.0', '.5', '1,5', '1e3', '-1', 'abc', '1.2.3']) assert.equal(rawOfText(text, 6), null, text);
  assert.equal(textOfRaw(1_500_000n, 6), '1.5');
  assert.equal(textOfRaw(1_000_000_000n, 9), '1');
  assert.equal(textOfRaw(1n, 6), '0.000001');
  assert.equal(rawOfText(textOfRaw(123_456_789n, 9), 9), 123_456_789n);
});

test('what a ladder may rest: the coin for a sale; for a buy the quote coin, with SOL\'s room kept back', () => {
  const held = { sol: 500_000_000n, quote: 500_000_000n, coin: 7_000_000n };
  assert.equal(spendable('sell', MARKET, held, true), 7_000_000n);
  assert.equal(spendable('buy', MARKET, held, true), 500_000_000n - LADDER_SOL_ROOM_LAMPORTS);
  assert.equal(spendable('buy', MARKET, { ...held, quote: 10_000_000n }, true), 0n);
  assert.equal(spendable('buy', MARKET, { ...held, quote: 250_000_000n }, false), 250_000_000n, 'a USDC quote is spent whole');
  assert.equal(spendable('buy', MARKET, { ...held, quote: null }, true), null, 'unknown is not zero');
});

test('why a ladder cannot be placed is told before the Review', () => {
  const held = { sol: 2_000_000_000n, quote: 2_000_000_000n, coin: 5_000_000_000n };
  const base = { market: MARKET, action: 'buy', amountRaw: 500_000_000n, held, solQuote: true, agent: true, quote: null };
  assert.equal(problemOf(base), null);
  assert.equal(problemOf({ ...base, market: { ...MARKET, placing: false } }), 'paused');
  assert.equal(problemOf({ ...base, held: null }), 'connect');
  assert.equal(problemOf({ ...base, amountRaw: null }), 'amount');
  assert.equal(problemOf({ ...base, amountRaw: 1_990_000_000n }), 'balance', 'SOL\'s room is kept back');
  assert.equal(problemOf({ ...base, amountRaw: 1_500_000_000n }), 'cap', '1 SOL a ladder');
  assert.equal(problemOf({ ...base, market: { ...MARKET, cap: { maxRaw: null, minRungRaw: '0' } }, amountRaw: 1_500_000_000n }), null, 'no cap on test money');
  /* A sale's cap is counted in what it is paid, once the engine quoted it. */
  const sale = { ...base, action: 'sell', amountRaw: 1_000_000_000n, solQuote: false };
  assert.equal(problemOf(sale), null);
  assert.equal(problemOf({ ...sale, quote: { paysRaw: '1000000001', rungs: [{ amountRaw: '1', paysRaw: '1000000001' }] } }), 'cap');
  assert.equal(problemOf({ ...sale, amountRaw: 6_000_000_000n }), 'balance');
  /* Too little SOL for the order's rent, whatever is rested. */
  assert.equal(problemOf({ ...sale, held: { ...held, sol: 10_000_000n } }), 'sol');
  /* Prices smaller than the agent collects — only with the agent named. */
  const thin = { paysRaw: '10', rungs: [{ amountRaw: '1999999', paysRaw: '5' }, { amountRaw: '3000000', paysRaw: '5' }] };
  assert.equal(problemOf({ ...base, quote: thin }), 'small');
  assert.equal(problemOf({ ...base, agent: false, quote: thin }), null);
});

test('a quote is asked once for the same ladder; an order\'s row says how far along it is', () => {
  assert.equal(quoteKey('m', 'buy', 2_000, null, 5n), 'm:buy:2000:fit:5');
  assert.notEqual(quoteKey('m', 'buy', 2_000, 1, 5n), quoteKey('m', 'buy', 2_000, null, 5n));
  assert.deepEqual(orderProgress({ state: 'filling', prices: 25, filledPrices: 4 }), { filled: 4, of: 25, done: false });
  assert.deepEqual(orderProgress({ state: 'filled', prices: 3, filledPrices: 3 }), { filled: 3, of: 3, done: true });
  assert.deepEqual(orderProgress({ state: 'taken', prices: 0, filledPrices: 0 }), { filled: 0, of: 0, done: true });
});
