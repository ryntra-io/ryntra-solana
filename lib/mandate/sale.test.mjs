/* CITY-187 — the person sells what her agent bought, from the tower's window: the share, the review, the agent's sale,
   the receipt, the way back and what the window shows. Nothing here reaches a network or a real key: the chain is a
   stand-in, the agent's key a key made for the test. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { envKey } from "../launch/signer/env.server.ts";
import { writeEntry } from "./book.server.ts";
import { agentFeeAccount, agentFeeRaw, agentFeeWallet } from "./fee.ts";
import { tokenAccountOf } from "./human.ts";
import { BUDGET_PRESETS } from "./presets.ts";
import { LIGHTHOUSE_PROGRAM_ID, readReceivedAtLeast } from "./result.ts";
import { SALE_SECONDS, SALE_SHARES, agentHolding, earnedWithSales, isSaleShare, saleAmount, saleFloor } from "./sale.ts";
import { goSale, readSale, readSales, reviewSale, reviewSaleBack, runSalePass, saleChainRefusal, salesView, writeSale } from "./sale.server.ts";
import { NATIVE_MINT, SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, readPolicyExecute, ssaAddress } from "./ssa.ts";
import { DLMM_PROGRAM_ID, DLMM_SWAP2, feeMintOf, mandatePolicy, termsRefusal } from "./terms.ts";
import { TOKEN_2022_PROGRAM_ID } from "./token-2022.ts";
import { viewOf } from "./agent-service.server.ts";

const HOUR = 3_600_000;
const NOW = Date.now();
const SECONDS = (ms) => BigInt(Math.floor(ms / 1000));
const DEVNET = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

const humanPair = Keypair.generate();
const human = humanPair.publicKey;
const agentPair = Keypair.generate();
const agent = agentPair.publicKey;
const attacker = Keypair.generate().publicKey;
const pool = Keypair.generate().publicKey;
const coin = Keypair.generate().publicKey;
const settings = ssaAddress.settings(7n);
const vault = ssaAddress.vault(settings, 0);
const buyPolicy = ssaAddress.policy(settings, 1n);
const salePolicy = ssaAddress.policy(settings, 2n);
const herCoin = tokenAccountOf(human, coin);
const herWsol = tokenAccountOf(human, NATIVE_MINT);
const vaultCoin = tokenAccountOf(vault, coin);
const gate = { open: true, network: "devnet", pool, agent };
const medium = BUDGET_PRESETS.medium;
const FEE_COIN = agentFeeAccount(coin);

/* The agent bought 1 000 000 base units of the coin for her in two buys. */
const BOUGHT = 1_000_000n;
const BUY_RECORD = {
  owner: human.toBase58(),
  settings: settings.toBase58(),
  vault: vault.toBase58(),
  policy: buyPolicy.toBase58(),
  budget: tokenAccountOf(vault, NATIVE_MINT).toBase58(),
  perTrade: medium.perTrade.toString(),
  perDay: medium.perDay.toString(),
  expiresAt: String(SECONDS(NOW + 29 * 24 * HOUR)),
};
const ENTRY = {
  v: 1,
  cluster: "devnet",
  record: BUY_RECORD,
  preset: "medium",
  strategy: "steady",
  said: null,
  receiveMint: coin.toBase58(),
  status: "working",
  trades: [
    { at: NOW - 2 * HOUR, status: "ok", signature: "a", spentRaw: medium.perTrade.toString(), receivedRaw: "600000", reason: null },
    { at: NOW - HOUR, status: "failed", signature: null, spentRaw: "0", receivedRaw: null, reason: "x" },
    { at: NOW - HOUR / 2, status: "ok", signature: "b", spentRaw: medium.perTrade.toString(), receivedRaw: "400000", reason: null },
  ],
  createdAt: NOW - 3 * HOUR,
  updatedAt: NOW - HOUR / 2,
};

/* ------------------------------------------------------------------ accounts as the program writes them */

const u16 = (n) => [n & 255, n >> 8];
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24];
const u64 = (n) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
  return [...out];
};
const settingsData = (signers, seed = 1) =>
  Uint8Array.from([223, 179, 163, 190, 177, 224, 67, 173, ...new Array(16).fill(0), ...new Array(32).fill(0), ...u16(1), ...u32(0), ...u64(0), ...u64(0), 0, ...u64(0), 255, ...u32(signers.length), ...signers.flatMap((key) => [...key.toBytes(), 7]), 0, 1, ...u64(seed)]);
/* A sale's policy as the program writes it: its head, then rules naming Ryntra's account of the coin and her SOL account. */
/* The sale of the reviews below: half of what the agent bought, the floor from the pool's quote less 1 %. */
const SOLD = 500_000n;
const FLOOR = saleFloor((SOLD - SOLD / 100n) / 100n);
const salePolicyData = (signer = agent, names = [FEE_COIN, herWsol], numbers = [SOLD, FLOOR]) =>
  Uint8Array.from([222, 135, 7, 163, 235, 177, 33, 68, ...settings.toBytes(), ...u64(2), 255, ...u64(0), ...u64(0), ...u32(1), ...signer.toBytes(), 7, ...u16(1), ...new Array(64).fill(0), ...names.flatMap((key) => [...key.toBytes()]), ...numbers.flatMap((n) => u64(n))]);
const tokenData = (mint, owner, amount = 0n) => Uint8Array.from([...mint.toBytes(), ...owner.toBytes(), ...u64(amount), ...new Array(93).fill(0)]);
const mintData = (decimals = 6) => Uint8Array.from({ length: 82 }, (_, at) => (at === 44 ? decimals : at === 45 ? 1 : 0));

/** Devnet as a stand-in: accounts, token balances, what was sent. */
function chain(options = {}) {
  const account = (owner, data) => ({ owner, data, lamports: 1, executable: false });
  const accounts = new Map([
    [settings.toBase58(), account(SSA_PROGRAM_ID, settingsData([human]))],
    [coin.toBase58(), account(options.coinProgram ?? TOKEN_PROGRAM_ID, mintData())],
    [herCoin.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(coin, human, options.wallet ?? BOUGHT))],
    [herWsol.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(NATIVE_MINT, human, 5_000n))],
    ...(options.feeAccount === false ? [] : [[FEE_COIN.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(coin, agentFeeWallet()))]]),
  ]);
  const balances = new Map([[herCoin.toBase58(), options.wallet ?? BOUGHT]]);
  const sent = [];
  return {
    accounts,
    balances,
    sent,
    getGenesisHash: async () => DEVNET,
    getAccountInfo: async (key) => accounts.get(key.toBase58()) ?? null,
    getMultipleAccountsInfo: async (keys) => keys.map((key) => accounts.get(key.toBase58()) ?? null),
    getTokenAccountBalance: async (key) => {
      if (!balances.has(key.toBase58())) throw new Error("could not find account");
      return { value: { amount: String(balances.get(key.toBase58())) } };
    },
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    sendRawTransaction: async (bytes) => {
      sent.push(VersionedTransaction.deserialize(bytes));
      return "sent";
    },
    getBlockHeight: async () => 1_000_000,
    getTransaction: async () => ({ meta: { err: options.chainSays ?? null, logMessages: [], computeUnitsConsumed: 90_000, fee: 5_000 } }),
  };
}

/** The pool's swap2 for the vault, as the SDK builds it — `amount` of the coin in, SOL to `to`, at least `minOut`. */
function swap2(amount, to, minOut) {
  const keys = Array.from({ length: 16 }, () => ({ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }));
  keys[0] = { pubkey: pool, isSigner: false, isWritable: true };
  keys[4] = { pubkey: vaultCoin, isSigner: false, isWritable: true };
  keys[5] = { pubkey: to, isSigner: false, isWritable: true };
  keys[10] = { pubkey: vault, isSigner: true, isWritable: false };
  const data = Buffer.alloc(24);
  Buffer.from(DLMM_SWAP2).copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  data.writeBigUInt64LE(minOut, 16);
  return new TransactionInstruction({ programId: DLMM_PROGRAM_ID, keys, data });
}

/* The pool prices the coin at 1 lamport for 100 base units; a sale builds the swap the way the devnet venue does. */
const PRICE = 100n;
const venue = (extra = {}) => ({
  quote: async (_coin, amount) => amount / PRICE,
  sell: async (mandate, amount, receiver, minOut) => {
    const quoteOut = (extra.priceMoves ?? 1n) * (amount / PRICE);
    const least = saleFloor(quoteOut);
    return { instruction: swap2(amount, extra.to ?? receiver, least > minOut ? least : minOut), quoteOut };
  },
  received: async () => extra.received ?? 4_901n,
  ...extra.override,
});

async function stand(options = {}) {
  const store = createMemoryGuardStore();
  await writeEntry(store, options.entry ?? ENTRY);
  const connection = chain(options);
  const rows = [];
  const key = envKey(JSON.stringify([...agentPair.secretKey])).signer;
  return { store, connection, rows, key, journal: async (row) => void rows.push(row) };
}

const review = (s, share = 50, extra = {}) => reviewSale({ owner: human.toBase58(), policy: buyPolicy.toBase58(), share, ...extra }, gate, { store: s.store, connection: s.connection, venue: venue(), now: () => NOW });
const instructionsOf = (wire) => TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(wire, "base64")).message).instructions;
/* Her mandate lands on chain: the policy the review wrote, the vault's account holding the coin. */
const signed = (s, amount) => {
  s.connection.accounts.set(salePolicy.toBase58(), { owner: SSA_PROGRAM_ID, data: salePolicyData(), lamports: 1, executable: false });
  s.connection.accounts.set(vaultCoin.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coin, vault, amount), lamports: 1, executable: false });
  s.connection.balances.set(vaultCoin.toBase58(), amount);
};
const go = (s, extra = {}) => goSale({ owner: human.toBase58(), policy: salePolicy.toBase58() }, { gate, store: s.store, connection: s.connection, key: "key" in extra ? extra.key : s.key, journal: s.journal, venue: venue(extra), now: () => NOW });

/* ------------------------------------------------------------------ the share */

test("a share of what the agent holds: 25, 50 or all of it — never a coin she bought herself", () => {
  assert.deepEqual([...SALE_SHARES], [25, 50, 100]);
  assert.equal(isSaleShare(50), true);
  assert.equal(isSaleShare(33), false);
  assert.equal(saleAmount(1_000_003n, 25), 250_000n);
  assert.equal(saleAmount(1_000_003n, 100), 1_000_003n);
  assert.equal(saleAmount(0n, 100), 0n);
  /* The book, less what she sold; never more than her wallet holds — and a coin she bought herself is not the agent's. */
  assert.equal(agentHolding(1_000n, 300n, 5_000n), 700n);
  assert.equal(agentHolding(1_000n, 300n, 200n), 200n);
  assert.equal(agentHolding(1_000n, 1_200n, 5_000n), 0n);
  assert.equal(agentHolding(1_000n, 0n, null), 1_000n);
  assert.equal(saleFloor(10_000n), 9_900n);
  assert.equal(earnedWithSales(100n, 40n, 70n), 10n);
  assert.equal(earnedWithSales(100n, null, 70n), null);
});

test("a sale's terms on devnet: a coin of Token through the gate's pool, Ryntra's fee the transfer of the coin before the swap", () => {
  const terms = {
    human,
    agent,
    budgetMint: coin,
    perTrade: 500_000n,
    perDay: 500_000n,
    slippageBps: 100,
    expiresAt: SECONDS(NOW) + SALE_SECONDS,
    venue: { kind: "dlmm", pool },
    fixedBuy: { amountIn: 500_000n, outputMint: NATIVE_MINT, minOut: 4_000n },
    budgetCoin: { program: TOKEN_PROGRAM_ID, decimals: 6 },
  };
  assert.equal(termsRefusal(terms, SECONDS(NOW)), null);
  assert.match(termsRefusal({ ...terms, budgetCoin: { program: TOKEN_2022_PROGRAM_ID, decimals: 6 } }, SECONDS(NOW)), /coin of Token/);
  /* Through the pool the fee is the coin's; through Jupiter it stays in the SOL she receives. */
  assert.ok(feeMintOf(terms).equals(coin));
  assert.ok(feeMintOf({ ...terms, venue: { kind: "jupiter" } }).equals(NATIVE_MINT));
  const policy = mandatePolicy(terms, { vault, budgetAccount: vaultCoin });
  const [swap, fee] = policy.constraints;
  assert.ok(swap.programId.equals(DLMM_PROGRAM_ID));
  assert.deepEqual(swap.accounts.find((a) => a.index === 5).rule.keys.map((k) => k.toBase58()), [herWsol.toBase58()], "SOL only to her own account");
  assert.deepEqual(swap.accounts.find((a) => a.index === 4).rule.keys.map((k) => k.toBase58()), [vaultCoin.toBase58()]);
  assert.equal(swap.data.find((d) => d.offset === 16).value.value, 4_000n, "her floor, held on chain");
  assert.equal(swap.data.find((d) => d.offset === 8).operator, "lessThanOrEqualTo");
  assert.deepEqual(fee.accounts.find((a) => a.index === 2).rule.keys.map((k) => k.toBase58()), [FEE_COIN.toBase58()], "the fee only to Ryntra's account of the coin");
  assert.deepEqual(policy.spendingLimits.map((l) => [l.mint.toBase58(), l.maxPerPeriod]), [[coin.toBase58(), 500_000n]], "the coin, once a day");
});

/* ------------------------------------------------------------------ 1. review */

test("the review: half of what the agent holds, Ryntra's 1 % before she signs, her floor from the pool, one transaction of hers", async () => {
  const s = await stand();
  const answer = await review(s);
  assert.equal(answer.ok, true, answer.reason);
  const f = answer.figures;
  assert.equal(f.heldRaw, BOUGHT.toString());
  assert.equal(f.amountRaw, "500000");
  assert.equal(f.feeBps, 100);
  assert.equal(f.feeRaw, agentFeeRaw(500_000n, 100).toString());
  assert.equal(f.quoteRaw, "4950", "the pool's quote for the coin after the fee");
  assert.equal(f.floorRaw, saleFloor(4_950n).toString());
  assert.equal(f.feeSolRaw, "50", "the fee as SOL at the pool's price");
  assert.equal(answer.record.policy, salePolicy.toBase58(), "the next policy on her own smart account");
  assert.equal(answer.record.budget, vaultCoin.toBase58());
  assert.equal(answer.transactions.length, 1);
  const tx = VersionedTransaction.deserialize(Buffer.from(answer.transactions[0], "base64"));
  assert.ok(tx.message.staticAccountKeys[0].equals(human), "she pays");
  assert.equal(tx.message.header.numRequiredSignatures, 1, "she alone signs");
  const flat = instructionsOf(answer.transactions[0]);
  const fund = flat.find((ix) => ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data[0] === 12);
  assert.ok(fund.keys[0].pubkey.equals(herCoin) && fund.keys[2].pubkey.equals(vaultCoin) && fund.data.readBigUInt64LE(1) === 500_000n, "exactly the share into her vault");
  assert.ok(flat.some((ix) => ix.programId.equals(SSA_PROGRAM_ID)), "the sale's mandate");
  assert.ok(!flat.some((ix) => ix.keys.some((k) => k.pubkey.equals(agent) && k.isSigner)), "the agent signs none of it");
  const row = await readSale(s.store, salePolicy.toBase58());
  assert.equal(row.status, "review");
  assert.equal(row.parent, buyPolicy.toBase58());
  /* All of it, and a wallet that holds less than the book: the wallet is the bound. */
  assert.equal((await review(s, 100)).figures.amountRaw, BOUGHT.toString());
  const short = await stand({ wallet: 300_000n });
  assert.equal((await review(short, 100)).figures.amountRaw, "300000");
});

test("the review refuses what is not hers to sell, and a sale whose fee could not land", async () => {
  const s = await stand();
  assert.equal((await reviewSale({ owner: attacker.toBase58(), policy: buyPolicy.toBase58(), share: 50 }, gate, { store: s.store, connection: s.connection, venue: venue() })).code, "NOT_IN_BOOK");
  assert.equal((await review(await stand({ wallet: 0n }))).code, "NOTHING");
  assert.equal((await review(await stand({ entry: { ...ENTRY, trades: [] } }))).code, "NOTHING");
  assert.match((await review(await stand({ feeAccount: false }))).reason, /fee account/);
  assert.equal((await review(await stand({ wallet: 10n }), 25)).code, "TOO_SMALL");
  const wrong = await stand();
  wrong.connection.getGenesisHash = async () => "mainnet";
  assert.equal((await review(wrong)).code, "NOT_DEVNET");
});

/* ------------------------------------------------------------------ 2. the agent sells */

test("signed, the agent sells at once: Ryntra's share of the coin, the swap, her SOL checked — one receipt", async () => {
  const s = await stand();
  const answer = await review(s);
  /* Not on chain yet: nothing is sold. */
  assert.equal((await go(s)).code, "NOT_SIGNED");
  signed(s, 500_000n);
  const done = await go(s);
  assert.equal(done.ok, true, done.reason);
  assert.equal(done.receipt.status, "sold");
  assert.equal(done.receipt.soldRaw, "500000");
  assert.equal(done.receipt.receivedRaw, "4901");
  assert.equal(s.connection.sent.length, 1);
  assert.equal(s.rows.at(-1).outcome, "SIGNED");
  const tx = s.connection.sent[0];
  assert.ok(tx.message.staticAccountKeys[0].equals(agent), "the agent pays its own trade");
  const flat = TransactionMessage.decompile(tx.message).instructions;
  const execution = flat.find((ix) => ix.programId.equals(SSA_PROGRAM_ID));
  const view = readPolicyExecute({ programId: execution.programId, keys: execution.keys.map((k) => k.pubkey), data: execution.data });
  assert.ok(view.policy.equals(salePolicy));
  const [fee, swap] = view.instructions;
  assert.ok(fee.accounts[2].equals(FEE_COIN), "Ryntra's fee to its own account of the coin");
  assert.equal(Buffer.from(fee.data).readBigUInt64LE(1), agentFeeRaw(500_000n, 100));
  assert.equal(Buffer.from(swap.data).readBigUInt64LE(8), 500_000n - agentFeeRaw(500_000n, 100), "the rest into the pool");
  const rule = readReceivedAtLeast(flat.find((ix) => ix.programId.equals(LIGHTHOUSE_PROGRAM_ID)));
  assert.ok(rule.account.equals(herWsol));
  assert.equal(rule.amount, 5_000n + BigInt(answer.figures.floorRaw), "her SOL account must hold her floor more, or nothing happened");
  /* Asked again, the receipt — never a second sale. */
  const again = await go(s);
  assert.equal(again.receipt.status, "sold");
  assert.equal(s.connection.sent.length, 1);
  const view2 = salesView(1_000_000n, await readSales(s.store, buyPolicy.toBase58()));
  assert.deepEqual([view2.heldRaw, view2.soldRaw, view2.gotRaw], ["500000", "500000", "4901"]);
});

test("the agent does not sell under her floor, nor without its key; its signer refuses SOL that is not hers", async () => {
  /* The price fell since she signed: nothing is sent, the coin waits for her to take it back. */
  const low = await stand();
  await review(low);
  signed(low, 500_000n);
  const fell = await go(low, { priceMoves: 0n });
  assert.equal(fell.receipt.status, "failed");
  assert.match(fell.receipt.reason, /floor/);
  assert.equal(low.connection.sent.length, 0);
  /* No key in this deployment: the sale is signed and waits for the cron's pass, which has it. */
  const keyless = await stand();
  await review(keyless);
  signed(keyless, 500_000n);
  assert.equal((await go(keyless, { key: null })).receipt.status, "signed");
  const lines = await runSalePass({ gate, store: keyless.store, connection: keyless.connection, key: keyless.key, journal: keyless.journal, venue: venue(), now: () => NOW + 60_000 });
  assert.deepEqual(lines.map((line) => line.did), ["sold"]);
  /* The swap's SOL to someone else: the signer reads the rule and refuses; nothing is sent. */
  const stolen = await stand();
  stolen.connection.accounts.set(tokenAccountOf(attacker, NATIVE_MINT).toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(NATIVE_MINT, attacker), lamports: 1, executable: false });
  await review(stolen);
  signed(stolen, 500_000n);
  const refused = await go(stolen, { to: tokenAccountOf(attacker, NATIVE_MINT) });
  assert.equal(refused.receipt.status, "failed");
  assert.equal(stolen.connection.sent.length, 0);
  assert.equal(stolen.rows.at(-1).outcome, "REFUSED");
});

test("a sale joins only as the chain has it: the agent's one signer, Ryntra's account of the coin, her SOL account", async () => {
  const s = await stand();
  await review(s);
  const row = await readSale(s.store, salePolicy.toBase58());
  assert.match(await saleChainRefusal(row, gate, s.connection), /not signed yet/);
  const put = (data) => s.connection.accounts.set(salePolicy.toBase58(), { owner: SSA_PROGRAM_ID, data, lamports: 1, executable: false });
  put(salePolicyData(attacker));
  assert.match(await saleChainRefusal(row, gate, s.connection), /another agent/);
  put(salePolicyData(agent, [herWsol]));
  assert.match(await saleChainRefusal(row, gate, s.connection), /Ryntra fee/);
  put(salePolicyData(agent, [FEE_COIN]));
  assert.match(await saleChainRefusal(row, gate, s.connection), /does not pay you/);
  put(salePolicyData(agent, [FEE_COIN, herWsol], [SOLD, FLOOR - 1n]));
  assert.match(await saleChainRefusal(row, gate, s.connection), /not the sale the book keeps/, "a review written over by another is never sold");
  put(salePolicyData());
  assert.equal(await saleChainRefusal(row, gate, s.connection), null);
  assert.match(await saleChainRefusal({ ...row, record: { ...row.record, owner: attacker.toBase58() } }, gate, s.connection), /person's/);
});

/* ------------------------------------------------------------------ 3. back, and what the window shows */

test("a sale that did not go comes back with one signature of hers: the mandate removed, the coin home", async () => {
  const s = await stand();
  await review(s);
  signed(s, 500_000n);
  await go(s, { priceMoves: 0n });
  const back = await reviewSaleBack({ owner: human.toBase58(), policy: salePolicy.toBase58() }, gate, { store: s.store, connection: s.connection });
  assert.equal(back.ok, true, back.reason);
  assert.equal(back.figures.amountRaw, "500000");
  const flat = instructionsOf(back.transactions[0]);
  assert.ok(flat.every((ix) => !ix.keys.some((k) => k.pubkey.equals(agent) && k.isSigner)), "no agent in the way");
  assert.ok(flat.some((ix) => ix.programId.equals(SSA_PROGRAM_ID)));
  assert.equal((await reviewSaleBack({ owner: attacker.toBase58(), policy: salePolicy.toBase58() }, gate, { store: s.store, connection: s.connection })).code, "NOT_FOUND");
  /* Taken back already: nothing stands. */
  s.connection.accounts.delete(salePolicy.toBase58());
  s.connection.balances.delete(vaultCoin.toBase58());
  assert.equal((await reviewSaleBack({ owner: human.toBase58(), policy: salePolicy.toBase58() }, gate, { store: s.store, connection: s.connection })).code, "NOTHING");
});

test("what the window shows: the coin the agent still holds, and the result counting the SOL her sales brought", async () => {
  const sold = { ...(await (async () => {
    const s = await stand();
    await review(s);
    signed(s, 500_000n);
    await go(s);
    return readSale(s.store, salePolicy.toBase58());
  })()) };
  const sales = salesView(BOUGHT, [sold]);
  assert.equal(sales.heldRaw, "500000");
  assert.equal(sales.lastSale.status, "sold");
  /* Spent 0.1 SOL; what it holds is worth 0.04 SOL, the sale brought 4 901 lamports. */
  const view = viewOf(ENTRY, 40_000_000n, null, sales);
  assert.equal(view.heldRaw, "500000");
  assert.equal(view.result.earnedRaw, (40_000_000n + 4_901n - 2n * medium.perTrade).toString());
  /* Without sales, the result is what it was. */
  assert.equal(viewOf(ENTRY, 40_000_000n).result.earnedRaw, (40_000_000n - 2n * medium.perTrade).toString());
  /* Never more than her wallet holds: a sale that did not go keeps its coin in her vault until she takes it back. */
  assert.equal(salesView(BOUGHT, [], 300_000n).heldRaw, "300000");
  /* A review she never signed is not a sale. */
  const s = await stand();
  await review(s);
  assert.equal(salesView(BOUGHT, await readSales(s.store)).heldRaw, BOUGHT.toString());
  await writeSale(s.store, { ...(await readSale(s.store, salePolicy.toBase58())), status: "signed" });
  assert.equal(salesView(BOUGHT, await readSales(s.store)).heldRaw, "500000");
});
