/* CITY-187 — «Sell» in the tower's window: the engine's figures, one wallet prompt, the agent's sale and its receipt,
   the way back, and the words. The engine is a stand-in answering the routes; the wallet signs with a key made here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';

import { planEnable, planStopAndWithdraw, unsignedTransaction } from '../../../lib/mandate/human.ts';
import { recordOf } from '../../../lib/mandate/service.server.ts';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, ssaAddress } from '../../../lib/mandate/ssa.ts';
import { AUTOPILOT } from './words.ts';
import { QUOTE_FRESH_MS, SALE_SHARES, isSaleFigures, isSaleReceipt, readSaleQuote, shareLabel, useSell } from './sell.ts';
import { tapBack, tapSell } from './sell-sign.ts';

const human = Keypair.generate();
const agent = Keypair.generate().publicKey;
const pool = new PublicKey('2zMg7oGcYA4CLatSUaxsJHaZ2SqmsuVHNzrB6AT5cMf7');
const coin = new PublicKey('9oAzLLVTTHDW587KyoHK5L5fmU9aDCcR1t3GoeycH1ne');
const settings = ssaAddress.settings(9n);
const NOW = 1_762_000_000n;
const BLOCKHASH = '11111111111111111111111111111111';
const b64 = (tx) => Buffer.from(tx.serialize()).toString('base64');
const who = { wallet: 'Phantom', owner: human.publicKey.toBase58() };
const BUY = { owner: who.owner, settings: settings.toBase58(), vault: ssaAddress.vault(settings, 0).toBase58(), policy: ssaAddress.policy(settings, 1n).toBase58(), budget: BLOCKHASH, perTrade: '50000000', perDay: '250000000', expiresAt: '1764000000' };

/* The sale the engine builds: her coin into her vault under a sale's mandate on the smart account she has. */
const plan = planEnable({
  cluster: 'devnet',
  terms: {
    human: human.publicKey,
    agent,
    budgetMint: coin,
    perTrade: 500_000n,
    perDay: 500_000n,
    slippageBps: 100,
    expiresAt: NOW + 86_400n,
    venue: { kind: 'dlmm', pool },
    fixedBuy: { amountIn: 500_000n, outputMint: NATIVE_MINT, minOut: 4_900n },
    budgetCoin: { program: TOKEN_PROGRAM_ID, decimals: 6 },
  },
  account: { kind: 'present', settings, state: { signers: [{ key: human.publicKey, permissions: 7 }], threshold: 1, timeLock: 0, policySeed: 1n } },
  fund: 500_000n,
  nowSeconds: NOW,
});
const SALE = recordOf(plan.mandate);
const FIGURES = { coin: coin.toBase58(), decimals: 6, heldRaw: '1000000', amountRaw: '500000', quoteRaw: '4950', floorRaw: '4900', feeBps: 100, feeRaw: '5000', feeSolRaw: '50' };

function engine(options = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push(url);
    if (url === '/api/bots/mandate/sell') return options.refuse ? Response.json({ error: { code: 'NOTHING', message: 'The agent holds none of this coin for you.' } }, { status: 422 }) : Response.json({ network: 'devnet', record: SALE, transactions: [b64(unsignedTransaction(human.publicKey, plan.transactions[0], BLOCKHASH))], figures: { ...FIGURES, amountRaw: String(5_000 * body.share) } });
    if (url === '/api/bots/mandate/submit') return Response.json({ network: 'devnet', signatures: body.items.map(() => 'sig') });
    if (url === '/api/bots/mandate/sell/go') {
      const early = (options.notSignedFirst ?? 0) > calls.filter((u) => u === url).length - 1;
      if (early) return Response.json({ error: { code: 'NOT_SIGNED', message: 'The sale is not signed yet.' } }, { status: 409 });
      return Response.json({ network: 'devnet', policy: body.policy, status: options.status ?? 'sold', signature: '5sig', soldRaw: '500000', receivedRaw: '4901', reason: null });
    }
    if (url === '/api/bots/mandate/sell/back') return Response.json({ network: 'devnet', transactions: [b64(unsignedTransaction(human.publicKey, planStopAndWithdraw(plan.mandate, 500_000n), BLOCKHASH))], coinRaw: '500000' });
    if (url.startsWith('/api/bots/mandate/agent?')) return Response.json({ status: 'working', strategy: 'steady', receiveMint: coin.toBase58(), everyMs: 1, result: { trades: 2, spentRaw: '1', boughtRaw: '1', worthRaw: null, earnedRaw: null, multiple: null }, last: [], updatedAt: 1, heldRaw: '500000', lastSale: null });
    return new Response('{}', { status: 404 });
  };
  return { fetch, calls };
}

const walletSigns = async ({ unsignedWireBase64, chain }) => {
  assert.equal(chain, 'solana:devnet');
  return {
    ok: true,
    signedWireBase64: unsignedWireBase64.map((wire) => {
      const tx = VersionedTransaction.deserialize(Buffer.from(wire, 'base64'));
      tx.sign([human]);
      return b64(tx);
    }),
  };
};

const reset = () => {
  useSell.setState({ mint: null });
  useSell.getState().focus(coin.toBase58());
};

test('the shares are 25 %, 50 % and all; the engine’s figures and receipts are read, never guessed', async () => {
  assert.deepEqual([...SALE_SHARES], [25, 50, 100]);
  assert.equal(shareLabel(100, 'All'), 'All');
  assert.equal(shareLabel(25, 'All'), '25%');
  assert.equal(isSaleFigures(FIGURES), true);
  assert.equal(isSaleFigures({ ...FIGURES, floorRaw: '4.9' }), false);
  assert.equal(isSaleReceipt({ policy: 'p', status: 'sold', soldRaw: '1' }), true);
  assert.equal(isSaleReceipt({ policy: 'p', status: 'won', soldRaw: '1' }), false);
  const quote = await readSaleQuote({ owner: who.owner, policy: BUY.policy }, 50, engine().fetch, () => 7);
  assert.equal(quote.figures.amountRaw, '250000');
  assert.equal(quote.at, 7);
  assert.deepEqual(await readSaleQuote({ owner: who.owner, policy: BUY.policy }, 50, engine({ refuse: true }).fetch), { refused: 'The agent holds none of this coin for you.', code: 'NOTHING' });
  assert.equal(await readSaleQuote({ owner: who.owner, policy: BUY.policy }, 50, async () => new Response('', { status: 503 })), null);
});

test('«Sell» is one wallet prompt: a stale price is asked again first, then the agent sells and the receipt stays', async () => {
  reset();
  const { fetch, calls } = engine({ notSignedFirst: 1 });
  useSell.getState().pick(50);
  useSell.getState().set({ quote: { share: 50, figures: FIGURES, record: SALE, transactions: [], at: 0 } });
  const receipt = await tapSell(who, BUY, { fetch, sign: walletSigns, now: () => QUOTE_FRESH_MS + 1, wait: async () => undefined });
  assert.equal(receipt.status, 'sold');
  assert.equal(receipt.receivedRaw, '4901');
  assert.deepEqual(calls.filter((url) => !url.startsWith('/api/bots/mandate/agent')), ['/api/bots/mandate/sell', '/api/bots/mandate/submit', '/api/bots/mandate/sell/go', '/api/bots/mandate/sell/go']);
  const st = useSell.getState();
  assert.equal(st.phase, 'done');
  assert.equal(st.receipt.signature, '5sig');
  assert.equal(st.quote, null);
  /* Pressed again while the receipt shows: nothing more is asked. */
  assert.equal(await tapSell(who, BUY, { fetch, sign: walletSigns }), null);
});

test('a wallet that says no sells nothing; a sale that did not go comes back with one more signature', async () => {
  reset();
  const no = engine();
  const declined = await tapSell(who, BUY, { fetch: no.fetch, sign: async () => ({ ok: false, reason: 'User rejected' }), now: () => 1 });
  assert.equal(declined, null);
  assert.equal(useSell.getState().note, 'walletNo');
  assert.ok(!no.calls.includes('/api/bots/mandate/submit'));
  reset();
  const lost = engine({ status: 'failed' });
  const receipt = await tapSell(who, BUY, { fetch: lost.fetch, sign: walletSigns, now: () => 1 });
  assert.equal(receipt.status, 'failed');
  assert.equal(await tapBack(who, BUY, { fetch: lost.fetch, sign: walletSigns }), true);
  assert.equal(useSell.getState().note, 'returned');
  assert.equal(useSell.getState().receipt, null);
  assert.equal(lost.calls.filter((url) => url === '/api/bots/mandate/submit').length, 2);
});

test('the words: one line each, in English and Ukrainian, no promise and nothing technical', () => {
  const keys = Object.keys(AUTOPILOT.en).filter((key) => key.startsWith('sell'));
  assert.ok(keys.length >= 15);
  for (const key of keys) assert.ok(key in AUTOPILOT.uk, key);
  assert.equal(AUTOPILOT.en.sellGo(100), 'Sell all');
  assert.equal(AUTOPILOT.uk.sellGo(25), 'Продати 25%');
  assert.equal(AUTOPILOT.en.sellFee('1', '0.0001'), 'Ryntra fee 1% · 0.0001 SOL');
  const all = [...keys.map((key) => AUTOPILOT.en[key]), ...keys.map((key) => AUTOPILOT.uk[key])].map((value) => (typeof value === 'function' ? value('1', 'X', '2') : value)).join(' ');
  assert.doesNotMatch(all, /\b(api|policy|mandate|vault|receipt|approval|x1000|profit|guarantee)\b/iu);
  assert.doesNotMatch(all, /квитанц|мандат|прибуток|гарант/iu);
});
