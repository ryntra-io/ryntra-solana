/* The copy with money at work: what it decides with the leader's trades, and how it acts on them — the order
   written down before it is sent, one order a minute, her freeze, the day's cap, the chain's answer read back before the
   next — its start (her coins asked as every buy asks them, the record checked against the chain) and her stop (every
   policy off, every coin home). The chain, the venue and the trade are the tests' own: no network, no real key. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { freezeKey } from "../mandate/freeze.server.ts";
import { planEnable, tokenAccountOf } from "../mandate/human.ts";
import { MAINNET_GENESIS } from "../mandate/service.server.ts";
import { NO_STOCKS } from "../mandate/stocks.server.ts";
import { uncataloguedFacts } from "../mandate/fee.ts";
import { NATIVE_MINT, SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, settingsSyncInstruction, ssaAddress } from "../mandate/ssa.ts";
import { COPY_COINS_PER_SALE, COPY_WORST_DAYS, copyBuySize, copyDailyMax, copySalePolicyOf, heldAccountOf, mandatePolicy } from "../mandate/terms.ts";
import { TOKEN_2022_PROGRAM_ID } from "../mandate/token-2022.ts";
import {
  COPY_ORDER_EVERY_MS,
  COPY_SALE_WINDOW_MS,
  COPY_SEEN_KEPT,
  COPY_DAY_ORDERS_MAX,
  COPY_ORDERS_KEPT,
  COPY_SLOT_MARGIN,
  copyActedKeys,
  copyCoinRoom,
  copyCoinSold,
  copyDaySpent,
  copyMandateOf,
  copyMoneyKey,
  copyRowOf,
  leaderCoins,
  leaderShareBps,
  nextCopySteps,
  pastCopyBound,
  unsettledOrder,
  withOrders,
} from "./copy-money.ts";
import { COPY_WORST_DAYS as SCREEN_WORST_DAYS } from "./copy-agent.ts";
import {
  COPY_PASS_LEASE_MS,
  COPY_PASS_MAX,
  COPY_PASS_MS,
  COPY_REVIEW_KEPT_MS,
  COPY_STOP_CLOSE_TRANSACTIONS,
  COPY_STOP_COIN_TRANSACTIONS,
  changeCopyRow,
  copyChainRefusal,
  copyPassKey,
  copyPassOrder,
  copyReviewKey,
  dropCopyLease,
  raceOf,
  readCopyRow,
  registerCopy,
  reviewCopyEnable,
  reviewCopyStop,
  runCopyMoneyPass,
  setCopyFrozen,
  takeCopyLease,
} from "./copy-money.server.ts";
import { WALLET_WATCH_COLLECTION } from "./store.ts";

const seeded = (name) => Keypair.fromSeed(createHash("sha256").update(`city-376 money ${name}`).digest()).publicKey;
const REAL = JSON.parse(readFileSync(new URL("../mandate/fixtures/token-2022-mints.json", import.meta.url), "utf8"));
const T0 = Date.parse("2026-11-21T10:00:00Z");
const human = seeded("human");
const agent = seeded("agent");
const leader = seeded("leader").toBase58();
const coinA = seeded("coin a");
const coinB = seeded("coin b");
const stranger = seeded("stranger coin");
const config = { smartAccountIndex: 5n, creationFee: 0n, treasury: seeded("treasury") };
const terms = (extra = {}) => ({
  human,
  agent,
  budgetMint: NATIVE_MINT,
  perTrade: 25_000_000n,
  perDay: 100_000_000n,
  slippageBps: 100,
  expiresAt: BigInt(Math.floor(T0 / 1000)) + 7n * 86_400n,
  venue: { kind: "jupiter" },
  copyCoins: [
    { mint: coinA, program: TOKEN_PROGRAM_ID, dailyMax: 8_000_000n },
    { mint: coinB, program: TOKEN_PROGRAM_ID, dailyMax: 3_000_000n },
  ],
  ...extra,
});
const plan = planEnable({ cluster: "mainnet", terms: terms(), account: { kind: "absent", config }, fund: 700_000_000n, nowSeconds: BigInt(Math.floor(T0 / 1000)), agentFeeLamports: 10_000_000n });
const mandate = plan.mandate;
const baseRow = copyRowOf({ mandate, leader, sharePct: 25, boundPct: 5, nowIso: new Date(T0).toISOString() });

let slot = 100;
/** One trade of the leader's, as the wallet watch reads it: SOL a whole coin of 6 decimals. */
const leaderTrade = (side, mint, extra = {}) => ({
  signature: `sig${(slot += 1)}`,
  slot,
  at: Math.floor(T0 / 1000) + 30,
  side,
  mint: mint.toBase58(),
  tokensRaw: "4000000",
  decimals: 6,
  quote: "SOL",
  quoteAmount: 0.1,
  paidBy: null,
  ...extra,
});

/* ------------------------------------------------------------- what it decides */

test("the record holds the mandate she signed; read back, it is that mandate — buy's policy, the sales', her coins", () => {
  const back = copyMandateOf(baseRow, agent);
  assert.equal(back.policy.toBase58(), mandate.policy.toBase58());
  assert.deepEqual(back.salePolicies.map(String), mandate.salePolicies.map(String));
  assert.deepEqual(back.terms.copyCoins.map((coin) => [coin.mint.toBase58(), coin.dailyMax]), [[coinA.toBase58(), 8_000_000n], [coinB.toBase58(), 3_000_000n]]);
  assert.equal(back.terms.slippageBps, 100, "every swap of a copy with 1 % at most");
  assert.deepEqual(mandatePolicy(back.terms, back), mandatePolicy(mandate.terms, mandate));
  assert.throws(() => copyRowOf({ mandate: { ...mandate, salePolicies: [] }, leader, sharePct: 25, boundPct: 5, nowIso: "x" }), /Not a copy's mandate/);
});

test("the leader's trades become steps: misses with their reasons up to the first order — a buy of her trade, or a sale of the leader's share", () => {
  const now = T0 + 60_000;
  const outside = leaderTrade("buy", stranger);
  const buyA = leaderTrade("buy", coinA);
  let steps = nextCopySteps(baseRow, [buyA, outside], now);
  assert.deepEqual(steps.map((step) => [step.kind, step.missed ?? null, step.trade.mint]), [["miss", "outside", stranger.toBase58()], ["buy", null, coinA.toBase58()]]);
  assert.equal(steps.at(-1).amount, 25_000_000n);
  /* The leader out of the coin already: never the copy's entry. */
  const sold = leaderTrade("sell", coinA, { tokensRaw: "4000000" });
  steps = nextCopySteps(baseRow, [buyA, sold], now);
  assert.equal(steps[0].missed, "exited");
  assert.equal(steps[1].kind, "sell");
  /* Late, ended, over the day. */
  assert.equal(nextCopySteps(baseRow, [leaderTrade("buy", coinA, { at: Math.floor(T0 / 1000) + 30 })], T0 + 11 * 60_000)[0].missed, "late");
  const ended = { ...baseRow, mandate: { ...baseRow.mandate, expiresAt: String(Math.floor(T0 / 1000) + 40) } };
  assert.equal(nextCopySteps(ended, [leaderTrade("buy", coinA, { at: Math.floor(T0 / 1000) + 50 })], T0 + 60_000)[0].missed, "ended");
  const spentDay = { ...baseRow, orders: [0, 1, 2, 3].map((i) => ({ key: `k${i}`, side: "buy", mint: coinA.toBase58(), at: T0, leaderAt: 0, dayN: 0, amountRaw: "25000000", status: "ok", signature: `s${i}`, receivedRaw: "1", reason: null })) };
  assert.equal(copyDaySpent(spentDay, 0), 100_000_000n);
  assert.equal(nextCopySteps(spentDay, [leaderTrade("buy", coinB)], now)[0].missed, "budget");
  /* A sale of a coin outside her set: nothing to do, nothing to say. Trades from before the start, or paid by another, are not copied. */
  assert.deepEqual(nextCopySteps(baseRow, [leaderTrade("sell", stranger)], now).map((step) => step.kind), ["nothing"]);
  assert.equal(nextCopySteps(baseRow, [leaderTrade("buy", coinA, { at: Math.floor(T0 / 1000) - 5 })], now).length, 0);
  assert.equal(nextCopySteps(baseRow, [leaderTrade("buy", coinA, { paidBy: human.toBase58() })], now).length, 0);
  /* Handled trades are not handled twice. */
  const seen = { ...baseRow, seen: [`${buyA.signature}:${buyA.mint}:buy`] };
  assert.equal(nextCopySteps(seen, [buyA], now).length, 0);
});

test("the leader's share of a sale, the bound against its own price, the coins the screen offers her", () => {
  const b1 = leaderTrade("buy", coinA, { tokensRaw: "1000" });
  const b2 = leaderTrade("buy", coinA, { tokensRaw: "3000" });
  const s1 = leaderTrade("sell", coinA, { tokensRaw: "1000" });
  assert.equal(leaderShareBps([b1, b2, s1], s1), 2_500);
  assert.equal(leaderShareBps([s1], s1), 10_000, "its buys not read: all of it");
  /* 0.1 SOL for 4 coins of 6 decimals: 25 000 lamports a base unit. Her 0.025 SOL now buys 950 000 units — 5.26 % dearer. */
  assert.equal(pastCopyBound(25_000_000n, 1_000_000n, 25, 5), false);
  assert.equal(pastCopyBound(25_000_000n, 950_000n, 25, 5), true);
  assert.equal(pastCopyBound(25_000_000n, 950_000n, 25, 15), false);
  assert.equal(pastCopyBound(25_000_000n, 1_000_000n, null, 15), true, "a price not known is not bought blind");
  const trades = [leaderTrade("buy", coinA), leaderTrade("buy", NATIVE_MINT), leaderTrade("buy", coinB), leaderTrade("sell", stranger), leaderTrade("buy", coinA)];
  assert.deepEqual(leaderCoins(trades), [coinA.toBase58(), coinB.toBase58()]);
});

/* ------------------------------------------------------------- the pass, on the tests' own chain */

const u64 = (n) => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(n));
  return out;
};
const tokenAccount = (mint, owner, amount) => ({ owner: TOKEN_PROGRAM_ID, data: Buffer.concat([mint.toBuffer(), owner.toBuffer(), u64(amount), Buffer.alloc(93)]), lamports: 2_039_280, executable: false });

/** A chain: accounts by address, transactions by signature, a block height. */
function chain(accounts = new Map()) {
  const policyInfo = { owner: SSA_PROGRAM_ID, data: Buffer.alloc(8), lamports: 1, executable: false };
  accounts.set(mandate.policy.toBase58(), policyInfo);
  for (const policy of mandate.salePolicies) accounts.set(policy.toBase58(), policyInfo);
  const landed = new Map();
  return {
    accounts,
    landed,
    height: 10,
    async getAccountInfo(key) {
      return accounts.get(key.toBase58()) ?? null;
    },
    async getMultipleAccountsInfo(keys) {
      return keys.map((key) => accounts.get(key.toBase58()) ?? null);
    },
    async getTransaction(signature) {
      const read = landed.get(signature);
      return read ? { meta: { err: read.ok ? null : { custom: 1 }, logMessages: read.logs ?? [], computeUnitsConsumed: 1, fee: 5000 } } : null;
    },
    async getBlockHeight() {
      return this.height;
    },
  };
}

/** A venue: her trade buys `units` of a coin now; the build is a token, the trade the tests' own. */
function venue(over = {}) {
  const calls = [];
  return {
    calls,
    async unitsFor(_m, coin, lamports) {
      calls.push(["units", coin.toBase58(), lamports]);
      return over.units ?? 1_000_000n;
    },
    async buy(m, amount, receiver, coin) {
      calls.push(["buy", coin.toBase58(), amount, receiver.toBase58()]);
      if (over.buyThrows) throw new Error(over.buyThrows);
      return { instruction: { tag: "buy" }, setup: [], promisedOut: 1n, feeSides: {} };
    },
    async sell(m, amount, coin) {
      calls.push(["sell", coin.toBase58(), amount]);
      return { instruction: { tag: "sell" }, setup: [], promisedOut: 1n, feeSides: {} };
    },
    async received() {
      return 990_000n;
    },
  };
}

const KEY = { mode: "env", keyRef: null, async sign() {
  throw new Error("the tests' trade signs nothing");
} };

async function bookWith(row = baseRow) {
  const store = createMemoryGuardStore();
  await store.versioned(WALLET_WATCH_COLLECTION).compareAndSet(copyMoneyKey("mainnet", row.mandate.policy), null, row);
  return store;
}

/** The tests' trade: writes down through `beforeSend` as the real one does, then the chain's answer — and notes what the book held at the send. */
function trader(store, answer = () => ({ status: "landed", ok: true })) {
  const sent = [];
  const trade = async (input) => {
    const signature = `copy-${sent.length + 1}`;
    const outcome = answer(input, signature);
    if (outcome.status === "refused-by-agent") {
      sent.push({ input, signature: null, booked: null });
      return outcome;
    }
    await input.beforeSend({ signature, validUntilHeight: 50 });
    const booked = await readCopyRow(store, "mainnet", baseRow.mandate.policy);
    sent.push({ input, signature, booked });
    if (outcome.status === "landed") return { status: "landed", signature, ok: outcome.ok, size: 900, computeUnits: 1, fee: 5000, ...(outcome.ok ? {} : { refusal: outcome.refusal ?? null }) };
    if (outcome.status === "unknown") return { status: "unknown", signature, size: 900, validUntilHeight: 50 };
    return outcome;
  };
  return { trade, sent };
}

const passDeps = (store, connection, v, trade, trades, now) => ({ store, cluster: "mainnet", connection, key: KEY, agent, journal: async () => {}, venue: v, readLeader: async () => trades(), now: () => now.at, trade, screen: { origin: async () => ({ launchedHere: false, creator: null }), ryntra: async () => new Set() } });

test("a buy of hers: written down with its signature before it is sent, into the vault's own account of the coin, read back as bought", async () => {
  const store = await bookWith();
  const connection = chain();
  const v = venue();
  const { trade, sent } = trader(store);
  const now = { at: T0 + 60_000 };
  const buyA = leaderTrade("buy", coinA);
  const lines = await runCopyMoneyPass(passDeps(store, connection, v, trade, () => [buyA], now));
  assert.deepEqual(lines, [{ policy: mandate.policy.toBase58(), did: "bought" }]);
  /* The book held the order — «sent», with its signature — when the trade went to the network. */
  const atSend = sent[0].booked.orders[0];
  assert.deepEqual([atSend.status, atSend.signature, atSend.side, atSend.amountRaw], ["sent", "copy-1", "buy", "25000000"]);
  assert.equal(v.calls.find((call) => call[0] === "buy")[3], heldAccountOf(mandate.vault, mandate.terms.copyCoins[0]).toBase58());
  assert.equal(sent[0].input.side, "buy");
  const after = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.deepEqual([after.orders[0].status, after.orders[0].receivedRaw], ["ok", "990000"]);
  assert.equal(after.lastOrderAt, now.at);
  assert.ok(after.seen.includes(`${buyA.signature}:${buyA.mint}:buy`));
});

test("one order a minute: the next waits its minute — the misses before it are written at once", async () => {
  const store = await bookWith();
  const connection = chain();
  const v = venue();
  const { trade, sent } = trader(store);
  const now = { at: T0 + 60_000 };
  const trades = [leaderTrade("buy", coinA), leaderTrade("buy", stranger), leaderTrade("buy", coinB)];
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, v, trade, () => trades, now)))[0].did, "bought");
  now.at += COPY_ORDER_EVERY_MS - 1;
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, v, trade, () => trades, now)))[0].did, "waited");
  assert.equal(sent.length, 1);
  const waiting = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.equal(waiting.orders[0].missed, "outside", "the coin she did not sign for, missed and said");
  now.at += 1;
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, v, trade, () => trades, now)))[0].did, "bought");
  assert.equal(sent.length, 2);
  assert.equal(sent[1].input.venueInstruction.tag, "buy");
});

test("lead's review of #1980: a record that does not take her freeze never leaves the switch off — the copy is frozen, and she hears it failed", async () => {
  const store = await bookWith();
  /* The copy's record refuses every write (lost races, a store that throws); the agents' switches still take theirs. */
  const stubborn = {
    ...store,
    versioned: (name) => {
      const inner = store.versioned(name);
      return { get: (...args) => inner.get(...args), list: (...args) => inner.list?.(...args), compareAndSet: async () => false };
    },
  };
  await assert.rejects(setCopyFrozen(stubborn, { cluster: "mainnet", owner: human.toBase58(), policy: mandate.policy.toBase58(), frozen: true }), /did not take/);
  assert.ok(await store.collection("agentMandates").get(freezeKey("mainnet", mandate.policy.toBase58())), "the switch is on all the same");
  const { trade, sent } = trader(store);
  const passed = await runCopyMoneyPass(passDeps(store, chain(), venue(), trade, () => [leaderTrade("buy", coinA)], { at: T0 + 60_000 }));
  assert.equal(passed[0].did, "frozen");
  assert.equal(sent.length, 0);
});

test("her freeze stops every new order — a switch not read too; off, the copy goes on", async () => {
  const store = await bookWith();
  const connection = chain();
  const { trade, sent } = trader(store);
  const now = { at: T0 + 60_000 };
  const trades = () => [leaderTrade("buy", coinA)];
  assert.deepEqual(await setCopyFrozen(store, { cluster: "mainnet", owner: human.toBase58(), policy: mandate.policy.toBase58(), frozen: true }), { ok: true, frozen: true });
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, trades, now)))[0].did, "frozen");
  assert.equal(sent.length, 0);
  assert.ok(await store.collection("agentMandates").get(freezeKey("mainnet", mandate.policy.toBase58())), "the same switch as every agent of hers");
  assert.deepEqual(await setCopyFrozen(store, { cluster: "mainnet", owner: seeded("someone else").toBase58(), policy: mandate.policy.toBase58(), frozen: false }), { ok: false, code: "NOT_FOUND" });
  await setCopyFrozen(store, { cluster: "mainnet", owner: human.toBase58(), policy: mandate.policy.toBase58(), frozen: false });
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, trades, now)))[0].did, "bought");
  /* A switch that cannot be read is never taken as off. */
  const blind = { ...store, collection: (name) => (name === "agentMandates" ? { get: async () => { throw new Error("down"); } } : store.collection(name)) };
  now.at += COPY_ORDER_EVERY_MS;
  assert.equal((await runCopyMoneyPass({ ...passDeps(store, connection, venue(), trade, () => [leaderTrade("buy", coinB)], now), store: blind }))[0].did, "frozen");
});

test("the day's cap counts every buy signed that day; past it a buy is missed as «budget» — the next day it buys again", async () => {
  const store = await bookWith();
  const connection = chain();
  const { trade, sent } = trader(store);
  const now = { at: T0 + 60_000 };
  for (let i = 0; i < 5; i += 1) {
    const buy = leaderTrade("buy", i % 2 ? coinB : coinA, { at: Math.floor(now.at / 1000) - 5 });
    await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [buy], now));
    now.at += COPY_ORDER_EVERY_MS;
  }
  assert.equal(sent.length, 4, "four trades of 0.025 SOL fill her 0.1 SOL day");
  const row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.equal(row.orders[0].missed, "budget");
  now.at = T0 + 86_400_000 + 60_000;
  await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [leaderTrade("buy", coinA, { at: Math.floor(now.at / 1000) - 5 })], now));
  assert.equal(sent.length, 5);
});

test("an order whose fate is not read holds every new one; the chain's answer is read back, never sent again", async () => {
  const store = await bookWith();
  const connection = chain();
  let answer = { status: "unknown" };
  const { trade, sent } = trader(store, () => answer);
  const now = { at: T0 + 60_000 };
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [leaderTrade("buy", coinA)], now)))[0].did, "bought");
  let row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.equal(unsettledOrder(row).signature, "copy-1");
  now.at += 2 * COPY_ORDER_EVERY_MS;
  answer = { status: "landed", ok: true };
  /* Not on chain yet and its blockhash still alive: it waits, and nothing new is built. */
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [leaderTrade("buy", coinB)], now)))[0].did, "waited");
  assert.equal(sent.length, 1);
  /* Landed: read back as bought, with what reached the vault. */
  connection.landed.set("copy-1", { ok: true });
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [leaderTrade("buy", coinB)], now)))[0].did, "settled");
  row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.deepEqual([row.orders.find((o) => o.signature === "copy-1").status, row.orders.find((o) => o.signature === "copy-1").receivedRaw], ["ok", "990000"]);
  /* Another never landed and its blockhash ended: «did not land», and its day's money is free again. */
  answer = { status: "unknown" };
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [leaderTrade("buy", coinB)], now)))[0].did, "bought");
  connection.height = 51;
  now.at += COPY_ORDER_EVERY_MS;
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [], now)))[0].did, "settled");
  row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.equal(row.orders.find((o) => o.signature === "copy-2").reason, "did not land");
  assert.equal(copyDaySpent(row, 0), 25_000_000n);
});

test("a refusal — the signer's, the chain's — is written with its reason and never retried; the minute counts", async () => {
  const store = await bookWith();
  const connection = chain();
  let answer = { status: "refused-by-agent", reason: "the copy buys only a coin she signed for" };
  const { trade, sent } = trader(store, () => answer);
  const now = { at: T0 + 60_000 };
  const buyA = leaderTrade("buy", coinA);
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [buyA], now)))[0].did, "refused");
  let row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.deepEqual([row.orders[0].status, row.orders[0].reason, row.lastOrderAt], ["refused", "the copy buys only a coin she signed for", now.at]);
  now.at += COPY_ORDER_EVERY_MS;
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [buyA], now)))[0].did, "idle", "the same trade is not tried again");
  answer = { status: "landed", ok: false, refusal: { code: "SlippageToleranceExceeded", reason: "the route gave less than its minimum" } };
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [leaderTrade("buy", coinB)], now)))[0].did, "failed");
  row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.deepEqual([row.orders[0].status, row.orders[0].reason], ["failed", "the route gave less than its minimum"]);
  assert.equal(copyDaySpent(row, 0), 0n, "a buy the chain refused spent nothing of her day");
  assert.equal(sent.length, 2);
});

test("her bound, the coin the agent does not trade, no route: each a miss with its reason, nothing sent", async () => {
  const store = await bookWith();
  const connection = chain();
  const { trade, sent } = trader(store);
  const now = { at: T0 + 60_000 };
  /* 0.1 SOL for 4 coins: 25 000 lamports a unit. 900 000 units for 0.025 SOL is 11 % dearer — past 5 %. */
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue({ units: 900_000n }), trade, () => [leaderTrade("buy", coinA)], now)))[0].did, "missed");
  let row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.equal(row.orders[0].missed, "drift");
  now.at += COPY_ORDER_EVERY_MS;
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue({ buyThrows: "the agent does not trade this coin: its issuer can take the coin out of any wallet" }), trade, () => [leaderTrade("buy", coinA)], now)))[0].did, "missed");
  row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.deepEqual([row.orders[0].missed, row.orders[0].reason], ["coin", "the agent does not trade this coin: its issuer can take the coin out of any wallet"]);
  now.at += COPY_ORDER_EVERY_MS;
  await runCopyMoneyPass(passDeps(store, connection, venue({ buyThrows: "Jupiter refused the route: no route" }), trade, () => [leaderTrade("buy", coinB)], now));
  row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.equal(row.orders[0].missed, "route");
  assert.equal(sent.length, 0);
});

test("a sale follows the leader's share of what the vault holds, under the sale's policy of that coin's group, the money to her", async () => {
  const store = await bookWith();
  const vaultB = heldAccountOf(mandate.vault, mandate.terms.copyCoins[1]);
  const connection = chain(new Map([[vaultB.toBase58(), tokenAccount(coinB, mandate.vault, 2_000_000n)]]));
  const v = venue();
  const { trade, sent } = trader(store);
  const now = { at: T0 + 60_000 };
  const b1 = leaderTrade("buy", coinB, { tokensRaw: "4000", at: Math.floor(T0 / 1000) - 100 });
  const s1 = leaderTrade("sell", coinB, { tokensRaw: "1000" });
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, v, trade, () => [b1, s1], now)))[0].did, "sold");
  assert.deepEqual(v.calls.find((call) => call[0] === "sell"), ["sell", coinB.toBase58(), 500_000n]);
  assert.equal(sent[0].input.side, "sell");
  assert.equal(sent[0].input.salePolicy.toBase58(), mandate.salePolicies[0].toBase58());
  /* A sale of a coin the vault holds none of: handled, nothing sent. */
  now.at += COPY_ORDER_EVERY_MS;
  const a = leaderTrade("sell", coinA);
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, v, trade, () => [a], now)))[0].did, "idle");
  assert.equal(sent.length, 1);
  assert.ok((await readCopyRow(store, "mainnet", mandate.policy.toBase58())).seen.includes(`${a.signature}:${a.mint}:sell`));
});

test("her buy's policy gone from the chain: the copy is stopped and left; a chain not read says nothing", async () => {
  const store = await bookWith();
  const connection = chain();
  connection.accounts.delete(mandate.policy.toBase58());
  const { trade, sent } = trader(store);
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [leaderTrade("buy", coinA)], { at: T0 + 60_000 })))[0].did, "stopped");
  assert.equal((await readCopyRow(store, "mainnet", mandate.policy.toBase58())).status, "stopped");
  assert.deepEqual(await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [], { at: T0 + 120_000 })), []);
  assert.equal(sent.length, 0);
  const other = await bookWith();
  const blind = { ...chain(), getAccountInfo: async () => { throw new Error("rpc down"); } };
  assert.equal((await runCopyMoneyPass(passDeps(other, blind, venue(), trade, () => [], { at: T0 + 60_000 })))[0].did, "unread");
});

test("the book takes each change by compare-and-set: a lost race is read again, never lost", async () => {
  const store = await bookWith();
  const first = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  await changeCopyRow(store, first, (row) => ({ ...row, seen: ["a"] }));
  const second = await changeCopyRow(store, first, (row) => ({ ...row, seen: [...row.seen, "b"] }));
  assert.deepEqual(second.seen, ["a", "b"]);
  assert.equal(second.version, 3);
});

/* ------------------------------------------------------------- start: the record against the chain */

/** A policy account as the program keeps it: its head (settings, seed, the agent its one signer) and then its rules. */
function policyAccount(seed, rules, signer = agent) {
  const head = Buffer.concat([Buffer.from([222, 135, 7, 163, 235, 177, 33, 68]), mandate.settings.toBuffer(), u64(seed), Buffer.alloc(1 + 8 + 8)]);
  const signers = Buffer.concat([Buffer.from([1, 0, 0, 0]), signer.toBuffer(), Buffer.from([7]), Buffer.from([1, 0])]);
  const body = settingsSyncInstruction({ settings: mandate.settings, rentPayer: human, signers: [human], policyAccounts: [ssaAddress.policy(mandate.settings, seed)], actions: [{ kind: "policyCreate", create: { seed, policy: rules, signers: [{ key: signer, permissions: 7 }], threshold: 1, start: null, expiresAt: mandate.terms.expiresAt } }] }).data;
  return { owner: SSA_PROGRAM_ID, data: Buffer.concat([head, signers, body]), lamports: 1, executable: false };
}
function settingsAccount() {
  const data = Buffer.alloc(8 + 16 + 32 + 2 + 4 + 8 + 8 + 1 + 8 + 1 + 4 + 33 + 1);
  Buffer.from([223, 179, 163, 190, 177, 224, 67, 173]).copy(data, 0);
  data.writeUInt16LE(1, 56);
  let at = 56 + 2 + 4 + 8 + 8 + 1 + 8 + 1;
  data.writeUInt32LE(1, at);
  human.toBuffer().copy(data, at + 4);
  data[at + 36] = 7;
  return { owner: SSA_PROGRAM_ID, data, lamports: 1, executable: false };
}
const onChain = (over = {}) => {
  const accounts = new Map([[mandate.settings.toBase58(), settingsAccount()], [mandate.policy.toBase58(), policyAccount(mandate.policySeed, mandatePolicy(mandate.terms, mandate))], [coinA.toBase58(), plainMintInfo()], [coinB.toBase58(), plainMintInfo()]]);
  mandate.salePolicies.forEach((policy, chunk) => accounts.set(policy.toBase58(), policyAccount(mandate.policySeed + 1n + BigInt(chunk), copySalePolicyOf(mandate.terms, mandate, chunk), over.signer)));
  return { getMultipleAccountsInfo: async (keys) => keys.map((key) => accounts.get(key.toBase58()) ?? null), accounts };
};

const plainMintInfo = (program = TOKEN_PROGRAM_ID) => {
  const data = Buffer.alloc(82);
  data[44] = 6;
  data[45] = 1;
  return { owner: program, data, lamports: 1, executable: false };
};

/** The review the server kept for her signature, as `reviewCopyEnable` keeps it. */
async function keptReview(store, row = baseRow, at = T0, review = "r1") {
  await store.versioned(WALLET_WATCH_COLLECTION).set(copyReviewKey(row.cluster, row.mandate.policy, review), { schema: "ryntra.wallet-watch.copy-review", version: 1, row, at });
  return { cluster: row.cluster, owner: row.owner, policy: row.mandate.policy, review };
}

test("a copy goes into the book only once its policies stand on chain for this agent — her day, her trade, her budget, each coin's day and program", async () => {
  assert.equal(await copyChainRefusal(baseRow, agent, onChain()), null);
  assert.match(await copyChainRefusal(baseRow, agent, onChain({ signer: seeded("other agent") })), /not for this agent/);
  const missing = onChain();
  missing.accounts.delete(mandate.salePolicies[0].toBase58());
  assert.match(await copyChainRefusal(baseRow, agent, missing), /not on chain/);
  const forged = { ...baseRow, mandate: { ...baseRow.mandate, coins: baseRow.mandate.coins.map((coin, i) => (i ? { ...coin, dailyMax: "999999999999" } : coin)) } };
  assert.match(await copyChainRefusal(forged, agent, onChain()), /does not name its coin's day/);
  /* The trade cap, the budget's account and each coin's program — against the chain too. */
  assert.match(await copyChainRefusal({ ...baseRow, mandate: { ...baseRow.mandate, perTrade: "99999999999" } }, agent, onChain()), /trade cap/);
  assert.match(await copyChainRefusal({ ...baseRow, mandate: { ...baseRow.mandate, budget: seeded("another account").toBase58() } }, agent, onChain()), /vault's own account/);
  const wrongMint = onChain();
  wrongMint.accounts.set(coinB.toBase58(), plainMintInfo(TOKEN_2022_PROGRAM_ID));
  assert.match(await copyChainRefusal(baseRow, agent, wrongMint), /not a mint of the program it names/);
  const noMint = onChain();
  noMint.accounts.delete(coinA.toBase58());
  assert.match(await copyChainRefusal(baseRow, agent, noMint), /not a mint of the program it names/);
});

test("only the record the server kept at review goes into the book — hers, standing on chain, at any age; its days count from then", async () => {
  const store = createMemoryGuardStore();
  const ask = await keptReview(store);
  const later = () => T0 + 120_000;
  /* Another wallet naming her review, a review never kept, one too old: none. */
  assert.match((await registerCopy({ ...ask, owner: seeded("someone else").toBase58() }, agent, { store, connection: onChain(), now: later })).reason, /review it again/);
  assert.match((await registerCopy({ ...ask, review: "nope" }, agent, { store, connection: onChain(), now: later })).reason, /review it again/);
  /* The chain not matching the kept record: refused, nothing written — said as too old once the review is. */
  const missing = onChain();
  missing.accounts.delete(mandate.policy.toBase58());
  assert.match((await registerCopy(ask, agent, { store, connection: missing, now: later })).reason, /not on chain/);
  assert.match((await registerCopy(ask, agent, { store, connection: missing, now: () => T0 + COPY_REVIEW_KEPT_MS + 1 })).reason, /too old/);
  assert.equal(await readCopyRow(store, "mainnet", mandate.policy.toBase58()), null);
  /* Her copy on chain, her start back an hour late (a wallet on her phone): taken — a funded copy is never left out for its age. */
  const late = () => T0 + 60 * 60_000;
  const joined = await registerCopy(ask, agent, { store, connection: onChain(), now: late });
  assert.equal(joined.ok, true);
  const booked = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.deepEqual([booked.status, booked.since], ["working", new Date(late()).toISOString()]);
  assert.deepEqual(booked.mandate, baseRow.mandate, "the very record the server built");
  assert.ok(!(await store.versioned(WALLET_WATCH_COLLECTION).get(copyReviewKey("mainnet", mandate.policy.toBase58(), "r1"))), "the review is used once");
  const again = await keptReview(store);
  assert.deepEqual(await registerCopy(again, agent, { store, connection: onChain(), now: later }), { ok: false, code: "REFUSED", reason: "The copy is in the book already." });
});

test("start: each coin she picked asked as every buy asks it — refused ones left out and said — then one approval", async () => {
  const PUMP = new PublicKey(REAL.mints.PUMP.address);
  const configData = Buffer.alloc(96);
  Buffer.from([196, 210, 90, 231, 144, 149, 140, 63]).copy(configData, 0);
  configData.writeBigUInt64LE(4n, 8);
  seeded("treasury").toBuffer().copy(configData, 64);
  /* A mint of Token: initialized, 6 decimals, no freeze authority. */
  const plainMint = () => {
    const data = Buffer.alloc(82);
    data[44] = 6;
    data[45] = 1;
    return { owner: TOKEN_PROGRAM_ID, data, lamports: 1, executable: false };
  };
  const mints = new Map([
    [coinA.toBase58(), plainMint()],
    [coinB.toBase58(), plainMint()],
    [PUMP.toBase58(), { owner: TOKEN_2022_PROGRAM_ID, data: Buffer.from(REAL.mints.PUMP.data, "base64"), lamports: 1, executable: false }],
    [ssaAddress.programConfig().toBase58(), { owner: SSA_PROGRAM_ID, data: configData, lamports: 1, executable: false }],
  ]);
  const connection = {
    getGenesisHash: async () => MAINNET_GENESIS,
    getAccountInfo: async (key) => mints.get(key.toBase58()) ?? null,
    getEpochInfo: async () => ({ epoch: REAL.epoch }),
    getSlot: async () => 1,
    getBlockTime: async () => Math.floor(T0 / 1000),
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9 }),
  };
  const gate = { open: true, network: "mainnet", pool: null, agent };
  const store = createMemoryGuardStore();
  const review = await reviewCopyEnable(
    { owner: human.toBase58(), leader, budget: { perDay: 100_000_000n, perTrade: 25_000_000n, days: 7 }, sharePct: 25, boundPct: 5, coins: [{ mint: coinA.toBase58() }, { mint: PUMP.toBase58() }, { mint: coinB.toBase58() }, { mint: stranger.toBase58() }] },
    gate,
    connection,
    { origin: async (mint) => ({ launchedHere: mint === stranger.toBase58(), creator: null }), dayCoins: async () => 4_000_000n, sides: async (mint) => uncataloguedFacts(mint), stocks: NO_STOCKS, store, now: () => T0 },
  );
  assert.equal(review.ok, true, review.reason);
  assert.deepEqual(review.skipped.map((entry) => entry.mint), [PUMP.toBase58(), stranger.toBase58()]);
  assert.match(review.skipped[0].reason, /own program on every transfer/);
  assert.match(review.skipped[1].reason, /launched on Ryntra/);
  /* Each coin's day is its share — two day's caps in the coin ÷ two coins — and the worst day three day's caps. */
  assert.deepEqual(review.row.mandate.coins.map((coin) => [coin.mint, coin.dailyMax]), [[coinA.toBase58(), "4000000"], [coinB.toBase58(), "4000000"]]);
  assert.equal(review.worstLamports, "300000000");
  /* The server keeps what it built; her start names it by the review. */
  const kept = await store.versioned(WALLET_WATCH_COLLECTION).get(copyReviewKey("mainnet", review.row.mandate.policy, review.review));
  assert.deepEqual(kept.row, review.row);
  assert.equal(review.row.mandate.salePolicies.length, Math.ceil(2 / COPY_COINS_PER_SALE));
  /* One approval: the account, the budget, the buy's policy, the sale's — each a transaction of hers alone. */
  const txs = review.transactions.map((wire) => VersionedTransaction.deserialize(Buffer.from(wire, "base64")));
  assert.ok(txs.length >= 2);
  for (const tx of txs) assert.ok(tx.message.staticAccountKeys[0].equals(human));
  assert.equal(review.fundLamports, "700000000");
  /* None left: no copy. */
  const none = await reviewCopyEnable({ owner: human.toBase58(), leader, budget: { perDay: 100_000_000n, perTrade: 25_000_000n, days: 7 }, sharePct: 25, boundPct: 5, coins: [{ mint: PUMP.toBase58() }] }, gate, connection, { origin: async () => ({ launchedHere: false, creator: null }), dayCoins: async () => 1n, sides: async () => null, stocks: NO_STOCKS, store });
  assert.equal(none.ok, false);
});

/* ------------------------------------------------------------- stop */

/** A mint of Token-2022 with these features (type, bytes), 6 decimals, no freeze authority unless named. */
function mint2022(features, freeze = false) {
  const tlv = Buffer.concat(features.map(([type, bytes = Buffer.alloc(0)]) => {
    const head = Buffer.alloc(4);
    head.writeUInt16LE(type, 0);
    head.writeUInt16LE(bytes.length, 2);
    return Buffer.concat([head, bytes]);
  }));
  const data = Buffer.concat([Buffer.alloc(166), tlv]);
  data[44] = 6;
  data[45] = 1;
  data[46] = freeze ? 1 : 0;
  data[165] = 1;
  return { owner: TOKEN_2022_PROGRAM_ID, data, lamports: 1, executable: false };
}
const mintOfToken = (freeze = false) => {
  const info = plainMintInfo();
  info.data[46] = freeze ? 1 : 0;
  return info;
};
/** A token account of the vault: its mint, its amount, its state (1 open, 2 frozen). */
const vaultAccount = (mint, amount, program = TOKEN_PROGRAM_ID, state = 1) => {
  const data = Buffer.concat([mint.toBuffer(), mandate.vault.toBuffer(), u64(amount), Buffer.alloc(93)]);
  data[108] = state;
  return { owner: program, data, lamports: 2_039_280, executable: false };
};
const keysOf = (wire) => VersionedTransaction.deserialize(Buffer.from(wire, "base64")).message.staticAccountKeys.map(String);

/** The chain her stop reads: her policies, the budget, the vault's token accounts by program, their mints. */
function stopChain({ vault = [], mints = new Map(), budget = true, fail = null } = {}) {
  const live = chain(new Map([...mints, ...(budget ? [[mandate.budgetAccount.toBase58(), tokenAccount(NATIVE_MINT, mandate.vault, 123n)]] : [])]));
  return {
    async getAccountInfo(key) {
      if (fail === "budget") throw new Error("rpc down");
      return live.getAccountInfo(key);
    },
    async getMultipleAccountsInfo(keys) {
      if (fail === "policies" && keys.some((key) => key.equals(mandate.policy))) throw new Error("rpc down");
      if (fail === "mints" && !keys.some((key) => key.equals(mandate.policy))) throw new Error("rpc down");
      return live.getMultipleAccountsInfo(keys);
    },
    async getTokenAccountsByOwner(_owner, { programId }) {
      if (fail === "accounts") throw new Error("rpc down");
      return { value: vault.filter((entry) => entry.account.owner.equals(programId)) };
    },
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9 }),
  };
}

test("her stop: the stop itself first and alone — every policy off, the budget home — then every coin of the vault, each on its own", async () => {
  const vaultA = heldAccountOf(mandate.vault, mandate.terms.copyCoins[0]);
  const vaultStranger = heldAccountOf(mandate.vault, { mint: stranger, program: TOKEN_PROGRAM_ID });
  /* A stolen key's buy into an account of the vault that is not its own account of the coin (the buy's policy takes any). */
  const offAccount = seeded("not the vault's own account of coin b");
  const held = seeded("a coin its issuer can freeze");
  const vaultHeld = heldAccountOf(mandate.vault, { mint: held, program: TOKEN_PROGRAM_ID });
  const connection = stopChain({
    vault: [
      { pubkey: mandate.budgetAccount, account: tokenAccount(NATIVE_MINT, mandate.vault, 123n) },
      { pubkey: vaultA, account: vaultAccount(coinA, 5_000n) },
      { pubkey: vaultStranger, account: vaultAccount(stranger, 7n) },
      { pubkey: offAccount, account: vaultAccount(coinB, 9n) },
      { pubkey: vaultHeld, account: vaultAccount(held, 11n) },
    ],
    mints: new Map([[coinA.toBase58(), mintOfToken()], [coinB.toBase58(), mintOfToken()], [stranger.toBase58(), mintOfToken()], [held.toBase58(), mintOfToken(true)]]),
  });
  const stop = await reviewCopyStop(baseRow, agent, connection);
  assert.equal(stop.ok, true, stop.reason);
  assert.deepEqual(stop.skipped, []);
  const [first, ...coins] = stop.transactions.map(keysOf);
  /* The stop itself: her policies and the budget's account — no coin's account anywhere near it. */
  for (const account of [mandate.policy, ...mandate.salePolicies, mandate.budgetAccount]) assert.ok(first.includes(account.toBase58()), account.toBase58());
  for (const account of [vaultA, vaultStranger, offAccount, vaultHeld]) assert.ok(!first.includes(account.toBase58()), "no coin in the stop's own transaction");
  /* Every coin home — hers first, the stranger, the one in another account of the vault — to her own account of it. */
  const mine = [coinA, coinB, stranger, held].map((mint) => tokenAccountOf(human, mint).toBase58());
  const moves = coins.filter((keys) => mine.some((account) => keys.includes(account)));
  const closing = coins.filter((keys) => !mine.some((account) => keys.includes(account)));
  for (const account of [...[vaultA, vaultStranger, offAccount, vaultHeld].map(String), ...mine]) assert.ok(moves.flat().includes(account), account);
  assert.ok(moves[0].includes(vaultA.toBase58()), "her own coins first");
  /* A coin its issuer could freeze goes alone: whatever stops it stops nothing else. */
  const withHeld = moves.filter((keys) => keys.includes(vaultHeld.toBase58()));
  assert.equal(withHeld.length, 1);
  assert.ok(![vaultA, vaultStranger, offAccount].some((account) => withHeld[0].includes(account.toBase58())));
  /* The emptied accounts are closed last, apart from the moves: a grain sent to one fails only its close. */
  assert.ok(closing.length >= 1);
  assert.deepEqual(coins.slice(-closing.length), closing, "the closes come after every move");
  for (const account of [vaultA, vaultStranger, offAccount, vaultHeld]) assert.ok(closing.flat().includes(account.toBase58()), account.toBase58());
  assert.equal(stop.left, 0);
});

test("her stop: a coin no one can move — frozen in her vault, never transferable, a program on its transfers, paused — stays and is said; the stop lands", async () => {
  const frozen = seeded("frozen stranger");
  const stuck = seeded("non-transferable stranger");
  const hooked = seeded("hooked stranger");
  const paused = seeded("paused stranger");
  const vaultOf = (mint, program) => heldAccountOf(mandate.vault, { mint, program });
  const connection = stopChain({
    vault: [
      { pubkey: vaultOf(frozen, TOKEN_PROGRAM_ID), account: vaultAccount(frozen, 1n, TOKEN_PROGRAM_ID, 2) },
      { pubkey: vaultOf(stuck, TOKEN_2022_PROGRAM_ID), account: vaultAccount(stuck, 1n, TOKEN_2022_PROGRAM_ID) },
      { pubkey: vaultOf(hooked, TOKEN_2022_PROGRAM_ID), account: vaultAccount(hooked, 1n, TOKEN_2022_PROGRAM_ID) },
      { pubkey: vaultOf(paused, TOKEN_2022_PROGRAM_ID), account: vaultAccount(paused, 1n, TOKEN_2022_PROGRAM_ID) },
    ],
    mints: new Map([
      [frozen.toBase58(), mintOfToken(true)],
      [stuck.toBase58(), mint2022([[9]])],
      [hooked.toBase58(), mint2022([[14, Buffer.concat([seeded("hook authority").toBuffer(), seeded("hook program").toBuffer()])]])],
      [paused.toBase58(), mint2022([[26, Buffer.concat([seeded("pauser").toBuffer(), Buffer.from([1])])]])],
    ]),
  });
  const stop = await reviewCopyStop(baseRow, agent, connection);
  assert.equal(stop.ok, true);
  assert.equal(stop.transactions.length, 1, "the stop itself, and nothing that could fail it");
  assert.deepEqual(stop.skipped.map((entry) => entry.mint).sort(), [frozen, stuck, hooked, paused].map(String).sort());
  assert.match(stop.skipped.find((entry) => entry.mint === frozen.toBase58()).reason, /froze/);
  assert.match(stop.skipped.find((entry) => entry.mint === stuck.toBase58()).reason, /cannot be moved/);
  assert.match(stop.skipped.find((entry) => entry.mint === hooked.toBase58()).reason, /own program/);
  assert.match(stop.skipped.find((entry) => entry.mint === paused.toBase58()).reason, /stop every transfer/);
  /* Nothing left of the copy itself and only such coins: nothing to sign — and they are said. */
  const bare = stopChain({ budget: false, vault: [{ pubkey: vaultOf(frozen, TOKEN_PROGRAM_ID), account: vaultAccount(frozen, 1n, TOKEN_PROGRAM_ID, 2) }], mints: new Map([[frozen.toBase58(), mintOfToken(true)]]) });
  const readMints = bare.getMultipleAccountsInfo;
  bare.getMultipleAccountsInfo = async (keys) => (keys.some((key) => key.equals(mandate.policy)) ? keys.map(() => null) : readMints(keys));
  const nothing = await reviewCopyStop(baseRow, agent, bare);
  assert.deepEqual([nothing.ok, nothing.code, nothing.skipped.length], [false, "NOTHING", 1]);
});

test("her stop: a read that failed is no stop — her policies, the budget, the vault's accounts, their mints — she taps again", async () => {
  for (const fail of ["policies", "budget", "accounts", "mints"]) {
    const stop = await reviewCopyStop(baseRow, agent, stopChain({ fail, vault: [{ pubkey: heldAccountOf(mandate.vault, mandate.terms.copyCoins[0]), account: vaultAccount(coinA, 5n) }], mints: new Map([[coinA.toBase58(), mintOfToken()]]) }));
    assert.deepEqual([stop.ok, stop.code], [false, "UNAVAILABLE"], fail);
    assert.match(stop.reason, /tap stop again/);
  }
});

test("her stop: a vault crowded with coins asks at most its share of transactions — her own first, the rest said for her next stop", async () => {
  const strangers = Array.from({ length: COPY_STOP_COIN_TRANSACTIONS + 2 }, (_, i) => seeded(`crowd ${i}`));
  const vault = [{ pubkey: heldAccountOf(mandate.vault, mandate.terms.copyCoins[1]), account: vaultAccount(coinB, 3n) }, ...strangers.map((mint) => ({ pubkey: heldAccountOf(mandate.vault, { mint, program: TOKEN_PROGRAM_ID }), account: vaultAccount(mint, 1n) }))];
  /* Each stranger's issuer can freeze it: each goes alone. */
  const mints = new Map([[coinB.toBase58(), mintOfToken(true)], ...strangers.map((mint) => [mint.toBase58(), mintOfToken(true)])]);
  const stop = await reviewCopyStop(baseRow, agent, stopChain({ vault, mints }));
  const mine = [coinB, ...strangers].map((mint) => tokenAccountOf(human, mint).toBase58());
  assert.equal(stop.transactions.filter((wire) => keysOf(wire).some((account) => mine.includes(account))).length, COPY_STOP_COIN_TRANSACTIONS);
  assert.equal(stop.left, 3);
  assert.ok(keysOf(stop.transactions[1]).includes(heldAccountOf(mandate.vault, mandate.terms.copyCoins[1]).toBase58()), "her own coin first");
});

/* ------------------------------------------------------------- The coin's day, the race, history */

test("the worst day with a stolen key is three day's caps for one coin or ten — and the screen says that number", () => {
  const dayCoins = 1_000_003n;
  for (let n = 1; n <= 10; n += 1) {
    const sales = Array.from({ length: n }, () => copyDailyMax(dayCoins, n)).reduce((sum, max) => sum + max, 0n);
    assert.ok(sales <= 2n * dayCoins, `${n} coins let out no more than two day's caps`);
  }
  assert.equal(COPY_WORST_DAYS, 3n);
  assert.equal(SCREEN_WORST_DAYS, Number(COPY_WORST_DAYS), "the screen's number is the engine's");
  assert.equal(copyBuySize(25_000_000n, 100_000_000n, 2), 25_000_000n);
  assert.equal(copyBuySize(25_000_000n, 100_000_000n, 10), 10_000_000n, "a buy is at most a coin's share of her day");
});

test("a buy keeps what the vault holds of a coin, with what it sold of it in the last day, within the coin's day", async () => {
  const vaultA = heldAccountOf(mandate.vault, mandate.terms.copyCoins[0]);
  const store = await bookWith();
  const connection = chain(new Map([[vaultA.toBase58(), tokenAccount(coinA, mandate.vault, 7_500_000n)]]));
  const { trade, sent } = trader(store);
  const now = { at: T0 + 60_000 };
  /* 7.5 of its 8 held, her trade brings 1 more: over its day — said as full, nothing sent. */
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [leaderTrade("buy", coinA)], now)))[0].did, "missed");
  let row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.equal(row.orders[0].missed, "full");
  /* Sold in the last day counts as held: the vault empty, but 7.5 of it sold an hour ago. */
  connection.accounts.delete(vaultA.toBase58());
  await changeCopyRow(store, row, (current) => ({ ...current, orders: [{ key: "s", side: "sell", mint: coinA.toBase58(), at: now.at - 3_600_000, leaderAt: 0, dayN: 0, amountRaw: "7500000", status: "ok", signature: "x", receivedRaw: null, reason: null }, ...current.orders] }));
  now.at += COPY_ORDER_EVERY_MS;
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [leaderTrade("buy", coinA)], now)))[0].did, "missed");
  /* A day after that sale its room is back: the buy goes. */
  now.at += COPY_SALE_WINDOW_MS;
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [leaderTrade("buy", coinA, { at: Math.floor(now.at / 1000) - 5 })], now)))[0].did, "bought");
  assert.equal(sent.length, 1);
  row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.equal(copyCoinSold(row, coinA.toBase58(), now.at), 0n);
});

test("a sale goes within what the coin's day has left — the rest stays in her vault; a day later the room is back", async () => {
  const vaultB = heldAccountOf(mandate.vault, mandate.terms.copyCoins[1]);
  const store = await bookWith();
  /* 5 of coin B in the vault — more than its day of 3 (anyone may send her a coin). */
  const connection = chain(new Map([[vaultB.toBase58(), tokenAccount(coinB, mandate.vault, 5_000_000n)]]));
  const v = venue();
  const { trade, sent } = trader(store);
  const now = { at: T0 + 60_000 };
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, v, trade, () => [leaderTrade("sell", coinB)], now)))[0].did, "sold");
  assert.deepEqual(v.calls.find((call) => call[0] === "sell"), ["sell", coinB.toBase58(), 3_000_000n]);
  const row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.equal(copyCoinRoom(row, mandate.terms.copyCoins[1], now.at), 0n);
  /* Its day spent: the leader's next sale today is said as full, nothing sent. */
  now.at += COPY_ORDER_EVERY_MS;
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, v, trade, () => [leaderTrade("sell", coinB, { at: Math.floor(now.at / 1000) - 5 })], now)))[0].did, "missed");
  assert.equal((await readCopyRow(store, "mainnet", mandate.policy.toBase58())).orders[0].missed, "full");
  assert.equal(sent.length, 1);
  assert.equal(copyCoinRoom(row, mandate.terms.copyCoins[1], T0 + 60_000 + COPY_SALE_WINDOW_MS + 1), 3_000_000n);
});

test("an old sale of the leader's is not repeated — said as late", async () => {
  const vaultB = heldAccountOf(mandate.vault, mandate.terms.copyCoins[1]);
  const store = await bookWith();
  const connection = chain(new Map([[vaultB.toBase58(), tokenAccount(coinB, mandate.vault, 1_000_000n)]]));
  const { trade, sent } = trader(store);
  const now = { at: T0 + 11 * 60_000 };
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [leaderTrade("sell", coinB)], now)))[0].did, "missed");
  assert.equal((await readCopyRow(store, "mainnet", mandate.policy.toBase58())).orders[0].missed, "late");
  assert.equal(sent.length, 0);
});

test("a leader with more trades than the keys kept — a sale handled once is never handled again", async () => {
  const vaultB = heldAccountOf(mandate.vault, mandate.terms.copyCoins[1]);
  const store = await bookWith();
  const connection = chain(new Map([[vaultB.toBase58(), tokenAccount(coinB, mandate.vault, 2_000_000n)]]));
  const { trade, sent } = trader(store);
  const now = { at: T0 + 60_000 };
  const at = Math.floor(T0 / 1000) + 40;
  const sale = leaderTrade("sell", coinB, { at, tokensRaw: "1000" });
  /* More trades than the keys kept, spread over more slots than the watermark's margin. */
  const crowd = Array.from({ length: COPY_SEEN_KEPT + 100 }, () => leaderTrade("buy", stranger, { at, slot: (slot += 3) }));
  const trades = () => [sale, ...crowd];
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, trades, now)))[0].did, "sold");
  for (let pass = 0; pass < 3; pass += 1) {
    now.at += COPY_ORDER_EVERY_MS;
    await runCopyMoneyPass(passDeps(store, connection, venue(), trade, trades, now));
  }
  const row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.ok(!row.seen.includes(`${sale.signature}:${sale.mint}:sell`), "its key has fallen out of the keys kept");
  assert.ok(row.throughSlot >= crowd.at(-1).slot);
  assert.equal(sent.length, 1, "sold once");
  assert.equal(new Set(row.orders.map((order) => order.key)).size, row.orders.length, "no trade written twice");
  assert.ok(sale.slot < row.throughSlot - COPY_SLOT_MARGIN, "under the watermark: history");
  assert.ok(copyActedKeys(row).has(`${sale.signature}:${sale.mint}:sell`), "and known by the day's orders, which misses never push out");
});

test("an order whose trade another pass took while it was signed is not sent — the book is read again before the send", async () => {
  const store = await bookWith();
  const connection = chain();
  const now = { at: T0 + 60_000 };
  const buyA = leaderTrade("buy", coinA);
  let sentOut = 0;
  /* Between the build and the send, another pass wrote the same trade's order down and sent it. */
  const trade = async (input) => {
    await changeCopyRow(store, baseRow, (current) => ({ ...current, seen: [...current.seen, `${buyA.signature}:${buyA.mint}:buy`], lastOrderAt: now.at, orders: [{ key: `${buyA.signature}:${buyA.mint}:buy`, side: "buy", mint: coinA.toBase58(), at: now.at - 1, leaderAt: 0, dayN: 0, amountRaw: "25000000", status: "sent", signature: "other", receivedRaw: null, reason: null }] }));
    await input.beforeSend({ signature: "mine", validUntilHeight: 50 });
    sentOut += 1;
    return { status: "landed", signature: "mine", ok: true, size: 900, computeUnits: 1, fee: 5000 };
  };
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [buyA], now)))[0].did, "waited");
  assert.equal(sentOut, 0, "nothing sent");
  const row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.deepEqual(row.orders.map((order) => order.signature), ["other"], "the other pass's order stands alone");
  /* The book's own word on each race. */
  assert.equal(raceOf(baseRow, buyA, now.at), null);
  assert.equal(raceOf({ ...baseRow, status: "stopped" }, buyA, now.at), "the copy is stopped");
  assert.equal(raceOf({ ...baseRow, lastOrderAt: now.at - 1 }, buyA, now.at), "the minute is not over");
  assert.equal(raceOf({ ...baseRow, throughSlot: buyA.slot + COPY_SLOT_MARGIN + 1 }, buyA, now.at), "the trade is handled");
  assert.equal(raceOf(row, buyA, now.at + COPY_ORDER_EVERY_MS), "an order is on its way");
  assert.equal(raceOf({ ...baseRow, lastOrderAt: now.at - 2 * COPY_ORDER_EVERY_MS }, buyA, now.at, null), "another order went out meanwhile", "another order since the pass read the book: its numbers are not the book's");
});

test("a busy leader's misses never push the day's own orders out of the book — the coin's day, her cap and the trades acted on hold", () => {
  const sale = { key: "sold", side: "sell", mint: coinA.toBase58(), at: T0 - 3_600_000, leaderAt: 0, dayN: 0, amountRaw: "1000", status: "ok", signature: "s", receivedRaw: null, reason: null };
  const buy = { ...sale, key: "bought", side: "buy", amountRaw: "25000000", signature: "b" };
  let row = withOrders(baseRow, [buy, sale], new Date(T0).toISOString());
  for (let i = 0; i < 3; i += 1) {
    const misses = Array.from({ length: COPY_ORDERS_KEPT }, (_, k) => ({ key: `miss-${i}-${k}`, side: "buy", mint: stranger.toBase58(), at: T0 + i, leaderAt: 0, dayN: 0, amountRaw: "0", status: "missed", signature: null, receivedRaw: null, reason: null, missed: "outside" }));
    row = withOrders(row, misses, new Date(T0 + i).toISOString());
  }
  assert.equal(row.orders.length, COPY_ORDERS_KEPT, "the book stays its size");
  assert.equal(copyCoinSold(row, coinA.toBase58(), T0), 1000n, "the day's sale still counted");
  assert.equal(copyDaySpent(row, 0), 25_000_000n, "the day's buy still counted");
  assert.ok(copyActedKeys(row).has("sold") && copyActedKeys(row).has("bought"));
  /* A day later they give way like any other. */
  row = withOrders(row, [], new Date(T0 + COPY_SALE_WINDOW_MS).toISOString());
  assert.equal(copyCoinSold(row, coinA.toBase58(), T0 + COPY_SALE_WINDOW_MS), 0n);
});

test("at most so many orders of its own a day — past them the copy builds none, said as full", async () => {
  const day = Array.from({ length: COPY_DAY_ORDERS_MAX }, (_, i) => ({ key: `o${i}`, side: "sell", mint: coinB.toBase58(), at: T0 + i, leaderAt: 0, dayN: 0, amountRaw: "0", status: "failed", signature: `f${i}`, receivedRaw: null, reason: "x" }));
  const store = await bookWith({ ...baseRow, orders: day });
  const { trade, sent } = trader(store);
  assert.equal((await runCopyMoneyPass(passDeps(store, chain(), venue(), trade, () => [leaderTrade("buy", coinA)], { at: T0 + 60_000 })))[0].did, "missed");
  assert.equal((await readCopyRow(store, "mainnet", mandate.policy.toBase58())).orders[0].reason, "the copy's day of orders is full");
  assert.equal(sent.length, 0);
});

test("her stop freezes the copy first; a coin of hers with an order on its way goes alone", async () => {
  const vaultA = heldAccountOf(mandate.vault, mandate.terms.copyCoins[0]);
  const vaultB = heldAccountOf(mandate.vault, mandate.terms.copyCoins[1]);
  const row = { ...baseRow, orders: [{ key: "k", side: "sell", mint: coinA.toBase58(), at: T0, leaderAt: 0, dayN: 0, amountRaw: "5", status: "sent", signature: "on-its-way", validUntilHeight: 50, receivedRaw: null, reason: null }] };
  const store = await bookWith(row);
  const connection = stopChain({ vault: [{ pubkey: vaultA, account: vaultAccount(coinA, 50n) }, { pubkey: vaultB, account: vaultAccount(coinB, 60n) }], mints: new Map([[coinA.toBase58(), mintOfToken()], [coinB.toBase58(), mintOfToken()]]) });
  const stop = await reviewCopyStop(row, agent, connection, { store });
  assert.equal(stop.ok, true);
  assert.ok(await store.collection("agentMandates").get(freezeKey("mainnet", mandate.policy.toBase58())), "frozen: the copy starts nothing before her stop");
  const moves = stop.transactions.map(keysOf).filter((keys) => keys.includes(tokenAccountOf(human, coinA).toBase58()) || keys.includes(tokenAccountOf(human, coinB).toBase58()));
  const withA = moves.find((keys) => keys.includes(vaultA.toBase58()));
  assert.ok(withA && !withA.includes(vaultB.toBase58()), "the coin still moving goes alone");
});

/* ------------------------------------------------------------- The freeze inside the compare-and-set, the closes apart */

const freezeOf = (frozen, at = T0) => (store) => setCopyFrozen(store, { cluster: "mainnet", owner: human.toBase58(), policy: mandate.policy.toBase58(), frozen }, () => at);
const landedOk = (signature) => ({ status: "landed", signature, ok: true, size: 900, computeUnits: 1, fee: 5000 });

test("her freeze written while an order was signed sends nothing — the compare-and-set that writes the order reads it", async () => {
  const store = await bookWith();
  const connection = chain();
  const now = { at: T0 + 60_000 };
  const buyA = leaderTrade("buy", coinA);
  let sentOut = 0;
  /* Her stop's review between the pass's look at her switch and its send: her freeze goes into the record first. */
  const trade = async (input) => {
    await freezeOf(true, now.at)(store);
    await input.beforeSend({ signature: "mine", validUntilHeight: 50 });
    sentOut += 1;
    return landedOk("mine");
  };
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [buyA], now)))[0].did, "waited");
  assert.equal(sentOut, 0, "nothing sent");
  let row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.equal(row.frozen, true);
  assert.deepEqual(row.orders, [], "no order written — her stop's book holds every order that could land");
  assert.equal(raceOf(row, buyA, now.at + COPY_ORDER_EVERY_MS), "the copy is frozen");
  /* The record's mark holds the copy on its own — her switch gone (a write that did not take). */
  await store.collection("agentMandates").delete(freezeKey("mainnet", mandate.policy.toBase58()));
  const { trade: plain, sent } = trader(store);
  now.at += COPY_ORDER_EVERY_MS;
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), plain, () => [buyA], now)))[0].did, "frozen");
  assert.equal(sent.length, 0);
  /* Off: the mark and the switch cleared, the copy goes on. */
  await freezeOf(false, now.at)(store);
  row = await readCopyRow(store, "mainnet", mandate.policy.toBase58());
  assert.equal("frozen" in row, false);
  assert.equal(await store.collection("agentMandates").get(freezeKey("mainnet", mandate.policy.toBase58())) ?? null, null);
  now.at += COPY_ORDER_EVERY_MS;
  assert.equal((await runCopyMoneyPass(passDeps(store, connection, venue(), plain, () => [buyA], now)))[0].did, "bought");
  assert.equal(sent.length, 1);
});

test("her stop reads the book again once her freeze is in it — an order written meanwhile goes alone; a book not read, every coin of hers alone", async () => {
  const vaultA = heldAccountOf(mandate.vault, mandate.terms.copyCoins[0]);
  const vaultB = heldAccountOf(mandate.vault, mandate.terms.copyCoins[1]);
  const connection = stopChain({ vault: [{ pubkey: vaultA, account: vaultAccount(coinA, 50n) }, { pubkey: vaultB, account: vaultAccount(coinB, 60n) }], mints: new Map([[coinA.toBase58(), mintOfToken()], [coinB.toBase58(), mintOfToken()]]) });
  const mine = [coinA, coinB].map((mint) => tokenAccountOf(human, mint).toBase58());
  const movesOf = (stop) => stop.transactions.map(keysOf).filter((keys) => mine.some((account) => keys.includes(account)));
  /* Nothing on its way: two coins no one can stop share one move. */
  const calm = await reviewCopyStop(baseRow, agent, connection, { store: await bookWith() });
  assert.ok(movesOf(calm).some((keys) => keys.includes(vaultA.toBase58()) && keys.includes(vaultB.toBase58())));
  /* The page handed in the book as it was; an order of coin B went into it before her freeze: coin B goes alone. */
  const order = { key: "k", side: "sell", mint: coinB.toBase58(), at: T0, leaderAt: 0, dayN: 0, amountRaw: "5", status: "sent", signature: "on-its-way", validUntilHeight: 50, receivedRaw: null, reason: null };
  const store = await bookWith({ ...baseRow, orders: [order] });
  const stop = await reviewCopyStop(baseRow, agent, connection, { store });
  const withB = movesOf(stop).find((keys) => keys.includes(vaultB.toBase58()));
  assert.ok(withB && !withB.includes(vaultA.toBase58()), "the coin of the order the page did not know goes alone");
  assert.equal((await readCopyRow(store, "mainnet", mandate.policy.toBase58())).frozen, true);
  /* A book that does not answer: her freeze not known to be in — every coin of hers goes alone, and the stop is still hers. */
  const down = { versioned: () => ({ get: async () => { throw new Error("store down"); } }), collection: () => ({ set: async () => { throw new Error("store down"); } }) };
  const blind = await reviewCopyStop(baseRow, agent, connection, { store: down });
  assert.equal(blind.ok, true);
  const moves = movesOf(blind);
  assert.equal(moves.length, 2);
  assert.ok(moves.every((keys) => !(keys.includes(vaultA.toBase58()) && keys.includes(vaultB.toBase58()))), "each coin of hers alone");
});

test("each emptied account closes in a transaction of its own — a grain sent to one fails its close alone; wrapped SOL's share one", async () => {
  const vaultA = heldAccountOf(mandate.vault, mandate.terms.copyCoins[0]);
  const vaultB = heldAccountOf(mandate.vault, mandate.terms.copyCoins[1]);
  const vaultStranger = heldAccountOf(mandate.vault, { mint: stranger, program: TOKEN_PROGRAM_ID });
  const empty = seeded("an empty account of coin a");
  const wsol = [seeded("wrapped sol 1"), seeded("wrapped sol 2")];
  const connection = stopChain({
    vault: [
      { pubkey: vaultA, account: vaultAccount(coinA, 50n) },
      { pubkey: vaultB, account: vaultAccount(coinB, 60n) },
      { pubkey: vaultStranger, account: vaultAccount(stranger, 7n) },
      { pubkey: empty, account: vaultAccount(coinA, 0n) },
      ...wsol.map((pubkey, i) => ({ pubkey, account: vaultAccount(NATIVE_MINT, BigInt(i)) })),
    ],
    mints: new Map([[coinA.toBase58(), mintOfToken()], [coinB.toBase58(), mintOfToken()], [stranger.toBase58(), mintOfToken()], [NATIVE_MINT.toBase58(), mintOfToken()]]),
  });
  const stop = await reviewCopyStop(baseRow, agent, connection);
  assert.equal(stop.ok, true, stop.reason);
  const mine = [coinA, coinB, stranger, NATIVE_MINT].map((mint) => tokenAccountOf(human, mint).toBase58());
  const [, ...rest] = stop.transactions.map(keysOf);
  const closing = rest.filter((keys) => !mine.some((account) => keys.includes(account)));
  assert.deepEqual(rest.slice(-closing.length), closing, "the closes come after every move");
  const tokens = [vaultA, vaultB, vaultStranger, empty].map(String);
  for (const account of tokens) {
    const holding = closing.filter((keys) => keys.includes(account));
    assert.equal(holding.length, 1, account);
    assert.deepEqual(tokens.filter((other) => holding[0].includes(other)), [account], "alone in its transaction");
    assert.ok(!wsol.some((pubkey) => holding[0].includes(pubkey.toBase58())));
  }
  const withSol = closing.filter((keys) => wsol.some((pubkey) => keys.includes(pubkey.toBase58())));
  assert.equal(withSol.length, 1, "wrapped SOL closes whatever it holds: its accounts share one");
  assert.ok(wsol.every((pubkey) => withSol[0].includes(pubkey.toBase58())));
  assert.equal(closing.length, tokens.length + 1);
  assert.equal(stop.unclosed, 0);
});

test("a vault crowded with empty accounts asks at most its share of closes — her own coin's first, the rest said for her next stop", async () => {
  const vaultB = heldAccountOf(mandate.vault, mandate.terms.copyCoins[1]);
  const junk = Array.from({ length: COPY_STOP_CLOSE_TRANSACTIONS + 3 }, (_, i) => seeded(`junk ${i}`));
  const vault = [...junk.map((mint) => ({ pubkey: heldAccountOf(mandate.vault, { mint, program: TOKEN_PROGRAM_ID }), account: vaultAccount(mint, 0n) })), { pubkey: vaultB, account: vaultAccount(coinB, 0n) }];
  const mints = new Map([[coinB.toBase58(), mintOfToken()], ...junk.map((mint) => [mint.toBase58(), mintOfToken()])]);
  const stop = await reviewCopyStop(baseRow, agent, stopChain({ vault, mints }));
  assert.equal(stop.ok, true);
  const [, ...closing] = stop.transactions.map(keysOf);
  assert.equal(closing.length, COPY_STOP_CLOSE_TRANSACTIONS);
  assert.equal(stop.unclosed, 4);
  assert.ok(closing[0].includes(vaultB.toBase58()), "her own coin's account first");
});

/* ------------------------------------------------------------- The pass, bounded */

test("one pass at a time — a pass that finds another under way reads nothing; the hold given back or run out, the next passes", async () => {
  const store = await bookWith();
  const touched = new Proxy({}, { get: (_target, name) => (name === "then" ? undefined : () => assert.fail(`touched: ${String(name)}`)) });
  const now = { at: T0 + 60_000 };
  assert.equal(await takeCopyLease(store, copyPassKey("mainnet"), "another pass", now.at, COPY_PASS_LEASE_MS), true);
  assert.equal(await runCopyMoneyPass({ ...passDeps(store, touched, touched, touched, () => assert.fail("no leader read"), now) }), null, "busy: nothing read, nothing sent");
  /* Two at once: one runs, the other finds it under way. */
  await dropCopyLease(store, copyPassKey("mainnet"), "another pass");
  const connection = chain();
  const { trade } = trader(store);
  const both = await Promise.all([runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [], now)), runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [], now))]);
  assert.equal(both.filter((lines) => lines === null).length, 1, "never two passes over the same book");
  /* A pass cut off holds the network no longer than its hold. */
  assert.equal(await takeCopyLease(store, copyPassKey("mainnet"), "a pass cut off", now.at, COPY_PASS_LEASE_MS), true);
  now.at += COPY_PASS_LEASE_MS + 1;
  assert.deepEqual(await runCopyMoneyPass(passDeps(store, connection, venue(), trade, () => [], now)), [{ policy: mandate.policy.toBase58(), did: "idle" }]);
});

test("at most COPY_PASS_MAX turns a pass, none begun past COPY_PASS_MS — the rest said `later`, the turn going round to them first", async () => {
  const store = createMemoryGuardStore();
  const rows = store.versioned(WALLET_WATCH_COLLECTION);
  const n = COPY_PASS_MAX + 3;
  /* Frozen copies: each turn is hers to say, and reads nothing. */
  for (let i = 0; i < n; i += 1) {
    const policy = seeded(`pass ${i}`).toBase58();
    await rows.set(copyMoneyKey("mainnet", policy), { ...baseRow, frozen: true, mandate: { ...baseRow.mandate, policy } });
  }
  const touched = new Proxy({}, { get: (_target, name) => (name === "then" ? undefined : () => assert.fail(`touched: ${String(name)}`)) });
  const now = { at: T0 + 60_000 };
  const first = await runCopyMoneyPass(passDeps(store, touched, touched, touched, () => [], now));
  assert.equal(first.length, n);
  assert.equal(first.filter((line) => line.did === "frozen").length, COPY_PASS_MAX);
  const later = first.filter((line) => line.did === "later").map((line) => line.policy);
  assert.equal(later.length, 3);
  /* The next minute starts where this one stopped. */
  now.at += 60_000;
  const next = await runCopyMoneyPass(passDeps(store, touched, touched, touched, () => [], now));
  assert.deepEqual(next.slice(0, 3).map((line) => [line.policy, line.did]), later.map((policy) => [policy, "frozen"]));
  /* A pass whose turns run long: none begun past its time. */
  let clock = T0 + 10 * 60_000;
  const slow = await runCopyMoneyPass({ ...passDeps(store, touched, touched, touched, () => [], now), now: () => (clock += 9_000) });
  const taken = slow.filter((line) => line.did !== "later").length;
  assert.ok(taken >= 1 && taken <= Math.ceil(COPY_PASS_MS / 9_000), `${taken} turns`);
  assert.equal(slow.length, n);
  /* Whatever the order, each copy once a pass, and `copyPassOrder` is a turn of the list, never a reorder. */
  assert.deepEqual(copyPassOrder([1, 2, 3, 4], 0, 3), [1, 2, 3, 4]);
  assert.deepEqual(copyPassOrder([1, 2, 3, 4], 60_000, 3), [4, 1, 2, 3]);
  assert.deepEqual(copyPassOrder([], 60_000), []);
});
