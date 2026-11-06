import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Keypair } from '@solana/web3.js';

import { cacheFrom, forgetAgents, leadOf, parseAgents, readAgents, syncAgents, useAgents } from './agents.ts';
import { useMandate } from './mandate.ts';
import { portfolioView } from '../money/portfolio.ts';

/* CITY-207 — the city reads the wallet's agents from the engine; the browser's note is a cache of them. */

const key = () => Keypair.generate().publicKey.toBase58();
const OWNER = key();
const STRANGER = key();
const record = (owner = OWNER) => ({ owner, settings: key(), vault: key(), policy: key(), budget: key(), perTrade: '50000000', perDay: '100000000', expiresAt: '1900000000' });
const mandate = (extra = {}) => ({ record: record(), status: 'working', budgetLamports: '80000000', live: true, active: true, trades: 3, pilot: false, createdAt: 10, ...extra });
const net = (mandates = [], extra = {}) => ({ network: 'devnet', open: { mandate: true, pilot: false, care: false }, read: true, mandates, pilot: null, cares: [], ...extra });
const answer = (devnet = net(), mainnet = net()) => ({ owner: OWNER, networks: { mainnet, devnet } });
const respond = (body, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test("the engine's answer is read strictly: another wallet's mandate or a broken record never passes", () => {
  const theirs = mandate({ record: record(STRANGER) });
  const broken = mandate({ record: { ...record(), policy: 'not-an-address' } });
  const mine = mandate();
  const parsed = parseAgents(answer(net([theirs, broken, mine])), OWNER);
  assert.deepEqual(parsed.networks.devnet.mandates.map((m) => m.record.policy), [mine.record.policy]);
  assert.equal(parseAgents(answer(), STRANGER), null, "an answer for another wallet is no answer");
  assert.equal(parseAgents(null, OWNER), null);
  assert.equal(parseAgents({ owner: OWNER }, OWNER), null);
  /* A network missing from the answer reads as not read, never as «no agents». */
  assert.equal(parseAgents({ owner: OWNER, networks: {} }, OWNER).networks.mainnet.read, false);
  assert.equal(parsed.networks.devnet.mandates[0].budgetLamports, '80000000');
  assert.equal(parseAgents(answer(net([mandate({ budgetLamports: '-1' })])), OWNER).networks.devnet.mandates[0].budgetLamports, null);
});

test('the lead mandate is one at work, the newest of them; else the newest', () => {
  const stopped = mandate({ status: 'stopped', active: false, createdAt: 30 });
  const working = mandate({ createdAt: 20 });
  const older = mandate({ createdAt: 5 });
  assert.equal(leadOf(net([older, stopped, working])), working);
  assert.equal(leadOf(net([stopped, { ...older, active: false }])), stopped);
  assert.equal(leadOf(net([])), null);
});

test("the cache becomes the engine's lead; the browser's own note stays only when the engine knows none", () => {
  const local = record();
  const lead = mandate();
  assert.deepEqual(cacheFrom(net([lead]), local), { record: lead.record, status: { active: true, budgetLamports: '80000000' } });
  assert.deepEqual(cacheFrom(net([]), local), { record: local, status: null });
  assert.deepEqual(cacheFrom(net([lead], { read: false }), local), { record: local, status: null }, 'a book that did not answer changes nothing');
  assert.deepEqual(cacheFrom(net([]), undefined), { record: null, status: null });
  /* The chain not read: the record is the engine's, its state is left for the status read. */
  assert.deepEqual(cacheFrom(net([mandate({ live: null, budgetLamports: null })]), undefined).status, null);
});

test('one read of the engine: a POST of the wallet; a refusal or a broken body is null', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return respond(answer(net([mandate()])))();
  };
  const read = await readAgents(OWNER, fetcher);
  assert.equal(read.networks.devnet.mandates.length, 1);
  assert.equal(calls[0].url, '/api/bots/agents');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { owner: OWNER });
  assert.equal(await readAgents(OWNER, respond({ error: { code: 'AGENTS_CLOSED' } }, 404)), null);
  assert.equal(await readAgents(OWNER, async () => { throw new Error('offline'); }), null);
});

test("a new browser learns the mandate from the engine: the cache and the state are written, a fresh answer not asked twice", async () => {
  const owner = key();
  const lead = { ...mandate(), record: record(owner) };
  let asked = 0;
  const fetcher = async () => {
    asked += 1;
    return new Response(JSON.stringify({ owner, networks: { devnet: net([lead]), mainnet: net() } }));
  };
  assert.equal(useMandate.getState().records[owner], undefined);
  const [a, b] = await Promise.all([syncAgents(owner, { fetch: fetcher, network: 'devnet', now: () => 1_000 }), syncAgents(owner, { fetch: fetcher, network: 'devnet', now: () => 2_000 })]);
  assert.equal(asked, 1, 'the portfolio, «Your agents» and the budget card share one read');
  assert.equal(a, b);
  assert.deepEqual(useMandate.getState().records[owner], lead.record);
  assert.deepEqual(useMandate.getState().status[lead.record.policy], { active: true, budgetLamports: '80000000' });
  assert.equal(useAgents.getState().byOwner[owner].networks.devnet.mandates.length, 1);
  forgetAgents(owner);
  await syncAgents(owner, { fetch: fetcher, network: 'devnet', now: () => 3_000 });
  assert.equal(asked, 2, 'after a sign or a stop the engine is asked again');
});

test('a closed or silent engine leaves the browser as it was, and is asked again next time', async () => {
  const owner = key();
  let asked = 0;
  const closed = async () => {
    asked += 1;
    return new Response('{}', { status: 404 });
  };
  assert.equal(await syncAgents(owner, { fetch: closed, network: 'devnet', now: () => 1 }), null);
  assert.equal(useMandate.getState().records[owner], undefined);
  await syncAgents(owner, { fetch: closed, network: 'devnet', now: () => 2 });
  assert.equal(asked, 2);
});

/* ---------------------------------------------------------------- the portfolio */

const WORDS = { inRange: 'Earning', outOfRange: 'Out of range', locked: 'Locked', caring: 'Your agent', working: 'Working', stopped: 'Stopped', test: 'Test', trades: (n) => `${n} trades`, agent: 'Agent', phoenix: 'Phoenix', phoenixLine: '' };
const view = (careRows) =>
  portfolioView({
    assets: [],
    walletState: 'ready',
    lend: { state: 'off', rows: [] },
    piers: { state: 'ready', rows: [] },
    care: { state: 'ready', rows: careRows },
    agent: { state: 'ready', row: null },
    orders: { state: 'off', rows: [] },
    phoenix: { state: 'off', usd: null },
    words: WORDS,
  });

test("a looked-after pier carries the engine's dollars into the pools and the total; unpriced, it is unknown — never zero", () => {
  const priced = view([{ key: 'c1', pool: key(), name: null, inRange: true, usd: 120.5, unclaimedUsd: 1.25 }]);
  const pools = priced.places.find((p) => p.kind === 'pools');
  assert.equal(pools.rows[0].usd, 120.5);
  assert.equal(pools.rows[0].gainUsd, 1.25);
  assert.equal(priced.totalUsd, 120.5);
  const unpriced = view([{ key: 'c1', pool: key(), name: null, inRange: true, usd: null, unclaimedUsd: null }]);
  assert.equal(unpriced.places.find((p) => p.kind === 'pools').rows[0].usd, null);
  assert.equal(unpriced.places.find((p) => p.kind === 'pools').usd, null);
  /* A row of before (no figure at all) reads the same as one the engine could not price. */
  assert.equal(view([{ key: 'c1', pool: key(), name: null, inRange: false }]).places.find((p) => p.kind === 'pools').rows[0].usd, null);
});
