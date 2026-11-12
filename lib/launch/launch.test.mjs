import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

import { buildCapabilities } from "../api/v1/capabilities.server.ts";
import { CREATOR_LOCK_SCHEDULES, creatorLockTerms } from "../core/launch/creator-lock.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { LAUNCH_RISK_CODES } from "../core/venues/meteora-dbc/market.ts";
import { getBase58Decoder } from "@solana/kit";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { reviewedDigest, sealCosigners } from "../liquidity/studio/ticket.ts";
import { LIGHTHOUSE_PROGRAM } from "../solana/limits/model.ts";
import { LIGHTHOUSE_FIRST_ASSERTION } from "../solana/limits/trigger-tx.ts";
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
import { REFERRAL_ROUTE_FOLLOWS_TO, budgetLeft, launchShareLink, prepareLaunch, readLaunchRecord, sendOnce, settleLaunchLock, submitLaunch } from "./flow.server.ts";
import { checkLaunchForm, imageTypeOf, normalizeLink } from "./form.ts";
import { launchReferralPath } from "./share-link.ts";
import { metadataJson, metadataOfUri, readLaunchImage, storeLaunchImage, storeLaunchMetadata } from "./metadata.server.ts";
import { fillOf, submitLaunchTrade } from "./trade.server.ts";
import { withFallback } from "./view.server.ts";
import { testSigner } from "./signer/signer.fixture.mjs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f1d1a80000000049454e44ae426082", "hex");

test("Launch runs on mainnet on the registry's configs; the devnet stand only on a local server that asks for it", () => {
  const stand = { RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "http://localhost:3020" };
  const mainnet = launchNetwork({});
  assert.equal(mainnet?.cluster, "mainnet");
  assert.equal(mainnet?.chain, "solana:mainnet");
  assert.equal(mainnet?.origin, "https://ryntra.io", "a mint names its metadata on Ryntra's own address for ever");
  const registry = (id) => ATTRIBUTION_REGISTRY.find((row) => row.id === id).address;
  assert.deepEqual(
    mainnet?.configs,
    { classic: registry("solana-launch-config-classic"), protected: registry("solana-launch-config-protected"), micro: registry("solana-launch-config-micro"), demo: registry("solana-launch-config-demo") },
    "the configs are the registry's, «Спільнота» not yet",
  );
  assert.deepEqual(Object.keys(mainnet?.pairs ?? {}), ["classic", "protected", "micro", "demo"]);
  assert.equal(mainnet?.pairs.classic?.mint, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(mainnet?.referralOwner, registry("solana-launch-fee-claimer"), "Ryntra's referral accounts belong to the partner's vault");
  assert.equal(mainnet?.feeWallet, registry("solana-fee-wallet"));
  assert.equal(mainnet?.jupiter, true);
  assert.equal(mainnet?.tradesRecorded, true, "a launch's trade is recorded like every trade: History with a receipt, /stats, the rewards core's call");
  assert.equal(mainnet?.poolFeeCharged, false, "Ryntra's own fee in a graduated pool waits for the rewards rules to count it");
  assert.equal(launchPoolFee(mainnet), null, "so no Ryntra fee is taken in a graduated pool");
  assert.equal(launchNetwork({ RYNTRA_LAUNCH_STAND: "mainnet" })?.cluster, "mainnet");
  assert.equal(launchNetwork(stand)?.cluster, "devnet");
  assert.equal(launchNetwork(stand)?.origin, "http://localhost:3020");
  assert.equal(launchNetwork({ ...stand, VERCEL_ENV: "production" })?.cluster, "mainnet", "a stand flag left on production opens no stand");
  assert.equal(launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet" }), null, "no public origin, no stand: the origin never comes from a request");
  assert.equal(launchNetwork({ ...stand, RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io/evil?x" }), null);
  assert.equal(buildCapabilities({ env: {} }).launch?.network, "solana:mainnet");
  assert.equal(buildCapabilities({ env: stand }).launch?.network, "solana:devnet");
  for (const file of ["lib/launch/runtime.server.ts", "app/app/launch/[mint]/page.tsx", "app/t/serve.ts"]) {
    assert.doesNotMatch(read(file), /x-forwarded-host|publicOriginOf|await headers\(\)/, `${file} takes no origin from a request`);
  }
  for (const page of ["app/app/launch/new/page.tsx", "app/app/launch/[mint]/page.tsx"]) {
    assert.match(read(page), /if \(!(network|launchNetwork\(\))\) notFound\(\)/, `${page} is not found where no network is`);
    assert.match(read(page), /generateMetadata[\s\S]{0,300}if \(!launchNetwork\(\)\) return \{\};/, `${page} names nothing in its title where no network is`);
  }
  for (const route of ["presets", "metadata", "quote", "build", "submit", "[mint]"]) {
    assert.match(read(`app/api/v1/launch/${route}/route.ts`), /if \(!(launchNetwork\(\)|network)\) return apiFailure\("LAUNCH_UNAVAILABLE"/, `${route} refuses where no network is`);
  }
  /* «Лаунч» is a row of «Торгівля» over every launch page, «Мої лаунчі» under it, and «Запустити токен» opens the
     form from the Launch page and the search (Menu 3, NAV-1). */
  const domains = read("app/shell/domains.ts");
  assert.match(domains, /launch: row\("launch", "\/app\/launch\/markets", \["\/app\/launch"\]\)/);
  assert.match(domains, /export const MENU_ACTION = \{[\s\S]*?href: "\/app\/launch\/new"/);
  assert.match(read("lib/search/product-search.ts"), /id: "launch-mine"[^\n]*href: "\/app\/launch\/mine"/);
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
  /* SOL-L1e: the short address — the mint's first eight letters, and the code once the referral route lands on the token. */
  const mint = "F4pmJAEZDtJ4JPE7QwK7zrD6R1Ypgi7nTCGxTM7AsLGQ";
  assert.equal(launchShareLink("https://ryntra.io", { token: mint, referralCode: "ABC123" }, false), "https://ryntra.io/t/F4pmJAEZ");
  assert.equal(launchShareLink("https://ryntra.io", { token: mint, referralCode: "ABC123" }, true), "https://ryntra.io/t/F4pmJAEZ/ABC123");
  assert.equal(launchShareLink("https://ryntra.io", { token: mint, referralCode: null }, true), "https://ryntra.io/t/F4pmJAEZ");
  /* Where it sends a person: through the referral route to the exact path that route is asked to accept. */
  const to = new URL(`https://ryntra.io${launchReferralPath(mint, "ABC123", true)}`).searchParams.get("to");
  assert.match(to, /^\/app\/launch\/[1-9A-HJ-NP-Za-km-z]{32,44}$/, "the exact path the referral route is asked to accept");
  assert.equal(launchReferralPath(mint, "ABC123", false), `/app/launch/${mint}`);
  assert.equal(launchReferralPath(mint, null, true), `/app/launch/${mint}`);
});

test("submit refuses before the pool payer signs: another wallet, an old build, other bytes, a missing signature, a second press", async () => {
  const store = createMemoryGuardStore();
  const poolPayer = testSigner(Keypair.generate());
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

/* A node as the launch's reads see it: a signature's status, the tip (height, slot), and the accounts it holds. */
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const node = ({ status = null, height = 50, slot = 1000, statusSlot = slot, accounts = {}, failStatus = false, failAccounts = false } = {}) => ({
  getSignatureStatuses: async () => {
    if (failStatus) throw new Error("429 Too Many Requests");
    return { context: { slot: statusSlot }, value: [status] };
  },
  getEpochInfo: async () => ({ blockHeight: height, absoluteSlot: slot }),
  getBlockHeight: async () => height,
  getAccountInfoAndContext: async (address, config) => {
    if (failAccounts) throw new Error("fetch failed");
    if (config?.minContextSlot !== undefined && slot < config.minContextSlot) throw new Error("Minimum context slot has not been reached");
    const owner = accounts[address.toBase58()];
    return { context: { slot }, value: owner ? { owner: { toBase58: () => owner }, data: Buffer.alloc(0) } : null };
  },
});

test("a send the network has not answered for is PENDING, and the chain's word settles it later", async () => {
  const store = createMemoryGuardStore();
  const token = Keypair.generate().publicKey.toBase58();
  const key = `solana:devnet:${token}`;
  const record = { cluster: "devnet", state: "PENDING", token, creator: "Cre1", signature: "sig1", validUntil: "100", buildId: "b1" };
  await store.collection("launchAttempts").set("solana:devnet:Cre1:b1", { buildId: "b1", creator: "Cre1", at: "t" });
  await store.collection("launches").set(key, record);
  const read = (connection, extra = {}) => readLaunchRecord({ store, connection, ...extra }, "devnet", token);
  assert.equal((await read(node())).state, "PENDING", "unknown stays pending");
  assert.equal((await read(node({ status: { err: null, confirmationStatus: "confirmed" } }))).state, "LAUNCHED");
  await store.collection("launches").set(key, record);
  assert.equal((await read(node({ height: 101 }))).state, "PENDING", "just past the blockhash's height is not «expired»: a node's height runs ahead of its signatures");
  assert.equal((await read(node({ height: 500, failStatus: true }))).state, "PENDING", "a status read that failed is not «absent»");
  assert.equal((await read(node({ height: 500, statusSlot: 900 }))).state, "PENDING", "«absent» from a node behind the slot the height was read at says nothing");
  assert.equal((await read(node({ height: 500 }), { second: node({ status: { err: null, confirmationStatus: "finalized" } }) })).state, "LAUNCHED", "the second operator has the signature the first does not");
  await store.collection("launches").set(key, record);
  assert.equal((await read(node({ height: 500, accounts: { [token]: TOKEN_2022 } }))).state, "LAUNCHED", "the mint on chain is the launch landed, whatever the signature read said");
  await store.collection("launches").set(key, record);
  assert.equal((await read(node({ height: 500, failAccounts: true }))).state, "PENDING", "the mint not read: «expired» is not said");
  assert.equal(await read(node({ height: 500, accounts: { [token]: "11111111111111111111111111111111" } })), null, "lamports sent to the mint's address are not the mint: expired, nothing landed");
  assert.equal(await store.collection("launches").get(key), undefined);
  assert.equal(await store.collection("launchAttempts").get("solana:devnet:Cre1:b1"), undefined, "never seen by the chain: its send counts against no limit");
  assert.equal((await read(node(), { adopt: async (mint) => ({ token: mint, state: "LAUNCHED" }) }))?.state, "LAUNCHED", "no record: the chain's launch is adopted where adopting is served");
  assert.equal(await read(node(), { adopt: async () => { throw new Error("store down"); } }), null, "an adoption that fails reads as not found, not as an error");
});

test("a creation that landed at its blockhash's edge is LAUNCHED, never «nothing landed» (the 2026-10-06 double launch)", async () => {
  /* Both creations of that evening: the send accepted, the confirmation gave up on the block height, the node had no
     status yet and its height was past — the answer was «expired», and the creator launched again. */
  for (const [label, owner, expected] of [
    ["the mint on chain", TOKEN_2022, "LAUNCHED"],
    ["lamports at the mint's address, no mint", "11111111111111111111111111111111", "SUBMIT_FAILED"],
    ["no mint, no signature, past the margin", null, "SUBMIT_FAILED"],
  ]) {
    const store = createMemoryGuardStore();
    const poolPayer = testSigner(Keypair.generate());
    const creator = Keypair.generate();
    const mint = Keypair.generate();
    const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
    const now = new Date("2026-10-06T15:07:00.000Z");
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: poolPayer.publicKey, lamports: 1000 }), SystemProgram.transfer({ fromPubkey: mint.publicKey, toPubkey: poolPayer.publicKey, lamports: 0 }));
    tx.feePayer = poolPayer.publicKey;
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.partialSign(mint, creator);
    const unsigned = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
    const id = "e".repeat(32);
    await store.collection("launchBuilds").set(`devnet:${id}`, {
      id, cluster: "devnet", creator: creator.publicKey.toBase58(), preset: "classic", token: mint.publicKey.toBase58(), pool: mint.publicKey.toBase58(), config: mint.publicKey.toBase58(), pairMint: mint.publicKey.toBase58(),
      metadataUri: "https://ryntra.io/api/launch/metadata/x", name: "Moon Cat", symbol: "MCAT", firstBuyInRaw: "0", firstBuyOutRaw: "0", payerCoveredLamports: "1000",
      messageSha256: createHash("sha256").update(unsigned.serializeMessage()).digest("hex"), lock: null, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), validUntil: "100",
    });
    const connection = {
      ...node({ height: 200, accounts: owner ? { [mint.publicKey.toBase58()]: owner } : {} }),
      sendRawTransaction: async () => "sig",
      confirmTransaction: async () => { throw new Error("block height exceeded"); },
    };
    const deps = { network, connection, store, poolPayer, origin: "https://ryntra.io", now: () => now };
    const result = await submitLaunch(deps, { buildId: id, creator: creator.publicKey.toBase58(), signedWireBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), signedLockWireBase64: null });
    assert.equal(result.ok ? result.state : result.code, expected, label);
    const stored = await store.collection("launches").get(`solana:devnet:${mint.publicKey.toBase58()}`);
    assert.equal(stored?.state, expected === "LAUNCHED" ? "LAUNCHED" : undefined, `${label}: the record follows the chain`);
  }
});

test("the lock and the sharing take what the route has left, and are not sent when too little is left", () => {
  assert.deepEqual(budgetLeft(52_000, 0), { confirmMs: 12_000, settleMs: 6_000 }, "a quick creation leaves the full budget");
  const late = budgetLeft(52_000, 40_000);
  assert.ok(late.confirmMs + late.settleMs <= 12_000, "a slow creation leaves less, within the route");
  assert.equal(budgetLeft(52_000, 47_000), null, "under six seconds left: not sent, the page settles what was");
});

test("a send ends within its budget however long the node takes: the send, the confirmation and every read share one clock", async () => {
  const never = () => new Promise(() => {});
  const hanging = { sendRawTransaction: never, confirmTransaction: never, getSignatureStatuses: never, getEpochInfo: never, getAccountInfoAndContext: never };
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: Keypair.generate().publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  tx.recentBlockhash = "11111111111111111111111111111111";
  tx.feePayer = tx.instructions[0].keys[0].pubkey;
  const started = Date.now();
  const sent = await sendOnce(hanging, tx, 100, () => new Date(), { confirmMs: 400, settleMs: 400, deadline: started + 600 }, { second: hanging, landed: async () => null });
  const took = Date.now() - started;
  assert.equal(sent.outcome, "UNKNOWN", "no answer is not «nothing landed»");
  assert.ok(took < 1_500, `the deadline holds: ${took} ms`);
});

test("what a wallet holds of a launch is read from its own accounts by address — a refused or failed read is never «holds nothing»", async () => {
  const { heldRaw } = await import("../core/venues/meteora-dbc/trade.server.ts");
  const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const owner = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const account = (forMint, forOwner, amount) => {
    const data = Buffer.alloc(170);
    forMint.toBuffer().copy(data, 0);
    forOwner.toBuffer().copy(data, 32);
    data.writeBigUInt64LE(amount, 64);
    return { owner: TOKEN_2022_PROGRAM_ID, data };
  };
  const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID).toBase58();
  /* No indexed read: a node that refuses one (the public node does) is never asked it. */
  const node = (byAddress) => ({
    getTokenAccountsByOwner: async () => { throw new Error("Indexed requests require a personal token"); },
    getMultipleAccountsInfo: async (addresses) => addresses.map((address) => byAddress[address.toBase58()] ?? null),
  });
  assert.equal(await heldRaw(node({ [ata]: account(mint, owner, 989076589761n) }), owner, mint), 989076589761n, "the Token-2022 account the sale spends from");
  assert.equal(await heldRaw(node({}), owner, mint), 0n, "no account: holds nothing");
  assert.equal(await heldRaw(node({ [ata]: account(Keypair.generate().publicKey, owner, 5n) }), owner, mint), 0n, "an account of another mint is not counted");
  await assert.rejects(heldRaw({ getMultipleAccountsInfo: async () => { throw new Error("429"); } }, owner, mint), /429/, "a read that failed throws — never a zero");
});

test("a launch is adopted from the chain only when Ryntra's pool payer paid for and signed the creation of that curve", async () => {
  const { adoptLaunch } = await import("./adopt.server.ts");
  const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  const payer = Keypair.generate().publicKey.toBase58();
  const creator = Keypair.generate().publicKey.toBase58();
  const config = Keypair.generate().publicKey.toBase58();
  const history = (signatures) => ({ getSignaturesForAddress: async () => signatures.map((signature) => ({ signature })) });
  const good = (token, pool) => ({
    creation: { signature: "create", slot: 1, blockTime: 1791299263, failed: false, feePayer: payer, signers: [payer, token, creator], initialized: { config, creator, baseMint: token, pool, payer }, creator, creatorTokensOutRaw: "989076589761", creatorQuoteInRaw: "5000000" },
    observation: { token, pool, config, preset: "protected", creator, feeSharing: null, mint: { name: "One Thumb", symbol: "THUMB", uri: "https://ryntra.io/api/launch/metadata/x" } },
  });
  const venueOf = ({ curve, creation, observation, calls }) => ({
    presetCurveOf: async () => { calls.curve += 1; return curve; },
    observeCreation: async () => creation,
    observe: async () => observation,
  });
  const run = async (label, change, expectAdopted) => {
    const store = createMemoryGuardStore();
    const token = Keypair.generate().publicKey.toBase58();
    const pool = Keypair.generate().publicKey.toBase58();
    const base = good(token, pool);
    const shape = change({ curve: pool, creation: base.creation, observation: base.observation, history: ["later", "create"] });
    const calls = { curve: 0 };
    const deps = { network, connection: {}, store, poolPayer: payer, history: history(shape.history), now: () => new Date("2026-10-06T16:00:00.000Z"), venue: venueOf({ ...shape, calls }) };
    const record = await adoptLaunch(deps, token);
    assert.equal(record?.state ?? null, expectAdopted ? "LAUNCHED" : null, label);
    if (expectAdopted) {
      assert.equal(record.signature, "create", `${label}: the mint's first transaction is the creation`);
      assert.equal(record.creator, creator);
      assert.equal(record.firstBuyOutRaw, "989076589761");
      assert.equal(record.lock, null, `${label}: no lock is invented`);
      assert.equal((await store.collection("launchesByCreator").valuesWithPrefix(`solana:devnet:${creator}:`)).length, 1, `${label}: the creator's cabinet lists it`);
    } else {
      await adoptLaunch(deps, token);
      assert.equal(calls.curve, 1, `${label}: what is not a launch is not asked again at once`);
    }
  };
  await run("Ryntra's launch", (shape) => shape, true);
  await run("no curve on a preset's config", (shape) => ({ ...shape, curve: null }), false);
  await run("another payer", (shape) => ({ ...shape, creation: { ...shape.creation, feePayer: creator, initialized: { ...shape.creation.initialized, payer: creator } } }), false);
  await run("the payer named but not signing", (shape) => ({ ...shape, creation: { ...shape.creation, signers: [creator] } }), false);
  await run("a creation that failed", (shape) => ({ ...shape, creation: { ...shape.creation, failed: true } }), false);
  await run("another token's curve", (shape) => ({ ...shape, creation: { ...shape.creation, initialized: { ...shape.creation.initialized, baseMint: payer } } }), false);
  await run("no initialization at the top level", (shape) => ({ ...shape, creation: { ...shape.creation, initialized: null } }), false);
  await run("a config no preset names", (shape) => ({ ...shape, observation: { ...shape.observation, preset: null } }), false);

  const store = createMemoryGuardStore();
  const token = Keypair.generate().publicKey.toBase58();
  const pool = Keypair.generate().publicKey.toBase58();
  const kept = { cluster: "devnet", state: "PENDING", token, creator, signature: "sent" };
  await store.collection("launches").set(`solana:devnet:${token}`, kept);
  const base = good(token, pool);
  const adopted = await adoptLaunch({ network, connection: {}, store, poolPayer: payer, history: history(["create"]), now: () => new Date(), venue: venueOf({ curve: pool, ...base, calls: { curve: 0 } }) }, token);
  assert.equal(adopted.signature, "sent", "a record written meanwhile is the one kept");
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
  /* The fresh keys wait sealed for the creator's signature: without the server's key to seal them, nothing is built. */
  balance = 1_000_000_000;
  assert.equal((await prepareLaunch({ ...deps, env: {} }, other)).code, "BUILD_FAILED");
});

test("a send the network's preflight refuses costs nobody anything and counts against no limit; one that fails on chain stays counted", async () => {
  for (const [label, connection, counted] of [
    ["preflight", { sendRawTransaction: async () => { const error = new Error("Simulation failed. Message: Transaction simulation failed: insufficient funds"); error.logs = ["Program log: insufficient funds"]; throw error; } }, 0],
    ["on chain", { sendRawTransaction: async () => "sig", confirmTransaction: async () => ({ value: { err: { InstructionError: [1, "Custom"] } } }) }, 1],
  ]) {
    const store = createMemoryGuardStore();
    const poolPayer = testSigner(Keypair.generate());
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
  /* One line names the guarantee only to deny it — the market's own disclaimer, in plain words in both languages. */
  const denial = { en: "No price guarantee. Liquidity can be used up. Ryntra never holds your money.", uk: "Ціну ніхто не гарантує. Ліквідність можуть вичерпати. Ryntra ніколи не тримає твоїх грошей." };
  assert.deepEqual({ ...LAUNCH_WORDS.noGuarantee }, denial, "the disclaimer says no price is guaranteed — word for word");
  for (const [key, words] of Object.entries(LAUNCH_WORDS)) {
    if (key === "noGuarantee") continue;
    for (const text of [words.en, words.uk]) assert.doesNotMatch(text, forbidden, `${key}: «${text}»`);
  }
  for (const code of LAUNCH_RISK_CODES) {
    assert.ok(LAUNCH_WORDS[`risk_${code}`] && LAUNCH_WORDS[`riskWhy_${code}`], `${code} has its words and its reason in both languages`);
  }
  for (const label of ["creator", "sniper", "bundle", "curve", "pool", "lock"]) assert.ok(LAUNCH_WORDS[`label_${label}`], `the label ${label} has its words`);
  /* A word the page asks for and the dictionary lacks throws while the page draws: every key named in the pages exists. */
  for (const file of ["app/app/launch/[mint]/token-market.tsx", "app/app/launch/[mint]/trade-panel.tsx", "app/app/launch/[mint]/page.tsx", "app/app/launch/new/launch-flow.tsx", "app/app/launch/[mint]/market-health.tsx", "app/app/launch/[mint]/flight-log.tsx", "app/app/launch/markets/markets-board.tsx"]) {
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

test("the pool's Ryntra fee is charged only where a launch's trade is recorded and the fee is charged — never one the rewards do not see", () => {
  const stand = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "http://localhost:3020" });
  assert.equal(stand.tradesRecorded, true, "the stand records its trades like mainnet");
  assert.equal(stand.poolFeeCharged, false);
  assert.equal(launchPoolFee(stand), null, "recorded, not yet charged: no fee is taken that the rewards do not see");
  assert.deepEqual(launchPoolFee({ ...stand, poolFeeCharged: true }), { wallet: stand.feeWallet, bps: 100 }, "where it is charged: the policy's 1 % for a new token");
  assert.equal(launchPoolFee({ ...stand, poolFeeCharged: true, tradesRecorded: false }), null, "never where the trade is not recorded");
  assert.equal(launchPoolFee({ ...stand, poolFeeCharged: true, feeWallet: null }), null);
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
  /* SOL-L1a (З15): a metadata read that failed is a read that failed — it falls back to what cannot change, as any. */
  const metadataUnread = { receipt: null, receiptProblems: ["The chain could not be read: the token's metadata."] };
  assert.deepEqual(withFallback(metadataUnread, { at: 1_000, view: good }, 1_000 + 60_000).receipt.marks.map((entry) => entry.code), ["MINT_REVOKED", "LP_LOCKED_FOREVER"]);
  /* Read but for the exit: the mint's marks are fresh, the locked liquidity's stand from the last good read with its pool. */
  const graduated = { pool: "p", positions: [] };
  const exitUnread = { receipt: { observedAt: "2026-10-05T10:01:00.000Z", marks: [mark("MINT_REVOKED")], graduated: null }, receiptProblems: ["The exit positions in the DEX pool could not be read now."] };
  const merged = withFallback(exitUnread, { at: 1_000, view: { ...good, receipt: { ...good.receipt, graduated } } }, 1_000 + 60_000);
  assert.deepEqual(merged.receipt.marks.map((entry) => entry.code), ["MINT_REVOKED", "LP_LOCKED_FOREVER"]);
  assert.equal(merged.receipt.graduated, graduated);
  assert.equal(withFallback(exitUnread, null, 1).receipt.marks.length, 1, "with no good read the mint's marks stand alone");
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
  /* CITY-212: on the devnet stand Classic and Protected share typed wallets too — past the split's rule, the build stops
     later (no sealing key here), never at SHARES_INVALID; on mainnet they stay closed. */
  for (const preset of ["protected", "classic"]) {
    const typed = await prepareLaunch(deps, { ...base, preset, feeShares: split });
    assert.notEqual(typed.code, "SHARES_INVALID", `${preset} shares typed wallets on the stand`);
    assert.equal((await prepareLaunch(deps, { ...base, preset, feeShares: [{ address: creator, bps: 6_000 }, { address: other, bps: 3_000 }] })).code, "SHARES_INVALID", "all of the fee, on Classic and Protected too");
  }
  const mainnet = { ...deps, network: launchNetwork({ RYNTRA_LAUNCH_STAND: "mainnet" }) };
  assert.notEqual((await prepareLaunch(mainnet, { ...base, preset: "protected", feeShares: split })).code, "SHARES_INVALID", "on mainnet Classic and Protected share typed wallets too — the opening word of 9.11");
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
  /* A decode made before the creator's and the LP's parts were counted is replaced once by the same transaction read again. */
  await index.save("TokenC", "sig3", decoded);
  await index.save("TokenC", "sig3", { ...decoded, marks: { v: 1, liquidityChanged: false } });
  await index.save("TokenC", "sig3", { ...decoded, slot: 99, marks: { v: 1, liquidityChanged: true } });
  assert.deepEqual((await index.load("TokenC")).get("sig3").marks, { v: 1, liquidityChanged: false }, "and then never again");
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
  const revenue = rows.find((row) => row.role === "LAUNCH_REVENUE");
  const vaults = configs.filter((row) => row.parent === null);
  const micro = configs.find((row) => row.id === "solana-launch-config-micro");
  /* Класичний, Захищений and «Спільнота» on JUP (SOL-L5) name the vault; Micro and the demo market the executor, each with its config from before KMS. */
  assert.equal(vaults.length, 3);
  assert.equal(configs.length, 7);
  const moment = (block) => ({ network: "solana", block, time: null, tx: `t${block}` });
  const all = withFeeClaimer(rows, [{ id: vaults[0].id, moment: moment(20) }, { id: vaults[1].id, moment: moment(10) }, { id: vaults[2].id, moment: moment(40) }, { id: micro.id, moment: moment(30) }]);
  assert.equal(all.find((start) => start.id === claimer.id)?.moment.block, 10, "the vault starts at the first config it claims for");
  assert.equal(all.find((start) => start.id === revenue.id)?.moment.block, 30, "Ryntra's revenue from Micro starts at Micro's config, never at the executor's funding");
  assert.equal(withFeeClaimer(rows, [{ id: vaults[0].id, moment: moment(20) }]).some((start) => start.id === claimer.id), false);
  assert.match(read("lib/attribution/launch-starts.server.ts"), /Promise\.race\(\[pending, waited\]\)/, "a page never waits on the chain for a start");
});
test("Micro and the demo market: a first buy goes under a lock of six months; the demo market takes Ryntra's own wallets alone", async () => {
  const store = createMemoryGuardStore();
  const stand = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  const usdc = stand.pairs.classic;
  /* Whatever their addresses on this network: the refusals come before any config is read. */
  const network = { ...stand, configs: { ...stand.configs, micro: "Micro1111111111111111111111111111111111111", demo: "Demo11111111111111111111111111111111111111" }, pairs: { ...stand.pairs, micro: usdc, demo: usdc } };
  const own = Keypair.generate().publicKey.toBase58();
  const stranger = Keypair.generate().publicKey.toBase58();
  const deps = { network, connection: { getBalance: async () => 1_000 }, store, poolPayer: Keypair.generate(), origin: "https://ryntra.io", now: () => new Date("2026-10-09T10:00:00.000Z") };
  const metadataUri = `https://ryntra.io/api/launch/metadata/${(await storeLaunchMetadata(store, { name: "Small Cat", symbol: "SCAT", description: "", image: "https://ryntra.io/api/launch/image/x", createdOn: "https://ryntra.io" }, "t")).sha256}`;
  const base = { creator: stranger, preset: "micro", metadataUri, firstBuyRaw: "5000000", lock: null };
  assert.equal((await prepareLaunch(deps, base)).code, "LOCK_REQUIRED", "a first buy on Micro without a lock");
  assert.equal((await prepareLaunch(deps, { ...base, lock: "3m-6m" })).code, "LOCK_REQUIRED", "a lock that opens before six months");
  /* MC-1: the purchase and its lock are one v1 transaction — a wallet that does not sign v1 is told so before anything is read. */
  assert.equal((await prepareLaunch(deps, { ...base, lock: "6m-12m" })).code, "LOCK_NEEDS_V1", "six months, legacy bytes: refused");
  assert.equal((await prepareLaunch(deps, { ...base, lock: "6m-12m", format: "v1" })).code, "PAYER_LOW", "six months, v1: on to the payer");
  assert.equal((await prepareLaunch(deps, { ...base, firstBuyRaw: "0" })).code, "PAYER_LOW", "no first buy: nothing to lock");
  /* The demo market: refused to a wallet that is not Ryntra's, refused when the list cannot be read, taken from Ryntra's own. */
  const demo = { ...base, preset: "demo", lock: "6m-12m", format: "v1" };
  assert.equal((await prepareLaunch(deps, demo)).code, "PRESET_UNAVAILABLE", "no list — no wallet is Ryntra's");
  const listed = { ...deps, ownWallet: async (wallet) => wallet === own };
  assert.equal((await prepareLaunch(listed, demo)).code, "PRESET_UNAVAILABLE");
  assert.equal((await prepareLaunch({ ...deps, ownWallet: async () => { throw new Error("store down"); } }, { ...demo, creator: own })).code, "PRESET_UNAVAILABLE", "fails closed");
  assert.equal((await prepareLaunch(listed, { ...demo, creator: own })).code, "PAYER_LOW", "Ryntra's own wallet passes the gate");
  const { LAUNCH_FAILURE_CODES } = await import("./runtime.server.ts");
  assert.equal(LAUNCH_FAILURE_CODES.LOCK_REQUIRED, "VALIDATION_ERROR");
  assert.equal(LAUNCH_FAILURE_CODES.LOCK_NEEDS_V1, "LAUNCH_WALLET_V1_REQUIRED");
});

test("the form's presets: Micro for people with its lock; the demo market only on its own page", async () => {
  const { launchPresetsView } = await import("./runtime.server.ts");
  const stand = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  const usdc = stand.pairs.classic;
  const network = { ...stand, configs: { ...stand.configs, micro: "Micro1111111111111111111111111111111111111", demo: "Demo11111111111111111111111111111111111111" }, pairs: { ...stand.pairs, micro: usdc, demo: usdc } };
  const people = launchPresetsView(network);
  assert.deepEqual(people.presets.map((entry) => entry.id), ["classic", "protected", "community", "micro"]);
  const micro = people.presets.find((entry) => entry.id === "micro");
  assert.deepEqual([micro.creatorLockMinDays, micro.technicalValidation, micro.firstBuyCapBps, micro.graduationFee.pct, micro.graduationFee.creatorPct], [180, false, 200, 8, 0]);
  assert.equal(people.presets.find((entry) => entry.id === "classic").creatorLockMinDays, null);
  const internal = launchPresetsView(network, { internal: true });
  assert.equal(internal.presets.find((entry) => entry.id === "demo")?.technicalValidation, true);
  assert.ok(people.locks.some((lock) => lock.cliffDays >= 180), "a schedule long enough for Micro exists");
});

test("the creator's wallet signs first: the fresh keys sign after, over the exact message the wallet signed, and the pool payer last", async () => {
  const env = { BETA_TOKEN_SECRET: "a-server-key-long-enough" };
  const poolPayer = testSigner(Keypair.generate());
  const creator = Keypair.generate();
  const mint = Keypair.generate();
  const base = Keypair.generate();
  const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  const now = new Date("2026-10-17T12:00:00.000Z");
  const blockhash = "11111111111111111111111111111111";
  const wire = (transaction) => transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const hash = (transaction) => createHash("sha256").update(transaction.serializeMessage()).digest("hex");
  /* The creation: paid by the pool payer, signed by the creator and the new mint; the lock: paid by the creator, signed by the escrow's base. */
  const creationTx = () => {
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: poolPayer.publicKey, lamports: 1000 }), SystemProgram.transfer({ fromPubkey: mint.publicKey, toPubkey: poolPayer.publicKey, lamports: 0 }));
    tx.feePayer = poolPayer.publicKey;
    tx.recentBlockhash = blockhash;
    return tx;
  };
  const lockTx = () => {
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: creator.publicKey, lamports: 1 }), SystemProgram.transfer({ fromPubkey: base.publicKey, toPubkey: creator.publicKey, lamports: 0 }));
    tx.feePayer = creator.publicKey;
    tx.recentBlockhash = blockhash;
    return tx;
  };
  const lighthouse = new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE_PROGRAM), keys: [{ pubkey: creator.publicKey, isSigner: false, isWritable: false }], data: Buffer.from([LIGHTHOUSE_FIRST_ASSERTION, 0]) });
  /* What the wallet returns: the built message with only the creator's signature — and, on the creator's own transaction, what a wallet may add. */
  const walletSigns = (tx, add = []) => {
    const seen = Transaction.from(Buffer.from(wire(tx), "base64"));
    const signed = add.length ? new Transaction().add(...seen.instructions, ...add) : seen;
    if (add.length) {
      signed.feePayer = seen.feePayer;
      signed.recentBlockhash = seen.recentBlockhash;
    }
    signed.partialSign(creator);
    return wire(signed);
  };
  const setup = async (cosign) => {
    const store = createMemoryGuardStore();
    const sent = [];
    const connection = {
      sendRawTransaction: async (bytes) => {
        sent.push(Transaction.from(bytes));
        return "sig";
      },
      confirmTransaction: async () => ({ value: { err: null } }),
    };
    const id = "f".repeat(32);
    await store.collection("launchBuilds").set(`devnet:${id}`, {
      id, cluster: "devnet", creator: creator.publicKey.toBase58(), preset: "micro", token: mint.publicKey.toBase58(), pool: mint.publicKey.toBase58(), config: mint.publicKey.toBase58(), pairMint: mint.publicKey.toBase58(),
      metadataUri: "https://ryntra.io/api/launch/metadata/x", name: "Moon Cat", symbol: "MCAT", firstBuyInRaw: "0", firstBuyOutRaw: "0", payerCoveredLamports: "1000",
      messageSha256: hash(creationTx()),
      lock: { schedule: "6m-12m", escrow: base.publicKey.toBase58(), amountRaw: "1", cliffAt: 0, endsAt: 0, messageSha256: hash(lockTx()), digest: reviewedDigest(Transaction.from(Buffer.from(wire(lockTx()), "base64"))) },
      split: null, cosign, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), validUntil: "100",
    });
    return { sent, deps: { network, connection, store, poolPayer, origin: "https://ryntra.io", now: () => now, env }, input: { buildId: id, creator: creator.publicKey.toBase58(), signedWireBase64: walletSigns(creationTx()), signedLockWireBase64: walletSigns(lockTx()) } };
  };
  const sealed = sealCosigners([{ index: 0, key: mint }, { index: 1, key: base }], env);

  /* Refused before any key of the server's signs: no creator's signature, another key in its place, bytes the build did not make. */
  {
    const { sent, deps, input } = await setup(sealed);
    assert.equal((await submitLaunch(deps, { ...input, signedWireBase64: wire(creationTx()) })).code, "SIGNATURE_MISSING", "the wallet's signature is not there");
    const forged = creationTx();
    forged.partialSign(creator);
    forged.signatures.find((entry) => entry.publicKey.equals(creator.publicKey)).signature = Buffer.from(Keypair.generate().secretKey.subarray(0, 64));
    assert.equal((await submitLaunch(deps, { ...input, signedWireBase64: wire(forged) })).code, "SIGNATURE_MISSING", "a signature that is not the creator's");
    assert.equal((await submitLaunch(deps, { ...input, signedWireBase64: walletSigns(creationTx(), [lighthouse]) })).code, "SIGNED_OTHER_BYTES", "the pool payer pays the creation: nothing may be added to it");
    const extra = SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 5 });
    assert.equal((await submitLaunch(deps, { ...input, signedLockWireBase64: walletSigns(lockTx(), [extra]) })).code, "SIGNED_OTHER_BYTES", "a transfer is never a wallet's own addition");
    assert.equal((await submitLaunch({ ...deps, env: { BETA_TOKEN_SECRET: "another-server-key-long" } }, input)).code, "BUILD_EXPIRED", "keys sealed with another key do not open");
    assert.equal(sent.length, 0, "nothing was sent on a refusal");
  }
  {
    const { deps, input } = await setup(`${sealed.slice(0, -2)}${sealed.endsWith("AA") ? "BB" : "AA"}`);
    assert.equal((await submitLaunch(deps, input)).code, "BUILD_EXPIRED", "a doctored seal does not open");
  }

  /* Accepted: the creator signed first; the mint, the base and the pool payer sign after, over exactly what the creator signed. */
  const { sent, deps, input } = await setup(sealed);
  const signedLock = walletSigns(lockTx(), [lighthouse]);
  const result = await submitLaunch(deps, { ...input, signedLockWireBase64: signedLock });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(sent.length, 2, "the creation, then the lock");
  const [creation, lock] = sent;
  assert.ok(creation.verifySignatures(true), "the creator, the mint and the pool payer — every signature real");
  assert.equal(hash(creation), hash(creationTx()), "the creation's message is the one built");
  assert.deepEqual(creation.signatures.map((entry) => entry.publicKey.toBase58()).sort(), [creator, mint, poolPayer].map((key) => key.publicKey.toBase58()).sort());
  assert.ok(lock.verifySignatures(true), "the creator and the escrow's base — every signature real");
  const walletLock = Transaction.from(Buffer.from(signedLock, "base64"));
  assert.equal(hash(lock), hash(walletLock), "the base signed the message the wallet signed, its Lighthouse assertion with it");
  const creatorSignature = (tx) => Buffer.from(tx.signatures.find((entry) => entry.publicKey.equals(creator.publicKey)).signature).toString("base64");
  assert.equal(creatorSignature(lock), creatorSignature(walletLock), "the creator's own signature is the one sent");
});
