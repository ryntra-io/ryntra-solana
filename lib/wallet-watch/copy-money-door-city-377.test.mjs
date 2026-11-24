/* «Повторюй за гаманцем» with money in the product: the door of her copy's routes (the switch, the site, her
   wallet's proof for a change, the store), each verb behind it (her review, her start — only the record the server kept —
   her stop and her freeze, only on her own copy) and the cron's minute (closed — nothing read, nothing sent; open — one pass
   of the engine with each leader read once under the day's ceiling). The chain, the relay, the venue and the key are the
   tests' own: no network, no real key. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { AGENT_BOOK } from "../mandate/book.server.ts";
import { uncataloguedFacts } from "../mandate/fee.ts";
import { freezeKey } from "../mandate/freeze.server.ts";
import { MAINNET_GENESIS, registryAgent } from "../mandate/service.server.ts";
import { NO_STOCKS } from "../mandate/stocks.server.ts";
import { SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, settingsSyncInstruction, ssaAddress } from "../mandate/ssa.ts";
import { copySalePolicyOf, mandatePolicy } from "../mandate/terms.ts";
import { COPY_START_READY, copyMoneyOpen } from "./copy-agent.ts";
import { copyMandateOf, copyMoneyKey } from "./copy-money.ts";
import { COPY_OWNER_LEASE_MS, COPY_PASS_LEASE_MS, COPY_PENDING_SETTLE_MS, copyOwnerKey, copyPassKey, copyReviewKey, readCopyPending, readCopyRow, registerCopy, takeCopyLease } from "./copy-money.server.ts";
import {
  COPY_EXIT_VERBS,
  COPY_FINISH_SCHEMA,
  COPY_FREEZE_SCHEMA,
  COPY_MONEY_PER_OWNER,
  COPY_REVIEW_SCHEMA,
  COPY_START_SCHEMA,
  COPY_STOP_ITEMS_MAX,
  COPY_STOP_SCHEMA,
  COPY_STOP_SEND_SCHEMA,
  copyExitGate,
  copyMoneyDoor,
  copyMoneyGate,
  finishMoneyCopy,
  freezeMoneyCopy,
  moneyCopiesOf,
  reviewMoneyCopy,
  sendMoneyCopyStop,
  startMoneyCopy,
  stopMoneyCopy,
} from "./copy-money-door.server.ts";
import { LEADER_FRESH_MS, LEADER_WINDOW_MS, copyMoneyMinute, leaderReadNow, leaderReader } from "./copy-money-minute.server.ts";
import { COPY_DAILY_CREDITS } from "./copy-reads.server.ts";
import { COPY_CALL_CREDITS } from "./run.ts";
import { WALLET_WATCH_COLLECTION, activityKey } from "./store.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const seeded = (name) => Keypair.fromSeed(createHash("sha256").update(`city-377 ${name}`).digest()).publicKey;
const T0 = Date.parse("2026-11-22T10:00:00Z");
const human = seeded("human");
const stranger = seeded("stranger");
const leader = seeded("leader").toBase58();
const coinA = seeded("coin a");
const coinB = seeded("coin b");
const agent = registryAgent();
const OPEN = { RYNTRA_AGENT_COPY: "on", RYNTRA_AGENT_MANDATE: "mainnet" };
const SITE = "https://ryntra.io";

/* ------------------------------------------------------------- the stand */

function ask(verb, body, headers = { origin: SITE }) {
  return new Request(`${SITE}/api/wallet-watch/copy/money/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
/** Her wallet proven — or another's, or none (the proof's own 401). */
const provenAs = (address, seen = { asked: 0 }) => async () => {
  seen.asked += 1;
  return address ? { ok: true, address: address.toBase58() } : { ok: false, response: Response.json({ error: { code: "UNAUTHORIZED", message: "No proven wallet: sign in with the wallet first." } }, { status: 401 }) };
};
const keeping = (store, seen = { asked: 0 }) => async () => {
  seen.asked += 1;
  return { store, writable: true };
};
const json = async (response) => ({ status: response.status, body: await response.json() });

/** A trade of the leader's, as the wallet watch keeps it: a buy of `mint` for SOL. */
const buy = (n, mint, agoS = 600) => ({ signature: `${n}`.padEnd(88, "s"), slot: 380_000_000 + n, at: Math.floor(T0 / 1000) - agoS, side: "buy", mint: mint.toBase58(), tokensRaw: "1000000000", decimals: 6, quote: "SOL", quoteAmount: 0.5, paidBy: null });
async function leaderRead(store, trades, readAt = T0) {
  await store.versioned(WALLET_WATCH_COLLECTION).set(activityKey(leader), { schema: "ryntra.wallet-watch.activity", version: 1, wallet: leader, trades, newest: trades[0]?.signature ?? null, pending: [], scanned: trades.length, oldestAt: null, complete: false, skipped: 0, held: null, heldAt: null, readAt: new Date(readAt).toISOString() });
}

/** Mainnet as the review reads it: two plain coins of Token, the smart account program's config, a clock, a blockhash. */
function reviewChain(index = 4n) {
  const config = Buffer.alloc(96);
  Buffer.from([196, 210, 90, 231, 144, 149, 140, 63]).copy(config, 0);
  config.writeBigUInt64LE(index, 8);
  seeded("treasury").toBuffer().copy(config, 64);
  const accounts = new Map([
    [coinA.toBase58(), plainMint()],
    [coinB.toBase58(), plainMint()],
    [ssaAddress.programConfig().toBase58(), { owner: SSA_PROGRAM_ID, data: config, lamports: 1, executable: false }],
  ]);
  return {
    getGenesisHash: async () => MAINNET_GENESIS,
    getAccountInfo: async (key) => accounts.get(key.toBase58()) ?? null,
    getEpochInfo: async () => ({ epoch: 800 }),
    getSlot: async () => 1,
    getBlockTime: async () => Math.floor(T0 / 1000),
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9 }),
  };
}
function plainMint() {
  const data = Buffer.alloc(82);
  data[44] = 6;
  data[45] = 1;
  return { owner: TOKEN_PROGRAM_ID, data, lamports: 1, executable: false };
}
const reviewDeps = (extra = {}) => ({ connection: reviewChain(), dayCoins: async () => 4_000_000n, origin: async () => ({ launchedHere: false, creator: null }), sides: async (mint) => uncataloguedFacts(mint), stocks: NO_STOCKS, now: () => T0, ...extra });
const REVIEW = { owner: human.toBase58(), leader, perDaySol: 0.1, sharePct: 25, days: 7, boundPct: 5 };

/** Her copy's accounts on chain, as the program keeps them, from the record the server kept. */
function chainOfRow(row, over = {}) {
  const mandate = copyMandateOf(row, agent);
  const u64 = (value) => {
    const out = Buffer.alloc(8);
    out.writeBigUInt64LE(value);
    return out;
  };
  const policyAccount = (seed, rules) => {
    const head = Buffer.concat([Buffer.from([222, 135, 7, 163, 235, 177, 33, 68]), mandate.settings.toBuffer(), u64(seed), Buffer.alloc(1 + 8 + 8)]);
    const signers = Buffer.concat([Buffer.from([1, 0, 0, 0]), agent.toBuffer(), Buffer.from([7]), Buffer.from([1, 0])]);
    const body = settingsSyncInstruction({ settings: mandate.settings, rentPayer: human, signers: [human], policyAccounts: [ssaAddress.policy(mandate.settings, seed)], actions: [{ kind: "policyCreate", create: { seed, policy: rules, signers: [{ key: agent, permissions: 7 }], threshold: 1, start: null, expiresAt: mandate.terms.expiresAt } }] }).data;
    return { owner: SSA_PROGRAM_ID, data: Buffer.concat([head, signers, body]), lamports: 1, executable: false };
  };
  /* Her smart account's settings: she alone signs; `seed` — its count of policies made (what a finish follows). */
  const seedOption = over.seed === undefined ? Buffer.alloc(0) : Buffer.concat([Buffer.from([1]), u64(over.seed)]);
  const settings = Buffer.concat([Buffer.alloc(8 + 16 + 32 + 2 + 4 + 8 + 8 + 1 + 8 + 1 + 4 + 33 + 1), seedOption]);
  Buffer.from([223, 179, 163, 190, 177, 224, 67, 173]).copy(settings, 0);
  settings.writeUInt16LE(1, 56);
  const at = 56 + 2 + 4 + 8 + 8 + 1 + 8 + 1;
  settings.writeUInt32LE(1, at);
  (over.signer ?? human).toBuffer().copy(settings, at + 4);
  settings[at + 36] = 7;
  const budget = Buffer.alloc(165);
  budget.writeBigUInt64LE(700_000_000n, 64);
  const accounts = new Map([
    [mandate.settings.toBase58(), { owner: SSA_PROGRAM_ID, data: settings, lamports: 1, executable: false }],
    [mandate.policy.toBase58(), policyAccount(mandate.policySeed, mandatePolicy(mandate.terms, mandate))],
    [mandate.budgetAccount.toBase58(), { owner: TOKEN_PROGRAM_ID, data: budget, lamports: 1, executable: false }],
    ...row.mandate.coins.map((coin) => [coin.mint, plainMint()]),
  ]);
  mandate.salePolicies.forEach((policy, chunk) => accounts.set(policy.toBase58(), policyAccount(mandate.policySeed + 1n + BigInt(chunk), copySalePolicyOf(mandate.terms, mandate, chunk))));
  /* `gone` — her stop landed: every policy off, the budget home. `missing` — the policies her start never landed
     (0 the buy's, then a sale's each); `noAccount` — her first transaction never landed. */
  const policies = [mandate.policy, ...mandate.salePolicies];
  if (over.gone) for (const key of [...policies, mandate.budgetAccount]) accounts.delete(key.toBase58());
  for (const index of over.missing ?? []) accounts.delete(policies[index].toBase58());
  if (over.noAccount) for (const key of [mandate.settings, ...policies, mandate.budgetAccount]) accounts.delete(key.toBase58());
  /* The vault's token accounts beyond the budget's — a coin or an emptied account her stop left. */
  const held = over.held ?? [];
  return {
    accounts,
    held,
    mandate,
    getMultipleAccountsInfo: async (keys) => keys.map((key) => accounts.get(key.toBase58()) ?? null),
    getAccountInfo: async (key) => accounts.get(key.toBase58()) ?? null,
    getTokenAccountsByOwner: async (_owner, { programId }) => ({ value: programId.equals(TOKEN_PROGRAM_ID) ? held.map((entry) => ({ pubkey: entry.pubkey, account: entry.account })) : [] }),
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9 }),
    getGenesisHash: async () => MAINNET_GENESIS,
    getSlot: async () => 1,
    getBlockTime: async () => Math.floor(T0 / 1000),
  };
}

/** Her copy reviewed through the door's own verb: the server's record kept, its name and policy said. */
async function reviewed(store, index = 4n) {
  await leaderRead(store, [buy(2, coinB), buy(1, coinA)]);
  const door = await copyMoneyDoor(ask("review", REVIEW), "review", COPY_REVIEW_SCHEMA, { env: OPEN, prove: provenAs(human), store: keeping(store) });
  assert.ok(!(door instanceof Response));
  const { status, body } = await json(await reviewMoneyCopy(door, reviewDeps({ connection: reviewChain(index) })));
  assert.equal(status, 200, JSON.stringify(body));
  const kept = await store.versioned(WALLET_WATCH_COLLECTION).get(copyReviewKey("mainnet", body.policy, body.review));
  return { body, row: kept.row };
}

/** Her copy in the book, as `registerCopy` writes it. */
async function booked(store) {
  const { row } = await reviewed(store);
  await store.versioned(WALLET_WATCH_COLLECTION).set(copyMoneyKey("mainnet", row.mandate.policy), row);
  return row;
}

/* ------------------------------------------------------------- the switch */

test("the switch: open only with RYNTRA_AGENT_COPY=on, the start wired and the agent's mandate on mainnet", () => {
  assert.equal(COPY_START_READY, true, "the start is wired");
  assert.equal(copyMoneyOpen("on"), true);
  assert.equal(copyMoneyOpen(undefined), false);
  assert.equal(copyMoneyOpen("off"), false);
  assert.equal(copyMoneyGate({}).open, false);
  assert.equal(copyMoneyGate({ RYNTRA_AGENT_COPY: "on" }).open, false, "no mandate — closed");
  assert.equal(copyMoneyGate({ RYNTRA_AGENT_MANDATE: "mainnet" }).open, false, "no switch — closed");
  assert.equal(copyMoneyGate({ RYNTRA_AGENT_COPY: "on", RYNTRA_AGENT_MANDATE: "devnet", RYNTRA_AGENT_MANDATE_POOL: seeded("pool").toBase58(), RYNTRA_AGENT_MANDATE_AGENT: seeded("devnet agent").toBase58() }).open, false, "the leaders' trades are mainnet's");
  const open = copyMoneyGate(OPEN);
  assert.equal(open.open, true);
  assert.equal(open.network, "mainnet");
  assert.ok(open.agent.equals(agent), "the registry's agent");
});

test("closed: the verbs that put money to work answer MONEY_CLOSED and read nothing; her way out is never closed", async () => {
  const starts = [
    ["review", COPY_REVIEW_SCHEMA, REVIEW],
    ["start", COPY_START_SCHEMA, { owner: human.toBase58(), policy: seeded("p").toBase58(), review: "0".repeat(32) }],
    ["finish", COPY_FINISH_SCHEMA, { owner: human.toBase58(), policy: seeded("p").toBase58(), review: "0".repeat(32) }],
  ];
  const exits = [
    ["stop", COPY_STOP_SCHEMA, { owner: human.toBase58(), policy: seeded("p").toBase58() }],
    ["stop-send", COPY_STOP_SEND_SCHEMA, { owner: human.toBase58(), policy: seeded("p").toBase58(), items: ["AAAA"] }],
    ["freeze", COPY_FREEZE_SCHEMA, { owner: human.toBase58(), policy: seeded("p").toBase58(), frozen: true }],
  ];
  assert.deepEqual([...COPY_EXIT_VERBS].sort(), ["freeze", "stop", "stop-send"]);
  for (const env of [{}, { RYNTRA_AGENT_COPY: "on" }, { RYNTRA_AGENT_MANDATE: "mainnet" }, { RYNTRA_AGENT_COPY: "off", RYNTRA_AGENT_MANDATE: "mainnet" }]) {
    for (const [verb, schema, body] of starts) {
      const proof = { asked: 0 };
      const store = { asked: 0 };
      const request = ask(verb, body);
      const answer = await copyMoneyDoor(request, verb, schema, { env, prove: provenAs(human, proof), store: keeping(createMemoryGuardStore(), store) });
      assert.ok(answer instanceof Response);
      const { status, body: said } = await json(answer);
      assert.deepEqual([status, said.error.code], [403, "MONEY_CLOSED"], `${verb} ${JSON.stringify(env)}`);
      assert.deepEqual([proof.asked, store.asked, request.bodyUsed], [0, 0, false], `${verb}: nothing read`);
    }
    /* Her stop, its send and her freeze: the book's row and her wallet's proof alone — the switch is never asked. */
    for (const [verb, schema, body] of exits) {
      const proof = { asked: 0 };
      const store = { asked: 0 };
      const door = await copyMoneyDoor(ask(verb, body), verb, schema, { env, prove: provenAs(human, proof), store: keeping(createMemoryGuardStore(), store) });
      assert.ok(!(door instanceof Response), `${verb} ${JSON.stringify(env)}: open`);
      assert.deepEqual([door.gate.network, proof.asked, store.asked], ["mainnet", 1, 1], verb);
      /* Still her proof: another wallet's never passes. */
      const other = await copyMoneyDoor(ask(verb, body), verb, schema, { env, prove: provenAs(stranger), store: keeping(createMemoryGuardStore()) });
      assert.deepEqual([other.status, (await other.json()).error.code], [403, "WALLET_MISMATCH"], verb);
    }
  }
  assert.ok(copyExitGate().agent.equals(agent), "the registry's agent");
});

test("the switch closed: her copies still read, her stop still built and sent — the book's row and her proof alone", async () => {
  const store = createMemoryGuardStore();
  const row = await booked(store);
  const policy = row.mandate.policy;
  const closed = {};
  const chain = chainOfRow(row);
  assert.equal((await moneyCopiesOf(store, human.toBase58(), T0)).length, 1, "her copies read, whatever the switch");
  const stopDoor = await copyMoneyDoor(ask("stop", { owner: human.toBase58(), policy }), "stop", COPY_STOP_SCHEMA, { env: closed, prove: provenAs(human), store: keeping(store) });
  const built = await json(await stopMoneyCopy(stopDoor, { connection: chain }));
  assert.equal(built.status, 200, JSON.stringify(built.body));
  assert.ok(built.body.transactions.length >= 1);
  /* The stop lands: every policy off, the budget home. */
  const relay = async (input) => {
    for (const key of [chain.mandate.policy, ...chain.mandate.salePolicies, chain.mandate.budgetAccount]) chain.accounts.delete(key.toBase58());
    return { ok: true, signatures: [`sig-${input.items[0]}`] };
  };
  const sendDoor = await copyMoneyDoor(ask("stop/send", { owner: human.toBase58(), policy, items: ["AAAA"] }), "stop-send", COPY_STOP_SEND_SCHEMA, { env: closed, prove: provenAs(human), store: keeping(store) });
  const sent = await json(await sendMoneyCopyStop(sendDoor, { connection: chain, relay, now: () => T0 + 60_000 }));
  assert.deepEqual([sent.status, sent.body.stopped, sent.body.rest], [200, true, false]);
  const after = await readCopyRow(store, "mainnet", policy);
  assert.deepEqual([after.status, after.rest], ["stopped", undefined], "nothing left: no «rest»");
  /* The routes ask the switch nowhere on her way out, and the list reads her copies whatever it says. */
  for (const path of ["stop", "stop/send", "freeze"]) assert.doesNotMatch(read(`app/api/wallet-watch/copy/money/${path}/route.ts`), /copyMoneyGate|moneyOpen|RYNTRA_AGENT_COPY/);
  const paper = read("app/api/wallet-watch/copy/route.ts");
  assert.match(paper, /const moneyCopies = await moneyCopiesOf\(getGuardRuntime\(\)\.store, address, Date\.now\(\), \(\) => mandateConnection\("mainnet"\)\)\.catch\(\(\) => null\);/);
  assert.doesNotMatch(paper, /money \? await moneyCopiesOf/);
});

/* ------------------------------------------------------------- the site, her proof, the store */

test("every change needs her wallet's proof: none — 401; another wallet — 403; a browser from elsewhere — 403 before the proof", async () => {
  const store = createMemoryGuardStore();
  const none = await copyMoneyDoor(ask("freeze", { owner: human.toBase58(), policy: seeded("p").toBase58(), frozen: true }), "freeze", COPY_FREEZE_SCHEMA, { env: OPEN, prove: provenAs(null), store: keeping(store) });
  assert.deepEqual([none.status, (await none.json()).error.code], [401, "UNAUTHORIZED"]);
  const other = await copyMoneyDoor(ask("review", REVIEW), "review", COPY_REVIEW_SCHEMA, { env: OPEN, prove: provenAs(stranger), store: keeping(store) });
  assert.deepEqual([other.status, (await other.json()).error.code], [403, "WALLET_MISMATCH"]);
  for (const headers of [{ origin: "https://evil.example" }, {}, { "sec-fetch-site": "cross-site" }]) {
    const proof = { asked: 0 };
    const foreign = await copyMoneyDoor(ask("stop", { owner: human.toBase58(), policy: seeded("p").toBase58() }, headers), "stop", COPY_STOP_SCHEMA, { env: OPEN, prove: provenAs(human, proof), store: keeping(store) });
    assert.deepEqual([foreign.status, (await foreign.json()).error.code, proof.asked], [403, "FORBIDDEN_ORIGIN", 0], JSON.stringify(headers));
  }
  /* The phone's bearer carries no origin: its proof judges it. */
  const proof = { asked: 0 };
  const phone = await copyMoneyDoor(ask("stop", { owner: human.toBase58(), policy: seeded("p").toBase58() }, { authorization: "Bearer x" }), "stop", COPY_STOP_SCHEMA, { env: OPEN, prove: provenAs(human, proof), store: keeping(store) });
  assert.ok(!(phone instanceof Response));
  assert.equal(proof.asked, 1);
  /* The real proof is the one for a change: the wallet's own signature, never a linked wallet. */
  assert.match(read("lib/mandate/http.server.ts"), /requireWalletProof\(request, "mutation"\)/);
  assert.doesNotMatch(read("lib/wallet-watch/copy-money-door.server.ts"), /"read"\)/);
  /* A store that would lose the book: no change. */
  const lost = await copyMoneyDoor(ask("freeze", { owner: human.toBase58(), policy: seeded("p").toBase58(), frozen: true }), "freeze", COPY_FREEZE_SCHEMA, { env: OPEN, prove: provenAs(human), store: async () => ({ store, writable: false }) });
  assert.deepEqual([lost.status, (await lost.json()).error.code], [503, "UNAVAILABLE"]);
  /* A body the verb does not take: 400 — a start never carries a record of the client's. */
  const forged = await copyMoneyDoor(ask("start", { owner: human.toBase58(), policy: seeded("p").toBase58(), review: "0".repeat(32), row: { owner: human.toBase58() } }), "start", COPY_START_SCHEMA, { env: OPEN, prove: provenAs(human), store: keeping(store) });
  assert.deepEqual([forged.status, (await forged.json()).error.code], [400, "VALIDATION_ERROR"]);
});

/* ------------------------------------------------------------- review and start */

test("review: the leader's coins as the server read them, her numbers as the mandate takes them, a new smart account of her own", async () => {
  const store = createMemoryGuardStore();
  const { body, row } = await reviewed(store);
  assert.deepEqual(body.coins, [coinB.toBase58(), coinA.toBase58()], "the newest buy first");
  assert.equal(body.perDay, "100000000");
  assert.equal(body.perTrade, "25000000");
  assert.equal(body.fundLamports, "700000000");
  assert.equal(body.worstLamports, "300000000", "three day's caps");
  assert.ok(body.transactions.length >= 2 && body.transactions.length <= 4);
  assert.equal(row.owner, human.toBase58());
  assert.equal(row.leader, leader);
  assert.equal(row.mandate.settings, ssaAddress.settings(5n).toBase58(), "a smart account of its own — never a vault shared with another copy");
  const again = (body, deps = reviewDeps(), as = human) => copyMoneyDoor(ask("review", body), "review", COPY_REVIEW_SCHEMA, { env: OPEN, prove: provenAs(as), store: keeping(store) }).then((door) => reviewMoneyCopy(door, deps)).then(json);
  /* Her list only narrows the leader's coins: a coin the leader never bought is not signed for. */
  assert.deepEqual((await again({ ...REVIEW, coins: [coinA.toBase58(), seeded("elsewhere").toBase58()] })).body.coins, [coinA.toBase58()]);
  const none = await again({ ...REVIEW, coins: [seeded("elsewhere").toBase58()] });
  assert.deepEqual([none.status, none.body.error.code], [422, "NO_COINS"]);
  const self = await again({ ...REVIEW, leader: human.toBase58() });
  assert.deepEqual([self.status, self.body.error.code], [400, "SELF"]);
  const budget = await again({ ...REVIEW, perDaySol: 0.000001 });
  assert.deepEqual([budget.status, budget.body.error.code], [400, "BUDGET"]);
  /* A copy of this leader already at work: not twice. */
  await store.versioned(WALLET_WATCH_COLLECTION).set(copyMoneyKey("mainnet", row.mandate.policy), row);
  const twice = await again(REVIEW);
  assert.deepEqual([twice.status, twice.body.error.code], [409, "ALREADY"]);
  for (let i = 1; i < COPY_MONEY_PER_OWNER; i += 1) {
    const policy = seeded(`policy ${i}`).toBase58();
    await store.versioned(WALLET_WATCH_COLLECTION).set(copyMoneyKey("mainnet", policy), { ...row, leader: seeded(`leader ${i}`).toBase58(), mandate: { ...row.mandate, policy } });
  }
  const full = await again({ ...REVIEW, leader: seeded("one more").toBase58() });
  assert.deepEqual([full.status, full.body.error.code], [409, "LIMIT"]);
});

test("start: her signed transactions relayed, then into the book only the record the server kept — never a row of the client's", async () => {
  const store = createMemoryGuardStore();
  const { body, row } = await reviewed(store);
  const relayed = [];
  const relay = async (input, network) => {
    relayed.push({ ...input, network });
    return { ok: true, signatures: input.items.map((_, i) => `sig${i}`) };
  };
  const start = (payload, deps, as = human) => copyMoneyDoor(ask("start", payload), "start", COPY_START_SCHEMA, { env: OPEN, prove: provenAs(as), store: keeping(store) }).then((door) => (door instanceof Response ? door : startMoneyCopy(door, deps))).then(json);
  /* A review the server never kept, another wallet naming hers: no copy. */
  const unknown = await start({ owner: human.toBase58(), policy: body.policy, review: "f".repeat(32) }, { connection: chainOfRow(row), relay, now: () => T0 + 60_000 });
  assert.deepEqual([unknown.status, unknown.body.error.code], [422, "REFUSED"]);
  assert.match(unknown.body.error.message, /review it again/);
  const theirs = await start({ owner: stranger.toBase58(), policy: body.policy, review: body.review, items: ["AAAA"] }, { connection: chainOfRow(row), relay }, stranger);
  assert.equal(theirs.status, 422);
  assert.equal(await readCopyRow(store, "mainnet", body.policy), null);
  /* Hers: relayed in order on mainnet, then the kept record, checked against the chain. */
  relayed.length = 0;
  const started = await start({ owner: human.toBase58(), policy: body.policy, review: body.review, items: ["AAAA", "BBBB"] }, { connection: chainOfRow(row), relay, now: () => T0 + 60_000 });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.deepEqual(relayed, [{ owner: human.toBase58(), items: ["AAAA", "BBBB"], network: "mainnet" }]);
  const kept = await readCopyRow(store, "mainnet", body.policy);
  assert.deepEqual(kept.mandate, row.mandate, "the very record the server built");
  assert.equal(kept.owner, human.toBase58());
  assert.equal(started.body.copy.policy, body.policy);
  assert.equal(started.body.copy.status, "working");
  /* Her start back twice (the answer lost): the copy stands, nothing relayed again. */
  relayed.length = 0;
  const twice = await start({ owner: human.toBase58(), policy: body.policy, review: body.review }, { connection: chainOfRow(row), relay, now: () => T0 + 90_000 });
  assert.equal(twice.status, 200);
  assert.equal(relayed.length, 0);
  /* A relay that did not land: no copy is written for it. */
  const other = createMemoryGuardStore();
  const second = await reviewed(other);
  const failing = async () => ({ ok: false, code: "FAILED", reason: "A transaction failed on mainnet.", signatures: ["x"] });
  const failed = await copyMoneyDoor(ask("start", { owner: human.toBase58(), policy: second.body.policy, review: second.body.review, items: ["AAAA"] }), "start", COPY_START_SCHEMA, { env: OPEN, prove: provenAs(human), store: keeping(other) }).then((door) => startMoneyCopy(door, { connection: chainOfRow(second.row), relay: failing })).then(json);
  assert.deepEqual([failed.status, failed.body.error.code], [422, "FAILED"]);
  assert.equal(await readCopyRow(other, "mainnet", second.body.policy), null);
});

/* ------------------------------------------------------------- stop and freeze: hers alone */

test("freeze: only her own copy — another wallet's proof never turns it", async () => {
  const store = createMemoryGuardStore();
  const row = await booked(store);
  const policy = row.mandate.policy;
  const turn = (owner, frozen, as = owner) => copyMoneyDoor(ask("freeze", { owner: owner.toBase58(), policy, frozen }), "freeze", COPY_FREEZE_SCHEMA, { env: OPEN, prove: provenAs(as), store: keeping(store) }).then((door) => (door instanceof Response ? door : freezeMoneyCopy(door))).then(json);
  const theirs = await turn(stranger, true);
  assert.deepEqual([theirs.status, theirs.body.error.code], [404, "NOT_FOUND"]);
  const mismatch = await turn(human, true, stranger);
  assert.deepEqual([mismatch.status, mismatch.body.error.code], [403, "WALLET_MISMATCH"]);
  assert.equal((await readCopyRow(store, "mainnet", policy)).frozen, undefined);
  assert.ok(!(await store.collection(AGENT_BOOK).get(freezeKey("mainnet", policy))));
  const frozen = await turn(human, true);
  assert.deepEqual([frozen.status, frozen.body.frozen], [200, true]);
  assert.equal((await readCopyRow(store, "mainnet", policy)).frozen, true);
  assert.ok(await store.collection(AGENT_BOOK).get(freezeKey("mainnet", policy)));
  const resumed = await turn(human, false);
  assert.deepEqual([resumed.status, resumed.body.frozen], [200, false]);
  assert.equal((await readCopyRow(store, "mainnet", policy)).frozen, undefined);
});

test("stop: only her own copy; frozen first, then her transactions — the stop itself first; a coin that cannot move named", async () => {
  const store = createMemoryGuardStore();
  const row = await booked(store);
  const policy = row.mandate.policy;
  const stop = (owner, as = owner) => copyMoneyDoor(ask("stop", { owner: owner.toBase58(), policy }), "stop", COPY_STOP_SCHEMA, { env: OPEN, prove: provenAs(as), store: keeping(store) }).then((door) => (door instanceof Response ? door : stopMoneyCopy(door, { connection: chainOfRow(row) }))).then(json);
  const theirs = await stop(stranger);
  assert.deepEqual([theirs.status, theirs.body.error.code], [404, "NOT_FOUND"]);
  assert.equal((await readCopyRow(store, "mainnet", policy)).frozen, undefined, "another wallet freezes nothing");
  const mine = await stop(human);
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.ok(mine.body.transactions.length >= 1);
  assert.deepEqual(mine.body.skipped, []);
  assert.equal((await readCopyRow(store, "mainnet", policy)).frozen, true, "frozen before her stop is built");
  /* The engine's stuck coins come back named, each with its reason (the engine's own words; the screen says them). */
  assert.match(read("lib/wallet-watch/copy-money-door.server.ts"), /skipped: review\.skipped, left: review\.left/);
});

test("stop/send: the stop itself must land first — then each of the rest alone; the copy marked stopped once its policy is gone", async () => {
  const store = createMemoryGuardStore();
  const row = await booked(store);
  const policy = row.mandate.policy;
  const sent = [];
  const relay = (fail) => async (input) => {
    sent.push(input.items[0]);
    return fail(input.items[0]) ? { ok: false, code: "FAILED", reason: "A transaction failed on mainnet.", signatures: [] } : { ok: true, signatures: [`sig-${input.items[0]}`] };
  };
  const send = (items, deps, owner = human, as = owner) => copyMoneyDoor(ask("stop/send", { owner: owner.toBase58(), policy, items }), "stop-send", COPY_STOP_SEND_SCHEMA, { env: OPEN, prove: provenAs(as), store: keeping(store) }).then((door) => (door instanceof Response ? door : sendMoneyCopyStop(door, deps))).then(json);
  /* Another wallet: nothing relayed. */
  const theirs = await send(["AAAA"], { connection: chainOfRow(row, { gone: true }), relay: relay(() => false) }, stranger);
  assert.deepEqual([theirs.status, sent.length], [404, 0]);
  /* The stop itself fails: nothing else goes. */
  const first = await send(["AAAA", "BBBB", "CCCC"], { connection: chainOfRow(row), relay: relay((item) => item === "AAAA") });
  assert.deepEqual([first.status, sent], [422, ["AAAA"]]);
  assert.equal((await readCopyRow(store, "mainnet", policy)).status, "working");
  /* The stop lands, one coin's transaction fails alone, the rest go; the policy gone — stopped. */
  sent.length = 0;
  const done = await send(["AAAA", "BBBB", "CCCC"], { connection: chainOfRow(row, { gone: true }), relay: relay((item) => item === "BBBB"), now: () => T0 + 120_000 });
  assert.equal(done.status, 200);
  assert.deepEqual(sent, ["AAAA", "BBBB", "CCCC"]);
  assert.deepEqual([done.body.failed, done.body.stopped, done.body.signatures], [1, true, ["sig-AAAA", "sig-CCCC"]]);
  assert.equal((await readCopyRow(store, "mainnet", policy)).status, "stopped");
  assert.equal(COPY_STOP_ITEMS_MAX, 21);
  /* Her copies as the screen reads them. */
  const [view] = await moneyCopiesOf(store, human.toBase58(), T0 + 120_000);
  assert.deepEqual([view.policy, view.leader, view.status, view.perDaySol, view.coins], [policy, leader, "stopped", 0.1, 2]);
  assert.deepEqual(await moneyCopiesOf(store, stranger.toBase58(), T0), [], "another wallet's list holds none of hers");
});

/* ------------------------------------------------------------- A start that landed only in part */

/** A token account of the vault, as the token program keeps it: its mint, its owner, its amount; `frozen` — its issuer froze it. */
function tokenAccount(mint, owner, amount, frozen = false) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = frozen ? 2 : 1;
  return { owner: TOKEN_PROGRAM_ID, data, lamports: 2_039_280, executable: false };
}
const keysOf = (wire) => VersionedTransaction.deserialize(Buffer.from(wire, "base64")).message.staticAccountKeys.map((key) => key.toBase58());

/** Her start relayed: the first transaction lands, the next fails — as `relayMandate` answers it. */
async function startedInPart(store, body, chain, relay = async () => ({ ok: false, code: "FAILED", reason: "A transaction failed on mainnet.", signatures: ["sig0", "sig1"] })) {
  const door = await copyMoneyDoor(ask("start", { owner: human.toBase58(), policy: body.policy, review: body.review, items: ["AAAA", "BBBB"] }), "start", COPY_START_SCHEMA, { env: OPEN, prove: provenAs(human), store: keeping(store) });
  return json(await startMoneyCopy(door, { connection: chain, relay, now: () => T0 + 30_000 }));
}

test("a start that landed in part: no copy in the book, yet listed as unfinished whatever the switch — and taken home from the server's record of her review", async () => {
  const store = createMemoryGuardStore();
  const { body, row } = await reviewed(store);
  const policy = body.policy;
  const owner = human.toBase58();
  /* Her account, the budget, the agent's SOL and the buy's policy landed; the sale's policy did not. */
  const chain = chainOfRow(row, { missing: [1], seed: row.mandate.policySeed === "1" ? 1n : BigInt(row.mandate.policySeed) });
  const start = await startedInPart(store, body, chain);
  assert.deepEqual([start.status, start.body.error.code, start.body.partial], [422, "FAILED", true]);
  assert.equal(await readCopyRow(store, "mainnet", policy), null, "no copy in the book");
  const mark = await readCopyPending(store, "mainnet", owner, policy);
  assert.deepEqual([mark?.review, mark?.settings], [body.review, row.mandate.settings], "written as under way before the relay");
  /* Asked again without her transactions (its answer lost): still no copy — and still said in part. */
  const again = await copyMoneyDoor(ask("start", { owner, policy, review: body.review }), "start", COPY_START_SCHEMA, { env: OPEN, prove: provenAs(human), store: keeping(store) }).then((door) => startMoneyCopy(door, { connection: chain, now: () => T0 + 40_000 })).then(json);
  assert.deepEqual([again.status, again.body.error.code, again.body.partial], [422, "REFUSED", true]);
  /* Listed as unfinished — hers only; without the chain's word, the book alone. */
  const [listed, ...more] = await moneyCopiesOf(store, owner, T0 + 60_000, () => chain);
  assert.deepEqual([listed.status, listed.review, listed.policy, listed.leader, listed.rest, more.length], ["pending", body.review, policy, leader, false, 0]);
  assert.deepEqual(await moneyCopiesOf(store, stranger.toBase58(), T0 + 60_000, () => chain), []);
  assert.deepEqual(await moneyCopiesOf(store, owner, T0 + 60_000), [], "the book alone");
  /* The switch closed: her stop from the review — only with her proof and the review's name. */
  const stopAs = (payload, as = human) =>
    copyMoneyDoor(ask("stop", payload), "stop", COPY_STOP_SCHEMA, { env: {}, prove: provenAs(as), store: keeping(store) })
      .then((door) => (door instanceof Response ? door : stopMoneyCopy(door, { connection: chain, now: () => T0 + 60_000 })))
      .then(json);
  assert.equal((await stopAs({ owner, policy })).status, 404, "no row in the book, no review named");
  assert.equal((await stopAs({ owner: stranger.toBase58(), policy, review: body.review }, stranger)).status, 404, "another wallet: no start of hers");
  assert.equal((await stopAs({ owner, policy, review: "f".repeat(32) })).status, 404, "a review the server never kept");
  const built = await stopAs({ owner, policy, review: body.review });
  assert.equal(built.status, 200, JSON.stringify(built.body));
  assert.equal(built.body.transactions.length, 1, "the stop itself: what landed taken off, the budget home");
  const keys = keysOf(built.body.transactions[0]);
  assert.equal(keys[0], owner, "she pays and alone signs");
  assert.ok(keys.includes(policy) && keys.includes(row.mandate.budget), "the buy's policy off, the budget's account closed to her");
  assert.ok(!keys.includes(row.mandate.salePolicies[0]), "the sale's policy never landed: not named");
  assert.equal((await readCopyPending(store, "mainnet", owner, policy)).stopped, undefined, "built, not sent: still hers to finish");
  /* Sent: it lands — nothing of her start stands, and the server forgets it, record and mark. */
  const relay = async (input) => {
    for (const key of [chain.mandate.policy, chain.mandate.budgetAccount]) chain.accounts.delete(key.toBase58());
    return { ok: true, signatures: [`sig-${input.items[0]}`] };
  };
  const sent = await copyMoneyDoor(ask("stop/send", { owner, policy, review: body.review, items: ["STOP"] }), "stop-send", COPY_STOP_SEND_SCHEMA, { env: {}, prove: provenAs(human), store: keeping(store) })
    .then((door) => sendMoneyCopyStop(door, { connection: chain, relay, now: () => T0 + 90_000 }))
    .then(json);
  assert.deepEqual([sent.status, sent.body.stopped, sent.body.rest, sent.body.signatures], [200, true, false, ["sig-STOP"]]);
  assert.equal(await readCopyPending(store, "mainnet", owner, policy), null);
  assert.equal(await store.versioned(WALLET_WATCH_COLLECTION).get(copyReviewKey("mainnet", policy, body.review)), undefined);
  assert.deepEqual(await moneyCopiesOf(store, owner, T0 + 120_000, () => chain), []);
});

test("a start that landed in part: her stop that leaves something keeps it listed — «Take the rest» — and no finish after it", async () => {
  const store = createMemoryGuardStore();
  const { body, row } = await reviewed(store);
  const owner = human.toBase58();
  const chain = chainOfRow(row, { missing: [1], seed: 1n });
  await startedInPart(store, body, chain);
  /* Her stop lands, but the budget's account does not close (a grain sent to it): something stands. */
  const relay = async (input) => {
    chain.accounts.delete(chain.mandate.policy.toBase58());
    return { ok: true, signatures: [`sig-${input.items[0]}`] };
  };
  const sent = await copyMoneyDoor(ask("stop/send", { owner, policy: body.policy, review: body.review, items: ["STOP"] }), "stop-send", COPY_STOP_SEND_SCHEMA, { env: {}, prove: provenAs(human), store: keeping(store) })
    .then((door) => sendMoneyCopyStop(door, { connection: chain, relay }))
    .then(json);
  assert.deepEqual([sent.body.stopped, sent.body.rest], [true, true]);
  const [listed] = await moneyCopiesOf(store, owner, T0 + 60_000, () => chain);
  assert.deepEqual([listed.status, listed.rest], ["pending", true], "«Take the rest», after a reload too");
  const finish = await copyMoneyDoor(ask("finish", { owner, policy: body.policy, review: body.review }), "finish", COPY_FINISH_SCHEMA, { env: OPEN, prove: provenAs(human), store: keeping(store) })
    .then((door) => finishMoneyCopy(door, { connection: chain }))
    .then(json);
  assert.deepEqual([finish.status, finish.body.error.code], [409, "STOPPED"]);
});

test("finish: only what of her start is not on chain, built from the server's record — the very transaction her review built; then the book", async () => {
  const store = createMemoryGuardStore();
  const { body, row } = await reviewed(store);
  const owner = human.toBase58();
  const finishOn = (chain) =>
    copyMoneyDoor(ask("finish", { owner, policy: body.policy, review: body.review }), "finish", COPY_FINISH_SCHEMA, { env: OPEN, prove: provenAs(human), store: keeping(store) })
      .then((door) => finishMoneyCopy(door, { connection: chain }))
      .then(json);
  /* The buy's policy landed (her account's count: 1), the sale's did not: one transaction — the review's own last. */
  const part = chainOfRow(row, { missing: [1], seed: 1n });
  await startedInPart(store, body, part);
  const finished = await finishOn(part);
  assert.equal(finished.status, 200, JSON.stringify(finished.body));
  assert.equal(finished.body.transactions.length, 1);
  assert.equal(finished.body.transactions[0], body.transactions.at(-1), "byte for byte the sale's policy her review built");
  /* The buy's policy missing too: both, the buy's first. */
  const both = await finishOn(chainOfRow(row, { missing: [0, 1] }));
  assert.equal(both.body.transactions.length, 2);
  assert.ok(keysOf(both.body.transactions[0]).includes(body.policy));
  assert.ok(keysOf(both.body.transactions[1]).includes(row.mandate.salePolicies[0]));
  for (const wire of both.body.transactions) assert.equal(keysOf(wire)[0], owner, "she pays and alone signs");
  /* Not in order, not hers, nothing landed: no finish — said. */
  assert.deepEqual([(await finishOn(chainOfRow(row, { missing: [1], seed: 4n }))).body.error.code], ["REFUSED"], "her account's count is not the next seed");
  assert.deepEqual([(await finishOn(chainOfRow(row, { missing: [0] }))).body.error.code], ["REFUSED"], "a gap in her policies");
  assert.deepEqual([(await finishOn(chainOfRow(row, { noAccount: true }))).status], [409]);
  assert.deepEqual([(await finishOn(chainOfRow(row, { missing: [1], seed: 1n, signer: stranger }))).body.error.code], ["NOTHING"], "another's account at that number");
  /* Every policy stands: no transaction — her start writes the book, and her start under way is done with. */
  const whole = chainOfRow(row);
  const none = await finishOn(whole);
  assert.deepEqual(none.body.transactions, []);
  const booked = await copyMoneyDoor(ask("start", { owner, policy: body.policy, review: body.review }), "start", COPY_START_SCHEMA, { env: OPEN, prove: provenAs(human), store: keeping(store) })
    .then((door) => startMoneyCopy(door, { connection: whole, now: () => T0 + 90_000 }))
    .then(json);
  assert.equal(booked.status, 200, JSON.stringify(booked.body));
  assert.equal((await readCopyRow(store, "mainnet", body.policy)).status, "working");
  assert.equal(await readCopyPending(store, "mainnet", owner, body.policy), null);
  /* Another wallet's proof never finishes hers. */
  const theirs = await copyMoneyDoor(ask("finish", { owner: stranger.toBase58(), policy: body.policy, review: body.review }), "finish", COPY_FINISH_SCHEMA, { env: OPEN, prove: provenAs(stranger), store: keeping(store) })
    .then((door) => finishMoneyCopy(door, { connection: whole }))
    .then(json);
  assert.equal(theirs.status, 404);
});

test("a start refused before anything went out leaves nothing listed; one whose account never stood as hers is forgotten once nothing can land", async () => {
  const store = createMemoryGuardStore();
  const { body, row } = await reviewed(store);
  const owner = human.toBase58();
  const refused = await startedInPart(store, body, chainOfRow(row), async () => ({ ok: false, code: "REFUSED", reason: "The person must pay and be the only signer.", signatures: [] }));
  assert.deepEqual([refused.status, refused.body.partial], [400, false]);
  assert.equal(await readCopyPending(store, "mainnet", owner, body.policy), null);
  /* Sent, and no word back: kept — it may land until its blockhash ends; hidden while her account is not there. */
  const nothing = chainOfRow(row, { noAccount: true });
  const lost = await startedInPart(store, body, nothing, async () => ({ ok: false, code: "FAILED", reason: "timed out", signatures: ["sig0"] }));
  assert.deepEqual([lost.status, lost.body.partial], [422, false]);
  assert.ok(await readCopyPending(store, "mainnet", owner, body.policy));
  assert.deepEqual(await moneyCopiesOf(store, owner, T0 + 60_000, () => nothing), []);
  assert.ok(await readCopyPending(store, "mainnet", owner, body.policy), "not yet past the time it could land");
  /* The chain not read: shown — never hidden on a silence. */
  const silent = { getMultipleAccountsInfo: async () => { throw new Error("rpc down"); } };
  assert.equal((await moneyCopiesOf(store, owner, T0 + 60_000, () => silent))[0].status, "pending");
  /* Past the time any of her transactions could land: forgotten. */
  assert.deepEqual(await moneyCopiesOf(store, owner, T0 + 30_000 + COPY_PENDING_SETTLE_MS + 1, () => nothing), []);
  assert.equal(await readCopyPending(store, "mainnet", owner, body.policy), null);
});

test("her bounds kept where the copy is written, not only at review: one copy of a wallet, five at most; two starts of hers at once never both pass", async () => {
  const store = createMemoryGuardStore();
  const { body, row } = await reviewed(store);
  const owner = human.toBase58();
  const ask2 = { cluster: "mainnet", owner, policy: body.policy, review: body.review };
  const deps = { store, connection: chainOfRow(row), now: () => T0 + 60_000 };
  const rows = store.versioned(WALLET_WATCH_COLLECTION);
  /* Another copy of the same wallet written after her review: refused at the book — her review kept, to take it home. */
  const meanwhile = seeded("meanwhile").toBase58();
  await rows.set(copyMoneyKey("mainnet", meanwhile), { ...row, mandate: { ...row.mandate, policy: meanwhile } });
  const twice = await registerCopy(ask2, agent, deps);
  assert.deepEqual([twice.ok, twice.code], [false, "ALREADY"]);
  assert.ok(await rows.get(copyReviewKey("mainnet", body.policy, body.review)), "her review kept");
  /* Stopped, it counts no more; five others at work — the sixth refused. */
  await rows.set(copyMoneyKey("mainnet", meanwhile), { ...row, status: "stopped", mandate: { ...row.mandate, policy: meanwhile } });
  for (let i = 0; i < COPY_MONEY_PER_OWNER; i += 1) {
    const policy = seeded(`bound ${i}`).toBase58();
    await rows.set(copyMoneyKey("mainnet", policy), { ...row, leader: seeded(`bound leader ${i}`).toBase58(), mandate: { ...row.mandate, policy } });
  }
  const full = await registerCopy(ask2, agent, deps);
  assert.deepEqual([full.ok, full.code], [false, "LIMIT"]);
  /* Through the door: 409 with its code — and her start, under way, listed to take home. */
  const door = await copyMoneyDoor(ask("start", { owner, policy: body.policy, review: body.review }), "start", COPY_START_SCHEMA, { env: OPEN, prove: provenAs(human), store: keeping(store) });
  const said = await json(await startMoneyCopy(door, { connection: chainOfRow(row), now: () => T0 + 60_000 }));
  assert.deepEqual([said.status, said.body.error.code], [409, "LIMIT"]);
  for (let i = 0; i < COPY_MONEY_PER_OWNER; i += 1) await rows.delete(copyMoneyKey("mainnet", seeded(`bound ${i}`).toBase58()));
  /* Another start of hers being written: this one waits — and passes once the hold is given back or runs out. */
  assert.equal(await takeCopyLease(store, copyOwnerKey("mainnet", owner), "another start", T0 + 60_000, COPY_OWNER_LEASE_MS), true);
  const busy = await registerCopy(ask2, agent, deps);
  assert.deepEqual([busy.ok, busy.code], [false, "BUSY"]);
  const passed = await registerCopy(ask2, agent, { ...deps, now: () => T0 + 60_000 + COPY_OWNER_LEASE_MS + 1 });
  assert.equal(passed.ok, true);
  /* Two at once, of the same wallet's copy under two reviews: one in the book, the other refused. */
  const other = createMemoryGuardStore();
  const first = await reviewed(other);
  const second = await reviewed(other, 9n);
  assert.notEqual(first.body.policy, second.body.policy, "two smart accounts of hers, one wallet copied");
  const results = await Promise.all([first, second].map(({ body: b, row: r }) => registerCopy({ cluster: "mainnet", owner, policy: b.policy, review: b.review }, agent, { store: other, connection: chainOfRow(r), now: () => T0 + 60_000 })));
  assert.equal(results.filter((result) => result.ok).length, 1, JSON.stringify(results));
  assert.ok(results.some((result) => !result.ok && (result.code === "ALREADY" || result.code === "BUSY")));
});

test("after her stop, «the rest» stays on her copy's row while anything stands — after a reload too; a coin that fails alone holds no other back", async () => {
  const store = createMemoryGuardStore();
  const row = await booked(store);
  const owner = human.toBase58();
  const policy = row.mandate.policy;
  const vault = new PublicKey(row.mandate.vault);
  const coinAccount = seeded("vault coin a");
  const chain = chainOfRow(row, { held: [{ pubkey: coinAccount, account: tokenAccount(coinA, vault, 5_000n) }] });
  const send = (items, relay, now = T0 + 60_000) =>
    copyMoneyDoor(ask("stop/send", { owner, policy, items }), "stop-send", COPY_STOP_SEND_SCHEMA, { env: {}, prove: provenAs(human), store: keeping(store) })
      .then((door) => sendMoneyCopyStop(door, { connection: chain, relay, now: () => now }))
      .then(json);
  /* The stop lands, the coin's move does not: stopped — and «the rest» kept on the row. */
  const first = await send(["STOP", "COIN"], async (input) => {
    if (input.items[0] === "COIN") return { ok: false, code: "FAILED", reason: "A transaction failed on mainnet.", signatures: [] };
    for (const key of [chain.mandate.policy, ...chain.mandate.salePolicies, chain.mandate.budgetAccount]) chain.accounts.delete(key.toBase58());
    return { ok: true, signatures: ["sig-stop"] };
  });
  assert.deepEqual([first.status, first.body.stopped, first.body.failed, first.body.rest], [200, true, 1, true]);
  let kept = await readCopyRow(store, "mainnet", policy);
  assert.deepEqual([kept.status, kept.rest], ["stopped", true]);
  const [view] = await moneyCopiesOf(store, owner, T0 + 90_000);
  assert.deepEqual([view.status, view.rest], ["stopped", true], "a reload still offers «Take the rest»");
  /* «Take the rest»: her stopped copy's stop — nothing to take off, so every transaction goes alone. */
  const rest = await copyMoneyDoor(ask("stop", { owner, policy }), "stop", COPY_STOP_SCHEMA, { env: {}, prove: provenAs(human), store: keeping(store) })
    .then((door) => stopMoneyCopy(door, { connection: chain }))
    .then(json);
  assert.equal(rest.status, 200, JSON.stringify(rest.body));
  assert.equal(rest.body.transactions.length, 2, "the coin's move, then its account's close");
  /* The first fails — the second still goes; the vault read empty after: «the rest» gone. */
  const sent = [];
  const second = await send(["MOVE", "CLOSE"], async (input) => {
    sent.push(input.items[0]);
    if (input.items[0] === "MOVE") return { ok: false, code: "FAILED", reason: "A transaction failed on mainnet.", signatures: [] };
    chain.held.length = 0;
    return { ok: true, signatures: ["sig-close"] };
  });
  assert.deepEqual(sent, ["MOVE", "CLOSE"]);
  assert.deepEqual([second.status, second.body.failed, second.body.rest], [200, 1, false]);
  kept = await readCopyRow(store, "mainnet", policy);
  assert.deepEqual([kept.status, kept.rest], ["stopped", undefined]);
  /* A coin her issuer froze in the vault: nothing can move — said, and «the rest» stays while it stands. */
  chain.held.push({ pubkey: coinAccount, account: tokenAccount(coinA, vault, 5_000n, true) });
  const stuck = await copyMoneyDoor(ask("stop", { owner, policy }), "stop", COPY_STOP_SCHEMA, { env: {}, prove: provenAs(human), store: keeping(store) })
    .then((door) => stopMoneyCopy(door, { connection: chain }))
    .then(json);
  assert.deepEqual([stuck.status, stuck.body.error.code, stuck.body.skipped.map((coin) => coin.reason)], [409, "NOTHING", ["its issuer froze it in your vault"]]);
  assert.equal((await readCopyRow(store, "mainnet", policy)).rest, true);
  /* Gone: nothing left — «the rest» cleared. */
  chain.held.length = 0;
  await copyMoneyDoor(ask("stop", { owner, policy }), "stop", COPY_STOP_SCHEMA, { env: {}, prove: provenAs(human), store: keeping(store) }).then((door) => stopMoneyCopy(door, { connection: chain }));
  assert.equal((await readCopyRow(store, "mainnet", policy)).rest, undefined);
});

test("a stop whose read after does not answer keeps «the rest» — never a vault said empty that was not read", async () => {
  const store = createMemoryGuardStore();
  const row = await booked(store);
  const chain = chainOfRow(row);
  let reads = 0;
  const blind = { ...chain, getTokenAccountsByOwner: async () => (++reads > 2 ? Promise.reject(new Error("rpc down")) : { value: [] }) };
  const relay = async () => {
    for (const key of [chain.mandate.policy, ...chain.mandate.salePolicies, chain.mandate.budgetAccount]) chain.accounts.delete(key.toBase58());
    return { ok: true, signatures: ["sig"] };
  };
  const sent = await copyMoneyDoor(ask("stop/send", { owner: human.toBase58(), policy: row.mandate.policy, items: ["STOP"] }), "stop-send", COPY_STOP_SEND_SCHEMA, { env: {}, prove: provenAs(human), store: keeping(store) })
    .then((door) => sendMoneyCopyStop(door, { connection: blind, relay }))
    .then(json);
  assert.deepEqual([sent.status, sent.body.stopped, sent.body.rest], [200, false, true]);
  assert.equal((await readCopyRow(store, "mainnet", row.mandate.policy)).rest, true);
});

/* ------------------------------------------------------------- the routes */

test("the routes: each a door and one verb; the paper route never takes money and reads her money copies whatever the switch", () => {
  for (const [path, verb] of [
    ["review", "reviewMoneyCopy"],
    ["start", "startMoneyCopy"],
    ["stop", "stopMoneyCopy"],
    ["stop/send", "sendMoneyCopyStop"],
    ["freeze", "freezeMoneyCopy"],
    ["finish", "finishMoneyCopy"],
  ]) {
    const route = read(`app/api/wallet-watch/copy/money/${path}/route.ts`);
    assert.match(route, /const door = await copyMoneyDoor\(request, "[a-z-]+", COPY_[A-Z_]+_SCHEMA\);\n  if \(door instanceof Response\) return door;/, path);
    assert.match(route, new RegExp(`return ${verb}\\(door`), path);
    assert.doesNotMatch(route, /process\.env|Keypair|secretKey|signTransaction|sendRawTransaction/, `${path}: no switch read of its own, no key`);
  }
  const paper = read("app/api/wallet-watch/copy/route.ts");
  assert.match(paper, /const moneyOpen = \(\) => copyMoneyGate\(process\.env\)\.open;/);
  assert.match(paper, /if \(input\.money === true\) return moneyOpen\(\) \? json\(\{ error: "bad request", code: "MONEY_ROUTE" \}, 400\) : json\(\{ error: "closed", code: "MONEY_CLOSED" \}, 403\);/);
  assert.match(paper, /const moneyCopies = await moneyCopiesOf\(/);
  /* The door holds no key and never signs: the server builds and relays her signed transactions only. */
  for (const file of ["lib/wallet-watch/copy-money-door.server.ts", "lib/wallet-watch/copy-money-minute.server.ts"]) {
    assert.doesNotMatch(read(file), /Keypair|secretKey|signTransaction|signAllTransactions|process\.env\.RYNTRA_AGENT_MANDATE_KEY/, file);
  }
});

/* ------------------------------------------------------------- the cron */

const boom = new Proxy({}, { get: (_target, name) => (name === "then" ? undefined : () => { throw new Error(`touched: ${String(name)}`); }) });

test("the cron: closed — it reads nothing and sends nothing; open but not ready — it says why and touches no copy", async () => {
  for (const env of [{}, { RYNTRA_AGENT_COPY: "on" }, { RYNTRA_AGENT_MANDATE: "mainnet", RYNTRA_AGENT_MANDATE_SIGNER: "kms" }]) {
    assert.deepEqual(await copyMoneyMinute(env, { store: boom, connection: boom, chain: boom, reads: boom, venue: boom, key: boom, trade: boom }), { ran: false, why: "closed" });
  }
  /* On mainnet only Google's key signs: the environment's never. */
  assert.deepEqual(await copyMoneyMinute({ ...OPEN, RYNTRA_AGENT_MANDATE_SIGNER: "env", RYNTRA_AGENT_MANDATE_KEY: "x" }, { store: boom, connection: boom, chain: boom }), { ran: false, why: "no-key" });
  const key = { mode: "kms", keyRef: null, sign: async () => new Uint8Array(64) };
  assert.deepEqual(await copyMoneyMinute(OPEN, { key, store: createMemoryGuardStore(), connection: boom, chain: boom }), { ran: false, why: "store" });
  const durable = { ...createMemoryGuardStore(), durability: "DURABLE_SINGLE_WRITER" };
  assert.deepEqual(await copyMoneyMinute(OPEN, { key, store: durable, connection: { getGenesisHash: async () => "devnet" }, chain: boom }), { ran: false, why: "not-mainnet" });
  const cron = read("app/api/cron/agent-copy/route.ts");
  assert.match(cron, /decideBearerAuth[\s\S]*legacy-rejected[\s\S]*copyMoneyMinute\(process\.env\)/);
  const vercel = JSON.parse(read("vercel.json"));
  assert.ok(vercel.crons.some((entry) => entry.path === "/api/cron/agent-copy" && entry.schedule === "* * * * *"));
});

test("the cron: open — one pass of the engine over her copies, each leader read once", async () => {
  const durable = { ...createMemoryGuardStore(), durability: "DURABLE_SINGLE_WRITER" };
  const row = await booked(durable);
  const second = { ...row, owner: stranger.toBase58(), mandate: { ...row.mandate, policy: seeded("second policy").toBase58() } };
  await durable.versioned(WALLET_WATCH_COLLECTION).set(copyMoneyKey("mainnet", second.mandate.policy), second);
  /* The leader's record is stale: the pass reads it again. */
  await leaderRead(durable, [], T0 - 10 * 60_000);
  const lists = [];
  const chain = {
    signatures: async (address) => {
      lists.push(address);
      return { rows: [], whole: true };
    },
    transaction: async () => null,
    holdings: async () => {
      throw new Error("a copy's leader's holdings are never read");
    },
  };
  const spent = [];
  const reads = { allows: () => true, spend: (credits) => spent.push(credits) };
  const connection = { getGenesisHash: async () => MAINNET_GENESIS, getAccountInfo: async () => ({ owner: SSA_PROGRAM_ID, data: Buffer.alloc(8), lamports: 1, executable: false }) };
  const key = { mode: "kms", keyRef: null, sign: async () => new Uint8Array(64) };
  const answer = await copyMoneyMinute(OPEN, { key, store: durable, connection, chain, reads, venue: boom, trade: boom, now: () => T0 });
  assert.equal(answer.ran, true, JSON.stringify(answer));
  assert.deepEqual(answer.lines.map((line) => line.did), ["idle", "idle"]);
  assert.deepEqual(lists, [leader], "one read of the leader for both copies");
  assert.deepEqual(spent, [COPY_CALL_CREDITS], "paid by its calls");
  /* Her freeze: the copy starts nothing. */
  await durable.collection(AGENT_BOOK).set(freezeKey("mainnet", row.mandate.policy), { v: 1, kind: "freeze", cluster: "mainnet", policy: row.mandate.policy, owner: row.owner, at: T0 });
  const frozen = await copyMoneyMinute(OPEN, { key, store: durable, connection, chain, reads, venue: boom, trade: boom, now: () => T0 + 1_000 });
  assert.ok(frozen.lines.some((line) => line.policy === row.mandate.policy && line.did === "frozen"));
  /* Another pass under way — this minute reads nothing and sends nothing, and says so. */
  assert.equal(await takeCopyLease(durable, copyPassKey("mainnet"), "another minute", T0 + 2_000, COPY_PASS_LEASE_MS), true);
  assert.deepEqual(await copyMoneyMinute(OPEN, { key, store: durable, connection, chain: boom, reads: boom, venue: boom, trade: boom, now: () => T0 + 2_000 }), { ran: false, why: "busy" });
});

test("the leaders' reads: a record of this window costs nothing; past the day's ceiling — not read; every other read paid by its calls", async () => {
  const store = createMemoryGuardStore();
  let calls = 0;
  const chain = { signatures: async () => (calls++, { rows: [{ signature: "a".repeat(88), slot: 1, blockTime: 1, failed: false }], whole: false }), transaction: async () => (calls++, null), holdings: async () => null };
  /* Read by the wallet watch a second into this window: the cron's minute a minute on takes it as its own read. */
  await leaderRead(store, [buy(1, coinA)], T0 + 1_000);
  const fresh = leaderReader({ store, chain, reads: { allows: () => false, spend: () => assert.fail("nothing to pay") }, now: () => T0 + 60_000 });
  assert.equal((await fresh.read(leader)).length, 1);
  assert.deepEqual([calls, fresh.tally.fresh], [0, 1]);
  const capped = leaderReader({ store, chain, reads: { allows: () => false, spend: () => assert.fail("nothing read") }, now: () => T0 + LEADER_WINDOW_MS + 1 });
  assert.equal(await capped.read(leader), null);
  assert.deepEqual([calls, capped.tally.capped], [0, 1]);
  const spent = [];
  const paid = leaderReader({ store, chain, reads: { allows: () => true, spend: (credits) => spent.push(credits) }, now: () => T0 + LEADER_WINDOW_MS + 1 });
  await Promise.all([paid.read(leader), paid.read(leader)]);
  assert.deepEqual([calls, spent], [2, [2 * COPY_CALL_CREDITS]], "one list and one transaction, read once for two copies");
});

test("the leaders' reads: once a window — a quiet leader costs the day 720 reads, not 1 440, whatever the cron's drift", async () => {
  assert.equal(LEADER_WINDOW_MS, 120_000, "the wallet watch's own pass");
  assert.equal(LEADER_FRESH_MS, LEADER_WINDOW_MS);
  const store = createMemoryGuardStore();
  let calls = 0;
  const quiet = { signatures: async () => (calls++, { rows: [], whole: true }), transaction: async () => assert.fail("nothing new to read"), holdings: async () => null };
  await leaderRead(store, [], T0 - 10 * 60_000);
  const spent = [];
  const reads = { allows: () => true, spend: (credits) => spent.push(credits) };
  for (let minute = 0; minute < 1_440; minute += 1) {
    /* The cron every minute, a few seconds late — never the same few. */
    const at = T0 + minute * 60_000 + 2_000 + (minute % 9) * 1_500;
    await leaderReader({ store, chain: quiet, reads, now: () => at }).read(leader);
  }
  const day = spent.reduce((sum, credits) => sum + credits, 0);
  assert.equal(calls, 720, "one read in each two-minute window");
  assert.equal(day, 720 * COPY_CALL_CREDITS);
  assert.ok(day * 8 <= COPY_DAILY_CREDITS, "the ceiling's eight quiet leaders hold");
  /* The window: the same two minutes on the clock; a record from the future is never taken as read. */
  assert.equal(leaderReadNow(T0, T0 + 119_999), true);
  assert.equal(leaderReadNow(T0 - 1, T0 + 1), false);
  assert.equal(leaderReadNow(T0 + 60_000, T0), false);
});
