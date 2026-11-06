import { test } from "node:test";
import assert from "node:assert/strict";

import { Keypair } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { careWorth } from "../care/worth.ts";
import { entryKey } from "./book.server.ts";
import { MAINNET_GENESIS } from "./service.server.ts";
import { leadMandate, MANDATES_SHOWN, ownedEntries, ownerMandate, tokenAmountOf, UNREAD } from "./owner.ts";
import { agentsOfOwner, agentsOpen, chainNow } from "./owner.server.ts";

/* CITY-207 — a wallet's agents from the engine, not from the browser that signed them. */

const key = () => Keypair.generate().publicKey.toBase58();
const HUMAN = key();
const STRANGER = key();
const AGENT = key();
const POOL = key();
const DEVNET_ENV = { RYNTRA_AGENT_MANDATE: "devnet", RYNTRA_AGENT_MANDATE_POOL: POOL, RYNTRA_AGENT_MANDATE_AGENT: AGENT };

const record = (owner, extra = {}) => ({ owner, settings: key(), vault: key(), policy: key(), budget: key(), perTrade: "50000000", perDay: "200000000", expiresAt: "1900000000", ...extra });

const entry = (cluster, owner, extra = {}) => ({
  v: 1,
  cluster,
  record: record(owner),
  preset: "medium",
  strategy: "steady",
  plan: "steady",
  said: null,
  receiveMint: key(),
  status: "working",
  trades: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  ...extra,
});

const trade = (spent, received, status = "ok") => ({ at: 1, status, signature: null, spentRaw: String(spent), receivedRaw: received === null ? null : String(received) });

/** A token account's bytes: 64 bytes of mint and owner, then the amount, u64 little-endian. */
function tokenAccount(amount) {
  const data = new Uint8Array(165);
  let left = BigInt(amount);
  for (let i = 0; i < 8; i += 1) {
    data[64 + i] = Number(left & 0xffn);
    left >>= 8n;
  }
  return { data, owner: null, lamports: 0, executable: false };
}

async function storeWith(rows) {
  const store = createMemoryGuardStore();
  for (const row of rows) await store.collection("agentMandates").set(entryKey(row.cluster, row.record.policy), row);
  return store;
}

test("a token account's amount is read from its bytes; anything shorter is not one", () => {
  assert.equal(tokenAmountOf(tokenAccount(123_456_789n).data), "123456789");
  assert.equal(tokenAmountOf(tokenAccount(2n ** 64n - 1n).data), "18446744073709551615");
  assert.equal(tokenAmountOf(new Uint8Array(40)), null);
  assert.equal(tokenAmountOf(null), null);
});

test("a wallet sees only its own mandates, the newest first, at most a handful", () => {
  const mine = Array.from({ length: MANDATES_SHOWN + 2 }, (_, i) => entry("devnet", HUMAN, { createdAt: 1_000 + i }));
  const rows = ownedEntries([...mine, entry("devnet", STRANGER, { createdAt: 9_999 })], HUMAN);
  assert.equal(rows.length, MANDATES_SHOWN);
  assert.ok(rows.every((row) => row.record.owner === HUMAN));
  assert.deepEqual(rows.map((row) => row.createdAt), [1_006, 1_005, 1_004, 1_003, 1_002]);
});

test("what is at work counts the done trades only; a removed policy is a stop whatever the book says", () => {
  const e = entry("mainnet", HUMAN, { trades: [trade(10, 300), trade(20, 700), trade(99, null, "failed")] });
  const live = ownerMandate(e, { budgetLamports: "70", live: true }, e.record.policy);
  assert.equal(live.spentLamports, "30");
  assert.equal(live.boughtRaw, "1000");
  assert.equal(live.trades, 2);
  assert.equal(live.active, true);
  assert.equal(live.pilot, true);
  assert.equal(live.budgetLamports, "70");
  assert.equal(ownerMandate(e, { budgetLamports: "0", live: false }, null).active, false);
  /* An unread chain leaves the book's word: the window still shows the agent at work, and never a zero for the budget. */
  const unread = ownerMandate(e, UNREAD, null);
  assert.equal(unread.active, true);
  assert.equal(unread.budgetLamports, null);
  assert.equal(ownerMandate({ ...e, status: "stopped" }, { budgetLamports: "0", live: true }, null).active, false);
  assert.equal(ownerMandate({ ...e, status: "paused" }, { budgetLamports: "5", live: true }, null).active, true);
});

test("the mandate a wallet sees first is one at work, else the newest", () => {
  const a = ownerMandate(entry("devnet", HUMAN, { status: "stopped", createdAt: 3 }), UNREAD, null);
  const b = ownerMandate(entry("devnet", HUMAN, { createdAt: 2 }), UNREAD, null);
  assert.equal(leadMandate([a, b]), b);
  assert.equal(leadMandate([a]), a);
  assert.equal(leadMandate([]), null);
});

test("one batched chain read: a policy it does not have is removed, a budget account it does not have is zero", async () => {
  const entries = [entry("devnet", HUMAN), entry("devnet", HUMAN)];
  const asked = [];
  const connection = {
    getGenesisHash: async () => "devnet-genesis",
    getMultipleAccountsInfo: async (keys) => {
      asked.push(keys.map((k) => k.toBase58()));
      return [tokenAccount(1n), tokenAccount(42n), null, null];
    },
  };
  /* Devnet's own check is the devnet module's: a stand-in connection that is not devnet reads nothing. */
  const notDevnet = await chainNow(entries, "devnet", connection);
  assert.deepEqual(notDevnet, [UNREAD, UNREAD]);
  const mainnet = { ...connection, getGenesisHash: async () => MAINNET_GENESIS };
  const read = await chainNow(entries, "mainnet", mainnet);
  assert.deepEqual(read, [
    { live: true, budgetLamports: "42" },
    { live: false, budgetLamports: "0" },
  ]);
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0], [entries[0].record.policy, entries[0].record.budget, entries[1].record.policy, entries[1].record.budget]);
});

test("a chain that does not answer leaves every figure unknown, never zero", async () => {
  const entries = [entry("mainnet", HUMAN)];
  const failing = { getGenesisHash: async () => MAINNET_GENESIS, getMultipleAccountsInfo: async () => { throw new Error("429"); } };
  assert.deepEqual(await chainNow(entries, "mainnet", failing), [UNREAD]);
  const slow = { getGenesisHash: async () => MAINNET_GENESIS, getMultipleAccountsInfo: () => new Promise(() => {}) };
  assert.deepEqual(await chainNow(entries, "mainnet", slow, 30), [UNREAD]);
  assert.deepEqual(await chainNow(entries, "mainnet", null), [UNREAD]);
});

test("the wallet's agents: mainnet and devnet apart, the autopilot and the cares beside, a stranger's never", async () => {
  const devnet = entry("devnet", HUMAN, { createdAt: 5 });
  const mainnet = entry("mainnet", HUMAN, { createdAt: 6, trades: [trade(1_000, 50)] });
  const stranger = entry("mainnet", STRANGER, { createdAt: 7 });
  const store = await storeWith([devnet, mainnet, stranger]);
  await store.collection("moneyPilots").set(`p:mainnet:${HUMAN}`, { v: 1, cluster: "mainnet", owner: HUMAN, status: "working", policy: mainnet.record.policy, createdAt: 8 });
  const care = (status, owner = HUMAN) => ({ v: 1, key: `c:devnet:${owner}:${status}`, status, care: { owner, vault: key(), pool: { address: key() } }, createdAt: 9 });
  for (const row of [care("working"), care("signing"), care("stopped", STRANGER)]) await store.collection("agentCare").set(row.key, row);

  const agents = await agentsOfOwner(HUMAN, { env: { ...DEVNET_ENV, RYNTRA_AGENT_CARE: "devnet", RYNTRA_AGENT_CARE_AGENT: AGENT }, store, connection: () => null });
  assert.equal(agents.owner, HUMAN);
  assert.deepEqual(agents.networks.devnet.open, { mandate: true, pilot: false, care: true });
  assert.deepEqual(agents.networks.mainnet.open, { mandate: false, pilot: false, care: false });
  assert.deepEqual(agents.networks.devnet.mandates.map((m) => m.record.policy), [devnet.record.policy]);
  assert.deepEqual(agents.networks.mainnet.mandates.map((m) => m.record.policy), [mainnet.record.policy]);
  assert.equal(agents.networks.mainnet.mandates[0].pilot, true);
  assert.equal(agents.networks.mainnet.mandates[0].spentLamports, "1000");
  assert.equal(agents.networks.mainnet.mandates[0].budgetLamports, null, "an unread chain is unknown, not zero");
  assert.deepEqual(agents.networks.mainnet.pilot, { status: "working", policy: mainnet.record.policy, createdAt: 8 });
  assert.equal(agents.networks.devnet.pilot, null);
  assert.deepEqual(agents.networks.devnet.cares.map((c) => c.status), ["working"]);
  assert.equal(agents.networks.mainnet.cares.length, 0);
  assert.ok(agents.networks.devnet.read && agents.networks.mainnet.read);
  assert.ok(!JSON.stringify(agents).includes(STRANGER), "a stranger's mandate never reaches the answer");
});

test("a book that does not answer says so: the lists are empty and `read` is false", async () => {
  const broken = { collection: () => ({ valuesWithPrefix: async () => { throw new Error("down"); }, get: async () => { throw new Error("down"); } }) };
  const agents = await agentsOfOwner(HUMAN, { env: DEVNET_ENV, store: broken, connection: () => null });
  assert.equal(agents.networks.devnet.read, false);
  assert.equal(agents.networks.devnet.mandates.length, 0);
});

test("the route exists only where the agent's budget or its care is open", () => {
  assert.equal(agentsOpen({}), false);
  assert.equal(agentsOpen({ RYNTRA_AGENT_MANDATE: "devnet" }), false, "devnet without its pool and agent stays shut");
  assert.equal(agentsOpen(DEVNET_ENV), true);
  assert.equal(agentsOpen({ RYNTRA_AGENT_CARE: "devnet", RYNTRA_AGENT_CARE_AGENT: AGENT }), true);
});

/* ---------------------------------------------------------------- the care's dollars */

const SOL = "So11111111111111111111111111111111111111112";
const COIN = key();
const RECORD = { x: { mint: COIN, decimals: 6, priceUsd: 0.5 }, y: { mint: SOL, decimals: 9, priceUsd: 200 } };
const HOLDS = { mintX: COIN, mintY: SOL, holdsX: 2_000_000n, holdsY: 1_500_000_000n, feeX: 1_000_000n, feeY: 10_000_000n };

test("a looked-after position is worth its sides at the venue's prices, fees apart", () => {
  const worth = careWorth(HOLDS, RECORD);
  assert.equal(worth.valueUsd, 2 * 0.5 + 1.5 * 200);
  assert.equal(worth.unclaimedUsd, 1 * 0.5 + 0.01 * 200);
  /* The record's sides in the other order: matched by mint, not by place. */
  assert.deepEqual(careWorth(HOLDS, { x: RECORD.y, y: RECORD.x }), worth);
});

test("without a price — no record, a side unpriced, decimals unknown, another pool's mints — the worth is unknown, never zero", () => {
  const none = { valueUsd: null, unclaimedUsd: null };
  assert.deepEqual(careWorth(HOLDS, null), none);
  assert.deepEqual(careWorth(HOLDS, { ...RECORD, x: { ...RECORD.x, priceUsd: null } }), none);
  assert.deepEqual(careWorth(HOLDS, { ...RECORD, y: { ...RECORD.y, decimals: null } }), none);
  assert.deepEqual(careWorth(HOLDS, { ...RECORD, x: { ...RECORD.x, mint: key() } }), none);
  assert.deepEqual(careWorth(HOLDS, { ...RECORD, x: { ...RECORD.x, priceUsd: Number.NaN } }), none);
});
