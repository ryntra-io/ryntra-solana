/**
 * What a launch on DLMM Pro adds to the venue, on the rehearsal's recorded state, with no network:
 *
 * - a position's hand-over — the token program's own transfer of its NFT, on its own and as the last step of an
 *   opening;
 * - a pool from a partner's dynamic config — the same terms as a launch pool, at the config's address for the pair,
 *   with the config's wallet as the one signer beside the payer.
 *
 * The hand-over itself landed on the program in the rehearsal of 14.11 (path C, built by its script) and lands again,
 * built by the venue, in the launch's own rehearsal (`scripts/launch-qa/dlmm-pro-launch-rehearsal.mjs`).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DlmmProClient, derivePool, findNftAccount } from "@meteora-ag/dlmm-pro-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";

import { readFixture, rentOf, rpcConnection, snapshotSource } from "./fixture-kit.mjs";

const { createDlmmProVenue } = await import("./venue.server.ts");
const { DlmmProRefusal, DLMM_PRO_PROGRAM } = await import("./sdk.server.ts");
const { DLMM_PRO_UNITS } = await import("./tx.server.ts");

const fixture = readFixture(new URL("./fixtures/rehearsal.json.gz", import.meta.url));
const { who, addresses, terms } = fixture;
const key = (address) => new PublicKey(address);
const refused = (work) => work().then(() => null, (error) => (error instanceof DlmmProRefusal ? error.code : `not a refusal: ${error}`));

function at(moment, changes = {}) {
  const snapshot = fixture.snapshots[moment];
  const accounts = { ...snapshot.accounts };
  for (const [address, entry] of Object.entries(changes)) {
    if (entry === null) delete accounts[address];
    else accounts[address] = { ...(accounts[address] ?? {}), ...entry };
  }
  const connection = rpcConnection(snapshotSource({ ...snapshot, accounts }, {}));
  return { connection, venue: createDlmmProVenue({ connection, referralOwner: who.referral }), sdk: new DlmmProClient(connection) };
}

/** The instructions of sealed bytes after their compute budget: the program and the accounts of each, by address. */
function instructionsOf(wireBase64) {
  const message = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64")).message;
  const keys = message.staticAccountKeys.map((entry) => entry.toBase58());
  return {
    signers: keys.slice(0, message.header.numRequiredSignatures),
    list: message.compiledInstructions.map((ix) => ({ program: keys[ix.programIdIndex], accounts: ix.accountKeyIndexes.map((index) => keys[index]), data: Buffer.from(ix.data) })).filter((ix) => ix.program !== "ComputeBudget111111111111111111111111111111"),
  };
}

/** A hand-over is exactly three calls of the token programs: the receiver's account, the NFT across, the giver's account closed. */
function assertHandOver(list, nftMint, giver, receiver) {
  const from = findNftAccount(key(nftMint), key(giver)).toBase58();
  const to = findNftAccount(key(nftMint), key(receiver)).toBase58();
  assert.equal(list.length, 3);
  const [open, move, close] = list;
  assert.equal(open.program, ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
  assert.deepEqual(open.accounts.slice(0, 4), [giver, to, receiver, nftMint], "the giver pays for the receiver's own account of the NFT");
  assert.equal(open.data[0], 1, "idempotent: an account that is there already is left as it is");
  assert.equal(move.program, TOKEN_2022_PROGRAM_ID.toBase58());
  assert.deepEqual(move.accounts, [from, nftMint, to, giver]);
  assert.equal(move.data[0], 12, "TransferChecked");
  assert.equal(move.data.readBigUInt64LE(1), 1n, "the one NFT");
  assert.equal(move.data[9], 0, "of no decimals");
  assert.equal(close.program, TOKEN_2022_PROGRAM_ID.toBase58());
  assert.deepEqual(close.accounts, [from, giver, giver], "the giver's emptied account is closed and its rent is the giver's again");
  assert.equal(close.data[0], 9, "CloseAccount");
}

test("a position's hand-over is the token program's transfer of its NFT, signed by the holder alone", async () => {
  const { venue } = at("opened");
  const build = await venue.positions.handOver({ pool: addresses.pool, nftMint: addresses.position, owner: who.creator, to: who.referral });
  const { signers, list } = instructionsOf(build.wireBase64);
  assert.deepEqual(signers, [who.creator], "nobody signs beside the holder");
  assert.deepEqual(build.cosigners, []);
  assertHandOver(list, addresses.position, who.creator, who.referral);
  assert.equal(build.units, DLMM_PRO_UNITS.handOver);
  assert.ok(build.units >= 23_319 * 1.5, "half as much again over what the hand-over used on the program (rehearsal of 14.11, C6)");
  assert.deepEqual(build.handedTo, { owner: who.referral, nftAccount: findNftAccount(key(addresses.position), key(who.referral)).toBase58() });
  /* The receiver's account is the one thing made: 170 bytes for this NFT's mint — never told as less than the chain takes. */
  assert.ok(build.rentLamports >= rentOf(170) && build.rentLamports <= rentOf(200), `rent ${build.rentLamports}`);
  assert.equal(build.rentReturnedLamports, 0);
  assert.equal(build.feeLamports, 5_000);
});

test("a hand-over is refused to anyone but the holder, to the holder itself, and for an NFT that is no position of the pool", async () => {
  const { venue } = at("opened");
  const request = { pool: addresses.pool, nftMint: addresses.position, owner: who.creator, to: who.referral };
  assert.equal(await refused(() => venue.positions.handOver({ ...request, owner: who.stranger })), "BAD_INPUT", "a stranger holds no NFT of it");
  assert.equal(await refused(() => venue.positions.handOver({ ...request, to: who.creator })), "BAD_INPUT", "to itself");
  assert.equal(await refused(() => venue.positions.handOver({ ...request, to: addresses.position })), "BAD_INPUT", "to the NFT's own mint");
  assert.equal(await refused(() => venue.positions.handOver({ ...request, to: "not an address" })), "BAD_INPUT");
  assert.equal(await refused(() => venue.positions.handOver({ ...request, nftMint: Keypair.generate().publicKey.toBase58() })), "BAD_INPUT", "no position at this NFT");
  assert.equal(await refused(() => at("rewardsRunning").venue.positions.handOver({ ...request, pool: addresses.poolB })), "BAD_INPUT", "a position of another pool");
});

test("a hand-over into a frozen account of the receiver's is refused before a signature", async () => {
  const target = findNftAccount(key(addresses.position), key(who.referral)).toBase58();
  const source = findNftAccount(key(addresses.position), key(who.creator)).toBase58();
  const held = Buffer.from(fixture.snapshots.opened.accounts[source].data, "base64");
  const frozen = Buffer.from(held);
  key(who.referral).toBuffer().copy(frozen, 32);
  frozen.writeBigUInt64LE(0n, 64);
  frozen.writeUInt8(2, 108);
  const { venue } = at("opened", { [target]: { ...fixture.snapshots.opened.accounts[source], data: frozen.toString("base64") } });
  assert.equal(await refused(() => venue.positions.handOver({ pool: addresses.pool, nftMint: addresses.position, owner: who.creator, to: who.referral })), "BAD_INPUT");
});

test("an opening may end in a hand-over: the last step, packed with the lock where they fit", async () => {
  const { venue } = at("opened");
  const nftMint = Keypair.generate().publicKey.toBase58();
  const shape = { strategy: "curve", minTickId: terms.firstTick, maxTickId: terms.firstTick + 460 * terms.tickSpacing };
  const request = { pool: addresses.pool, wallet: who.creator, nftMint, shape, amountXRaw: "50000000000000", amountYRaw: "0", slippageBps: 0, lockBps: 10_000 };
  const kept = await venue.positions.open({ ...request, maxRanges: 15 });
  const handed = await venue.positions.open({ ...request, maxRanges: 15, handOverTo: who.referral });
  assert.equal(kept.handedTo, null);
  assert.deepEqual(kept.steps.map((step) => step.role), ["OPEN", "DEPOSIT", "LOCK"]);
  assert.deepEqual(handed.steps.map((step) => step.role), ["OPEN", "DEPOSIT", "LOCK", "HANDOVER"]);
  assert.deepEqual(handed.handedTo, { owner: who.referral, nftAccount: findNftAccount(key(nftMint), key(who.referral)).toBase58() });
  assertHandOver(instructionsOf(handed.steps[3].wireBase64).list, nftMint, who.creator, who.referral);
  /* The same liquidity, the same deposit: a hand-over changes who holds the position, nothing of what it holds. */
  assert.deepEqual(handed.deposit, kept.deposit);
  assert.deepEqual(handed.shape, kept.shape);
  /* Fifteen ranges open, fill and lock in one message, and it is full: the hand-over is a transaction of its own. */
  assert.deepEqual(kept.packed.map((tx) => tx.roles), [["OPEN", "DEPOSIT", "LOCK"]]);
  assert.deepEqual(handed.packed.map((tx) => tx.roles), [["OPEN", "DEPOSIT", "LOCK"], ["HANDOVER"]]);
  assert.ok(handed.packed.every((tx) => tx.bytes <= 1_232));
  /* One account more is paid for — the receiver's. */
  const more = handed.rentLamports - kept.rentLamports;
  assert.ok(more >= rentOf(170) && more <= rentOf(200), `the receiver's account: ${more} lamports`);
  /* Forty-five ranges take two messages already, and the hand-over rides in the second: no transaction more than the opening had. */
  const wideKept = await venue.positions.open(request);
  const wide = await venue.positions.open({ ...request, handOverTo: who.referral });
  assert.deepEqual(wideKept.packed.map((tx) => tx.roles), [["OPEN"], ["DEPOSIT", "LOCK"]]);
  assert.deepEqual(wide.packed.map((tx) => tx.roles), [["OPEN"], ["DEPOSIT", "LOCK", "HANDOVER"]], `packed in ${wide.packed.map((tx) => tx.bytes).join(" + ")} bytes`);
  assert.equal(await refused(() => venue.positions.open({ ...request, handOverTo: who.creator })), "BAD_INPUT", "to itself");
  assert.equal(await refused(() => venue.positions.open({ ...request, handOverTo: nftMint })), "BAD_INPUT", "to the NFT's own mint");
});

/* A dynamic config as the program keeps one: its mark, an index, the wallet it belongs to, its permissions, the partner's share. */
async function configAccount(sdk, authority, partnerFeeBps = 5_000) {
  const data = await sdk.program.coder.accounts.encode("dynamicConfig", { index: { toArrayLike: () => Buffer.alloc(8) }, padding0: { toArrayLike: () => Buffer.alloc(8) }, poolCreatorAuthority: authority, permission: { toArrayLike: () => Buffer.alloc(16) }, partnerFeeBps, padding1: Array(14).fill(0) }).catch(() => null);
  if (data) return data;
  /* The coder of a zero-copy account may ask for BNs: the same bytes by hand — 8 of the mark, then the struct as the program lays it out. */
  const mark = Buffer.from(sdk.program.idl.accounts.find((entry) => entry.name === "dynamicConfig" || entry.name === "DynamicConfig").discriminator);
  const body = Buffer.alloc(8 + 8 + 32 + 16 + 2 + 14);
  authority.toBuffer().copy(body, 16);
  body.writeUInt16LE(partnerFeeBps, 64);
  return Buffer.concat([mark, body]);
}

test("a pool from a dynamic config: the same terms at the config's own address, the config's wallet the one signer beside the payer", async () => {
  const config = Keypair.generate().publicKey;
  const authority = Keypair.generate().publicKey;
  const base = at("beforeOpening");
  const data = await configAccount(base.sdk, authority);
  const decoded = base.sdk.program.coder.accounts.decode("dynamicConfig", data);
  assert.ok(decoded.poolCreatorAuthority.equals(authority), "the account reads back as the program's dynamic config of this wallet");
  const { venue } = at("beforeOpening", { [config.toBase58()]: { owner: DLMM_PRO_PROGRAM, lamports: rentOf(data.length), data: data.toString("base64"), executable: false } });
  /* The rehearsal's second coin has no pool at this moment; the creator holds it and USDC. */
  const pair = { tokenX: addresses.coin, tokenY: addresses.usdc };
  const request = {
    wallet: who.creator,
    ...pair,
    tickSpacing: terms.tickSpacing,
    initialTickId: terms.firstTick,
    baseFee: terms.fee,
    dynamicFee: true,
    collectFee: "tokenY",
    opening: { swapAt: fixture.snapshots.beforeOpening.clock.unix + 3_600, depositor: who.creator },
    config: config.toBase58(),
    authority: authority.toBase58(),
  };
  const build = await venue.pools.buildConfigPool(request);
  const address = derivePool(config, key(pair.tokenX), key(pair.tokenY), key(DLMM_PRO_PROGRAM)).toBase58();
  assert.equal(build.pool, address);
  assert.equal(venue.pools.configPoolAddress(config.toBase58(), pair.tokenY, pair.tokenX), address, "whichever coin is named first");
  assert.notEqual(build.pool, venue.pools.launchPoolAddress(pair.tokenX, pair.tokenY), "not the pair's launch pool");
  const { signers, list } = instructionsOf(build.wireBase64);
  assert.deepEqual(signers, [who.creator, authority.toBase58()], "the payer, and the wallet the config belongs to");
  assert.deepEqual(build.cosigners, [authority.toBase58()]);
  assert.equal(build.feeLamports, 10_000, "two signatures");
  const call = list.at(-1);
  assert.equal(call.program, DLMM_PRO_PROGRAM);
  assert.ok(call.accounts.includes(config.toBase58()) && call.accounts.includes(address));
  /* The schedule is the launch pool's own: what it settles at is read off the same parameters. */
  const launch = await at("beforeOpening", { [addresses.pool]: null }).venue.pools.buildLaunchPool({ ...request });
  assert.deepEqual(build.parameters, launch.parameters);
  assert.equal(build.rentLamports, launch.rentLamports, "the same accounts are made");

  /* A config that is not there, one of another wallet, and a pair that has its pool from this config. */
  assert.equal(await refused(() => venue.pools.buildConfigPool({ ...request, config: Keypair.generate().publicKey.toBase58() })), "BAD_INPUT");
  assert.equal(await refused(() => venue.pools.buildConfigPool({ ...request, authority: who.stranger })), "BAD_INPUT");
  assert.equal(await refused(() => venue.pools.buildConfigPool({ ...request, config: addresses.pool })), "BAD_INPUT", "a pool is not a config");
  const taken = at("beforeOpening", {
    [config.toBase58()]: { owner: DLMM_PRO_PROGRAM, lamports: rentOf(data.length), data: data.toString("base64"), executable: false },
    [address]: fixture.snapshots.beforeOpening.accounts[addresses.pool],
  });
  assert.equal(await refused(() => taken.venue.pools.buildConfigPool(request)), "POOL_EXISTS");
});

test("a config's wallet that is the payer signs once", async () => {
  const config = Keypair.generate().publicKey;
  const base = at("beforeOpening");
  const data = await configAccount(base.sdk, key(who.creator));
  const { venue } = at("beforeOpening", { [config.toBase58()]: { owner: DLMM_PRO_PROGRAM, lamports: rentOf(data.length), data: data.toString("base64"), executable: false } });
  const build = await venue.pools.buildConfigPool({ wallet: who.creator, tokenX: addresses.coin, tokenY: addresses.usdc, tickSpacing: terms.tickSpacing, initialTickId: terms.firstTick, baseFee: { kind: "fixed", bps: 100 }, collectFee: "tokenY", config: config.toBase58(), authority: who.creator });
  assert.deepEqual(build.cosigners, []);
  assert.equal(build.feeLamports, 5_000);
});
