// The care's and the keeper's door (`./door.server.ts`): only the proven wallet acts, and only for itself. Each attack the
// review of 21.11 found, played against the door with the real services behind it: another wallet, this site's
// `Origin` forged from `curl`, a stop without the person's signature, another wallet's review over the person's
// pending one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { answerCareDoor, doorIntent, openCareDoor } from "./door.server.ts";
import { CARE_BOOK, careMinute, relayStop, stopCare, stopTicketKey } from "./service.server.ts";
import { keeperKey } from "./stock-keeper-book.ts";
import { DEFAULT_KEEPER_CHOICE } from "./stock-keeper-terms.ts";
import { keeperActions } from "./stock-keeper.server.ts";

const SITE = "https://ryntra.io";
const key = () => Keypair.generate().publicKey.toBase58();
const PERSON = key();
const STRANGER = key();
const ACTIONS = ["review", "submit", "stop", "relay", "status"];

/**
 * The proof as `requireWalletProof` reads it, over what a request carries: the phone's bearer, the wallet's own signed
 * proof in the browser (`rw`), or a wallet the browser's account only linked (`rwl`) — which counts for a read and never
 * for a change. Nothing else proves a wallet: an `Origin` header proves nothing.
 */
function proveLike() {
  const asked = [];
  const prove = async (request, intent) => {
    asked.push(intent);
    const bearer = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (bearer) return { ok: true, address: bearer };
    const cookie = request.headers.get("cookie") ?? "";
    const signed = /(?:^|; )rw=([^;]+)/.exec(cookie)?.[1];
    const linked = /(?:^|; )rwl=([^;]+)/.exec(cookie)?.[1];
    const address = signed ?? (intent === "read" ? linked : undefined);
    if (address) return { ok: true, address };
    return { ok: false, response: Response.json({ error: { code: "UNAUTHORIZED", message: "No proven wallet: sign in with the wallet first." } }, { status: 401 }) };
  };
  return { prove, asked };
}

/** Each request from its own address: the pool actions' rate (12 a minute an address) is not what these tests hold. */
let caller = 0;
const requestOf = (body, headers = {}) =>
  new Request(`${SITE}/api/city/earn/care`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, "x-forwarded-for": `10.9.${Math.floor(++caller / 250)}.${caller % 250}`, ...headers },
    body: JSON.stringify(body),
  });

/** Actions that write down whom they were asked for, and never act. */
function spyActions() {
  const calls = [];
  const actions = Object.fromEntries(ACTIONS.map((name) => [name, async (owner, body) => (calls.push({ name, owner, body }), { ok: true, did: name })]));
  return { actions, calls };
}

/* ------------------------------------------------------------------ the door alone */

test("forged Origin: `curl` with this site's Origin and no proof is refused for every change — nothing is asked of the care", async () => {
  const { prove } = proveLike();
  const { actions, calls } = spyActions();
  for (const action of ["review", "submit", "stop", "relay"]) {
    const answer = await answerCareDoor(requestOf({ action, owner: PERSON, key: `c:mainnet:${PERSON}:1`, signed: [] }, { "sec-fetch-site": "same-origin" }), actions, { closed: "CARE_CLOSED", prove });
    assert.equal(answer.status, 401, action);
    assert.equal((await answer.json()).error.code, "UNAUTHORIZED");
  }
  assert.deepEqual(calls, []);
  /* A read of the cares is answered without a proof — someone who turned the care on before still sees its «Stop». */
  assert.equal((await answerCareDoor(requestOf({ action: "status", owner: PERSON }), actions, { closed: "CARE_CLOSED", prove })).status, 200, "a read");
  assert.deepEqual(calls.map((call) => call.name), ["status"]);
});

test("another wallet: a proof of one wallet never acts for another — in the browser or with the phone's bearer", async () => {
  const { prove } = proveLike();
  const { actions, calls } = spyActions();
  for (const action of ["review", "submit", "stop", "relay"]) {
    const browser = await answerCareDoor(requestOf({ action, owner: PERSON, key: "k" }, { cookie: `rw=${STRANGER}` }), actions, { closed: "CARE_CLOSED", prove });
    assert.equal(browser.status, 403, action);
    assert.equal((await browser.json()).error.code, "WALLET_MISMATCH");
    const phone = await answerCareDoor(requestOf({ action, owner: PERSON, key: "k" }, { origin: "", authorization: `Bearer ${STRANGER}` }), actions, { closed: "CARE_CLOSED", prove });
    assert.equal(phone.status, 403, `${action} with a bearer`);
  }
  assert.deepEqual(calls, []);
});

test("a wallet the account only linked reads its cares, and never changes them", async () => {
  const { prove } = proveLike();
  const { actions, calls } = spyActions();
  const read = await answerCareDoor(requestOf({ action: "status", owner: PERSON }, { cookie: `rwl=${PERSON}` }), actions, { closed: "CARE_CLOSED", prove });
  assert.equal(read.status, 200);
  for (const action of ["review", "submit", "stop", "relay"]) {
    assert.equal((await answerCareDoor(requestOf({ action, owner: PERSON, key: "k" }, { cookie: `rwl=${PERSON}` }), actions, { closed: "CARE_CLOSED", prove })).status, 401, action);
  }
  assert.deepEqual(calls.map((call) => call.name), ["status"]);
  assert.deepEqual(ACTIONS.map(doorIntent), ["mutation", "mutation", "mutation", "mutation", "read"]);
});

test("a browser from another site is refused before its body or its proof are read", async () => {
  const { prove, asked } = proveLike();
  const { actions, calls } = spyActions();
  const answer = await answerCareDoor(requestOf({ action: "stop", owner: PERSON, key: "k" }, { origin: "https://elsewhere.example", cookie: `rw=${PERSON}` }), actions, { closed: "CARE_CLOSED", prove });
  assert.equal(answer.status, 403);
  assert.equal((await answer.json()).error.code, "FORBIDDEN_ORIGIN");
  assert.deepEqual(asked, []);
  assert.deepEqual(calls, []);
});

test("the proven wallet: the action is asked for the address it proved, with the proof each action needs", async () => {
  const { prove, asked } = proveLike();
  const { actions, calls } = spyActions();
  for (const action of ACTIONS) {
    const answer = await answerCareDoor(requestOf({ action, owner: PERSON, key: "k" }, { cookie: `rw=${PERSON}` }), actions, { closed: "CARE_CLOSED", prove });
    assert.equal(answer.status, 200, action);
    assert.equal((await answer.json()).did, action);
  }
  assert.deepEqual(calls.map((call) => [call.name, call.owner]), ACTIONS.map((name) => [name, PERSON]));
  assert.deepEqual(asked, ["mutation", "mutation", "mutation", "mutation"], "a read of the cares asks for no proof");
  /* Not understood: no action, an unknown one, no wallet. */
  for (const body of [{ owner: PERSON }, { action: "drain", owner: PERSON }, { action: "stop" }]) {
    assert.equal((await openCareDoor(requestOf(body, { cookie: `rw=${PERSON}` }), { prove })).ok, false);
  }
});

test("the door's real proof is `requireWalletProof`, and both routes go through the door — none through the pool door that bound no wallet", () => {
  const door = readFileSync(new URL("./door.server.ts", import.meta.url), "utf8");
  assert.match(door, /\(await import\("\.\.\/api\/v1\/proof\.ts"\)\)\.requireWalletProof\(request, intent\)/);
  assert.match(door, /action === "status" \? "read" : "mutation"/);
  for (const [route, actions] of [["../../app/api/city/earn/care/route.ts", "careActions()"], ["../../app/api/city/earn/keeper/route.ts", "keeperActions()"]]) {
    const source = readFileSync(new URL(route, import.meta.url), "utf8");
    assert.ok(source.includes(`return answerCareDoor(request, ${actions}, `), route);
    assert.doesNotMatch(source, /openLiquidityDoor|\.mismatch\(|body\.owner/, `${route}: the wallet comes from the proof only`);
  }
});

/* ------------------------------------------------------------------ the care: a stop is the person's signature */

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const AGENT = key();
const CARE_ENV = Object.freeze({ RYNTRA_AGENT_CARE: "devnet", RYNTRA_AGENT_CARE_AGENT: AGENT });

const wireOf = (payer = Keypair.generate().publicKey) => new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: "11111111111111111111111111111111", instructions: [] }).compileToV0Message());
const base64 = (tx) => Buffer.from(tx.serialize()).toString("base64");

function careRow(owner = PERSON, cluster = "devnet", extra = {}) {
  const k = `c:${cluster}:${owner}:1`;
  return {
    v: 1,
    key: k,
    care: {
      cluster,
      owner,
      settings: key(),
      vaultIndex: 1,
      vault: key(),
      exitPolicy: key(),
      tendPolicy: key(),
      exitSeed: "1",
      tendSeed: "2",
      pool: { kind: "dlmm", address: key(), mintX: "So11111111111111111111111111111111111111112", mintY: key(), programX: key(), programY: key() },
      fees: "reinvest",
      rebalance: true,
      stopBelow: 1.5,
      expiresAt: "9999999999",
      agent: AGENT,
    },
    status: "working",
    messages: [],
    width: 24,
    shape: "spot",
    position: key(),
    outOfRangeSince: null,
    lastRebalanceAt: null,
    lastClaimAt: null,
    events: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

/** The chain: the care's two policies stand until `policies.live` says otherwise; a send may be refused. */
function careChain() {
  const sent = [];
  const policies = { live: true };
  const chain = {
    sent,
    policies,
    refuse: null,
    getGenesisHash: async () => DEVNET_GENESIS,
    getAccountInfo: async () => (policies.live ? { data: new Uint8Array(8), owner: Keypair.generate().publicKey, lamports: 1, executable: false } : null),
    sendRawTransaction: async (bytes) => {
      if (chain.refuse !== null && sent.length === chain.refuse) throw new Error("Transaction simulation failed: the position moved");
      sent.push(bytes);
      return `sig${sent.length}`;
    },
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    confirmTransaction: async () => ({ value: { err: null } }),
  };
  return chain;
}

test("the owner's stop takes effect when asked: «stopped» at once, the agent's pass leaves the care, whatever the relay does", async () => {
  const store = createMemoryGuardStore();
  const row = careRow();
  await store.collection(CARE_BOOK).set(row.key, row);
  const connection = careChain();
  const txs = [wireOf(), wireOf(), wireOf()];
  const built = await stopCare({ owner: PERSON, key: row.key }, { env: CARE_ENV, store, connection, build: async () => ({ ok: true, transactions: txs }), now: () => 5 });
  assert.equal(built.ok, true);
  assert.equal(built.transactions.length, 3);
  const after = await store.collection(CARE_BOOK).get(row.key);
  assert.equal(after.status, "stopped");
  assert.equal(after.updatedAt, 5);
  assert.equal((await store.collection(CARE_BOOK).get(stopTicketKey(row.key))).messages.length, 3);

  /* The agent's pass leaves it. */
  const stepped = [];
  await careMinute(CARE_ENV, { store, connection, keyed: true, now: () => 10, step: async (entry) => (stepped.push(entry.key), entry) });
  assert.deepEqual(stepped, []);

  /* Nobody else's stop: another wallet, a care of another network. */
  assert.equal((await stopCare({ owner: STRANGER, key: row.key }, { env: CARE_ENV, store, connection, build: async () => ({ ok: true, transactions: txs }) })).code, "CARE_UNKNOWN");
  const mainnetRow = careRow(PERSON, "mainnet");
  await store.collection(CARE_BOOK).set(mainnetRow.key, mainnetRow);
  assert.equal((await stopCare({ owner: PERSON, key: mainnetRow.key }, { env: CARE_ENV, store, connection, build: async () => ({ ok: true, transactions: txs }) })).code, "CARE_UNKNOWN");
});

test("relay: only the built messages, in order; the first the chain refuses stops the rest; the row stays «stopped»; `stopped` says whether the policies are gone", async () => {
  const store = createMemoryGuardStore();
  const row = careRow();
  await store.collection(CARE_BOOK).set(row.key, row);
  const connection = careChain();
  const txs = [wireOf(), wireOf(), wireOf()];
  const deps = { env: CARE_ENV, store, connection, build: async () => ({ ok: true, transactions: txs }), now: () => 7 };
  await stopCare({ owner: PERSON, key: row.key }, deps);

  assert.equal((await relayStop({ owner: PERSON, key: row.key, signed: [base64(wireOf())] }, deps)).code, "CARE_SIGNED", "a message that was not built");
  assert.equal((await relayStop({ owner: PERSON, key: row.key, signed: [base64(txs[0]), "%%%"] }, deps)).code, "CARE_SIGNED", "a batch with an unreadable one sends none");
  assert.equal((await relayStop({ owner: STRANGER, key: row.key, signed: txs.map(base64) }, deps)).code, "CARE_UNKNOWN");
  assert.equal(connection.sent.length, 0);

  /* The agent moved the position between the review and the signature: the exit's simulation fails, nothing after it goes. */
  connection.refuse = 0;
  const raced = await relayStop({ owner: PERSON, key: row.key, signed: txs.map(base64) }, deps);
  assert.equal(raced.code, "CARE_RELAY");
  assert.equal(connection.sent.length, 0);
  assert.equal((await store.collection(CARE_BOOK).get(row.key)).status, "stopped", "a failed relay never brings the agent back");
  connection.refuse = null;

  /* Sent while the policies still stand (the policies' transaction not yet in): the care works on. */
  const first = await relayStop({ owner: PERSON, key: row.key, signed: [base64(txs[0])] }, deps);
  assert.deepEqual(first, { ok: true, signatures: ["sig1"], stopped: false });
  assert.equal((await store.collection(CARE_BOOK).get(row.key)).status, "stopped");

  /* The policies' transaction lands: the chain carries them no more — stopped. */
  connection.policies.live = false;
  const second = await relayStop({ owner: PERSON, key: row.key, signed: [base64(txs[1])] }, deps);
  assert.equal(second.stopped, true);
  const stopped = await store.collection(CARE_BOOK).get(row.key);
  assert.equal(stopped.status, "stopped");
  /* The last of the stop — the vault emptied — still goes after it. */
  assert.equal((await relayStop({ owner: PERSON, key: row.key, signed: [base64(txs[2])] }, deps)).ok, true);
});

/* ------------------------------------------------------------------ the keeper, through the door */

const KEEPER_ENV = Object.freeze({ RYNTRA_EARN_PRO: "devnet", RYNTRA_EARN_PRO_STOCKS: "open", RYNTRA_AGENT_CARE: "devnet", RYNTRA_AGENT_CARE_AGENT: AGENT, RYNTRA_STOCK_KEEPER: "devnet" });

function keeperWorld() {
  const POOL = key();
  const NFT = key();
  const STOCK = key();
  const SOL = "So11111111111111111111111111111111111111112";
  const state = { delegate: AGENT, endCare: 0, approve: 0 };
  const signedWire = () => base64(wireOf());
  const venue = {
    pools: { read: async (address) => (address === POOL ? { address: POOL, tokenX: { mint: STOCK, decimals: 9, reserve: key() }, tokenY: { mint: SOL, decimals: 9, reserve: key() }, price: 2.5, fee: { totalBps: 80 }, tickSpacing: 10, tickId: 0, rewards: [], open: { addLiquidity: { open: true } }, paused: { deposits: false } } : null) },
    earn: {
      care: async ({ agent }) => ({ delegate: state.delegate, may: ["removeLiquidity", "claimFee", "claimReward"], cares: state.delegate === agent }),
      income: async () => ({ position: { pool: POOL, nftMint: NFT, slots: [], xRaw: "4000000000", yRaw: "10000000000", feeXRaw: "0", feeYRaw: "0" }, inRange: true, fees: { xRaw: "0", yRaw: "0" }, rewards: [] }),
      endCare: async () => ((state.endCare += 1), { wireBase64: signedWire() }),
    },
    range: { approve: async (request) => ((state.approve += 1), { wireBase64: signedWire(), rentLamports: 0, rentReturnedLamports: 0, unwrapsLamports: null, rights: [], approval: request.approval }) },
  };
  const sent = [];
  const connection = {
    getGenesisHash: async () => DEVNET_GENESIS,
    getAccountInfo: async () => null,
    getMultipleAccountsInfo: async (keys) => keys.map(() => null),
    /* The chain applies what the person signed: once her stop lands, the agent's approval is gone. */
    sendRawTransaction: async (bytes) => (sent.push(bytes), (state.landStop ? (state.delegate = null) : null), `sig${sent.length}`),
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    confirmTransaction: async () => ({ value: { err: null } }),
  };
  const store = createMemoryGuardStore();
  const shelf = async (mints) => new Map(mints.filter((mint) => mint === STOCK).map((mint) => [mint, { mint, symbol: "ANT", issuer: "Backpack Securities" }]));
  const deps = { env: KEEPER_ENV, venue, store, connection, stocks: shelf, now: () => 1_000, key: { mode: "env", keyRef: null, sign: async () => new Uint8Array(64) } };
  return { POOL, NFT, state, sent, store, deps, actions: keeperActions(deps) };
}

test("keeper: another wallet's review never overwrites the person's pending one, and her signature still lands", async () => {
  const { prove } = proveLike();
  const { POOL, NFT, store, sent, actions } = keeperWorld();
  const door = (body, wallet) => answerCareDoor(requestOf(body, wallet ? { cookie: `rw=${wallet}` } : {}), actions, { closed: "KEEPER_CLOSED", prove });

  const review = await (await door({ action: "review", owner: PERSON, pool: POOL, nftMint: NFT, choice: DEFAULT_KEEPER_CHOICE }, PERSON)).json();
  assert.equal(review.ok, true);
  const pending = (await store.collection(CARE_BOOK).get(review.key)).pending;

  /* The stranger names her wallet: refused at the door, whether proven as himself or with no proof at all. */
  assert.equal((await door({ action: "review", owner: PERSON, pool: POOL, nftMint: NFT, choice: { ...DEFAULT_KEEPER_CHOICE, width: "wide" } }, STRANGER)).status, 403);
  assert.equal((await door({ action: "review", owner: PERSON, pool: POOL, nftMint: NFT, choice: { ...DEFAULT_KEEPER_CHOICE, width: "wide" } })).status, 401);
  assert.deepEqual((await store.collection(CARE_BOOK).get(review.key)).pending, pending, "her pending bounds stand");

  const submitted = await door({ action: "submit", owner: PERSON, key: review.key, signed: review.transactions }, PERSON);
  assert.equal(submitted.status, 200);
  assert.equal((await store.collection(CARE_BOOK).get(review.key)).status, "working");
  assert.equal(sent.length, 1);
});

test("keeper: a stop asked by anyone but the proven owner does nothing; hers builds, and the row stops only once the chain shows it", async () => {
  const { prove } = proveLike();
  const { NFT, state, store, actions } = keeperWorld();
  const door = (body, headers) => answerCareDoor(requestOf(body, headers), actions, { closed: "KEEPER_CLOSED", prove });
  const k = keeperKey("devnet", PERSON, NFT);
  const working = { v: 1, kind: "stock-keeper", key: k, network: "devnet", owner: PERSON, pool: "p", nftMint: NFT, agent: AGENT, choice: DEFAULT_KEEPER_CHOICE, limits: {}, plan: "leave", approval: null, status: "working", stoppedBy: null, confirmed: true, pending: null, openSeenAt: null, history: [], waiting: null, hours: null, shape: null, wait: null, lastClaimAt: null, events: [], createdAt: 1, updatedAt: 1 };
  await store.collection(CARE_BOOK).set(k, working);

  /* The key is guessable — `k:<network>:<owner>:<nft>` — and it no longer matters. */
  assert.equal((await door({ action: "stop", owner: PERSON, key: k }, { "sec-fetch-site": "same-origin" })).status, 401, "forged Origin, no proof");
  assert.equal((await door({ action: "stop", owner: PERSON, key: k }, { cookie: `rw=${STRANGER}` })).status, 403, "another wallet");
  assert.equal((await door({ action: "stop", owner: STRANGER, key: k }, { cookie: `rw=${STRANGER}` })).status, 409, "his own wallet: not his keeper");
  assert.deepEqual(await store.collection(CARE_BOOK).get(k), working);
  assert.equal(state.endCare, 0);

  const built = await (await door({ action: "stop", owner: PERSON, key: k }, { cookie: `rw=${PERSON}` })).json();
  assert.equal(built.ok, true);
  assert.equal((await store.collection(CARE_BOOK).get(k)).status, "working", "built, not signed: the keeper works on");

  /* Her signed stop lands: the chain shows the agent's approval gone — only now is the row stopped. */
  state.landStop = true;
  const signed = built.transactions;
  const relayed = await (await door({ action: "relay", owner: PERSON, key: k, signed }, { cookie: `rw=${PERSON}` })).json();
  assert.equal(relayed.stopped, true);
  const after = await store.collection(CARE_BOOK).get(k);
  assert.equal(after.status, "stopped");
  assert.equal(after.stoppedBy, "owner");
});

test("the agent's pass never writes over the owner's stop: a stop that lands before or during the step stays «stopped»", async () => {
  const store = createMemoryGuardStore();
  const before = careRow();
  await store.collection(CARE_BOOK).set(before.key, before);
  const connection = careChain();
  /* The stop lands while the pass is already at work on the row it read. */
  const during = await careMinute(CARE_ENV, {
    store,
    connection,
    keyed: true,
    now: () => 20,
    step: async (entry) => {
      await store.collection(CARE_BOOK).set(entry.key, { ...entry, status: "stopped", updatedAt: 19 });
      return { ...entry, updatedAt: 20 };
    },
  });
  assert.equal(during.acted, 0);
  assert.equal((await store.collection(CARE_BOOK).get(before.key)).status, "stopped");
});
