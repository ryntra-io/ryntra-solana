// What a collector's key may sign, and which orders it is let to collect — on recorded state.
//
// The state is the rehearsal's (`./fixtures/rehearsal.json.gz`). The judge's own knowledge of the program — one
// discriminator, a dozen account places — is held to the IDL; the bytes it reads are the venue's own collect, and the
// transaction the rehearsal's agent really sent on the program's mainnet build.
import assert from "node:assert/strict";
import test from "node:test";

import { DlmmProIDL, deriveLimitOrder, findNftAccount } from "@meteora-ag/dlmm-pro-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { readFixture, rpcConnection, snapshotSource } from "./fixture-kit.mjs";

const { CANCEL_ACCOUNTS, CANCEL_LIMIT_ORDER_DISCRIMINATOR, COLLECTOR_MAX_PRIORITY_LAMPORTS, COLLECTOR_MAX_UNITS, collectorRefusal } = await import("./collector.ts");
const { createDlmmProVenue } = await import("./venue.server.ts");
const { closedTokenAccounts } = await import("./limit-orders.server.ts");
const { DLMM_PRO_PROGRAM } = await import("./sdk.server.ts");
const { transactionResponseOf } = await import("../../../solana/v1-tx.ts");

const fixture = readFixture(new URL("./fixtures/rehearsal.json.gz", import.meta.url));
const { who, addresses } = fixture;
const key = (address) => new PublicKey(address);
const lands = () => ({ err: null, logs: [], unitsConsumed: 0, accounts: null, returnData: null });
const NFT = findNftAccount(key(addresses.bids), key(who.maker)).toBase58();
const ORDER = deriveLimitOrder(key(addresses.bids), key(DLMM_PRO_PROGRAM)).toBase58();

const ata = (mint, owner, program) => getAssociatedTokenAddressSync(key(mint), key(owner), true, program).toBase58();
const MAKER_COIN = ata(addresses.coin, who.maker, TOKEN_2022_PROGRAM_ID);
/**
 * The moment the bids were filled and the holder had let the agent collect — the approval on the NFT's account and the
 * order's bit, either changed here for what the program would not take — with the holder's own account of the coin it
 * is paid in standing: in the rehearsal the agent opened it, which a collector does not.
 */
function delegated(to = who.agent, amount = 0n, permission = 1) {
  const snapshot = fixture.snapshots.bidsFilled;
  const coin = Buffer.from(snapshot.accounts[ata(addresses.coin, who.buyer, TOKEN_2022_PROGRAM_ID)].data, "base64");
  key(who.maker).toBuffer().copy(coin, 32);
  coin.writeBigUInt64LE(0n, 64);
  const nft = Buffer.from(snapshot.accounts[NFT].data, "base64");
  nft.writeUInt32LE(1, 72);
  key(to).toBuffer().copy(nft, 76);
  nft.writeBigUInt64LE(amount, 121);
  const order = Buffer.from(snapshot.accounts[ORDER].data, "base64");
  order.writeUInt32LE(permission, 104);
  const accounts = { ...snapshot.accounts, [MAKER_COIN]: { ...snapshot.accounts[ata(addresses.coin, who.buyer, TOKEN_2022_PROGRAM_ID)], data: coin.toString("base64") }, [NFT]: { ...snapshot.accounts[NFT], data: nft.toString("base64") }, [ORDER]: { ...snapshot.accounts[ORDER], data: order.toString("base64") } };
  return createDlmmProVenue({ connection: rpcConnection(snapshotSource({ ...snapshot, accounts }, {}, lands)), referralOwner: who.referral });
}
const FACTS = {
  program: DLMM_PRO_PROGRAM,
  collector: who.agent,
  owner: who.maker,
  pool: addresses.pool,
  order: ORDER,
  nftAccount: NFT,
  tokenX: { mint: addresses.coin, program: TOKEN_2022_PROGRAM_ID.toBase58() },
  tokenY: { mint: addresses.usdc, program: TOKEN_PROGRAM_ID.toBase58() },
  referralAccounts: [addresses.referralAccount],
};
/** A build's bytes with its instructions changed — the same payer and blockhash. */
function changed(wireBase64, change) {
  const message = TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64")).message);
  const next = new TransactionMessage({ payerKey: message.payerKey, recentBlockhash: message.recentBlockhash, instructions: change(message.instructions.map((ix) => ({ programId: ix.programId, keys: ix.keys.map((meta) => ({ ...meta })), data: Buffer.from(ix.data) }))) });
  return Buffer.from(new VersionedTransaction(next.compileToV0Message()).serialize()).toString("base64");
}
const at = (moment) => createDlmmProVenue({ connection: rpcConnection(snapshotSource(fixture.snapshots[moment], {}, lands)), referralOwner: who.referral });
const programCall = (instructions) => instructions.find((ix) => ix.programId.toBase58() === DLMM_PRO_PROGRAM);

test("the judge's places are the program's own: the IDL's discriminator and accounts of `cancel_limit_order`", () => {
  const ix = DlmmProIDL.instructions.find((entry) => entry.name === "cancel_limit_order");
  assert.equal(Buffer.from(ix.discriminator).toString("hex"), CANCEL_LIMIT_ORDER_DISCRIMINATOR);
  const names = ix.accounts.map((account) => account.name);
  assert.equal(names.length, CANCEL_ACCOUNTS.fixed);
  assert.deepEqual(
    { pool: names.indexOf("pool"), tokenXMint: names.indexOf("token_x_mint"), tokenYMint: names.indexOf("token_y_mint"), limitOrder: names.indexOf("limit_order"), nftAccount: names.indexOf("nft_account"), userTokenX: names.indexOf("user_token_x"), userTokenY: names.indexOf("user_token_y"), referralToken: names.indexOf("referral_token"), signer: names.indexOf("signer"), tokenXProgram: names.indexOf("token_x_program"), tokenYProgram: names.indexOf("token_y_program"), fixed: names.length },
    { ...CANCEL_ACCOUNTS },
  );
  assert.ok(ix.accounts[CANCEL_ACCOUNTS.signer].signer && ix.accounts[CANCEL_ACCOUNTS.referralToken].optional);
});

test("the orders a collector is let to collect are found from the chain: the permission bit, the approval of nothing, the referral", async () => {
  const venue = delegated();
  assert.deepEqual(await venue.holdings.ofCollector(who.agent), [{ nftMint: addresses.bids, pool: addresses.pool, owner: who.maker }]);
  assert.deepEqual(await venue.holdings.ofCollector(who.agent, { referral: who.referral }), [{ nftMint: addresses.bids, pool: addresses.pool, owner: who.maker }], "the bids name Ryntra's referral");
  assert.deepEqual(await venue.holdings.ofCollector(who.agent, { referral: who.stranger }), []);
  assert.deepEqual(await venue.holdings.ofCollector(who.stranger), [], "another wallet is nobody's collector");
  assert.deepEqual(await venue.holdings.ofCollector(who.agent, { limit: 0 }), []);
  /* An approval with an amount is not one the program takes; a bit without the approval, or an approval without the bit, lets nobody in. */
  assert.deepEqual(await delegated(who.agent, 1n).holdings.ofCollector(who.agent), []);
  assert.deepEqual(await delegated(who.agent, 0n, 0).holdings.ofCollector(who.agent), []);
  assert.deepEqual(await delegated(who.stranger).holdings.ofCollector(who.agent), []);
  /* Before the holder let anyone in, nothing is found. */
  const bare = createDlmmProVenue({ connection: rpcConnection(snapshotSource(fixture.snapshots.ordersResting, {}, lands)), referralOwner: who.referral });
  assert.deepEqual(await bare.holdings.ofCollector(who.agent), []);
});

test("the venue's own collect by the collector is signed: one call, the holder's accounts, the order's referral — and nothing else", async () => {
  const venue = delegated();
  const view = await venue.orders.read({ pool: addresses.pool, nftMint: addresses.bids });
  const filled = view.ticks.filter((tick) => tick.state === "filled").map((tick) => tick.tickId);
  assert.ok(filled.length > 0);
  const request = { pool: addresses.pool, nftMint: addresses.bids, owner: who.maker, signer: who.agent, tickIds: filled };
  /* Where the holder's accounts stand the SDK opens none either: the two builds are one. Where one is missing it would — see the last two tests. */
  const build = await venue.orders.collect({ ...request, opensNothing: true });
  assert.equal(collectorRefusal((await venue.orders.collect(request)).wireBase64, FACTS), null);
  assert.equal(build.referral.account, addresses.referralAccount);
  assert.deepEqual([build.rentLamports, build.rentReturnedLamports], [0, 0], "a collect that opens nothing costs its fee alone");
  assert.equal(collectorRefusal(build.wireBase64, FACTS), null);
  /* The same collect with no referral told is refused; the collect built without one passes with none told. */
  assert.match(collectorRefusal(build.wireBase64, { ...FACTS, referralAccounts: [] }), /referral it was not told/);
  const none = changed(build.wireBase64, (instructions) => {
    programCall(instructions).keys[CANCEL_ACCOUNTS.referralToken] = { pubkey: key(DLMM_PRO_PROGRAM), isSigner: false, isWritable: false };
    return instructions;
  });
  assert.equal(collectorRefusal(none, { ...FACTS, referralAccounts: [] }), null);

  /* Every way the bytes could be something else. */
  const refusedAs = (reason, wire, facts = FACTS) => assert.match(collectorRefusal(wire, facts) ?? "signed", reason);
  refusedAs(/not a transaction/, "AAAA");
  refusedAs(/does not pay/, build.wireBase64, { ...FACTS, collector: who.stranger });
  refusedAs(/another order/, build.wireBase64, { ...FACTS, order: who.stranger });
  refusedAs(/another order/, build.wireBase64, { ...FACTS, pool: addresses.poolB });
  refusedAs(/holder's own accounts/, build.wireBase64, { ...FACTS, owner: who.stranger });
  refusedAs(/other coins/, build.wireBase64, { ...FACTS, tokenX: { ...FACTS.tokenX, mint: addresses.coinB } });
  const agentUsdc = getAssociatedTokenAddressSync(key(addresses.usdc), key(who.agent), true, TOKEN_PROGRAM_ID);
  refusedAs(/holder's own accounts/, changed(build.wireBase64, (instructions) => {
    programCall(instructions).keys[CANCEL_ACCOUNTS.userTokenY].pubkey = agentUsdc;
    return instructions;
  }));
  refusedAs(/referral it was not told/, changed(build.wireBase64, (instructions) => {
    programCall(instructions).keys[CANCEL_ACCOUNTS.referralToken].pubkey = agentUsdc;
    return instructions;
  }));
  refusedAs(/not a collect/, changed(build.wireBase64, (instructions) => {
    programCall(instructions).data.writeUInt8(0, 0);
    return instructions;
  }));
  refusedAs(/More than one call/, changed(build.wireBase64, (instructions) => [...instructions, programCall(instructions)]));
  refusedAs(/calls the program and nothing else/, changed(build.wireBase64, (instructions) => [...instructions, SystemProgram.transfer({ fromPubkey: key(who.agent), toPubkey: key(who.stranger), lamports: 1 })]));
  /* An account opened on the collector's rent — the way to have its lamports spent. */
  refusedAs(/calls the program and nothing else/, changed(build.wireBase64, (instructions) => [createAssociatedTokenAccountIdempotentInstruction(key(who.agent), agentUsdc, key(who.agent), key(addresses.usdc), TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID), ...instructions]));
  refusedAs(/does not collect/, changed(build.wireBase64, (instructions) => instructions.filter((ix) => ix.programId.toBase58() !== DLMM_PRO_PROGRAM)));
  refusedAs(/compute limit/, changed(build.wireBase64, (instructions) => instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId))));
  refusedAs(/compute limit/, changed(build.wireBase64, (instructions) => [ComputeBudgetProgram.setComputeUnitLimit({ units: COLLECTOR_MAX_UNITS + 1 }), ...instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId))]));
  refusedAs(/priority fee/, changed(build.wireBase64, (instructions) => [...instructions, ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 })]));
  assert.equal(collectorRefusal(changed(build.wireBase64, (instructions) => [...instructions, ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 })]), FACTS), null, "a priority price under the ceiling");
  assert.ok(COLLECTOR_MAX_PRIORITY_LAMPORTS <= 20_000);
  refusedAs(/does not take/, changed(build.wireBase64, (instructions) => [...instructions, ComputeBudgetProgram.requestHeapFrame({ bytes: 64 * 1024 })]));
  /* The collector's key anywhere else in the call — among a coin's transfer-hook accounts, say — is refused. */
  refusedAs(/only its signature should be/, changed(build.wireBase64, (instructions) => {
    programCall(instructions).keys.push({ pubkey: key(who.agent), isSigner: false, isWritable: false });
    return instructions;
  }));
  /* The holder signing beside the collector: not the collector's to sign. */
  refusedAs(/only signer/, changed(build.wireBase64, (instructions) => {
    programCall(instructions).keys[CANCEL_ACCOUNTS.userTokenX].isSigner = true;
    return instructions;
  }));
});

test("the collect the rehearsal's agent sent opened the holder an account on the agent's rent: the judge does not sign that", () => {
  const sent = transactionResponseOf(fixture.transactions.collectBidsByAgent.record);
  const wire = Buffer.from(new VersionedTransaction(sent.transaction.message).serialize()).toString("base64");
  assert.match(collectorRefusal(wire, FACTS) ?? "signed", /calls the program and nothing else/);
  /* 0,001514 SOL of the agent's went into the holder's coin account in that transaction: what the judge keeps the key from. */
  const { meta } = fixture.transactions.collectBidsByAgent.record;
  assert.ok(meta.preBalances[0] - meta.postBalances[0] - meta.fee > 1_000_000);
});

test("a holder with no account for what is collected is not opened one on the collector's rent: the build is refused", async () => {
  /* As the rehearsal left it: the bids filled, the agent let in, and the holder with no account of the coin yet. */
  assert.equal(fixture.snapshots.bidsFilled.accounts[MAKER_COIN], undefined);
  const venue = createDlmmProVenue({ connection: rpcConnection(snapshotSource(fixture.snapshots.bidsFilled, {}, lands)), referralOwner: who.referral });
  const request = { pool: addresses.pool, nftMint: addresses.bids, owner: who.maker, signer: who.agent };
  await assert.rejects(() => venue.orders.collect({ ...request, opensNothing: true }), (error) => error.code === "BAD_INPUT" && /the holder opens it/.test(error.message));
  /* The holder itself may still collect, opening its own account on its own rent. */
  const own = await venue.orders.collect({ pool: addresses.pool, nftMint: addresses.bids, owner: who.maker });
  assert.ok(own.rentLamports > 0);
});

test("the judge's facts come from the chain, not from the build: the order, the holder's NFT account, the coins, the order's own referral", async () => {
  const venue = delegated();
  const facts = await venue.orders.collectorFacts({ pool: addresses.pool, nftMint: addresses.bids, owner: who.maker, collector: who.agent });
  assert.deepEqual(facts, { ...FACTS, referralAccounts: [ata(addresses.coin, who.referral, TOKEN_2022_PROGRAM_ID), addresses.referralAccount] });
  assert.equal(addresses.referralAccount, ata(addresses.usdc, who.referral, TOKEN_PROGRAM_ID));
  /* The asks named nobody: a collect of them may pay no referral at all. */
  const asks = await at("ordersResting").orders.collectorFacts({ pool: addresses.pool, nftMint: addresses.asks, owner: who.buyer, collector: who.agent });
  assert.deepEqual(asks.referralAccounts, []);
  assert.equal(await venue.orders.collectorOf({ nftMint: addresses.bids, owner: who.maker }), who.agent);
  assert.equal(await delegated(who.agent, 1n).orders.collectorOf({ nftMint: addresses.bids, owner: who.maker }), null);
  assert.equal(await delegated(who.agent, 0n, 0).orders.collectorOf({ nftMint: addresses.bids, owner: who.maker }), null);
  assert.equal(await at("ordersResting").orders.collectorOf({ nftMint: addresses.bids, owner: who.maker }), null);
  assert.equal(await venue.orders.collectorOf({ nftMint: addresses.bids, owner: who.stranger }), null);
});

test("the holder opens its own accounts of the pool's coins where they are missing — and only those", async () => {
  /* The maker rested USDC and has no account of the coin yet. */
  const venue = at("bidsFilled");
  const build = await venue.orders.prepare({ pool: addresses.pool, owner: who.maker });
  const message = TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(build.wireBase64, "base64")).message);
  const opens = message.instructions.filter((ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
  assert.equal(opens.length, 1);
  assert.deepEqual(opens[0].keys.slice(0, 4).map((meta) => meta.pubkey.toBase58()), [who.maker, MAKER_COIN, who.maker, addresses.coin]);
  assert.equal(message.payerKey.toBase58(), who.maker);
  assert.ok(build.rentLamports > 1_000_000 && build.rentReturnedLamports === 0, String(build.rentLamports));
  /* Both stand: nothing to sign. */
  assert.equal(await delegated().orders.prepare({ pool: addresses.pool, owner: who.maker }), null);
  /* Unless a transaction before it in the same approval closes one: then it is opened again, after it. */
  const usdc = ata(addresses.usdc, who.maker, TOKEN_PROGRAM_ID);
  const closing = new TransactionMessage({ payerKey: key(who.maker), recentBlockhash: PublicKey.default.toBase58(), instructions: [createCloseAccountInstruction(key(usdc), key(who.maker), key(who.maker), [], TOKEN_PROGRAM_ID)] }).compileToV0Message();
  const wire = Buffer.from(new VersionedTransaction(closing).serialize()).toString("base64");
  assert.deepEqual(closedTokenAccounts(wire), [usdc]);
  const again = await delegated().orders.prepare({ pool: addresses.pool, owner: who.maker, after: [wire] });
  const reopened = TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(again.wireBase64, "base64")).message).instructions.filter((ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
  assert.deepEqual(reopened.map((ix) => ix.keys[1].pubkey.toBase58()), [usdc]);
  assert.deepEqual([...reopened[0].data], [1], "create-idempotent: it stands or it is made, never refused");
  /* A build before it that opens the coin's account and closes USDC's — as the person's own collect does where the account is missing: the coin's stands, USDC's is opened again, nothing is refused. */
  const opensCoin = new TransactionMessage({ payerKey: key(who.maker), recentBlockhash: PublicKey.default.toBase58(), instructions: [createAssociatedTokenAccountIdempotentInstruction(key(who.maker), key(MAKER_COIN), key(who.maker), key(addresses.coin), TOKEN_2022_PROGRAM_ID), createCloseAccountInstruction(key(usdc), key(who.maker), key(who.maker), [], TOKEN_PROGRAM_ID)] }).compileToV0Message();
  const opensWire = Buffer.from(new VersionedTransaction(opensCoin).serialize()).toString("base64");
  const afterOpen = await at("bidsFilled").orders.prepare({ pool: addresses.pool, owner: who.maker, after: [opensWire] });
  const madeAfter = TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(afterOpen.wireBase64, "base64")).message).instructions.filter((ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
  assert.deepEqual(madeAfter.map((ix) => ix.keys[1].pubkey.toBase58()), [usdc]);
  /* An account on the chain that no build before touches and that refuses to be paid into — frozen — is still refused. */
  const frozen = createDlmmProVenue({ connection: rpcConnection(snapshotSource((() => {
    const snapshot = fixture.snapshots.bidsFilled;
    const data = Buffer.from(snapshot.accounts[usdc].data, "base64");
    data.writeUInt8(2, 108);
    return { ...snapshot, accounts: { ...snapshot.accounts, [usdc]: { ...snapshot.accounts[usdc], data: data.toString("base64") } } };
  })(), {}, lands)), referralOwner: who.referral });
  await assert.rejects(() => frozen.orders.prepare({ pool: addresses.pool, owner: who.maker }), (error) => error.code === "BAD_INPUT" && /cannot be paid into/.test(error.message));
  /* Whether the agent can collect: let in and both accounts standing. */
  assert.equal(await delegated().orders.accountsReady({ pool: addresses.pool, owner: who.maker }), true);
  assert.equal(await venue.orders.accountsReady({ pool: addresses.pool, owner: who.maker }), false);
});
