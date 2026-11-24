/* «Сітка» and «Сигнали» on the person's budget, at work: the grid sells one level's coins one step above the
   level — the deepest first, only when the venue's quote for exactly those coins is at the line — and the level opens
   again; a «cross» signal sells everything once its fast average stands under the slow and goes on; both through the
   sale's policy, the money to her own wallet, signed by the agent's signer for real. A budget of any other plan — a
   grid that only buys included — is untouched: the bot's turn reads nothing. And a bot's budget joins the book only
   where its money is open and with the sale signed. The devnet chain is a stand-in; no network. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { Keypair, PublicKey, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { envKey } from "../launch/signer/env.server.ts";
import { readBook, readEntry, registerMandate, writeEntry } from "./book.server.ts";
import { botSaleFor } from "./bots.server.ts";
import { stopSale } from "./exit.server.ts";
import { exitText, positionTrades } from "./exit.ts";
import { agentFeeAccount, agentFeeRaw, agentFeeWallet, feeTransferInstruction, uncataloguedFacts } from "./fee.ts";
import { tokenAccountOf } from "./human.ts";
import { BUDGET_PRESETS } from "./presets.ts";
import { planFrom } from "./plans.ts";
import { NATIVE_MINT, SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, readPolicyExecute, ssaAddress } from "./ssa.ts";
import { DLMM_PROGRAM_ID, DLMM_SWAP2, LAYOUT, heldAccountOf } from "./terms.ts";
import { runAgentPass } from "./tick.server.ts";
import { gridHeld, gridNetworkRaw } from "../bots/money/rules.ts";
import { botMoneyOn, botMoneyRefusal, botOfPlan } from "../bots/money/gates.ts";

const HOUR = 3_600_000;
const NOW = Date.now();
const SECONDS = (ms) => BigInt(Math.floor(ms / 1000));

const human = Keypair.generate().publicKey;
const agentPair = Keypair.generate();
const agent = agentPair.publicKey;
const pool = Keypair.generate().publicKey;
const coin = Keypair.generate().publicKey;
const settings = ssaAddress.settings(9n);
const vault = ssaAddress.vault(settings, 0);
const policy = ssaAddress.policy(settings, 1n);
const salePolicy = ssaAddress.policy(settings, 2n);
const budget = tokenAccountOf(vault, NATIVE_MINT);
const vaultCoin = heldAccountOf(vault, { mint: coin, program: TOKEN_PROGRAM_ID });
const herWsol = tokenAccountOf(human, NATIVE_MINT);
const COIN_FEE = agentFeeAccount(coin);
const gate = { open: true, network: "devnet", pool, agent };
const medium = BUDGET_PRESETS.medium;
const SPENT = medium.perTrade;
const DAILY = 100_000n;
/** Only the stop of her rules: the bot's own rule is the one under test. */
const STOP_ONLY = { stopBps: 3_000, halfAtBps: null, fadeBps: null, holdH: null };

const RECORD = {
  owner: human.toBase58(),
  settings: settings.toBase58(),
  vault: vault.toBase58(),
  policy: policy.toBase58(),
  budget: budget.toBase58(),
  perTrade: medium.perTrade.toString(),
  perDay: medium.perDay.toString(),
  expiresAt: String(SECONDS(NOW + 29 * 24 * HOUR)),
  salePolicy: salePolicy.toBase58(),
  held: coin.toBase58(),
  heldDaily: DAILY.toString(),
};

const u16 = (n) => [n & 255, n >> 8];
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24];
const u64 = (n) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
  return [...out];
};
const settingsData = (signers) =>
  Uint8Array.from([223, 179, 163, 190, 177, 224, 67, 173, ...new Array(16).fill(0), ...new Array(32).fill(0), ...u16(1), ...u32(0), ...u64(0), ...u64(0), 0, ...u64(0), 255, ...u32(signers.length), ...signers.flatMap((key) => [...key.toBytes(), 7]), 0, 1, ...u64(2)]);
const policyData = (seed, signer, keys = [], numbers = []) =>
  Uint8Array.from([222, 135, 7, 163, 235, 177, 33, 68, ...settings.toBytes(), ...u64(seed), 255, ...u64(0), ...u64(0), ...u32(1), ...signer.toBytes(), 7, ...u16(1), ...new Array(64).fill(0), ...keys.flatMap((key) => [...key.toBytes()]), ...numbers.flatMap((n) => [3, ...u64(n)])]);
const tokenData = (mint, owner, amount = 0n) => Uint8Array.from([...mint.toBytes(), ...owner.toBytes(), ...u64(amount), ...new Array(93).fill(0)]);
/** A coin of six decimals: a whole coin is 1 000 000 base units — the unit the marks are read in. */
const mintData = () => Uint8Array.from({ length: 82 }, (_, at) => (at === 44 ? 6 : at === 45 ? 1 : 0));

function chain(options = {}) {
  const account = (owner, data) => ({ owner, data, lamports: 1, executable: false });
  const accounts = new Map([
    [policy.toBase58(), account(SSA_PROGRAM_ID, policyData(1, agent, [agentFeeAccount(NATIVE_MINT), vaultCoin], [medium.perTrade, medium.perDay]))],
    [salePolicy.toBase58(), account(SSA_PROGRAM_ID, policyData(2, agent, [vaultCoin, herWsol, COIN_FEE], [DAILY]))],
    [settings.toBase58(), account(SSA_PROGRAM_ID, settingsData([human]))],
    [vaultCoin.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(coin, vault, options.coinLeft ?? 1_054n))],
    [herWsol.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(NATIVE_MINT, human))],
    [coin.toBase58(), account(TOKEN_PROGRAM_ID, mintData())],
    [agentFeeAccount(NATIVE_MINT).toBase58(), account(TOKEN_PROGRAM_ID, tokenData(NATIVE_MINT, agentFeeWallet()))],
    [COIN_FEE.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(coin, agentFeeWallet()))],
  ]);
  const sent = [];
  const reads = [];
  const balances = new Map([
    [budget.toBase58(), options.budgetLeft ?? 4n * SPENT],
    [vaultCoin.toBase58(), options.coinLeft ?? 1_054n],
  ]);
  return {
    accounts,
    sent,
    reads,
    balances,
    getGenesisHash: async () => "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    getAccountInfo: async (key) => {
      reads.push(key.toBase58());
      return accounts.get(key.toBase58()) ?? null;
    },
    getMultipleAccountsInfo: async (keys) => keys.map((key) => accounts.get(key.toBase58()) ?? null),
    getTokenAccountBalance: async (key) => {
      reads.push(key.toBase58());
      const amount = balances.get(key.toBase58());
      if (amount === undefined) throw new Error("no such account");
      return { value: { amount: String(amount) } };
    },
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    sendRawTransaction: async (bytes) => {
      sent.push(VersionedTransaction.deserialize(bytes));
      return "sent";
    },
    getBlockHeight: async () => 1_000_000,
    confirmTransaction: async () => ({ value: { err: null } }),
    getTransaction: async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 90_000, fee: 5_000 } }),
  };
}

const FEE_BPS = 100;
function swap2Sale(amount, minOut) {
  const keys = Array.from({ length: 16 }, () => ({ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }));
  keys[LAYOUT.dlmmSwap2.pool] = { pubkey: pool, isSigner: false, isWritable: true };
  keys[LAYOUT.dlmmSwap2.source] = { pubkey: vaultCoin, isSigner: false, isWritable: true };
  keys[LAYOUT.dlmmSwap2.receiver] = { pubkey: herWsol, isSigner: false, isWritable: true };
  keys[LAYOUT.dlmmSwap2.user] = { pubkey: vault, isSigner: true, isWritable: false };
  const data = Buffer.alloc(24);
  Buffer.from(DLMM_SWAP2).copy(data, 0);
  data.writeBigUInt64LE(amount, LAYOUT.dlmmSwap2.inAmount);
  data.writeBigUInt64LE(minOut, LAYOUT.dlmmSwap2.minOut);
  return new TransactionInstruction({ programId: DLMM_PROGRAM_ID, keys, data });
}

/**
 * The venue: `perCoin(amount)` — what `amount` base units of the coin fetch now, lamports; a sale's route promises what
 * its coins less Ryntra's fee fetch, and its minimum on chain is `minOf` of that — the route's 1 % unless a test says.
 */
function venue(perCoin, minOf = (out) => (out * 99n) / 100n) {
  const sold = [];
  const asked = [];
  return {
    sold,
    asked,
    buy: async () => assert.fail("no buy is due in these passes"),
    received: async () => 30_000_000n,
    worth: async (_mandate, amount) => {
      asked.push(amount);
      return perCoin(amount);
    },
    sell: async (_mandate, amount) => {
      sold.push(amount);
      const fee = agentFeeRaw(amount, FEE_BPS);
      const out = perCoin(amount - fee);
      return {
        instruction: swap2Sale(amount - fee, minOf(out)),
        fee: feeTransferInstruction({ budgetMint: coin, budgetAccount: vaultCoin, vault, fee, decimals: 6 }),
        feeSides: { input: uncataloguedFacts(coin.toBase58()), output: uncataloguedFacts(NATIVE_MINT.toBase58()), nowMs: NOW },
        setup: [],
        promisedOut: out,
      };
    },
  };
}

/*
 * The grid started at A — the price of a whole coin, lamports — with levels 5 % apart. Level 0 bought 500 coins for the
 * trade cap, level 2 (0.9025 A) 554; the vault holds 1 054. Level 2 sells at 0.95 A, level 0 at A ÷ 0.95.
 */
const A = Number((1_000_000n * SPENT) / 500n);
const at96 = (amount) => (amount * SPENT * 96n) / 50_000n;
const at94 = (amount) => (amount * SPENT * 94n) / 50_000n;
const BUYS = [
  { at: NOW - 3 * HOUR, status: "ok", signature: "b0", spentRaw: SPENT.toString(), receivedRaw: "500", reason: null, level: 0 },
  { at: NOW - HOUR, status: "ok", signature: "b2", spentRaw: SPENT.toString(), receivedRaw: "554", reason: null, level: 2 },
];

async function stand(plan, options = {}) {
  const store = createMemoryGuardStore();
  const connection = chain(options);
  const parsed = planFrom(plan);
  const joined = await registerMandate({ record: RECORD, strategy: parsed.id, plan: parsed, said: null, exit: STOP_ONLY }, gate, { store, connection, receiveMint: async () => coin, now: () => NOW - 4 * HOUR, exitOn: true, botMoneyOn: () => true });
  assert.equal(joined.ok, true, joined.reason);
  const entry = { ...joined.entry, trades: options.trades ?? BUYS, anchor: options.anchor ?? A, marks: options.marks ?? [{ at: NOW - 60_000, price: A * 0.96 }], ...(options.entry ?? {}) };
  await writeEntry(store, entry);
  const rows = [];
  return { store, connection, key: envKey(JSON.stringify([...agentPair.secretKey])).signer, rows, journal: async (row) => void rows.push(row) };
}
/** The deployment's switches as the cron's route hands them in — open here, unless a test closes them. */
const OPEN = { agentExit: true, bots: { grid: true, signals: true } };
const pass = (s, v, at = NOW, switches = OPEN) => runAgentPass({ gate, store: s.store, connection: s.connection, key: s.key, journal: s.journal, venue: v, now: () => at, ...(switches ? { switches } : {}) });
const entryOf = (s) => readEntry(s.store, policy.toBase58(), "devnet");

/* ------------------------------------------------------------------ the grid */

test("the grid sells its deepest level one step up, the money to her wallet, and goes on — the level opens again", async () => {
  const s = await stand("grid:500:5,sell:1");
  const v = venue(at96);
  assert.deepEqual(await pass(s, v), [{ policy: policy.toBase58(), did: "sold" }]);
  assert.deepEqual(v.sold, [554n], "level 2's coins only — level 0 waits for A ÷ 0.95");
  /* The sale ran under the sale's policy, signed by the agent; the money went to her own wSOL. */
  const tx = s.connection.sent[0];
  const keys = tx.message.staticAccountKeys;
  const execution = tx.message.compiledInstructions.find((ix) => keys[ix.programIdIndex].equals(SSA_PROGRAM_ID));
  const view = readPolicyExecute({ programId: SSA_PROGRAM_ID, keys: execution.accountKeyIndexes.map((at) => keys[at]), data: execution.data });
  assert.ok(view.policy.equals(salePolicy));
  assert.ok(view.instructions.at(-1).accounts[LAYOUT.dlmmSwap2.receiver].equals(herWsol));
  assert.deepEqual(s.rows.map((r) => r.outcome), ["SIGNED"]);
  const entry = await entryOf(s);
  assert.equal(entry.status, "working", "a level sold pauses nothing");
  assert.equal(entry.sales.length, 1);
  assert.deepEqual([entry.sales[0].why, entry.sales[0].level, entry.sales[0].soldRaw, entry.sales[0].costRaw], ["grid", 2, "554", SPENT.toString()], "the level carries its own buy's cost");
  assert.deepEqual(entry.events.map((e) => [e.kind, e.why, e.level]), [["sold", "grid", 2]]);
  /* Level 2 is open again for the next buy; level 0 still holds. */
  assert.deepEqual(gridHeld(positionTrades(entry.trades, entry.sales), entry.sales), [0]);
});

test("the lead's review of #1965: a level whose sale is not sure to bring back what it cost waits — nothing is signed", async () => {
  const s = await stand("grid:500:5,sell:1");
  /* At its line by the quote, yet the route's minimum on chain is a lamport under the level's own buy. */
  const v = venue(at96, () => SPENT - 1n);
  const lines = await pass(s, v);
  assert.ok(!lines.some((line) => line.did === "sold"));
  assert.deepEqual(v.sold, [554n], "the sale was built and weighed");
  assert.equal(s.connection.sent.length, 0, "nothing sent");
  assert.deepEqual(s.rows, [], "nothing signed");
  assert.equal((await entryOf(s)).sales?.length ?? 0, 0, "no sale in the book");
  /* The route's minimum within its 1 % and over the cost — the first test of the grid — sells; a minimum further under its
     promise than 1 % is the signer's own refusal, whatever the floor says. */
});

test("a grid that sold every level holds nothing to judge: it buys again as the price comes down to a level", async () => {
  const bought = [{ ...BUYS[1], at: NOW - 6 * HOUR }];
  const soldLevel = { at: NOW - 5 * HOUR, why: "grid", level: 2, status: "ok", signature: "s2", soldRaw: "554", gotRaw: "52000000", costRaw: SPENT.toString(), reason: null };
  /* The books add up: five trades' worth moved in, one spent, four left in the vault. */
  const s = await stand("grid:500:5,sell:1", { trades: bought, coinLeft: 0n, budgetLeft: 4n * SPENT, entry: { sales: [soldLevel], fundRaw: (5n * SPENT).toString() } });
  const v = venue(at96);
  const asked = [];
  v.buy = async (_mandate, amount) => {
    asked.push(amount);
    throw new Error("the stand-in builds no buy");
  };
  await pass(s, v);
  assert.deepEqual(asked, [SPENT], "the buy was due and asked for: no pause for a price of nothing");
  const entry = await entryOf(s);
  assert.equal(entry.status, "working");
  assert.equal(entry.trades.at(-1).level, 0, "the deepest open level the price came to: level 0 at 0.96 A");
});

test("the grid never sells a level under its line: the marks say yes, the quote for its coins says no", async () => {
  const s = await stand("grid:500:5,sell:1");
  /* Exactly those coins fetch 0.94 A a coin now: under the line of 0.95 A. */
  const v = venue(at94);
  const lines = await pass(s, v);
  assert.ok(!lines.some((line) => line.did === "sold"));
  assert.deepEqual(v.sold, []);
  assert.ok(v.asked.includes(554n), "the level's own coins were quoted");
  assert.deepEqual((await entryOf(s)).sales, []);
});

test("a stale price sells nothing: the grid waits for a fresh mark", async () => {
  const s = await stand("grid:500:5,sell:1", { marks: [{ at: NOW - 2 * HOUR, price: A * 0.96 }] });
  /* The quote for a whole coin is what refreshes the mark — make it fail: no price, no sale. */
  const v = venue((amount) => (amount === 1_000_000n ? Promise.reject(new Error("no route")) : at96(amount)));
  const lines = await pass(s, v);
  assert.ok(!lines.some((line) => line.did === "sold"));
  assert.deepEqual(v.sold, []);
});

test("a budget signed before this task — a grid that only buys — works exactly as before: the bot's turn reads nothing", async () => {
  const s = await stand("grid:500:5");
  const entry = await entryOf(s);
  assert.equal(botOfPlan(planFrom(entry.plan)), null);
  const v = venue(at96);
  s.connection.reads.length = 0;
  const answer = await botSaleFor(entry, { gate, store: s.store, connection: s.connection, key: s.key, journal: s.journal, venue: v }, () => NOW);
  assert.equal(answer.line, null);
  assert.equal(answer.entry, entry, "the very same entry back");
  assert.deepEqual(s.connection.reads, [], "not one read of the chain");
  assert.deepEqual(v.asked, [], "not one quote");
  /* And the whole pass: no sale, the levels it bought all held, as before. */
  const lines = await pass(s, v);
  assert.ok(!lines.some((line) => line.did === "sold"));
  assert.deepEqual(v.sold, []);
  assert.deepEqual((await entryOf(s)).sales, []);
});

test("regular buys with the agent's exit are untouched by the bots' turn", async () => {
  const s = await stand("steady");
  const entry = await entryOf(s);
  s.connection.reads.length = 0;
  const v = venue(at96);
  const answer = await botSaleFor(entry, { gate, store: s.store, connection: s.connection, key: s.key, journal: s.journal, venue: v }, () => NOW);
  assert.equal(answer.entry, entry);
  assert.deepEqual(s.connection.reads, []);
});

/* ------------------------------------------------------------------ signals */

const FLAT = (amount) => (amount * 2n * SPENT) / 1_054n;

test("a «cross» signal sells everything once the fast average falls under the slow, and goes on working", async () => {
  const marks = [100, 100, 100, 90].map((price, at) => ({ at: NOW - (4 - at) * 60_000, price: price * 1_000 }));
  const s = await stand("signal:cross:2:3", { marks, trades: BUYS.map(({ level: _l, ...buy }) => buy) });
  const v = venue(FLAT);
  assert.deepEqual(await pass(s, v), [{ policy: policy.toBase58(), did: "sold" }]);
  assert.deepEqual(v.sold, [1_054n], "everything it holds");
  const entry = await entryOf(s);
  assert.equal(entry.status, "working", "a signal's sale pauses nothing");
  assert.equal(entry.sales[0].why, "signal");
  assert.equal(entry.sales[0].costRaw, (2n * SPENT).toString());
  assert.deepEqual(positionTrades(entry.trades, entry.sales), [], "the position is closed: the next buy starts afresh");
  assert.deepEqual(entry.events.map((e) => [e.kind, e.why]), [["sold", "signal"]]);
});

test("a signal over its slow average, or one on the price, sells nothing by itself", async () => {
  const up = [90, 90, 90, 100].map((price, at) => ({ at: NOW - (4 - at) * 60_000, price: price * 1_000 }));
  const s = await stand("signal:cross:2:3", { marks: up, trades: BUYS.map(({ level: _l, ...buy }) => buy) });
  const v = venue(FLAT);
  assert.ok(!(await pass(s, v)).some((line) => line.did === "sold"));
  const t = await stand("signal:above:500", { trades: BUYS.map(({ level: _l, ...buy }) => buy) });
  const w = venue(FLAT);
  assert.ok(!(await pass(t, w)).some((line) => line.did === "sold"));
  assert.deepEqual([...v.sold, ...w.sold], []);
});

/* ------------------------------------------------------------------ joining */

test("a bot's budget joins only where its money is open, and only with the sale signed", async () => {
  const grid = planFrom("grid:500:5,sell:1");
  const signal = planFrom("signal:volume:200");
  const reg = (plan, deps = {}, record = RECORD, exit = STOP_ONLY) =>
    registerMandate({ record, strategy: plan.id, plan, said: null, exit }, gate, { store: createMemoryGuardStore(), connection: chain(), receiveMint: async () => coin, now: () => NOW, exitOn: true, ...deps });
  assert.match((await reg(grid)).reason, /The grid trades on paper here/);
  assert.match((await reg(signal, { botMoneyOn: (bot) => bot === "grid" })).reason, /Signals trade on paper here/);
  const { salePolicy: _s, held: _h, heldDaily: _hd, ...plain } = RECORD;
  assert.match((await reg(grid, { botMoneyOn: () => true }, plain)).reason, /needs its budget signed with the sale/);
  assert.equal((await reg(grid, { botMoneyOn: () => true })).ok, true);
  assert.equal((await reg(signal, { botMoneyOn: (bot) => bot === "signals" })).ok, true);
  /* A grid that only buys is the budget's own plan: no switch of this task stands before it. */
  assert.equal((await reg(planFrom("grid:500:5"), {}, plain, null)).ok, true);
  assert.equal((await stand("grid:500:5,sell:1")).store !== null, true);
  const entry = (await reg(grid, { botMoneyOn: () => true })).entry;
  assert.equal(entry.plan, "grid:500:5,sell:1");
  assert.equal(entry.exit, exitText(STOP_ONLY));
});

test("the switches: closed by default, only «on» opens, a bot's own word over the shared one", () => {
  assert.equal(botMoneyOn("grid", {}), false);
  assert.equal(botMoneyOn("grid", { RYNTRA_BOTS_MONEY: "yes" }), false);
  assert.equal(botMoneyOn("grid", { RYNTRA_BOTS_MONEY: "on" }), true);
  assert.equal(botMoneyOn("signals", { RYNTRA_BOTS_MONEY: " ON " }), true);
  assert.equal(botMoneyOn("grid", { RYNTRA_BOTS_MONEY: "on", RYNTRA_BOTS_GRID_MONEY: "off" }), false);
  assert.equal(botMoneyOn("signals", { RYNTRA_BOTS_MONEY: "on", RYNTRA_BOTS_GRID_MONEY: "off" }), true);
  assert.equal(botMoneyOn("signals", { RYNTRA_BOTS_SIGNALS_MONEY: "on" }), true);
  assert.equal(botMoneyOn("grid", { RYNTRA_BOTS_SIGNALS_MONEY: "on" }), false);
  assert.match(botMoneyRefusal(planFrom("grid:500:5,sell:1"), {}), /paper/);
  assert.equal(botMoneyRefusal(planFrom("grid:500:5"), {}), null, "the budget's own grid needs no switch of this task");
  assert.equal(botMoneyRefusal(planFrom("steady"), {}), null);
  assert.equal(botMoneyRefusal(null, {}), null);
});

test("the sold coins' cost and the event name the level; a grid sale is no full exit", async () => {
  const s = await stand("grid:500:5,sell:1");
  await pass(s, venue(at96));
  const entry = await entryOf(s);
  assert.equal(entry.events[0].share, 100);
  assert.ok(new PublicKey(entry.record.salePolicy).equals(salePolicy));
});

/* ------------------------------------------------------------------ Before the money opens */

/** No switches handed in: what a pass runs by when the cron's route gave none — every one closed. */
const NONE = null;
const herWsolKey = herWsol.toBase58();
/** A grid that sold level 2 and holds nothing: the price at 0.96 A brings level 0's buy due. */
const soldOut = () => ({
  trades: [{ ...BUYS[1], at: NOW - 6 * HOUR }],
  coinLeft: 0n,
  budgetLeft: 4n * SPENT,
  entry: { sales: [{ at: NOW - 5 * HOUR, why: "grid", level: 2, status: "ok", signature: "s2", soldRaw: "554", gotRaw: "52000000", costRaw: SPENT.toString(), reason: null }], fundRaw: (5n * SPENT).toString() },
});
const buysCounted = (v) => {
  const asked = [];
  v.buy = async (_mandate, amount) => {
    asked.push(amount);
    throw new Error("the stand-in builds no buy");
  };
  return asked;
};

test("the engine's switch: a grid whose money is closed buys no new level; what it holds still sells one step up", async () => {
  /* Open: level 0's buy is due and asked for (the stand-in builds none). */
  const open = await stand("grid:500:5,sell:1", soldOut());
  const u = venue(at96);
  const asked = buysCounted(u);
  await pass(open, u);
  assert.deepEqual(asked, [SPENT], "with its money open the grid buys");
  /* Its money closed — or no switch handed in at all: no buy asked, nothing written as bought. */
  for (const switches of [{ agentExit: true, bots: { grid: false, signals: true } }, NONE]) {
    const s = await stand("grid:500:5,sell:1", soldOut());
    const v = venue(at96);
    const none = buysCounted(v);
    assert.deepEqual(await pass(s, v, NOW, switches), [{ policy: policy.toBase58(), did: "waited" }]);
    assert.deepEqual(none, [], JSON.stringify(switches));
    assert.equal((await entryOf(s)).trades.length, 1);
  }
  /* A level it holds sells by its rule with the money closed: what it bought comes home by its rules. */
  const s = await stand("grid:500:5,sell:1");
  const v = venue(at96);
  assert.deepEqual(await pass(s, v, NOW, { agentExit: true, bots: { grid: false, signals: false } }), [{ policy: policy.toBase58(), did: "sold" }]);
  assert.deepEqual(v.sold, [554n]);
});

test("a signal whose money is closed buys nothing on its condition", async () => {
  const fresh = { trades: [], coinLeft: 0n, budgetLeft: 5n * SPENT, anchor: A, marks: [{ at: NOW - 60_000, price: A * 1.1 }], entry: { fundRaw: (5n * SPENT).toString() } };
  const open = await stand("signal:above:500", fresh);
  const v = venue(at96);
  const asked = buysCounted(v);
  await pass(open, v);
  assert.deepEqual(asked, [SPENT], "open: the price over its line buys");
  const shut = await stand("signal:above:500", fresh);
  const w = venue(at96);
  const none = buysCounted(w);
  assert.deepEqual(await pass(shut, w, NOW, { agentExit: true, bots: { grid: true, signals: false } }), [{ policy: policy.toBase58(), did: "waited" }]);
  assert.deepEqual(none, []);
});

test("the agent's own exit closed: a bot sells nothing of its own and buys nothing — her stop still sells everything", async () => {
  const closed = { agentExit: false, bots: { grid: true, signals: true } };
  const s = await stand("grid:500:5,sell:1");
  const v = venue(at96);
  assert.deepEqual(await pass(s, v, NOW, closed), [{ policy: policy.toBase58(), did: "waited" }], "no level sold, no buy asked");
  assert.deepEqual(v.sold, []);
  /* The price falls through her stop (−30 %): everything goes, the money to her wallet. */
  const at60 = (amount) => (amount * SPENT * 60n) / 50_000n;
  const down = venue(at60);
  assert.deepEqual(await pass(s, down, NOW + 2 * 60_000, closed), [{ policy: policy.toBase58(), did: "sold" }]);
  assert.deepEqual(down.sold, [1_054n]);
  const entry = await entryOf(s);
  assert.equal(entry.sales.at(-1).why, "stop");
  assert.equal(entry.status, "paused");
});

test("every switch closed leaves a budget without the agent's sale exactly as it was: regular buys, a grid that only buys", async () => {
  const { salePolicy: _s, held: _h, heldDaily: _d, ...plain } = RECORD;
  for (const text of ["steady", "grid:500:5"]) {
    const asked = [];
    for (const switches of [OPEN, NONE]) {
      const store = createMemoryGuardStore();
      const connection = chain();
      const plan = planFrom(text);
      const joined = await registerMandate({ record: plain, strategy: plan.id, plan, said: null }, gate, { store, connection, receiveMint: async () => coin, now: () => NOW - 4 * HOUR });
      assert.equal(joined.ok, true, joined.reason);
      assert.equal(joined.entry.v, 1);
      await writeEntry(store, { ...joined.entry, fundRaw: (4n * SPENT).toString(), anchor: A, marks: [{ at: NOW - 60_000, price: A * 0.96 }] });
      const s = { store, connection, key: envKey(JSON.stringify([...agentPair.secretKey])).signer, journal: async () => undefined };
      const v = venue(at96);
      const counted = buysCounted(v);
      const lines = await pass(s, v, NOW, switches);
      asked.push({ lines, counted });
    }
    assert.deepEqual(asked[1], asked[0], `${text}: the same pass with every switch closed`);
    assert.deepEqual(asked[0].counted, [SPENT], `${text}: its buy is asked for as ever`);
  }
});

test("the point to roll back to: a bot's entry is one a build of before reads past; her stop still finds it", async () => {
  const s = await stand("grid:500:5,sell:1");
  const book = s.store.collection("agentMandates");
  assert.equal((await book.get(`m:devnet:${policy.toBase58()}`)).v, 2);
  /* The book as every build of before this task reads it (`readBook`: `row.v === 1`): no bot to buy for, nothing to sell. */
  const before = (await book.valuesWithPrefix("m:devnet:")).filter((row) => "record" in row && row.v === 1);
  assert.deepEqual(before, []);
  /* This build reads it, and her stop reads the entry by its key — the sale is named, as before. */
  assert.equal((await readBook(s.store, "devnet")).length, 1);
  assert.ok((await stopSale({ store: s.store, network: "devnet" })({ owner: human, settings, policy }))?.salePolicy.equals(salePolicy));
  /* Every other budget is `v: 1`, as ever. */
  for (const text of ["steady", "grid:500:5"]) {
    const t = await stand(text);
    assert.equal((await t.store.collection("agentMandates").get(`m:devnet:${policy.toBase58()}`)).v, 1, text);
  }
});

test("a price between a level's line and its cost does not stop the grid: no sale signed, the buys go on, no route a minute", async () => {
  const s = await stand("grid:500:5,sell:1", { ...soldOut(), coinLeft: 554n, entry: { fundRaw: (5n * SPENT).toString() } });
  /* At its line by the quote; the route's minimum covers the level's buy, not the signatures of its round trip. */
  const v = venue(at96, () => SPENT + 5_000n);
  const asked = buysCounted(v);
  const lines = await pass(s, v);
  assert.ok(!lines.some((line) => line.did === "sold"));
  assert.deepEqual(v.sold, [554n], "built and weighed once");
  assert.equal(s.connection.sent.length, 0, "nothing sent");
  assert.deepEqual(s.rows, [], "nothing signed");
  assert.deepEqual(asked, [SPENT], "the buys went on: level 0 at 0.96 A");
  assert.deepEqual((await entryOf(s)).gridShort, { level: 2, at: NOW });
  /* A minute on: the level is not built again before the next mark. */
  await pass(s, v, NOW + 60_000);
  assert.deepEqual(v.sold, [554n]);
  /* The next mark: weighed again. */
  await pass(s, v, NOW + 10 * 60_000 + 1);
  assert.deepEqual(v.sold, [554n, 554n]);
});

test("the floor counts the rent of an account the sale opens, and not of one that stands", async () => {
  const opens = (account) => ({ programId: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"), keys: [{ pubkey: agent }, { pubkey: account }], data: Buffer.alloc(1, 1) });
  const missing = Keypair.generate().publicKey;
  for (const [account, short] of [[missing, true], [herWsol, false]]) {
    const s = await stand("grid:500:5,sell:1");
    const base = venue(at96, () => SPENT + gridNetworkRaw({ accountsOpened: 1 }) - 1n);
    const v = { ...base, sell: async (...args) => ({ ...(await base.sell(...args)), setup: [opens(account)] }) };
    await pass(s, v);
    assert.equal((await entryOf(s)).gridShort !== undefined, short, account.toBase58() === herWsolKey ? "her wSOL stands: no rent" : "a new account: its rent counts");
  }
});

test("the quote alone first: while even it does not pay the level's cost, no route is built", async () => {
  /* Level 2 cost 7 % over the trade cap; its coins fetch 0.96 A — at the line, under the cost. */
  const dear = [BUYS[0], { ...BUYS[1], spentRaw: ((SPENT * 107n) / 100n).toString() }];
  const s = await stand("grid:500:5,sell:1", { trades: dear });
  const v = venue(at96);
  const lines = await pass(s, v);
  assert.ok(!lines.some((line) => line.did === "sold"));
  assert.deepEqual(v.sold, [], "no route built");
  assert.ok(v.asked.includes(554n), "the level's coins were quoted");
});

test("a level the day's limit sold in part stays held: the rest is sold as the limit comes back, never bought over", async () => {
  const s = await stand("grid:500:5,sell:1", { entry: { record: { ...RECORD, heldDaily: "300" } } });
  const v = venue(at96);
  assert.deepEqual(await pass(s, v), [{ policy: policy.toBase58(), did: "sold" }]);
  assert.deepEqual(v.sold, [300n]);
  let entry = await entryOf(s);
  assert.equal(entry.sales[0].partial, true);
  assert.equal(entry.sales[0].level, 2);
  assert.deepEqual(gridHeld(positionTrades(entry.trades, entry.sales), entry.sales), [0, 2], "level 2 still held with its 254 coins");
  /* A day on: the rest of level 2 — and only then the level opens. */
  s.connection.balances.set(vaultCoin.toBase58(), 754n);
  await pass(s, v, NOW + 24 * HOUR + 60_000);
  assert.deepEqual(v.sold, [300n, 254n]);
  entry = await entryOf(s);
  assert.equal(entry.sales[1].partial, undefined);
  assert.deepEqual(gridHeld(positionTrades(entry.trades, entry.sales), entry.sales), [0]);
  /* The two parts carried the level's whole cost out between them. */
  assert.equal(BigInt(entry.sales[0].costRaw) + BigInt(entry.sales[1].costRaw), SPENT);
});

test("a «cross» signal over a gap in its marks is not read: it sells nothing", async () => {
  const marks = [
    { at: NOW - 3 * HOUR, price: 100_000 },
    { at: NOW - 2 * 60_000, price: 100_000 },
    { at: NOW - 60_000, price: 90_000 },
  ];
  const s = await stand("signal:cross:2:3", { marks, trades: BUYS.map(({ level: _l, ...buy }) => buy) });
  const v = venue(FLAT);
  assert.ok(!(await pass(s, v)).some((line) => line.did === "sold"));
  assert.deepEqual(v.sold, []);
});
