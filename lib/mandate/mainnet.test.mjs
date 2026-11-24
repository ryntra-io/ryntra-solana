// The agent on mainnet: the registry's agent, Google's key only,
// Jupiter's route, the book and its claims by network, and the chain asked which network it is before anything.
import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { forgetKmsAddresses } from "../launch/signer/gcp-kms.server.ts";
import { startKmsStub, STUB_TOKEN, versionName } from "../launch/signer/kms-stub.fixture.mjs";
import { agentKeyFor, agentMinute, joinBook } from "./agent-service.server.ts";
import { bookOf, entryKey, mandateOf, readBook, rememberHeldDaily } from "./book.server.ts";
import { ANT_ADDRESS, antMintData, paused } from "./fixtures/stock-mint.mjs";
import { tokenAccountOf } from "./human.ts";
import { MAINNET_GENESIS, mandateGate, onNetwork, registryAgent, relayMandate, reviewEnable, reviewStop } from "./service.server.ts";
import { TOKEN_PROGRAM_ID, ssaAddress } from "./ssa.ts";
import { TOKEN_2022_PROGRAM_ID } from "./token-2022.ts";

const AGENT = "E1w1XFq33ft6rGz19qTSzKKNuFvChbrUCZuY47adMfLV";
const KEY = "projects/ryntra-513408/locations/us-east4/keyRings/ryntra-signers/cryptoKeys/agent-mandate/cryptoKeyVersions/1";
const someone = () => Keypair.generate().publicKey.toBase58();
const chainOf = (genesis) => ({ getGenesisHash: async () => genesis });
const DEVNET = chainOf("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
/* A budget is the person's own numbers; this one is 0.1 SOL a day, as any other would be. */
const SOL = 1_000_000_000n;
const BUDGET = { perDay: SOL / 10n, perTrade: SOL / 50n, days: 30 };

test("mainnet's agent is the registry's one address: the environment may only repeat it", () => {
  assert.equal(registryAgent()?.toBase58(), AGENT);
  assert.deepEqual(mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet" }), { open: true, network: "mainnet", pool: null, agent: new PublicKey(AGENT) });
  assert.equal(mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet", RYNTRA_AGENT_MANDATE_AGENT: AGENT }).open, true);
  assert.deepEqual(mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet", RYNTRA_AGENT_MANDATE_AGENT: someone() }), { open: false }, "another address closes the gate");
  assert.deepEqual(mandateGate({ RYNTRA_AGENT_MANDATE: "Mainnet" }), { open: false });
  const two = [...ATTRIBUTION_REGISTRY, { ...ATTRIBUTION_REGISTRY.find((row) => row.role === "AGENT_SIGNER"), id: "solana-agent-signer-two", address: someone() }];
  assert.equal(registryAgent(two), null, "two open agents are none");
  assert.equal(registryAgent(ATTRIBUTION_REGISTRY.filter((row) => row.role !== "AGENT_SIGNER")), null);
});

test("on mainnet only Google's key signs, and only as the registry's agent", async () => {
  const gate = mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet" });
  const pair = Keypair.generate();
  assert.equal(agentKeyFor({ RYNTRA_AGENT_MANDATE_KEY: JSON.stringify([...pair.secretKey]) }, { ...gate, agent: pair.publicKey }), null, "the environment's key never signs on mainnet");
  assert.equal(agentKeyFor({ RYNTRA_AGENT_MANDATE_SIGNER: "env", RYNTRA_AGENT_MANDATE_KEY: JSON.stringify([...pair.secretKey]) }, { ...gate, agent: pair.publicKey }), null);
  forgetKmsAddresses();
  const stub = await startKmsStub();
  try {
    const name = versionName("agent-mainnet");
    const env = { RYNTRA_AGENT_MANDATE_SIGNER: "kms", RYNTRA_AGENT_MANDATE_KMS_KEY: name, RYNTRA_LAUNCH_KMS_ENDPOINT: stub.endpoint, RYNTRA_LAUNCH_KMS_ACCESS_TOKEN: STUB_TOKEN };
    const key = agentKeyFor(env, gate);
    assert.equal(key.mode, "kms");
    await assert.rejects(key.sign(Uint8Array.of(1)), /not E1w1/, "a KMS key of another address signs nothing");
    const own = agentKeyFor(env, { ...gate, agent: new PublicKey(stub.addressOf(name)) });
    assert.equal((await own.sign(Uint8Array.of(1))).length, 64);
  } finally {
    await stub.close();
  }
  assert.equal(agentKeyFor({ RYNTRA_AGENT_MANDATE_SIGNER: "kms", RYNTRA_AGENT_MANDATE_KMS_KEY: KEY, RYNTRA_LAUNCH_KMS_ACCESS_TOKEN: "t" }, gate).keyRef, KEY);
});

test("the chain says which network it is: a devnet endpoint builds, relays and trades nothing on mainnet", async () => {
  assert.equal(await onNetwork(chainOf(MAINNET_GENESIS), "mainnet"), true);
  assert.equal(await onNetwork(DEVNET, "mainnet"), false);
  assert.equal(await onNetwork({ getGenesisHash: async () => { throw new Error("429"); } }, "mainnet"), false);
  const gate = mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet" });
  assert.equal((await reviewEnable({ owner: someone(), budget: BUDGET, coin: someone() }, gate, DEVNET)).code, "NOT_MAINNET");
  assert.equal((await reviewStop({ owner: someone(), settings: someone(), policy: someone() }, "mainnet", DEVNET)).code, "NOT_MAINNET");
  assert.equal((await relayMandate({ owner: someone(), items: [] }, "mainnet", DEVNET)).code, "NOT_MAINNET");
  assert.equal((await reviewStop({ owner: someone(), settings: someone(), policy: someone() }, "devnet", chainOf(MAINNET_GENESIS))).code, "NOT_DEVNET", "devnet stays devnet");
});

test("on mainnet the person names the coin; the agent's mandate trades it through Jupiter", async () => {
  const gate = mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet" });
  const mainnet = chainOf(MAINNET_GENESIS);
  assert.equal((await reviewEnable({ owner: someone(), budget: BUDGET }, gate, mainnet)).code, "VALIDATION_ERROR");
  assert.equal((await reviewEnable({ owner: someone(), budget: BUDGET, coin: "So11111111111111111111111111111111111111112" }, gate, mainnet)).code, "VALIDATION_ERROR", "SOL is the budget, not a coin to buy");
  assert.equal((await reviewEnable({ owner: AGENT, budget: BUDGET, coin: someone() }, gate, mainnet)).code, "VALIDATION_ERROR", "the agent is not the person");
  const record = { owner: someone(), settings: someone(), vault: someone(), policy: someone(), budget: someone(), perTrade: "20000000", perDay: "100000000", expiresAt: "1" };
  const entry = { v: 1, cluster: "mainnet", record, preset: "small", strategy: "steady", said: null, receiveMint: someone(), status: "working", trades: [], createdAt: 1, updatedAt: 1 };
  const mandate = mandateOf(entry, gate);
  assert.deepEqual([mandate.cluster, mandate.terms.venue.kind, mandate.terms.agent.toBase58()], ["mainnet", "jupiter", AGENT]);
});

test("the book keeps each network apart: a mainnet pass reads mainnet's mandates only", async () => {
  const store = createMemoryGuardStore();
  const record = (policy) => ({ owner: someone(), settings: someone(), vault: someone(), policy, budget: someone(), perTrade: "20000000", perDay: "100000000", expiresAt: "1" });
  const row = (cluster, policy) => ({ v: 1, cluster, record: record(policy), preset: "small", strategy: "steady", said: null, receiveMint: someone(), status: "working", trades: [], createdAt: 1, updatedAt: 1 });
  const devnetPolicy = someone();
  const mainnetPolicy = someone();
  await bookOf(store).set(entryKey("devnet", devnetPolicy), row("devnet", devnetPolicy));
  await bookOf(store).set(entryKey("mainnet", mainnetPolicy), row("mainnet", mainnetPolicy));
  assert.deepEqual((await readBook(store, "mainnet")).map((entry) => entry.record.policy), [mainnetPolicy]);
  assert.deepEqual((await readBook(store)).map((entry) => entry.record.policy), [devnetPolicy]);
  const gate = mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet" });
  const durable = { ...store, durability: "DURABLE_SINGLE_WRITER" };
  assert.equal((await joinBook({ record: record(someone()), strategy: "steady", said: null, coin: someone() }, gate, { store: durable, connection: DEVNET })).code, "NOT_MAINNET");
  assert.deepEqual(await agentMinute({ RYNTRA_AGENT_MANDATE: "mainnet" }), { ran: false, why: "no-key" }, "no Google key named, no pass");
});

test("mainnet takes any budget the person writes — no ceiling of Ryntra's; only numbers the agent cannot trade are refused, before the chain", async () => {
  const { registerMandate } = await import("./book.server.ts");
  const presets = await import("./presets.ts");
  assert.equal("PRESETS_ON" in presets, false, "the 0.1 SOL a day of decision 103 is gone");
  const gate = mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet" });
  const owner = someone();
  const origin = async () => ({ launchedHere: false, creator: null });
  /* 1000 SOL a day, 100 a trade, a year: past the budget, on to the chain — here a chain that has no smart account program. */
  const big = { perDay: 1000n * SOL, perTrade: 100n * SOL, days: 365 };
  const empty = { ...chainOf(MAINNET_GENESIS), getSlot: async () => 1, getBlockTime: async () => null, getAccountInfo: async () => null };
  assert.deepEqual(await reviewEnable({ owner, budget: big, coin: someone() }, gate, empty, { origin }), { ok: false, code: "UNAVAILABLE", reason: "The smart account program is not readable." });
  /* What is not a budget the agent trades is refused before anything is read. */
  const untouched = { ...chainOf(MAINNET_GENESIS), getAccountInfo: async () => assert.fail("the chain is not read") };
  for (const wrong of [{ ...BUDGET, perTrade: 1n }, { ...BUDGET, perTrade: BUDGET.perDay + 1n }, { ...BUDGET, perTrade: BUDGET.perDay / 100n }, { ...BUDGET, days: 0 }, { ...BUDGET, days: 3651 }]) {
    const review = await reviewEnable({ owner, budget: wrong, coin: someone() }, gate, untouched, { origin });
    assert.equal(review.code, "VALIDATION_ERROR", JSON.stringify(wrong, (_, v) => (typeof v === "bigint" ? String(v) : v)));
  }
  /* The book takes the same big numbers to the chain's own check: a mandate the chain does not have is refused there, not by a ceiling. */
  const record = { owner, settings: someone(), vault: someone(), policy: someone(), budget: someone(), perTrade: big.perTrade.toString(), perDay: big.perDay.toString(), expiresAt: String(Math.floor(Date.now() / 1000) + 365 * 86_400) };
  const joined = await registerMandate({ record, strategy: "steady", said: null }, gate, { store: createMemoryGuardStore(), connection: empty, receiveMint: async () => assert.fail("no coin is read") });
  assert.equal(joined.code, "REFUSED");
  assert.match(joined.reason, /no such mandate on chain/);
});

test("the person cannot name a coin of Ryntra's launchpad, or her own launch — refused before she signs, before the chain", async () => {
  const gate = mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet" });
  const mainnet = { ...chainOf(MAINNET_GENESIS), getAccountInfo: async () => assert.fail("the chain is not read"), getSlot: async () => assert.fail("the chain is not read") };
  const owner = someone();
  const launched = someone();
  const origin = async (mint) => (mint === launched ? { launchedHere: true, creator: someone() } : { launchedHere: false, creator: null });
  assert.deepEqual(await reviewEnable({ owner, budget: BUDGET, coin: launched }, gate, mainnet, { origin }), { ok: false, code: "REFUSED", reason: "The agent does not buy coins launched on Ryntra." });
  const own = async () => ({ launchedHere: true, creator: owner });
  assert.deepEqual(await reviewEnable({ owner, budget: BUDGET, coin: launched }, gate, mainnet, { origin: own }), { ok: false, code: "REFUSED", reason: "The agent does not buy your own coin." });
  const down = async () => { throw new Error("down"); };
  assert.equal((await reviewEnable({ owner, budget: BUDGET, coin: launched }, gate, mainnet, { origin: down })).code, "UNAVAILABLE");
  /* The store's own record by default: Launch's `launches`. */
  const { getGuardRuntime } = await import("../guard/runtime.ts");
  const recorded = someone();
  await getGuardRuntime().store.collection("launches").set(`solana:mainnet:${recorded}`, { state: "LAUNCHED", token: recorded, creator: someone() });
  assert.equal((await reviewEnable({ owner, budget: BUDGET, coin: recorded }, gate, mainnet)).code, "REFUSED");
});

/* ------------------------------------------------------------------ the budget's review: only a coin the agent buys */

/* Mints read from mainnet 02.11.2026 (`./fixtures/token-2022-mints.json`), and ANT's of 20.11 (`./fixtures/stock-mint.mjs`). */
const REAL_MINTS = JSON.parse(readFileSync(new URL("./fixtures/token-2022-mints.json", import.meta.url), "utf8"));
const realMint = (name) => ({ address: REAL_MINTS.mints[name].address, owner: new PublicKey(REAL_MINTS.mints[name].owner), data: Uint8Array.from(Buffer.from(REAL_MINTS.mints[name].data, "base64")) });
/* A coin of Token as the program writes it: six decimals, initialized; with a freeze authority when asked. */
const tokenMint = (freeze = false) => Uint8Array.from({ length: 82 }, (_, at) => (at === 44 ? 6 : at === 45 ? 1 : at === 46 && freeze ? 1 : 0));
/* The smart account program's config as the chain holds it: its mark, the next account's number, no fee. */
const CONFIG = Uint8Array.from([196, 210, 90, 231, 144, 149, 140, 63, 7, ...new Array(87).fill(0)]);
const MEME_SIDE = (mint) => ({ mint, verified: false, tags: [], firstPoolAt: null });
const sidesOf = (tags) => async (mint) => (mint === "So11111111111111111111111111111111111111112" ? { mint, verified: true, tags: [], firstPoolAt: null } : tags === null ? null : tags.length ? { mint, verified: true, tags, firstPoolAt: null } : MEME_SIDE(mint));

/** The review of a budget for one coin, on a mainnet that holds its mint as given; what it answers, and what its signature opens. */
async function budgetFor({ coin = Keypair.generate().publicKey.toBase58(), mint, tags = [], stocks, epoch = async () => ({ epoch: 1092 }), exit = false, deps = {} }) {
  const gate = mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet" });
  const owner = Keypair.generate().publicKey;
  const address = new PublicKey(coin);
  const chain = {
    ...chainOf(MAINNET_GENESIS),
    getSlot: async () => 1,
    getBlockTime: async () => null,
    getEpochInfo: epoch,
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    getAccountInfo: async (key) => {
      if (key.equals(ssaAddress.programConfig())) return { owner: PublicKey.default, data: CONFIG };
      if (key.equals(address)) {
        if (mint === "unread") throw new Error("429");
        return mint;
      }
      return null;
    },
  };
  const review = await reviewEnable({ owner: owner.toBase58(), budget: BUDGET, coin, ...(exit ? { exit: true } : {}) }, gate, chain, { origin: async () => ({ launchedHere: false, creator: null }), sides: sidesOf(tags), ...(stocks ? { stocks } : {}), ...deps });
  if (!review.ok) return { review, opens: [], chain };
  const vault = new PublicKey(review.record.vault);
  const flat = review.transactions.flatMap((wire) => TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(wire, "base64")).message).instructions);
  /* The associated-token program's openings of this coin: the account, and the token program it is opened under. */
  const opens = flat.filter((ix) => ix.keys[3]?.pubkey.equals(address)).map((ix) => [ix.keys[1].pubkey.toBase58(), ix.keys[5].pubkey.toBase58()]);
  const under = (program) => [
    [tokenAccountOf(owner, address, program).toBase58(), program.toBase58()],
    [tokenAccountOf(vault, address, program).toBase58(), program.toBase58()],
  ];
  return { review, opens, under, chain };
}
const onShelf = async () => true;

test("the budget's signature is given only for a coin the agent buys, and opens the coin's accounts under the coin's own program", async () => {
  /* A coin of Token: as ever, under Token. */
  const token = await budgetFor({ mint: { owner: TOKEN_PROGRAM_ID, data: tokenMint() } });
  assert.equal(token.review.ok, true, token.review.reason);
  assert.deepEqual(token.opens, token.under(TOKEN_PROGRAM_ID));
  /* A coin of Token-2022 with a name and a picture only — a launchpad's coin: under Token-2022. Under Token its budget never landed. */
  const stair = realMint("STAIR");
  const clean = await budgetFor({ coin: stair.address, mint: stair });
  assert.equal(clean.review.ok, true, clean.review.reason);
  assert.deepEqual(clean.opens, clean.under(TOKEN_2022_PROGRAM_ID));
  /* A stock of xStocks, the engine's switches open and the shelf naming it: under Token-2022, at the table's rate for a stock. */
  const tsla = realMint("TSLAx");
  const stock = await budgetFor({ coin: tsla.address, mint: tsla, tags: ["verified", "stocks", "rwa", "xstocks", "token-2022"], stocks: onShelf });
  assert.equal(stock.review.ok, true, stock.review.reason);
  assert.deepEqual(stock.opens, stock.under(TOKEN_2022_PROGRAM_ID));
});

test("a budget is refused before a signature for every coin the agent would refuse at its buys — with the buy's own words", async () => {
  const refusedFor = async (given, code, reason) => {
    const { review } = await budgetFor(given);
    assert.equal(review.ok, false, "no signature is offered");
    assert.equal(review.code, code);
    assert.match(review.reason, reason);
    assert.equal(review.transactions, undefined);
  };
  /* A coin that runs its issuer's program on transfers — PUMP's own mint. */
  const pump = realMint("PUMP");
  await refusedFor({ coin: pump.address, mint: pump }, "REFUSED", /^The agent does not trade this coin: the coin runs its issuer's own program on every transfer\.$/);
  /* A permanent delegate — PYUSD's; the shelf saying yes to everything does not make it a stock's (its other features are no stock's). */
  const pyusd = realMint("PYUSD");
  await refusedFor({ coin: pyusd.address, mint: pyusd, tags: ["verified", "stable"] }, "REFUSED", /take the coin out of any wallet/);
  await refusedFor({ coin: pyusd.address, mint: pyusd, stocks: onShelf }, "REFUSED", /hide its amounts/);
  /* Bytes that are no mint: eighty-two zeroes, under either program; an account of no token program. */
  await refusedFor({ mint: { owner: TOKEN_PROGRAM_ID, data: new Uint8Array(82) } }, "REFUSED", /it is not a coin's mint/);
  await refusedFor({ mint: { owner: TOKEN_2022_PROGRAM_ID, data: new Uint8Array(82) } }, "REFUSED", /it is not a coin's mint/);
  await refusedFor({ mint: { owner: PublicKey.default, data: tokenMint() } }, "REFUSED", /it is not a token of the token programs/);
  /* A mint the chain does not hold, or the node did not answer for: said so — never opened under Token on a guess. */
  await refusedFor({ mint: null }, "UNAVAILABLE", /The coin the agent buys is not readable/);
  await refusedFor({ mint: "unread" }, "UNAVAILABLE", /The coin the agent buys is not readable/);
  /* A coin of Token whose issuer can freeze her wallet: the agent never bought it, and now says so before she pays. */
  await refusedFor({ mint: { owner: TOKEN_PROGRAM_ID, data: tokenMint(true) } }, "REFUSED", /its issuer can freeze your wallet of it/);
  /* A stock with the engine's switches closed (as here: no shelf handed in, none in the environment), or not on the shelf. */
  const tsla = realMint("TSLAx");
  const xstock = ["verified", "stocks", "rwa", "xstocks", "token-2022"];
  await refusedFor({ coin: tsla.address, mint: tsla, tags: xstock }, "REFUSED", /take the coin out of any wallet/);
  await refusedFor({ coin: tsla.address, mint: tsla, tags: xstock, stocks: async () => false }, "REFUSED", /take the coin out of any wallet/);
  /* A stock on the shelf that its issuer has paused now. */
  await refusedFor({ coin: ANT_ADDRESS, mint: { owner: TOKEN_2022_PROGRAM_ID, data: paused(antMintData()) }, tags: xstock, stocks: onShelf }, "REFUSED", /its issuer can stop every transfer of the coin/);
  /* A stock of Backpack, on the shelf and moving: Ryntra's table names no router fee for it, so no buy would ever be made. */
  await refusedFor({ coin: ANT_ADDRESS, mint: { owner: TOKEN_2022_PROGRAM_ID, data: antMintData() }, tags: ["verified", "stocks", "rwa", "backpack", "token-2022"], stocks: onShelf }, "REFUSED", /^The agent does not trade this pair: Ryntra's table names no router fee for it\.$/);
  /* What could not be read is not guessed: the coin's facts, the chain's epoch. */
  await refusedFor({ mint: { owner: TOKEN_PROGRAM_ID, data: tokenMint() }, tags: null }, "UNAVAILABLE", /The coin's facts are not readable/);
  const stair = realMint("STAIR");
  await refusedFor({ coin: stair.address, mint: stair, epoch: async () => { throw new Error("429"); } }, "UNAVAILABLE", /The chain's epoch is not readable/);
});

test("the coin's day limit Ryntra reads for a budget with the agent's sale is kept — and the book takes the mandate only with that figure", async () => {
  const mint = { owner: TOKEN_PROGRAM_ID, data: tokenMint() };
  const kept = [];
  const coin = Keypair.generate().publicKey.toBase58();
  const { review, chain } = await budgetFor({ coin, mint, exit: true, deps: { dayCoins: async () => 1_000n, remember: async (ticket) => void kept.push(ticket) } });
  assert.equal(review.ok, true, review.reason);
  assert.equal(review.record.heldDaily, "2000", "her day's cap in the coin, twice");
  assert.deepEqual(kept, [{ policy: review.record.policy, heldDaily: "2000" }]);
  /* A book that does not keep it: nothing for her to sign. */
  const down = await budgetFor({ mint, exit: true, deps: { dayCoins: async () => 1_000n, remember: async () => Promise.reject(new Error("store down")) } });
  assert.deepEqual([down.review.ok, down.review.code], [false, "UNAVAILABLE"]);
  /* The book: without the server's figure for this policy — refused; with it, the mandate goes on to the chain's own checks. */
  const gate = mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet" });
  const store = { ...createMemoryGuardStore(), durability: "DURABLE_SINGLE_WRITER" };
  const ask = { record: review.record, strategy: "steady", said: null, coin, exit: { stopBps: 1_500, halfAtBps: 20_000, fadeBps: 2_000, holdH: null } };
  assert.match((await joinBook(ask, gate, { store, connection: chain, exitOn: true })).reason, /day limit is not the one Ryntra read/);
  await rememberHeldDaily(store, "mainnet", kept[0]);
  assert.doesNotMatch((await joinBook(ask, gate, { store, connection: chain, exitOn: true })).reason ?? "", /day limit/);
});
