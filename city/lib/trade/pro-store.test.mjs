// The panel's store: one slider and one amount ask the engine for a ladder; the button is a Review, the
// wallet's one approval and the relay — and nothing reaches the wallet any other way.
import assert from 'node:assert/strict';
import test from 'node:test';

/* The window's switch names mainnet: the wallet's balances are read as the city knows them. */
process.env.NEXT_PUBLIC_RYNTRA_CITY_PRO_LIMITS = 'mainnet';

const { LADDER_NETWORK, LADDER_OPEN, askLadder, choiceOf, heldOf, setLadderEnv, takeLadderAsk, useLadder } = await import('./pro-store.ts');
const { useWallet } = await import('./wallet.ts');

const SOL = 'So11111111111111111111111111111111111111112';
const COIN = { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', icon: null, tower: true };
const OWNER = '4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW';
const MARKET = {
  network: 'mainnet',
  pool: 'FhUzUF3h14y39nD2vdVkyREijM4kWj5nemFU3njwb8cQ',
  coin: { mint: COIN.mint, decimals: 5 },
  quote: { mint: SOL, symbol: 'SOL', decimals: 9 },
  price: 0.0000001,
  bonus: { feeBps: 100, ownerBps: 40, referralBps: 10 },
  reach: { buyBps: 9_900, sellBps: 990_000 },
  placing: true,
  collector: 'E1w1XFq33ft6rGz19qTSzKKNuFvChbrUCZuY47adMfLV',
  cap: { maxRaw: '1000000000', minRungRaw: '2000000' },
};
const HOLDINGS = { owner: OWNER, sol: { spendableRaw: '2400000000', decimals: 9 }, tokens: new Map([[COIN.mint, { spendableRaw: '800000000', decimals: 5 }]]), complete: true, at: Date.now() };
const quoteOf = (intent) => ({
  market: MARKET,
  action: intent.action,
  restsIn: intent.action === 'buy' ? SOL : COIN.mint,
  paysIn: intent.action === 'buy' ? COIN.mint : SOL,
  rungs: Array.from({ length: intent.rungs ?? 25 }, (_, at) => ({ awayBps: 100 * (at + 1), price: 0.0000001, amountRaw: String(BigInt(intent.amountRaw) / BigInt(intent.rungs ?? 25)), paysRaw: '4000000' })),
  amountRaw: intent.amountRaw,
  paysRaw: '100000000',
  averagePrice: 0.00000009,
  nearBps: 100,
  farBps: intent.farBps,
  corridorBps: 100,
  bonus: { feeBps: 100, ownerBps: 40, referralBps: 10, referral: 'referral', feeIn: SOL },
});

/** A stand: the engine a spy that answers as the engine does, the wallet a spy that signs or declines. */
function stand(overrides = {}) {
  const calls = [];
  const engine = {
    market: async (mint) => (calls.push(['market', mint]), { ok: true, value: mint === COIN.mint ? MARKET : null }),
    quote: async (mint, intent) => (calls.push(['quote', intent]), { ok: true, value: quoteOf(intent) }),
    review: async (ask) => (calls.push(['review', ask]), { ok: true, value: { action: ask.action, network: 'mainnet', transactions: ['unsigned-1', 'unsigned-2'], ticket: 'ticket', expiresAt: Date.now() + 25_000, nftMint: ask.nftMint ?? 'order', networkFeeLamports: '15000', rentLamports: '29000000', accountsLamports: '0', quote: ask.action === 'place' ? quoteOf(ask.intent) : null, agent: ask.agent === true, receives: null, referral: null } }),
    submit: async (ticket, signed) => (calls.push(['submit', ticket, signed]), { ok: true, value: { action: 'place', nftMint: 'order', results: [{ signature: 'sig-1', state: 'LANDED' }, { signature: 'sig-2', state: 'LANDED' }], settled: true } }),
    orders: async (owner, mint) => (calls.push(['orders', owner, mint]), { ok: true, value: [] }),
    ...overrides.engine,
  };
  setLadderEnv({ engine, sign: overrides.sign ?? (async (unsigned) => (calls.push(['sign', unsigned]), unsigned.map((wire) => `signed:${wire}`))), refreshHoldings: () => calls.push(['refresh']), quoteDelayMs: 0 });
  useWallet.setState({ connection: overrides.connection === undefined ? { wallet: 'Phantom', address: OWNER } : overrides.connection, holdings: overrides.holdings === undefined ? HOLDINGS : overrides.holdings });
  useLadder.setState({ mint: null, market: { status: 'none', value: null, code: null }, phase: 'idle', failure: null, placed: null, acting: null, typed: '', share: null, rungs: null, farBps: null, shown: false, agent: true, quote: { status: 'none', value: null, code: null, key: null }, orders: { status: 'none', value: null, code: null } });
  return calls;
}
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const names = (calls) => calls.map((call) => call[0]);

test('the window\'s switch names the network the panel is drawn for', () => {
  assert.equal(LADDER_NETWORK, 'mainnet');
  assert.equal(LADDER_OPEN, true);
});

test('opening on a coin asks its market once; one slider and one amount ask for the ladder once they rest', async () => {
  const calls = stand();
  useLadder.getState().open(COIN);
  await settle();
  let state = useLadder.getState();
  assert.deepEqual([state.market.status, state.action, state.farBps, state.shown], ['ready', 'buy', 2_000, false]);
  assert.deepEqual(names(calls), ['market', 'orders'], 'no amount yet: no quote');
  state.setTyped('0.5');
  await settle();
  state = useLadder.getState();
  assert.equal(state.quote.status, 'ready');
  assert.deepEqual(calls.at(-1), ['quote', { action: 'buy', farBps: 2_000, amountRaw: '500000000' }]);
  /* The same ladder is not asked for twice; a moved slider asks again. */
  const before = calls.length;
  state.setTyped('0.5');
  await settle();
  assert.equal(calls.length, before);
  state.setReach(100);
  await settle();
  assert.deepEqual(calls.at(-1), ['quote', { action: 'buy', farBps: 8_000, amountRaw: '500000000' }]);
  /* Opening the same coin again keeps what is on screen. */
  useLadder.getState().open(COIN);
  await settle();
  assert.equal(names(calls).filter((name) => name === 'market').length, 1);
  /* A coin with no pool: the panel has nothing to draw, and says nothing. */
  useLadder.getState().open({ mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP' });
  await settle();
  assert.deepEqual([useLadder.getState().market.status, useLadder.getState().market.value], ['ready', null]);
});

test('the button is a Review, the wallet\'s one approval and the relay — in that order, with the bytes the Review gave', async () => {
  const calls = stand();
  useLadder.getState().open(COIN);
  await settle();
  useLadder.getState().setTyped('0.5');
  await settle();
  calls.length = 0;
  await useLadder.getState().place();
  await settle();
  assert.deepEqual(names(calls), ['review', 'sign', 'submit', 'refresh', 'orders']);
  assert.deepEqual(calls[0][1], { action: 'place', owner: OWNER, mint: COIN.mint, intent: { action: 'buy', farBps: 2_000, amountRaw: '500000000' }, agent: true });
  assert.deepEqual(calls[1][1], ['unsigned-1', 'unsigned-2'], 'one approval of everything the Review built');
  assert.deepEqual(calls[2].slice(1), ['ticket', ['signed:unsigned-1', 'signed:unsigned-2']]);
  const state = useLadder.getState();
  assert.deepEqual([state.phase, state.failure, state.placed.nftMint, state.placed.signature, state.typed], ['done', null, 'order', 'sig-1', '']);
  assert.deepEqual([state.placed.whole, state.placed.agent], [true, true]);
});

test('placing without the agent asks the Review without it', async () => {
  const calls = stand();
  useLadder.getState().open(COIN);
  await settle();
  useLadder.getState().setAgent(false);
  useLadder.getState().setTyped('0.5');
  await settle();
  await useLadder.getState().place();
  assert.equal(calls.find((call) => call[0] === 'review')[1].agent, false);
});

test('a wallet that declines, an engine that refuses, a relay that does not confirm: said as it is, and nothing further is asked', async () => {
  const ready = async (overrides) => {
    const calls = stand(overrides);
    useLadder.getState().open(COIN);
    await settle();
    useLadder.getState().setTyped('0.5');
    await settle();
    calls.length = 0;
    await useLadder.getState().place();
    await settle();
    return calls;
  };
  let calls = await ready({ sign: async () => null });
  assert.deepEqual([names(calls), useLadder.getState().phase, useLadder.getState().failure], [['review'], 'failed', 'WALLET_DECLINED']);
  calls = await ready({ engine: { review: async () => ({ ok: false, failure: { code: 'PRO_LIMIT_BALANCE_LOW', message: '' } }) } });
  assert.deepEqual([names(calls), useLadder.getState().failure], [[], 'PRO_LIMIT_BALANCE_LOW']);
  calls = await ready({ engine: { submit: async () => ({ ok: false, failure: { code: 'PRO_LIMIT_SUBMIT_FAILED', message: '' } }) } });
  assert.deepEqual([names(calls), useLadder.getState().failure], [['review', 'sign'], 'PRO_LIMIT_SUBMIT_FAILED']);
  /* The ladder landed and the person's accounts after it did not: placed, and said so — the agent cannot collect yet. */
  calls = await ready({ engine: { submit: async () => ({ ok: true, value: { action: 'place', nftMint: 'order', results: [{ signature: 'sig-1', state: 'LANDED' }, { signature: 'sig-2', state: 'FAILED' }], settled: false } }) } });
  assert.deepEqual([useLadder.getState().phase, useLadder.getState().placed.whole], ['done', false]);
  calls = await ready({ engine: { submit: async () => ({ ok: true, value: { action: 'place', nftMint: 'order', results: [{ signature: 'sig-1', state: 'UNKNOWN' }], settled: false } }) } });
  assert.deepEqual([useLadder.getState().phase, useLadder.getState().failure], ['failed', 'UNKNOWN'], 'sent and not confirmed is never said as placed');
  /* After a refusal the same button asks again from the start. */
  useLadder.getState().setTyped('0.4');
  assert.deepEqual([useLadder.getState().phase, useLadder.getState().failure], ['idle', null]);
});

test('the button does nothing while the ladder cannot be placed: no wallet, no amount, more than is held', async () => {
  const calls = stand({ connection: null, holdings: null });
  useLadder.getState().open(COIN);
  await settle();
  useLadder.getState().setTyped('0.5');
  await settle();
  calls.length = 0;
  await useLadder.getState().place();
  assert.deepEqual(names(calls), [], 'no wallet: nothing is asked of the engine');
  stand();
  useLadder.getState().open(COIN);
  await settle();
  useLadder.getState().setTyped('5');
  await settle();
  assert.equal(choiceOf(useLadder.getState(), HOLDINGS).problem, 'balance');
  const before = useLadder.getState().phase;
  await useLadder.getState().place();
  assert.equal(useLadder.getState().phase, before);
});

test('a share of what the wallet holds is written into the field; on devnet the balances are not known and nothing is assumed', async () => {
  stand();
  useLadder.getState().open(COIN);
  await settle();
  useLadder.getState().setAction('sell');
  useLadder.getState().setShare(50);
  await settle();
  assert.equal(useLadder.getState().typed, '4000', 'half of 8 000 coins');
  assert.equal(useLadder.getState().farBps, 10_000, 'a sale starts at twice the price');
  /* Buying with SOL keeps the order's room back. */
  useLadder.getState().setAction('buy');
  useLadder.getState().setShare(100);
  assert.equal(useLadder.getState().typed, '2.355');
  assert.deepEqual(heldOf(HOLDINGS, MARKET, 'devnet'), { sol: null, quote: null, coin: null });
  assert.equal(heldOf(null, MARKET, 'mainnet'), null);
  assert.deepEqual(heldOf({ ...HOLDINGS, tokens: new Map(), complete: false }, MARKET, 'mainnet').coin, null, 'a read by halves is unknown, never zero');
});

test('a sentence fills the panel and unfolds it — for the coin\'s window, or at once where it is already open', async () => {
  const calls = stand();
  const ask = { said: 'sell half BONK at 2x', action: 'sell', coin: COIN, farBps: 10_000, rungs: 1, amount: null, pay: null, share: 50 };
  /* The window is not open yet: the ask waits for it, once. */
  askLadder(ask);
  assert.equal(takeLadderAsk('another-mint'), null);
  askLadder(ask);
  const waiting = takeLadderAsk(COIN.mint);
  assert.equal(waiting, ask);
  assert.equal(takeLadderAsk(COIN.mint), null);
  useLadder.getState().open(COIN, waiting);
  await settle();
  let state = useLadder.getState();
  assert.deepEqual([state.action, state.farBps, state.rungs, state.typed, state.shown], ['sell', 10_000, 1, '4000', true]);
  assert.deepEqual(calls.findLast((call) => call[0] === 'quote'), ['quote', { action: 'sell', farBps: 10_000, rungs: 1, amountRaw: '400000000' }]);
  /* The window already shows the coin: the next sentence goes straight in. */
  askLadder({ said: 'buy BONK 30% cheaper for 0.2 sol', action: 'buy', coin: COIN, farBps: 3_000, rungs: null, amount: '0.2', pay: 'SOL', share: null });
  await settle();
  state = useLadder.getState();
  assert.deepEqual([state.action, state.farBps, state.rungs, state.typed, state.shown], ['buy', 3_000, null, '0.2', true]);
  /* Money said in another coin than the ladder rests is not turned into this one: the field is left for the person. */
  askLadder({ said: 'buy BONK cheaper for $50', action: 'buy', coin: COIN, farBps: null, rungs: null, amount: '50', pay: 'USDC', share: null });
  await settle();
  assert.deepEqual([useLadder.getState().typed, useLadder.getState().farBps], ['', 2_000]);
  /* A reach farther than the slider goes rests at its end. */
  askLadder({ said: 'sell BONK at 50x', action: 'sell', coin: COIN, farBps: 490_000, rungs: 1, amount: null, pay: null, share: null });
  await settle();
  assert.equal(useLadder.getState().farBps, 90_000);
});

test('taking, cancelling and the agent\'s leave are each a Review, an approval and the relay; one at a time', async () => {
  const calls = stand();
  useLadder.getState().open(COIN);
  await settle();
  calls.length = 0;
  const order = { nftMint: 'order-1', pool: MARKET.pool };
  await useLadder.getState().act(order, 'collect');
  assert.deepEqual(names(calls), ['review', 'sign', 'submit', 'refresh', 'orders']);
  assert.deepEqual(calls[0][1], { action: 'collect', owner: OWNER, pool: MARKET.pool, nftMint: 'order-1' });
  assert.deepEqual(useLadder.getState().acting, { nftMint: 'order-1', step: 'collect', phase: 'done', failure: null });
  calls.length = 0;
  await useLadder.getState().act(order, 'agent-off');
  assert.deepEqual(calls[0][1], { action: 'delegate', owner: OWNER, pool: MARKET.pool, nftMint: 'order-1', agent: false });
  calls.length = 0;
  await useLadder.getState().act(order, 'close');
  assert.equal(calls[0][1].action, 'close');
  /* While one is with the wallet, another is not started. */
  let release;
  stand({ sign: () => new Promise((resolve) => (release = () => resolve(['signed']))) });
  useLadder.getState().open(COIN);
  await settle();
  const first = useLadder.getState().act(order, 'close');
  await settle();
  assert.equal(useLadder.getState().acting.phase, 'wallet');
  await useLadder.getState().act({ nftMint: 'order-2', pool: MARKET.pool }, 'close');
  assert.equal(useLadder.getState().acting.nftMint, 'order-1');
  release();
  await first;
});

test('a count of prices the person chose is asked as it is, and a moved slider keeps it only where the screen says so', async () => {
  const calls = stand();
  useLadder.getState().open(COIN);
  await settle();
  useLadder.getState().setTyped('0.5');
  useLadder.getState().setRungs(8);
  await settle();
  assert.deepEqual(calls.at(-1), ['quote', { action: 'buy', farBps: 2_000, rungs: 8, amountRaw: '500000000' }]);
  /* The terminal's slider keeps the count; the city's own slider fits as many as it can, as before. */
  useLadder.getState().setReach(50, true);
  await settle();
  assert.equal(useLadder.getState().rungs, 8);
  assert.equal(calls.at(-1)[1].rungs, 8);
  useLadder.getState().setReach(10);
  await settle();
  assert.equal(useLadder.getState().rungs, null);
  /* Held to the program's own limit: one to 25 prices. */
  useLadder.getState().setRungs(40);
  assert.equal(useLadder.getState().rungs, 25);
  useLadder.getState().setRungs(0);
  assert.equal(useLadder.getState().rungs, 1);
});
