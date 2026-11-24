/**
 * The launch engine of a launch straight into a pool, with no network: its gate — shut on mainnet whatever
 * a deployment says —, the first step's build on the rehearsal's recorded chain, what is refused before a signature,
 * and how a signed step is held to the built one. The whole launch on the program itself is the rehearsal's
 * (`scripts/launch-qa/dlmm-pro-launch-rehearsal.mjs`).
 *
 * This file is also what holds the surface's gate for the venue's guard (`lib/core/venues/meteora-dlmm-pro/
 * sdk.test.mjs`, `SURFACES`): the engine is the one file that loads the venue, and nothing it exports builds or sends
 * on mainnet while its gate is shut.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { readFixture, rpcConnection, snapshotSource } from "../core/venues/meteora-dlmm-pro/fixture-kit.mjs";

const { DLMM_PRO_LAUNCH_OWNER_WORD, DLMM_PRO_LAUNCH_POOL_SOURCE, DLMM_PRO_LAUNCH_REWARD_MAINNET, dlmmProLaunchRewardOpenFor, dlmmProLaunchEstimate, dlmmProLaunchOpenFor, dlmmProLaunchView, listDlmmProLaunches, prepareDlmmProLaunch, signedAsBuilt, submitDlmmProLaunch, DLMM_PRO_LAUNCH_COLLECTIONS } = await import("./engine.server.ts");
const { createMemoryGuardStore } = await import("../guard/store.ts");
const { storeLaunchMetadata } = await import("../launch/metadata.server.ts");
const { createDlmmProVenue } = await import("../core/venues/meteora-dlmm-pro/venue.server.ts");
const { DLMM_PRO_OPEN_TO_PEOPLE } = await import("../core/venues/meteora-dlmm-pro/gate.ts");

const fixture = readFixture(new URL("../core/venues/meteora-dlmm-pro/fixtures/rehearsal.json.gz", import.meta.url));
const { who, addresses } = fixture;
const ORIGIN = "https://ryntra.io";
/* The rehearsal's keys are made from their names: the creator of its recorded chain can sign here. */
const creatorKey = Keypair.fromSeed(createHash("sha256").update("city-211/creator").digest());
assert.equal(creatorKey.publicKey.toBase58(), who.creator);

const network = (cluster) => ({ cluster, chain: cluster === "mainnet" ? "solana:mainnet" : "solana:devnet", pairs: { classic: { mint: addresses.usdc, symbol: "USDC", decimals: 6, usdPrice: 1, dollar: true } }, referralOwner: who.referral, origin: ORIGIN });
function depsOf(over = {}) {
  const connection = rpcConnection(snapshotSource(fixture.snapshots.opened, {}));
  return { network: network("devnet"), connection, store: createMemoryGuardStore(), now: () => new Date(), env: { BETA_TOKEN_SECRET: "a-test-secret-long-enough" }, origin: ORIGIN, second: null, ryntra: who.referral, ...over };
}
async function detailsIn(store, name = "Test Coin", symbol = "TEST") {
  const stored = await storeLaunchMetadata(store, { name, symbol, description: "", image: "https://ryntra.io/launch/picture.png", createdOn: "https://ryntra.io" }, new Date().toISOString());
  return `${ORIGIN}/api/launch/metadata/${stored.sha256}`;
}

test("the gate: the devnet stand is open; mainnet opens by a constant no deployment can flip", () => {
  assert.equal(DLMM_PRO_LAUNCH_OWNER_WORD, true, "mainnet is opened in code");
  assert.equal(DLMM_PRO_OPEN_TO_PEOPLE, true, "the venue is open beside it (D-M4, 18.11)");
  assert.equal(DLMM_PRO_LAUNCH_POOL_SOURCE, "launch", "no pool is made from a config Meteora has not given (D-M1)");
  assert.equal(dlmmProLaunchOpenFor("devnet"), true);
  assert.equal(dlmmProLaunchOpenFor("mainnet"), true);
  assert.equal(dlmmProLaunchOpenFor({ cluster: "mainnet" }), true);
  assert.equal(dlmmProLaunchOpenFor("mainnet", false), false, "without the constant mainnet stays shut");
  assert.equal(dlmmProLaunchOpenFor("mainnet", true), true, "the constant, and nothing else, opens it");
  for (const word of [1, "true", "open"]) assert.equal(dlmmProLaunchOpenFor("mainnet", word), false, "only the constant itself, never a word that looks like it");
});

test("with mainnet's constant closed, nothing is built on mainnet and nothing is sent, whatever the request and whatever the environment", async () => {
  const env = { BETA_TOKEN_SECRET: "a-test-secret-long-enough", RYNTRA_DLMM_PRO_LAUNCH: "open", RYNTRA_SOLANA_LAUNCH_STATE: "OPEN", NEXT_PUBLIC_RYNTRA_CITY_POOL_LAUNCH: "open" };
  const deps = depsOf({ network: network("mainnet"), env, ownerWord: false });
  const metadataUri = await detailsIn(deps.store);
  const built = await prepareDlmmProLaunch(deps, { creator: who.creator, metadataUri });
  assert.deepEqual({ ok: built.ok, code: built.code }, { ok: false, code: "LAUNCH_PAUSED" });
  const sent = await submitDlmmProLaunch(deps, { buildId: "0".repeat(32), creator: who.creator, signedWireBase64: ["AA=="] });
  assert.deepEqual({ ok: sent.ok, code: sent.code }, { ok: false, code: "LAUNCH_PAUSED" });
  /* Not a build, not a record, not a read of the chain was made for it. */
  assert.deepEqual(deps.connection.asked, []);
  for (const name of Object.values(DLMM_PRO_LAUNCH_COLLECTIONS)) assert.deepEqual(await deps.store.collection(name).valuesWithPrefix(""), []);
});

function read(wireBase64) {
  const message = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64")).message;
  const keys = message.staticAccountKeys.map((key) => key.toBase58());
  return { keys, signers: keys.slice(0, message.header.numRequiredSignatures), programs: [...new Set(message.compiledInstructions.map((ix) => keys[ix.programIdIndex]))] };
}

test("the first step is the honest coin and nothing else: the creator pays, the fresh mint signs beside it, the whole launch is reckoned", async () => {
  const deps = depsOf();
  const metadataUri = await detailsIn(deps.store);
  const built = await prepareDlmmProLaunch(deps, { creator: who.creator, metadataUri });
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.stage, "COIN");
  assert.equal(built.unsignedWireBase64.length, 1);
  const tx = read(built.unsignedWireBase64[0]);
  assert.deepEqual(tx.signers, [who.creator, built.mint], "the creator, and the coin's own mint");
  assert.deepEqual(tx.programs.sort(), ["ComputeBudget111111111111111111111111111111", SystemProgram.programId.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()].sort(), "the token programs and the system program — no pool, no swap");
  /* No signature is on the bytes the wallet is handed. */
  assert.ok(VersionedTransaction.deserialize(Buffer.from(built.unsignedWireBase64[0], "base64")).signatures.every((signature) => signature.every((byte) => byte === 0)));
  assert.equal(built.pair, "SOL", "SOL when no pair is named");
  const venue = createDlmmProVenue({ connection: deps.connection, referralOwner: who.referral });
  assert.equal(built.pool, venue.pools.launchPoolAddress(built.mint, "So11111111111111111111111111111111111111112"), "the pair's launch pool, named before it exists");
  assert.equal(built.opensAt, fixture.snapshots.opened.clock.unix + 900, "a quarter of an hour by the chain's own clock");
  assert.deepEqual(built.fee, { startBps: 5_000, endBps: null, askedEndBps: 100, priceMultiple: 4 }, "where the fee settles is the pool's to say — not said before the pool is built");
  assert.deepEqual(built.split, { creatorBps: 4_000, ryntraBps: 6_000 });
  assert.equal(built.feeLamports, 10_000, "two signatures");
  assert.ok(built.rentLamports > 3_000_000 && built.rentLamports < 6_000_000, `the coin's rent: ${built.rentLamports}`);
  const estimate = await dlmmProLaunchEstimate(deps.connection, { name: "Test Coin", symbol: "TEST", uri: metadataUri, split: true });
  assert.ok(Number(built.remainingLamports) >= built.feeLamports + built.rentLamports);
  assert.ok(Math.abs(Number(built.remainingLamports) - (estimate.feeLamports + estimate.rentLamports)) < 2_000_000, "the whole launch, as it is reckoned before anything is on chain");
  /* Nothing of the launch is recorded until its coin is sent. */
  assert.deepEqual(await listDlmmProLaunches(deps), []);
  assert.equal(await dlmmProLaunchView(deps, built.mint), null);
});

test("the pair, the time and the split are the request's and the deployment's — each held to what the format takes", async () => {
  const deps = depsOf({ ryntra: null });
  const metadataUri = await detailsIn(deps.store);
  const at = fixture.snapshots.opened.clock.unix + 7_200;
  const usdc = await prepareDlmmProLaunch(deps, { creator: who.creator, metadataUri, pair: "USDC", opensAt: at });
  assert.equal(usdc.ok, true, JSON.stringify(usdc));
  assert.equal(usdc.pair, "USDC");
  assert.equal(usdc.opensAt, at);
  assert.equal(usdc.split, null, "no Ryntra side: one position, the creator's");
  const single = await dlmmProLaunchEstimate(deps.connection, { name: "Test Coin", symbol: "TEST", uri: metadataUri, split: false });
  const split = await dlmmProLaunchEstimate(deps.connection, { name: "Test Coin", symbol: "TEST", uri: metadataUri, split: true });
  assert.ok(split.rentLamports > single.rentLamports && split.feeLamports === single.feeLamports + 3 * 5_000, "the second position doubles the ranges' rent and adds three signatures");
  const code = async (body, over = {}) => (await prepareDlmmProLaunch({ ...deps, ...over }, { creator: who.creator, metadataUri, ...body })).code;
  assert.equal(await code({ opensAt: fixture.snapshots.opened.clock.unix + 60 }), "VALIDATION_ERROR", "too close for three steps");
  assert.equal(await code({ opensAt: fixture.snapshots.opened.clock.unix + 40 * 86_400 }), "VALIDATION_ERROR", "further than the program lets a pool wait");
  assert.equal(await code({ pair: "BONK" }), "VALIDATION_ERROR");
  assert.equal(await code({ metadataUri: `${ORIGIN}/api/launch/metadata/${"0".repeat(64)}` }), "LAUNCH_NOT_FOUND");
  assert.equal(await code({ metadataUri: "https://elsewhere.example/metadata.json" }), "LAUNCH_NOT_FOUND", "details Ryntra did not store");
  assert.equal(await code({}, { env: {} }), "LAUNCH_PAUSED", "no key to seal the fresh keys with");
  assert.equal(await code({}, { poolSource: "config", config: null }), "LAUNCH_PAUSED", "the config's path has no config and no signer");
  assert.equal(await code({}, { ryntra: who.creator }), "LAUNCH_PAUSED", "Ryntra's side is never the creator's own wallet");
  assert.equal(await code({ creator: "not an address" }), "VALIDATION_ERROR");
  assert.equal(await code({ creator: who.pauper }), "LAUNCH_BALANCE_LOW", "a wallet that cannot pay for the whole launch is told before its coin is minted");
  assert.equal(await code({ mint: Keypair.generate().publicKey.toBase58(), metadataUri: undefined }), "LAUNCH_NOT_FOUND", "no launch of that coin");
});

test("the creator's ladder is the creator's to ask for: told before the first signature, reckoned in the whole launch, off unless asked", async () => {
  const deps = depsOf();
  const metadataUri = await detailsIn(deps.store);
  const plain = await prepareDlmmProLaunch(deps, { creator: who.creator, metadataUri });
  assert.equal(plain.ladder, null, "no ladder unless asked");
  const laddered = await prepareDlmmProLaunch(deps, { creator: who.creator, metadataUri, ladder: true });
  assert.equal(laddered.ok, true, JSON.stringify(laddered));
  assert.deepEqual(laddered.ladder, { shareBps: 500, amountRaw: (1_000_000_000_000_000n / 20n).toString(), nearMultiple: 2, farMultiple: 10, rungs: 5 });
  /* The first step is the coin alone either way: the ladder rests in the supply's step. */
  assert.deepEqual(read(laddered.unsignedWireBase64[0]).signers, [who.creator, laddered.mint]);
  const without = await dlmmProLaunchEstimate(deps.connection, { name: "Test Coin", symbol: "TEST", uri: metadataUri, split: true });
  const withLadder = await dlmmProLaunchEstimate(deps.connection, { name: "Test Coin", symbol: "TEST", uri: metadataUri, split: true, ladder: true });
  assert.equal(withLadder.feeLamports, without.feeLamports + 2 * 5_000, "the ladder's wallet and its NFT sign");
  assert.ok(withLadder.rentLamports > without.rentLamports && withLadder.rentLamports - without.rentLamports < 20_000_000, `the order's rent: ${withLadder.rentLamports - without.rentLamports}`);
  assert.equal(withLadder.stages.COIN, without.stages.COIN, "the coin's step does not change");
  assert.ok(Number(laddered.remainingLamports) > Number(plain.remainingLamports), "the whole launch is told with its ladder");
});

test("a borrowed name and a creator's launch past the day's bot guard are refused before anything is built", async () => {
  const deps = depsOf();
  const borrowed = await prepareDlmmProLaunch(deps, { creator: who.creator, metadataUri: await detailsIn(deps.store, "Tesla", "TSLA") });
  assert.equal(borrowed.code, "LAUNCH_NAME_BORROWED");
  const metadataUri = await detailsIn(deps.store);
  const records = deps.store.collection(DLMM_PRO_LAUNCH_COLLECTIONS.records);
  const { LAUNCHES_PER_CREATOR_PER_DAY } = await import("../launch/config.server.ts");
  for (let index = 0; index < LAUNCHES_PER_CREATOR_PER_DAY; index += 1) await records.set(`devnet:mint${index}`, { cluster: "devnet", mint: `mint${index}`, creator: who.creator, createdAt: new Date().toISOString(), steps: {} });
  assert.equal((await prepareDlmmProLaunch(deps, { creator: who.creator, metadataUri })).code, "LAUNCH_LIMIT");
  assert.equal((await prepareDlmmProLaunch(deps, { creator: who.maker, metadataUri })).ok, true, "another wallet's day is its own");
});

test("a signed step is the built one, signed by its creator — then the fresh key signs over the very same message", async () => {
  const deps = depsOf();
  const built = await prepareDlmmProLaunch(deps, { creator: who.creator, metadataUri: await detailsIn(deps.store) });
  const wire = built.unsignedWireBase64[0];
  const mintKey = Keypair.generate();
  const signedBy = (key) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    tx.sign([key]);
    return Buffer.from(tx.serialize()).toString("base64");
  };
  const check = (signed, keys = []) => signedAsBuilt(signed, { wireBase64: wire, config: false }, who.creator, keys, null);
  /* Unsigned, and signed by nobody the step names. */
  assert.equal((await check(wire)).code, "LAUNCH_SIGNED_OTHER_BYTES");
  /* Signed by the creator, the mint's slot still empty: the server's own key is the one that fills it — a stranger's key does not. */
  assert.equal((await check(signedBy(creatorKey), [mintKey])).code, "LAUNCH_SIGNED_OTHER_BYTES", "a signer the message names stayed unsigned");
  /* Other bytes signed by the creator for real. */
  const other = new VersionedTransaction(new TransactionMessage({ payerKey: creatorKey.publicKey, recentBlockhash: creatorKey.publicKey.toBase58(), instructions: [SystemProgram.transfer({ fromPubkey: creatorKey.publicKey, toPubkey: mintKey.publicKey, lamports: 1 })] }).compileToV0Message());
  other.sign([creatorKey]);
  assert.equal((await check(Buffer.from(other.serialize()).toString("base64"))).code, "LAUNCH_SIGNED_OTHER_BYTES");
  assert.equal((await check("not a transaction")).code, "LAUNCH_SIGNED_OTHER_BYTES");
  /*
   * The engine's own send of it: the sealed mint key signs after the creator, and every signature is then real — so the
   * step reaches the network. The snapshot's network takes nothing: a refusal before the chain saw the coin leaves no
   * launch behind, and is not counted against the build.
   */
  const sent = await submitDlmmProLaunch({ ...deps, sendBudget: { confirmMs: 20, settleMs: 200 } }, { buildId: built.buildId, creator: who.creator, signedWireBase64: [signedBy(creatorKey)] });
  assert.deepEqual({ ok: sent.ok, code: sent.code }, { ok: false, code: "LAUNCH_SUBMIT_FAILED" }, JSON.stringify(sent));
  assert.match(sent.message, /sendTransaction/, "the refusal is the network's own — the signatures passed");
  assert.deepEqual(await listDlmmProLaunches(deps), [], "no launch of a coin that never reached the chain");
  assert.equal(await dlmmProLaunchView(deps, built.mint), null);
  /* Another wallet cannot send a creator's build. */
  const second = await prepareDlmmProLaunch(deps, { creator: who.creator, metadataUri: await detailsIn(deps.store, "Second Coin", "SECND") });
  assert.equal((await submitDlmmProLaunch(deps, { buildId: second.buildId, creator: who.maker, signedWireBase64: second.unsignedWireBase64 })).code, "WALLET_MISMATCH");
  assert.equal((await submitDlmmProLaunch(deps, { buildId: second.buildId, creator: who.creator, signedWireBase64: [] })).code, "LAUNCH_SIGNED_OTHER_BYTES");
  assert.equal((await submitDlmmProLaunch(deps, { buildId: "f".repeat(32), creator: who.creator, signedWireBase64: [wire] })).code, "LAUNCH_NOT_FOUND");
});

/* ------------------------------------------------------------------ the reward for the pool's liquidity */

const REWARD_ON = { BETA_TOKEN_SECRET: "a-test-secret-long-enough", RYNTRA_POOL_LAUNCH_REWARDS: "open" };

test("the reward's switch: closed unless the deployment opens it; on mainnet closed besides until a constant no deployment can flip", () => {
  assert.equal(DLMM_PRO_LAUNCH_REWARD_MAINNET, false, "closed on mainnet until the rehearsal and the release decision");
  assert.equal(dlmmProLaunchRewardOpenFor("devnet", {}), false, "closed by default, even on the stand");
  assert.equal(dlmmProLaunchRewardOpenFor("devnet", { RYNTRA_POOL_LAUNCH_REWARDS: "1" }), false, "only «open» opens it");
  assert.equal(dlmmProLaunchRewardOpenFor("devnet", { RYNTRA_POOL_LAUNCH_REWARDS: "open" }), true);
  assert.equal(dlmmProLaunchRewardOpenFor("mainnet", { RYNTRA_POOL_LAUNCH_REWARDS: "open" }), false, "the switch alone does not open mainnet");
  assert.equal(dlmmProLaunchRewardOpenFor({ cluster: "mainnet" }, { RYNTRA_POOL_LAUNCH_REWARDS: "open" }, true), true, "the switch and the constant");
  assert.equal(dlmmProLaunchRewardOpenFor("mainnet", {}, true), false, "the constant alone does not either");
  for (const word of [1, "true", "open"]) assert.equal(dlmmProLaunchRewardOpenFor("mainnet", { RYNTRA_POOL_LAUNCH_REWARDS: "open" }, word), false);
});

test("a reward is asked only where its switch is open, inside the terms, at the launch's first step — refused before anything is built", async () => {
  const deps = depsOf();
  const metadataUri = await detailsIn(deps.store);
  const code = async (body, over = {}) => (await prepareDlmmProLaunch({ ...deps, env: REWARD_ON, ...over }, { creator: who.creator, metadataUri, ...body })).code;
  assert.equal(await code({ reward: { shareBps: 200, days: 30 } }, { env: { BETA_TOKEN_SECRET: "a-test-secret-long-enough" } }), "LAUNCH_PAUSED", "the switch is closed");
  assert.equal(await code({ reward: { shareBps: 200, days: 30 } }, { network: network("mainnet"), ownerWord: true }), "LAUNCH_PAUSED", "mainnet without the reward's own constant");
  assert.equal(await code({ reward: { shareBps: 200, days: 30 } }, { poolSource: "config", config: { address: who.creator, signer: { address: who.creator, signMessage: async () => new Uint8Array(64) } } }), "LAUNCH_PAUSED", "only on a launch pool");
  assert.equal(await code({ reward: { shareBps: 5, days: 30 } }), "VALIDATION_ERROR", "under a tenth of a per cent");
  assert.equal(await code({ reward: { shareBps: 1_500, days: 30 } }), "VALIDATION_ERROR", "over a tenth of the supply");
  assert.equal(await code({ reward: { shareBps: 200, days: 0 } }), "VALIDATION_ERROR", "under the program's day");
  assert.equal(await code({ reward: { shareBps: 200, days: 400 } }), "VALIDATION_ERROR", "over the program's year");
  assert.equal(await code({ mint: Keypair.generate().publicKey.toBase58(), metadataUri: undefined, reward: { shareBps: 200, days: 30 } }), "VALIDATION_ERROR", "a launch already begun keeps its reward");
  assert.deepEqual(await listDlmmProLaunches(deps), []);
});

test("the reward is told before the first signature and reckoned in the whole launch: the pool mines, the slots and ticks are longer, one signature more", async () => {
  const deps = depsOf({ env: REWARD_ON });
  const metadataUri = await detailsIn(deps.store);
  const plain = await prepareDlmmProLaunch(deps, { creator: who.creator, metadataUri });
  assert.equal(plain.reward, null, "no reward unless asked");
  const rewarded = await prepareDlmmProLaunch(deps, { creator: who.creator, metadataUri, reward: { shareBps: 200, days: 30 } });
  assert.equal(rewarded.ok, true, JSON.stringify(rewarded));
  assert.deepEqual(
    rewarded.reward,
    { shareBps: 200, amountRaw: (1_000_000_000_000_000n / 50n).toString(), days: 30, opensAt: null, endsAt: null, perDayRaw: (1_000_000_000_000_000n / 50n / 30n).toString(), locked: { creatorBps: 4_000, ryntraBps: 6_000 } },
    "its window is the supply's step's to say; a day of it, and who earns it while the launch's locked liquidity is alone at the price",
  );
  assert.deepEqual(read(rewarded.unsignedWireBase64[0]).signers, [who.creator, rewarded.mint], "the first step is the coin alone");
  const without = await dlmmProLaunchEstimate(deps.connection, { name: "Test Coin", symbol: "TEST", uri: metadataUri, split: true });
  const withReward = await dlmmProLaunchEstimate(deps.connection, { name: "Test Coin", symbol: "TEST", uri: metadataUri, split: true, reward: true });
  assert.equal(withReward.feeLamports, without.feeLamports + 5_000, "the reward's transaction: the creator's signature alone");
  assert.equal(withReward.stages.COIN, without.stages.COIN, "the coin's step does not change");
  assert.ok(withReward.stages.POOL > without.stages.POOL, "the pool is longer by its reward slots");
  assert.ok(withReward.stages.SUPPLY - without.stages.SUPPLY > 2_000_000 && withReward.stages.SUPPLY - without.stages.SUPPLY < 30_000_000, `longer slots and ticks (rent locked for ever with the positions), and the vault: ${withReward.stages.SUPPLY - without.stages.SUPPLY}`);
  assert.ok(Number(rewarded.remainingLamports) > Number(plain.remainingLamports), "the whole launch is told with its reward");
});

test("until others add liquidity the launch's locked positions earn the whole reward — 40 : 60 with the split, all of it the creator's without", async () => {
  const deps = depsOf({ env: REWARD_ON, ryntra: null });
  const metadataUri = await detailsIn(deps.store);
  const alone = await prepareDlmmProLaunch(deps, { creator: who.creator, metadataUri, reward: { shareBps: 500, days: 7 } });
  assert.equal(alone.ok, true, JSON.stringify(alone));
  assert.equal(alone.split, null);
  assert.deepEqual(alone.reward.locked, { creatorBps: 10_000, ryntraBps: 0 }, "one position: what the locked liquidity earns is the creator's own");
  assert.equal(alone.reward.perDayRaw, (1_000_000_000_000_000n / 20n / 7n).toString());

  const { dlmmProRewardDay, dlmmProRewardLockedShare, dlmmProRewardPerDayRaw, dlmmProRewardRaw } = await import("../core/launch/dlmm-pro.ts");
  assert.deepEqual(dlmmProRewardLockedShare(true), { creatorBps: 4_000, ryntraBps: 6_000 });
  /* 2 % for 30 days: 666 666.67 coins a day — with nobody else at the price 400 000 of it Ryntra's, 266 666.67 the creator's. */
  const perDay = dlmmProRewardPerDayRaw(dlmmProRewardRaw(200), 30);
  assert.equal(perDay, 666_666_666_666n);
  const day = dlmmProRewardDay(perDay, true, 0);
  assert.deepEqual(day, { othersRaw: 0n, creatorRaw: 266_666_666_667n, ryntraRaw: 399_999_999_999n });
  assert.equal(day.othersRaw + day.creatorRaw + day.ryntraRaw, perDay, "nothing of a day is lost to rounding");
  /* The rehearsal of 20.11: a wallet holding 62.40 % of the liquidity at the price got 62.4 % of the day; Ryntra's locked part 22.6 %. */
  const r = dlmmProRewardDay(2_857_143n, true, 6_240);
  assert.equal(r.othersRaw, 1_782_857n);
  assert.equal(r.ryntraRaw, 644_571n);
  assert.equal(r.creatorRaw, 429_715n);
  assert.deepEqual(dlmmProRewardDay(perDay, false, 0), { othersRaw: 0n, creatorRaw: perDay, ryntraRaw: 0n }, "without the split nothing is Ryntra's");
  assert.deepEqual(dlmmProRewardDay(perDay, true, 10_000), { othersRaw: perDay, creatorRaw: 0n, ryntraRaw: 0n }, "once others hold all the liquidity at the price, all of it is theirs");
});

test("what the creator has spent of the reward — flowed to liquidity, idle (comes back after the days), still to flow — from the pool's own slot", async () => {
  const { dlmmProEmission, dlmmProRewardRaw, dlmmProRewardSeconds, dlmmProRewardSpent } = await import("../core/launch/dlmm-pro.ts");
  const seconds = dlmmProRewardSeconds(7);
  const { perSecondX64, fundedRaw } = dlmmProEmission(dlmmProRewardRaw(200), seconds);
  const at = (now, idleSeconds = 0, updatedAt = now, liquidityNow = true) => dlmmProRewardSpent({ perSecondX64, fundedRaw, opensAt: 1_000, endsAt: 1_000 + seconds, idleSeconds, updatedAt, liquidityNow, now });
  assert.deepEqual(at(500), { flowedRaw: 0n, idleRaw: 0n, leftRaw: fundedRaw }, "before the opening nothing is spent");
  const day = at(1_000 + 86_400);
  assert.equal(day.idleRaw, 0n);
  assert.equal(day.flowedRaw, (perSecondX64 * 86_400n) >> 64n, "a day of the rate");
  assert.equal(day.flowedRaw + day.leftRaw, fundedRaw);
  const someIdle = at(1_000 + 86_400, 3_600);
  assert.equal(someIdle.idleRaw, (perSecondX64 * 3_600n) >> 64n, "an hour with nobody at the price comes back");
  assert.equal(someIdle.flowedRaw + someIdle.idleRaw, day.flowedRaw);
  const emptyNow = at(1_000 + 86_400, 0, 1_000 + 86_400 - 600, false);
  assert.equal(emptyNow.idleRaw, (perSecondX64 * 600n) >> 64n, "seconds since the slot's last update are idle while nothing stands at the price");
  const over = at(1_000 + seconds + 99, 3_600);
  assert.equal(over.leftRaw, 0n, "past its days nothing is left to flow");
  assert.equal(over.flowedRaw + over.idleRaw, fundedRaw, "and the whole vault is spent or comes back");
});

test("the engine's emission is the venue's own: the same rate, the same funded amount", async () => {
  const { emissionOf } = await import("../core/venues/meteora-dlmm-pro/rewards.server.ts");
  const { dlmmProEmission, dlmmProRewardRaw, dlmmProRewardSeconds } = await import("../core/launch/dlmm-pro.ts");
  for (const [share, days] of [[10, 1], [200, 30], [1_000, 365], [500, 7]]) {
    const amount = dlmmProRewardRaw(share);
    const seconds = dlmmProRewardSeconds(days);
    assert.deepEqual(dlmmProEmission(amount, seconds), emissionOf(amount, BigInt(seconds)), `${share} bps · ${days} days`);
  }
});
