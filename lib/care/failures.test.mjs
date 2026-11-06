// CITY-203 · прохід збоїв на рівні двигуна (без ланцюга): два тики одночасно, RPC упав, політику знято або вона
// скінчилась, позиція без ліквідності. Збої на ланцюгу (ціна посеред перебудови, порожній пул, політика вичерпана) —
// `scripts/care/devnet-pass.mjs failures` на форку mainnet; таблиця — REPORT.md §3.4.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Keypair, PublicKey } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "../mandate/ssa.ts";
import { decide } from "./decide.ts";
import { planCareEnable } from "./enable.ts";
import { careAct } from "./run.server.ts";
import { CARE_BOOK, CARE_TICK_MS, careMinute, careToJson, claimTick } from "./service.server.ts";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const agent = Keypair.generate().publicKey;
const ENV = { RYNTRA_AGENT_CARE: "devnet", RYNTRA_AGENT_CARE_AGENT: agent.toBase58() };
const now = Math.floor(Date.now() / 1000);

function aCare(expiresIn = 30 * 86_400) {
  const terms = {
    human: Keypair.generate().publicKey,
    agent,
    pool: { kind: "dlmm", address: Keypair.generate().publicKey, mintX: Keypair.generate().publicKey, mintY: NATIVE_MINT, programX: TOKEN_PROGRAM_ID, programY: TOKEN_PROGRAM_ID },
    fees: "reinvest",
    rebalance: true,
    stopBelow: null,
    expiresAt: BigInt(now + expiresIn),
  };
  return planCareEnable({ cluster: "devnet", terms, account: { kind: "absent", config: { smartAccountIndex: 9n, creationFee: 0n, treasury: Keypair.generate().publicKey } }, fund: { x: 0n, y: 1n }, decimals: { x: 6, y: 9 }, nowSeconds: BigInt(now) }).care;
}

async function bookWith(entries) {
  const store = createMemoryGuardStore();
  for (const care of entries) {
    const json = careToJson(care);
    const key = `c:devnet:${json.owner}:${json.vaultIndex}`;
    await store.collection(CARE_BOOK).set(key, { v: 1, key, care: json, status: "working", messages: [], width: 24, position: null, outOfRangeSince: null, lastRebalanceAt: null, lastClaimAt: null, events: [], createdAt: 0, updatedAt: 0 });
  }
  return store;
}

const devnet = { getGenesisHash: async () => DEVNET_GENESIS };

test("two ticks at once: each care is worked once in its window, never twice", async () => {
  const store = await bookWith([aCare(), aCare()]);
  const calls = [];
  const step = async (row) => {
    calls.push(row.key);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { ...row, updatedAt: 1 };
  };
  const t = 1_800_000_000_000;
  const [a, b] = await Promise.all([careMinute(ENV, { store, connection: devnet, now: () => t, step, keyed: true }), careMinute(ENV, { store, connection: devnet, now: () => t, step, keyed: true })]);
  assert.equal(calls.length, 2, "two cares, one step each");
  assert.equal(new Set(calls).size, 2);
  assert.equal(a.acted + b.acted, 2);
  assert.equal(a.skipped + b.skipped, 2);
  /* The next window works them again. */
  await careMinute(ENV, { store, connection: devnet, now: () => t + CARE_TICK_MS, step, keyed: true });
  assert.equal(calls.length, 4);
  assert.equal(await claimTick(store, "c:x", t), true);
  assert.equal(await claimTick(store, "c:x", t + 1), false);
});

test("RPC down: one care's failure never stops the others, nothing is written for it", async () => {
  const care = aCare();
  const store = await bookWith([care, aCare()]);
  let n = 0;
  const step = async (row) => {
    n += 1;
    if (n === 1) throw new Error("fetch failed");
    return { ...row, updatedAt: 7 };
  };
  const result = await careMinute(ENV, { store, connection: devnet, now: () => 1_900_000_000_000, step, keyed: true });
  assert.equal(result.acted, 1);
  const rows = await store.collection(CARE_BOOK).valuesWithPrefix("c:devnet:");
  assert.equal(rows.filter((row) => row.updatedAt === 7).length, 1);
  assert.equal(rows.filter((row) => row.updatedAt === 0).length, 1, "the failed care is read again next time, unchanged");
  /* The network itself not answering: the pass does nothing at all. */
  const down = { getGenesisHash: async () => Promise.reject(new Error("ECONNREFUSED")) };
  assert.deepEqual(await careMinute(ENV, { store, connection: down, step, keyed: true }), { ran: false, reason: "not the gate's network" });
});

test("the agent's action when the RPC fails, the policy is gone or the care ran out: nothing is signed or sent twice", async () => {
  const care = aCare();
  const build = { policy: "exit", setup: [], inner: [], constraintIndices: [], extraSigners: [] };
  const never = { publicKey: agent, signMessage: async () => assert.fail("the agent must not sign") };
  /* Policy removed by the person: refused before the key, no fee paid. */
  const stopped = { getAccountInfo: async () => null };
  assert.deepEqual(await careAct({ connection: stopped, care, signer: never, build }), { status: "refused-by-agent", reason: "the care was stopped" });
  /* The care ran out: refused before anything is read. */
  const ended = { ...care, terms: { ...care.terms, expiresAt: BigInt(now - 1) } };
  assert.deepEqual(await careAct({ connection: stopped, care: ended, signer: never, build }), { status: "refused-by-agent", reason: "the care has ended" });
  /* RPC down mid-way: the error surfaces to the pass (which skips this care), nothing was signed. */
  const flaky = { getAccountInfo: async () => ({ owner: PublicKey.default, data: new Uint8Array() }), getMultipleAccountsInfo: async () => [], getLatestBlockhash: async () => Promise.reject(new Error("fetch failed")) };
  await assert.rejects(careAct({ connection: flaky, care, signer: never, build }), /fetch failed/);
});

test("a pool without liquidity, fees at zero, a price beyond the stop: the decision for each", () => {
  const t = 1_000_000;
  const base = { kind: "dlmm", price: 1, activeBin: 0, lowerBin: -5, upperBin: 5, feesInY: 0, txCostInY: 0.00002, hasLiquidity: false, outOfRangeSince: null, lastRebalanceAt: null, lastClaimAt: null };
  const choice = { fees: "reinvest", rebalance: true, stopBelow: 0.5 };
  assert.deepEqual(decide(base, choice, t), { kind: "wait", reason: "empty" });
  assert.deepEqual(decide({ ...base, hasLiquidity: true }, choice, t), { kind: "wait", reason: "in-range" });
  assert.deepEqual(decide({ ...base, hasLiquidity: true, price: 0.4 }, choice, t), { kind: "exit", reason: "stop" });
  /* Out of range and below the stop at once: the stop wins, the agent never rebalances into a fall. */
  assert.deepEqual(decide({ ...base, hasLiquidity: true, price: 0.4, activeBin: -20, outOfRangeSince: 0 }, choice, t), { kind: "exit", reason: "stop" });
});
