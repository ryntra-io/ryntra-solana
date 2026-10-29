import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { LAUNCHES_PER_HOUR, launchNetwork } from "./config.server.ts";
import { prepareLaunch, readLaunchRecord, submitLaunch } from "./flow.server.ts";
import { checkLaunchForm } from "./form.ts";
import { storeLaunchMetadata } from "./metadata.server.ts";
import { LAUNCH_FAILURE_CODES, launchFailureCode } from "./runtime.server.ts";

/* SOL-L1b «Ціна запуску до підпису»: the refusals the price of a launch brought, and the partner a late launch keeps. */

const FIELDS = { description: "", website: "", x: "", telegram: "" };

test("a name or a ticker with a hate word is refused in the form, by the same guard that keeps it out of Pulse", () => {
  assert.equal(checkLaunchForm({ ...FIELDS, name: "NaziPepe", symbol: "PEPE" }).problems.name, "OFFENSIVE");
  assert.equal(checkLaunchForm({ ...FIELDS, name: "Moon Cat", symbol: "NAZI" }).problems.symbol, "OFFENSIVE");
  assert.deepEqual(checkLaunchForm({ ...FIELDS, name: "Niger Delta", symbol: "NGR" }).problems, {}, "a country stays a country");
});

test("a build is refused when its stored name carries a hate word — the server checks again, whatever the client sent", async () => {
  const store = createMemoryGuardStore();
  const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  const deps = { network, connection: { getBalance: async () => 1_000_000_000 }, store, poolPayer: Keypair.generate(), origin: "https://ryntra.io", now: () => new Date("2026-10-19T10:00:00.000Z") };
  const stored = await storeLaunchMetadata(store, { name: "NaziPepe", symbol: "PEPE", description: "", image: "https://ryntra.io/api/launch/image/x", createdOn: "https://ryntra.io" }, "t");
  const refused = await prepareLaunch(deps, { creator: Keypair.generate().publicKey.toBase58(), preset: "protected", firstBuyRaw: "0", lock: null, metadataUri: `https://ryntra.io/api/launch/metadata/${stored.sha256}` });
  assert.equal(refused.code, "NAME_REFUSED");
  assert.equal(LAUNCH_FAILURE_CODES.NAME_REFUSED, "VALIDATION_ERROR");
});

test("the hour's cap is a busy hour, not a pause: LAUNCH_BUSY to a client of 1.50.0, LAUNCH_PAUSED to an older one", () => {
  const headers = (version) => new Headers(version ? { "X-Ryntra-API-Version": version } : {});
  assert.equal(LAUNCH_FAILURE_CODES.NETWORK_BUSY, "LAUNCH_BUSY");
  assert.equal(launchFailureCode("NETWORK_BUSY", headers("1.50.0")), "LAUNCH_BUSY");
  assert.equal(launchFailureCode("NETWORK_BUSY", headers("1.50.2")), "LAUNCH_BUSY");
  assert.equal(launchFailureCode("NETWORK_BUSY", headers("1.49.0")), "LAUNCH_PAUSED", "a client before 1.50.0 reads it as «nothing was sent»");
  assert.equal(launchFailureCode("NETWORK_BUSY", headers(null)), "LAUNCH_PAUSED");
  assert.equal(launchFailureCode("NETWORK_BUSY", headers("latest")), "LAUNCH_PAUSED");
  assert.equal(launchFailureCode("CREATOR_LIMIT", headers(null)), "LAUNCH_LIMIT", "every other code as before");
});

test("a send past the network's hour of launches is refused as busy, before anything reaches the chain, and is not counted", async () => {
  const store = createMemoryGuardStore();
  const poolPayer = Keypair.generate();
  const creator = Keypair.generate();
  const mint = Keypair.generate();
  const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  const now = new Date("2026-10-19T10:00:00.000Z");
  for (let i = 0; i < LAUNCHES_PER_HOUR; i += 1) await store.collection("launchAttempts").set(`solana:devnet:Other${i}:b${i}`, { buildId: `b${i}`, creator: `Other${i}`, at: "2026-10-19T09:30:00.000Z" });
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: poolPayer.publicKey, lamports: 1000 }), SystemProgram.transfer({ fromPubkey: mint.publicKey, toPubkey: poolPayer.publicKey, lamports: 0 }));
  tx.feePayer = poolPayer.publicKey;
  tx.recentBlockhash = "11111111111111111111111111111111";
  tx.partialSign(mint, creator);
  const unsigned = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  const id = "d".repeat(32);
  await store.collection("launchBuilds").set(`devnet:${id}`, {
    id, cluster: "devnet", creator: creator.publicKey.toBase58(), preset: "classic", token: mint.publicKey.toBase58(), pool: mint.publicKey.toBase58(), config: mint.publicKey.toBase58(), pairMint: mint.publicKey.toBase58(),
    metadataUri: "https://ryntra.io/api/launch/metadata/x", name: "Moon Cat", symbol: "MCAT", firstBuyInRaw: "0", firstBuyOutRaw: "0", payerCoveredLamports: "1000",
    messageSha256: createHash("sha256").update(unsigned.serializeMessage()).digest("hex"), lock: null, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), validUntil: "100",
  });
  let sent = 0;
  const connection = { sendRawTransaction: async () => { sent += 1; return "sig"; } };
  const result = await submitLaunch({ network, connection, store, poolPayer, origin: "https://ryntra.io", now: () => now }, { buildId: id, creator: creator.publicKey.toBase58(), signedWireBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), signedLockWireBase64: null });
  assert.equal(result.code, "NETWORK_BUSY");
  assert.match(result.message, /Too many launches right now/);
  assert.equal(sent, 0, "nothing reaches the chain");
  assert.equal((await store.collection("launchAttempts").valuesWithPrefix(`solana:devnet:${creator.publicKey.toBase58()}`)).length, 0, "the refused send is not counted");
});

test("a launch confirmed after its route gave up is bound to the partner its creator saw — once, and only when it landed", async () => {
  const store = createMemoryGuardStore();
  const token = Keypair.generate().publicKey.toBase58();
  const key = `solana:mainnet:${token}`;
  const partner = { wallet: Keypair.generate().publicKey.toBase58(), code: "MOON", source: "carried" };
  const record = { cluster: "mainnet", state: "PENDING", token, pool: "Pool1", config: "Cfg1", creator: "Cre1", signature: "sig1", validUntil: "100", buildId: "b1", launchedAt: "2026-10-19T10:00:00.000Z", partner, partnerDecided: false };
  const bound = [];
  const bindPartner = async (launched) => { bound.push(launched); };
  const node = (status) => ({
    getSignatureStatuses: async () => ({ context: { slot: 10 }, value: [status] }),
    getBlockHeight: async () => 50,
    getMultipleAccountsInfo: async () => [null],
    getAccountInfo: async () => null,
  });
  await store.collection("launches").set(key, record);
  assert.equal((await readLaunchRecord({ store, connection: node(null), bindPartner }, "mainnet", token)).state, "PENDING");
  assert.equal(bound.length, 0, "not landed: nobody is bound");
  const launched = await readLaunchRecord({ store, connection: node({ err: null, confirmationStatus: "confirmed" }), bindPartner }, "mainnet", token);
  assert.equal(launched.state, "LAUNCHED");
  assert.equal(bound.length, 1);
  assert.deepEqual(bound[0].partner, partner, "the partner the review showed");
  assert.equal(bound[0].signature, "sig1");
  const kept = await store.collection("launches").get(key);
  assert.equal(kept.partner, undefined, "the launched record keeps no partner: the Growth line's binding holds it");
  await readLaunchRecord({ store, connection: node(null), bindPartner }, "mainnet", token);
  assert.equal(bound.length, 1, "a launched record is not bound again");
});

test("the presets the API serves carry the same terms the form shows — one source, parsed by the contract", async () => {
  const { LaunchPresetsResponseSchema } = await import("../api/v1/contract.ts");
  const { presetTerms } = await import("../core/launch/preset-terms.ts");
  const { launchPresetsView } = await import("./runtime.server.ts");
  const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  const view = LaunchPresetsResponseSchema.parse(launchPresetsView(network));
  assert.ok(view.presets.length > 0);
  for (const preset of view.presets) {
    const terms = presetTerms(preset.id);
    assert.deepEqual(preset.terms?.curveSplit, terms.curve.split, preset.id);
    assert.deepEqual(preset.terms?.curveSplitThroughRyntra, terms.curve.splitThroughRyntra, preset.id);
    assert.equal(preset.terms?.graduation.creatorBps, terms.graduation.creatorBps, preset.id);
    assert.equal(preset.terms?.pool.creatorPositionBps, terms.pool.creatorPositionBps, preset.id);
  }
});
