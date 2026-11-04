// CITY-186 — the agent on mainnet, Google's key only,
// Jupiter's route, the book and its claims by network, and the chain asked which network it is before anything.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Keypair, PublicKey } from "@solana/web3.js";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { forgetKmsAddresses } from "../launch/signer/gcp-kms.server.ts";
import { startKmsStub, STUB_TOKEN, versionName } from "../launch/signer/kms-stub.fixture.mjs";
import { agentKeyFor, agentMinute, joinBook } from "./agent-service.server.ts";
import { bookOf, entryKey, mandateOf, readBook } from "./book.server.ts";
import { MAINNET_GENESIS, mandateGate, onNetwork, registryAgent, relayMandate, reviewEnable, reviewStop } from "./service.server.ts";

const AGENT = "E1w1XFq33ft6rGz19qTSzKKNuFvChbrUCZuY47adMfLV";
const KEY = "projects/ryntra-513408/locations/us-east4/keyRings/ryntra-signers/cryptoKeys/agent-mandate/cryptoKeyVersions/1";
const someone = () => Keypair.generate().publicKey.toBase58();
const chainOf = (genesis) => ({ getGenesisHash: async () => genesis });
const DEVNET = chainOf("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");

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
  assert.equal((await reviewEnable({ owner: someone(), preset: "small", coin: someone() }, gate, DEVNET)).code, "NOT_MAINNET");
  assert.equal((await reviewStop({ owner: someone(), settings: someone(), policy: someone() }, "mainnet", DEVNET)).code, "NOT_MAINNET");
  assert.equal((await relayMandate({ owner: someone(), items: [] }, "mainnet", DEVNET)).code, "NOT_MAINNET");
  assert.equal((await reviewStop({ owner: someone(), settings: someone(), policy: someone() }, "devnet", chainOf(MAINNET_GENESIS))).code, "NOT_DEVNET", "devnet stays devnet");
});

test("on mainnet the person names the coin; the agent's mandate trades it through Jupiter", async () => {
  const gate = mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet" });
  const mainnet = chainOf(MAINNET_GENESIS);
  assert.equal((await reviewEnable({ owner: someone(), preset: "small" }, gate, mainnet)).code, "VALIDATION_ERROR");
  assert.equal((await reviewEnable({ owner: someone(), preset: "small", coin: "So11111111111111111111111111111111111111112" }, gate, mainnet)).code, "VALIDATION_ERROR", "SOL is the budget, not a coin to buy");
  assert.equal((await reviewEnable({ owner: AGENT, preset: "small", coin: someone() }, gate, mainnet)).code, "VALIDATION_ERROR", "the agent is not the person");
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

test("mainnet offers one budget, 0.1 SOL a day: a larger one is refused before the chain and before the book", async () => {
  const { BUDGET_PRESETS, PRESETS_ON, presetOpenOn } = await import("./presets.ts");
  const { registerMandate } = await import("./book.server.ts");
  assert.deepEqual([...PRESETS_ON.mainnet], ["small"]);
  assert.equal(BUDGET_PRESETS.small.perDay, 100_000_000n);
  assert.equal(presetOpenOn("devnet", "large"), true, "devnet keeps all three");
  const gate = mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet" });
  const mainnet = { ...chainOf(MAINNET_GENESIS), getAccountInfo: async () => assert.fail("the chain is not read") };
  const review = await reviewEnable({ owner: someone(), preset: "medium", coin: someone() }, gate, mainnet);
  assert.equal(review.ok, false);
  assert.equal(review.code, "VALIDATION_ERROR");
  const medium = BUDGET_PRESETS.medium;
  const record = { owner: someone(), settings: someone(), vault: someone(), policy: someone(), budget: medium.budget.toString(), perTrade: medium.perTrade.toString(), perDay: medium.perDay.toString(), expiresAt: String(Math.floor(Date.now() / 1000) + 86_400) };
  const joined = await registerMandate({ record, strategy: "steady", said: null }, gate, { store: createMemoryGuardStore(), connection: mainnet, receiveMint: async () => assert.fail("no coin is read") });
  assert.equal(joined.ok, false);
  assert.equal(joined.code, "REFUSED");
});
