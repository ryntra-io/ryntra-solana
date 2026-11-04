/* CITY-195 — the agent sells on mainnet through Jupiter's `/build`, and the person's next signature tidies up after it.
   Nothing here reaches a network or a real key: the chain is a stand-in, Jupiter a stand-in or the very bytes of a route it
   built for the CITY-184 fork (02.11.2026), the agent's key a key made for the test. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { envKey } from "../launch/signer/env.server.ts";
import { apiInstruction } from "./agent.ts";
import { writeEntry } from "./book.server.ts";
import { AGENT_FEE_CEILING_BPS, agentFeeAccount, agentFeeRaw, agentFeeWallet, uncataloguedFacts } from "./fee.ts";
import { planWithdraw, tokenAccountOf } from "./human.ts";
import { readAgentRoute } from "./jupiter.server.ts";
import { instructionRefusal } from "./judge.ts";
import { LIGHTHOUSE_PROGRAM_ID, readReceivedAtLeast, tradeTerms } from "./result.ts";
import { SALE_ROOM_BPS, SALE_SLIPPAGE_BPS, jupiterSaleFloor, saleFloor } from "./sale.ts";
import { goSale, readSale, readSales, reviewSale, reviewSaleBack, runSalePass, saleChainRefusal, saleMandate, saleNumbers, stopTidy, writeSale } from "./sale.server.ts";
import { MAINNET_GENESIS, reviewStop } from "./service.server.ts";
import { tradeRefusal } from "./signer.server.ts";
import { NATIVE_MINT, SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, readPolicyExecute, ssaAddress } from "./ssa.ts";
import { JUPITER_PROGRAM_ID, LAYOUT, ROUTE_V2, jupiterQuoteFloor, mandatePolicy } from "./terms.ts";
import { NO_TIDY, planTidy, withTidy } from "./tidy.ts";
import { TOKEN_2022_PROGRAM_ID, readCoin } from "./token-2022.ts";
import { agentTradeInstructions } from "./agent.ts";

const HOUR = 3_600_000;
const NOW = Date.now();
const SECONDS = (ms) => BigInt(Math.floor(ms / 1000));
const K = (text) => new PublicKey(text);

const humanPair = Keypair.generate();
const human = humanPair.publicKey;
const agentPair = Keypair.generate();
const agent = agentPair.publicKey;
const attacker = Keypair.generate().publicKey;
const coin = Keypair.generate().publicKey;
const settings = ssaAddress.settings(9n);
const vault = ssaAddress.vault(settings, 0);
const buyPolicy = ssaAddress.policy(settings, 1n);
const salePolicy = ssaAddress.policy(settings, 2n);
const oldSale = ssaAddress.policy(settings, 3n);
const herCoin = tokenAccountOf(human, coin);
const herWsol = tokenAccountOf(human, NATIVE_MINT);
const vaultCoin = tokenAccountOf(vault, coin);
const vaultWsol = tokenAccountOf(vault, NATIVE_MINT);
const FEE_WSOL = agentFeeAccount(NATIVE_MINT);
/* Mainnet's gate, its agent a key made for the test (the registry's is Google's, and signs nothing here). */
const gate = { open: true, network: "mainnet", pool: null, agent };

/* The agent bought 1 000 000 base units of the coin for her on mainnet, with the one budget mainnet offers. */
const BOUGHT = 1_000_000n;
const BUY_RECORD = {
  owner: human.toBase58(),
  settings: settings.toBase58(),
  vault: vault.toBase58(),
  policy: buyPolicy.toBase58(),
  budget: vaultWsol.toBase58(),
  perTrade: "20000000",
  perDay: "100000000",
  expiresAt: String(SECONDS(NOW + 29 * 24 * HOUR)),
};
const ENTRY = {
  v: 1,
  cluster: "mainnet",
  record: BUY_RECORD,
  preset: "small",
  strategy: "steady",
  said: null,
  receiveMint: coin.toBase58(),
  status: "working",
  trades: [{ at: NOW - HOUR, status: "ok", signature: "a", spentRaw: "20000000", receivedRaw: BOUGHT.toString(), reason: null }],
  createdAt: NOW - 2 * HOUR,
  updatedAt: NOW - HOUR,
};

/* ------------------------------------------------------------------ accounts as the programs write them */

const u16 = (n) => [n & 255, n >> 8];
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24];
const u64 = (n) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
  return [...out];
};
const settingsData = (signers, seed = 1) =>
  Uint8Array.from([223, 179, 163, 190, 177, 224, 67, 173, ...new Array(16).fill(0), ...new Array(32).fill(0), ...u16(1), ...u32(0), ...u64(0), ...u64(0), 0, ...u64(0), 255, ...u32(signers.length), ...signers.flatMap((key) => [...key.toBytes(), 7]), 0, 1, ...u64(seed)]);
const tokenData = (mint, owner, amount = 0n) => Uint8Array.from([...mint.toBytes(), ...owner.toBytes(), ...u64(amount), ...new Array(93).fill(0)]);
const mintData = (decimals = 6) => Uint8Array.from({ length: 82 }, (_, at) => (at === 44 ? decimals : at === 45 ? 1 : 0));
/* A policy as the program writes it: its head (settings, seed, one signer), then whatever its rules name. */
const policyData = (seed, signer, names = [], numbers = []) =>
  Uint8Array.from([222, 135, 7, 163, 235, 177, 33, 68, ...settings.toBytes(), ...u64(seed), 255, ...u64(0), ...u64(0), ...u32(1), ...signer.toBytes(), 7, ...u16(1), ...new Array(64).fill(0), ...names.flatMap((key) => [...key.toBytes()]), ...numbers.flatMap((n) => u64(n))]);

/* Jupiter's price: 1 lamport for 100 base units of the coin, before Ryntra's fee. */
const PRICE = 100n;
const SOLD = 500_000n;
const GROSS = SOLD / PRICE;
const FEE = agentFeeRaw(GROSS, 100);
const QUOTE = GROSS - FEE;
const FLOOR = jupiterSaleFloor(QUOTE);

/** Mainnet as a stand-in: accounts, token balances, what was sent. */
function chain(options = {}) {
  const account = (owner, data) => ({ owner, data, lamports: 2_039_280, executable: false });
  const accounts = new Map([
    [settings.toBase58(), account(SSA_PROGRAM_ID, settingsData([human]))],
    [buyPolicy.toBase58(), account(SSA_PROGRAM_ID, policyData(1, agent, [FEE_WSOL]))],
    [coin.toBase58(), account(options.coinProgram ?? TOKEN_PROGRAM_ID, options.mint ?? mintData())],
    [herCoin.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(coin, human, options.wallet ?? BOUGHT))],
    [herWsol.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(NATIVE_MINT, human, 5_000n))],
    [vaultWsol.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(NATIVE_MINT, vault, 60_000_000n))],
    ...(options.feeAccount === false ? [] : [[FEE_WSOL.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(NATIVE_MINT, agentFeeWallet()))]]),
  ]);
  const balances = new Map([
    [herCoin.toBase58(), options.wallet ?? BOUGHT],
    [vaultWsol.toBase58(), 60_000_000n],
  ]);
  const sent = [];
  return {
    accounts,
    balances,
    sent,
    getGenesisHash: async () => options.genesis ?? MAINNET_GENESIS,
    getAccountInfo: async (key) => accounts.get(key.toBase58()) ?? null,
    getMultipleAccountsInfo: async (keys) => keys.map((key) => accounts.get(key.toBase58()) ?? null),
    getTokenAccountBalance: async (key) => {
      if (!balances.has(key.toBase58())) throw new Error("could not find account");
      return { value: { amount: String(balances.get(key.toBase58())) } };
    },
    getEpochInfo: async () => ({ epoch: options.epoch ?? 1075 }),
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    sendRawTransaction: async (bytes) => {
      sent.push(VersionedTransaction.deserialize(bytes));
      return "sent";
    },
    getBlockHeight: async () => 1_000_000,
    getTransaction: async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 140_000, fee: 5_000 } }),
  };
}

/**
 * Jupiter's `route_v2` for the vault as `/build` answers it: the coin from the vault's account, through the vault's own
 * SOL account, to `to`; Ryntra's fee in the fee slot. Only the bytes the rules read are written.
 */
function routeV2({ amount, quoted, to = herWsol, feeBps = 100, feeAccount = FEE_WSOL, slippage = SALE_SLIPPAGE_BPS, source = vaultCoin }) {
  const keys = Array.from({ length: 14 }, () => ({ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false }));
  keys[LAYOUT.routeV2.authority] = { pubkey: vault, isSigner: true, isWritable: false };
  keys[LAYOUT.routeV2.source] = { pubkey: source, isSigner: false, isWritable: true };
  keys[LAYOUT.routeV2.own] = { pubkey: vaultWsol, isSigner: false, isWritable: true };
  keys[LAYOUT.routeV2.receiver] = { pubkey: to, isSigner: false, isWritable: true };
  keys[LAYOUT.routeV2.feeAccount] = { pubkey: feeAccount, isSigner: false, isWritable: true };
  const data = Buffer.alloc(30);
  Buffer.from(ROUTE_V2).copy(data, 0);
  data.writeBigUInt64LE(amount, LAYOUT.routeV2.inAmount);
  data.writeBigUInt64LE(quoted, LAYOUT.routeV2.quotedOut);
  data.writeUInt16LE(slippage, LAYOUT.routeV2.slippage);
  data.writeUInt16LE(feeBps, LAYOUT.routeV2.platformFee);
  data.writeUInt16LE(0, LAYOUT.routeV2.positiveSlippage);
  return new TransactionInstruction({ programId: JUPITER_PROGRAM_ID, keys, data });
}

const SIDES = { input: uncataloguedFacts(coin.toBase58()), output: uncataloguedFacts(NATIVE_MINT.toBase58()), nowMs: NOW };

/** Jupiter as a stand-in: the price above, its route for whatever the sale's mandate holds. */
const jupiter = (extra = {}) => ({
  kind: "jupiter",
  sides: async () => extra.sides ?? SIDES,
  quote: async (_coin, amount) => (extra.priceMoves ?? 1n) * (amount / PRICE),
  sell: async (mandate, receiver, feeBps, feeSides) => {
    const amount = mandate.terms.fixedBuy.amountIn;
    const gross = ((extra.priceMoves ?? 1n) * amount) / PRICE;
    const quoted = gross - agentFeeRaw(gross, feeBps);
    extra.asked?.push({ receiver, feeBps });
    return { instruction: routeV2({ amount, quoted, ...extra.route }), setup: [], lookupTables: [], quoteOut: quoted, feeSides };
  },
  received: async () => extra.received ?? QUOTE,
});

async function stand(options = {}) {
  const store = createMemoryGuardStore();
  await writeEntry(store, options.entry ?? ENTRY);
  const connection = chain(options);
  const rows = [];
  const key = envKey(JSON.stringify([...agentPair.secretKey])).signer;
  return { store, connection, rows, key, journal: async (row) => void rows.push(row) };
}

const review = (s, share = 50, venue = jupiter()) => reviewSale({ owner: human.toBase58(), policy: buyPolicy.toBase58(), share }, gate, { store: s.store, connection: s.connection, venue, now: () => NOW });
const instructionsOf = (wire) => TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(wire, "base64")).message).instructions;
/* Her mandate lands on chain as the program writes the review's: Ryntra's SOL account, her SOL account, the size and the least quote. */
const signed = (s, row) => {
  const { size, least } = saleNumbers(row);
  s.connection.accounts.set(salePolicy.toBase58(), { owner: SSA_PROGRAM_ID, data: policyData(2, agent, [FEE_WSOL, herWsol], [size, least]), lamports: 8_000_000, executable: false });
  s.connection.accounts.set(vaultCoin.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coin, vault, size), lamports: 2_039_280, executable: false });
  s.connection.balances.set(vaultCoin.toBase58(), size);
};
const go = (s, venue = jupiter(), extra = {}) => goSale({ owner: human.toBase58(), policy: salePolicy.toBase58() }, { gate, store: s.store, connection: s.connection, key: "key" in extra ? extra.key : s.key, journal: s.journal, venue, now: () => NOW });
/* Whether an instruction removes `policy` in a settings change (`policyRemove`, the action's tag 9 then its address). */
const removes = (ix, policy) => ix.programId.equals(SSA_PROGRAM_ID) && Buffer.from(ix.data).indexOf(Buffer.from([9, ...policy.toBytes()])) >= 0;
/* Token's `CloseAccount` (tag 9) of `account`, wherever it stands: her own, or inside the vault's execution. */
const closesDirectly = (ix, account) => ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data.length === 1 && ix.data[0] === 9 && ix.keys[0].pubkey.equals(account);

/* ------------------------------------------------------------------ the floor */

test("a sale through Jupiter: Ryntra's fee is the table's share of the SOL out, her floor leaves the price 1 % of room", () => {
  assert.equal(SALE_ROOM_BPS, 100);
  /* The very numbers of Jupiter's route on the CITY-184 fork: 12 299 579 lamports out, 1 % — 122 995 — Ryntra's, 12 176 584 hers. */
  assert.equal(agentFeeRaw(12_299_579n, 100), 122_995n);
  assert.equal(jupiterSaleFloor(12_176_584n), saleFloor(saleFloor(12_176_584n, 100), 100));
  /* The chain holds the route's quote to her floor plus the slippage: the quote at the review passes, and 1 % under it still does. */
  const least = jupiterQuoteFloor(jupiterSaleFloor(12_176_584n), SALE_SLIPPAGE_BPS);
  assert.ok(least <= (12_176_584n * 99n) / 100n, "the price may fall 1 % before the sale is refused");
  assert.ok(least > (12_176_584n * 98n) / 100n, "and not 2 %");
  /* Whatever the route's own slippage, what reaches her after it is at least her floor. */
  assert.ok(saleFloor(least, SALE_SLIPPAGE_BPS) >= jupiterSaleFloor(12_176_584n));
});

/* ------------------------------------------------------------------ 1. review on mainnet */

test("mainnet: the review prices the share through Jupiter — the fee in SOL, the quote after it, her floor — and writes Jupiter's mandate", async () => {
  const s = await stand();
  const answer = await review(s);
  assert.equal(answer.ok, true, answer.reason);
  assert.deepEqual(
    { amount: answer.figures.amountRaw, fee: answer.figures.feeRaw, feeSol: answer.figures.feeSolRaw, quote: answer.figures.quoteRaw, floor: answer.figures.floorRaw, bps: answer.figures.feeBps },
    { amount: SOLD.toString(), fee: FEE.toString(), feeSol: FEE.toString(), quote: QUOTE.toString(), floor: FLOOR.toString(), bps: 100 },
  );
  const row = await readSale(s.store, salePolicy.toBase58(), "mainnet");
  assert.equal(row.cluster, "mainnet");
  assert.equal(await readSale(s.store, salePolicy.toBase58()), null, "never in devnet's book");
  /* Her transactions — one approval: the coin into her own vault, then the policy of Jupiter's sale (≈ 1 KB, a packet of its own). */
  assert.ok(answer.transactions.length >= 1 && answer.transactions.length <= 2);
  const flat = answer.transactions.flatMap(instructionsOf);
  const fund = flat.find((ix) => ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data[0] === 12);
  assert.ok(fund.keys[0].pubkey.equals(herCoin) && fund.keys[2].pubkey.equals(vaultCoin));
  assert.equal(fund.data.readBigUInt64LE(1), SOLD);
  const policy = mandatePolicy(saleMandate(row, gate).terms, { vault, budgetAccount: vaultCoin });
  const [route] = policy.constraints;
  assert.ok(route.programId.equals(JUPITER_PROGRAM_ID));
  assert.deepEqual(route.accounts.find((a) => a.index === LAYOUT.routeV2.receiver).rule.keys.map(String), [herWsol.toBase58()], "SOL lands only on her account");
  assert.deepEqual(route.accounts.find((a) => a.index === LAYOUT.routeV2.feeAccount).rule.keys.map(String), [FEE_WSOL.toBase58()], "Ryntra's fee only into Ryntra's SOL account");
  assert.equal(route.data.find((d) => d.offset === LAYOUT.routeV2.quotedOut).value.value, jupiterQuoteFloor(FLOOR, SALE_SLIPPAGE_BPS));
  assert.equal(route.data.find((d) => d.offset === LAYOUT.routeV2.platformFee).value.value, AGENT_FEE_CEILING_BPS);
  assert.deepEqual(policy.spendingLimits.map((l) => [l.mint.toBase58(), l.maxPerPeriod]), [[coin.toBase58(), SOLD]], "the coin's day cap is the sale itself");
});

test("mainnet: no sale without Ryntra's SOL fee account, a readable quote, or the network the gate names", async () => {
  assert.equal((await review(await stand({ feeAccount: false }))).code, "UNAVAILABLE");
  assert.equal((await review(await stand(), 50, { ...jupiter(), quote: async () => { throw new Error("429"); } })).code, "UNAVAILABLE");
  assert.equal((await review(await stand({ genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" }))).code, "NOT_MAINNET");
  /* The pool's venue on mainnet is a mistake of ours: refused before anything is written. */
  const pool = { quote: async () => 1n, sell: async () => assert.fail(), received: async () => null };
  assert.equal((await review(await stand(), 50, pool)).code, "UNAVAILABLE");
  /* A pair the table names no fee for is no agent trade. */
  const dollar = { input: { mint: coin.toBase58(), verified: true, tags: ["stable"], firstPoolAt: null }, output: null, nowMs: NOW };
  assert.equal((await review(await stand(), 50, jupiter({ sides: dollar }))).code, "REFUSED");
});

test("mainnet: a coin of Token-2022 with a fee on transfers — the agent sells what reaches the vault", async () => {
  const REAL = JSON.parse(readFileSync(new URL("./fixtures/token-2022-mints.json", import.meta.url), "utf8"));
  const si = REAL.mints.SI;
  const mint = Buffer.from(si.data, "base64");
  const reading = readCoin(coin, { owner: TOKEN_2022_PROGRAM_ID, data: mint }, BigInt(REAL.epoch));
  assert.ok(reading.ok && reading.coin.transferFee, "SI withholds 1 % on transfers");
  const s = await stand({ coinProgram: TOKEN_2022_PROGRAM_ID, mint, epoch: REAL.epoch });
  const her2022 = tokenAccountOf(human, coin, TOKEN_2022_PROGRAM_ID);
  s.connection.balances.set(her2022.toBase58(), BOUGHT);
  const answer = await review(s, 100);
  assert.equal(answer.ok, true, answer.reason);
  const row = await readSale(s.store, salePolicy.toBase58(), "mainnet");
  assert.equal(row.program, TOKEN_2022_PROGRAM_ID.toBase58());
  assert.equal(row.amountRaw, BOUGHT.toString(), "all of it leaves her wallet");
  assert.equal(BigInt(row.sellRaw), BOUGHT - BOUGHT / 100n, "the vault gets it less the coin's 1 %, and the mandate sells exactly that");
  assert.equal(saleMandate(row, gate).terms.fixedBuy.amountIn, BOUGHT - BOUGHT / 100n);
  assert.ok(saleMandate(row, gate).budgetAccount.equals(tokenAccountOf(vault, coin, TOKEN_2022_PROGRAM_ID)));
});

/* ------------------------------------------------------------------ 2. the agent sells */

test("mainnet: once her mandate is on chain the agent sells through Jupiter — SOL to her, Ryntra's fee in it, the result rule after it", async () => {
  const s = await stand();
  assert.equal((await review(s)).ok, true);
  const row = await readSale(s.store, salePolicy.toBase58(), "mainnet");
  assert.equal(await saleChainRefusal(row, gate, s.connection), "the sale is not signed yet");
  signed(s, row);
  assert.equal(await saleChainRefusal(row, gate, s.connection), null);
  const asked = [];
  const gone = await go(s, jupiter({ asked }));
  assert.equal(gone.ok, true, gone.reason);
  assert.equal(gone.receipt.status, "sold");
  assert.equal(gone.receipt.receivedRaw, QUOTE.toString());
  assert.deepEqual(asked.map((a) => [a.receiver.toBase58(), a.feeBps]), [[herWsol.toBase58(), 100]]);
  /* What the agent sent: the policy's one execution of Jupiter's route, then «what reached her is at least the minimum». */
  assert.equal(s.connection.sent.length, 1);
  const tx = s.connection.sent[0];
  const flat = TransactionMessage.decompile(tx.message).instructions;
  const execution = readPolicyExecute({ programId: SSA_PROGRAM_ID, keys: flat.find((ix) => ix.programId.equals(SSA_PROGRAM_ID)).keys.map((k) => k.pubkey), data: flat.find((ix) => ix.programId.equals(SSA_PROGRAM_ID)).data });
  assert.ok(execution.policy.equals(salePolicy));
  assert.equal(execution.instructions.length, 1, "on Jupiter the fee is inside the route: no transfer of its own");
  const terms = tradeTerms(execution.instructions[0]);
  assert.ok(terms.receiver.equals(herWsol));
  const rule = readReceivedAtLeast(flat.find((ix) => ix.programId.equals(LIGHTHOUSE_PROGRAM_ID)));
  assert.ok(rule.account.equals(herWsol));
  assert.equal(rule.amount, 5_000n + terms.minOut, "her wSOL account holds what it held plus the route's minimum, or nothing happens");
  assert.ok(terms.minOut >= FLOOR, "the minimum is at least her floor");
  /* The journal kept the signature; the sale counts against what the agent holds for her. */
  assert.deepEqual(s.rows.map((r) => [r.outcome, r.cluster]), [["SIGNED", "mainnet"]]);
  const sales = await readSales(s.store, buyPolicy.toBase58(), "mainnet");
  assert.equal(sales[0].status, "sold");
});

test("mainnet: the price fell under her floor — the agent sends nothing; a fee above the one she was shown — nothing either", async () => {
  const fell = await stand();
  await review(fell);
  signed(fell, await readSale(fell.store, salePolicy.toBase58(), "mainnet"));
  const answer = await go(fell, { ...jupiter(), sell: async (mandate, receiver, feeBps, feeSides) => ({ instruction: routeV2({ amount: SOLD, quoted: (QUOTE * 97n) / 100n }), setup: [], lookupTables: [], quoteOut: (QUOTE * 97n) / 100n, feeSides }) });
  assert.equal(answer.receipt.status, "failed");
  assert.match(answer.receipt.reason, /fell under your floor/);
  assert.equal(fell.connection.sent.length, 0);
  /* 1 % lower is still within the room: sold. */
  const moved = await stand();
  await review(moved);
  signed(moved, await readSale(moved.store, salePolicy.toBase58(), "mainnet"));
  const within = await go(moved, { ...jupiter(), sell: async (mandate, receiver, feeBps, feeSides) => ({ instruction: routeV2({ amount: SOLD, quoted: (QUOTE * 995n) / 1000n }), setup: [], lookupTables: [], quoteOut: (QUOTE * 995n) / 1000n, feeSides }) });
  assert.equal(within.receipt.status, "sold", within.receipt.reason);
  /* The table's rate now is above the one she was shown: the agent does not charge more than it said. */
  const dearer = await stand();
  await review(dearer);
  const kept = await readSale(dearer.store, salePolicy.toBase58(), "mainnet");
  signed(dearer, kept);
  await writeSale(dearer.store, { ...kept, feeBps: 50 });
  const refusedSale = await go(dearer, jupiter());
  assert.match(refusedSale.receipt.reason, /above what you were shown/);
  assert.equal(dearer.connection.sent.length, 0);
});

test("mainnet: the agent's signer refuses a route built against her — SOL elsewhere, a price of nothing, ten times the fee, the coin twice", async () => {
  const s = await stand();
  await review(s);
  const row = await readSale(s.store, salePolicy.toBase58(), "mainnet");
  signed(s, row);
  const cases = [
    [{ to: tokenAccountOf(attacker, NATIVE_MINT) }, /account 7 is not a pinned one/],
    [{ quoted: 10n }, /breaks greaterThanOrEqualTo/],
    [{ feeBps: 1_000 }, /breaks lessThanOrEqualTo/],
    [{ feeAccount: tokenAccountOf(attacker, NATIVE_MINT) }, /account 10 is not a pinned one/],
    [{ amount: SOLD * 2n }, /breaks equals/],
  ];
  for (const [route, reason] of cases) {
    const fresh = await stand();
    await review(fresh);
    signed(fresh, await readSale(fresh.store, salePolicy.toBase58(), "mainnet"));
    const answer = await go(fresh, jupiter({ route }));
    assert.equal(answer.receipt.status, "failed");
    assert.match(answer.receipt.reason, reason);
    assert.equal(fresh.connection.sent.length, 0, "nothing is sent");
    assert.deepEqual(fresh.rows.map((r) => r.outcome), ["REFUSED"], "the journal keeps the refusal; the key is never asked");
  }
});

test("a stolen agent key, bypassing the signer: the program's rules of her sale refuse SOL to it, a 1-lamport price and ten times the fee", async () => {
  /* The rules the program checks, as the judge reads them (`./judge.ts`): the very policy her review wrote. */
  const s = await stand();
  await review(s);
  const row = await readSale(s.store, salePolicy.toBase58(), "mainnet");
  const mandate = saleMandate(row, gate);
  const policy = mandatePolicy(mandate.terms, { vault, budgetAccount: vaultCoin });
  const facts = new Map([[vaultWsol.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(NATIVE_MINT, vault) }]]);
  const inner = (ix) => ({ programId: ix.programId, accounts: ix.keys.map((k) => k.pubkey), data: ix.data });
  const honest = routeV2({ amount: SOLD, quoted: QUOTE });
  assert.equal(instructionRefusal(inner(honest), policy.constraints[0], facts), null);
  assert.match(instructionRefusal(inner(routeV2({ amount: SOLD, quoted: QUOTE, to: tokenAccountOf(attacker, NATIVE_MINT) })), policy.constraints[0], facts), /account 7/);
  assert.match(instructionRefusal(inner(routeV2({ amount: SOLD, quoted: 1n })), policy.constraints[0], facts), /number at 16 \(1\) breaks greaterThanOrEqualTo/);
  assert.match(instructionRefusal(inner(routeV2({ amount: SOLD, quoted: QUOTE, feeBps: 1_000 })), policy.constraints[0], facts), /number at 26 \(1000\) breaks lessThanOrEqualTo 100/);
  assert.match(instructionRefusal(inner(routeV2({ amount: SOLD, quoted: QUOTE, slippage: 5_000 })), policy.constraints[0], facts), /number at 24/);
  /* And a whole transaction signed in the signer's place is still one the signer itself never signs. */
  const built = agentTradeInstructions({ mandate, venueInstruction: routeV2({ amount: SOLD, quoted: 10n }), holding: 0n });
  const message = TransactionMessage.prototype.compileToV0Message.call(new TransactionMessage({ payerKey: agent, recentBlockhash: "11111111111111111111111111111111", instructions: [...built] }));
  assert.match(tradeRefusal(message.serialize(), mandate, policy, { facts: new Map([...facts, [herWsol.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(NATIVE_MINT, human) }]]), promisedOut: QUOTE, feeSides: SIDES }), /breaks greaterThanOrEqualTo/);
});

test("Jupiter's own route of a sale (the CITY-184 fork's bytes) runs under the CITY-195 mandate, and its tampered copies do not", () => {
  const body = JSON.parse(readFileSync(new URL("./fixtures/route-sell-btc.json", import.meta.url), "utf8"));
  const fork = JSON.parse(readFileSync(new URL("./fixtures/fork-pass-2022.json", import.meta.url), "utf8"));
  const btc = K(body.inputMint);
  const forkHuman = K(fork.human);
  const forkVault = K(fork.vault);
  const forkAgent = K(fork.agent);
  const budget = tokenAccountOf(forkVault, btc, TOKEN_2022_PROGRAM_ID);
  const receiver = tokenAccountOf(forkHuman, NATIVE_MINT);
  const request = { inputMint: btc, outputMint: NATIVE_MINT, amount: BigInt(body.inAmount), vault: forkVault, agent: forkAgent, receiver, slippageBps: 100, fee: { bps: 100, account: FEE_WSOL } };
  const route = readAgentRoute(body, request);
  /* Jupiter's quote is after Ryntra's fee: the plan's 12 299 579 out, less 1 %. */
  assert.equal(route.outAmount, 12_176_584n);
  assert.equal(BigInt(body.routePlan[0].swapInfo.outAmount) - agentFeeRaw(BigInt(body.routePlan[0].swapInfo.outAmount), 100), route.outAmount);
  const terms = {
    human: forkHuman,
    agent: forkAgent,
    budgetMint: btc,
    perTrade: request.amount,
    perDay: request.amount,
    slippageBps: SALE_SLIPPAGE_BPS,
    expiresAt: SECONDS(NOW) + 86_400n,
    venue: { kind: "jupiter" },
    fixedBuy: { amountIn: request.amount, outputMint: NATIVE_MINT, minOut: jupiterSaleFloor(route.outAmount) },
    budgetCoin: { program: TOKEN_2022_PROGRAM_ID, decimals: 6 },
  };
  const policy = mandatePolicy(terms, { vault: forkVault, budgetAccount: budget });
  const facts = new Map([[tokenAccountOf(forkVault, NATIVE_MINT).toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(NATIVE_MINT, forkVault) }]]);
  const inner = (ix) => ({ programId: ix.programId, accounts: ix.keys.map((k) => k.pubkey), data: ix.data });
  assert.equal(instructionRefusal(inner(route.swap), policy.constraints[0], facts), null, "the real route meets her sale's rules");
  const copy = (mutate) => {
    const ix = apiInstruction(body.swapInstruction);
    mutate(ix);
    return inner(ix);
  };
  assert.match(instructionRefusal(copy((ix) => (ix.keys[7] = { ...ix.keys[7], pubkey: tokenAccountOf(attacker, NATIVE_MINT) })), policy.constraints[0], facts), /account 7/);
  assert.match(instructionRefusal(copy((ix) => ix.data.writeBigUInt64LE(1n, 16)), policy.constraints[0], facts), /breaks greaterThanOrEqualTo/);
  assert.match(instructionRefusal(copy((ix) => ix.data.writeUInt16LE(1_000, 26)), policy.constraints[0], facts), /breaks lessThanOrEqualTo/);
  /* A price 1 % lower than the review's still sells; 2 % lower does not. */
  assert.equal(instructionRefusal(copy((ix) => ix.data.writeBigUInt64LE((route.outAmount * 99n) / 100n, 16)), policy.constraints[0], facts), null);
  assert.match(instructionRefusal(copy((ix) => ix.data.writeBigUInt64LE((route.outAmount * 98n) / 100n, 16)), policy.constraints[0], facts), /breaks greaterThanOrEqualTo/);
});

test("mainnet: the cron finishes a sale a request did not, through Jupiter", async () => {
  const s = await stand();
  await review(s);
  signed(s, await readSale(s.store, salePolicy.toBase58(), "mainnet"));
  /* The request had no key: the sale waits, signed. */
  assert.equal((await go(s, jupiter(), { key: null })).receipt.status, "signed");
  const lines = await runSalePass({ gate, store: s.store, connection: s.connection, key: s.key, journal: s.journal, venue: jupiter(), now: () => NOW });
  assert.deepEqual(lines, [{ policy: salePolicy.toBase58(), did: "sold" }]);
});

/* ------------------------------------------------------------------ tidying up */

/** A sale already sold in the book, its mandate still on chain. */
async function soldBefore(s, policy = oldSale, status = "sold", { createdAt = NOW - 2 * HOUR, onChain = true } = {}) {
  await writeSale(s.store, {
    v: 1,
    kind: "sale",
    cluster: "mainnet",
    parent: buyPolicy.toBase58(),
    record: { ...BUY_RECORD, policy: policy.toBase58(), budget: vaultCoin.toBase58(), perTrade: "250000", perDay: "250000" },
    coin: coin.toBase58(),
    decimals: 6,
    share: 25,
    amountRaw: "250000",
    floorRaw: "2000",
    quoteRaw: "2475",
    feeBps: 100,
    feeRaw: "25",
    status,
    trade: status === "sold" ? { at: NOW - HOUR, status: "ok", signature: "s", spentRaw: "250000", receivedRaw: "2475", reason: null } : null,
    createdAt,
    updatedAt: createdAt,
  });
  if (onChain) s.connection.accounts.set(policy.toBase58(), { owner: SSA_PROGRAM_ID, data: policyData(3, agent), lamports: 8_062_000, executable: false });
}

test("her next sale removes the mandates of her sales already sold: their rent comes back with the signature she gives anyway", async () => {
  const s = await stand();
  await soldBefore(s);
  const answer = await review(s);
  assert.equal(answer.ok, true, answer.reason);
  const plain = await review(await stand());
  assert.equal(answer.transactions.length, plain.transactions.length, "no transaction more than the sale itself needs");
  const flat = answer.transactions.flatMap(instructionsOf);
  const removal = flat.find((ix) => removes(ix, oldSale));
  assert.ok(removal, "the sold sale's mandate is removed");
  assert.ok(removal.keys[1].pubkey.equals(human) && removal.keys[1].isSigner, "she is the rent payer: the rent goes back to her");
  /* Her wSOL stays: the new sale pays into it. */
  assert.equal(flat.some((ix) => closesDirectly(ix, herWsol)), false);
  /* A sale under way is no sale to remove. */
  const busy = await stand();
  await soldBefore(busy, oldSale, "signed");
  const flatBusy = (await review(busy)).transactions.flatMap(instructionsOf);
  assert.equal(flatBusy.some((ix) => removes(ix, oldSale)), false);
  /* A mandate already removed is not removed twice. */
  const gone = await stand();
  await soldBefore(gone);
  gone.connection.accounts.delete(oldSale.toBase58());
  assert.equal((await review(gone)).transactions.flatMap(instructionsOf).some((ix) => removes(ix, oldSale)), false);
});

test("her stop tidies up: the sold sales' mandates, the vault's empty account of the coin, her wSOL unwrapped — all in the one transaction", async () => {
  const s = await stand();
  await soldBefore(s);
  s.connection.accounts.set(vaultCoin.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coin, vault, 0n), lamports: 2_039_280, executable: false });
  const tidy = stopTidy({ store: s.store, connection: s.connection, network: "mainnet", now: () => NOW });
  const stop = await reviewStop({ owner: human.toBase58(), settings: settings.toBase58(), policy: buyPolicy.toBase58() }, "mainnet", s.connection, { tidy });
  assert.equal(stop.ok, true, stop.reason);
  assert.equal(stop.transactions.length, 1);
  const flat = instructionsOf(stop.transactions[0]);
  assert.ok(flat.some((ix) => removes(ix, buyPolicy)), "the agent stops");
  assert.ok(flat.some((ix) => removes(ix, oldSale)), "the sold sale's mandate goes too");
  assert.ok(flat.some((ix) => closesDirectly(ix, herWsol) && ix.keys[1].pubkey.equals(human) && ix.keys[2].pubkey.equals(human)), "her wSOL into her wallet as SOL");
  const executions = flat.filter((ix) => ix.programId.equals(SSA_PROGRAM_ID) && ix.keys[0].pubkey.equals(settings) && !removes(ix, buyPolicy) && !removes(ix, oldSale));
  const closedInVault = executions.some((ix) => ix.keys.some((k) => k.pubkey.equals(vaultCoin)));
  assert.ok(closedInVault, "the vault's empty coin account is closed");
  /* Nothing to tidy without the book: the stop alone, as before. */
  const bare = await reviewStop({ owner: human.toBase58(), settings: settings.toBase58(), policy: buyPolicy.toBase58() }, "mainnet", s.connection);
  assert.ok(instructionsOf(bare.transactions[0]).length < flat.length);
});

test("her stop closes an empty account of a coin that withholds a fee on transfers only after sweeping it to the mint", async () => {
  const REAL = JSON.parse(readFileSync(new URL("./fixtures/token-2022-mints.json", import.meta.url), "utf8"));
  const s = await stand({ coinProgram: TOKEN_2022_PROGRAM_ID, mint: Buffer.from(REAL.mints.SI.data, "base64"), epoch: REAL.epoch });
  const vault2022 = tokenAccountOf(vault, coin, TOKEN_2022_PROGRAM_ID);
  s.connection.accounts.set(vault2022.toBase58(), { owner: TOKEN_2022_PROGRAM_ID, data: tokenData(coin, vault, 0n), lamports: 2_074_080, executable: false });
  const stop = await reviewStop({ owner: human.toBase58(), settings: settings.toBase58(), policy: buyPolicy.toBase58() }, "mainnet", s.connection, { tidy: stopTidy({ store: s.store, connection: s.connection, network: "mainnet", now: () => NOW }) });
  const flat = instructionsOf(stop.transactions[0]);
  /* Token-2022's transfer-fee instruction (26), its harvest to the mint (4): the mint and the vault's account. */
  const sweep = flat.findIndex((ix) => ix.programId.equals(TOKEN_2022_PROGRAM_ID) && ix.data[0] === 26 && ix.data[1] === 4 && ix.keys[0].pubkey.equals(coin) && ix.keys[1].pubkey.equals(vault2022));
  const close = flat.findIndex((ix) => ix.programId.equals(SSA_PROGRAM_ID) && ix.keys.some((k) => k.pubkey.equals(vault2022)));
  assert.ok(sweep >= 0, "the withheld fee is swept");
  assert.ok(close > sweep, "then the account is closed");
});

test("her stop leaves alone what a sale under way needs: her wSOL and the coin in the vault", async () => {
  const s = await stand();
  await soldBefore(s, oldSale, "signed");
  s.connection.accounts.set(vaultCoin.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coin, vault, 250_000n), lamports: 2_039_280, executable: false });
  const stop = await reviewStop({ owner: human.toBase58(), settings: settings.toBase58(), policy: buyPolicy.toBase58() }, "mainnet", s.connection, { tidy: stopTidy({ store: s.store, connection: s.connection, network: "mainnet", now: () => NOW }) });
  const flat = instructionsOf(stop.transactions[0]);
  assert.equal(flat.some((ix) => closesDirectly(ix, herWsol)), false);
  assert.equal(flat.some((ix) => removes(ix, oldSale)), false);
  assert.equal(flat.some((ix) => ix.keys.some((k) => k.pubkey.equals(vaultCoin))), false);
});

/* The CITY-195 fork run of 4.11: her review's first transaction landed (the coin in her vault), the second did not — no sale
   mandate, the coin sitting there. Her stop must still bring everything home. */
test("her stop brings home the coin a review left in the vault once that review can no longer be signed, then closes the account", async () => {
  const s = await stand();
  await soldBefore(s, oldSale, "review", { createdAt: NOW - 5 * 60_000, onChain: false });
  s.connection.accounts.set(vaultCoin.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coin, vault, 250_000n), lamports: 2_039_280, executable: false });
  const stop = await reviewStop({ owner: human.toBase58(), settings: settings.toBase58(), policy: buyPolicy.toBase58() }, "mainnet", s.connection, { tidy: stopTidy({ store: s.store, connection: s.connection, network: "mainnet", now: () => NOW }) });
  assert.equal(stop.ok, true, stop.reason);
  assert.equal(stop.transactions.length, 1, "one signature");
  const flat = instructionsOf(stop.transactions[0]);
  const vaultExecutions = flat.filter((ix) => ix.programId.equals(SSA_PROGRAM_ID) && ix.keys.some((k) => k.pubkey.equals(vaultCoin)));
  const home = vaultExecutions.findIndex((ix) => ix.keys.some((k) => k.pubkey.equals(herCoin)));
  assert.ok(home >= 0, "the coin goes to her own account first");
  assert.equal(vaultExecutions.length, 2, "then the account is closed in its own execution");
  assert.ok(flat.indexOf(vaultExecutions[0]) < flat.indexOf(vaultExecutions[1]) && home === 0);
  assert.ok(flat.some((ix) => closesDirectly(ix, herWsol)), "and her wSOL unwrapped");
  /* The very instructions of the tidy: her account opened if needed, a TransferChecked of all 250 000 to her. */
  const plan = planTidy({ human, settings, vault }, { policies: [], empty: [{ account: vaultCoin, program: TOKEN_PROGRAM_ID, left: { mint: coin, amount: 250_000n, decimals: 6, to: herCoin } }], unwrap: null });
  assert.ok(plan[0].keys[1].pubkey.equals(herCoin), "her coin account opened idempotently");
  assert.ok(flat.some((ix) => Buffer.from(ix.data).equals(Buffer.from(plan[1].data))), "the transfer home is the plan's");
});

test("a review she may still sign keeps the vault and her wSOL as they are; a sale that did not sell has its mandate removed", async () => {
  const fresh = await stand();
  await soldBefore(fresh, oldSale, "review", { createdAt: NOW - 30_000, onChain: false });
  fresh.connection.accounts.set(vaultCoin.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coin, vault, 250_000n), lamports: 2_039_280, executable: false });
  const tidy = stopTidy({ store: fresh.store, connection: fresh.connection, network: "mainnet", now: () => NOW });
  const flat = instructionsOf((await reviewStop({ owner: human.toBase58(), settings: settings.toBase58(), policy: buyPolicy.toBase58() }, "mainnet", fresh.connection, { tidy })).transactions[0]);
  assert.equal(flat.some((ix) => ix.keys.some((k) => k.pubkey.equals(vaultCoin))), false, "its blockhash still lives: the coin waits for it");
  assert.equal(flat.some((ix) => closesDirectly(ix, herWsol)), false);
  /* Not sold: its mandate goes with the stop, and the coin it left comes home. */
  const failed = await stand();
  await soldBefore(failed, oldSale, "failed");
  failed.connection.accounts.set(vaultCoin.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coin, vault, 250_000n), lamports: 2_039_280, executable: false });
  const stopped = instructionsOf((await reviewStop({ owner: human.toBase58(), settings: settings.toBase58(), policy: buyPolicy.toBase58() }, "mainnet", failed.connection, { tidy: stopTidy({ store: failed.store, connection: failed.connection, network: "mainnet", now: () => NOW }) })).transactions[0]);
  assert.ok(stopped.some((ix) => removes(ix, oldSale)));
  assert.ok(stopped.some((ix) => ix.programId.equals(SSA_PROGRAM_ID) && ix.keys.some((k) => k.pubkey.equals(herCoin))));
});

test("the transactions of one review carry one blockhash: the chain keeps it alive for both, and a relay sends them in order", async () => {
  const s = await stand();
  const answer = await review(s);
  const hashes = answer.transactions.map((wire) => VersionedTransaction.deserialize(Buffer.from(wire, "base64")).message.recentBlockhash);
  assert.equal(answer.transactions.length, 2);
  assert.equal(new Set(hashes).size, 1, "a fork that expires a blockhash after each send must give the second a fresh one (harness/fork-pass-195.mjs)");
});

test("«Take it back» on mainnet: the coin home, the vault's account kept for the agent still buying, her wSOL unwrapped", async () => {
  const s = await stand();
  await soldBefore(s);
  await review(s);
  const row = await readSale(s.store, salePolicy.toBase58(), "mainnet");
  signed(s, row);
  await writeSale(s.store, { ...row, status: "failed", trade: { at: NOW, status: "failed", signature: null, spentRaw: "0", receivedRaw: null, reason: "the price fell under your floor" } });
  const back = await reviewSaleBack({ owner: human.toBase58(), policy: salePolicy.toBase58() }, gate, { store: s.store, connection: s.connection, now: () => NOW });
  assert.equal(back.ok, true, back.reason);
  const flat = instructionsOf(back.transactions[0]);
  assert.ok(flat.some((ix) => removes(ix, salePolicy)), "this sale's mandate removed");
  assert.ok(flat.some((ix) => removes(ix, oldSale)), "and the one sold before");
  assert.ok(flat.some((ix) => closesDirectly(ix, herWsol)), "her wSOL unwrapped");
  /* The coin back to her inside the vault's execution — emptied, not closed: the agent's buys land in that account first. */
  const kept = planWithdraw(saleMandate(row, gate), BigInt(row.amountRaw), { keepOpen: true }).at(-1);
  const closed = planWithdraw(saleMandate(row, gate), BigInt(row.amountRaw)).at(-1);
  assert.ok(flat.some((ix) => Buffer.from(ix.data).equals(Buffer.from(kept.data))), "the coin goes home, the account stays");
  assert.equal(flat.some((ix) => Buffer.from(ix.data).equals(Buffer.from(closed.data))), false);
  /* Her agent stopped: the account is closed after all, its rent hers. */
  s.connection.accounts.delete(buyPolicy.toBase58());
  const after = instructionsOf((await reviewSaleBack({ owner: human.toBase58(), policy: salePolicy.toBase58() }, gate, { store: s.store, connection: s.connection, now: () => NOW })).transactions[0]);
  assert.ok(after.some((ix) => Buffer.from(ix.data).equals(Buffer.from(closed.data))));
});

test("tidying never adds a transaction: what does not fit waits — her wSOL first, then empty accounts, then mandates one by one", () => {
  const owner = { human, settings, vault };
  const tidy = { policies: [oldSale, salePolicy], empty: [{ account: vaultCoin, program: TOKEN_PROGRAM_ID }], unwrap: herWsol };
  assert.equal(planTidy(owner, tidy).length, 3);
  assert.deepEqual(planTidy(owner, NO_TIDY), []);
  const small = withTidy(owner, [[]], tidy);
  assert.equal(small.transactions.length, 1);
  assert.deepEqual(small.tidied, tidy);
  /* A transaction near the packet's ceiling: only what fits is added, and still one transaction. */
  const filler = (n) => new TransactionInstruction({ programId: SSA_PROGRAM_ID, keys: [{ pubkey: human, isSigner: true, isWritable: true }], data: Buffer.alloc(n) });
  for (const size of [700, 820, 900, 1_000, 1_150]) {
    const out = withTidy(owner, [[filler(size)]], tidy);
    assert.equal(out.transactions.length, 1);
    /* Dropped in order: a mandate is let go only once her wSOL and the empty accounts are. */
    if (out.tidied.policies.length < tidy.policies.length) assert.ok(out.tidied.unwrap === null && out.tidied.empty.length === 0, String(size));
    if (out.tidied.empty.length < tidy.empty.length) assert.equal(out.tidied.unwrap, null, String(size));
    if (size >= 1_150) assert.deepEqual(out.tidied, NO_TIDY);
  }
});

test("the sale's routes are open on mainnet and the tower's window sells there: no devnet-only refusal left", () => {
  for (const path of ["sell/route.ts", "sell/go/route.ts", "sell/back/route.ts"]) {
    const source = readFileSync(new URL(`../../app/api/bots/mandate/${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /devnet only/i, path);
    assert.match(source, /mandateConnection\(gate\.network\)/, path);
  }
  assert.match(readFileSync(new URL("../../app/api/bots/mandate/sell/go/route.ts", import.meta.url), "utf8"), /saleVenueOf\(connection, gate\)/);
  const window = readFileSync(new URL("../../city/components/autopilot/AgentSell.tsx", import.meta.url), "utf8");
  assert.match(window, /if \(!AUTOPILOT_NET \|\| !MANDATE_NET\) return null;/);
  assert.doesNotMatch(window, /MANDATE_NET !== 'devnet'/);
});
