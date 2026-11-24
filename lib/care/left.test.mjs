// «Зупинено, не забрано»: запис догляду «stopped» лишається в стані двигуна з ознакою `left`, поки ланцюг
// тримає його політики чи гроші сховища (ретрансляція стопу впала, стоп не доведено). Усе повернуто — `left: false`, і вікно
// його ховає, як раніше. Ланцюг мовчить — `null`, без здогадки. Лише читання: нічого не будується й не надсилається.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Keypair } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { ownTokenAccount } from "./enable.ts";
import { CARE_BOOK, careFromJson, careLeftOnChain, careStatus } from "./service.server.ts";

const key = () => Keypair.generate().publicKey.toBase58();
const PERSON = key();
const AGENT = key();
const CARE_ENV = Object.freeze({ RYNTRA_AGENT_CARE: "devnet", RYNTRA_AGENT_CARE_AGENT: AGENT });
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function careRow(index, status = "stopped") {
  const k = `c:devnet:${PERSON}:${index}`;
  return {
    v: 1,
    key: k,
    care: {
      cluster: "devnet",
      owner: PERSON,
      settings: key(),
      vaultIndex: index,
      vault: key(),
      exitPolicy: key(),
      tendPolicy: key(),
      exitSeed: "1",
      tendSeed: "2",
      pool: { kind: "dlmm", address: key(), mintX: key(), mintY: "So11111111111111111111111111111111111111112", programX: TOKEN, programY: TOKEN },
      fees: "reinvest",
      rebalance: true,
      stopBelow: null,
      expiresAt: "9999999999",
      agent: AGENT,
    },
    status,
    messages: [],
    width: 24,
    shape: "spot",
    position: null,
    outOfRangeSince: null,
    lastRebalanceAt: null,
    lastClaimAt: null,
    events: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

/** The chain: the accounts it carries, by address; every read of it counted. */
function chainWith(present = new Set()) {
  const reads = [];
  return {
    reads,
    present,
    getMultipleAccountsInfo: async (keys) => {
      reads.push(keys.length);
      return keys.map((one) => (present.has(one.toBase58()) ? { data: new Uint8Array(8), owner: Keypair.generate().publicKey, lamports: 1, executable: false } : null));
    },
  };
}

const accountsOf = (row) => {
  const care = careFromJson(row.care);
  return {
    exitPolicy: row.care.exitPolicy,
    tendPolicy: row.care.tendPolicy,
    vault: row.care.vault,
    coinX: ownTokenAccount(care.vault, care.terms.pool.mintX, care.terms.pool.programX).toBase58(),
    coinY: ownTokenAccount(care.vault, care.terms.pool.mintY, care.terms.pool.programY).toBase58(),
  };
};

test("a stopped care is left while the chain carries any of it: a policy, the vault's SOL, a coin account of the vault", async () => {
  for (const part of ["exitPolicy", "tendPolicy", "vault", "coinX", "coinY"]) {
    const row = careRow(1);
    const chain = chainWith(new Set([accountsOf(row)[part]]));
    assert.deepEqual(await careLeftOnChain(chain, [careFromJson(row.care)]), [true], part);
  }
  const back = careRow(2);
  assert.deepEqual(await careLeftOnChain(chainWith(), [careFromJson(back.care)]), [false], "nothing of it on chain: all back");
  assert.deepEqual(await careLeftOnChain(chainWith(), []), [], "no stopped care: no read");
});

test("the chain silent or short — not read, never a guess; many cares in reads of a hundred accounts", async () => {
  const rows = [careRow(1), careRow(2)].map((row) => careFromJson(row.care));
  assert.deepEqual(await careLeftOnChain({ getMultipleAccountsInfo: async () => { throw new Error("fetch failed"); } }, rows), [null, null]);
  assert.deepEqual(await careLeftOnChain({ getMultipleAccountsInfo: async () => [null] }, rows), [null, null], "an answer that does not cover every account");
  assert.deepEqual(await careLeftOnChain({}, rows), [null, null], "a connection that cannot read");
  const many = Array.from({ length: 21 }, (_, index) => careRow(index + 1));
  const live = many[20];
  const chain = chainWith(new Set([accountsOf(live).vault]));
  const left = await careLeftOnChain(chain, many.map((row) => careFromJson(row.care)));
  assert.deepEqual(chain.reads, [100, 5], "105 accounts in two reads");
  assert.equal(left.filter(Boolean).length, 1);
  assert.equal(left[20], true, "the answer stays with its own care across the reads");
});

test("the status read says it: a stopped care with its policy alive is `left`, one all back is not — still without a proof", async () => {
  const store = createMemoryGuardStore();
  const live = careRow(1);
  const back = careRow(2);
  const signing = careRow(3, "signing");
  for (const row of [live, back, signing]) await store.collection(CARE_BOOK).set(row.key, row);
  const connection = chainWith(new Set([live.care.tendPolicy]));
  const status = await careStatus(PERSON, { env: CARE_ENV, store, connection, now: () => 10 });
  assert.equal(status.ok, true);
  const byKey = new Map(status.cares.map((care) => [care.key, care]));
  assert.equal(byKey.get(live.key).status, "stopped");
  assert.equal(byKey.get(live.key).left, true, "the relay of the stop failed: the window keeps it with «Withdraw»");
  assert.equal(byKey.get(back.key).left, false, "everything is back: the window hides it, as before");
  assert.equal(byKey.has(signing.key), false, "a care never signed is no care");
  assert.deepEqual(connection.reads, [10], "one read for both stopped cares");

  const silent = await careStatus(PERSON, { env: CARE_ENV, store, connection: { getMultipleAccountsInfo: async () => Promise.reject(new Error("429")) }, now: () => 10 });
  assert.deepEqual(silent.cares.map((care) => care.left), [null, null], "the chain silent: not read");
  /* Another wallet's status names none of the person's cares. */
  assert.deepEqual((await careStatus(key(), { env: CARE_ENV, store, connection, now: () => 10 })).cares, []);
});
