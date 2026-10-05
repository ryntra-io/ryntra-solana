import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";

import { buildCapabilities } from "../api/v1/capabilities.server.ts";
import { CREATOR_LOCK_SCHEDULES, creatorLockTerms } from "../core/launch/creator-lock.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { launchNetwork, launchPoolPayer } from "./config.server.ts";
import { launchShareLink, prepareLaunch, readLaunchRecord, settleLaunchLock, submitLaunch } from "./flow.server.ts";
import { checkLaunchForm, imageTypeOf, normalizeLink } from "./form.ts";
import { metadataJson, metadataOfUri, readLaunchImage, storeLaunchImage, storeLaunchMetadata } from "./metadata.server.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f1d1a80000000049454e44ae426082", "hex");

test("Launch is closed unless the devnet stand switches it on — no page, no route, no capability", () => {
  const stand = { RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "http://localhost:3020" };
  assert.equal(launchNetwork({}), null);
  assert.equal(launchNetwork({ RYNTRA_LAUNCH_STAND: "mainnet" }), null, "mainnet opens with its own subtask, not by a flag");
  assert.equal(launchNetwork(stand)?.cluster, "devnet");
  assert.equal(launchNetwork(stand)?.origin, "http://localhost:3020");
  assert.equal(launchNetwork({ ...stand, VERCEL_ENV: "production" }), null, "a stand flag left on production opens nothing");
  assert.equal(launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet" }), null, "no public origin, no stand: the origin never comes from a request");
  assert.equal(launchNetwork({ ...stand, RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io/evil?x" }), null);
  assert.equal(buildCapabilities({ env: {} }).launch, undefined);
  assert.equal(buildCapabilities({ env: stand }).launch?.network, "solana:devnet");
  for (const file of ["lib/launch/runtime.server.ts", "app/app/launch/[mint]/page.tsx"]) {
    assert.doesNotMatch(read(file), /x-forwarded-host|publicOriginOf|await headers\(\)/, `${file} takes no origin from a request`);
  }
  for (const page of ["app/app/launch/new/page.tsx", "app/app/launch/[mint]/page.tsx"]) {
    assert.match(read(page), /if \(!(network|launchNetwork\(\))\) notFound\(\)/, `${page} is not found without Launch`);
    /* generateMetadata runs before the page: a closed Launch names nothing in the tab's title either. */
    assert.match(read(page), /generateMetadata[\s\S]{0,300}if \(!launchNetwork\(\)\) return \{\};/, `${page} names nothing in its title without Launch`);
  }
  for (const route of ["presets", "metadata", "quote", "build", "submit", "[mint]"]) {
    assert.match(read(`app/api/v1/launch/${route}/route.ts`), /if \(!(launchNetwork\(\)|network)\) return apiFailure\("LAUNCH_UNAVAILABLE"/, `${route} refuses without Launch`);
  }
  /* No menu, no link: nothing in the shell names the pages. */
  assert.doesNotMatch(read("app/shell/domains.ts"), /\/app\/launch/);
  assert.doesNotMatch(read("app/shell/product-routes.ts"), /\/app\/launch/);
});

test("the pool payer's key comes only from the environment, whole, and a malformed one is no key", () => {
  const key = Keypair.generate();
  assert.equal(launchPoolPayer({ RYNTRA_LAUNCH_POOL_PAYER_SECRET: JSON.stringify([...key.secretKey]) })?.publicKey.toBase58(), key.publicKey.toBase58());
  assert.equal(launchPoolPayer({}), null);
  assert.equal(launchPoolPayer({ RYNTRA_LAUNCH_POOL_PAYER_SECRET: "[1,2,3]" }), null);
  assert.equal(launchPoolPayer({ RYNTRA_LAUNCH_POOL_PAYER_SECRET: "not json" }), null);
});

test("the form: required fields, the ticker's letters, links made whole, a borrowed name marked", () => {
  const empty = checkLaunchForm({ name: "", symbol: "", description: "", website: "", x: "", telegram: "" });
  assert.deepEqual(empty.problems, { name: "REQUIRED", symbol: "REQUIRED" });
  const filled = checkLaunchForm({ name: "  Moon   Cat ", symbol: "$mcat", description: "hi", website: "mooncat.example", x: "x.com/mooncat", telegram: "t.me/mooncat" });
  assert.deepEqual(filled.problems, {});
  assert.deepEqual(filled.clean, { name: "Moon Cat", symbol: "MCAT", description: "hi", links: { website: "https://mooncat.example/", x: "https://x.com/mooncat", telegram: "https://t.me/mooncat" } });
  assert.equal(checkLaunchForm({ name: "Cat", symbol: "M-C", description: "", website: "", x: "", telegram: "" }).problems.symbol, "SYMBOL_CHARS");
  assert.equal(checkLaunchForm({ name: "x".repeat(33), symbol: "A", description: "", website: "", x: "", telegram: "" }).problems.name, "TOO_LONG");
  assert.equal(checkLaunchForm({ name: "Tesla", symbol: "TSL", description: "", website: "", x: "", telegram: "" }).problems.name, "BORROWED");
  assert.deepEqual(normalizeLink("x", "mooncat"), { ok: false });
  assert.deepEqual(normalizeLink("x", "https://x.com/"), { ok: false }, "a profile, not the site");
  assert.deepEqual(normalizeLink("telegram", "https://example.com/mooncat"), { ok: false });
  assert.deepEqual(normalizeLink("website", "http://insecure.example"), { ok: false });
  assert.deepEqual(normalizeLink("website", "https://user:pw@evil.example"), { ok: false });
  assert.deepEqual(normalizeLink("website", "   "), { ok: true, value: null });
});

test("a picture is what its bytes are, not what it is called", () => {
  assert.equal(imageTypeOf(PNG), "image/png");
  assert.equal(imageTypeOf(Buffer.from("ffd8ffe0", "hex")), "image/jpeg");
  assert.equal(imageTypeOf(Buffer.from("47494638396101", "hex")), "image/gif");
  assert.equal(imageTypeOf(Buffer.from("524946460000000057454250", "hex")), "image/webp");
  assert.equal(imageTypeOf(Buffer.from("<svg onload=alert(1)>")), null);
});

test("the picture and the metadata live at the sha256 of their own bytes — one address, one content, for ever", async () => {
  const store = createMemoryGuardStore();
  const stored = await storeLaunchImage(store, new Uint8Array(PNG), "2026-10-05T10:00:00.000Z");
  assert.ok(stored.ok);
  assert.equal(stored.image.sha256, createHash("sha256").update(PNG).digest("hex"));
  assert.equal(stored.image.contentType, "image/png");
  assert.deepEqual(await storeLaunchImage(store, new Uint8Array(Buffer.from("<svg/>")), "x"), { ok: false, code: "IMAGE_TYPE" });
  assert.deepEqual(await storeLaunchImage(store, new Uint8Array(300 * 1024).fill(0x89), "x"), { ok: false, code: "IMAGE_TOO_LARGE" });
  assert.equal(await readLaunchImage(store, "../etc"), null);
  const metadata = { name: "Moon Cat", symbol: "MCAT", description: "", image: `https://ryntra.io/api/launch/image/${stored.image.sha256}`, createdOn: "https://ryntra.io" };
  const one = await storeLaunchMetadata(store, metadata, "2026-10-05T10:00:00.000Z");
  const two = await storeLaunchMetadata(store, { createdOn: "https://ryntra.io", image: metadata.image, description: "", symbol: "MCAT", name: "Moon Cat" }, "2026-10-05T11:00:00.000Z");
  assert.equal(one.sha256, two.sha256, "the same metadata in any key order is the same address");
  assert.equal(one.sha256, createHash("sha256").update(metadataJson(metadata)).digest("hex"));
  assert.equal(two.storedAt, "2026-10-05T10:00:00.000Z", "a second write never replaces the first");
  assert.deepEqual((await metadataOfUri(store, `https://ryntra.io/api/launch/metadata/${one.sha256}`, "https://ryntra.io"))?.metadata, metadata);
  assert.equal(await metadataOfUri(store, `https://elsewhere.example/api/launch/metadata/${one.sha256}`, "https://ryntra.io"), null);
});

test("the creator's lock: nothing before the cliff, then daily to the end, the whole purchase inside, no one can cancel", () => {
  const terms = creatorLockTerms(9_809_619_123_456n, CREATOR_LOCK_SCHEDULES["1m-3m"], 1_790_000_000);
  assert.equal(terms.cliffTime, 1_790_000_000 + 30 * 86_400);
  assert.equal(terms.endTime, 1_790_000_000 + 120 * 86_400);
  assert.equal(terms.frequency, 86_400);
  assert.equal(terms.numberOfPeriod, 90);
  assert.equal(terms.cliffUnlockAmount + terms.amountPerPeriod * 90n, 9_809_619_123_456n);
  assert.ok(terms.cliffUnlockAmount < 90n, "only the remainder unlocks at the cliff");
  assert.equal(terms.cancelMode, 0);
  assert.equal(terms.updateRecipientMode, 0);
  assert.throws(() => creatorLockTerms(0n, CREATOR_LOCK_SCHEDULES["1m-3m"], 0));
});

test("the share link is the creator's referral, landing on the token — the exact path the referral route is asked to accept", () => {
  assert.equal(launchShareLink("https://ryntra.io", { token: "Mint111", referralCode: "ABC123" }), "https://ryntra.io/r/ABC123?to=/app/launch/Mint111");
  const to = new URL(launchShareLink("https://ryntra.io", { token: "F4pmJAEZDtJ4JPE7QwK7zrD6R1Ypgi7nTCGxTM7AsLGQ", referralCode: "ABC123" })).searchParams.get("to");
  assert.match(to, /^\/app\/launch\/[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.equal(launchShareLink("https://ryntra.io", { token: "Mint111", referralCode: null }), "https://ryntra.io/app/launch/Mint111");
});

test("submit refuses before the pool payer signs: another wallet, an old build, other bytes, a missing signature, a second press", async () => {
  const store = createMemoryGuardStore();
  const poolPayer = Keypair.generate();
  const creator = Keypair.generate();
  const mint = Keypair.generate();
  const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  const sent = [];
  const connection = {
    sendRawTransaction: async (bytes) => {
      sent.push(bytes);
      return "sig";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  };
  const now = new Date("2026-10-05T10:00:00.000Z");
  const deps = { network, connection, store, poolPayer, origin: "https://ryntra.io", now: () => now };
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: poolPayer.publicKey, lamports: 1000 }), SystemProgram.transfer({ fromPubkey: mint.publicKey, toPubkey: poolPayer.publicKey, lamports: 0 }));
  tx.feePayer = poolPayer.publicKey;
  tx.recentBlockhash = "11111111111111111111111111111111";
  tx.partialSign(mint);
  const messageSha256 = createHash("sha256").update(tx.serializeMessage()).digest("hex");
  const build = {
    id: "a".repeat(32),
    cluster: "devnet",
    creator: creator.publicKey.toBase58(),
    preset: "classic",
    token: mint.publicKey.toBase58(),
    pool: mint.publicKey.toBase58(),
    config: mint.publicKey.toBase58(),
    pairMint: mint.publicKey.toBase58(),
    metadataUri: "https://ryntra.io/api/launch/metadata/x",
    name: "Moon Cat",
    symbol: "MCAT",
    firstBuyInRaw: "0",
    firstBuyOutRaw: "0",
    payerCoveredLamports: "1000",
    messageSha256,
    lock: null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    validUntil: "100",
  };
  await store.collection("launchBuilds").set(`devnet:${build.id}`, build);
  const wire = (transaction) => transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const unsigned = Transaction.from(Buffer.from(wire(tx), "base64"));
  const signed = Transaction.from(Buffer.from(wire(tx), "base64"));
  signed.partialSign(creator);
  const input = { buildId: build.id, creator: creator.publicKey.toBase58(), signedWireBase64: wire(signed), signedLockWireBase64: null };

  assert.equal((await submitLaunch(deps, { ...input, buildId: "b".repeat(32) })).code, "NOT_BUILT");
  assert.equal((await submitLaunch(deps, { ...input, creator: Keypair.generate().publicKey.toBase58() })).code, "WRONG_CREATOR");
  assert.equal((await submitLaunch(deps, { ...input, signedWireBase64: wire(unsigned) })).code, "SIGNATURE_MISSING");
  const other = new Transaction().add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: poolPayer.publicKey, lamports: 2000 }));
  other.feePayer = poolPayer.publicKey;
  other.recentBlockhash = tx.recentBlockhash;
  other.partialSign(creator);
  assert.equal((await submitLaunch(deps, { ...input, signedWireBase64: wire(other) })).code, "SIGNED_OTHER_BYTES");
  assert.equal(sent.length, 0, "nothing was sent on a refusal");
  assert.equal((await submitLaunch({ ...deps, now: () => new Date(now.getTime() + 120_000) }, input)).code, "BUILD_EXPIRED");
  /* The creator's day is counted by sends: three already today, this one is refused and frees its claim. */
  const attempts = store.collection("launchAttempts");
  for (const id of ["x1", "x2", "x3"]) await attempts.set(`solana:devnet:${creator.publicKey.toBase58()}:${id}`, { buildId: id, creator: creator.publicKey.toBase58(), at: now.toISOString() });
  assert.equal((await submitLaunch(deps, input)).code, "CREATOR_LIMIT");
  assert.equal(sent.length, 0);
  for (const id of ["x1", "x2", "x3"]) await attempts.delete(`solana:devnet:${creator.publicKey.toBase58()}:${id}`);

  const first = await submitLaunch(deps, input);
  assert.equal(first.ok, true);
  assert.equal(sent.length, 1);
  const landed = Transaction.from(sent[0]);
  assert.ok(landed.verifySignatures(true), "the pool payer signed last, over the creator's bytes");
  assert.equal((await submitLaunch(deps, input)).code, "BUILD_USED");
  assert.equal(sent.length, 1, "a second press sends nothing");
  const record = await store.collection("launches").get(`solana:devnet:${mint.publicKey.toBase58()}`);
  assert.equal(record.creator, creator.publicKey.toBase58());
  assert.equal(record.state, "LAUNCHED");
  assert.ok(record.referralCode, "the creator's referral code is on the record for the link they share");
});

test("a send the network has not answered for is PENDING, and the chain's word settles it later", async () => {
  const store = createMemoryGuardStore();
  const record = { cluster: "devnet", state: "PENDING", token: "Tok1", creator: "Cre1", signature: "sig1", validUntil: "100", buildId: "b1" };
  await store.collection("launchAttempts").set("solana:devnet:Cre1:b1", { buildId: "b1", creator: "Cre1", at: "t" });
  await store.collection("launches").set("solana:devnet:Tok1", record);
  const chain = (status, height = 50) => ({ getSignatureStatuses: async () => ({ value: [status] }), getBlockHeight: async () => height });
  assert.equal((await readLaunchRecord({ store, connection: chain(null) }, "devnet", "Tok1")).state, "PENDING", "unknown stays pending");
  assert.equal((await readLaunchRecord({ store, connection: chain({ err: null, confirmationStatus: "confirmed" }) }, "devnet", "Tok1")).state, "LAUNCHED");
  await store.collection("launches").set("solana:devnet:Tok1", record);
  assert.equal(await readLaunchRecord({ store, connection: chain(null, 101) }, "devnet", "Tok1"), null, "expired and never seen: nothing landed");
  assert.equal(await store.collection("launches").get("solana:devnet:Tok1"), undefined);
  assert.equal(await store.collection("launchAttempts").get("solana:devnet:Cre1:b1"), undefined, "never seen by the chain: its send counts against no limit");
});

test("a lock without an answer in time is PENDING, never «not created»: its escrow settles it LOCKED, a refused signature FAILED", async () => {
  const store = createMemoryGuardStore();
  const base = { cluster: "devnet", state: "LAUNCHED", token: "Tok2", creator: "Cre2", signature: "sig2", validUntil: "100", buildId: "b2" };
  const pending = { ...base, lock: { schedule: "1m-3m", escrow: "Esc2", signature: "lockSig", state: "PENDING", reason: null } };
  const chain = (status) => ({ getSignatureStatuses: async () => ({ value: [status] }), getBlockHeight: async () => 50 });
  assert.equal((await settleLaunchLock({ store, connection: chain(null) }, pending, false)).lock.state, "PENDING", "no escrow yet, no answer: still pending");
  const locked = await settleLaunchLock({ store, connection: chain(null) }, pending, true);
  assert.equal(locked.lock.state, "LOCKED", "the escrow is on chain: locked, whatever the send said");
  assert.equal((await store.collection("launches").get("solana:devnet:Tok2")).lock.state, "LOCKED");
  assert.equal((await settleLaunchLock({ store, connection: chain({ err: { x: 1 }, confirmationStatus: "confirmed" }) }, pending, false)).lock.state, "FAILED");
  const failedThenFound = await settleLaunchLock({ store, connection: chain(null) }, { ...pending, lock: { ...pending.lock, state: "FAILED" } }, true);
  assert.equal(failedThenFound.lock.state, "LOCKED", "the chain outranks the send's word");
});

test("a build is refused before anything reaches the chain: unknown metadata, a borrowed name, a lock without a buy, the day's limit, a low payer", async () => {
  const store = createMemoryGuardStore();
  const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  let balance = 1_000_000_000;
  const connection = { getBalance: async () => balance };
  const deps = { network, connection, store, poolPayer: Keypair.generate(), origin: "https://ryntra.io", now: () => new Date("2026-10-05T10:00:00.000Z") };
  const creator = Keypair.generate().publicKey.toBase58();
  const meta = async (name, symbol) => `https://ryntra.io/api/launch/metadata/${(await storeLaunchMetadata(store, { name, symbol, description: "", image: "https://ryntra.io/api/launch/image/x", createdOn: "https://ryntra.io" }, "t")).sha256}`;
  const base = { creator, preset: "protected", firstBuyRaw: "0", lock: null };
  assert.equal((await prepareLaunch(deps, { ...base, metadataUri: "https://ryntra.io/api/launch/metadata/" + "0".repeat(64) })).code, "METADATA_NOT_FOUND");
  assert.equal((await prepareLaunch(deps, { ...base, metadataUri: "https://elsewhere.example/api/launch/metadata/" + "0".repeat(64) })).code, "METADATA_NOT_FOUND");
  /* Stored before the rule knew the name, or by hand: the build checks again. */
  assert.equal((await prepareLaunch(deps, { ...base, metadataUri: await meta("Трамп", "TRMP") })).code, "NAME_BORROWED");
  const ok = await meta("Moon Cat", "MCAT");
  assert.equal((await prepareLaunch(deps, { ...base, metadataUri: ok, lock: "1m-3m" })).code, "LOCK_NEEDS_PURCHASE");
  for (const id of ["a", "b", "c"]) await store.collection("launchAttempts").set(`solana:devnet:${creator}:${id}`, { buildId: id, creator, at: "2026-10-05T09:00:00.000Z" });
  assert.equal((await prepareLaunch(deps, { ...base, metadataUri: ok })).code, "CREATOR_LIMIT");
  const other = { ...base, creator: Keypair.generate().publicKey.toBase58(), metadataUri: ok };
  balance = 1_000;
  assert.equal((await prepareLaunch(deps, other)).code, "PAYER_LOW");
});

test("a send the network's preflight refuses costs nobody anything and counts against no limit; one that fails on chain stays counted", async () => {
  for (const [label, connection, counted] of [
    ["preflight", { sendRawTransaction: async () => { const error = new Error("Simulation failed. Message: Transaction simulation failed: insufficient funds"); error.logs = ["Program log: insufficient funds"]; throw error; } }, 0],
    ["on chain", { sendRawTransaction: async () => "sig", confirmTransaction: async () => ({ value: { err: { InstructionError: [1, "Custom"] } } }) }, 1],
  ]) {
    const store = createMemoryGuardStore();
    const poolPayer = Keypair.generate();
    const creator = Keypair.generate();
    const mint = Keypair.generate();
    const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
    const now = new Date("2026-10-05T10:00:00.000Z");
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: poolPayer.publicKey, lamports: 1000 }), SystemProgram.transfer({ fromPubkey: mint.publicKey, toPubkey: poolPayer.publicKey, lamports: 0 }));
    tx.feePayer = poolPayer.publicKey;
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.partialSign(mint, creator);
    const unsigned = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
    const id = "c".repeat(32);
    await store.collection("launchBuilds").set(`devnet:${id}`, {
      id, cluster: "devnet", creator: creator.publicKey.toBase58(), preset: "classic", token: mint.publicKey.toBase58(), pool: mint.publicKey.toBase58(), config: mint.publicKey.toBase58(), pairMint: mint.publicKey.toBase58(),
      metadataUri: "https://ryntra.io/api/launch/metadata/x", name: "Moon Cat", symbol: "MCAT", firstBuyInRaw: "0", firstBuyOutRaw: "0", payerCoveredLamports: "1000",
      messageSha256: createHash("sha256").update(unsigned.serializeMessage()).digest("hex"), lock: null, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), validUntil: "100",
    });
    const deps = { network, connection, store, poolPayer, origin: "https://ryntra.io", now: () => now };
    const result = await submitLaunch(deps, { buildId: id, creator: creator.publicKey.toBase58(), signedWireBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), signedLockWireBase64: null });
    assert.equal(result.code, "SUBMIT_FAILED", label);
    assert.equal((await store.collection("launchAttempts").valuesWithPrefix("solana:devnet:")).length, counted, label);
    assert.equal(await store.collection("launches").get(`solana:devnet:${mint.publicKey.toBase58()}`), undefined, `${label}: no launch is recorded`);
  }
});
