// What a person says — «buy cheaper», «sell higher» — quoted and placed by the venue, on recorded state.
//
// The state is the rehearsal's (`./fixtures/rehearsal.json.gz`): Meteora's program as deployed on mainnet, frozen with
// orders resting in the launch pool. A quote is held to the order the venue then builds from it, and the build to the
// SDK's own instruction: nothing here is a second way to place an order.
import assert from "node:assert/strict";
import test from "node:test";

import { getSqrtPriceFromTickId } from "@meteora-ag/dlmm-pro-sdk";
import { ComputeBudgetProgram, Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { readFixture, rpcConnection, snapshotSource } from "./fixture-kit.mjs";

const { createDlmmProVenue } = await import("./venue.server.ts");
const { DlmmProRefusal, DLMM_PRO_PROGRAM } = await import("./sdk.server.ts");
const { makerShareOf } = await import("./ladder.ts");
const { xForY, yForX } = await import("./orders.ts");

const fixture = readFixture(new URL("./fixtures/rehearsal.json.gz", import.meta.url));
const { who, addresses } = fixture;
const records = Object.fromEntries(Object.values(fixture.transactions).map((entry) => [entry.signature, entry.record]));
const lands = () => ({ err: null, logs: [], unitsConsumed: 0, accounts: null, returnData: null });
function at(moment, referralOwner = who.referral) {
  const connection = rpcConnection(snapshotSource(fixture.snapshots[moment], records, lands));
  return createDlmmProVenue({ connection, referralOwner });
}
const refused = (work) => work().then(() => null, (error) => (error instanceof DlmmProRefusal ? error.code : `not a refusal: ${error}`));
const sum = (list, pick) => list.reduce((total, entry) => total + BigInt(pick(entry)), 0n);
const sqrtAt = (tickId) => BigInt(getSqrtPriceFromTickId(tickId).toString());

test("«buy cheaper» is quoted as a bid ladder under the price: 25 prices, what each pays at its exact price, the bonus as one number", async () => {
  const venue = at("ordersResting");
  const model = await venue.pools.read(addresses.pool);
  const quote = await venue.orders.quote({ pool: addresses.pool, coin: addresses.coin, action: "buy", farBps: 5_000, amountRaw: "250000000" });
  assert.equal(quote.side, "bid");
  assert.deepEqual({ restsIn: quote.restsIn, paysIn: quote.paysIn }, { restsIn: addresses.usdc, paysIn: addresses.coin });
  assert.equal(quote.rungs.length, 25);
  const aligned = Math.floor(model.tickId / model.tickSpacing) * model.tickSpacing;
  assert.ok(quote.rungs.every((rung) => rung.tickId < aligned && rung.tickId % model.tickSpacing === 0));
  /* Even: every rung the same, and what the weights cannot split stays in the wallet. */
  assert.ok(quote.rungs.every((rung) => rung.amountRaw === "10000000"));
  assert.equal(quote.amountRaw, "250000000");
  /* Each rung pays the coin at its own tick's price, rounded down — the program's settlement. */
  for (const rung of quote.rungs) assert.equal(rung.paysRaw, xForY(BigInt(rung.amountRaw), sqrtAt(rung.tickId)).toString());
  assert.equal(quote.paysRaw, sum(quote.rungs, (rung) => rung.paysRaw).toString());
  /* Prices to show: the coin's, falling away from the price now; the average between the nearest and the farthest. */
  assert.ok(Math.abs(quote.price / model.price - 1) < 1e-9);
  assert.ok(quote.rungs.every((rung, index) => rung.price < quote.price && (index === 0 || rung.price < quote.rungs[index - 1].price)));
  assert.ok(quote.averagePrice < quote.rungs[0].price && quote.averagePrice > quote.rungs.at(-1).price);
  assert.ok(Math.abs(quote.farBps - 5_000) < 60 && quote.nearBps > 0 && quote.nearBps < 200, `${quote.nearBps}…${quote.farBps}`);
  assert.deepEqual({ corridorBps: quote.corridorBps, slippageTicks: quote.slippageTicks }, { corridorBps: 100, slippageTicks: 100 });
  assert.equal(quote.reachBps, 9_900);
  /* The bonus: half the pool's fee now is the makers'; a fifth of that half is Ryntra's, named before the signature. */
  assert.deepEqual(quote.bonus, { feeBps: model.fee.totalBps, ...makerShareOf(model.fee.totalBps, true), referral: who.referral, feeIn: addresses.usdc });
  assert.ok(quote.bonus.ownerBps > 0 && Math.abs(quote.bonus.ownerBps - quote.bonus.makerBps * 0.8) < 0.02);
});

test("«sell higher» is an ask ladder over the price; with nobody named the whole bonus is the person's", async () => {
  const venue = at("ordersResting");
  const quote = await venue.orders.quote({ pool: addresses.pool, coin: addresses.coin, action: "sell", nearBps: 5_000, farBps: 30_000, rungs: 6, spread: "further", amountRaw: "21000000000", referralWallet: null });
  assert.equal(quote.side, "ask");
  assert.deepEqual({ restsIn: quote.restsIn, paysIn: quote.paysIn }, { restsIn: addresses.coin, paysIn: addresses.usdc });
  assert.equal(quote.rungs.length, 6);
  /* More the farther from the price: 1 : 2 : … : 6 of 21 parts. */
  assert.deepEqual(quote.rungs.map((rung) => rung.amountRaw), [1, 2, 3, 4, 5, 6].map((weight) => String(weight * 1_000_000_000)));
  for (const rung of quote.rungs) assert.equal(rung.paysRaw, yForX(BigInt(rung.amountRaw), sqrtAt(rung.tickId)).toString());
  assert.ok(quote.rungs.every((rung) => rung.price > quote.price));
  assert.ok(quote.averagePrice > quote.rungs[0].price && quote.averagePrice < quote.rungs.at(-1).price);
  assert.equal(quote.bonus.referral, null);
  assert.equal(quote.bonus.referralBps, 0);
  assert.equal(quote.bonus.ownerBps, quote.bonus.makerBps);
  /* A venue with no referral owner names nobody either. */
  const bare = await at("ordersResting", null).orders.quote({ pool: addresses.pool, coin: addresses.coin, action: "sell", farBps: 30_000, amountRaw: "1000000000" });
  assert.equal(bare.bonus.referral, null);
});

test("where the person's coin is the pool's token Y the words stay and the side swaps", async () => {
  const venue = at("ordersResting");
  /* «Buy USDC cheaper» in this pool is selling the coin as USDC gets cheaper against it: an ask above the pool's price. */
  const quote = await venue.orders.quote({ pool: addresses.pool, coin: addresses.usdc, action: "buy", farBps: 2_000, rungs: 5, amountRaw: "5000000000" });
  assert.equal(quote.side, "ask");
  assert.deepEqual({ restsIn: quote.restsIn, paysIn: quote.paysIn }, { restsIn: addresses.coin, paysIn: addresses.usdc });
  /* The price shown is USDC's, in the coin — and every rung is cheaper than now. */
  assert.ok(quote.rungs.every((rung) => rung.price < quote.price));
  assert.ok(quote.averagePrice < quote.price);
});

test("the ladder placed is the ladder quoted: the SDK's own order, relative to the price at landing, the wallet and the fresh mint its only signers", async () => {
  const venue = at("ordersResting");
  const nftMint = Keypair.generate().publicKey.toBase58();
  const request = { pool: addresses.pool, coin: addresses.coin, action: "buy", farBps: 3_000, amountRaw: "500000000", wallet: who.maker, nftMint };
  const build = await venue.orders.placeIntent(request);
  const quote = await venue.orders.quote(request);
  assert.deepEqual(build.quote, quote, "the quote the build carries is the quote a person was shown");
  assert.equal(build.ticks.length, 25);
  assert.deepEqual(build.ticks.map((tick) => [tick.tickId, tick.amountRaw]).sort(), quote.rungs.map((rung) => [rung.tickId, rung.amountRaw]).sort());
  assert.equal(build.side, "bid");
  assert.equal(build.amountRaw, quote.amountRaw);
  assert.equal(build.referral, who.referral);
  /* Relative: a corridor of a spacing either way of the aligned price. */
  const model = await venue.pools.read(addresses.pool);
  const aligned = Math.floor(model.tickId / model.tickSpacing) * model.tickSpacing;
  assert.deepEqual(build.band, { minTickId: aligned - 100, maxTickId: aligned + 100 });
  const tx = VersionedTransaction.deserialize(Buffer.from(build.wireBase64, "base64"));
  const message = TransactionMessage.decompile(tx.message);
  assert.equal(message.payerKey.toBase58(), who.maker);
  assert.deepEqual(tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).map((entry) => entry.toBase58()).sort(), [who.maker, nftMint].sort());
  const programs = message.instructions.map((ix) => ix.programId.toBase58()).filter((program) => program !== ComputeBudgetProgram.programId.toBase58());
  assert.ok(programs.includes(DLMM_PRO_PROGRAM));
  /* 25 prices fit one transaction, with room under the network's size. */
  assert.ok(build.bytes <= 1_232, String(build.bytes));
  /* The rent told: the order's own, returned at closing — head, NFT, and 25 entries with their ticks. */
  assert.ok(build.rentLamports > 25 * 900_000 && build.rentLamports < 40_000_000, String(build.rentLamports));
  /* Fixed ticks where the caller asks for them — as before a pool opens. */
  const fixed = await venue.orders.placeIntent({ ...request, corridorBps: null });
  assert.equal(fixed.band, null);
  assert.equal(fixed.quote.slippageTicks, null);
});

test("what cannot be placed as asked is refused before anything is built", async () => {
  const venue = at("ordersResting");
  const base = { pool: addresses.pool, coin: addresses.coin, action: "buy", farBps: 2_000, amountRaw: "1000000" };
  assert.equal(await refused(() => venue.orders.quote({ ...base, coin: who.stranger })), "BAD_INPUT");
  assert.equal(await refused(() => venue.orders.quote({ ...base, farBps: 10_000 })), "BAD_INPUT");
  assert.equal(await refused(() => venue.orders.quote({ ...base, action: "hold" })), "BAD_INPUT");
  assert.equal(await refused(() => venue.orders.quote({ ...base, rungs: 26 })), "BAD_INPUT");
  assert.equal(await refused(() => venue.orders.quote({ ...base, amountRaw: "0" })), "AMOUNT_ZERO");
  /* An amount too small to put an atom on every rung. */
  assert.equal(await refused(() => venue.orders.quote({ ...base, amountRaw: "10" })), "BAD_INPUT");
  /* A wallet that does not hold what the ladder rests. */
  assert.equal(await refused(() => venue.orders.placeIntent({ ...base, amountRaw: "900000000000000", wallet: who.maker, nftMint: Keypair.generate().publicKey.toBase58() })), "BALANCE_LOW");
});

test("a collector named in the placing: approved for nothing, given the one permission, in the same transaction — 25 prices still fit", async () => {
  const venue = at("ordersResting");
  const nftMint = Keypair.generate().publicKey.toBase58();
  const request = { pool: addresses.pool, coin: addresses.coin, action: "buy", farBps: 5_000, amountRaw: "500000000", wallet: who.maker, nftMint };
  const bare = await venue.orders.placeIntent(request);
  const build = await venue.orders.placeIntent({ ...request, delegate: who.agent });
  assert.equal(bare.delegate, null);
  assert.equal(build.delegate, who.agent);
  assert.equal(build.ticks.length, 25);
  assert.ok(build.bytes <= 1_232 && build.bytes > bare.bytes, `${bare.bytes} → ${build.bytes}`);
  const message = TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(build.wireBase64, "base64")).message);
  const own = message.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  const before = TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(bare.wireBase64, "base64")).message).instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  /* Two more instructions, after the order's own: Token-2022's approve of amount 0 on the NFT's account, and the program's permission. */
  assert.equal(own.length, before.length + 2);
  const [approve, permission] = own.slice(-2);
  assert.equal(approve.programId.toBase58(), "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  assert.deepEqual(approve.keys.map((key) => key.pubkey.toBase58()), [build.nftAccount, who.agent, who.maker]);
  assert.deepEqual([...approve.data], [4, 0, 0, 0, 0, 0, 0, 0, 0], "approve, amount 0: a delegated amount would let the NFT be moved");
  assert.equal(permission.programId.toBase58(), DLMM_PRO_PROGRAM);
  assert.equal(Buffer.from(permission.data).subarray(0, 8).toString("hex"), "1876e3cbe1d21816", "update_limit_order_delegate_permission");
  assert.equal(Buffer.from(permission.data).readUInt32LE(8), 1, "the one permission there is: collect");
  /* The signers do not change: the wallet and the fresh mint. */
  const tx = VersionedTransaction.deserialize(Buffer.from(build.wireBase64, "base64"));
  assert.equal(tx.message.header.numRequiredSignatures, 2);
  assert.equal(await refused(() => venue.orders.placeIntent({ ...request, delegate: who.maker })), "BAD_INPUT");
});
