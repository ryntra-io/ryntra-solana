/**
 * CITY-220 · the three doors of the city's launch on mainnet's recorded state — no network is reached.
 *
 * Mainnet's preset configs as the audit of 18.10 read them (`lib/core/venues/meteora-dbc/fixtures/
 * mainnet-dbc-accounts-2026-10-18.json`; a DBC config never changes once created), and the engine's own launch venue
 * building on them: the creation, and the sharing of the creator's fees. The city reads every byte before the wallet:
 *
 * - the shield: the config the shield launches on is Classic's, and Classic's fee on mainnet is the halo's — bots pay
 *   20 % falling to 1 % over two minutes;
 * - the creation: this coin, this creator, the preset's own config, nothing bought, the pool payer covered exactly;
 * - Fee Sharing: the vault with exactly the parts shown, the curve's creator role handed to it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";

import { createMeteoraDbcLaunchVenue } from "../../../lib/core/venues/meteora-dbc/launch.server.ts";
import { launchPreset } from "../../../lib/core/venues/meteora-dbc/presets.ts";
import { createDbcClient } from "../../../lib/core/venues/meteora-dbc/sdk.server.ts";
import { fixtureConnection } from "../../../lib/core/venues/meteora-dbc/sdk-compare-kit.mjs";
import { CURVE_PROGRAM, checkCreation, presetConfig } from "./create-check.ts";
import { CITY_CLOSED, runLaunch } from "./flow.ts";
import { CITY_SHIELD, shieldsBots } from "./shield.ts";
import { checkSplit } from "./split-check.ts";
import { STUB_PRESETS, stubEngine } from "./stub.ts";

const fixture = JSON.parse(readFileSync(new URL("../../../lib/core/venues/meteora-dbc/fixtures/mainnet-dbc-accounts-2026-10-18.json", import.meta.url), "utf8"));
const ACCOUNTS = Object.fromEntries(Object.entries(fixture.accounts).map(([address, entry]) => [address, { owner: entry.owner, data: Buffer.from(entry.data, "base64") }]));
const seeded = (byte) => Keypair.fromSeed(Buffer.alloc(32, byte));
/* Mainnet's pool payer as the registry names it: the city refuses any other one there, as the engine does. */
const POOL_PAYER = (await import("../../../lib/attribution/registry.ts")).ATTRIBUTION_REGISTRY.find((row) => row.id === "solana-launch-pool-payer" && row.end === null).address;
const CREATOR = seeded(72).publicKey.toBase58();
const FRIEND = seeded(73).publicKey.toBase58();
const MOD = seeded(74).publicKey.toBase58();
const COVERED = 7_350_240n;
const wire = (tx) => tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
const txOf = (base64) => Transaction.from(Buffer.from(base64, "base64"));

/**
 * The recorded accounts, plus what the engine's creation asks of a network around them: balances, and a simulation in
 * which the pool payer spends `COVERED` on the rent unless the creator hands it exactly that first.
 */
function recordedConnection() {
  const base = fixtureConnection(ACCOUNTS).connection;
  const extra = {
    getBalance: async () => 10_000_000_000,
    simulateTransaction: async (vtx, options) => {
      const keys = vtx.message.staticAccountKeys.map((key) => key.toBase58());
      const covers = vtx.message.compiledInstructions.some((ix) => keys[ix.programIdIndex] === SystemProgram.programId.toBase58());
      const accounts = options.accounts.addresses.map((address) => {
        if (address === POOL_PAYER) return { lamports: covers ? 10_000_000_000 : 10_000_000_000 - Number(COVERED) };
        return { lamports: 10_000_000_000 - (covers ? Number(COVERED) + 10_000 : 0) };
      });
      return { value: { err: null, accounts } };
    },
  };
  return new Proxy({}, { get: (_, property) => (property in extra ? extra[property] : base[property]) });
}

const venue = createMeteoraDbcLaunchVenue({ connection: recordedConnection(), configs: fixture.configs, poolPayer: POOL_PAYER });
/** The coin as the review showed it: the name, the ticker and the metadata address the engine stored. */
const COIN = { name: "Kite", symbol: "KITE", uri: "https://ryntra.io/api/launch/metadata/kite" };
const create = (preset, options = {}, coin = COIN) =>
  venue.create({ preset, creator: CREATOR, name: coin.name, symbol: coin.symbol, metadataUri: coin.uri }, { creatorCoversPayer: true, ...options });
const SHARES = [
  { address: CREATOR, bps: 7_000 },
  { address: FRIEND, bps: 2_000 },
  { address: MOD, bps: 1_000 },
];

/* ---------------------------------------------------------------- the shield */

test("the shield's curve on mainnet: Classic's recorded config makes bots pay 20 % falling to 1 % over two minutes", async () => {
  const client = createDbcClient(fixtureConnection(ACCOUNTS).connection, "1.5.13");
  assert.equal(CITY_SHIELD.preset, "classic");
  assert.equal(presetConfig("solana:mainnet", "classic"), fixture.configs.classic, "the registry names the config the audit read");
  assert.equal(presetConfig("solana:mainnet", "protected"), fixture.configs.protected);
  assert.equal(presetConfig("solana:devnet", "classic"), null, "the stand's configs are its own");
  for (const preset of ["classic", "protected"]) {
    const state = await client.state.getPoolConfig(fixture.configs[preset]);
    const fee = state.poolFees.baseFee;
    assert.equal(Number(fee.baseFeeMode), 1, `${preset}: an exponential schedule`);
    const periods = Number(fee.firstFactor);
    const seconds = periods * Number(fee.secondFactor.toString());
    const startBps = Number(fee.cliffFeeNumerator.toString()) / 100_000;
    const endBps = startBps * (1 - Number(fee.thirdFactor.toString()) / 10_000) ** periods;
    const want = launchPreset(preset).sniperFee;
    assert.equal(startBps, want.startBps, `${preset}: bots start at the preset's fee`);
    assert.equal(seconds, want.seconds, `${preset}: over the preset's time`);
    assert.equal(periods, want.periods);
    assert.ok(Math.abs(endBps - want.endBps) < 1, `${preset}: falling to ${want.endBps} bps (${endBps.toFixed(2)})`);
    assert.equal(shieldsBots({ startBps, endBps: Math.round(endBps), seconds }), true, `${preset}: at least as hard on bots as the shield`);
  }
  const classic = await client.state.getPoolConfig(fixture.configs.classic);
  assert.equal(Number(classic.poolFees.baseFee.cliffFeeNumerator.toString()) / 100_000, CITY_SHIELD.sniperFee.startBps);
  assert.equal(Number(classic.poolFees.baseFee.firstFactor) * Number(classic.poolFees.baseFee.secondFactor.toString()), CITY_SHIELD.sniperFee.seconds);
});

/* ---------------------------------------------------------------- the creation */

test("the engine's own creation on mainnet's recorded configs reads back as exactly the launch the review showed", async () => {
  for (const preset of ["classic", "protected"]) {
    const built = await create(preset);
    assert.equal(built.config, fixture.configs[preset]);
    assert.equal(built.payerCoveredLamports, String(COVERED));
    const read = checkCreation({ wire: built.wireBase64, network: "solana:mainnet", preset, creator: CREATOR, token: built.token, payerCoveredLamports: built.payerCoveredLamports, coin: COIN });
    assert.deepEqual(read, { ok: true }, preset);
  }
});

test("a creation other than the one shown never reaches the wallet", async () => {
  const built = await create("classic");
  const ok = { wire: built.wireBase64, network: "solana:mainnet", preset: "classic", creator: CREATOR, token: built.token, payerCoveredLamports: built.payerCoveredLamports, coin: COIN };
  const tx = txOf(built.wireBase64);
  const protectedBuild = await create("protected");
  const swapIx = new TransactionInstruction({
    programId: new PublicKey(CURVE_PROGRAM),
    data: Buffer.from([248, 198, 158, 145, 225, 117, 135, 200, ...new Array(16).fill(0)]),
    keys: [{ pubkey: new PublicKey(CREATOR), isSigner: true, isWritable: true }],
  });
  const plus = (...ixs) => {
    const next = new Transaction({ feePayer: tx.feePayer, recentBlockhash: tx.recentBlockhash }).add(...tx.instructions, ...ixs);
    return wire(next);
  };
  for (const [why, change, reason] of [
    ["the shield's review, Protected's curve", { wire: protectedBuild.wireBase64, token: protectedBuild.token }, "Another curve."],
    ["Classic's review on Protected's bytes", { preset: "protected" }, "Another curve."],
    ["a first purchase slipped in", { wire: plus(swapIx) }, "Not the launch the review showed."],
    ["SOL to someone else", { wire: plus(SystemProgram.transfer({ fromPubkey: new PublicKey(CREATOR), toPubkey: new PublicKey(FRIEND), lamports: 1 })) }, "Unexpected transfer."],
    ["the pool payer handed more than shown", { payerCoveredLamports: String(COVERED - 1n) }, "Another amount."],
    ["another creator", { creator: FRIEND }, "Unexpected signers."],
    ["another coin", { token: protectedBuild.token }, "Unexpected signers."],
    ["unreadable bytes", { wire: "AAAA" }, "Unreadable transaction."],
  ]) {
    const read = checkCreation({ ...ok, ...change });
    assert.equal(read.ok, false, why);
    assert.equal(read.reason, reason, why);
  }
});

test("the creation's name, ticker and metadata are the ones the review showed — read from the engine's own bytes (review 8.11)", async () => {
  const { creationParams } = await import("./create-check.ts");
  const built = await create("classic");
  const vtx = VersionedTransaction.deserialize(Buffer.from(built.wireBase64, "base64"));
  const keys = vtx.message.staticAccountKeys.map((key) => key.toBase58());
  const ix = vtx.message.compiledInstructions.find((entry) => keys[entry.programIdIndex] === CURVE_PROGRAM);
  assert.deepEqual(creationParams(ix.data), COIN, "the engine's InitializePoolParameters, as the IDL lays them");
  const ok = { wire: built.wireBase64, network: "solana:mainnet", preset: "classic", creator: CREATOR, token: built.token, payerCoveredLamports: built.payerCoveredLamports, coin: COIN };
  for (const [why, coin] of [
    ["another name", { ...COIN, name: "Kite2" }],
    ["another ticker", { ...COIN, symbol: "KITE2" }],
    ["other metadata", { ...COIN, uri: "https://ryntra.io/api/launch/metadata/other" }],
    ["a name that differs only in case", { ...COIN, name: "kite" }],
  ]) assert.deepEqual(checkCreation({ ...ok, coin }), { ok: false, reason: "Another coin." }, why);
  /* The engine's bytes for another coin, everything else the same: refused. */
  const other = await create("classic", {}, { name: "Owl", symbol: "OWL", uri: COIN.uri });
  assert.deepEqual(checkCreation({ ...ok, wire: other.wireBase64, token: other.token, payerCoveredLamports: other.payerCoveredLamports }), { ok: false, reason: "Another coin." });
  /* Bytes that do not read as the three strings and nothing more. */
  const head = Uint8Array.from(ix.data.subarray(0, 8));
  assert.equal(creationParams(head), null, "no parameters");
  assert.equal(creationParams(Uint8Array.from([...ix.data, 0])), null, "a byte after them");
  assert.equal(creationParams(Uint8Array.from([...head, 255, 255, 255, 255])), null, "a length past the end");
  assert.equal(creationParams(Uint8Array.from([...head, 1, 0, 0, 0, 0xff, 0, 0, 0, 0, 0, 0, 0, 0])), null, "not UTF-8");
});

/* ---------------------------------------------------------------- Fee Sharing */

test("the engine's own sharing on mainnet's recorded configs: the vault with exactly the parts shown, the curve's creator role handed to it", async () => {
  for (const preset of ["classic", "protected"]) {
    const built = await create(preset, { feeShares: SHARES, crew: true });
    assert.ok(built.split, `${preset}: the sharing is built`);
    assert.deepEqual(checkCreation({ wire: built.wireBase64, network: "solana:mainnet", preset, creator: CREATOR, token: built.token, payerCoveredLamports: built.payerCoveredLamports, coin: COIN }), { ok: true });
    const split = { creationWire: built.wireBase64, splitWire: built.split.wireBase64, creator: CREATOR, token: built.token, feeVault: built.split.vault, shares: SHARES };
    assert.deepEqual(checkSplit(split), { ok: true }, preset);
    assert.equal(checkSplit({ ...split, shares: [{ address: CREATOR, bps: 8_000 }, SHARES[1]] }).ok, false, "other parts");
    assert.equal(checkSplit({ ...split, shares: [SHARES[0], SHARES[2], SHARES[1]] }).ok, false, "another order");
  }
});

/* ---------------------------------------------------------------- the whole launch, through the city's flow */

const BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FIELDS = { name: "Kite", symbol: "KITE", picture: { base64: BASE64, url: `data:image/png;base64,${BASE64}` } };

/** The stand's engine for the store and the send, the engine's own venue on mainnet's records for the build. */
function recordedEngine() {
  const stand = stubEngine();
  const signed = [];
  const engine = {
    ...stand,
    build: async (body) => {
      const built = await create(body.preset, body.feeShares?.length ? { feeShares: body.feeShares, crew: true } : {}, { name: FIELDS.name, symbol: FIELDS.symbol, uri: body.metadataUri });
      return {
        ok: true,
        data: {
          buildId: "0".repeat(32),
          network: "solana:mainnet",
          unsignedWireBase64: built.wireBase64,
          lockUnsignedWireBase64: null,
          token: built.token,
          firstBuyOutRaw: "0",
          payerCoveredLamports: built.payerCoveredLamports,
          creatorCostLamports: built.creatorSpendLamports,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          signableMs: 25_000,
          splitUnsignedWireBase64: built.split?.wireBase64 ?? null,
          feeVault: built.split?.vault ?? null,
        },
      };
    },
    submit: async (body) => {
      signed.push(body);
      return { ok: true, data: { token: "x", signature: "y", state: "LAUNCHED", feeSharing: body.signedSplitWireBase64 ? { state: "SHARED", shares: SHARES } : null } };
    },
  };
  return { engine, signed };
}

const signer = { wallet: "Phantom", address: CREATOR, sign: async (wires) => ({ ok: true, signed: wires }) };

test("each door end to end on mainnet's records: the shield's Classic, Protected, and a shared launch — one prompt, then sent", async () => {
  const classic = STUB_PRESETS.find((preset) => preset.id === "classic");
  const prot = STUB_PRESETS.find((preset) => preset.id === "protected");
  for (const [why, preset, others, wires] of [
    ["the shield: Classic", classic, undefined, 1],
    ["Protected", prot, undefined, 1],
    ["Fee Sharing on Classic", classic, SHARES.slice(1), 2],
    ["Fee Sharing on Protected", prot, SHARES.slice(1), 2],
  ]) {
    const { engine, signed } = recordedEngine();
    const prompts = [];
    const result = await runLaunch({
      engine,
      signer: { ...signer, sign: async (list, chain) => (prompts.push(list.length), signer.sign(list, chain)) },
      fields: FIELDS,
      preset,
      network: "solana:mainnet",
      onPhase: () => undefined,
      switchOpen: true,
      shareSwitch: true,
      shareWord: true,
      others,
    });
    assert.equal(result.step, "done", `${why}: ${result.failure?.message ?? ""}`);
    assert.deepEqual(prompts, [wires], `${why}: one wallet prompt`);
    assert.equal(signed.length, 1, `${why}: sent once`);
  }
});

test("on mainnet without the opening word a split is never built, however the deployment's switch stands", async () => {
  const { engine, signed } = recordedEngine();
  const result = await runLaunch({ engine, signer, fields: FIELDS, preset: STUB_PRESETS.find((preset) => preset.id === "classic"), network: "solana:mainnet", onPhase: () => undefined, switchOpen: true, shareSwitch: true, shareWord: false, others: SHARES.slice(1) });
  assert.equal(result.step, "failed");
  assert.equal(result.failure.code, CITY_CLOSED);
  assert.equal(signed.length, 0);
});

test("on mainnet the pool payer is the registry's, and what the creator hands it has the city's own ceiling", async () => {
  const { poolPayer, MAX_COVERED_LAMPORTS } = await import("./create-check.ts");
  assert.equal(poolPayer("solana:mainnet"), POOL_PAYER);
  assert.equal(poolPayer("solana:devnet"), null, "the stand pays from its own payer");
  assert.ok(COVERED < MAX_COVERED_LAMPORTS, "the real rent sits well under the ceiling");
  /* The engine's honest creation with only the payer swapped for a stranger: refused before the wallet sees it. */
  const built = await create("classic");
  const vtx = VersionedTransaction.deserialize(Buffer.from(built.wireBase64, "base64"));
  vtx.message.staticAccountKeys[0] = seeded(71).publicKey;
  const swapped = Buffer.from(vtx.serialize()).toString("base64");
  assert.deepEqual(checkCreation({ wire: swapped, network: "solana:mainnet", preset: "classic", creator: CREATOR, token: built.token, payerCoveredLamports: built.payerCoveredLamports, coin: COIN }), { ok: false, reason: "Another payer." });
});
