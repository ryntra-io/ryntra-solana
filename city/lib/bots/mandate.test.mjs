import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Keypair, PublicKey, SystemProgram, VersionedTransaction } from '@solana/web3.js';

import { planEnable, planStopAndWithdraw, unsignedTransaction } from '../../../lib/mandate/human.ts';
import { BUDGET_PRESETS } from '../../../lib/mandate/presets.ts';
import { recordOf } from '../../../lib/mandate/service.server.ts';
import { checkUnsigned, sameMessage } from './mandate-check.ts';
import { createMandateStore, isMandateRecord, keyFor, MANDATE_NET, mandateNetwork, presetLimits } from './mandate.ts';
import { enableAgent, stopAgent } from './mandate-sign.ts';

const human = Keypair.generate();
const agent = Keypair.generate();
const pool = new PublicKey('2zMg7oGcYA4CLatSUaxsJHaZ2SqmsuVHNzrB6AT5cMf7');
const tRyn = new PublicKey('9oAzLLVTTHDW587KyoHK5L5fmU9aDCcR1t3GoeycH1ne');
const NOW = 1_762_000_000n;
const config = { smartAccountIndex: 600_000n, creationFee: 0n, treasury: new PublicKey('BrQAbGdWQ9YUHmWWgKFdFe4miTURH71jkYFPXfaosqDv') };
const BLOCKHASH = '11111111111111111111111111111111';
const b64 = (tx) => Buffer.from(tx.serialize()).toString('base64');

function enablePlan(preset = BUDGET_PRESETS.medium) {
  return planEnable({
    cluster: 'devnet',
    terms: { human: human.publicKey, agent: agent.publicKey, budgetMint: new PublicKey('So11111111111111111111111111111111111111112'), perTrade: preset.perTrade, perDay: preset.perDay, slippageBps: 100, expiresAt: NOW + 30n * 86_400n, venue: { kind: 'dlmm', pool } },
    account: { kind: 'absent', config },
    fund: preset.budget,
    nowSeconds: NOW,
    receiveMints: [tRyn],
    agentFeeLamports: preset.agentFee,
  });
}

test('the window opens on devnet or mainnet, and stays closed in the test environment', () => {
  assert.equal(MANDATE_NET, null);
  assert.equal(mandateNetwork('devnet'), 'devnet');
  assert.equal(mandateNetwork(' devnet '), 'devnet');
  assert.equal(mandateNetwork('mainnet'), 'mainnet');
  for (const value of ['open', 'Devnet', 'Mainnet', '', undefined]) assert.equal(mandateNetwork(value), null);
});

test('each preset sits inside a new agent’s starter caps, and the line shows it in SOL', () => {
  for (const preset of Object.values(BUDGET_PRESETS)) {
    assert.ok(preset.perTrade <= 100_000_000n && preset.perDay <= 500_000_000n && preset.perTrade <= preset.perDay);
    assert.doesNotThrow(() => enablePlan(preset));
  }
  assert.deepEqual(presetLimits('medium'), { budget: 0.25, perTrade: 0.05, perDay: 0.25, days: 30 });
});

test('the mandate is kept per wallet — public facts only — and a stray entry is dropped', () => {
  const plan = enablePlan();
  const record = recordOf(plan.mandate);
  assert.ok(isMandateRecord(record));
  const memory = new Map();
  const storage = () => ({ getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) });
  const store = createMandateStore({ storage });
  store.getState().keep(record);
  const raw = JSON.parse(memory.get('ryntra.city.mandate.v1'));
  raw.stray = { ...record, owner: agent.publicKey.toBase58() };
  memory.set('ryntra.city.mandate.v1', JSON.stringify(raw));
  const again = createMandateStore({ storage });
  again.getState().hydrate();
  assert.deepEqual(Object.keys(again.getState().records), [human.publicKey.toBase58()]);
  assert.doesNotMatch(memory.get('ryntra.city.mandate.v1'), /secret/i);
});

test('before the wallet: the person pays and alone signs, and nothing but her smart account, token and system programs is called', () => {
  const plan = enablePlan();
  const owner = human.publicKey.toBase58();
  const wires = plan.transactions.map((ixs) => b64(unsignedTransaction(human.publicKey, ixs, BLOCKHASH)));
  assert.deepEqual(checkUnsigned(wires, owner), { ok: true });
  assert.deepEqual(checkUnsigned([b64(unsignedTransaction(human.publicKey, planStopAndWithdraw(plan.mandate, 5n), BLOCKHASH))], owner), { ok: true });
  assert.match(checkUnsigned(wires, agent.publicKey.toBase58()).reason, /signers/);
  const sneaky = b64(unsignedTransaction(human.publicKey, [...plan.transactions[0], SystemProgram.transfer({ fromPubkey: agent.publicKey, toPubkey: human.publicKey, lamports: 1 })], BLOCKHASH));
  assert.match(checkUnsigned([sneaky], owner).reason, /signers/);
  const plain = b64(unsignedTransaction(human.publicKey, [SystemProgram.transfer({ fromPubkey: human.publicKey, toPubkey: agent.publicKey, lamports: 1 })], BLOCKHASH));
  assert.match(checkUnsigned([plain], owner).reason, /Not a mandate/);
  assert.match(checkUnsigned([], owner).reason, /number/);
});

test('after the wallet: the same message, really signed', () => {
  const plan = enablePlan();
  const tx = unsignedTransaction(human.publicKey, plan.transactions[0], BLOCKHASH);
  const unsigned = b64(tx);
  assert.equal(sameMessage(unsigned, unsigned), false);
  tx.sign([human]);
  assert.equal(sameMessage(unsigned, b64(tx)), true);
  const other = unsignedTransaction(human.publicKey, plan.transactions[0].slice(1), BLOCKHASH);
  other.sign([human]);
  assert.equal(sameMessage(unsigned, b64(other)), false);
});

/** A stand-in engine: review answers the plan's transactions; submit records what it got. */
function engine(plan) {
  const sent = [];
  const fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    if (url === '/api/bots/mandate/review') return Response.json({ network: 'devnet', record: recordOf(plan.mandate), transactions: plan.transactions.map((ixs) => b64(unsignedTransaction(human.publicKey, ixs, BLOCKHASH))) });
    if (url === '/api/bots/mandate/stop') return Response.json({ network: 'devnet', transactions: [b64(unsignedTransaction(human.publicKey, planStopAndWithdraw(plan.mandate, 1n), BLOCKHASH))] });
    if (url === '/api/bots/mandate/submit') {
      sent.push(body);
      return Response.json({ network: 'devnet', signatures: body.items.map(() => 'sig') });
    }
    return new Response('{}', { status: 404 });
  };
  return { fetch, sent };
}

const walletSigns = async ({ unsignedWireBase64, chain }) => {
  assert.equal(chain, 'solana:devnet');
  return {
    ok: true,
    signedWireBase64: unsignedWireBase64.map((wire) => {
      const tx = VersionedTransaction.deserialize(Buffer.from(wire, 'base64'));
      tx.sign([human]);
      return Buffer.from(tx.serialize()).toString('base64');
    }),
  };
};

test('«Sign» is one wallet prompt on devnet, and the signed transactions go to the relay in order', async () => {
  const plan = enablePlan();
  const { fetch, sent } = engine(plan);
  const who = { wallet: 'Phantom', owner: human.publicKey.toBase58() };
  const { result, record } = await enableAgent(who, 'medium', null, { fetch, sign: walletSigns });
  assert.deepEqual(result, { kind: 'on' });
  assert.equal(record.policy, plan.mandate.policy.toBase58());
  assert.equal(sent.length, 1);
  assert.equal(sent[0].items.length, plan.transactions.length);
  const stopped = await stopAgent(who, record, { fetch, sign: walletSigns });
  assert.deepEqual(stopped, { kind: 'stopped' });
});

test('a wallet that says no, or changes the message, sends nothing', async () => {
  const plan = enablePlan();
  const who = { wallet: 'Phantom', owner: human.publicKey.toBase58() };
  const no = engine(plan);
  const declined = await enableAgent(who, 'medium', null, { fetch: no.fetch, sign: async () => ({ ok: false, reason: 'User rejected' }) });
  assert.equal(declined.result.kind, 'walletNo');
  assert.equal(no.sent.length, 0);
  const swap = engine(plan);
  const changed = await enableAgent(who, 'medium', null, {
    fetch: swap.fetch,
    sign: async ({ unsignedWireBase64 }) => {
      const tx = unsignedTransaction(human.publicKey, [SystemProgram.transfer({ fromPubkey: human.publicKey, toPubkey: agent.publicKey, lamports: 1 })], BLOCKHASH);
      tx.sign([human]);
      return { ok: true, signedWireBase64: unsignedWireBase64.map(() => b64(tx)) };
    },
  });
  assert.equal(changed.result.kind, 'refused');
  assert.equal(swap.sent.length, 0);
});

test('mainnet keeps its mandates apart from devnet’s in the browser', () => {
  assert.equal(keyFor('devnet'), 'ryntra.city.mandate.v1', 'devnet keeps the key it always had');
  assert.equal(keyFor(null), 'ryntra.city.mandate.v1');
  assert.notEqual(keyFor('mainnet'), keyFor('devnet'));
});
