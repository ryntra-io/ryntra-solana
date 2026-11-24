/* The agent at work leaves a trade on its own: the stop sells everything, half goes at 2x once, the fade and
   the clock sell the rest, a price not read is a wait and then a pause she hears of, her freeze holds every sale, a day
   never sells more than the sale's policy lets out, three refusals in a row pause the tries and tell her — never end
   them — a sale that cannot be built counts for nothing, and her stop takes both policies away, found on chain, and the
   coin home. The devnet chain is a stand-in; the agent's key is one made for the test and the signer judges every sale
   for real. No network. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { Keypair, PublicKey, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { envKey } from "../launch/signer/env.server.ts";
import { mandateOf, readEntry, registerMandate, rememberHeldDaily, writeEntry } from "./book.server.ts";
import { joinBook } from "./agent-service.server.ts";
import { agentTrade } from "./run.server.ts";
import { EXIT_STOP_RETRY_MS, EXIT_UNREAD_MS, SCOUT_EXIT, TRADER_EXIT, exitText } from "./exit.ts";
import { STOP_ASKED_HOLD_MS, agentExitOn, askedStop, failingSales, saleClaimKeys, sellNow, stopSale, watchesExit } from "./exit.server.ts";
import { agentFeeAccount, agentFeeRaw, agentFeeWallet, feeTransferInstruction, uncataloguedFacts } from "./fee.ts";
import { setFrozen } from "./freeze.server.ts";
import { tokenAccountOf } from "./human.ts";
import { budgetFund } from "./budget.ts";
import { BUDGET_PRESETS } from "./presets.ts";
import { MAINNET_GENESIS, reviewStop } from "./service.server.ts";
import { NATIVE_MINT, SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, readPolicyExecute, ssaAddress } from "./ssa.ts";
import { DLMM_PROGRAM_ID, DLMM_SWAP2, LAYOUT, heldAccountOf } from "./terms.ts";
import { runAgentPass } from "./tick.server.ts";

const HOUR = 3_600_000;
const NOW = Date.now();
const SECONDS = (ms) => BigInt(Math.floor(ms / 1000));

const human = Keypair.generate().publicKey;
const agentPair = Keypair.generate();
const agent = agentPair.publicKey;
const attacker = Keypair.generate().publicKey;
const pool = Keypair.generate().publicKey;
const coin = Keypair.generate().publicKey;
const settings = ssaAddress.settings(8n);
const vault = ssaAddress.vault(settings, 0);
const policy = ssaAddress.policy(settings, 1n);
const salePolicy = ssaAddress.policy(settings, 2n);
const budget = tokenAccountOf(vault, NATIVE_MINT);
const vaultCoin = heldAccountOf(vault, { mint: coin, program: TOKEN_PROGRAM_ID });
const herWsol = tokenAccountOf(human, NATIVE_MINT);
const COIN_FEE = agentFeeAccount(coin);
const gate = { open: true, network: "devnet", pool, agent };
const medium = BUDGET_PRESETS.medium;
const HERS = { perDay: medium.perDay, perTrade: medium.perTrade, days: 29 };
const FUND = budgetFund(HERS);
const SPENT = medium.perTrade;
/** The sale's day: what the sale's policy lets out of the vault in a day. */
const DAILY = 2_000n;

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

/* ------------------------------------------------------------------ accounts as the programs write them */

const u16 = (n) => [n & 255, n >> 8];
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24];
const u64 = (n) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
  return [...out];
};
const settingsData = (signers) =>
  Uint8Array.from([223, 179, 163, 190, 177, 224, 67, 173, ...new Array(16).fill(0), ...new Array(32).fill(0), ...u16(1), ...u32(0), ...u64(0), ...u64(0), 0, ...u64(0), 255, ...u32(signers.length), ...signers.flatMap((key) => [...key.toBytes(), 7]), 0, 1, ...u64(2)]);
/** A policy's head (settings, seed, one signer) and the keys and numbers its rules name. */
const policyData = (seed, signer, keys = [], numbers = []) =>
  Uint8Array.from([222, 135, 7, 163, 235, 177, 33, 68, ...settings.toBytes(), ...u64(seed), 255, ...u64(0), ...u64(0), ...u32(1), ...signer.toBytes(), 7, ...u16(1), ...new Array(64).fill(0), ...keys.flatMap((key) => [...key.toBytes()]), ...numbers.flatMap((n) => [3, ...u64(n)])]);
const tokenData = (mint, owner, amount = 0n) => Uint8Array.from([...mint.toBytes(), ...owner.toBytes(), ...u64(amount), ...new Array(93).fill(0)]);
const mintData = () => Uint8Array.from({ length: 82 }, (_, at) => (at === 44 ? 6 : at === 45 ? 1 : 0));

/** The devnet chain as a stand-in: its accounts, its balances, what was sent. */
function chain(options = {}) {
  const account = (owner, data) => ({ owner, data, lamports: 1, executable: false });
  const accounts = new Map([
    [policy.toBase58(), account(SSA_PROGRAM_ID, policyData(1, agent, options.buyKeys ?? [agentFeeAccount(NATIVE_MINT), ...(options.buyKeepsCoin === false ? [] : [vaultCoin])], [medium.perTrade, medium.perDay]))],
    [salePolicy.toBase58(), account(SSA_PROGRAM_ID, policyData(2, options.saleSigner ?? agent, options.saleKeys ?? [vaultCoin, herWsol, COIN_FEE], options.saleNumbers ?? [options.daily ?? DAILY]))],
    [settings.toBase58(), account(SSA_PROGRAM_ID, settingsData([human]))],
    [vaultCoin.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(coin, vault, options.coinLeft ?? 1_000n))],
    [herWsol.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(NATIVE_MINT, human))],
    [coin.toBase58(), account(TOKEN_PROGRAM_ID, mintData())],
    [agentFeeAccount(NATIVE_MINT).toBase58(), account(TOKEN_PROGRAM_ID, tokenData(NATIVE_MINT, agentFeeWallet()))],
    [COIN_FEE.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(coin, agentFeeWallet()))],
  ]);
  if (options.noSale) accounts.delete(salePolicy.toBase58());
  const sent = [];
  const balances = new Map([
    [budget.toBase58(), options.budgetLeft ?? FUND - SPENT],
    [vaultCoin.toBase58(), options.coinLeft ?? 1_000n],
  ]);
  return {
    accounts,
    sent,
    balances,
    getGenesisHash: async () => "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    getAccountInfo: async (key) => accounts.get(key.toBase58()) ?? null,
    getMultipleAccountsInfo: async (keys) => keys.map((key) => accounts.get(key.toBase58()) ?? null),
    getTokenAccountsByOwner: async (owner, { programId }) => ({
      value: [...accounts].filter(([, info]) => info.owner.equals(programId) && info.data.length >= 64 && new PublicKey(info.data.subarray(32, 64)).equals(owner)).map(([key, info]) => ({ pubkey: new PublicKey(key), account: info })),
    }),
    getTokenAccountBalance: async (key) => {
      const amount = balances.get(key.toBase58());
      if (amount === undefined) throw new Error("no such account");
      return { value: { amount: String(amount) } };
    },
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    sendRawTransaction: async (bytes) => {
      if (options.sendFails) throw Object.assign(new Error("simulation failed"), { logs: ["Program log: Error Code: ProgramInteractionModifiedIllegalBalance"] });
      sent.push(VersionedTransaction.deserialize(bytes));
      return "sent";
    },
    getBlockHeight: async () => 1_000_000,
    confirmTransaction: async () => ({ value: { err: null } }),
    getTransaction: async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 90_000, fee: 5_000 } }),
  };
}

/* ------------------------------------------------------------------ the pool, as the devnet venue builds a sale */

const FEE_BPS = 100;
function swap2Sale(amount) {
  const keys = Array.from({ length: 16 }, () => ({ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }));
  keys[LAYOUT.dlmmSwap2.pool] = { pubkey: pool, isSigner: false, isWritable: true };
  keys[LAYOUT.dlmmSwap2.source] = { pubkey: vaultCoin, isSigner: false, isWritable: true };
  keys[LAYOUT.dlmmSwap2.receiver] = { pubkey: herWsol, isSigner: false, isWritable: true };
  keys[LAYOUT.dlmmSwap2.user] = { pubkey: vault, isSigner: true, isWritable: false };
  const data = Buffer.alloc(24);
  Buffer.from(DLMM_SWAP2).copy(data, 0);
  data.writeBigUInt64LE(amount, LAYOUT.dlmmSwap2.inAmount);
  data.writeBigUInt64LE(1_000n, LAYOUT.dlmmSwap2.minOut);
  return new TransactionInstruction({ programId: DLMM_PROGRAM_ID, keys, data });
}
const sold = [];
/** The venue: `price()` is what the coins it holds fetch now; a sale's money as `got`. */
const venue = (price = () => SPENT, extra = {}) => ({
  buy: async () => assert.fail("no buy is due in these passes"),
  received: async () => extra.got ?? 39_000_000n,
  worth: async (_mandate, amount) => {
    const value = await price(amount);
    return value;
  },
  sell: async (_mandate, amount) => {
    sold.push(amount);
    const fee = agentFeeRaw(amount, FEE_BPS);
    return {
      instruction: swap2Sale(amount - fee),
      fee: feeTransferInstruction({ budgetMint: coin, budgetAccount: vaultCoin, vault, fee, decimals: 6 }),
      feeSides: { input: uncataloguedFacts(coin.toBase58()), output: uncataloguedFacts(NATIVE_MINT.toBase58()), nowMs: NOW },
      setup: [],
      promisedOut: 1_000n,
    };
  },
  ...extra,
});

/** The book with one buy an hour ago: 0.05 SOL for 1 000 coins, kept in her vault. */
async function stand(options = {}) {
  const store = createMemoryGuardStore();
  const connection = chain(options);
  const record = options.daily === undefined ? RECORD : { ...RECORD, heldDaily: options.daily.toString() };
  const joined = await registerMandate({ record, strategy: "steady", said: null, exit: options.rules ?? TRADER_EXIT }, gate, { store, connection, receiveMint: async () => coin, now: () => NOW - 2 * HOUR, exitOn: true });
  assert.equal(joined.ok, true, joined.reason);
  const entry = { ...joined.entry, trades: [{ at: options.boughtAt ?? NOW - HOUR, status: "ok", signature: "b", spentRaw: SPENT.toString(), receivedRaw: "1000", reason: null }], ...(options.entry ?? {}) };
  await writeEntry(store, entry);
  const rows = [];
  return { store, connection, key: envKey(JSON.stringify([...agentPair.secretKey])).signer, rows, journal: async (row) => void rows.push(row) };
}
/** The deployment's switches as the cron's route hands them in — the agent's exit open here, unless a test closes it. */
const OPEN = { agentExit: true, bots: { grid: false, signals: false } };
const pass = (s, v, at = NOW, extra = {}) => runAgentPass({ gate, store: s.store, connection: s.connection, key: s.key, journal: s.journal, venue: v, now: () => at, switches: OPEN, ...extra });
const entryOf = (s) => readEntry(s.store, policy.toBase58(), "devnet");

/* ------------------------------------------------------------------ joining */

test("a budget signed with the sale joins with her rules; one whose chain does not hold the sale does not", async () => {
  const s = await stand();
  const entry = await entryOf(s);
  assert.equal(entry.exit, exitText(TRADER_EXIT));
  assert.deepEqual(entry.sales, []);
  const reg = (connection, record = RECORD, exitOn = true) => registerMandate({ record, strategy: "steady", said: null, exit: TRADER_EXIT }, gate, { store: createMemoryGuardStore(), connection, receiveMint: async () => coin, now: () => NOW, exitOn });
  assert.match((await reg(chain({ noSale: true }))).reason, /no such sale on chain/);
  assert.match((await reg(chain({ saleSigner: attacker }))).reason, /the sale names another agent/);
  assert.match((await reg(chain({ saleKeys: [vaultCoin, tokenAccountOf(attacker, NATIVE_MINT), COIN_FEE] }))).reason, /the sale's rules are not the agent's/);
  assert.match((await reg(chain({ buyKeepsCoin: false }))).reason, /the buys do not keep the coin in the vault/);
  assert.match((await registerMandate({ record: RECORD, strategy: "steady", said: null, exit: TRADER_EXIT }, gate, { store: createMemoryGuardStore(), connection: chain(), receiveMint: async () => attacker, now: () => NOW, exitOn: true })).reason, /not the coin it buys/);
  assert.match((await reg(chain(), { ...RECORD, held: attacker.toBase58() })).reason, /the sale's rules are not the agent's/);
  /* The day's limit is the sale's own number on chain — a record that says another is not her signature. */
  assert.match((await reg(chain({ saleNumbers: [] }))).reason, /the day's limit of the coin is not the sale's/);
  assert.match((await reg(chain(), { ...RECORD, heldDaily: "9999" })).reason, /the day's limit of the coin is not the sale's/);
  const { heldDaily: _d, ...noDay } = RECORD;
  assert.match((await reg(chain(), noDay)).reason, /not the coin the agent keeps/);
  /* The deployment's switch off: a budget with the agent's own sale does not join, whatever its chain holds. */
  assert.match((await reg(chain(), RECORD, false)).reason, /does not sell on its own here/);
  const { salePolicy: _s, held: _h, heldDaily: _hd, ...plain } = RECORD;
  assert.match((await reg(chain(), plain)).reason, /only with a budget signed for it/);
  assert.equal(agentExitOn("on"), true);
  assert.equal(agentExitOn(undefined), false);
  assert.equal(agentExitOn("yes"), false);
});

/* ------------------------------------------------------------------ the rules at work */

test("the stop sells everything, the money to her wallet, and pauses: it does not only stop the buys", async () => {
  const s = await stand();
  sold.length = 0;
  /* What it holds now fetches 20 % less than it paid. */
  const lines = await pass(s, venue(() => (SPENT * 80n) / 100n));
  assert.deepEqual(lines, [{ policy: policy.toBase58(), did: "sold" }]);
  assert.deepEqual(sold, [1_000n], "all of it");
  assert.equal(s.connection.sent.length, 1);
  /* The sale ran under the sale's policy, signed by the agent; the money went to her own wSOL. */
  const tx = s.connection.sent[0];
  const keys = tx.message.staticAccountKeys;
  const execution = tx.message.compiledInstructions.find((ix) => keys[ix.programIdIndex].equals(SSA_PROGRAM_ID));
  const view = readPolicyExecute({ programId: SSA_PROGRAM_ID, keys: execution.accountKeyIndexes.map((at) => keys[at]), data: execution.data });
  assert.ok(view.policy.equals(salePolicy));
  assert.ok(view.instructions.at(-1).accounts[LAYOUT.dlmmSwap2.receiver].equals(herWsol));
  const entry = await entryOf(s);
  assert.equal(entry.status, "paused");
  assert.equal(entry.pausedBy, "stop");
  assert.equal(entry.sales.length, 1);
  assert.equal(entry.sales[0].status, "ok");
  assert.equal(entry.sales[0].why, "stop");
  assert.equal(entry.sales[0].soldRaw, "1000");
  assert.equal(entry.sales[0].costRaw, SPENT.toString(), "the whole cost leaves with the whole coin");
  assert.equal(entry.sales[0].gotRaw, "39000000");
  assert.deepEqual(entry.events.map((e) => [e.kind, e.why]), [["sold", "stop"], ["paused", "stop"]]);
  assert.equal(entry.events[0].share, 100);
  assert.equal(entry.events[0].signature.length > 40, true);
  assert.deepEqual(s.rows.map((r) => r.outcome), ["SIGNED"]);
  /* Paused with nothing held: the next pass reads nothing and does nothing. */
  s.connection.balances.set(vaultCoin.toBase58(), 0n);
  assert.deepEqual(await pass(s, venue(() => assert.fail("no price is read"))), []);
});

test("half at 2x, once — the agent goes on with the rest", async () => {
  const s = await stand();
  sold.length = 0;
  assert.deepEqual(await pass(s, venue(() => 2n * SPENT)), [{ policy: policy.toBase58(), did: "sold" }]);
  assert.deepEqual(sold, [500n]);
  let entry = await entryOf(s);
  assert.equal(entry.status, "working", "a half is no full exit");
  assert.equal(entry.sales[0].why, "half");
  assert.equal(entry.sales[0].costRaw, (SPENT / 2n).toString());
  assert.deepEqual(entry.events.map((e) => [e.kind, e.why, e.share]), [["sold", "half", 50]]);
  /* Still 2x on the next pass: the half is taken — no second sale; the buys' turn runs (none is due yet). */
  s.connection.balances.set(vaultCoin.toBase58(), 500n);
  const again = await pass(s, venue(() => SPENT), NOW + 120_000);
  assert.ok(!again.some((line) => line.did === "sold"));
  assert.deepEqual(sold, [500n]);
  entry = await entryOf(s);
  assert.equal(entry.sales.length, 1);
});

test("a price not read is never a sale: it waits, then pauses and tells her once, and goes on when it sees again", async () => {
  const s = await stand();
  sold.length = 0;
  const blind = venue(() => Promise.reject(new Error("Jupiter did not answer")));
  assert.deepEqual(await pass(s, blind), [{ policy: policy.toBase58(), did: "unread" }]);
  assert.equal((await entryOf(s)).exitUnreadSince, NOW);
  assert.deepEqual(await pass(s, blind, NOW + EXIT_UNREAD_MS - 1), [{ policy: policy.toBase58(), did: "unread" }]);
  assert.deepEqual(await pass(s, blind, NOW + EXIT_UNREAD_MS), [{ policy: policy.toBase58(), did: "paused" }]);
  let entry = await entryOf(s);
  assert.equal(entry.status, "paused");
  assert.equal(entry.pausedBy, "blind");
  assert.deepEqual(entry.events.map((e) => [e.kind, e.why]), [["paused", "unread"]]);
  /* Told once. */
  await pass(s, blind, NOW + EXIT_UNREAD_MS + 60_000);
  assert.equal((await entryOf(s)).events.length, 1);
  assert.equal(s.connection.sent.length, 0, "nothing sold blind");
  /* It sees again: the pause lifts, the clock is over. */
  await pass(s, venue(() => SPENT), NOW + EXIT_UNREAD_MS + 120_000);
  entry = await entryOf(s);
  assert.equal(entry.status, "working");
  assert.equal(entry.pausedBy, undefined);
  assert.equal(entry.exitUnreadSince, undefined);
  assert.deepEqual(sold, []);
});

test("the vault not read, or a buy whose coins were not read, is a price not read", async () => {
  const s = await stand({ entry: { trades: [{ at: NOW - HOUR, status: "ok", signature: "b", spentRaw: SPENT.toString(), receivedRaw: null, reason: null }] } });
  s.connection.getTransaction = async () => null;
  assert.deepEqual(await pass(s, venue(() => assert.fail("not asked"), { received: async () => null })), [{ policy: policy.toBase58(), did: "unread" }]);
  const t = await stand();
  t.connection.balances.delete(vaultCoin.toBase58());
  assert.deepEqual(await pass(t, venue(() => assert.fail("not asked"))), [{ policy: policy.toBase58(), did: "unread" }]);
});

test("the fade and the clock sell everything", async () => {
  const quiet = async () => ({ volumeH6Usd: 1_000, volumeH24Usd: 100_000 });
  const s = await stand();
  sold.length = 0;
  assert.deepEqual(await pass(s, venue(), NOW, { market: quiet }), [{ policy: policy.toBase58(), did: "sold" }]);
  assert.equal((await entryOf(s)).pausedBy, "fade");
  const t = await stand({ rules: SCOUT_EXIT, boughtAt: NOW - 25 * HOUR });
  assert.deepEqual(await pass(t, venue()), [{ policy: policy.toBase58(), did: "sold" }]);
  assert.equal((await entryOf(t)).pausedBy, "time");
  assert.deepEqual(sold, [1_000n, 1_000n]);
  /* A day's trading not read is no fade. */
  const u = await stand();
  assert.ok(!(await pass(u, venue(), NOW, { market: async () => Promise.reject(new Error("down")) })).some((line) => line.did === "sold"));
});

test("paused by the autostop or with its budget spent, it still watches its exit — but never with money it cannot explain", async () => {
  for (const [status, pausedBy, sells] of [["paused", "loss", true], ["spent", undefined, true], ["paused", "mismatch", false], ["stopped", undefined, false], ["ended", undefined, false]]) {
    const s = await stand({ entry: { status, ...(pausedBy ? { pausedBy } : {}) } });
    const lines = await pass(s, venue(() => (SPENT * 80n) / 100n));
    assert.equal(lines.some((line) => line.did === "sold"), sells, `${status} ${pausedBy ?? ""}`);
  }
});

test("her freeze holds every sale", async () => {
  const s = await stand();
  assert.equal((await setFrozen({ owner: human.toBase58(), policy: policy.toBase58(), frozen: true }, "devnet", { store: s.store, now: () => NOW - 1 })).ok, true);
  assert.deepEqual(await pass(s, venue(() => (SPENT * 50n) / 100n)), [{ policy: policy.toBase58(), did: "frozen" }]);
  assert.equal(s.connection.sent.length, 0);
});

test("three sales in a row refused: the buys pause and she hears it once; it tries again after a pause — it never gives up her stop", async () => {
  const options = { sendFails: true };
  const s = await stand(options);
  const half = venue(() => (SPENT * 50n) / 100n);
  for (let n = 0; n < 3; n += 1) assert.deepEqual(await pass(s, half, NOW + n * 60_000), [{ policy: policy.toBase58(), did: "failed" }]);
  let entry = await entryOf(s);
  assert.equal(failingSales(entry.sales), 3);
  assert.equal(entry.status, "paused");
  assert.equal(entry.pausedBy, "failing");
  assert.deepEqual(entry.events.map((e) => [e.kind, e.why]), [["paused", "refused"], ["exit_failed", "stop"]]);
  assert.equal(entry.events[1].tries, 3);
  /* Her stop is tried again on the next pass, five minutes on — not half an hour later at a deeper loss. */
  assert.equal(entry.events[1].retryAt, NOW + 2 * 60_000 + EXIT_STOP_RETRY_MS);
  assert.equal(watchesExit(entry), true, "the watch goes on");
  /* Within the pause: no try, nothing paid. */
  assert.deepEqual(await pass(s, half, NOW + 5 * 60_000), [{ policy: policy.toBase58(), did: "waited" }]);
  assert.equal((await entryOf(s)).sales.length, 3);
  /* The pause over: it tries again — refused again, and she is not told twice for the same stretch. */
  assert.deepEqual(await pass(s, half, NOW + 2 * 60_000 + EXIT_STOP_RETRY_MS), [{ policy: policy.toBase58(), did: "failed" }]);
  entry = await entryOf(s);
  assert.equal(entry.events.filter((e) => e.kind === "exit_failed").length, 1);
  /* The chain takes it again: the stop is sold. */
  options.sendFails = false;
  assert.deepEqual(await pass(s, half, NOW + 3 * 60_000 + 2 * EXIT_STOP_RETRY_MS), [{ policy: policy.toBase58(), did: "sold" }]);
  entry = await entryOf(s);
  assert.equal(entry.sales.at(-1).status, "ok");
  assert.equal(entry.sales.at(-1).why, "stop");
});

test("a sale that cannot be built — the network, Jupiter's 429, the route — is no failed sale: next minute again, and she hears once if it lasts", async () => {
  const s = await stand();
  const stop = () => (SPENT * 80n) / 100n;
  const down = venue(stop, { sell: async () => Promise.reject(new Error("Jupiter did not build: HTTP 429")) });
  for (let n = 0; n < 4; n += 1) assert.deepEqual(await pass(s, down, NOW + n * 60_000), [{ policy: policy.toBase58(), did: "waited" }]);
  let entry = await entryOf(s);
  assert.deepEqual(entry.sales, [], "no failed sale in the book");
  assert.equal(failingSales(entry.sales), 0);
  assert.equal(entry.exitStuckSince, NOW);
  assert.equal(entry.status, "working");
  assert.equal(entry.events, undefined);
  /* It lasts half an hour: she hears it — once. */
  await pass(s, down, NOW + EXIT_UNREAD_MS);
  await pass(s, down, NOW + EXIT_UNREAD_MS + 60_000);
  entry = await entryOf(s);
  assert.deepEqual(entry.events.map((e) => [e.kind, e.why, e.tries]), [["exit_failed", "stop", 0]]);
  assert.equal(s.connection.sent.length, 0);
  /* Jupiter answers again: the stop is sold and the stretch is over. */
  assert.deepEqual(await pass(s, venue(stop), NOW + EXIT_UNREAD_MS + 120_000), [{ policy: policy.toBase58(), did: "sold" }]);
  entry = await entryOf(s);
  assert.equal(entry.exitStuckSince, undefined);
});

test("never more in a day than the sale's policy lets out: a stop past it sells the day's share, the rest the next day", async () => {
  const s = await stand({ daily: 600n });
  sold.length = 0;
  /* What it holds fetches 20 % less than it paid, coin for coin. */
  const down = venue((amount) => (amount * SPENT * 80n) / 100n / 1_000n);
  assert.deepEqual(await pass(s, down), [{ policy: policy.toBase58(), did: "sold" }]);
  let entry = await entryOf(s);
  assert.deepEqual(sold, [600n]);
  assert.equal(entry.sales[0].partial, true);
  assert.equal(entry.sales[0].costRaw, ((SPENT * 600n) / 1_000n).toString());
  assert.equal(entry.status, "paused");
  assert.equal(entry.pausedBy, "stop");
  assert.equal(entry.events[0].partial, true);
  /* The day's limit is spent: nothing more today, nothing sent. */
  s.connection.balances.set(vaultCoin.toBase58(), 400n);
  assert.deepEqual(await pass(s, down, NOW + 2 * 60_000), [{ policy: policy.toBase58(), did: "waited" }]);
  assert.equal(s.connection.sent.length, 1);
  /* A day on: the rest of the stop — the position was not closed by a part of it. */
  assert.deepEqual(await pass(s, down, NOW + 24 * HOUR + 60_000), [{ policy: policy.toBase58(), did: "sold" }]);
  entry = await entryOf(s);
  assert.deepEqual(sold, [600n, 400n]);
  assert.equal(entry.sales[1].partial, undefined);
  assert.equal(entry.sales[1].why, "stop");
  assert.deepEqual(entry.events.map((e) => e.kind), ["sold", "paused", "sold"], "paused once");
});

test("her stop removed the buy's policy: the agent sells nothing more, even were the sale's policy still to stand", async () => {
  const s = await stand();
  s.connection.accounts.delete(policy.toBase58());
  assert.deepEqual(await pass(s, venue(() => (SPENT * 50n) / 100n)), [{ policy: policy.toBase58(), did: "stopped" }]);
  const entry = await entryOf(s);
  assert.equal(entry.status, "stopped");
  assert.equal(watchesExit(entry), false);
  assert.equal(s.connection.sent.length, 0);
});

test("one claim a minute: a second instance on the same minute does not sell again", async () => {
  const s = await stand();
  const v = venue(() => (SPENT * 80n) / 100n);
  await s.store.collection("agentMandates").insertIfAbsent(`x:devnet:${policy.toBase58()}:${Math.floor(NOW / 60_000)}`, { claimedAt: NOW });
  assert.deepEqual(await pass(s, v), [{ policy: policy.toBase58(), did: "waited" }]);
  assert.equal(s.connection.sent.length, 0);
});

/* ------------------------------------------------------------------ her stop */

const stopKeys = (answer) => {
  assert.equal(answer.ok, true, answer.reason);
  return VersionedTransaction.deserialize(Buffer.from(answer.transactions[0], "base64")).message.staticAccountKeys.map(String);
};
const herCoin = tokenAccountOf(human, coin);
const stopInput = { owner: human.toBase58(), settings: settings.toBase58(), policy: policy.toBase58() };

test("her stop removes both policies in one signature, found on chain — with the book's word, without it, or with a book that fails — and the coin comes home", async () => {
  const s = await stand();
  for (const deps of [{ sale: stopSale({ store: s.store, network: "devnet" }) }, {}, { sale: async () => Promise.reject(new Error("the store did not answer")) }]) {
    const keys = stopKeys(await reviewStop(stopInput, "devnet", s.connection, deps));
    assert.ok(keys.includes(policy.toBase58()) && keys.includes(salePolicy.toBase58()), "both policies");
    assert.ok(keys.includes(vaultCoin.toBase58()) && keys.includes(herCoin.toBase58()), "the coin home to her own account");
  }
  /* A stranger's stop is no stop of hers, and the book gives no sale for it. */
  assert.equal(await stopSale({ store: s.store, network: "devnet" })({ owner: attacker, settings, policy }), null);
  void MAINNET_GENESIS;
});

test("a policy at the next seed that is not the agent's sale of this budget stays where it is — and a stop without one is the stop it always was", async () => {
  for (const options of [{ saleSigner: attacker }, { saleKeys: [vaultCoin, COIN_FEE] }, { buyKeepsCoin: false }, { noSale: true }]) {
    const keys = stopKeys(await reviewStop(stopInput, "devnet", chain(options)));
    assert.ok(keys.includes(policy.toBase58()));
    assert.ok(!keys.includes(salePolicy.toBase58()), JSON.stringify(Object.keys(options)));
    assert.ok(!keys.includes(herCoin.toBase58()), "no coin is taken anywhere without the agent's own sale");
  }
  /* The stop of a mandate with no sale of the agent's own: the buy's policy removed, the budget home — two instructions, as before. */
  const plain = await reviewStop(stopInput, "devnet", chain({ noSale: true }));
  const message = VersionedTransaction.deserialize(Buffer.from(plain.transactions[0], "base64")).message;
  assert.equal(message.compiledInstructions.length, 2);
});

test("the buy's policy gone already: the sale the book names, at the seed after the buy's and signed by the gate's agent, still goes", async () => {
  const s = await stand();
  s.connection.accounts.delete(policy.toBase58());
  const sale = stopSale({ store: s.store, network: "devnet" });
  const keys = stopKeys(await reviewStop(stopInput, "devnet", s.connection, { sale, agent }));
  assert.ok(keys.includes(salePolicy.toBase58()));
  /* Neither the agent's address nor the book's word: nothing names whose sale it is, and it is left alone. */
  assert.ok(!stopKeys(await reviewStop(stopInput, "devnet", s.connection, { sale })).includes(salePolicy.toBase58()));
  assert.ok(!stopKeys(await reviewStop(stopInput, "devnet", s.connection, { agent })).includes(salePolicy.toBase58()));
  assert.ok(!stopKeys(await reviewStop(stopInput, "devnet", s.connection, { sale, agent: attacker })).includes(salePolicy.toBase58()));
});

test("«nothing to stop» only when nothing at all is left — the coin in her vault, or the tidying alone, is not nothing", async () => {
  const s = await stand();
  s.connection.accounts.delete(policy.toBase58());
  s.connection.accounts.delete(salePolicy.toBase58());
  s.connection.balances.delete(budget.toBase58());
  const sale = stopSale({ store: s.store, network: "devnet" });
  const home = stopKeys(await reviewStop(stopInput, "devnet", s.connection, { sale, agent }));
  assert.ok(home.includes(herCoin.toBase58()), "the coin comes home");
  s.connection.accounts.delete(vaultCoin.toBase58());
  const tidy = async () => ({ policies: [], empty: [], unwrap: herWsol });
  assert.ok(stopKeys(await reviewStop(stopInput, "devnet", s.connection, { tidy, sale })).includes(herWsol.toBase58()), "the tidying alone");
  /* A mandate with no sale of the agent's own answers as it always did: nothing of the mandate left is «nothing». */
  const plain = await reviewStop(stopInput, "devnet", s.connection, { tidy });
  assert.equal(plain.code, "NOTHING");
  const none = await reviewStop(stopInput, "devnet", s.connection, { sale });
  assert.equal(none.ok, false);
  assert.equal(none.code, "NOTHING");
});

test("the window and the report: what it holds is in her vault, and what its own sales brought counts", async () => {
  const { agentSalesView } = await import("./exit.server.ts");
  const entry = { record: RECORD, trades: [{ at: 1, status: "ok", signature: "b", spentRaw: "50", receivedRaw: "1000", reason: null }], sales: [{ at: 2, why: "half", status: "ok", signature: "s", soldRaw: "500", gotRaw: "70", costRaw: "25", reason: null }] };
  assert.deepEqual(agentSalesView(entry, 500n), { heldRaw: "500", soldRaw: "500", gotRaw: "70", lastSale: { policy: salePolicy.toBase58(), status: "sold", signature: "s", soldRaw: "500", receivedRaw: "70", reason: null } });
  /* The vault holds less than the book: the vault's figure. A sale in flight holds its coins out and brings nothing yet. */
  assert.equal(agentSalesView(entry, 300n).heldRaw, "300");
  const flying = { ...entry, sales: [...entry.sales, { at: 3, why: "stop", status: "failed", signature: "t", soldRaw: "500", gotRaw: null, costRaw: "25", unsettled: true, reason: "not confirmed in time" }] };
  assert.deepEqual([agentSalesView(flying, 500n).heldRaw, agentSalesView(flying, 500n).gotRaw, agentSalesView(flying, 500n).lastSale.status], ["0", "70", "signed"]);
});

test("after the half at 2x the buys go on, judged by what it holds now at the price now — no loss is read into the sold half", async () => {
  const { feeTransferInstruction: feeOf } = await import("./fee.ts");
  const buySwap = (amount) => {
    const keys = Array.from({ length: 16 }, () => ({ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }));
    keys[LAYOUT.dlmmSwap2.pool] = { pubkey: pool, isSigner: false, isWritable: true };
    keys[LAYOUT.dlmmSwap2.source] = { pubkey: budget, isSigner: false, isWritable: true };
    keys[LAYOUT.dlmmSwap2.receiver] = { pubkey: vaultCoin, isSigner: false, isWritable: true };
    keys[LAYOUT.dlmmSwap2.user] = { pubkey: vault, isSigner: true, isWritable: false };
    const data = Buffer.alloc(24);
    Buffer.from(DLMM_SWAP2).copy(data, 0);
    data.writeBigUInt64LE(amount, LAYOUT.dlmmSwap2.inAmount);
    data.writeBigUInt64LE(1n, LAYOUT.dlmmSwap2.minOut);
    return new TransactionInstruction({ programId: DLMM_PROGRAM_ID, keys, data });
  };
  const half = { at: NOW - 4 * HOUR, why: "half", status: "ok", signature: "h", soldRaw: "500", gotRaw: "50000000", costRaw: (SPENT / 2n).toString(), reason: null };
  const s = await stand({ boughtAt: NOW - 6 * HOUR, coinLeft: 500n, entry: { sales: [half] } });
  /* 500 coins left fetch 0.05 SOL — still 2x the price paid; the half is taken, so no sale. */
  const asked = [];
  const v = venue((amount) => (asked.push(amount), amount * 100_000n), {
    buy: async (_mandate, amount) => {
      const fee = agentFeeRaw(amount, FEE_BPS);
      return { instruction: buySwap(amount - fee), fee: feeOf({ budgetMint: NATIVE_MINT, budgetAccount: budget, vault, fee, decimals: 9 }), feeSides: { input: null, output: uncataloguedFacts(coin.toBase58()), nowMs: NOW }, setup: [], promisedOut: 1n };
    },
  });
  const lines = await pass(s, v);
  assert.deepEqual(lines, [{ policy: policy.toBase58(), did: "bought" }]);
  assert.ok(asked.every((amount) => amount === 500n), "only what it holds is quoted");
  const entry = await entryOf(s);
  assert.equal(entry.status, "working");
  assert.equal(entry.trades.length, 2);
});

/* ------------------------------------------------------------------ Before the switches open */

const CLOSED = { switches: { agentExit: false, bots: { grid: false, signals: false } } };

test("the agent's own exit closed on the deployment: half at 2x and the clock wait; her stop still sells everything", async () => {
  sold.length = 0;
  const s = await stand();
  assert.ok(!(await pass(s, venue(() => 2n * SPENT), NOW, CLOSED)).some((line) => line.did === "sold"), "2x: the half waits");
  const t = await stand({ rules: SCOUT_EXIT, boughtAt: NOW - 25 * HOUR });
  assert.ok(!(await pass(t, venue(() => SPENT), NOW, CLOSED)).some((line) => line.did === "sold"), "a day on: the clock waits");
  /* No switch handed in at all: the same. */
  assert.ok(!(await pass(s, venue(() => 2n * SPENT), NOW + 60_000, { switches: undefined })).some((line) => line.did === "sold"));
  assert.deepEqual(sold, []);
  assert.equal(s.connection.sent.length + t.connection.sent.length, 0);
  /* −20 %: her stop is never closed by the switch. */
  assert.deepEqual(await pass(s, venue(() => (SPENT * 80n) / 100n), NOW + 120_000, CLOSED), [{ policy: policy.toBase58(), did: "sold" }]);
  const entry = await entryOf(s);
  assert.equal(entry.sales.at(-1).why, "stop");
  assert.equal(entry.pausedBy, "stop");
  assert.deepEqual(sold, [1_000n]);
});

test("her stop asked for: for two minutes the agent starts no sale of its own but her stop's — a sale landing first would fail her stop", async () => {
  sold.length = 0;
  const s = await stand();
  const marks = [];
  const asked = askedStop({ store: s.store, network: "devnet", now: () => NOW });
  const answer = await reviewStop(stopInput, "devnet", s.connection, { sale: stopSale({ store: s.store, network: "devnet" }), asked: async (key) => (marks.push(key.toBase58()), asked(key)) });
  assert.equal(answer.ok, true, answer.reason);
  assert.deepEqual(marks, [policy.toBase58()], "building her stop marked it");
  /* 2x a minute later: the half waits while her stop may land. */
  assert.deepEqual(await pass(s, venue(() => 2n * SPENT), NOW + 60_000), [{ policy: policy.toBase58(), did: "waited" }]);
  assert.deepEqual(sold, []);
  /* Her own rules' stop is never held. */
  const t = await stand();
  await askedStop({ store: t.store, network: "devnet", now: () => NOW })(policy);
  assert.deepEqual(await pass(t, venue(() => (SPENT * 80n) / 100n), NOW + 60_000), [{ policy: policy.toBase58(), did: "sold" }]);
  /* Past the hold — her stop landed or its blockhash ran out: the half goes. */
  sold.length = 0;
  assert.deepEqual(await pass(s, venue(() => 2n * SPENT), NOW + STOP_ASKED_HOLD_MS + 1), [{ policy: policy.toBase58(), did: "sold" }]);
  assert.deepEqual(sold, [500n]);
  /* A stop of a budget with no sale of the agent's own marks nothing. */
  const plainMarks = [];
  await reviewStop(stopInput, "devnet", chain({ noSale: true }), { asked: async (key) => void plainMarks.push(key) });
  assert.deepEqual(plainMarks, []);
});

test("one sale for one state of the book: two instances that read it on either side of a minute never both sell", async () => {
  const s = await stand();
  const stale = await entryOf(s);
  const deps = { gate, store: s.store, connection: s.connection, key: s.key, journal: s.journal, venue: venue(() => (SPENT * 80n) / 100n), switches: OPEN };
  const mandate = mandateOf(stale, gate);
  const position = { heldRaw: 1_000n, costRaw: SPENT };
  const stop = { why: "stop", share: 100, amountRaw: 1_000n };
  /* 12:04:59.9 and 12:05:00.1 — two minutes, two buckets, the same book. */
  const edge = Math.floor(NOW / 300_000) * 300_000 + 299_900;
  assert.equal((await sellNow(stale, mandate, stop, position, deps, edge, agentTrade)).line, "sold");
  assert.equal((await sellNow(stale, mandate, stop, position, deps, edge + 200, agentTrade)).line, "waited", "the other instance read the same book: it does not sell again");
  assert.equal(s.connection.sent.length, 1);
  /* The claims of a sale: the minute's, and the state's in this bucket and the one before. */
  const claims = saleClaimKeys("devnet", policy.toBase58(), [], edge + 200);
  assert.equal(claims.state.length, 2);
  assert.ok(claims.state.includes(saleClaimKeys("devnet", policy.toBase58(), [], edge).state[0]), "the bucket before is this one's");
  /* With the sale in the book the state is new: the next sale the rules call for is free to go. */
  const after = await entryOf(s);
  assert.notDeepEqual(saleClaimKeys("devnet", policy.toBase58(), after.sales, edge + 200).state, claims.state);
});

test("her stop finds the agent's sale and its coin from the policies' own bytes when the book and the vault's scan are silent", async () => {
  /* The sale's day limit names the coin's mint, as the program keeps it; no book, and an RPC that refuses the scan. */
  const c = chain({ saleKeys: [vaultCoin, herWsol, COIN_FEE, coin] });
  c.getTokenAccountsByOwner = async () => Promise.reject(new Error("method not allowed"));
  const keys = stopKeys(await reviewStop(stopInput, "devnet", c));
  assert.ok(keys.includes(policy.toBase58()) && keys.includes(salePolicy.toBase58()), "both policies");
  assert.ok(keys.includes(vaultCoin.toBase58()) && keys.includes(herCoin.toBase58()), "and the coin home");
  /* The vault's account of the coin closed already: the sale's policy still goes. */
  c.accounts.delete(vaultCoin.toBase58());
  assert.ok(stopKeys(await reviewStop(stopInput, "devnet", c)).includes(salePolicy.toBase58()));
});

test("lead's review of #1972: on Jupiter's policies — the vault's wSOL and SOL's mint named before the coin — her stop takes the coin home, never the budget twice", async () => {
  /* Jupiter's sale names the vault's own account of wSOL (the budget's, which the buy names too) and SOL's mint before the
     coin's day limit: the scan of the policy's bytes must not take wSOL for the coin the agent keeps. */
  const c = chain({ buyKeys: [agentFeeAccount(NATIVE_MINT), budget, vaultCoin], saleKeys: [budget, NATIVE_MINT, vaultCoin, herWsol, COIN_FEE, coin] });
  c.getTokenAccountsByOwner = async () => Promise.reject(new Error("method not allowed"));
  const answer = await reviewStop(stopInput, "devnet", c);
  const keys = stopKeys(answer);
  assert.ok(keys.includes(salePolicy.toBase58()), "the sale's policy goes");
  assert.ok(keys.includes(vaultCoin.toBase58()) && keys.includes(herCoin.toBase58()), "the coin comes home");
});

test("the sale's place not read: no stop that would leave the agent's sale standing — «not readable», she taps again", async () => {
  const c = chain();
  const read = c.getAccountInfo;
  c.getAccountInfo = async (key, ...rest) => (key.equals(salePolicy) ? Promise.reject(new Error("429")) : read(key, ...rest));
  const answer = await reviewStop(stopInput, "devnet", c);
  assert.deepEqual([answer.ok, answer.code], [false, "UNAVAILABLE"]);
  assert.match(answer.reason, /not readable/);
  /* Read again: the stop with both policies. */
  c.getAccountInfo = read;
  assert.ok(stopKeys(await reviewStop(stopInput, "devnet", c)).includes(salePolicy.toBase58()));
});

test("a budget with the agent's sale joins the book only with the coin's day limit Ryntra itself read for it", async () => {
  const store = { ...createMemoryGuardStore(), durability: "DURABLE_SINGLE_WRITER" };
  const ask = { record: RECORD, strategy: "steady", said: null, exit: TRADER_EXIT };
  const deps = { store, connection: chain(), receiveMint: async () => coin, now: () => NOW, exitOn: true };
  assert.match((await joinBook(ask, gate, deps)).reason, /day limit is not the one Ryntra read/);
  await rememberHeldDaily(store, "devnet", { policy: policy.toBase58(), heldDaily: (DAILY - 1n).toString() });
  assert.match((await joinBook(ask, gate, deps)).reason, /day limit/, "another figure is not it");
  await rememberHeldDaily(store, "devnet", { policy: policy.toBase58(), heldDaily: DAILY.toString() });
  const joined = await joinBook(ask, gate, deps);
  assert.equal(joined.ok, true, joined.reason);
  /* A book that does not answer is no «yes». */
  assert.equal((await joinBook(ask, gate, { ...deps, heldTicket: async () => Promise.reject(new Error("down")) })).code, "UNAVAILABLE");
  /* Regular buys are not asked. */
  const { salePolicy: _s, held: _h, heldDaily: _d, ...plain } = RECORD;
  const other = await joinBook({ record: plain, strategy: "steady", said: null }, gate, { ...deps, store: { ...createMemoryGuardStore(), durability: "DURABLE_SINGLE_WRITER" }, heldTicket: async () => assert.fail("not asked") });
  assert.doesNotMatch(other.reason ?? "", /day limit/);
});
