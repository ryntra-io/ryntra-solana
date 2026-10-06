import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";

import { buildCapabilities } from "../api/v1/capabilities.server.ts";
import { CREATOR_LOCK_SCHEDULES, creatorLockTerms } from "../core/launch/creator-lock.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { LAUNCH_RISK_CODES } from "../core/venues/meteora-dbc/market.ts";
import { getBase58Decoder } from "@solana/kit";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import {
  launchArchiveConnection,
  launchArchiveEndpoint,
  launchHistoryEndpoint,
  launchNetwork,
  launchOpen,
  launchPoolFee,
  launchPoolPayer,
  launchPoolPayerAddress,
  launchWritesHere,
} from "./config.server.ts";
import { REFERRAL_ROUTE_FOLLOWS_TO, launchShareLink, prepareLaunch, readLaunchRecord, settleLaunchLock, submitLaunch } from "./flow.server.ts";
import { checkLaunchForm, imageTypeOf, normalizeLink } from "./form.ts";
import { metadataJson, metadataOfUri, readLaunchImage, storeLaunchImage, storeLaunchMetadata } from "./metadata.server.ts";
import { fillOf, submitLaunchTrade } from "./trade.server.ts";
import { withFallback } from "./view.server.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f1d1a80000000049454e44ae426082", "hex");

test("Launch runs on mainnet on the registry's configs; the devnet stand only on a local server that asks for it", () => {
  const stand = { RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "http://localhost:3020" };
  const mainnet = launchNetwork({});
  assert.equal(mainnet?.cluster, "mainnet");
  assert.equal(mainnet?.chain, "solana:mainnet");
  assert.equal(mainnet?.origin, "https://ryntra.io", "a mint names its metadata on Ryntra's own address for ever");
  const registry = (id) => ATTRIBUTION_REGISTRY.find((row) => row.id === id).address;
  assert.deepEqual(mainnet?.configs, { classic: registry("solana-launch-config-classic"), protected: registry("solana-launch-config-protected") }, "the configs are the registry's, «Спільнота» not yet");
  assert.deepEqual(Object.keys(mainnet?.pairs ?? {}), ["classic", "protected"]);
  assert.equal(mainnet?.pairs.classic?.mint, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(mainnet?.referralOwner, registry("solana-launch-fee-claimer"), "Ryntra's referral accounts belong to the partner's vault");
  assert.equal(mainnet?.feeWallet, registry("solana-fee-wallet"));
  assert.equal(mainnet?.jupiter, true);
  assert.equal(mainnet?.tradesRecorded, false, "a launch's trade is not yet recorded the way a Ryntra fee is");
  assert.equal(launchPoolFee(mainnet), null, "so no Ryntra fee is taken in a graduated pool");
  assert.equal(launchNetwork({ RYNTRA_LAUNCH_STAND: "mainnet" })?.cluster, "mainnet");
  assert.equal(launchNetwork(stand)?.cluster, "devnet");
  assert.equal(launchNetwork(stand)?.origin, "http://localhost:3020");
  assert.equal(launchNetwork({ ...stand, VERCEL_ENV: "production" })?.cluster, "mainnet", "a stand flag left on production opens no stand");
  assert.equal(launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet" }), null, "no public origin, no stand: the origin never comes from a request");
  assert.equal(launchNetwork({ ...stand, RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io/evil?x" }), null);
  assert.equal(buildCapabilities({ env: {} }).launch?.network, "solana:mainnet");
  assert.equal(buildCapabilities({ env: stand }).launch?.network, "solana:devnet");
  for (const file of ["lib/launch/runtime.server.ts", "app/app/launch/[mint]/page.tsx"]) {
    assert.doesNotMatch(read(file), /x-forwarded-host|publicOriginOf|await headers\(\)/, `${file} takes no origin from a request`);
  }
  for (const page of ["app/app/launch/new/page.tsx", "app/app/launch/[mint]/page.tsx"]) {
    assert.match(read(page), /if \(!(network|launchNetwork\(\))\) notFound\(\)/, `${page} is not found where no network is`);
    assert.match(read(page), /generateMetadata[\s\S]{0,300}if \(!launchNetwork\(\)\) return \{\};/, `${page} names nothing in its title where no network is`);
  }
  for (const route of ["presets", "metadata", "quote", "build", "submit", "[mint]"]) {
    assert.match(read(`app/api/v1/launch/${route}/route.ts`), /if \(!(launchNetwork\(\)|network)\) return apiFailure\("LAUNCH_UNAVAILABLE"/, `${route} refuses where no network is`);
  }
  /* One section of the menu, «Лаунч», over every launch page; the form and the cabinet are its tabs (the menu v6.2). */
  const domains = read("app/shell/domains.ts");
  const launch = domains.slice(domains.indexOf("  launch: {"), domains.indexOf("  bots: {"));
  assert.match(launch, /label: \{ en: "Launch", uk: "Лаунч" \}/);
  assert.match(launch, /href: "\/app\/launch\/new"/);
  assert.match(launch, /match: \["\/app\/launch"\]/);
  assert.match(launch, /href: "\/app\/launch\/new"[\s\S]*href: "\/app\/launch\/mine"/);
  assert.doesNotMatch(read("app/shell/product-routes.ts"), /\/app\/launch/);
});

test("building and sending through Launch obey its lane's stop; reading a launch does not", () => {
  assert.equal(launchOpen({}), false, "nothing configured: paused");
  assert.equal(launchOpen({ RYNTRA_SOLANA_LAUNCH_STATE: "OPEN" }), true);
  assert.equal(launchOpen({ RYNTRA_SOLANA_SWAP_STATE: "OPEN" }), false, "no lane opens another");
  assert.match(read("lib/launch/runtime.server.ts"), /export function launchDeps\(\)[\s\S]{0,300}if \(!network \|\| !launchOpen\(\) \|\| !launchWritesHere\(network\)\) return null;[\s\S]{0,200}storeSupportsConcurrentInstances\(store\)\) return null;/);
  /* A mint names its metadata at ryntra.io for ever: on mainnet only production writes a launch. */
  assert.equal(launchWritesHere(launchNetwork({}), {}), false, "a local server reads mainnet launches and makes none");
  assert.equal(launchWritesHere(launchNetwork({}), { VERCEL_ENV: "preview" }), false, "nor does a preview");
  assert.equal(launchWritesHere(launchNetwork({}), { VERCEL_ENV: "production" }), true);
  assert.equal(launchWritesHere(launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "http://localhost:3020" }), {}), true, "the stand launches on its own origin");
  for (const route of ["metadata", "quote", "build", "submit"]) {
    assert.match(read(`app/api/v1/launch/${route}/route.ts`), /const deps = launchDeps\(\);\s*if \(!deps\) return apiFailure\("LAUNCH_PAUSED"/, `${route} pauses with the lane`);
  }
  for (const route of ["[mint]/trade/build", "[mint]/trade/submit", "[mint]/claim/build", "[mint]/claim/submit"]) {
    assert.match(read(`app/api/v1/launch/${route}/route.ts`), /const deps = launchTradingDeps\(\);\s*if \(!deps\) return apiFailure\("LAUNCH_PAUSED"/, `${route} pauses with the lane`);
  }
  for (const route of ["[mint]", "[mint]/market", "[mint]/creator", "[mint]/wallet/[address]", "creators/[address]"]) {
    assert.doesNotMatch(read(`app/api/v1/launch/${route}/route.ts`), /launchDeps\(\)|launchTradingDeps\(\)/, `${route} reads while the lane is paused`);
  }
  assert.match(read("app/app/launch/new/page.tsx"), /launchAccepting\(network\) \? null : launchTrading\(\) \? "launching" : "all"/, "the form says it is paused before it is filled — and how much of Launch waits");
  /* «Too many tries» is not «paused». */
  for (const file of ["app/app/launch/new/launch-flow.tsx", "app/app/launch/[mint]/trade-panel.tsx", "app/app/launch/mine/creator-cabinet.tsx"]) assert.match(read(file), /RATE_LIMITED"[\s\S]{0,40}errRateLimited/, file);
  for (const route of ["build", "quote", "submit", "metadata", "[mint]/trade/build", "[mint]/trade/submit", "[mint]/claim/build", "[mint]/claim/submit"]) {
    assert.doesNotMatch(read(`app/api/v1/launch/${route}/route.ts`), /for a moment|try again later/i, `${route}: no time is promised`);
  }
});

test("on public nodes a token's history is listed by Solana's own endpoint and older transactions asked of the second operator", { skip: Boolean(process.env.RYNTRA_SOLANA_RPC_MAINNET) }, () => {
  const mainnet = launchNetwork({});
  assert.equal(launchHistoryEndpoint(mainnet), "https://api.mainnet-beta.solana.com", "a public node keeps a day or two of an account's signatures");
  assert.notEqual(launchArchiveEndpoint(mainnet), "https://solana-rpc.publicnode.com");
  assert.ok(launchArchiveConnection(mainnet), "the main node's own older transactions are asked of another");
  assert.match(read("lib/launch/view.server.ts"), /createMeteoraDbcLaunchVenue\(\{[^}]*archive: launchArchiveConnection\(deps\.network\)/, "the receipt's creation is read from the archive too");
  assert.match(read("lib/launch/trade-index.server.ts"), /history: launchHistoryEndpoint\(deps\.network\),\s*archive: launchArchiveEndpoint\(deps\.network\)/);
});

test("the pool payer's key comes only from the environment, whole — JSON bytes or a wallet's base58 — and on mainnet only the registry's", () => {
  const stand = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "http://localhost:3020" });
  const key = Keypair.generate();
  assert.equal(launchPoolPayer({ RYNTRA_LAUNCH_POOL_PAYER_SECRET: JSON.stringify([...key.secretKey]) }, stand)?.publicKey.toBase58(), key.publicKey.toBase58());
  assert.equal(launchPoolPayer({ RYNTRA_LAUNCH_POOL_PAYER_SECRET: ` ${getBase58Decoder().decode(key.secretKey)}\n` }, stand)?.publicKey.toBase58(), key.publicKey.toBase58(), "the string a wallet exports");
  assert.equal(launchPoolPayer({}, stand), null);
  assert.equal(launchPoolPayer({ RYNTRA_LAUNCH_POOL_PAYER_SECRET: "[1,2,3]" }, stand), null);
  assert.equal(launchPoolPayer({ RYNTRA_LAUNCH_POOL_PAYER_SECRET: "not a key" }, stand), null);
  assert.equal(launchPoolPayer({ RYNTRA_LAUNCH_POOL_PAYER_SECRET: getBase58Decoder().decode(key.secretKey.slice(0, 32)) }, stand), null, "half a key is no key");
  /* On mainnet a key for any address but the registry's pool payer is refused: every pool Ryntra opens is attributable. */
  assert.equal(launchPoolPayer({ RYNTRA_LAUNCH_POOL_PAYER_SECRET: JSON.stringify([...key.secretKey]) }, launchNetwork({})), null);
  assert.equal(launchPoolPayerAddress(launchNetwork({})), ATTRIBUTION_REGISTRY.find((row) => row.id === "solana-launch-pool-payer").address);
  assert.equal(launchPoolPayerAddress(stand, {}), null, "the stand's payer is its own key's, and without one there is none");
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

test("the share link lands on the token's page — through the creator's referral once the referral route follows `to`", () => {
  /* The referral route lands on Rewards until it follows `to=`: a link that names the token must land on the token. */
  const follows = /searchParams\.get\(\s*["']to["']\s*\)/.test(read("app/r/[code]/route.ts"));
  assert.equal(REFERRAL_ROUTE_FOLLOWS_TO, follows, "the referral route now follows `to=` — the share link can carry the creator's code: flip REFERRAL_ROUTE_FOLLOWS_TO");
  assert.equal(launchShareLink("https://ryntra.io", { token: "Mint111", referralCode: "ABC123" }, false), "https://ryntra.io/app/launch/Mint111");
  assert.equal(launchShareLink("https://ryntra.io", { token: "Mint111", referralCode: "ABC123" }, true), "https://ryntra.io/r/ABC123?to=/app/launch/Mint111");
  const to = new URL(launchShareLink("https://ryntra.io", { token: "F4pmJAEZDtJ4JPE7QwK7zrD6R1Ypgi7nTCGxTM7AsLGQ", referralCode: "ABC123" }, true)).searchParams.get("to");
  assert.match(to, /^\/app\/launch\/[1-9A-HJ-NP-Za-km-z]{32,44}$/, "the exact path the referral route is asked to accept");
  assert.equal(launchShareLink("https://ryntra.io", { token: "Mint111", referralCode: null }, true), "https://ryntra.io/app/launch/Mint111");
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

test("a launch's market and its trades refuse where no network is, like the rest, and take nothing from a request's host", () => {
  for (const route of ["[mint]/market", "[mint]/trade/quote", "[mint]/trade/build", "[mint]/trade/submit", "[mint]/wallet/[address]"]) {
    const source = read(`app/api/v1/launch/${route}/route.ts`);
    assert.match(source, /if \(!launchNetwork\(\)\) return apiFailure\("LAUNCH_UNAVAILABLE"/, `${route} refuses without Launch`);
    assert.doesNotMatch(source, /x-forwarded-host|await headers\(\)/, `${route} takes nothing from a request's host`);
  }
  const stand = { RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "http://localhost:3020" };
  assert.equal(buildCapabilities({ env: {} }).launch?.market, "/api/v1/launch/{mint}/market", "mainnet names the routes");
  assert.equal(buildCapabilities({ env: stand }).launch?.market, "/api/v1/launch/{mint}/market");
  assert.equal(buildCapabilities({ env: stand }).launch?.tradeSubmit, "/api/v1/launch/{mint}/trade/submit");
  assert.equal(launchNetwork(stand)?.jupiter, false, "devnet has no Jupiter: no Jupiter route is offered there");
});

test("the token page's words say what happened and where — never «safe», «no risk» or «guaranteed»", async () => {
  const { LAUNCH_WORDS } = await import("../../app/app/launch/launch-words.ts");
  const forbidden = /\bsafe\b|\bsafety\b|guarantee|no risk|risk-free|безпечн|гарант|без ризику/i;
  for (const [key, words] of Object.entries(LAUNCH_WORDS)) {
    for (const text of [words.en, words.uk]) assert.doesNotMatch(text, forbidden, `${key}: «${text}»`);
  }
  for (const code of LAUNCH_RISK_CODES) {
    assert.ok(LAUNCH_WORDS[`risk_${code}`] && LAUNCH_WORDS[`riskWhy_${code}`], `${code} has its words and its reason in both languages`);
  }
  for (const label of ["creator", "sniper", "bundle", "curve", "pool", "lock"]) assert.ok(LAUNCH_WORDS[`label_${label}`], `the label ${label} has its words`);
  /* A word the page asks for and the dictionary lacks throws while the page draws: every key named in the pages exists. */
  for (const file of ["app/app/launch/[mint]/token-market.tsx", "app/app/launch/[mint]/trade-panel.tsx", "app/app/launch/[mint]/page.tsx", "app/app/launch/new/launch-flow.tsx"]) {
    const source = read(file);
    const keys = new Set([...source.matchAll(/word\("([A-Za-z_]+)"/g), ...source.matchAll(/"((?:risk|riskWhy|label|labelHint|mark)_[A-Za-z_]+)"/g)].map((match) => match[1]));
    for (const key of keys) assert.ok(LAUNCH_WORDS[key]?.en && LAUNCH_WORDS[key]?.uk, `${file}: «${key}» is in the words in both languages`);
  }
});

test("a trade's submit refuses before anything is sent: not built here, another wallet, an old build, other bytes, a missing signature, a second press", async () => {
  const store = createMemoryGuardStore();
  const wallet = Keypair.generate();
  const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  const sent = [];
  const connection = {
    rpcEndpoint: "https://example.invalid",
    sendRawTransaction: async (bytes) => {
      sent.push(bytes);
      return "sig";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  };
  const now = new Date("2026-10-05T10:00:00.000Z");
  const deps = { network, connection, store, now: () => now };
  const token = Keypair.generate().publicKey.toBase58();
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1000 }));
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = "11111111111111111111111111111111";
  const wire = (transaction) => transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const build = { id: "c".repeat(32), cluster: "devnet", token, wallet: wallet.publicKey.toBase58(), side: "buy", amountRaw: "1000000", wireBase64: wire(tx), validUntil: "100", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString() };
  await store.collection("launchTradeBuilds").set(`devnet:${build.id}`, build);
  const signed = Transaction.from(Buffer.from(wire(tx), "base64"));
  signed.partialSign(wallet);
  const input = { buildId: build.id, wallet: wallet.publicKey.toBase58(), signedWireBase64: wire(signed) };

  assert.equal((await submitLaunchTrade(deps, token, { ...input, buildId: "d".repeat(32) })).code, "LAUNCH_NOT_FOUND");
  assert.equal((await submitLaunchTrade(deps, Keypair.generate().publicKey.toBase58(), input)).code, "LAUNCH_NOT_FOUND", "a build is the token's own");
  assert.equal((await submitLaunchTrade(deps, token, { ...input, wallet: Keypair.generate().publicKey.toBase58() })).code, "WALLET_MISMATCH");
  assert.equal((await submitLaunchTrade({ ...deps, now: () => new Date(now.getTime() + 120_000) }, token, input)).code, "LAUNCH_BUILD_EXPIRED");
  const other = new Transaction().add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1000 }));
  other.feePayer = wallet.publicKey;
  other.recentBlockhash = tx.recentBlockhash;
  other.partialSign(wallet);
  assert.equal((await submitLaunchTrade(deps, token, { ...input, signedWireBase64: wire(other) })).code, "LAUNCH_SIGNED_OTHER_BYTES", "another transfer is not the trade reviewed");
  assert.equal((await submitLaunchTrade(deps, token, { ...input, signedWireBase64: wire(tx) })).code, "LAUNCH_SIGNED_OTHER_BYTES", "unsigned bytes are not a signature");
  assert.equal(sent.length, 0, "nothing was sent on a refusal");
  const first = await submitLaunchTrade(deps, token, input);
  assert.equal(first.ok, true);
  assert.equal(first.submit.state, "CONFIRMED");
  assert.equal(sent.length, 1);
  assert.equal((await submitLaunchTrade(deps, token, input)).code, "LAUNCH_BUILD_USED");
  assert.equal(sent.length, 1, "a second press sends nothing");
});

test("the pool's Ryntra fee is charged only where a launch's trade is recorded for the cashback, History and the receipt", () => {
  const stand = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "http://localhost:3020" });
  assert.equal(stand.tradesRecorded, false);
  assert.equal(launchPoolFee(stand), null, "the stand records no launch trade: no fee is taken that the rewards do not see");
  assert.deepEqual(launchPoolFee({ ...stand, tradesRecorded: true }), { wallet: stand.feeWallet, bps: 100 }, "where trades are recorded: the policy's 1 % for a new token");
  assert.equal(launchPoolFee({ ...stand, tradesRecorded: true, feeWallet: null }), null);
});

test("a trade's fill is the chain's: the person's own trade among the transaction's, by the side they built and their wallet", () => {
  const wallet = "Wa11et1111111111111111111111111111111111111";
  const other = "Qther".padEnd(44, "1");
  const row = (over) => ({ signature: "s".padEnd(88, "1"), slot: 1, at: 1, side: "buy", venue: "pool", trader: wallet, payer: wallet, account: null, tokensRaw: "128941", pairRaw: "10000000", feeRaw: "199000", priceAfter: 1, ...over });
  assert.deepEqual(fillOf([row({})], { side: "buy", wallet }), { tokensRaw: "128941", pairRaw: "10000000" }, "what the chain says the wallet paid, Ryntra's fee in it — never the quote");
  assert.deepEqual(fillOf([row({ trader: other, payer: other, tokensRaw: "1" }), row({ trader: other, payer: wallet, tokensRaw: "2" })], { side: "buy", wallet }), { tokensRaw: "2", pairRaw: "10000000" }, "a buy the wallet paid for counts as its own");
  assert.equal(fillOf([row({ side: "sell" })], { side: "buy", wallet }), null, "another side is not this trade");
  assert.equal(fillOf(null, { side: "buy", wallet }), null, "a transaction not read yet: no figure");
});

test("a failed read of the receipt falls back a few minutes to the marks that cannot change — never on a launch the rules refuse", () => {
  const mark = (code) => ({ code, source: { kind: "account", id: "x" } });
  const good = { receipt: { observedAt: "2026-10-05T10:00:00.000Z", marks: [mark("MINT_REVOKED"), mark("CURVE_HOLDS_FUNDS"), mark("CREATOR_LOCKED"), mark("LP_LOCKED_FOREVER")] }, receiptProblems: [] };
  const failed = { receipt: null, receiptProblems: ["The chain could not be read."] };
  const back = withFallback(failed, { at: 1_000, view: good }, 1_000 + 60_000);
  assert.deepEqual(back.receipt.marks.map((entry) => entry.code), ["MINT_REVOKED", "LP_LOCKED_FOREVER"], "the curve's money and the lock are said fresh or not at all");
  assert.equal(back.receipt.observedAt, good.receipt.observedAt, "the receipt keeps the time it was read");
  assert.equal(withFallback(failed, { at: 1_000, view: good }, 1_000 + 5 * 60_000).receipt, null, "older than a few minutes: no fallback");
  assert.equal(withFallback({ receipt: null, receiptProblems: ["Not a Ryntra launch: its config is not one of Ryntra's."] }, { at: 1_000, view: good }, 1_001).receipt, null);
  assert.equal(withFallback(good, null, 1).receipt, good.receipt, "a fresh receipt is itself");
});

test("«Мої лаунчі» and «Забрати» refuse where no network is, like the rest; the capability names them", () => {
  for (const route of ["creators/[address]", "[mint]/claim/build", "[mint]/claim/submit"]) {
    const source = read(`app/api/v1/launch/${route}/route.ts`);
    assert.match(source, /if \(!launchNetwork\(\)\) return apiFailure\("LAUNCH_UNAVAILABLE"/, `${route} refuses without Launch`);
    assert.doesNotMatch(source, /x-forwarded-host|await headers\(\)/, `${route} takes nothing from a request's host`);
  }
  const page = read("app/app/launch/mine/page.tsx");
  assert.match(page, /if \(!network\) notFound\(\)/, "the cabinet is not found without Launch");
  assert.match(page, /generateMetadata[\s\S]{0,300}if \(!launchNetwork\(\)\) return \{\};/, "and names nothing in the tab's title");
  const stand = { RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "http://localhost:3020" };
  assert.equal(buildCapabilities({ env: {} }).launch?.creators, "/api/v1/launch/creators/{address}");
  assert.equal(buildCapabilities({ env: stand }).launch?.creators, "/api/v1/launch/creators/{address}");
  assert.equal(buildCapabilities({ env: stand }).launch?.claimSubmit, "/api/v1/launch/{mint}/claim/submit");
  /* Points for a launch on a DEX go through `lib/rewards`' own call, its name unchanged. */
  assert.match(read("lib/launch/graduation.server.ts"), /recordLaunchGraduation\(store, \{ creator: record\.creator, mint: record\.token, graduatedAt:/);
});

test("a split is refused before anything is built: only «Спільнота», the creator among the wallets, all of the fee", async () => {
  const store = createMemoryGuardStore();
  const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  const deps = { network, connection: { getBalance: async () => 1_000_000_000 }, store, poolPayer: Keypair.generate(), origin: "https://ryntra.io", now: () => new Date("2026-10-06T10:00:00.000Z") };
  const creator = Keypair.generate().publicKey.toBase58();
  const other = Keypair.generate().publicKey.toBase58();
  const metadataUri = `https://ryntra.io/api/launch/metadata/${(await storeLaunchMetadata(store, { name: "Hive Bee", symbol: "HIVE", description: "", image: "https://ryntra.io/api/launch/image/x", createdOn: "https://ryntra.io" }, "t")).sha256}`;
  const base = { creator, metadataUri, firstBuyRaw: "0", lock: null };
  const split = [{ address: creator, bps: 6_000 }, { address: other, bps: 4_000 }];
  assert.equal((await prepareLaunch(deps, { ...base, preset: "protected", feeShares: split })).code, "SHARES_INVALID", "only «Спільнота» shares the creator's fees");
  assert.equal((await prepareLaunch(deps, { ...base, preset: "community", feeShares: [{ address: other, bps: 10_000 }, { address: Keypair.generate().publicKey.toBase58(), bps: 0 }] })).code, "SHARES_INVALID");
  assert.equal((await prepareLaunch(deps, { ...base, preset: "community", feeShares: [{ address: creator, bps: 6_000 }, { address: other, bps: 3_000 }] })).code, "SHARES_INVALID", "all of the fee");
});

test("a claim's submit refuses before anything is sent: not built here, another wallet, an old build, other bytes, a missing signature, a second press", async () => {
  const { submitLaunchClaim } = await import("./creator.server.ts");
  const store = createMemoryGuardStore();
  const wallet = Keypair.generate();
  const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  const sent = [];
  const connection = {
    sendRawTransaction: async (bytes) => {
      sent.push(bytes);
      throw Object.assign(new Error("Transaction simulation failed"), { logs: ["refused"] });
    },
    getSignatureStatuses: async () => ({ value: [null] }),
  };
  const now = new Date("2026-10-06T10:00:00.000Z");
  const deps = { network, connection, store, now: () => now };
  const token = Keypair.generate().publicKey.toBase58();
  await store.collection("launches").set(`solana:devnet:${token}`, { cluster: "devnet", state: "LAUNCHED", token, pool: token, pairMint: token, preset: "classic", creator: wallet.publicKey.toBase58(), name: "Moon Cat", symbol: "MCAT", signature: "s", validUntil: "100" });
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports: 0 }));
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = "11111111111111111111111111111111";
  const wire = (transaction) => transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const build = { id: "c".repeat(32), cluster: "devnet", token, wallet: wallet.publicKey.toBase58(), wires: [wire(tx)], validUntil: ["100"], createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString() };
  await store.collection("launchClaimBuilds").set(`devnet:${build.id}`, build);
  const signed = Transaction.from(Buffer.from(wire(tx), "base64"));
  signed.partialSign(wallet);
  const input = { buildId: build.id, wallet: wallet.publicKey.toBase58(), signedWireBase64: [wire(signed)] };
  assert.equal((await submitLaunchClaim(deps, token, { ...input, buildId: "d".repeat(32) })).code, "LAUNCH_NOT_FOUND");
  assert.equal((await submitLaunchClaim(deps, token, { ...input, wallet: Keypair.generate().publicKey.toBase58() })).code, "WALLET_MISMATCH");
  assert.equal((await submitLaunchClaim(deps, token, { ...input, signedWireBase64: [wire(tx)] })).code, "LAUNCH_SIGNED_OTHER_BYTES", "unsigned");
  const other = new Transaction().add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  other.feePayer = wallet.publicKey;
  other.recentBlockhash = tx.recentBlockhash;
  other.partialSign(wallet);
  assert.equal((await submitLaunchClaim(deps, token, { ...input, signedWireBase64: [wire(other)] })).code, "LAUNCH_SIGNED_OTHER_BYTES", "other bytes");
  assert.equal((await submitLaunchClaim(deps, token, { ...input, signedWireBase64: [] })).code, "LAUNCH_SIGNED_OTHER_BYTES", "a transaction left unsigned");
  assert.equal((await submitLaunchClaim({ ...deps, now: () => new Date(now.getTime() + 120_000) }, token, input)).code, "LAUNCH_BUILD_EXPIRED");
  assert.equal(sent.length, 0, "nothing reached the network");
  assert.equal((await submitLaunchClaim(deps, token, input)).code, "LAUNCH_SUBMIT_FAILED", "the network's refusal says so");
  assert.equal((await submitLaunchClaim(deps, token, input)).code, "LAUNCH_BUILD_USED", "a second press finds it used");
});

test("a claim whose first transaction landed and a later one did not is PARTIAL — part taken, the rest waiting — never CONFIRMED", async () => {
  const { submitLaunchClaim } = await import("./creator.server.ts");
  const store = createMemoryGuardStore();
  const wallet = Keypair.generate();
  const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  let sends = 0;
  const connection = {
    sendRawTransaction: async () => {
      sends += 1;
      if (sends === 2) throw Object.assign(new Error("Transaction simulation failed"), { logs: ["refused"] });
      return "sig";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
    getTransaction: async () => null,
    getSignatureStatuses: async () => ({ value: [null] }),
  };
  const now = new Date("2026-10-06T10:00:00.000Z");
  const deps = { network, connection, store, now: () => now };
  const token = Keypair.generate().publicKey.toBase58();
  await store.collection("launches").set(`solana:devnet:${token}`, { cluster: "devnet", state: "LAUNCHED", token, pool: token, pairMint: token, preset: "classic", creator: wallet.publicKey.toBase58(), name: "Moon Cat", symbol: "MCAT", signature: "s", validUntil: "100" });
  const make = (lamports) => {
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports }));
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = "11111111111111111111111111111111";
    return tx;
  };
  const wire = (transaction) => transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const [first, second, third] = [make(0), make(1), make(2)];
  const build = { id: "e".repeat(32), cluster: "devnet", token, wallet: wallet.publicKey.toBase58(), wires: [wire(first), wire(second), wire(third)], validUntil: ["100", "100", "100"], createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString() };
  await store.collection("launchClaimBuilds").set(`devnet:${build.id}`, build);
  const signed = [first, second, third].map((tx) => {
    const copy = Transaction.from(Buffer.from(wire(tx), "base64"));
    copy.partialSign(wallet);
    return wire(copy);
  });
  const answer = await submitLaunchClaim(deps, token, { buildId: build.id, wallet: wallet.publicKey.toBase58(), signedWireBase64: signed });
  assert.equal(answer.ok, true);
  assert.equal(answer.submit.state, "PARTIAL");
  assert.equal(answer.submit.failed.length, 2, "the refused one and the one after it, not sent");
  assert.equal(sends, 2, "nothing is sent after a transaction that did not land");
});

test("another's launch is in a wallet's cabinet only while its sharing names the wallet and has not failed", async () => {
  const { sharesWith } = await import("./creator.server.ts");
  const creator = Keypair.generate().publicKey.toBase58();
  const other = Keypair.generate().publicKey.toBase58();
  const sharing = (state) => ({ vault: creator, shares: [{ address: creator, bps: 6_000 }, { address: other, bps: 4_000 }], signature: null, state, reason: null });
  assert.equal(sharesWith({ creator, feeSharing: sharing("SHARED") }, other), true);
  assert.equal(sharesWith({ creator, feeSharing: sharing("PENDING") }, other), true, "listed, its figures waiting for the confirmation");
  assert.equal(sharesWith({ creator, feeSharing: sharing("FAILED") }, other), false);
  assert.equal(sharesWith({ creator, feeSharing: null }, other), false);
  assert.equal(sharesWith({ creator, feeSharing: sharing("SHARED") }, Keypair.generate().publicKey.toBase58()), false);
  assert.equal(sharesWith({ creator, feeSharing: null }, creator), true, "the creator's own launch, always");
});

test("the routes' write windows are shared by every instance: a window full in the store refuses here too", async () => {
  const { consumeSharedLaunchWrite } = await import("./runtime.server.ts");
  const store = createMemoryGuardStore();
  const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
  const now = Date.parse("2026-10-06T10:20:00.000Z");
  const first = await consumeSharedLaunchWrite("submit", headers, store, now);
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 19);
  /* Another instance has filled the window: this instance's own window still has room, the shared one does not. */
  const start = Math.floor(now / 3_600_000) * 3_600_000;
  const windows = store.versioned("launchLimits");
  const key = `submit:203.0.113.9:${start}`;
  const held = await windows.get(key);
  await windows.compareAndSet(key, held.version, { ...held, version: held.version + 1, count: 20 });
  const refused = await consumeSharedLaunchWrite("submit", headers, store, now);
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds > 0);
  /* The next window starts again, and the old one is removed as the address writes. */
  const later = await consumeSharedLaunchWrite("submit", headers, store, now + 3_600_000);
  assert.equal(later.allowed, true);
  assert.equal(await windows.get(key), undefined);
  /* A store that does not answer leaves the instance's own window in force. */
  const broken = { versioned: () => ({ get: async () => { throw new Error("down"); } }) };
  assert.equal((await consumeSharedLaunchWrite("build", new Headers({ "x-forwarded-for": "203.0.113.10" }), broken, now)).allowed, true);
});

test("a launch's decoded transactions are kept by token and fee wallet, so another instance reads them from the store", async () => {
  const { launchDecodedIndex } = await import("./trade-index.server.ts");
  const store = createMemoryGuardStore();
  const index = launchDecodedIndex(store, "mainnet", "FeeWa11et111111111111111111111111111111111");
  const decoded = { slot: 7, blockTime: 1_790_000_000, failed: false, trades: [{ signature: "sig1", slot: 7, at: 1_790_000_000, side: "buy", venue: "curve", trader: "T", payer: "T", account: null, tokensRaw: "5", pairRaw: "10", feeRaw: "1", priceAfter: 2 }] };
  await index.save("TokenA", "sig1", decoded);
  await index.save("TokenA", "sig1", { ...decoded, slot: 99 });
  await index.save("TokenB", "sig2", decoded);
  const loaded = await index.load("TokenA");
  assert.deepEqual([...loaded.keys()], ["sig1"], "one token's transactions, not another's");
  assert.equal(loaded.get("sig1").slot, 7, "written once, never replaced");
  assert.equal((await launchDecodedIndex(store, "mainnet", null).load("TokenA")).size, 0, "a reader with another fee wallet decodes again: what a trade cost depends on it");
  assert.equal((await launchDecodedIndex(store, "devnet", "FeeWa11et111111111111111111111111111111111").load("TokenA")).size, 0, "another network is another index");
});
test("the documentation of Launch says the numbers the code launches with", async () => {
  const { LAUNCH } = await import("../../app/docs/content/launch.ts");
  const { LAUNCHES_PER_CREATOR_PER_DAY } = await import("./config.server.ts");
  const text = (locale) => JSON.stringify(LAUNCH.sections.map((section) => section.blocks.map((block) => block.text?.[locale] ?? block.items?.[locale] ?? block.rows?.[locale] ?? null)));
  assert.equal(LAUNCHES_PER_CREATOR_PER_DAY, 3, "the page says «three tokens a day»: change both together");
  assert.match(text("en"), /at most three tokens a day/);
  assert.match(text("uk"), /щонайбільше три токени на добу/);
  for (const locale of ["en", "uk"]) assert.doesNotMatch(text(locale), /\bsafe\b|guarantee|безпечн|гарант(?!ії)/i, `${locale}: no promise of safety`);
});
test("an IPv6 address counts in its /64's window; an IPv4 address in its own", async () => {
  const { limitSubject } = await import("./runtime.server.ts");
  assert.equal(limitSubject("203.0.113.9"), "203.0.113.9");
  assert.equal(limitSubject("2001:db8:abcd:12:1::5"), "2001:db8:abcd:12::/64");
  assert.equal(limitSubject("2001:DB8:abcd:0012:ffff:1:2:3"), "2001:db8:abcd:12::/64");
  assert.equal(limitSubject("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(limitSubject("::ffff:203.0.113.7"), "203.0.113.7", "an IPv4 address carried in IPv6 counts as itself");
  assert.notEqual(limitSubject("::ffff:203.0.113.7"), limitSubject("::ffff:198.51.100.9"));
  assert.equal(limitSubject("unknown"), "unknown");
});

test("a launch identity starts at the transaction that created it; the partner's vault at the first config that names it", async () => {
  const { createdAt, oldestTransaction, withFeeClaimer, launchRows } = await import("../attribution/launch-starts.server.ts");
  const address = Keypair.generate().publicKey;
  const page = (count, last) => Array.from({ length: count }, (_, index) => ({ signature: index === count - 1 ? last : `s${index}`, slot: 100 + index, blockTime: 1_790_000_000 + index, err: null }));
  const short = { getSignaturesForAddress: async () => page(3, "first") };
  assert.deepEqual(await oldestTransaction(short, address.toBase58()), { network: "solana", block: 102, time: new Date((1_790_000_002) * 1000).toISOString(), tx: "first" });
  const empty = { getSignaturesForAddress: async () => [] };
  assert.equal(await oldestTransaction(empty, address.toBase58()), null, "no history read is no start");
  let calls = 0;
  const endless = { getSignaturesForAddress: async () => (calls++, page(1000, `p${calls}`)) };
  assert.equal(await oldestTransaction(endless, address.toBase58()), null, "a history longer than the pages read leaves the start unknown");
  /* The oldest listed counts only when it shows the account created: nothing before, something after. */
  const withTx = (pre, post) => ({
    ...short,
    getTransaction: async () => ({
      meta: { preBalances: [5, pre], postBalances: [4, post], loadedAddresses: { writable: [], readonly: [] } },
      transaction: { message: { getAccountKeys: () => ({ staticAccountKeys: [Keypair.generate().publicKey, address] }) } },
    }),
  });
  assert.equal((await createdAt(withTx(0, 1_000), address.toBase58()))?.tx, "first");
  assert.equal(await createdAt(withTx(2_000, 1_000), address.toBase58()), null, "a list a node cut short gives a later transaction: no start");
  await assert.rejects(createdAt({ ...short, getTransaction: async () => null }, address.toBase58()), "a transaction not read is not «no start»");
  /* The vault existed before Launch: it is Launch's from the earliest config's creation, and only when every config is known. */
  const rows = launchRows();
  const configs = rows.filter((row) => row.role === "LAUNCH_CONFIG");
  const claimer = rows.find((row) => row.role === "LAUNCH_FEE_CLAIMER");
  assert.equal(configs.length, 2);
  const moment = (block) => ({ network: "solana", block, time: null, tx: `t${block}` });
  const both = withFeeClaimer(rows, [{ id: configs[0].id, moment: moment(20) }, { id: configs[1].id, moment: moment(10) }]);
  assert.equal(both.find((start) => start.id === claimer.id)?.moment.block, 10);
  assert.equal(withFeeClaimer(rows, [{ id: configs[0].id, moment: moment(20) }]).some((start) => start.id === claimer.id), false);
  assert.match(read("lib/attribution/launch-starts.server.ts"), /Promise\.race\(\[pending, waited\]\)/, "a page never waits on the chain for a start");
});