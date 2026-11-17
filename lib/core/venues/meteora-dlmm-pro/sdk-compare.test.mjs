// The DLMM Pro venue beside the SDK it wraps, on recorded state, with no network.
//
// The state is the rehearsal's (`scripts/launch-qa/dlmm-pro-rehearsal.mjs`): Meteora's program as deployed on mainnet,
// run in a local SVM through a whole launch, frozen at six moments, with the transactions that landed between them.
// Every read here goes through a connection that answers only from one of those moments and throws on anything else.
//
// What is held: a pool is read whole and equal to the SDK's own read; the fee the venue says a swap would pay is the
// fee the SDK's quote charges; a quote is the SDK's quote; every build is the SDK's own instructions with a compute
// budget in front and nothing else — the wallet the only signer but for a fresh NFT mint; the fills the venue reads
// off a tick are what the chain then paid; the events decode to what happened.
import assert from "node:assert/strict";
import test from "node:test";

import {
  AccessRegistryIDL,
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  DlmmProClient,
  DlmmProIDL,
  StrategyType,
  amountsFromShape,
  buildLiquidityShape,
  derivePosition,
  deriveTickArrayBitmapExtension,
  deriveTokenBadge,
  encodeAddLiquidityByWeight,
  encodePoolExtensions,
  getAmountsFromLiquidity,
  getBaseFeeNumerator,
  getDynamicFeeParams,
  getSqrtPriceFromTickId,
  liquidityBitmap,
  multiplierFromAmounts,
  tickIdFromSqrtPrice,
  timeSchedulerBaseFeeParameters,
} from "@meteora-ag/dlmm-pro-sdk";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";

import { CLOCK_SYSVAR, clockAccount, readFixture, rentOf, rpcConnection, snapshotSource as frozen } from "./fixture-kit.mjs";

const { createDlmmProVenue } = await import("./venue.server.ts");
const { DLMM_PRO_ACCOUNT_BYTES: SIZES, decodePoolAccount, mintExtensionTypes, poolDiscriminator, tokenAccountBytesOf } = await import("./pools.server.ts");
const { isqrt } = await import("./ticks.ts");
const { DlmmProRefusal, DLMM_PRO_ACCESS_REGISTRY, DLMM_PRO_PROGRAM } = await import("./sdk.server.ts");
const { MAX_SHAPE_COLUMNS, shapeOf } = await import("./shapes.server.ts");
const { LAMPORTS_PER_SIGNATURE, MAX_PRIORITY_FEE_LAMPORTS, MAX_TX_BYTES, DLMM_PRO_UNITS, seal, sealPacked } = await import("./tx.server.ts");
const { decodeDlmmProEvents, eventsNamed } = await import("./events.server.ts");

const fixture = readFixture(new URL("./fixtures/rehearsal.json.gz", import.meta.url));
const { who, addresses, terms, facts } = fixture;
const records = Object.fromEntries(Object.values(fixture.transactions).map((entry) => [entry.signature, entry.record]));
const KNOWN = new Set(["getAccountInfo", "getMultipleAccounts", "getLatestBlockhash", "getBalance", "getProgramAccounts", "getTokenAccountsByOwner", "getTransaction", "getMinimumBalanceForRentExemption", "simulateTransaction"]);
/*
 * A frozen moment executes nothing, so what its node answers a simulation with is said here: the build lands — unless a
 * test gives the moment another answer. Whether the venue reads a real simulation rightly is the rehearsal's to show:
 * there the program itself refuses a collect whose referral takes no transfer, and the venue builds it without.
 */
const lands = () => ({ err: null, logs: [], unitsConsumed: 0, accounts: null, returnData: null });
const doesNotLand = () => ({ err: { InstructionError: [1, { Custom: 36 }] }, logs: ["Program log: Error: No memo in previous instruction; required for recipient to receive a transfer"], unitsConsumed: 0, accounts: null, returnData: null });
const snapshotSource = (snapshot, transactions, simulate = lands) => frozen(snapshot, transactions, simulate);

/** The venue and the bare SDK on one frozen moment. */
function at(moment, referralOwner = who.referral) {
  const connection = rpcConnection(snapshotSource(fixture.snapshots[moment], records));
  return { connection, venue: createDlmmProVenue({ connection, referralOwner }), sdk: new DlmmProClient(connection), clock: fixture.snapshots[moment].clock };
}
const key = (address) => new PublicKey(address);
/**
 * A moment with one pool's head changed — a pool the chain could hold and the rehearsal did not make. The head is
 * decoded and encoded again by the program's own coder; the tail of its extensions is kept as it was.
 */
async function withPool(moment, address, change) {
  const snapshot = fixture.snapshots[moment];
  const entry = snapshot.accounts[address];
  const data = Buffer.from(entry.data, "base64");
  const coder = new DlmmProClient(rpcConnection(snapshotSource(snapshot, records))).program.coder.accounts;
  const head = await coder.encode("pool", coder.decode("pool", data));
  assert.deepEqual(head, data.subarray(0, head.length), "the head encodes back to its own bytes");
  const changed = await coder.encode("pool", change(coder.decode("pool", data)));
  const next = { ...snapshot, accounts: { ...snapshot.accounts, [address]: { ...entry, data: Buffer.concat([changed, data.subarray(head.length)]).toString("base64") } } };
  const connection = rpcConnection(snapshotSource(next, records));
  return { connection, venue: createDlmmProVenue({ connection, referralOwner: who.referral }) };
}
const refused = (work) => work().then(() => null, (error) => (error instanceof DlmmProRefusal ? error.code : `not a refusal: ${error}`));
/** A moment with accounts put in, changed or taken out — `null` takes one out. */
function withAccounts(moment, changes, referralOwner = who.referral) {
  const snapshot = fixture.snapshots[moment];
  const accounts = { ...snapshot.accounts };
  for (const [address, entry] of Object.entries(changes)) {
    if (entry === null) delete accounts[address];
    else accounts[address] = { ...(accounts[address] ?? {}), ...entry };
  }
  const connection = rpcConnection(snapshotSource({ ...snapshot, accounts }, records));
  return { connection, venue: createDlmmProVenue({ connection, referralOwner }), sdk: new DlmmProClient(connection) };
}
/** Lamports at an address nobody's account lives at: what anybody can leave anywhere. */
const dust = (lamports = 1_000_000) => ({ owner: SystemProgram.programId.toBase58(), lamports, data: "" });
const RENT_PER_BYTE = rentOf(1) - rentOf(0);
/** A recorded transaction's accounts by what the payer was charged for each: bytes of those it made, and bytes it paid for in those that were there. */
function chargedIn(name) {
  const { meta } = fixture.transactions[name].record;
  const others = meta.postBalances.map((post, index) => ({ pre: meta.preBalances[index], post })).slice(1);
  return {
    fee: meta.fee,
    rent: meta.preBalances[0] - meta.postBalances[0] - meta.fee,
    made: others.filter((entry) => entry.pre === 0 && entry.post > 0).map((entry) => entry.post / RENT_PER_BYTE - 128),
    grown: others.filter((entry) => entry.pre > 0 && entry.post > entry.pre).map((entry) => (entry.post - entry.pre) / RENT_PER_BYTE),
  };
}
const sum = (list) => list.reduce((total, value) => total + value, 0);
const plain = (value) => JSON.parse(JSON.stringify(value, (_, inner) => (typeof inner === "bigint" ? inner.toString() : inner)));
const COMPUTE_BUDGET = ComputeBudgetProgram.programId.toBase58();
/** A fifth, rounded down: within one unit a part of the whole. */
const isFifth = (part, whole) => { const gap = BigInt(whole) - BigInt(part) * 5n; return gap >= 0n && gap < 5n; };

/** A build's instructions as plain data — its compute budget apart — and its signers. */
function opened(build) {
  const tx = VersionedTransaction.deserialize(Buffer.from(build.wireBase64, "base64"));
  const message = TransactionMessage.decompile(tx.message);
  const all = message.instructions.map((ix) => ({ program: ix.programId.toBase58(), keys: ix.keys.map((meta) => meta.pubkey.toBase58()), data: Buffer.from(ix.data).toString("hex") }));
  return {
    payer: message.payerKey.toBase58(),
    signers: tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).map((entry) => entry.toBase58()),
    budget: all.filter((ix) => ix.program === COMPUTE_BUDGET),
    instructions: all.filter((ix) => ix.program !== COMPUTE_BUDGET),
    version: tx.message.version,
    bytes: tx.serialize().length,
  };
}
const ofSdk = (tx) => tx.instructions.map((ix) => ({ program: ix.programId.toBase58(), keys: ix.keys.map((meta) => meta.pubkey.toBase58()), data: Buffer.from(ix.data).toString("hex") }));
/** Every build: version 0, the wallet pays, a compute limit first, within a message. */
function assertSealed(build, wallet, cosigners = []) {
  const read = opened(build);
  assert.equal(read.version, 0);
  assert.equal(read.payer, wallet);
  assert.deepEqual(read.signers, [wallet, ...cosigners], "the wallet signs, and with it only a key made for this build");
  assert.deepEqual(build.cosigners, cosigners);
  assert.equal(read.budget.length, 1, "one compute-budget instruction: the limit");
  assert.equal(Buffer.from(read.budget[0].data, "hex").readUInt32LE(1), build.units);
  assert.equal(build.bytes, read.bytes);
  assert.ok(build.bytes <= MAX_TX_BYTES);
  assert.equal(build.network, "solana");
  return read;
}

test("a pool is read whole — head and the tail of its extensions — and equal to the SDK's own read", async () => {
  const { venue, sdk, connection } = at("rewardsRunning");
  for (const [address, tail] of [[addresses.pool, "activation"], [addresses.poolB, "rewards"]]) {
    const info = await connection.getAccountInfo(key(address));
    const whole = decodePoolAccount(sdk, Buffer.from(info.data));
    assert.deepEqual(plain(whole), plain(await sdk.state.fetchPoolWithExtensions(key(address))));
    assert.ok(whole.extensions[tail], `${address} keeps its ${tail} in the tail`);
    /* The head alone decodes too — and says nothing of the tail: why the venue never reads a pool that way. */
    assert.deepEqual(plain(await sdk.state.fetchPool(key(address))), plain(whole.pool));
  }
  assert.equal(poolDiscriminator(), "hQrXeCntzbV", "the pool discriminator f19a6d0411b16dbc, base58");
  const listed = await venue.pools.list();
  assert.deepEqual(listed.map((pool) => pool.address).sort(), [addresses.pool, addresses.poolB].sort());
  assert.deepEqual((await venue.pools.list({ mint: addresses.coinB })).map((pool) => pool.address), [addresses.poolB]);
  assert.deepEqual((await venue.pools.list({ mint: addresses.usdc })).map((pool) => pool.address).sort(), [addresses.pool, addresses.poolB].sort(), "a coin is found on either side of a pair");
  assert.equal(await venue.pools.read(who.creator), null, "an address that is not a pool reads as none");
  assert.equal(venue.pools.launchPoolAddress(addresses.coin, addresses.usdc), addresses.pool);
  assert.equal(venue.pools.launchPoolAddress(addresses.usdc, addresses.coin), addresses.pool, "whichever coin is named first");
  assert.ok(connection.asked.every((method) => KNOWN.has(method)), [...new Set(connection.asked)].join());
});

test("the model of a launch pool before it opens: its schedule, its rules, who may act", async () => {
  const { venue } = at("beforeOpening");
  const pool = await venue.pools.read(addresses.pool, who.stranger);
  assert.equal(pool.kind, "launch");
  assert.equal(pool.partner, null, "a launch pool has no partner");
  assert.equal(pool.creator, who.creator);
  assert.deepEqual(pool.extensions, { liquidityMining: false, activationAccess: true });
  assert.deepEqual({ x: pool.tokenX.mint, xProgram: pool.tokenX.program, y: pool.tokenY.mint, yProgram: pool.tokenY.program }, { x: addresses.coin, xProgram: "token-2022", y: addresses.usdc, yProgram: "spl-token" });
  assert.equal(pool.tickSpacing, terms.tickSpacing);
  assert.equal(pool.tickId, terms.firstTick);
  assert.ok(Math.abs(pool.price - 0.000005) / 0.000005 < 0.01, String(pool.price));
  assert.equal(pool.unit, "timestamp");
  assert.equal(pool.activationPoint, terms.opensAt);
  assert.deepEqual(pool.rules, {
    whitelistedSwap: null,
    whitelistedAddLiquidity: who.creator,
    whitelistedRemoveLiquidity: null,
    slots: [{ mode: "open" }, { mode: "timeBased", swapPoint: terms.opensAt, addLiquidityPoint: terms.opensAt, removeLiquidityPoint: terms.opensAt }],
  });
  assert.deepEqual(pool.open.swap, { open: false, reason: "time", opensAt: terms.opensAt });
  assert.deepEqual(pool.open.addLiquidity, { open: false, reason: "time", opensAt: terms.opensAt });
  assert.deepEqual((await venue.pools.read(addresses.pool, who.creator)).open.addLiquidity, { open: true, reason: "whitelisted", opensAt: terms.opensAt });
  /* The schedule: 50 % at the first price, 1 % at four times it or a day after the opening; a fifth to the protocol. */
  assert.equal(pool.fee.mode, "marketCapExponential");
  assert.equal(pool.fee.startBps, 5_000);
  assert.ok(pool.fee.endBps >= 100 && pool.fee.endBps < 101, String(pool.fee.endBps));
  assert.equal(pool.fee.periods, 60);
  assert.equal(pool.fee.collectedIn, "tokenY");
  assert.equal(pool.fee.protocolShareBps, 2_000);
  /* A market cap schedule still charges by the price at the last point of its day, and settles on the next: the SDK's own scheduler says so. */
  assert.equal(pool.fee.settles.atPoint, terms.opensAt + 86_400 + 1);
  {
    const raw = (await at("beforeOpening").sdk.state.fetchPoolWithExtensions(key(addresses.pool))).pool;
    const baseAt = (point) => BigInt(getBaseFeeNumerator(raw.feeConfig.baseFee, new BN(point), raw.activationPoint, raw.initSqrtPrice, raw.initSqrtPrice).toString());
    assert.equal(baseAt(pool.fee.settles.atPoint - 1), 500_000_000n, "a point before: the cliff, at the first price");
    assert.equal(Number(baseAt(pool.fee.settles.atPoint) / 1_000n) / 100, pool.fee.endBps, "at the point: settled — the number the model shows, to two decimals of a basis point");
  }
  assert.ok(Math.abs(pool.fee.settles.atPrice / pool.initPrice - 4) < 0.05, `settles at ×${pool.fee.settles.atPrice / pool.initPrice}`);
  /* Before the opening the program reads the settled fee: an early swapper, were one whitelisted, would not pay the cliff. */
  assert.equal(pool.fee.period, 60);
  assert.equal(pool.fee.baseBps, pool.fee.endBps);
  assert.deepEqual(pool.rewards, []);
  assert.deepEqual(pool.paused, { swaps: false, deposits: false });
});

test("the model at the opening and after trading: the cliff, then the fee falling with the price", async () => {
  const opening = await at("opened").venue.pools.read(addresses.pool, who.stranger);
  assert.equal(opening.open.swap.open, true);
  assert.equal(opening.open.addLiquidity.reason, "open");
  assert.equal(opening.fee.period, 0);
  assert.equal(opening.fee.baseBps, 5_000);
  assert.equal(opening.fee.dynamicBps, 0);
  assert.ok(opening.fee.dynamicCeilingBps > 19 && opening.fee.dynamicCeilingBps <= 20, "the volatility fee is at most a fifth of the settled fee");
  const later = await at("ordersResting").venue.pools.read(addresses.pool);
  assert.ok(later.price > opening.price * 3, `×${later.price / opening.price}`);
  assert.ok(later.fee.period > 40 && later.fee.period < 60, String(later.fee.period));
  assert.ok(later.fee.baseBps < 500 && later.fee.baseBps > later.fee.endBps);
  assert.ok(later.fee.dynamicBps > 0, "after trading the volatility part is charged");
  assert.equal(later.fee.totalBps, Math.round((later.fee.baseBps + later.fee.dynamicBps) * 100) / 100);
});

test("the fee the venue reads is the fee the SDK's quote charges, the volatility part included", async () => {
  for (const moment of ["opened", "ordersResting", "ordersFilling", "afterTrading"]) {
    const { venue, sdk } = at(moment);
    const model = await venue.pools.read(addresses.pool);
    /* A buy small enough to end inside the range it starts in: one step, the fee taken once from the input, rounded up. */
    const amount = 1_000_000n;
    const { quote } = await sdk.pool.quoteExactIn({ pool: key(addresses.pool), inputAmount: new BN(amount.toString()), swapForY: false, hasReferral: false, swapper: key(who.buyer) });
    const charged = [quote.mmFee, quote.limitOrderFee, quote.protocolFee, quote.hostFee, quote.partnerFee].reduce((sum, part) => sum + BigInt(part.toString()), 0n);
    assert.equal(charged, (amount * BigInt(model.fee.numerator) + 999_999_999n) / 1_000_000_000n, `${moment}: ${model.fee.totalBps} bps`);
  }
});

test("a quote is the SDK's quote, and carries Ryntra's referral only where its account exists", async () => {
  const request = { pool: addresses.pool, inputMint: addresses.usdc, amountInRaw: "150000000", slippageBps: 300, wallet: who.buyer };
  /* At the opening the referral owner has no USDC account yet. */
  assert.equal((await at("opened").venue.swap.quote(request)).referral, false);
  /* With no referral owner configured, no swap carries one, whatever exists. */
  assert.equal((await at("ordersResting", null).venue.swap.quote(request)).referral, false);

  const { venue, sdk } = at("ordersResting");
  const quote = await venue.swap.quote(request);
  const direct = await sdk.pool.quoteExactIn({ pool: key(addresses.pool), inputAmount: new BN(request.amountInRaw), swapForY: false, hasReferral: true, swapper: key(who.buyer) });
  assert.equal(quote.referral, true);
  assert.equal(quote.swapForY, false);
  assert.equal(quote.outputMint, addresses.coin);
  assert.equal(quote.amountOutRaw, direct.quote.transferFeeExcludedOutAmount.toString());
  assert.equal(quote.minimumOutRaw, ((BigInt(quote.amountOutRaw) * 9_700n) / 10_000n).toString(), "the least received is the quote less the slippage, rounded down");
  assert.deepEqual(quote.fee, {
    mint: addresses.usdc,
    totalRaw: [direct.quote.mmFee, direct.quote.limitOrderFee, direct.quote.protocolFee, direct.quote.hostFee, direct.quote.partnerFee].reduce((sum, part) => sum + BigInt(part.toString()), 0n).toString(),
    liquidityRaw: direct.quote.mmFee.toString(),
    ordersRaw: direct.quote.limitOrderFee.toString(),
    protocolRaw: direct.quote.protocolFee.toString(),
    referralRaw: direct.quote.hostFee.toString(),
    partnerRaw: "0",
    bps: quote.fee.bps,
  });
  assert.ok(BigInt(quote.fee.referralRaw) > 0n);
  assert.equal(quote.tickAfter, direct.quote.nextTickId);
  assert.deepEqual(quote.tickArrays, direct.tickArrays.map((entry) => entry.toBase58()));
  /* With the referral the person receives the same: it comes out of the protocol's part. */
  const bare = await sdk.pool.quoteExactIn({ pool: key(addresses.pool), inputAmount: new BN(request.amountInRaw), swapForY: false, hasReferral: false, swapper: key(who.buyer) });
  assert.equal(bare.quote.transferFeeExcludedOutAmount.toString(), quote.amountOutRaw);
  assert.equal((BigInt(bare.quote.protocolFee.toString()) - BigInt(quote.fee.protocolRaw)).toString(), quote.fee.referralRaw);
  /* The other direction: the coin sold for USDC, the fee still in USDC — taken from what is paid out. */
  const sell = await venue.swap.quote({ ...request, inputMint: addresses.coin, amountInRaw: "1000000000000" });
  assert.equal(sell.swapForY, true);
  assert.equal(sell.fee.mint, addresses.usdc);
  assert.equal(sell.outputMint, addresses.usdc);
});

test("a swap is the SDK's own instructions behind a compute limit: the wallet pays and signs alone", async () => {
  const { venue, sdk } = at("ordersResting");
  const request = { pool: addresses.pool, inputMint: addresses.usdc, amountInRaw: "150000000", slippageBps: 300, wallet: who.buyer };
  const build = await venue.swap.build(request);
  const read = assertSealed(build, who.buyer);
  const direct = await sdk.pool.quoteExactIn({ pool: key(addresses.pool), inputAmount: new BN(request.amountInRaw), swapForY: false, hasReferral: true, swapper: key(who.buyer) });
  const { pool } = await sdk.state.fetchPoolWithExtensions(key(addresses.pool));
  const own = await sdk.pool.swap({ pool: key(addresses.pool), tokenXMint: pool.tokenXMint, tokenYMint: pool.tokenYMint, user: key(who.buyer), swapForY: false, tickArrays: direct.tickArrays, tickArrayBitmapExtension: direct.tickArrayBitmapExtension, referral: key(addresses.referralAccount), parameters: { inputAmount: new BN(request.amountInRaw), minimumOutputAmount: new BN(build.quote.minimumOutRaw) } });
  assert.deepEqual(read.instructions, ofSdk(own.tx));
  const swapIx = read.instructions.find((ix) => ix.program === DLMM_PRO_PROGRAM);
  assert.equal(swapIx.keys[7], addresses.referralAccount, "the referral token account, in the swap's own accounts");
  assert.equal(swapIx.keys[11], who.buyer, "the swap's signer");
  /* What it costs the network: one signature — and, with a priority price, that price over the whole limit, rounded up. */
  assert.equal(build.feeLamports, LAMPORTS_PER_SIGNATURE);
  assert.deepEqual({ rent: build.rentLamports, returned: build.rentReturnedLamports, unwraps: build.unwrapsLamports }, { rent: 0, returned: 0, unwraps: null }, "both of the buyer's accounts exist: the swap makes nothing, closes nothing");
  /* The caller's own limit and a priority price, when it names them: 123 456 units at 5 000 micro-lamports are 617.28 lamports, rounded up. */
  const priced = await venue.swap.build(request, { units: 123_456, priorityMicroLamports: 5_000 });
  assert.equal(priced.units, 123_456);
  assert.equal(opened(priced).budget.length, 2);
  assert.equal(priced.feeLamports, 5_618);
});

test("a swap's compute ceiling follows the ticks somebody stands on in its walk: it holds what the chain then used, with room, and does not grow with empty spacings", async () => {
  /* Three swaps the rehearsal sent, each built again on the very state it was built on — and what the chain then used for it. */
  const usedBy = (name) => fixture.transactions[name].record.meta.computeUnitsConsumed;
  for (const [name, moment, request] of [
    ["swapNoReferral", "opened", { pool: addresses.pool, inputMint: addresses.usdc, amountInRaw: "100000000", slippageBps: 300, wallet: who.buyer }],
    ["swapFillsAsks", "ordersResting", { pool: addresses.pool, inputMint: addresses.usdc, amountInRaw: "60000000", slippageBps: 300, wallet: who.whale }],
    ["swapSolIn", "solPool", { pool: addresses.poolE, inputMint: addresses.sol, amountInRaw: "500000000", slippageBps: 500, wallet: who.buyer }],
  ]) {
    const build = await at(moment).venue.swap.build(request);
    const used = usedBy(name);
    assert.ok(used * 11 <= build.units * 10, `${name}: used ${used} of a ceiling of ${build.units} — a tenth of room at the least`);
    /* The room is the venue's own allowance — for token accounts to open, a referral to pay, ticks stood on since — not a multiple of the walk. */
    assert.ok(build.units - used <= 250_000, `${name}: a ceiling of ${build.units} for ${used} used`);
  }
  /*
   * A buy that walks the launch's whole first tick arrays at the opening: hundreds of spacings, and only the ends of
   * the locked position's ranges to cross. The ceiling counts those — it does not reach the network's own limit, as a
   * ceiling by the spacings walked did.
   */
  const { venue, sdk } = at("opened");
  const far = await venue.swap.build({ pool: addresses.pool, inputMint: addresses.usdc, amountInRaw: "30000000000", slippageBps: 300, wallet: who.whale });
  const { pool } = await sdk.state.fetchPoolWithExtensions(key(addresses.pool));
  const spacings = Math.abs(far.quote.tickAfter - pool.tickCurrentId) / pool.tickSpacing;
  const ticks = (far.units - DLMM_PRO_UNITS.swap.base - DLMM_PRO_UNITS.swap.perArray * far.quote.tickArrays.length - 2 * DLMM_PRO_UNITS.tokenAccount) / DLMM_PRO_UNITS.swap.perTick;
  assert.ok(spacings > 150, `the walk is ${spacings} spacings long`);
  assert.ok(Number.isInteger(ticks) && ticks >= 4 && ticks < spacings / 2, `${ticks} ticks counted over ${spacings} spacings`);
  assert.ok(far.units < 1_400_000, String(far.units));
  /* A caller's own limit still stands for a swap — one program call. */
  assert.equal((await venue.swap.build({ pool: addresses.pool, inputMint: addresses.usdc, amountInRaw: "30000000000", slippageBps: 300, wallet: who.whale }, { units: 300_000 })).units, 300_000);
});

test("what cannot be swapped is refused before a signature: not open yet, more than the pool has, more than the wallet holds, a coin that is not the pool's", async () => {
  const refusal = async (work) => {
    try {
      await work();
    } catch (error) {
      assert.ok(error instanceof DlmmProRefusal, String(error));
      return error.code;
    }
    return null;
  };
  const request = { pool: addresses.pool, inputMint: addresses.usdc, amountInRaw: "100000000", slippageBps: 100, wallet: who.buyer };
  assert.equal(await refusal(() => at("beforeOpening").venue.swap.quote(request)), "NOT_OPEN");
  const { venue } = at("opened");
  assert.equal(await refusal(() => venue.swap.quote({ ...request, amountInRaw: "0" })), "AMOUNT_ZERO");
  assert.equal(await refusal(() => venue.swap.quote({ ...request, amountInRaw: "1000000000000000" })), "PARTIAL_FILL");
  assert.equal(await refusal(() => venue.swap.quote({ ...request, slippageBps: 5_001 })), "BAD_INPUT");
  assert.equal(await refusal(() => venue.swap.quote({ ...request, inputMint: addresses.coinB })), "BAD_INPUT");
  assert.equal(await refusal(() => venue.swap.quote({ ...request, pool: who.creator })), "NO_POOL");
  assert.equal(await refusal(() => venue.swap.build({ ...request, amountInRaw: "1500000000", wallet: who.stranger })), "BALANCE_LOW");
  assert.equal(await refusal(() => venue.swap.quote({ ...request, inputMint: addresses.coin, amountInRaw: "1000000" })), "PARTIAL_FILL", "before anyone bought, the pool has nothing to pay a seller with");
  assert.equal(await refusal(() => venue.swap.quote({ ...request, amountInRaw: "18446744073709551616" })), "BAD_INPUT", "more than the program's 64 bits");
  /* An account of the program that is not a pool — a position — is no pool: to a read, and to a swap. */
  const notAPool = derivePosition(key(addresses.position), key(DLMM_PRO_PROGRAM)).toBase58();
  assert.equal(await venue.pools.read(notAPool), null);
  assert.equal(await refusal(() => venue.swap.quote({ ...request, pool: notAPool })), "NO_POOL");
  /* An amount that buys nothing is refused, and what buys something never carries a least of nothing. */
  const traded = at("afterTrading").venue;
  assert.equal(await refusal(() => traded.swap.quote({ ...request, inputMint: addresses.coin, amountInRaw: "1" })), "AMOUNT_ZERO");
  let smallest = null;
  for (const amountInRaw of ["60000", "100000", "150000", "250000", "400000", "1000000"]) {
    const quote = await traded.swap.quote({ ...request, inputMint: addresses.coin, amountInRaw, slippageBps: 5_000 }).catch(() => null);
    if (!quote) continue;
    smallest ??= quote;
    assert.ok(BigInt(quote.amountOutRaw) > 0n && BigInt(quote.minimumOutRaw) >= 1n, `${amountInRaw} → ${quote.amountOutRaw}, least ${quote.minimumOutRaw}`);
  }
  assert.ok(smallest && BigInt(smallest.amountOutRaw) <= 2n, "an output of an atom or two was among them");
  assert.equal(await refusal(() => venue.pools.buildLaunchPool({ wallet: who.creator, tokenX: addresses.coin, tokenY: addresses.usdc, tickSpacing: 100, initialTickId: terms.firstTick, baseFee: { kind: "fixed", bps: 100 }, collectFee: "tokenY" })), "POOL_EXISTS");
  assert.equal(await refusal(() => venue.pools.buildLaunchPool({ wallet: who.creator, tokenX: addresses.usdc, tokenY: addresses.coin, tickSpacing: 100, initialTickId: 0, baseFee: { kind: "fixed", bps: 100 }, collectFee: "tokenY" })), "BAD_INPUT", "«only Y» pairs with wrapped SOL or USDC");
});

test("a pool is made once and for ever: an option that is not one of its words is refused, never read as the other one", async () => {
  const { venue } = at("rewardsRunning");
  const request = { wallet: who.creator, tokenX: addresses.coin, tokenY: addresses.coinB, tickSpacing: 100, initialTickId: 0, baseFee: { kind: "fixed", bps: 100 }, collectFee: "output" };
  assertSealed(await venue.pools.buildLaunchPool(request), who.creator);
  for (const [why, change] of [
    ["the fee's coin misspelt", { collectFee: "tokenX" }],
    ["the fee's coin left out", { collectFee: undefined }],
    ["the volatility fee as a word", { dynamicFee: "off" }],
    ["liquidity mining as a number", { liquidityMining: 1 }],
    ["a schedule this release does not have", { baseFee: { kind: "stepped", bps: 100 } }],
    ["a curve this release does not have", { baseFee: { kind: "time", curve: "cliff", startBps: 500, endBps: 100, periods: 10, periodSeconds: 60 } }],
  ]) {
    assert.equal(await refused(() => venue.pools.buildLaunchPool({ ...request, ...change })), "BAD_INPUT", why);
  }
});

test("lamports somebody left at the address of a pair's pool do not make the pair's pool: the program's own account there does", async () => {
  const request = { wallet: who.creator, tokenX: addresses.coin, tokenY: addresses.coinB, tickSpacing: 100, initialTickId: 0, baseFee: { kind: "fixed", bps: 100 }, collectFee: "output" };
  const address = at("rewardsRunning").venue.pools.launchPoolAddress(addresses.coin, addresses.coinB);
  const dusted = withAccounts("rewardsRunning", { [address]: dust() }).venue;
  const build = await dusted.pools.buildLaunchPool(request);
  assert.equal(build.pool, address);
  assertSealed(build, who.creator);
  assert.equal(await dusted.pools.read(address), null, "and it reads as no pool");
  /* The program's own account at that address — here another pool's bytes — is the pair's pool. */
  const taken = withAccounts("rewardsRunning", { [address]: fixture.snapshots.rewardsRunning.accounts[addresses.pool] }).venue;
  assert.equal(await refused(() => taken.pools.buildLaunchPool(request)), "POOL_EXISTS");
});

test("a launch pool's opening lies far enough ahead to be signed and to land, and no further than the program lets it", async () => {
  /* The two coins of the rehearsal have no pool together, and the creator holds both. */
  const { venue, clock } = at("rewardsRunning");
  const request = { wallet: who.creator, tokenX: addresses.coin, tokenY: addresses.coinB, tickSpacing: 100, initialTickId: 0, baseFee: { kind: "fixed", bps: 100 }, collectFee: "output" };
  assert.equal(await refused(() => venue.pools.buildLaunchPool({ ...request, opening: { swapAt: clock.unix - 1 } })), "BAD_INPUT");
  assert.equal(await refused(() => venue.pools.buildLaunchPool({ ...request, opening: { swapAt: clock.unix + 30 } })), "BAD_INPUT", "it would have passed by the time the transaction lands");
  assert.equal(await refused(() => venue.pools.buildLaunchPool({ ...request, opening: { swapAt: clock.unix + 31 * 86_400 } })), "BAD_INPUT");
  assert.equal(await refused(() => venue.pools.buildLaunchPool({ ...request, opening: { swapAt: clock.unix + 600, depositsAt: clock.unix + 30 } })), "BAD_INPUT", "each of the three points is held");
  const build = await venue.pools.buildLaunchPool({ ...request, opening: { swapAt: clock.unix + 600 } });
  assertSealed(build, who.creator);
  assert.equal(build.parameters.activationPoint, clock.unix + 600);
  assert.equal(build.pool, venue.pools.launchPoolAddress(addresses.coinB, addresses.coin));
});

test("a launch pool against SOL is held to the lamport the SDK wraps as the payer's balance of it", async () => {
  /* USDC — a coin of the classic program, so its vault's rent is exact — against SOL, by a wallet that holds no wrapped SOL. */
  const request = { wallet: who.creator, tokenX: addresses.usdc, tokenY: addresses.sol, tickSpacing: 100, initialTickId: 0, baseFee: { kind: "fixed", bps: 100 }, dynamicFee: false, collectFee: "output" };
  /* A moment that has USDC and the creator's account of it, with wrapped SOL's mint as the rehearsal met it later, at its pools against SOL. */
  const native = { [addresses.sol]: fixture.snapshots.solPool.accounts[addresses.sol] };
  const build = await withAccounts("theEnd", native).venue.pools.buildLaunchPool(request);
  const read = assertSealed(build, who.creator);
  /* The program takes the payer's balance of each coin as its proof and none may be nothing: the SDK opens a wrapped-SOL account, puts one lamport in it, and closes it after the pool is made. */
  const transfer = read.instructions.find((ix) => ix.program === SystemProgram.programId.toBase58());
  assert.equal(Buffer.from(transfer.data, "hex").readBigUInt64LE(4), 1n, "one lamport");
  assert.deepEqual({ returned: build.rentReturnedLamports, unwraps: build.unwrapsLamports }, { returned: rentOf(SIZES.tokenAccount), unwraps: null });
  assert.equal(build.rentLamports - build.rentReturnedLamports, rentOf(SIZES.pool) + rentOf(SIZES.oracle) + 2 * rentOf(SIZES.tokenAccount));
  /* So the wallet must hold the fee, all of the rent — what comes back is out of it until the end — and that lamport. */
  const needed = build.feeLamports + build.rentLamports + 1;
  const holding = (lamports) => withAccounts("theEnd", { ...native, [who.creator]: { lamports } }).venue;
  assert.equal(await refused(() => holding(needed - 1).pools.buildLaunchPool(request)), "BALANCE_LOW");
  assertSealed(await holding(needed).pools.buildLaunchPool(request), who.creator);
});

test("a pool the operator paused refuses a swap as paused — not as a pool that has not opened", async () => {
  const request = { pool: addresses.pool, inputMint: addresses.usdc, amountInRaw: "100000000", slippageBps: 100, wallet: who.buyer };
  const paused = await withPool("ordersResting", addresses.pool, (pool) => ({ ...pool, poolStatus: 1 }));
  const model = await paused.venue.pools.read(addresses.pool, who.buyer);
  assert.deepEqual(model.paused, { swaps: true, deposits: false });
  assert.equal(model.open.swap.reason, "paused");
  assert.equal(await refused(() => paused.venue.swap.quote(request)), "PAUSED");
  assert.equal(await refused(() => paused.venue.swap.build(request)), "PAUSED");
  /* The same pool as it is: the swap quotes. */
  assert.ok(BigInt((await at("ordersResting").venue.swap.quote(request)).amountOutRaw) > 0n);
});

test("a list leaves out the one pool it cannot read whole, and keeps the rest", async () => {
  const odd = await withPool("rewardsRunning", addresses.poolB, (pool) => ({ ...pool, feeConfig: { ...pool.feeConfig, baseFee: { ...pool.feeConfig.baseFee, baseFeeMode: 9 } } }));
  assert.deepEqual((await odd.venue.pools.list()).map((pool) => pool.address), [addresses.pool], "a fee mode this release does not have");
  assert.equal(await refused(() => odd.venue.pools.read(addresses.poolB)), "FAILED", "read alone, it is refused — never modelled by a guess");
  /* A coin whose mint does not read: its pool is left out, the other stays. */
  const snapshot = fixture.snapshots.rewardsRunning;
  const { [addresses.coinB]: _gone, ...rest } = snapshot.accounts;
  const connection = rpcConnection(snapshotSource({ ...snapshot, accounts: rest }, records));
  assert.deepEqual((await createDlmmProVenue({ connection, referralOwner: null }).pools.list()).map((pool) => pool.address), [addresses.pool]);
});

test("the referral account is read for every quote: frozen or closed since, it is left out and the swap still builds", async () => {
  const request = { pool: addresses.pool, inputMint: addresses.usdc, amountInRaw: "150000000", slippageBps: 300, wallet: who.buyer };
  const source = snapshotSource(fixture.snapshots.ordersResting, records);
  let state = "there";
  const connection = rpcConnection({
    ...source,
    account: (address) => {
      const account = source.account(address);
      if (address !== addresses.referralAccount || state === "there") return account;
      if (state === "closed") return null;
      const data = Buffer.from(account.data);
      data.writeUInt8(2, 108);
      return { ...account, data };
    },
  });
  const venue = createDlmmProVenue({ connection, referralOwner: who.referral });
  assert.equal((await venue.swap.quote(request)).referral, true);
  for (const next of ["frozen", "closed"]) {
    state = next;
    const quote = await venue.swap.quote(request);
    assert.equal(quote.referral, false, next);
    assert.equal(quote.fee.referralRaw, "0", next);
    const build = await venue.swap.build(request);
    const swapIx = opened(build).instructions.find((ix) => ix.program === DLMM_PRO_PROGRAM);
    assert.notEqual(swapIx.keys[7], addresses.referralAccount, `${next}: the swap does not name the account`);
  }
  state = "there";
  assert.equal((await venue.swap.quote(request)).referral, true, "and back, on the same connection");
});

test("a position from a shape is the SDK's own open, deposit and lock; the fresh NFT mint is the one other signer", async () => {
  const { venue, sdk } = at("opened");
  const nftMint = Keypair.generate().publicKey;
  const shape = { strategy: "curve", minTickId: terms.firstTick, maxTickId: terms.firstTick + 460 * terms.tickSpacing };
  const amountX = "50000000000000";
  const build = await venue.positions.open({ pool: addresses.pool, wallet: who.creator, nftMint: nftMint.toBase58(), shape, amountXRaw: amountX, amountYRaw: "0", slippageBps: 0, lockBps: 10_000 });
  assert.deepEqual(build.steps.map((step) => step.role), ["OPEN", "DEPOSIT", "LOCK"]);
  assert.deepEqual(build.packed.map((tx) => tx.roles), [["OPEN"], ["DEPOSIT", "LOCK"]], "the same in the fewest transactions that hold it");
  assert.equal(build.shape.ranges.length, 45);
  assert.equal(build.shape.columns.length, 461);
  assert.ok(build.shape.columns.every((column) => column.side !== "bid"), "nothing of the shape is below the price");

  const { pool } = await sdk.state.fetchPoolWithExtensions(key(addresses.pool));
  const own = buildLiquidityShape({ strategy: StrategyType.Curve, minTickId: shape.minTickId, maxTickId: shape.maxTickId, tickSpacing: pool.tickSpacing, currentTickId: pool.tickCurrentId, maxRanges: 45 });
  assert.deepEqual(build.shape.ranges, own.ranges);
  const multiplier = multiplierFromAmounts({ ranges: own.ranges, tickSpacing: pool.tickSpacing, currentTickId: pool.tickCurrentId, currentSqrtPrice: pool.sqrtPrice, amountX: new BN(amountX), amountY: new BN(0), mintX: null, mintY: null, epoch: 0n });
  assert.equal(build.deposit.multiplier, multiplier.toString());
  assert.equal(build.deposit.yRaw, "0");
  assert.ok(BigInt(build.deposit.xRaw) <= BigInt(amountX) && BigInt(build.deposit.xRaw) > (BigInt(amountX) * 999n) / 1000n);
  assert.equal(build.deposit.xRaw, amountsFromShape({ ranges: own.ranges, currentTickId: pool.tickCurrentId, currentSqrtPrice: pool.sqrtPrice, multiplier }).reduce((sum, item) => sum + BigInt(item.amountX.toString()), 0n).toString());
  /* With no room asked, each cap is exactly what the deposit takes — and a coin it does not take has a cap of nothing. */
  assert.deepEqual({ x: build.deposit.maximumXRaw, y: build.deposit.maximumYRaw }, { x: build.deposit.xRaw, y: "0" });
  const tickRanges = own.ranges.map(({ tickLowerId, tickUpperId }) => ({ tickLowerId, tickUpperId }));
  const wallet = key(who.creator);
  const [openTx, depositTx, lockTx] = [
    (await sdk.position.openPosition({ pool: key(addresses.pool), owner: wallet, payer: wallet, nftMint, tickRanges })).tx,
    (await sdk.position.addLiquidityByWeight({ pool: key(addresses.pool), nftMint, owner: wallet, signer: wallet, tokenXMint: pool.tokenXMint, tokenYMint: pool.tokenYMint, tickRanges, parameters: encodeAddLiquidityByWeight({ ranges: own.ranges, maxAmountX: new BN(build.deposit.maximumXRaw), maxAmountY: new BN(0), multiplier }) })).tx,
    /* No layout version is named for a position its own wallet opens a step before: nothing is guessed about what a widening does to it. */
    (await sdk.position.lockPermanentPosition({ pool: key(addresses.pool), nftMint, owner: wallet, bps: 10_000 })).tx,
  ];
  assert.deepEqual(assertSealed(build.steps[0], who.creator, [nftMint.toBase58()]).instructions, ofSdk(openTx));
  assert.deepEqual(assertSealed(build.steps[1], who.creator).instructions, ofSdk(depositTx));
  assert.deepEqual(assertSealed(build.steps[2], who.creator).instructions, ofSdk(lockTx));
  assert.deepEqual(assertSealed(build.packed[1], who.creator).instructions, [...ofSdk(depositTx), ...ofSdk(lockTx)]);
  /* Fewer ranges is a coarser shape — and less rent. */
  const coarse = await venue.positions.open({ pool: addresses.pool, wallet: who.creator, nftMint: nftMint.toBase58(), shape, amountXRaw: amountX, amountYRaw: "0", slippageBps: 0, maxRanges: 8 });
  assert.ok(coarse.shape.ranges.length <= 8 && coarse.shape.ranges.length >= 4, String(coarse.shape.ranges.length));
  assert.deepEqual(coarse.packed.map((tx) => tx.roles), [["OPEN", "DEPOSIT"]]);
  assertSealed(coarse.packed[0], who.creator, [nftMint.toBase58()]);
  const refuses = (request) => venue.positions.open({ pool: addresses.pool, wallet: who.creator, nftMint: nftMint.toBase58(), shape, amountXRaw: amountX, amountYRaw: "0", slippageBps: 0, ...request }).then(() => null, (error) => error.code);
  assert.equal(await refuses({ slippageBps: 5_001 }), "BAD_INPUT");
  assert.equal(await refuses({ slippageBps: undefined }), "BAD_INPUT", "the room is always said");
  assert.equal(await refuses({ amountXRaw: "2000000000000000" }), "BALANCE_LOW", "more than the wallet holds is refused before a signature");
  assert.equal(await refuses({ amountXRaw: "40" }), "BAD_INPUT", "an amount that buys no liquidity: the SDK's own refusal, before a signature");
});

test("a deposit names a band of the price: its liquidity fits both budgets at the band's two ends, and each cap is what it takes at the end that takes most of that coin", async () => {
  const { venue, sdk } = at("afterTrading");
  const { pool } = await sdk.state.fetchPoolWithExtensions(key(addresses.pool));
  const aligned = Math.floor(pool.tickCurrentId / pool.tickSpacing) * pool.tickSpacing;
  /* Five ticks either side of the price — five percent, on this pool: the band asked for lies well inside the range. */
  const shape = { strategy: "spot", minTickId: aligned - 5 * pool.tickSpacing, maxTickId: aligned + 5 * pool.tickSpacing };
  const budget = { x: 2_000_000_000_000n, y: 30_000_000n };
  const open = (slippageBps, amounts = budget, over = shape) => venue.positions.open({ pool: addresses.pool, wallet: who.creator, nftMint: Keypair.generate().publicKey.toBase58(), shape: over, amountXRaw: amounts.x.toString(), amountYRaw: amounts.y.toString(), slippageBps });
  const [tight, roomy] = [await open(0), await open(200)];
  const numbers = (build) => ({ x: BigInt(build.deposit.xRaw), y: BigInt(build.deposit.yRaw), maxX: BigInt(build.deposit.maximumXRaw), maxY: BigInt(build.deposit.maximumYRaw), multiplier: BigInt(build.deposit.multiplier) });
  const [t, r] = [numbers(tight), numbers(roomy)];
  assert.ok(t.x > 0n && t.y > 0n, "a range around the price takes both coins");
  assert.deepEqual({ x: t.maxX, y: t.maxY }, { x: t.x, y: t.y }, "no band: the caps are what the deposit takes");
  assert.ok(r.multiplier < t.multiplier, "a band is bought with liquidity");

  /* The SDK's own arithmetic, at any price: what a liquidity of this shape takes of each coin. */
  const own = buildLiquidityShape({ strategy: StrategyType.Spot, minTickId: shape.minTickId, maxTickId: shape.maxTickId, tickSpacing: pool.tickSpacing, currentTickId: pool.tickCurrentId, maxRanges: 45 });
  const square = BigInt(pool.sqrtPrice.toString()) ** 2n;
  /* A price `bps` of itself away, as the pool holds prices: the square root. */
  const priceAt = (bps) => {
    if (bps === 0) return { currentSqrtPrice: pool.sqrtPrice, currentTickId: pool.tickCurrentId };
    const root = new BN(isqrt((square * BigInt(10_000 + bps)) / 10_000n).toString());
    return { currentSqrtPrice: root, currentTickId: tickIdFromSqrtPrice(root) };
  };
  const takes = (bps, multiplier) => amountsFromShape({ ranges: own.ranges, ...priceAt(bps), multiplier: new BN(multiplier.toString()) }).reduce((total, item) => ({ x: total.x + BigInt(item.amountX.toString()), y: total.y + BigInt(item.amountY.toString()) }), { x: 0n, y: 0n });

  /* Each cap is what the liquidity takes at the end of the band that takes most of that coin — token X at the low end, token Y at the high — and neither is above its budget. */
  assert.deepEqual({ x: r.maxX, y: r.maxY }, { x: takes(-200, r.multiplier).x, y: takes(200, r.multiplier).y });
  assert.ok(r.maxX <= budget.x && r.maxY <= budget.y, "never above the budget");
  assert.ok(r.maxX > r.x && r.maxY > r.y, "and above what it takes now");
  /* The liquidity is the most that fits: one unit of it more would need more than a budget at one of the ends. */
  assert.ok(takes(-200, r.multiplier + 1n).x > budget.x || takes(200, r.multiplier + 1n).y > budget.y, "the largest that fits both ends");
  /* Anywhere inside the band what the deposit takes is inside its caps — so the program lands it; past either end it takes more than a cap — and the program refuses it. */
  for (const bps of [-200, -150, -70, -1, 0, 1, 60, 140, 200]) {
    const inside = takes(bps, r.multiplier);
    assert.ok(inside.x <= r.maxX && inside.y <= r.maxY, `${bps} bps of the price`);
  }
  assert.ok(takes(-260, r.multiplier).x > r.maxX, "below the band it needs more of token X than its cap");
  assert.ok(takes(260, r.multiplier).y > r.maxY, "above it, more of token Y");
  /* What it takes at the build's price is the same arithmetic; and what the wallet pays for it is that — neither coin here has a transfer fee. */
  assert.deepEqual({ x: r.x, y: r.y }, takes(0, r.multiplier));
  assert.deepEqual({ x: roomy.deposit.paidXRaw, y: roomy.deposit.paidYRaw }, { x: roomy.deposit.xRaw, y: roomy.deposit.yRaw });

  /* A coin with a budget of nothing is not offered at all, whatever the band: ranges above the price take token X alone, and have no cap in token Y. */
  const above = { strategy: "spot", minTickId: aligned + 2 * pool.tickSpacing, maxTickId: aligned + 6 * pool.tickSpacing };
  const oneSided = numbers(await open(200, { x: budget.x, y: 0n }, above));
  assert.deepEqual({ y: oneSided.y, maxY: oneSided.maxY }, { y: 0n, maxY: 0n });
  assert.ok(oneSided.x > 0n && oneSided.maxX >= oneSided.x && oneSided.maxX <= budget.x);
  /* And a shape that needs now a coin that is not offered is refused before a signature. */
  assert.equal(await refused(() => open(200, { x: budget.x, y: 0n })), "BAD_INPUT");

  /* The bytes carry those caps and that multiplier, and name no layout version. */
  const nftMint = key(roomy.nftMint);
  const wallet = key(who.creator);
  const deposit = await sdk.position.addLiquidityByWeight({ pool: key(addresses.pool), nftMint, owner: wallet, signer: wallet, tokenXMint: pool.tokenXMint, tokenYMint: pool.tokenYMint, tickRanges: own.ranges.map(({ tickLowerId, tickUpperId }) => ({ tickLowerId, tickUpperId })), parameters: encodeAddLiquidityByWeight({ ranges: own.ranges, maxAmountX: new BN(roomy.deposit.maximumXRaw), maxAmountY: new BN(roomy.deposit.maximumYRaw), multiplier: new BN(roomy.deposit.multiplier) }) });
  assert.deepEqual(assertSealed(roomy.steps.find((step) => step.role === "DEPOSIT"), who.creator).instructions, ofSdk(deposit.tx));
});

test("more into a position: by the caller's weights, or as it stands — and the slots it takes from are always named", async () => {
  const { venue, sdk } = at("afterTrading");
  const { pool } = await sdk.state.fetchPoolWithExtensions(key(addresses.pool));
  const { positionArray, positions } = await sdk.state.fetchPositionArrayWithPositions(derivePosition(key(addresses.position), key(DLMM_PRO_PROGRAM)), { withReward: false });
  const wallet = key(who.creator);
  const request = { pool: addresses.pool, nftMint: addresses.position, owner: who.creator, amountXRaw: "3000000000000", amountYRaw: "20000000", slippageBps: 100 };
  /* Three slots, named out of order, each with its own weight: the weights follow their slots. */
  const add = await venue.positions.add({ ...request, slots: [7, 2, 30], weights: [9, 200, 1] });
  const ranges = [{ index: 2, weight: 200 }, { index: 7, weight: 9 }, { index: 30, weight: 1 }].map(({ index, weight }) => ({ tickLowerId: positions[index].tickLowerId, tickUpperId: positions[index].tickUpperId, weight }));
  const own = await sdk.position.addLiquidityByWeight({ pool: key(addresses.pool), nftMint: key(addresses.position), owner: wallet, signer: wallet, tokenXMint: pool.tokenXMint, tokenYMint: pool.tokenYMint, tickRanges: ranges.map(({ tickLowerId, tickUpperId }) => ({ tickLowerId, tickUpperId })), parameters: encodeAddLiquidityByWeight({ ranges, positionIndexes: [2, 7, 30], maxAmountX: new BN(add.deposit.maximumXRaw), maxAmountY: new BN(add.deposit.maximumYRaw), multiplier: new BN(add.deposit.multiplier), expectedLayoutVersion: positionArray.layoutVersion }) });
  assert.deepEqual(assertSealed(add, who.creator).instructions, ofSdk(own.tx));
  for (const [bad, why] of [[{ slots: [1, 1] }, "a slot twice"], [{ slots: [45] }, "a slot the position does not have"], [{ slots: [1, 2], weights: [3] }, "a weight short"], [{ slots: [1], weights: [0] }, "a weight of nothing"], [{ slots: [1], weights: [256] }, "a weight above the program's"], [{ slippageBps: -1 }, "room below nothing"]]) {
    assert.equal(await refused(() => venue.positions.add({ ...request, ...bad })), "BAD_INPUT", why);
  }
  assert.equal(await refused(() => venue.positions.add({ ...request, owner: who.stranger })), "BAD_INPUT", "not the holder");
  assert.equal(await refused(() => venue.positions.add({ ...request, signer: who.stranger })), "BAD_INPUT", "neither the holder nor its delegate");
  assert.equal(await refused(() => venue.positions.compound({ pool: addresses.pool, nftMint: addresses.position, owner: who.stranger, slippageBps: 100 })), "BAD_INPUT", "not the holder");
  assert.equal(await refused(() => venue.positions.compound({ pool: addresses.pool, nftMint: addresses.position, owner: who.creator })), "BAD_INPUT", "the band of the price is always said");
  assert.equal(await refused(() => venue.positions.compound({ pool: addresses.pool, nftMint: addresses.position, owner: who.creator, slippageBps: 100 })), "NOTHING_TO_DO", "its fees were compounded a moment ago");
  /* After the compound one slot holds unlocked liquidity: taking it out names that slot, and passes its ticks alone. */
  const compounded = positions.map((position, index) => ({ position, index })).filter(({ position }) => !position.unlockedLiquidity.isZero());
  assert.equal(compounded.length, 1);
  const remove = await venue.positions.remove({ pool: addresses.pool, nftMint: addresses.position, owner: who.creator, bps: 10_000, slippageBps: 100 });
  const slot = compounded[0];
  const direct = await sdk.position.removeLiquidityByBps({ pool: key(addresses.pool), nftMint: key(addresses.position), owner: wallet, signer: wallet, tokenXMint: pool.tokenXMint, tokenYMint: pool.tokenYMint, tickRanges: [{ tickLowerId: slot.position.tickLowerId, tickUpperId: slot.position.tickUpperId }], parameters: { minAmountX: new BN(remove.minimum.xRaw), minAmountY: new BN(remove.minimum.yRaw), expectedLayoutVersion: positionArray.layoutVersion, bps: 10_000, bitmap: liquidityBitmap([slot.index]) } });
  assert.deepEqual(assertSealed(remove, who.creator).instructions, ofSdk(direct.tx));
});

test("the locked position reads as locked, with what it earned; what does not exist or is not held is refused", async () => {
  const { venue } = at("ordersFilling");
  const view = await venue.positions.read({ pool: addresses.pool, nftMint: addresses.position });
  assert.equal(view.slots.length, 45);
  assert.equal(view.lockedBps, 10_000);
  assert.ok(view.slots.every((slot) => slot.unlocked === "0" && slot.lockedForEver === slot.liquidity));
  assert.equal(view.layoutVersion, 0);
  assert.deepEqual(view.delegateMay, []);
  assert.ok(BigInt(view.feeYRaw) > 0n && view.feeXRaw === "0", "a pool that collects only in Y earns its position Y alone");
  assert.equal(view.empty, false);
  assert.ok(BigInt(view.yRaw) > 0n, "what buyers paid is in the ranges below the price");
  assert.ok(view.slots.filter((slot) => slot.inRange).length >= 1);
  const refused = async (work, code) => assert.equal(await work().then(() => null, (error) => error.code), code);
  await refused(() => venue.positions.remove({ pool: addresses.pool, nftMint: addresses.position, owner: who.creator, bps: 10_000, slippageBps: 100 }), "NOTHING_TO_DO");
  await refused(() => venue.positions.lockPermanently({ pool: addresses.pool, nftMint: addresses.position, owner: who.creator, bps: 10_000 }), "NOTHING_TO_DO");
  await refused(() => venue.positions.close({ pool: addresses.pool, nftMint: addresses.position, owner: who.creator }), "BAD_INPUT");
  await refused(() => venue.positions.collect({ pool: addresses.pool, nftMint: addresses.position, owner: who.stranger }), "BAD_INPUT");
  await refused(() => venue.positions.read({ pool: addresses.pool, nftMint: who.stranger }), "BAD_INPUT");
  await refused(() => venue.positions.read({ pool: addresses.poolB, nftMint: addresses.position }), "NO_POOL");
  /* Collecting its fees is the SDK's refresh and claim. */
  const collect = await venue.positions.collect({ pool: addresses.pool, nftMint: addresses.position, owner: who.creator });
  const read = assertSealed(collect, who.creator);
  assert.equal(collect.expected.yRaw, view.feeYRaw);
  assert.equal(read.instructions.filter((ix) => ix.program === DLMM_PRO_PROGRAM).length, 2, "a refresh, then the claim");
});

test("a ladder of limit orders is the SDK's own order from a shape; the fills read off the ticks are what the chain then paid", async () => {
  /* Placing: the rehearsal's own ladder, rebuilt on the state it was built on. */
  const resting = at("ordersResting");
  const asks = await resting.venue.orders.read({ pool: addresses.pool, nftMint: addresses.asks });
  assert.equal(asks.side, "ask");
  assert.equal(asks.ticks.length, 10);
  assert.ok(asks.ticks.every((tick) => tick.state === "resting"));
  assert.deepEqual({ restsIn: asks.restsIn, paysIn: asks.paysIn, feeIn: asks.feeIn }, { restsIn: addresses.coin, paysIn: addresses.usdc, feeIn: addresses.usdc }, "on an «only Y» pool an ask's fee is in Y too");
  assert.equal(asks.referral, null);
  assert.deepEqual(asks.bonus, { mint: addresses.usdc, raw: "0", ownerRaw: "0", referralRaw: "0", referralPaid: false }, "nothing filled yet, and nobody named");
  const bids = await resting.venue.orders.read({ pool: addresses.pool, nftMint: addresses.bids });
  assert.equal(bids.side, "bid");
  assert.equal(bids.referral, who.referral, "the wallet named when the order was placed");
  assert.deepEqual(bids.bonus, { mint: addresses.usdc, raw: "0", ownerRaw: "0", referralRaw: "0", referralPaid: true }, "nothing filled yet; the referral's account stands ready");
  assert.equal(bids.delegateMayCollect, false);

  const model = await resting.venue.pools.read(addresses.pool);
  const aligned = Math.floor(model.tickId / model.tickSpacing) * model.tickSpacing;
  const nftMint = Keypair.generate().publicKey;
  const place = await resting.venue.orders.place({ pool: addresses.pool, wallet: who.maker, nftMint: nftMint.toBase58(), side: "bid", shape: { strategy: "bidAsk", minTickId: aligned - 5 * model.tickSpacing, maxTickId: aligned - model.tickSpacing }, totalAmountRaw: "600000000", slippageTicks: 2 * model.tickSpacing });
  const read = assertSealed(place, who.maker, [nftMint.toBase58()]);
  assert.equal(place.ticks.length, 5);
  assert.deepEqual(place.ticks.map((tick) => tick.tickId), [5, 4, 3, 2, 1].map((offset) => aligned - offset * model.tickSpacing));
  /* Bid-Ask thickens away from the price: the farthest tick holds the most. */
  assert.ok(BigInt(place.ticks[0].amountRaw) > BigInt(place.ticks[4].amountRaw));
  assert.ok(BigInt(place.amountRaw) <= 600_000_000n && 600_000_000n - BigInt(place.amountRaw) < 100n, "a budget is split by weight; less than the total weight stays unspent");
  assert.equal(place.maximumPaidRaw, place.amountRaw, "USDC has no transfer fee");
  assert.deepEqual(place.band, { minTickId: aligned - 2 * model.tickSpacing, maxTickId: aligned + 2 * model.tickSpacing });
  const orderIx = read.instructions.find((ix) => ix.program === DLMM_PRO_PROGRAM);
  /* An order placed through the venue names the venue's own referral owner — the one its swaps name. */
  assert.equal(orderIx.keys[9], who.referral);
  assert.equal(place.referral, who.referral);
  /* The caller may name another, or say none — then the optional account is the program itself; and a venue with no referral owner names nobody. */
  const fixed = { pool: addresses.pool, wallet: who.maker, nftMint: nftMint.toBase58(), side: "bid", shape: { strategy: "spot", minTickId: aligned - 2 * model.tickSpacing, maxTickId: aligned - model.tickSpacing }, totalAmountRaw: "1000000", slippageTicks: null };
  const referralOf = (build) => opened(build).instructions.find((ix) => ix.program === DLMM_PRO_PROGRAM).keys[9];
  const another = await resting.venue.orders.place({ ...fixed, referralWallet: who.stranger });
  assert.deepEqual([referralOf(another), another.referral], [who.stranger, who.stranger]);
  const none = await resting.venue.orders.place({ ...fixed, referralWallet: null });
  assert.deepEqual([referralOf(none), none.referral], [DLMM_PRO_PROGRAM, null]);
  const unconfigured = await at("ordersResting", null).venue.orders.place(fixed);
  assert.deepEqual([referralOf(unconfigured), unconfigured.referral], [DLMM_PRO_PROGRAM, null]);
  assert.equal(none.band, null);

  /* Reading and collecting: after buyers walked into the ladder. */
  const filling = at("ordersFilling");
  const view = await filling.venue.orders.read({ pool: addresses.pool, nftMint: addresses.asks });
  const states = view.ticks.map((tick) => tick.state);
  assert.ok(states.includes("filled") && states.includes("partial") && states.includes("resting"), states.join());
  assert.equal(view.closable, false);
  const filled = view.ticks.filter((tick) => tick.state === "filled").map((tick) => tick.tickId);
  const collect = await filling.venue.orders.collect({ pool: addresses.pool, nftMint: addresses.asks, owner: who.buyer, tickIds: filled });
  assertSealed(collect, who.buyer);
  /* The transaction the rehearsal sent from this very state: the same instructions, and the chain paid what the venue read. */
  const event = eventsNamed(await filling.venue.events.read(fixture.transactions.collectAsks.signature), "evtCancelLimitOrder")[0];
  assert.deepEqual(event.data.tickIds, filled);
  assert.equal(event.data.ownerAmountY, collect.expected.yRaw);
  assert.equal(event.data.ownerAmountX, collect.expected.xRaw);
  assert.equal(event.data.owner, who.buyer);
  assert.ok(BigInt(event.data.ownerFeeY) > 0n);
  const own = await filling.sdk.limitOrder.cancelLimitOrder({ pool: key(addresses.pool), nftMint: key(addresses.asks), owner: key(who.buyer), signer: key(who.buyer), tokenXMint: key(addresses.coin), tokenYMint: key(addresses.usdc), tickIds: filled });
  assert.deepEqual(opened(collect).instructions, ofSdk(own.tx));
  /* Closing collects what is left first, in the same transaction. */
  const close = await filling.venue.orders.close({ pool: addresses.pool, nftMint: addresses.asks, owner: who.buyer });
  assert.equal(close.collected.length, 10);
  assert.equal(assertSealed(close, who.buyer).instructions.filter((ix) => ix.program === DLMM_PRO_PROGRAM).length, 2, "the collect, then the close");
  const refused = async (work, code) => assert.equal(await work().then(() => null, (error) => error.code), code);
  await refused(() => filling.venue.orders.collect({ pool: addresses.pool, nftMint: addresses.asks, owner: who.stranger }), "BAD_INPUT");
  await refused(() => filling.venue.orders.collect({ pool: addresses.pool, nftMint: addresses.asks, owner: who.buyer, tickIds: [terms.firstTick] }), "BAD_INPUT");
  await refused(() => filling.venue.orders.read({ pool: addresses.pool, nftMint: who.buyer }), "BAD_INPUT");
  await refused(() => resting.venue.orders.place({ pool: addresses.pool, wallet: who.maker, nftMint: nftMint.toBase58(), side: "ask", shape: { strategy: "spot", minTickId: aligned - 5 * model.tickSpacing, maxTickId: aligned - model.tickSpacing }, totalAmountRaw: "1000", slippageTicks: null }), "BAD_INPUT");
  /* A side that is neither would be read as a bid; a weight outside the shape's own ticks would rest where the request did not say. */
  const bid = { pool: addresses.pool, wallet: who.maker, nftMint: nftMint.toBase58(), side: "bid", shape: { strategy: "spot", minTickId: aligned - 2 * model.tickSpacing, maxTickId: aligned - model.tickSpacing }, totalAmountRaw: "1000000", slippageTicks: null };
  await refused(() => resting.venue.orders.place({ ...bid, side: "sell" }), "BAD_INPUT");
  await refused(() => resting.venue.orders.place({ ...bid, shape: { ...bid.shape, strategy: "custom", weights: [{ tickId: aligned - model.tickSpacing, weight: 1 }, { tickId: aligned - 40 * model.tickSpacing, weight: 5 }] } }), "BAD_INPUT");
  await refused(() => resting.venue.orders.place({ ...bid, shape: { ...bid.shape, strategy: "custom", weights: [{ tickId: aligned - model.tickSpacing, weight: 1.5 }] } }), "BAD_INPUT");
  /* A weight above the program's own scale would be squeezed into it, and the proportions asked for would not be the proportions built. */
  await refused(() => resting.venue.orders.place({ ...bid, shape: { ...bid.shape, strategy: "custom", weights: [{ tickId: aligned - model.tickSpacing, weight: 256 }, { tickId: aligned - 2 * model.tickSpacing, weight: 1 }] } }), "BAD_INPUT");
  assert.equal((await resting.venue.orders.place({ ...bid, shape: { ...bid.shape, strategy: "custom", weights: [{ tickId: aligned - model.tickSpacing, weight: 255 }, { tickId: aligned - 2 * model.tickSpacing, weight: 1 }] } })).ticks.length, 2);
  assert.equal((await resting.venue.orders.place({ ...bid, shape: { ...bid.shape, strategy: "custom", weights: [{ tickId: aligned - model.tickSpacing, weight: 3 }, { tickId: aligned - 2 * model.tickSpacing, weight: 1 }] } })).ticks.length, 2);
  await refused(() => resting.venue.orders.place({ ...bid, totalAmountRaw: "9000000000000" }), "BALANCE_LOW");
});

test("rewards: a slot reads as running, and collecting is the SDK's refresh and claim", async () => {
  const { venue, sdk } = at("rewardsRunning");
  const model = await venue.pools.read(addresses.poolB);
  assert.deepEqual(model.extensions, { liquidityMining: true, activationAccess: false });
  assert.equal(model.rules, null);
  assert.equal(model.fee.mode, "fixed");
  assert.equal(model.fee.baseBps, 100);
  assert.equal(model.fee.settles, null);
  const rewards = await venue.rewards.read(addresses.poolB);
  assert.equal(rewards.length, 1);
  assert.equal(rewards[0].index, 0);
  assert.equal(rewards[0].mint, addresses.coin);
  assert.equal(rewards[0].authority, who.creator);
  assert.equal(rewards[0].running, true);
  assert.equal(rewards[0].endsAt - rewards[0].opensAt, 86_400);
  assert.deepEqual(model.rewards, rewards);
  assert.deepEqual(await venue.rewards.read(addresses.pool), [], "a pool without liquidity mining has no rewards");
  const collect = await venue.rewards.collect({ pool: addresses.poolB, nftMint: addresses.positionB, owner: who.creator });
  const read = assertSealed(collect, who.creator);
  const { positions } = await sdk.state.fetchPositionArrayWithPositions(derivePosition(key(addresses.positionB)), { withReward: true });
  const own = await sdk.reward.claimReward({ pool: key(addresses.poolB), nftMint: key(addresses.positionB), owner: key(who.creator), signer: key(who.creator), rewardMint: key(addresses.coin), rewardIndex: 0, bitmap: new BN(1), tickRanges: positions.map((slot) => ({ tickLowerId: slot.tickLowerId, tickUpperId: slot.tickUpperId })) });
  assert.deepEqual(read.instructions, ofSdk(own.tx));
  /* The transaction the rehearsal sent from this state paid the emission of the time passed. */
  const paid = eventsNamed(await venue.events.read(fixture.transactions.claimReward.signature), "evtClaimReward")[0];
  assert.equal(paid.data.rewardMint, addresses.coin);
  assert.equal(paid.data.owner, who.creator);
  assert.equal(paid.data.amount, ((BigInt(rewards[0].emissionPerSecondX64) * BigInt(fixture.transactions.claimReward.record.blockTime - rewards[0].opensAt)) >> 64n).toString());
  const refused = async (work, code) => assert.equal(await work().then(() => null, (error) => error.code), code);
  await refused(() => venue.rewards.fund({ pool: addresses.poolB, authority: who.creator, amountRaw: "1000000", seconds: 86_400 }), "BAD_INPUT");
  await refused(() => venue.rewards.fund({ pool: addresses.poolB, authority: who.creator, amountRaw: "1000000", seconds: 3_600 }), "BAD_INPUT");
  await refused(() => venue.rewards.initialize({ pool: addresses.poolB, creator: who.creator, rewardMint: addresses.coin }), "NOTHING_TO_DO");
  await refused(() => venue.rewards.initialize({ pool: addresses.pool, creator: who.creator, rewardMint: addresses.coin }), "BAD_INPUT");
  await refused(() => venue.rewards.withdrawIneligible({ pool: addresses.poolB, authority: who.creator }), "BAD_INPUT");
  await refused(() => venue.rewards.collect({ pool: addresses.poolB, nftMint: addresses.positionB, owner: who.stranger }), "BAD_INPUT");
});

test("the events of the recorded transactions decode to what happened", async () => {
  const { venue } = at("rewardsRunning");
  const names = {};
  for (const [name, entry] of Object.entries(fixture.transactions)) names[name] = (await venue.events.read(entry.signature)).map((event) => event.name);
  assert.deepEqual(names, {
    createPool: ["evtInitializePool"],
    positionOPEN: ["evtOpenPosition"],
    positionDEPOSIT: ["evtAddLiquidity"],
    positionLOCK: ["evtLockPermanent"],
    swapNoReferral: ["evtSwap"],
    swapReferral: ["evtSwap"],
    swapClimb: ["evtSwap"],
    placeAsks: ["evtOpenLimitOrder"],
    placeBids: ["evtOpenLimitOrder"],
    swapFillsAsks: ["evtSwap"],
    collectAsks: ["evtCancelLimitOrder"],
    closeAsks: ["evtCancelLimitOrder", "evtCloseLimitOrder"],
    swapFillsBids: ["evtSwap"],
    delegateOrder: ["evtUpdateLimitOrderDelegatePermission"],
    collectBidsByAgent: ["evtCancelLimitOrder"],
    claimFee: ["evtClaimFee"],
    compound: ["evtClaimFee", "evtAddLiquidity"],
    createPoolB: ["evtInitializePool"],
    createPoolD: ["evtInitializePool"],
    swapSolIn: ["evtSwap"],
    collectAsksE: ["evtCancelLimitOrder"],
    positionSingle: ["evtOpenPosition", "evtAddLiquidity"],
    initializeReward: ["evtInitializeReward"],
    fundReward: ["evtSetRewardEmission"],
    claimReward: ["evtClaimReward"],
    addLiquidity: ["evtAddLiquidity"],
    removeLiquidity: ["evtRemoveLiquidity"],
    delegatePosition: ["evtUpdatePositionDelegatePermission"],
    claimRewardByAgent: ["evtClaimReward"],
    withdrawIneligible: [],
    claimRewardBetween: ["evtClaimReward"],
    removeCompounded: ["evtRemoveLiquidity"],
    claimFeeByAgent: ["evtClaimFee"],
    wideOPEN: ["evtOpenPosition"],
    wideWIDEN: ["evtExpandPosition"],
    wideDEPOSIT: ["evtAddLiquidity"],
    collectSharedPartial: ["evtCancelLimitOrder"],
    collectAsksNoReferral: ["evtCancelLimitOrder"],
    collectBidsReferral: ["evtCancelLimitOrder"],
    collectFirstBatch: ["evtCancelLimitOrder"],
    /* A pool whose first price lies beyond its own bitmap makes the bitmap's extension with itself — and writes that to the log. */
    createPoolFar: ["evtInitializePool", "evtInitializeBitmapExtension"],
    createPoolFarDusted: ["evtInitializePool", "evtInitializeBitmapExtension"],
    removeInBand: ["evtRemoveLiquidity"],
    compoundOneSided: ["evtClaimFee", "evtAddLiquidity"],
    createPoolNear: ["evtInitializePool"],
    swapLongWalk: ["evtSwap"],
    swapPriority: ["evtSwap"],
    depositMakesExtension: ["evtAddLiquidity", "evtInitializeBitmapExtension"],
    orderMakesExtension: ["evtOpenLimitOrder", "evtInitializeBitmapExtension"],
    createPoolBadge: ["evtInitializePool"],
    createPoolOtherCreator: ["evtInitializePool"],
    claimRewardAccrued: ["evtClaimReward"],
    createPoolTime: ["evtInitializePool"],
    swapEarly: ["evtSwap"],
    initializeRewardUsdc: ["evtInitializeReward"],
    placeWideBand: ["evtOpenLimitOrder"],
    collectPastFrozen: ["evtClaimFee"],
  });
  {
    /* A pool made by one wallet for another: the event names both, each as what it is. */
    const made = eventsNamed(await venue.events.read(fixture.transactions.createPoolOtherCreator.signature), "evtInitializePool")[0].data;
    assert.deepEqual({ creator: made.creator, payer: made.payer }, { creator: who.maker, payer: who.creator });
    /* SOL as token X, and an opening an hour ahead of the pool's making. */
    const timed = eventsNamed(await venue.events.read(fixture.transactions.createPoolTime.signature), "evtInitializePool")[0].data;
    assert.equal(timed.tokenXMint, addresses.sol);
    assert.equal(Number(timed.activationPoint) - fixture.transactions.createPoolTime.record.blockTime, 3_600);
    /* The swap of an early swapper sold token X — SOL — for token Y before that opening. */
    const early = fixture.transactions.swapEarly;
    assert.ok(early.record.blockTime < Number(timed.activationPoint));
    assert.equal(eventsNamed(await venue.events.read(early.signature), "evtSwap")[0].data.swapForY, true);
  }
  const read = async (name) => venue.events.read(fixture.transactions[name].signature);

  const created = eventsNamed(await read("createPool"), "evtInitializePool")[0];
  assert.deepEqual(
    { pool: created.data.pool, creator: created.data.creator, payer: created.data.payer, x: created.data.tokenXMint, y: created.data.tokenYMint, type: created.data.poolType, spacing: created.data.tickSpacing, collect: created.data.collectFeeMode, opens: created.data.activationPoint, extensions: created.data.extensions },
    { pool: addresses.pool, creator: who.creator, payer: who.creator, x: addresses.coin, y: addresses.usdc, type: 2, spacing: terms.tickSpacing, collect: 1, opens: String(terms.opensAt), extensions: 2 },
  );
  assert.equal(created.via, "cpi");
  assert.equal(created.user, null);

  const bare = eventsNamed(await read("swapNoReferral"), "evtSwap")[0];
  assert.equal(bare.user, who.buyer, "the swap's trader is its instruction's signer: the event does not name one");
  assert.equal(bare.data.pool, addresses.pool);
  assert.equal(bare.data.swapForY, false);
  assert.equal(bare.data.amountIn, "100000000");
  assert.equal(bare.data.hostFee, "0");
  assert.deepEqual({ onInput: bare.data.feesOnInput, onX: bare.data.feesOnTokenX }, { onInput: true, onX: false }, "USDC in on an «only Y» pool: the fee is taken from the input");
  /* The first buyer after the opening paid the cliff: half of what went in, plus nothing for volatility yet. */
  const fee = ["mmFee", "protocolFee", "limitOrderFee", "hostFee", "partnerFee"].reduce((sum, part) => sum + BigInt(bare.data[part]), 0n);
  assert.equal(fee, 50_000_000n);
  /* A launch pool: a fifth of what liquidity earned is the protocol's. */
  assert.equal(bare.data.protocolFee, "10000000");
  assert.equal(bare.data.mmFee, "40000000");

  const referred = eventsNamed(await read("swapReferral"), "evtSwap")[0];
  assert.ok(BigInt(referred.data.hostFee) > 0n);
  assert.ok(isFifth(referred.data.hostFee, BigInt(referred.data.hostFee) + BigInt(referred.data.protocolFee)), "the referral is a fifth of the protocol's part");

  const sold = eventsNamed(await read("swapFillsBids"), "evtSwap")[0];
  assert.deepEqual({ forY: sold.data.swapForY, onInput: sold.data.feesOnInput, onX: sold.data.feesOnTokenX }, { forY: true, onInput: false, onX: false }, "the coin sold: the fee is taken from the USDC paid out");
  assert.ok(BigInt(sold.data.limitOrderFee) > 0n, "the sale filled bids");
  {
    /*
     * A swap that filled limit orders: its referral is paid on the swap's whole fee — the orders' part too. A fifth of
     * the protocol's rate on liquidity (a fifth, in a launch pool) over the whole fee: 4 % of it, each step of the walk
     * rounded down. Were it «a fifth of the protocol's part of what liquidity filled», it would be a twentieth of what
     * liquidity kept, and no more.
     */
    const part = (name) => BigInt(sold.data[name]);
    const whole = part("mmFee") + part("protocolFee") + part("limitOrderFee") + part("hostFee") + part("partnerFee");
    const due = (whole * 4n) / 100n;
    assert.ok(part("hostFee") <= due && due - part("hostFee") <= 64n, `${part("hostFee")} of ${whole}`);
    const ofLiquidityAlone = part("mmFee") / 20n;
    assert.ok(part("hostFee") > ofLiquidityAlone, "more than liquidity's part alone would give");
    const ofOrders = (part("limitOrderFee") * 8n) / 100n;
    assert.ok(part("hostFee") - ofLiquidityAlone <= ofOrders + 64n && ofOrders - (part("hostFee") - ofLiquidityAlone) <= 64n, "the rest is 4 % of the fee on what orders filled — of which their makers kept half");
  }

  const placed = eventsNamed(await read("placeBids"), "evtOpenLimitOrder")[0];
  assert.deepEqual({ owner: placed.data.owner, nft: placed.data.nftMint, ask: placed.data.isAskSide, referral: placed.data.referral, ticks: placed.data.actualTickLimitOrderAmount.length }, { owner: who.maker, nft: addresses.bids, ask: false, referral: who.referral, ticks: 5 });

  const byAgent = eventsNamed(await read("collectBidsByAgent"), "evtCancelLimitOrder")[0];
  assert.equal(byAgent.data.owner, who.maker, "a delegate signed; the owner is the owner");
  assert.equal(byAgent.accounts.includes(who.agent), true);
  assert.ok(BigInt(byAgent.data.referralFee) > 0n && isFifth(byAgent.data.referralFee, BigInt(byAgent.data.referralFee) + BigInt(byAgent.data.ownerFeeY)), "the order's referral took a fifth of the maker's fee");

  const locked = eventsNamed(await read("positionLOCK"), "evtLockPermanent")[0];
  assert.equal(locked.data.bps, 10_000);
  assert.equal(locked.data.liquidities.length, 45);
  const deposited = eventsNamed(await read("positionDEPOSIT"), "evtAddLiquidity")[0];
  assert.equal(deposited.data.amountY, "0");
  {
    /* What the chain took is what the SDK's arithmetic says the shape takes at the first price — the number the venue showed before the signature. */
    const before = at("beforeOpening");
    const { pool } = await before.sdk.state.fetchPoolWithExtensions(key(addresses.pool));
    const shape = buildLiquidityShape({ strategy: StrategyType.Curve, minTickId: terms.firstTick, maxTickId: terms.firstTick + (terms.positionColumns - 1) * terms.tickSpacing, tickSpacing: pool.tickSpacing, currentTickId: pool.tickCurrentId, maxRanges: 45 });
    const multiplier = multiplierFromAmounts({ ranges: shape.ranges, tickSpacing: pool.tickSpacing, currentTickId: pool.tickCurrentId, currentSqrtPrice: pool.sqrtPrice, amountX: new BN(terms.depositRaw), amountY: new BN(0), mintX: null, mintY: null, epoch: 0n });
    const takes = amountsFromShape({ ranges: shape.ranges, currentTickId: pool.tickCurrentId, currentSqrtPrice: pool.sqrtPrice, multiplier }).reduce((sum, item) => sum + BigInt(item.amountX.toString()), 0n);
    assert.equal(deposited.data.amountX, takes.toString());
    assert.ok(takes <= BigInt(terms.depositRaw) && takes > (BigInt(terms.depositRaw) * 999n) / 1000n);
  }
  assert.equal(await venue.events.read("1".repeat(64)), null, "a transaction the node does not keep reads as none");
  /* On a pool that pays its fee in the coin a swap gives, an ask's fee is in token X — and a referral that could not be paid took nothing. */
  const ghost = eventsNamed(await read("collectAsksNoReferral"), "evtCancelLimitOrder")[0];
  assert.ok(BigInt(ghost.data.ownerFeeX) > 0n && ghost.data.ownerFeeY === "0" && ghost.data.referralFee === "0", JSON.stringify(ghost.data));
  /* A transaction read without its inner instructions cannot be told — never «nothing happened». One that does not name the program has nothing to tell. */
  const record = fixture.transactions.swapNoReferral.record;
  const coder = new DlmmProClient(at("opened").connection).program.coder.events;
  const { transactionResponseOf } = await import("../../../solana/v1-tx.ts");
  const whole = transactionResponseOf(record);
  assert.equal(decodeDlmmProEvents(whole, DLMM_PRO_PROGRAM, coder).length, 1);
  assert.throws(() => decodeDlmmProEvents({ ...whole, meta: { ...whole.meta, innerInstructions: null } }, DLMM_PRO_PROGRAM, coder), (error) => error instanceof DlmmProRefusal && error.code === "FAILED");
  assert.deepEqual(decodeDlmmProEvents({ ...whole, meta: { ...whole.meta, innerInstructions: null } }, Keypair.generate().publicKey.toBase58(), coder), []);
});

test("whose NFTs: a wallet's positions and orders, and a pool's", async () => {
  const { venue } = at("afterTrading");
  const creator = await venue.holdings.ofWallet(who.creator);
  assert.deepEqual(creator, { positions: [{ nftMint: addresses.position, pool: addresses.pool }], orders: [] });
  const maker = await venue.holdings.ofWallet(who.maker);
  assert.equal(maker.positions.length, 0);
  assert.ok(maker.orders.some((order) => order.nftMint === addresses.bids && order.pool === addresses.pool));
  assert.deepEqual(await venue.holdings.ofWallet(who.agent), { positions: [], orders: [] }, "a delegate holds no NFT");
  const pool = await venue.holdings.ofPool(addresses.pool);
  assert.deepEqual(pool.positions, [addresses.position]);
  assert.ok(pool.orders.includes(addresses.bids) && !pool.orders.includes(addresses.asks), "a closed order is gone; a collected one stays until closed");
  /* An NFT kept in a token account that is not the associated one is left out: no build could act on it. */
  const snapshot = fixture.snapshots.afterTrading;
  const nftAccount = Object.entries(snapshot.accounts).find(([, entry]) => {
    const data = Buffer.from(entry.data, "base64");
    return data.length >= 72 && data.subarray(0, 32).equals(key(addresses.position).toBuffer()) && data.readBigUInt64LE(64) === 1n;
  });
  const elsewhere = Buffer.from(nftAccount[1].data, "base64");
  key(who.stranger).toBuffer().copy(elsewhere, 32);
  const odd = rpcConnection(snapshotSource({ ...snapshot, accounts: { ...snapshot.accounts, [Keypair.generate().publicKey.toBase58()]: { ...nftAccount[1], data: elsewhere.toString("base64") } } }, records));
  assert.deepEqual(await createDlmmProVenue({ connection: odd, referralOwner: null }).holdings.ofWallet(who.stranger), { positions: [], orders: [] });
});

test("what a collect says the owner receives is after the referral's fifth — and it is what the chain paid", async () => {
  /* The bids were filled; the agent the maker let collect them builds the collect the rehearsal then sent. */
  const { venue } = at("bidsFilled");
  const view = await venue.orders.read({ pool: addresses.pool, nftMint: addresses.bids });
  assert.equal(view.referral, who.referral);
  assert.equal(view.delegateMayCollect, true);
  const collect = await venue.orders.collect({ pool: addresses.pool, nftMint: addresses.bids, owner: who.maker, signer: who.agent });
  const paid = eventsNamed(await venue.events.read(fixture.transactions.collectBidsByAgent.signature), "evtCancelLimitOrder")[0].data;
  assert.equal(collect.expected.yRaw, paid.ownerAmountY, "to the owner, after the referral");
  assert.equal(collect.expected.xRaw, paid.ownerAmountX);
  assert.deepEqual(collect.referral, { account: addresses.referralAccount, mint: addresses.usdc, raw: paid.referralFee, receivedRaw: paid.referralFee }, "USDC takes no fee of its own: what the collect pays the referral is what its account receives");
  assert.equal(collect.gross.yRaw, (BigInt(paid.ownerAmountY) + BigInt(paid.referralFee)).toString(), "before it, what the fills add up to");
  assert.equal(collect.gross.yRaw, view.payout.yRaw);
  assert.ok(BigInt(paid.referralFee) > 0n && isFifth(paid.referralFee, view.feeShareRaw));
  assert.equal(collect.referralLeftOut, null);
  /* The order's model said it before the collect was built: the bonus, the owner's part and the referral's — the chain paid exactly those. */
  assert.deepEqual(view.bonus, { mint: addresses.usdc, raw: view.feeShareRaw, ownerRaw: paid.ownerFeeY, referralRaw: paid.referralFee, referralPaid: true });
  /* The delegate signs and pays the network; every account the payout goes to is the owner's. */
  const read = assertSealed(collect, who.agent);
  const cancel = read.instructions.find((ix) => ix.program === DLMM_PRO_PROGRAM);
  assert.equal(cancel.keys[11], addresses.referralAccount);
  assert.equal(cancel.keys[12], who.agent, "the signer");
  assert.deepEqual([cancel.keys[9], cancel.keys[10]], [getAssociatedTokenAddressSync(key(addresses.coin), key(who.maker), true, TOKEN_2022_PROGRAM_ID).toBase58(), getAssociatedTokenAddressSync(key(addresses.usdc), key(who.maker), true, TOKEN_PROGRAM_ID).toBase58()]);
  /*
   * Five ticks, each with its own fee share, on another pool. What the chain paid the referral there is the venue's own
   * share of the fee the ticks added up to, rounded down once; and `grossY` and `netY` are what the venue's build had
   * said before the signature, kept beside what the chain then paid: they differ by exactly that.
   */
  const { FEE_SHARES } = await import("./fee.ts");
  assert.equal(facts.bidsReferral.referralFee, (((BigInt(facts.bidsReferral.ownerFeeY) + BigInt(facts.bidsReferral.referralFee)) * BigInt(FEE_SHARES.referralOfOrderFeeBps)) / 10_000n).toString());
  assert.equal((BigInt(facts.bidsReferral.grossY) - BigInt(facts.bidsReferral.netY)).toString(), facts.bidsReferral.referralFee);
});

test("whatever stands at a referral's address is passed only if it can be paid: lamports, a frozen account or another coin leave the owner the whole fee", async () => {
  const snapshot = fixture.snapshots.bidsFilled;
  const account = snapshot.accounts[addresses.referralAccount];
  const withReferral = (entry) => {
    const accounts = { ...snapshot.accounts };
    if (entry === null) delete accounts[addresses.referralAccount];
    else accounts[addresses.referralAccount] = entry;
    return createDlmmProVenue({ connection: rpcConnection(snapshotSource({ ...snapshot, accounts }, records)), referralOwner: who.referral });
  };
  const changed = (change) => {
    const data = Buffer.from(account.data, "base64");
    change(data);
    return { ...account, data: data.toString("base64") };
  };
  const request = { pool: addresses.pool, nftMint: addresses.bids, owner: who.maker };
  const paid = await withReferral(account).orders.collect(request);
  assert.ok(paid.referral && BigInt(paid.referral.raw) > 0n);
  for (const [why, entry] of [
    ["nothing there", null],
    ["lamports someone sent there", { owner: SystemProgram.programId.toBase58(), lamports: 1_000_000, data: "" }],
    ["a frozen account", changed((data) => data.writeUInt8(2, 108))],
    ["an account of another coin", changed((data) => key(addresses.coin).toBuffer().copy(data, 0))],
  ]) {
    const venue = withReferral(entry);
    const collect = await venue.orders.collect(request);
    assert.equal(collect.referral, null, why);
    assert.equal(collect.referralLeftOut, "noAccount", why);
    const bonus = (await venue.orders.read({ pool: addresses.pool, nftMint: addresses.bids })).bonus;
    assert.deepEqual({ paid: bonus.referralPaid, referral: bonus.referralRaw, owner: bonus.ownerRaw }, { paid: false, referral: "0", owner: bonus.raw }, `${why}: the model says the owner keeps the whole bonus`);
    assert.deepEqual(collect.expected, collect.gross, `${why}: the owner is paid the whole fee`);
    assert.equal(BigInt(collect.expected.yRaw) - BigInt(paid.expected.yRaw), BigInt(paid.referral.raw), why);
    const cancel = opened(collect).instructions.find((ix) => ix.program === DLMM_PRO_PROGRAM);
    assert.equal(cancel.keys[11], DLMM_PRO_PROGRAM, `${why}: the optional account is left out`);
    /* Closing collects first: it is held up no more than the collect. */
    assert.equal((await venue.orders.close(request)).referral, null, why);
  }
  {
    /*
     * The account is there and can be paid by all that stands at its address — and the collect with it does not pass a
     * simulation (a Token-2022 account may refuse a transfer that carries no memo; its owner switches that on at will).
     * It is left out all the same, and says why.
     */
    const connection = rpcConnection(snapshotSource(snapshot, records, doesNotLand));
    const venue = createDlmmProVenue({ connection, referralOwner: who.referral });
    const collect = await venue.orders.collect(request);
    assert.deepEqual({ referral: collect.referral, leftOut: collect.referralLeftOut }, { referral: null, leftOut: "simulationFailed" });
    assert.deepEqual(collect.expected, collect.gross, "the owner is paid the whole fee");
    assert.equal(opened(collect).instructions.find((ix) => ix.program === DLMM_PRO_PROGRAM).keys[11], DLMM_PRO_PROGRAM);
    assert.equal((await venue.orders.close(request)).referralLeftOut, "simulationFailed", "closing collects first: it is held up no more than the collect");
    assert.ok(connection.asked.includes("simulateTransaction"));
    /* The model reads what stands at the address — it still says «can be paid»; the collect is what simulates. */
    assert.equal((await venue.orders.read({ pool: addresses.pool, nftMint: addresses.bids })).bonus.referralPaid, true);
    /* A node that does not simulate at all has shown nothing: the referral is left out the same — and the build says which of the two it was. */
    const mute = createDlmmProVenue({ connection: rpcConnection(frozen(snapshot, records)), referralOwner: who.referral });
    const unshown = await mute.orders.collect(request);
    assert.deepEqual({ referral: unshown.referral, leftOut: unshown.referralLeftOut }, { referral: null, leftOut: "simulationUnavailable" });
    assert.deepEqual(unshown.expected, unshown.gross, "the owner is paid the whole fee");
    assert.equal((await mute.orders.close(request)).referralLeftOut, "simulationUnavailable");
  }
  {
    /* A collect with no referral to pay rides on nothing optional, and is not simulated. */
    const moment = fixture.snapshots.ordersFilling;
    const connection = rpcConnection(snapshotSource(moment, records));
    const collect = await createDlmmProVenue({ connection, referralOwner: who.referral }).orders.collect({ pool: addresses.pool, nftMint: addresses.asks, owner: who.buyer });
    assert.deepEqual({ referral: collect.referral, leftOut: collect.referralLeftOut }, { referral: null, leftOut: null }, "the order names none");
    assert.equal(connection.asked.includes("simulateTransaction"), false);
  }
  /* A read that fails is a failure — never «no referral». */
  const source = snapshotSource(snapshot, records);
  const failing = createDlmmProVenue({ connection: rpcConnection({ ...source, account: (address) => { if (address === addresses.referralAccount) throw new Error("the node did not answer"); return source.account(address); } }), referralOwner: who.referral });
  assert.equal(await refused(() => failing.orders.collect(request)), "FAILED");
});

test("a delegate signs only what the holder let it: on the bytes, and refused before a signature otherwise", async () => {
  const { venue, sdk } = at("theEnd");
  /* The position of the pool with rewards: its holder let the agent collect fees and rewards, nothing else. */
  const view = await venue.positions.read({ pool: addresses.poolB, nftMint: addresses.positionB });
  assert.deepEqual(view.delegateMay, ["claimFee", "claimReward"]);
  assert.ok(BigInt(view.feeYRaw) > 0n, "the position holds a fee to collect");
  const position = { pool: addresses.poolB, nftMint: addresses.positionB, owner: who.creator };
  const { pool } = await sdk.state.fetchPoolWithExtensions(key(addresses.poolB));
  const claimable = await sdk.position.getClaimableFees({ pool: key(addresses.poolB), nftMint: key(addresses.positionB) });
  const collect = await venue.positions.collect({ ...position, signer: who.agent });
  const own = await sdk.position.claimFee({ pool: key(addresses.poolB), nftMint: key(addresses.positionB), owner: key(who.creator), signer: key(who.agent), tokenXMint: pool.tokenXMint, tokenYMint: pool.tokenYMint, tickRanges: claimable.tickRanges, bitmap: claimable.bitmap });
  assert.deepEqual(assertSealed(collect, who.agent).instructions, ofSdk(own.tx), "the agent pays the network and signs; the SDK's own claim, to the owner's accounts");
  assertSealed(await venue.rewards.collect({ ...position, signer: who.agent }), who.agent);
  for (const [why, work] of [
    ["take liquidity out", () => venue.positions.remove({ ...position, signer: who.agent, bps: 1_000, slippageBps: 100 })],
    ["add liquidity", () => venue.positions.add({ ...position, signer: who.agent, amountXRaw: "1000000", amountYRaw: "1000000", slippageBps: 100 })],
    ["collect as a stranger", () => venue.positions.collect({ ...position, signer: who.stranger })],
    ["collect a reward as a stranger", () => venue.rewards.collect({ ...position, signer: who.stranger })],
    ["collect for a wallet that is not the holder", () => venue.positions.collect({ ...position, owner: who.agent, signer: who.agent })],
    ["collect a reward of a position of another pool", () => venue.rewards.collect({ pool: addresses.poolB, nftMint: addresses.position, owner: who.creator })],
    /* A position of a pool without rewards has shorter slots: 45 of them, and one of a pool with rewards read the other way — whatever their number divides by. */
    ["collect a reward of a wide position of a pool without rewards", () => venue.rewards.collect({ pool: addresses.poolB, nftMint: addresses.positionD, owner: who.creator })],
    ["read a position of a pool with rewards as another pool's", () => venue.positions.read({ pool: addresses.pool, nftMint: addresses.positionB })],
    ["read a position of a pool without rewards as a pool's with them", () => venue.positions.read({ pool: addresses.poolB, nftMint: addresses.positionD })],
    ["collect the fees of a position named with another pool", () => venue.positions.collect({ pool: addresses.poolD, nftMint: addresses.positionB, owner: who.creator })],
    ["compound a position named with another pool", () => venue.positions.compound({ pool: addresses.pool, nftMint: addresses.positionB, owner: who.creator, slippageBps: 100 })],
    ["take liquidity out of a position named with another pool", () => venue.positions.remove({ pool: addresses.pool, nftMint: addresses.positionD, owner: who.creator, bps: 1_000, slippageBps: 100 })],
    ["read an order as a position", () => venue.positions.read({ pool: addresses.pool, nftMint: addresses.secondOrder })],
  ]) {
    assert.equal(await refused(work), "BAD_INPUT", why);
  }
  /* The maker's second order: the agent may collect it, a stranger may not. */
  const order = { pool: addresses.pool, nftMint: addresses.secondOrder, owner: who.maker };
  assert.equal((await venue.orders.read(order)).delegateMayCollect, true);
  const byAgent = await venue.orders.collect({ ...order, signer: who.agent });
  assert.equal(opened(byAgent).instructions.find((ix) => ix.program === DLMM_PRO_PROGRAM).keys[12], who.agent);
  assertSealed(byAgent, who.agent);
  assert.equal(await refused(() => venue.orders.collect({ ...order, signer: who.stranger })), "BAD_INPUT");
  /* An approval with an amount, or taken back, is no delegate: the program refuses both, and so does the build. */
  const snapshot = fixture.snapshots.theEnd;
  const { findNftAccount } = await import("@meteora-ag/dlmm-pro-sdk");
  const nftAccount = findNftAccount(key(addresses.positionB), key(who.creator)).toBase58();
  for (const [why, change] of [["an amount delegated", (data) => data.writeBigUInt64LE(1n, 121)], ["the approval taken back", (data) => data.writeUInt32LE(0, 72)]]) {
    const data = Buffer.from(snapshot.accounts[nftAccount].data, "base64");
    change(data);
    const connection = rpcConnection(snapshotSource({ ...snapshot, accounts: { ...snapshot.accounts, [nftAccount]: { ...snapshot.accounts[nftAccount], data: data.toString("base64") } } }, records));
    assert.equal(await refused(() => createDlmmProVenue({ connection, referralOwner: null }).positions.collect({ ...position, signer: who.agent })), "BAD_INPUT", why);
  }
});

test("an opening that needs two calls: the chain widened the position, and the build names no layout version", async () => {
  /* The rehearsal's own position of 45 nested ranges — more new ticks in one tick array than one call may add. */
  assert.deepEqual(facts.wide.roles, ["OPEN", "WIDEN", "DEPOSIT"]);
  const { venue } = at("theEnd");
  const view = await venue.positions.read({ pool: addresses.poolD, nftMint: addresses.positionD });
  assert.equal(view.slots.length, facts.wide.ranges);
  assert.equal(view.layoutVersion, facts.wide.layoutVersionAfter);
  assert.ok(view.slots.every((slot) => BigInt(slot.liquidity) > 0n), "every range of the shape was funded after the widening");
  /* The same shape built again: the same three steps, and the deposit carries no expected version — the venue does not lean on what a widening does to it. */
  const model = await venue.pools.read(addresses.poolD);
  /* The same ticks the recorded position stands on: its outermost range, the last column one spacing short of its upper tick. */
  const minTickId = Math.min(...view.slots.map((slot) => slot.tickLowerId));
  const maxTickId = Math.max(...view.slots.map((slot) => slot.tickUpperId)) - model.tickSpacing;
  const nftMint = Keypair.generate().publicKey;
  const build = await venue.positions.open({ pool: addresses.poolD, wallet: who.creator, nftMint: nftMint.toBase58(), shape: { strategy: "curve", layout: "horizontal", minTickId, maxTickId }, amountXRaw: "1000000000000", amountYRaw: "1000000000000", slippageBps: 100 });
  const roles = build.steps.map((step) => step.role);
  assert.ok(roles[0] === "OPEN" && roles.includes("WIDEN") && roles[roles.length - 1] === "DEPOSIT", roles.join());
  assert.ok(build.shape.ranges.length > 32 && build.shape.ranges.length <= 45, String(build.shape.ranges.length));
  const deposit = opened(build.steps[build.steps.length - 1]).instructions.find((ix) => ix.program === DLMM_PRO_PROGRAM);
  const without = encodeAddLiquidityByWeight({ ranges: build.shape.ranges, maxAmountX: new BN(build.deposit.maximumXRaw), maxAmountY: new BN(build.deposit.maximumYRaw), multiplier: new BN(build.deposit.multiplier) });
  const sdkOwn = await at("theEnd").sdk.position.addLiquidityByWeight({ pool: key(addresses.poolD), nftMint, owner: key(who.creator), signer: key(who.creator), tokenXMint: key(model.tokenX.mint), tokenYMint: key(model.tokenY.mint), tickRanges: build.shape.ranges.map(({ tickLowerId, tickUpperId }) => ({ tickLowerId, tickUpperId })), parameters: without });
  assert.deepEqual(deposit, ofSdk(sdkOwn.tx).find((ix) => ix.program === DLMM_PRO_PROGRAM));
  for (const step of build.steps) assert.ok(step.bytes <= MAX_TX_BYTES);
  /*
   * What trades did to a deposit built for a band of the price — `built` is the venue's own build, kept beside what the
   * chain then took. The price moved inside the band: the deposit landed within its caps, and took other amounts than
   * at the build's price — more of the coin the pool then had less of.
   */
  const moved = facts.movedDeposit;
  assert.ok(moved.movedBps >= 30 && moved.movedBps < moved.bandBps && moved.movedBps > moved.narrowBandBps, `moved ${moved.movedBps} bps in a band of ${moved.bandBps}`);
  assert.ok(BigInt(moved.tookX) <= BigInt(moved.built.maximumXRaw) && BigInt(moved.tookY) <= BigInt(moved.built.maximumYRaw));
  assert.ok(BigInt(moved.tookX) < BigInt(moved.built.xRaw) && BigInt(moved.tookY) > BigInt(moved.built.yRaw), "buyers took token X out of the pool: at the higher price the deposit takes less of it and more of token Y");
});

test("a build that would need another's signature, or does not fit a message, is refused — never returned", async () => {
  const { connection } = at("opened");
  const wallet = key(who.creator);
  const other = key(who.stranger);
  const needs = (signer) => ({ programId: key(DLMM_PRO_PROGRAM), keys: [{ pubkey: signer, isSigner: true, isWritable: false }], data: Buffer.from([1]) });
  const refusal = (work) => work().then(() => null, (error) => error.code);
  assert.equal(await refusal(() => seal({ connection, wallet, instructions: [needs(other)], units: 1_000 })), "FOREIGN_SIGNER");
  assert.deepEqual((await seal({ connection, wallet, instructions: [needs(other)], units: 1_000, fresh: [other] })).cosigners, [who.stranger]);
  assert.equal(await refusal(() => seal({ connection, wallet, instructions: [], units: 1_000 })), "NOTHING_TO_DO");
  const wide = { programId: key(DLMM_PRO_PROGRAM), keys: Array.from({ length: 40 }, () => ({ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false })), data: Buffer.alloc(8) };
  assert.equal(await refusal(() => seal({ connection, wallet, instructions: [wide], units: 1_000 })), "TX_TOO_LARGE");
  /* A caller's limit is a whole number the network takes; its priority price cannot cost more than the venue's ceiling over that limit. */
  for (const units of [Number.NaN, 0, 1.5, 1_400_001]) assert.equal(await refusal(() => seal({ connection, wallet, instructions: [needs(wallet)], units: 1_000, options: { units } })), "BAD_INPUT", String(units));
  assert.equal(await refusal(() => seal({ connection, wallet, instructions: [needs(wallet)], units: Number.NaN })), "FAILED");
  const dearest = Math.floor((MAX_PRIORITY_FEE_LAMPORTS * 1_000_000) / 200_000);
  assert.equal((await seal({ connection, wallet, instructions: [needs(wallet)], units: 200_000, options: { priorityMicroLamports: dearest } })).units, 200_000);
  assert.equal(await refusal(() => seal({ connection, wallet, instructions: [needs(wallet)], units: 200_000, options: { priorityMicroLamports: dearest + 5 } })), "BAD_INPUT");
  assert.equal(await refusal(() => seal({ connection, wallet, instructions: [needs(wallet)], units: 200_000, options: { priorityMicroLamports: 5_000_000_000 } })), "BAD_INPUT", "lamports typed as micro-lamports");
  /* An SDK that one day adds its own compute budget does not get two. */
  const sealed = await seal({ connection, wallet, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 7 }), needs(wallet)], units: 55_555 });
  assert.equal(opened(sealed).budget.length, 1);
  assert.equal(sealed.units, 55_555);
  /* Parts pack in order into the fewest transactions; a part is never split. */
  const part = (role, count) => ({ role, units: 100_000, instructions: [{ programId: key(DLMM_PRO_PROGRAM), keys: Array.from({ length: count }, () => ({ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false })), data: Buffer.alloc(8) }] });
  const packed = await sealPacked({ connection, wallet, parts: [part("a", 10), part("b", 10), part("c", 20), part("d", 5)] });
  assert.deepEqual(packed.map((tx) => tx.roles), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(packed.map((tx) => tx.units), [200_000, 200_000]);
  assert.equal(new Set(packed.map((tx) => opened(tx).bytes <= MAX_TX_BYTES)).has(false), false);
  assert.equal((await sealPacked({ connection, wallet, parts: [{ ...part("x", 2), units: 900_000 }, { ...part("y", 2), units: 900_000 }] })).length, 2, "two parts over the compute limit together are two transactions");
  /* What a build costs the network: every signature, and a priority price over the whole limit, rounded up. */
  assert.equal((await seal({ connection, wallet, instructions: [needs(wallet)], units: 1_000 })).feeLamports, LAMPORTS_PER_SIGNATURE);
  assert.equal((await seal({ connection, wallet, instructions: [needs(other)], units: 1_000, fresh: [other] })).feeLamports, 2 * LAMPORTS_PER_SIGNATURE, "the wallet's and the fresh key's");
  assert.equal((await seal({ connection, wallet, instructions: [needs(wallet)], units: 200_001, options: { priorityMicroLamports: 7 } })).feeLamports, LAMPORTS_PER_SIGNATURE + 2, "200 001 units at 7 micro-lamports: 1.400007 lamports, rounded up");
  /*
   * A priority price is paid over a transaction's whole limit. Two parts that fit one message and one compute limit —
   * but whose joined limit would carry the price past the venue's ceiling — stay apart, each within it; without a
   * price, or at a price both afford together, they are one transaction.
   */
  const heavy = [{ ...part("first", 2), units: 600_000 }, { ...part("second", 2), units: 600_000 }];
  const price = Math.floor((MAX_PRIORITY_FEE_LAMPORTS * 1_000_000) / 600_000);
  assert.equal((await sealPacked({ connection, wallet, parts: heavy })).length, 1);
  assert.equal((await sealPacked({ connection, wallet, parts: heavy, options: { priorityMicroLamports: Math.floor(price / 2) } })).length, 1);
  const apart = await sealPacked({ connection, wallet, parts: heavy, options: { priorityMicroLamports: price } });
  assert.deepEqual(apart.map((tx) => tx.roles), [["first"], ["second"]]);
  assert.ok(apart.every((tx) => tx.feeLamports - LAMPORTS_PER_SIGNATURE <= MAX_PRIORITY_FEE_LAMPORTS));
});

test("the sizes the rent is reckoned from are the sizes the program made, in the recorded transactions", () => {
  const sorted = (list) => [...list].sort((a, b) => a - b);
  /** Takes one account of a size out of a list — so what is left is the rest. */
  const pull = (list, match, what) => {
    const index = list.findIndex(match);
    assert.ok(index >= 0, `${what}: none among ${list.join()}`);
    return list.splice(index, 1)[0];
  };
  const nft = (list) => {
    pull(list, (size) => size === SIZES.nftAccount, "the NFT's account");
    return pull(list, (size) => size > 400 && size <= SIZES.nftMint, "the NFT's mint, within what the venue allows for its metadata");
  };
  /* A pool by the tails it is created with: opening rules, liquidity mining, neither. */
  assert.deepEqual(sorted(chargedIn("createPool").made), sorted([SIZES.pool + SIZES.poolActivation, SIZES.oracle, SIZES.tokenAccount, SIZES.tokenAccount]));
  assert.deepEqual(sorted(chargedIn("createPoolB").made), sorted([SIZES.pool + SIZES.poolRewards, SIZES.oracle, SIZES.tokenAccount, SIZES.tokenAccount]));
  assert.deepEqual(sorted(chargedIn("createPoolD").made), sorted([SIZES.pool, SIZES.oracle, SIZES.tokenAccount, SIZES.tokenAccount]));
  {
    /* The launch's position: 45 ranges in five new tick arrays. Neighbouring ranges share a tick — 46 ticks in all — and every range paid for its two. */
    const made = [...chargedIn("positionOPEN").made];
    assert.equal(nft(made), 511);
    pull(made, (size) => size === SIZES.positionHead + 45 * SIZES.positionSlot, "the position: its head and 45 slots");
    assert.equal(made.length, 5, "five tick arrays");
    assert.equal(sum(made), 5 * SIZES.tickArrayHead + 2 * 45 * SIZES.tick);
  }
  {
    /* On a pool with liquidity mining a slot and a tick are longer. */
    const made = [...chargedIn("positionSingle").made];
    nft(made);
    pull(made, (size) => size === SIZES.positionHead + SIZES.positionSlotWithRewards, "the position: its head and one slot with rewards");
    assert.deepEqual(made, [SIZES.tickArrayHead + 2 * SIZES.tickWithRewards]);
  }
  {
    /* A position widened: the second call adds slots to the position and ticks to the array that is there. */
    const made = [...chargedIn("wideOPEN").made];
    nft(made);
    const slots = (pull(made, (size) => (size - SIZES.positionHead) % SIZES.positionSlot === 0 && size < 6_000, "the position") - SIZES.positionHead) / SIZES.positionSlot;
    assert.deepEqual(made, [SIZES.tickArrayHead + 2 * slots * SIZES.tick]);
    assert.equal(sum(chargedIn("wideWIDEN").grown), (facts.wide.ranges - slots) * (SIZES.positionSlot + 2 * SIZES.tick));
  }
  for (const [name, ticks] of [["placeAsks", 10], ["placeBids", 5]]) {
    /* An order: its head and an entry a tick; and a tick each in the arrays that were there. */
    const { made, grown } = chargedIn(name);
    const rest = [...made];
    assert.equal(nft(rest), 514, name);
    assert.deepEqual(rest, [SIZES.orderHead + ticks * SIZES.orderEntry], name);
    assert.equal(sum(grown), ticks * SIZES.tick, name);
  }
  /* Token accounts: the classic program's, and Token-2022's with what a coin's account may carry — a transfer fee's withheld amount among it. */
  assert.deepEqual(chargedIn("initializeReward").made, [SIZES.tokenAccount]);
  assert.deepEqual(chargedIn("swapNoReferral").made, [170]);
  const [withFee] = chargedIn("swapSolIn").made;
  assert.ok(withFee > 170 && withFee <= SIZES.tokenAccount2022, String(withFee));
});

test("the rent a build tells is the rent the chain took for the same thing — to the spare bytes the venue allows", async () => {
  /* A position of the launch's own shape, opened again where the launch's stands: the tick arrays are there now, and nothing else is cheaper — every tick is paid for again. */
  const shape = { strategy: "curve", minTickId: terms.firstTick, maxTickId: terms.firstTick + (terms.positionColumns - 1) * terms.tickSpacing };
  const position = await at("opened").venue.positions.open({ pool: addresses.pool, wallet: who.creator, nftMint: Keypair.generate().publicKey.toBase58(), shape, amountXRaw: "50000000000000", amountYRaw: "0", slippageBps: 0 });
  const launch = chargedIn("positionOPEN");
  assert.equal(position.shape.ranges.length, 45);
  assert.equal(position.rentLamports, launch.rent - 5 * rentOf(SIZES.tickArrayHead) + (SIZES.nftMint - 511) * RENT_PER_BYTE);
  assert.equal(sum(position.steps.map((step) => step.feeLamports)), 3 * LAMPORTS_PER_SIGNATURE, "the opening is signed by the wallet and the fresh mint; the deposit by the wallet");
  assert.equal(launch.fee, position.steps[0].feeLamports);

  /* A ladder of five bids where the recorded one was placed: the same rent — and, its ticks being relative, a head for the tick arrays it may make where it lands. */
  const model = await at("ordersResting").venue.pools.read(addresses.pool);
  const aligned = Math.floor(model.tickId / model.tickSpacing) * model.tickSpacing;
  const ladder = { pool: addresses.pool, wallet: who.maker, nftMint: Keypair.generate().publicKey.toBase58(), side: "bid", shape: { strategy: "bidAsk", minTickId: aligned - 5 * model.tickSpacing, maxTickId: aligned - model.tickSpacing }, totalAmountRaw: "600000000" };
  const bids = chargedIn("placeBids");
  const fixed = await at("ordersResting").venue.orders.place({ ...ladder, slippageTicks: null });
  assert.equal(fixed.rentLamports, bids.rent + (SIZES.nftMint - 514) * RENT_PER_BYTE);
  /* Two ticks of the spacing either way: here every tick array in reach is there, so nothing more. A band that reaches where no array is yet counts those — no more of them than the ladder can stand in at once. */
  const relative = await at("ordersResting").venue.orders.place({ ...ladder, slippageTicks: 2 * model.tickSpacing });
  assert.equal(relative.rentLamports, fixed.rentLamports);
  const far = await at("ordersResting").venue.orders.place({ ...ladder, slippageTicks: 200 * model.tickSpacing });
  const heads = (far.rentLamports - fixed.rentLamports) / rentOf(SIZES.tickArrayHead);
  assert.ok(Number.isInteger(heads) && heads >= 1 && heads <= 2, `${heads} tick arrays in reach are not there yet`);
  {
    /*
     * The number itself, on the pool of two coins, far above its price, where no tick array is yet. A relative order
     * lands shifted with the price, so it is told a head for the arrays it may make where it lands: of those missing
     * in its reach, no more than its ticks can stand in at once — two for a ladder narrower than an array, which may
     * land across a boundary between two.
     */
    const { venue } = at("theEnd");
    const ARRAY = 128 * 100;
    const head = rentOf(SIZES.tickArrayHead);
    const rentOfOrder = async (minTickId, maxTickId, slippageTicks) =>
      (await venue.orders.place({ pool: addresses.poolD, wallet: who.creator, nftMint: Keypair.generate().publicKey.toBase58(), side: "ask", shape: { strategy: "spot", minTickId, maxTickId }, totalAmountRaw: "50000000", slippageTicks, referralWallet: null })).rentLamports;
    /* Two fixed ticks in the tick array the price is in: nothing is made but the order. */
    const model = await venue.pools.read(addresses.poolD);
    const near = Math.floor(model.tickId / 100) * 100 + 300;
    assert.equal(Math.floor(near / ARRAY), Math.floor((near + 100) / ARRAY), "both ticks in the price's own array");
    const base = await rentOfOrder(near, near + 100, null);
    /* Fixed ticks either side of a boundary between two arrays that are not there: both are made. */
    assert.equal((await rentOfOrder(3 * ARRAY - 100, 3 * ARRAY, null)) - base, 2 * head);
    /* The same two ticks, relative: both still — the bound is never below what the order makes where it stands. */
    assert.equal((await rentOfOrder(3 * ARRAY - 100, 3 * ARRAY, 100)) - base, 2 * head);
    /* Two ticks inside one array that is not there, a band that stays inside it: that one. */
    assert.equal((await rentOfOrder(3 * ARRAY + 2_000, 3 * ARRAY + 2_100, 100)) - base, head);
    /* And a band that reaches several arrays that are not there: two — what two ticks can stand in at once — not every one in reach. */
    assert.equal((await rentOfOrder(3 * ARRAY + 2_000, 3 * ARRAY + 2_100, 300 * 100)) - base, 2 * head);
  }
  /* The SDK passes the same reach to the program — every tick array the order may land in — so a band too wide for a message is refused before a signature. */
  assert.equal(await refused(() => at("ordersResting").venue.orders.place({ ...ladder, slippageTicks: 4_000 * model.tickSpacing })), "TX_TOO_LARGE");
  assert.equal(fixed.feeLamports, bids.fee);

  /* The pool the rehearsal then made of the two coins, built on the state before it: the pool and its oracle to the byte, each Token-2022 vault with room for what such an account may carry. */
  const pool = await at("rewardsRunning").venue.pools.buildLaunchPool({ wallet: who.creator, tokenX: addresses.coin, tokenY: addresses.coinB, tickSpacing: 100, initialTickId: 6_400, baseFee: { kind: "fixed", bps: 100 }, dynamicFee: false, collectFee: "output" });
  const made = chargedIn("createPoolD");
  assert.equal(pool.pool, addresses.poolD);
  assert.equal(pool.rentLamports - made.rent, 2 * (SIZES.tokenAccount2022 - SIZES.tokenAccount) * RENT_PER_BYTE);
  assert.equal(pool.feeLamports, made.fee);
  /* With opening rules and liquidity mining both, the pool is longer by both tails — more than either recorded pool. */
  const clock = fixture.snapshots.rewardsRunning.clock;
  const both = await at("rewardsRunning").venue.pools.buildLaunchPool({ wallet: who.creator, tokenX: addresses.coin, tokenY: addresses.coinB, tickSpacing: 100, initialTickId: 6_400, baseFee: { kind: "fixed", bps: 100 }, dynamicFee: false, collectFee: "output", liquidityMining: true, opening: { swapAt: clock.unix + 600 } });
  assert.equal(both.rentLamports - pool.rentLamports, (SIZES.poolActivation + SIZES.poolRewards) * RENT_PER_BYTE);
});

test("a build is refused when its wallet cannot pay for it — to the lamport: its fee, the rent of what it makes, and what a wallet must keep", async () => {
  /* The first buyer's swap after the opening, as the rehearsal then sent it: it opens the buyer's account of the coin. */
  const request = { pool: addresses.pool, inputMint: addresses.usdc, amountInRaw: "100000000", slippageBps: 300, wallet: who.buyer };
  const told = await at("opened").venue.swap.build(request);
  assert.equal(told.feeLamports, LAMPORTS_PER_SIGNATURE);
  /* The account of a Token-2022 coin is as long as the coin's own extensions make it: this coin's adds nothing to an account but the mark that its owner cannot change. */
  assert.equal(told.rentLamports, rentOf(170));
  assert.deepEqual({ returned: told.rentReturnedLamports, unwraps: told.unwrapsLamports }, { returned: 0, unwraps: null }, "the account stays: nothing of its rent comes back");
  const needed = told.feeLamports + told.rentLamports + rentOf(0);
  const holding = (lamports) => withAccounts("opened", { [who.buyer]: { lamports } }).venue;
  assert.equal(await refused(() => holding(needed - 1).swap.build(request)), "BALANCE_LOW");
  assert.equal((await holding(needed).swap.build(request)).wireBase64.length, told.wireBase64.length);
  /* A priority price is part of what it costs — over the whole limit. */
  const price = 25_000;
  assert.equal(await refused(() => holding(needed).swap.build(request, { priorityMicroLamports: price })), "BALANCE_LOW");
  const priority = Math.ceil((told.units * price) / 1_000_000);
  assert.equal((await holding(needed + priority).swap.build(request, { priorityMicroLamports: price })).feeLamports, LAMPORTS_PER_SIGNATURE + priority);
  assert.equal(await refused(() => holding(needed + priority - 1).swap.build(request, { priorityMicroLamports: price })), "BALANCE_LOW");
  /* What the chain then took: that fee, and the rent of the account as it was made — the venue's number, to the lamport. */
  const chain = chargedIn("swapNoReferral");
  assert.equal(chain.fee, told.feeLamports);
  assert.equal(told.rentLamports, chain.rent);
  /* A frozen account of the wallet's pays for nothing: the build is refused, not left to fail in the token program. */
  const usdcOfBuyer = getAssociatedTokenAddressSync(key(addresses.usdc), key(who.buyer), true, TOKEN_PROGRAM_ID).toBase58();
  const frozenData = Buffer.from(fixture.snapshots.opened.accounts[usdcOfBuyer].data, "base64");
  frozenData.writeUInt8(2, 108);
  assert.equal(await refused(() => withAccounts("opened", { [usdcOfBuyer]: { data: frozenData.toString("base64") } }).venue.swap.build(request)), "BAD_INPUT", "the wallet's account of the coin it spends is frozen");
  {
    /* And an account the swap would pay into: later, when the buyer holds the coin, its account of the coin is frozen — nothing arrives in a frozen account, and the token program would fail the swap there. */
    const coinOfBuyer = getAssociatedTokenAddressSync(key(addresses.coin), key(who.buyer), true, TOKEN_2022_PROGRAM_ID).toBase58();
    const held = Buffer.from(fixture.snapshots.ordersResting.accounts[coinOfBuyer].data, "base64");
    assertSealed(await at("ordersResting").venue.swap.build(request), who.buyer);
    held.writeUInt8(2, 108);
    const frozenOut = withAccounts("ordersResting", { [coinOfBuyer]: { data: held.toString("base64") } }).venue;
    assert.equal(await refused(() => frozenOut.swap.build(request)), "BAD_INPUT", "the wallet's account of the coin it is paid is frozen");
    assert.ok(BigInt((await frozenOut.swap.quote(request)).amountOutRaw) > 0n, "a quote is a quote: it builds nothing");
  }
  {
    /*
     * A coin that freezes every new account of it — Token-2022's default account state. At the opening the buyer has no
     * account of the coin, and the swap opens one: it would be frozen the moment it is made, and take nothing.
     */
    const DEFAULT_ACCOUNT_STATE = 6;
    const [INITIALIZED, FROZEN] = [1, 2];
    const coinBorn = (state) => ({ [addresses.coin]: mintWith(DEFAULT_ACCOUNT_STATE, Buffer.from([state])) });
    assert.equal(await refused(() => withAccounts("opened", coinBorn(FROZEN)).venue.swap.build(request)), "BAD_INPUT", "every new account of the coin is frozen");
    assertSealed(await withAccounts("opened", coinBorn(INITIALIZED)).venue.swap.build(request), who.buyer);
    /* An account that is there already is not one the build opens: it is as its owner and the coin's authority left it. */
    assertSealed(await withAccounts("ordersResting", coinBorn(FROZEN)).venue.swap.build(request), who.buyer);
  }
  /* A build that makes nothing costs its fee alone; a wallet with less than that and its own minimum is told so too. */
  const collect = { pool: addresses.pool, nftMint: addresses.position, owner: who.creator };
  const fees = await at("ordersFilling").venue.positions.collect(collect);
  assert.equal(fees.rentLamports, 0);
  const poor = withAccounts("ordersFilling", { [who.creator]: { lamports: fees.feeLamports + rentOf(0) - 1 } }).venue;
  assert.equal(await refused(() => poor.positions.collect(collect)), "BALANCE_LOW");
});

test("a compound is the SDK's own, held to a band of the price around the build's", async () => {
  const { venue, sdk } = at("bidsFilled");
  const { pool } = await sdk.state.fetchPoolWithExtensions(key(addresses.pool));
  const square = BigInt(pool.sqrtPrice.toString()) ** 2n;
  const end = (bps) => new BN(isqrt((square * BigInt(10_000 + bps)) / 10_000n).toString());
  const wallet = key(who.creator);
  const request = { pool: addresses.pool, nftMint: addresses.position, owner: who.creator };
  const own = (slot, slippage) => sdk.position.compoundFees({ pool: key(addresses.pool), nftMint: key(addresses.position), owner: wallet, signer: wallet, tokenXMint: pool.tokenXMint, tokenYMint: pool.tokenYMint, index: slot, ...(slippage ? { slippage } : {}) });
  const build = await venue.positions.compound({ ...request, slippageBps: 100 });
  const held = await own(build.slot, { sqrtPriceSlippage: { minSqrtPrice: end(-100), maxSqrtPrice: end(100) }, minLiquidity: null });
  assert.deepEqual(assertSealed(build, who.creator).instructions, ofSdk(held.tx));
  /* Without the band the SDK's own compound goes in at whatever price it lands at: other bytes. */
  assert.notDeepEqual(ofSdk((await own(build.slot, null)).tx), ofSdk(held.tx));
  /* A band of nothing is the build's price itself. */
  const exact = await venue.positions.compound({ ...request, slippageBps: 0 });
  assert.deepEqual(opened(exact).instructions, ofSdk((await own(exact.slot, { sqrtPriceSlippage: { minSqrtPrice: pool.sqrtPrice, maxSqrtPrice: pool.sqrtPrice }, minLiquidity: null })).tx));
  /* What it says is there to put back is what the claim delivers: this pool's fee is in USDC alone. */
  const view = await venue.positions.read({ pool: addresses.pool, nftMint: addresses.position });
  assert.deepEqual(build.expected, { xRaw: "0", yRaw: view.feeYRaw });
  assert.equal(await refused(() => venue.positions.compound({ ...request, slippageBps: 5_001 })), "BAD_INPUT");
});

test("a swap of SOL wraps out of the wallet, and is held to the amount and its own cost together", async () => {
  const { venue, sdk } = at("solPool");
  const model = await venue.pools.read(addresses.poolE);
  assert.deepEqual({ x: model.tokenX.mint, xProgram: model.tokenX.program, y: model.tokenY.mint, yDecimals: model.tokenY.decimals, fee: model.fee.collectedIn }, { x: addresses.coinE, xProgram: "token-2022", y: addresses.sol, yDecimals: 9, fee: "output" });
  /* The swap the rehearsal then sent from this very state. */
  const request = { pool: addresses.poolE, inputMint: addresses.sol, amountInRaw: "500000000", slippageBps: 500, wallet: who.buyer };
  const build = await venue.swap.build(request);
  const read = assertSealed(build, who.buyer);
  const direct = await sdk.pool.quoteExactIn({ pool: key(addresses.poolE), inputAmount: new BN(request.amountInRaw), swapForY: false, hasReferral: false, swapper: key(who.buyer) });
  const { pool } = await sdk.state.fetchPoolWithExtensions(key(addresses.poolE));
  const own = await sdk.pool.swap({ pool: key(addresses.poolE), tokenXMint: pool.tokenXMint, tokenYMint: pool.tokenYMint, user: key(who.buyer), swapForY: false, tickArrays: direct.tickArrays, tickArrayBitmapExtension: direct.tickArrayBitmapExtension, parameters: { inputAmount: new BN(request.amountInRaw), minimumOutputAmount: new BN(build.quote.minimumOutRaw) } });
  assert.deepEqual(read.instructions, ofSdk(own.tx));
  /* The buyer has neither account: both are opened, the SOL is moved into the wrapped one before the swap, and that one is closed after it. */
  const ASSOCIATED = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  assert.deepEqual(read.instructions.map((ix) => ix.program), [ASSOCIATED, SystemProgram.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58(), ASSOCIATED, DLMM_PRO_PROGRAM, TOKEN_PROGRAM_ID.toBase58()]);
  assert.equal(build.quote.referral, false, "Ryntra's account in the coin is not there yet");
  /* What arrives is after the coin's own transfer fee — less than the pool pays out. */
  assert.equal(build.quote.amountOutRaw, direct.quote.transferFeeExcludedOutAmount.toString());
  assert.ok(BigInt(build.quote.amountOutRaw) < BigInt(direct.quote.outAmount.toString()), "the coin takes its fee on the way to the wallet");
  /*
   * What the swap tells of its rent. The coin's account stays — as long as the coin's transfer fee makes an account of
   * it, as the chain then made it. The wrapped-SOL account is opened and closed by the swap itself: its rent comes back.
   */
  const chain = chargedIn("swapSolIn");
  const [coinAccount] = chain.made;
  assert.equal(coinAccount, 182, "an account of a coin with a transfer fee: its 165 bytes, the mark of its owner, the fee it withholds");
  assert.deepEqual({ rent: build.rentLamports, returned: build.rentReturnedLamports, unwraps: build.unwrapsLamports }, { rent: rentOf(coinAccount) + rentOf(SIZES.tokenAccount), returned: rentOf(SIZES.tokenAccount), unwraps: null });
  const stays = build.rentLamports - build.rentReturnedLamports;
  /*
   * What the wallet must hold, to the lamport: the amount, the fee, the rent that stays — and the larger of the rent
   * that comes back and what a wallet keeps to exist. The first is out of the wallet only in the middle of the
   * transaction, the second is asked of it only at the end; their sum would refuse a wallet the chain takes.
   */
  assert.ok(build.rentReturnedLamports > rentOf(0), "here the rent that comes back is the larger of the two");
  const needed = Number(request.amountInRaw) + build.feeLamports + stays + build.rentReturnedLamports;
  const holding = (lamports) => withAccounts("solPool", { [who.buyer]: { lamports } }).venue;
  assert.equal(await refused(() => holding(needed - 1).swap.build(request)), "BALANCE_LOW");
  assertSealed(await holding(needed).swap.build(request), who.buyer);
  assert.equal(await refused(() => holding(Number(request.amountInRaw) + build.feeLamports).swap.build(request)), "BALANCE_LOW", "the amount and the network fee are not enough");
  /*
   * Wrapped SOL the wallet already holds is spent first: only the rest comes out of its lamports. The swap opens no
   * wrapped-SOL account then — and closes the one that was there, as the SDK's builds do: the build says what it held.
   */
  const wrapped = getAssociatedTokenAddressSync(NATIVE_MINT, key(who.buyer), true, TOKEN_PROGRAM_ID).toBase58();
  const account = Buffer.alloc(165);
  NATIVE_MINT.toBuffer().copy(account, 0);
  key(who.buyer).toBuffer().copy(account, 32);
  account.writeBigUInt64LE(200_000_000n, 64);
  account.writeUInt8(1, 108);
  const partly = (lamports) => withAccounts("solPool", { [who.buyer]: { lamports }, [wrapped]: { owner: TOKEN_PROGRAM_ID.toBase58(), lamports: rentOf(165) + 200_000_000, data: account.toString("base64") } }).venue;
  const lessToWrap = Number(request.amountInRaw) - 200_000_000 + build.feeLamports + stays + rentOf(0);
  const spendsWrapped = await partly(lessToWrap).swap.build(request);
  assertSealed(spendsWrapped, who.buyer);
  assert.deepEqual({ rent: spendsWrapped.rentLamports, returned: spendsWrapped.rentReturnedLamports, unwraps: spendsWrapped.unwrapsLamports }, { rent: stays, returned: 0, unwraps: "200000000" });
  assert.equal(await refused(() => partly(lessToWrap - 1).swap.build(request)), "BALANCE_LOW");
  /* The chain, for the recorded swap: that fee, the amount, and the coin's account — the rent the venue told stays, to the lamport. */
  assert.equal(chain.fee, build.feeLamports);
  assert.equal(chain.rent, Number(request.amountInRaw) + stays, "beside the fee the wallet is out of the SOL and of the one account that stays");
  /*
   * And the rehearsal's wallet that held exactly that: a lamport short the chain itself refused it, with it the swap
   * landed — and what was left in the wallet was the rent that came back, which a sum of the two would have doubled.
   */
  const exact = facts.sol.exact;
  assert.deepEqual({ stays: exact.rentStaysLamports, returned: exact.rentReturnedLamports }, { stays: String(stays), returned: String(build.rentReturnedLamports) });
  assert.equal(exact.leftLamports, exact.rentReturnedLamports);
  assert.ok(BigInt(exact.rentReturnedLamports) > BigInt(exact.walletKeeps));
  /* A wallet that already held wrapped SOL, on the chain: the build told what it held, the swap spent out of it, the rest came back as SOL. */
  const held = facts.sol.wrapped;
  assert.equal(held.unwrapsTold, held.held);
  assert.equal(BigInt(held.held) - BigInt(held.swapped), BigInt(held.cameBack));
});

test("lamports somebody left at a wallet's own token-account addresses do not break its builds", async () => {
  const request = { pool: addresses.poolE, inputMint: addresses.sol, amountInRaw: "500000000", slippageBps: 500, wallet: who.buyer };
  const coinAccount = getAssociatedTokenAddressSync(key(addresses.coinE), key(who.buyer), true, TOKEN_2022_PROGRAM_ID).toBase58();
  const wrapped = getAssociatedTokenAddressSync(NATIVE_MINT, key(who.buyer), true, TOKEN_PROGRAM_ID).toBase58();
  const ASSOCIATED = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  const creates = (instructions) => instructions.filter((ix) => ix.program === ASSOCIATED).map((ix) => ix.keys[1]);
  const clean = await at("solPool").venue.swap.build(request);
  const swapOf = async (sdk) => {
    const direct = await sdk.pool.quoteExactIn({ pool: key(addresses.poolE), inputAmount: new BN(request.amountInRaw), swapForY: false, hasReferral: false, swapper: key(who.buyer) });
    return sdk.pool.swap({ pool: key(addresses.poolE), tokenXMint: key(addresses.coinE), tokenYMint: NATIVE_MINT, user: key(who.buyer), swapForY: false, tickArrays: direct.tickArrays, tickArrayBitmapExtension: direct.tickArrayBitmapExtension, parameters: { inputAmount: new BN(request.amountInRaw), minimumOutputAmount: new BN(1) } });
  };
  {
    /* At the coin's address: the SDK alone takes the lamports for the account and opens nothing there — the swap would name them as a token account. */
    const dusted = withAccounts("solPool", { [coinAccount]: dust() });
    assert.deepEqual(creates(ofSdk((await swapOf(dusted.sdk)).tx)), [wrapped]);
    const build = await dusted.venue.swap.build(request);
    assert.deepEqual(creates(opened(build).instructions), [wrapped, coinAccount], "the venue's build opens the account at the address");
    assert.deepEqual(opened(build).instructions, opened(clean).instructions, "the very build of a wallet with nothing there");
    assert.equal(build.rentLamports, clean.rentLamports, "told whole: what lies there already only lowers what the chain takes");
  }
  {
    /* At the wrapped-SOL address the SDK alone cannot build at all. */
    const dusted = withAccounts("solPool", { [wrapped]: dust(), [coinAccount]: dust() });
    await assert.rejects(() => swapOf(dusted.sdk));
    assert.deepEqual(opened(await dusted.venue.swap.build(request)).instructions, opened(clean).instructions);
    /* An order that rests SOL, and a position funded with it, are built past it the same way. */
    const model = await dusted.venue.pools.read(addresses.poolE);
    const aligned = Math.floor(model.tickId / model.tickSpacing) * model.tickSpacing;
    const below = { strategy: "spot", minTickId: aligned - 4 * model.tickSpacing, maxTickId: aligned - 2 * model.tickSpacing };
    const order = await dusted.venue.orders.place({ pool: addresses.poolE, wallet: who.buyer, nftMint: Keypair.generate().publicKey.toBase58(), side: "bid", shape: below, totalAmountRaw: "300000000", slippageTicks: null });
    assert.deepEqual(creates(opened(order).instructions), [wrapped]);
    const position = await dusted.venue.positions.open({ pool: addresses.poolE, wallet: who.buyer, nftMint: Keypair.generate().publicKey.toBase58(), shape: below, amountXRaw: "0", amountYRaw: "300000000", slippageBps: 0 });
    assert.deepEqual(creates(opened(position.steps.find((step) => step.role === "DEPOSIT")).instructions), [coinAccount, wrapped]);
  }
  /* Somebody else's token account at the address — another coin's, or another program's — is not dust: nothing is hidden, and the read stands as it is. */
  const other = withAccounts("solPool", { [coinAccount]: { owner: TOKEN_PROGRAM_ID.toBase58(), lamports: rentOf(165), data: Buffer.alloc(165).toString("base64") } });
  assert.deepEqual(creates(opened(await other.venue.swap.build(request)).instructions), [wrapped]);
});

test("an order that rests SOL, and a position funded with it, are held to the SOL and to their own rent together", async () => {
  const { venue } = at("solPool");
  const model = await venue.pools.read(addresses.poolE);
  const aligned = Math.floor(model.tickId / model.tickSpacing) * model.tickSpacing;
  const below = { strategy: "spot", minTickId: aligned - 4 * model.tickSpacing, maxTickId: aligned - 2 * model.tickSpacing };
  const holding = (lamports) => withAccounts("solPool", { [who.maker]: { lamports } }).venue;
  {
    /* Three bids in SOL, fixed ticks: the order's NFT, its head, an entry and a tick for each price — and the wrapped-SOL account it opens and closes. */
    const request = { pool: addresses.poolE, wallet: who.maker, nftMint: Keypair.generate().publicKey.toBase58(), side: "bid", shape: below, totalAmountRaw: "1500000000", slippageTicks: null };
    const build = await venue.orders.place(request);
    assert.equal(build.ticks.length, 3);
    assert.equal(build.maximumPaidRaw, build.amountRaw, "SOL has no transfer fee");
    const arrays = (build.rentLamports - (rentOf(SIZES.nftMint) + rentOf(SIZES.nftAccount) + rentOf(SIZES.orderHead) + 3 * (SIZES.orderEntry + SIZES.tick) * RENT_PER_BYTE + rentOf(SIZES.tokenAccount))) / rentOf(SIZES.tickArrayHead);
    assert.ok(arrays === 0 || arrays === 1, `tick arrays to make: ${arrays}`);
    assert.equal(build.feeLamports, 2 * LAMPORTS_PER_SIGNATURE);
    /* The wrapped-SOL account is the build's own to open and close: its rent comes back, and is more than a wallet must keep. */
    assert.equal(build.rentReturnedLamports, rentOf(SIZES.tokenAccount));
    const needed = Number(build.amountRaw) + build.feeLamports + build.rentLamports;
    assert.equal(await refused(() => holding(needed - 1).orders.place(request)), "BALANCE_LOW");
    assertSealed(await holding(needed).orders.place(request), who.maker, [request.nftMint]);
  }
  {
    /* A position below the price takes SOL alone: its cap, the fees of its steps, the rent of all of it. */
    const request = { pool: addresses.poolE, wallet: who.maker, nftMint: Keypair.generate().publicKey.toBase58(), shape: below, amountXRaw: "0", amountYRaw: "2000000000", slippageBps: 0 };
    const build = await venue.positions.open(request);
    assert.equal(build.deposit.xRaw, "0");
    assert.equal(build.deposit.maximumYRaw, build.deposit.yRaw);
    const fees = sum(build.steps.map((step) => step.feeLamports));
    /* The deposit opens the maker's account of the coin — which stays — and a wrapped-SOL account it closes itself. */
    assert.equal(build.rentReturnedLamports, rentOf(SIZES.tokenAccount));
    const needed = Number(build.deposit.maximumYRaw) + fees + build.rentLamports;
    assert.equal(await refused(() => holding(needed - 1).positions.open(request)), "BALANCE_LOW");
    assert.equal((await holding(needed).positions.open(request)).rentLamports, build.rentLamports);
  }
});

test("an ask whose fee is in a coin with a transfer fee: the owner and the referral are told what arrives, and the chain paid that", async () => {
  const { venue, sdk } = at("asksEFilled");
  const order = { pool: addresses.poolE, nftMint: addresses.asksE };
  const view = await venue.orders.read(order);
  assert.deepEqual({ side: view.side, restsIn: view.restsIn, paysIn: view.paysIn, feeIn: view.feeIn, referral: view.referral }, { side: "ask", restsIn: addresses.coinE, paysIn: addresses.sol, feeIn: addresses.coinE, referral: who.referral });
  assert.ok(view.ticks.every((tick) => tick.state === "filled"));
  const collect = await venue.orders.collect({ ...order, owner: who.maker });
  const chain = facts.sol.asks;
  /* What the owner's accounts received on the chain — the coin after the referral's fifth and the coin's own fee, the SOL whole. */
  assert.deepEqual(collect.expected, { xRaw: chain.ownerReceivedX, yRaw: chain.ownerReceivedSol });
  assert.deepEqual(collect.gross, { xRaw: view.feeShareRaw, yRaw: view.proceedsRaw }, "before either: the maker's fee in the coin, the proceeds in SOL");
  /* The referral: a fifth of the maker's fee, rounded down once; its account received that less the coin's own fee. */
  assert.deepEqual(collect.referral, { account: addresses.referralAccountE, mint: addresses.coinE, raw: (BigInt(view.feeShareRaw) / 5n).toString(), receivedRaw: chain.referralReceived });
  assert.equal(collect.referral.raw, chain.referralFee);
  assert.equal(collect.referralLeftOut, null);
  /* The model before the collect, against what the chain then paid: the bonus, the owner's part, the referral's. */
  assert.deepEqual(view.bonus, { mint: addresses.coinE, raw: view.feeShareRaw, ownerRaw: chain.ownerFeeX, referralRaw: chain.referralFee, referralPaid: true });
  assert.ok(BigInt(collect.referral.receivedRaw) < BigInt(collect.referral.raw) && BigInt(collect.expected.xRaw) < BigInt(collect.gross.xRaw) - BigInt(collect.referral.raw));
  const paid = eventsNamed(await venue.events.read(fixture.transactions.collectAsksE.signature), "evtCancelLimitOrder")[0].data;
  assert.equal(paid.referralFee, collect.referral.raw);
  assert.equal(paid.owner, who.maker);
  /* The bytes: the SDK's own collect, with the referral's account in the coin. */
  const own = await sdk.limitOrder.cancelLimitOrder({ pool: key(addresses.poolE), nftMint: key(addresses.asksE), owner: key(who.maker), signer: key(who.maker), tokenXMint: key(addresses.coinE), tokenYMint: NATIVE_MINT, tickIds: [...collect.tickIds], referralToken: key(addresses.referralAccountE) });
  assert.deepEqual(assertSealed(collect, who.maker).instructions, ofSdk(own.tx));
  /* The owner signs: its SOL is unwrapped after the collect, in the same transaction. */
  assert.equal(opened(collect).instructions.at(-1).program, TOKEN_PROGRAM_ID.toBase58());
});

/** A moment with its clock moved on by `seconds` — the Clock sysvar the program and the SDK read, and nothing else. */
function later(moment, seconds, changes = {}) {
  const snapshot = fixture.snapshots[moment];
  const clock = { slot: snapshot.clock.slot + Math.ceil(seconds * 2.5), unix: snapshot.clock.unix + seconds, epoch: snapshot.clock.epoch };
  const sysvar = clockAccount(clock);
  const accounts = { ...snapshot.accounts, [CLOCK_SYSVAR]: { owner: sysvar.owner, lamports: sysvar.lamports, data: sysvar.data.toString("base64") } };
  for (const [address, entry] of Object.entries(changes)) {
    if (entry === null) delete accounts[address];
    else accounts[address] = { ...(accounts[address] ?? {}), ...entry };
  }
  const connection = rpcConnection(snapshotSource({ clock, accounts }, records));
  return { connection, venue: createDlmmProVenue({ connection, referralOwner: who.referral }), sdk: new DlmmProClient(connection), clock };
}

test("a schedule's last step is told as its whole steps make it — the fee the pool will read for ever — and the volatility fee is sized from that", async () => {
  const { venue, sdk } = at("rewardsRunning");
  const request = { wallet: who.creator, tokenX: addresses.coin, tokenY: addresses.coinB, tickSpacing: 100, initialTickId: 0, collectFee: "output" };
  const falling = (periods) => ({ kind: "time", curve: "exponential", startBps: 5_000, endBps: 100, periods, duration: periods * 60 });
  /*
   * The SDK cuts an exponential schedule by a whole number of basis points a step, rounded so that the fee never falls
   * below what was asked: the more steps, the further its last one stands above it. The numbers are the SDK's own
   * `getBaseFeeNumerator` at the schedule's end, worked out apart from the venue — 10 013 002, 10 614 992 and
   * 13 637 275 over a billion — as the venue tells a fee: in basis points, to two decimals, never rounded up.
   */
  for (const [periods, settled] of [[60, 100.13], [600, 106.14], [3_600, 136.37]]) {
    const build = await venue.pools.buildLaunchPool({ ...request, baseFee: falling(periods) });
    const { dynamicCeilingBps, ...told } = build.parameters;
    assert.deepEqual(told, { activationPoint: null, extensions: 0, endFeeBps: settled, askedEndFeeBps: 100, settles: { afterSeconds: periods * 60, atPriceMultiple: null } }, `${periods} steps`);
    /* The volatility fee's most, as the pool will read it: a fifth of the settled fee in whole basis points, never above it. */
    const cap = Math.floor(settled) / 5;
    assert.ok(dynamicCeilingBps <= cap && dynamicCeilingBps > cap - 0.05, `${periods} steps: the volatility fee's most ${dynamicCeilingBps} bps, a fifth of ${Math.floor(settled)} is ${cap}`);
  }
  /* A line falls by the same numerator every step: it lands on what was asked, to the hundredth of a basis point. */
  const line = await venue.pools.buildLaunchPool({ ...request, baseFee: { ...falling(3_600), curve: "linear" } });
  assert.deepEqual({ settled: line.parameters.endFeeBps, asked: line.parameters.askedEndFeeBps }, { settled: 100, asked: 100 });
  /* A fixed fee is what it is, and settles at nothing. */
  const fixed = (await venue.pools.buildLaunchPool({ ...request, baseFee: { kind: "fixed", bps: 100 } })).parameters;
  assert.deepEqual({ ...fixed, dynamicCeilingBps: undefined }, { activationPoint: null, extensions: 0, endFeeBps: 100, askedEndFeeBps: 100, settles: null, dynamicCeilingBps: undefined });
  assert.ok(fixed.dynamicCeilingBps <= 20 && fixed.dynamicCeilingBps > 19.95, String(fixed.dynamicCeilingBps));
  /* With the volatility fee switched off there is no most to it. */
  assert.equal((await venue.pools.buildLaunchPool({ ...request, baseFee: { kind: "fixed", bps: 100 }, dynamicFee: false })).parameters.dynamicCeilingBps, 0);
  /* A market-cap schedule's step of the price is a whole number of basis points too: asked to settle at four times the first price, it settles a little before. */
  const byPrice = (periods) => venue.pools.buildLaunchPool({ ...request, baseFee: { kind: "marketCap", curve: "exponential", startBps: 5_000, endBps: 100, periods, priceMultiple: 4, expiresAfter: 86_400 } });
  const [coarse, fine] = [await byPrice(60), await byPrice(600)];
  assert.deepEqual({ settled: coarse.parameters.endFeeBps, after: coarse.parameters.settles.afterSeconds }, { settled: 100.13, after: 86_401 }, "it still charges by the price at the last second of its day, and settles on the next");
  assert.ok(Math.abs(coarse.parameters.settles.atPriceMultiple - 3.984) < 0.0005, String(coarse.parameters.settles.atPriceMultiple));
  assert.ok(Math.abs(fine.parameters.settles.atPriceMultiple - 3.8416) < 0.0005 && fine.parameters.endFeeBps === 106.14, JSON.stringify(fine.parameters));
  /* The bytes: the SDK's own pool, its volatility fee sized from the fee the steps settle at — 136 basis points, not the 100 asked for. */
  const long = await venue.pools.buildLaunchPool({ ...request, baseFee: falling(3_600) });
  const own = (settledBps) =>
    sdk.pool.initializeLaunchPool({
      tokenXMint: key(addresses.coin),
      tokenYMint: key(addresses.coinB),
      creator: key(who.creator),
      payer: key(who.creator),
      tokenXProgram: TOKEN_2022_PROGRAM_ID,
      tokenYProgram: TOKEN_2022_PROGRAM_ID,
      parameters: {
        poolFees: { baseFeeParameter: timeSchedulerBaseFeeParameters({ baseFeeMode: BaseFeeMode.TimeSchedulerExponential, startingBaseFeeBps: 5_000, endingBaseFeeBps: 100, numberOfPeriod: 3_600, totalDuration: 216_000 }), dynamicFeeParameter: getDynamicFeeParams(settledBps, 100) },
        tickSpacing: 100,
        collectFeeMode: CollectFeeMode.OutputToken,
        initialSqrtPrice: getSqrtPriceFromTickId(0),
        activationType: ActivationType.Timestamp,
        activationPoint: null,
        extensions: encodePoolExtensions([]),
        poolActivation: null,
      },
    });
  assert.deepEqual(assertSealed(long, who.creator).instructions, ofSdk((await own(136)).tx));
  assert.notDeepEqual(opened(long).instructions, ofSdk((await own(100)).tx), "sized from the fee asked for it would be another pool");
  /* And the pool the rehearsal made: the fee its build said the schedule settles at is the fee the chain's pool reads. */
  const made = await at("beforeOpening").venue.pools.read(addresses.pool);
  assert.deepEqual({ settlesAt: facts.schedule.settlesAt, asked: facts.schedule.asked }, { settlesAt: made.fee.endBps, asked: 100 });
  assert.equal(made.activationPoint + facts.schedule.settles.afterSeconds, made.fee.settles.atPoint, "and it settles when the build said it would");
});

/** A Token-2022 mint with one extension, as the token program lays it out: the mint, its type, then the extension's type, length and bytes. */
function mintWith(extensionType, value, freezeAuthority = null) {
  const data = Buffer.alloc(166 + 4 + value.length);
  data.writeBigUInt64LE(1_000_000_000_000n, 36);
  data.writeUInt8(6, 44);
  data.writeUInt8(1, 45);
  if (freezeAuthority) {
    data.writeUInt32LE(1, 46);
    key(freezeAuthority).toBuffer().copy(data, 50);
  }
  data.writeUInt8(1, 165);
  data.writeUInt16LE(extensionType, 166);
  data.writeUInt16LE(value.length, 168);
  value.copy(data, 170);
  return { owner: TOKEN_2022_PROGRAM_ID.toBase58(), lamports: rentOf(data.length), data: data.toString("base64") };
}
/** The same mint with bytes past its last extension — zeros, as the two the token program adds to a mint whose length would be a multisig's. */
function withSpare(entry, spare) {
  return { ...entry, data: Buffer.concat([Buffer.from(entry.data, "base64"), Buffer.alloc(spare)]).toString("base64") };
}
const accountInfoOf = (entry) => ({ owner: key(entry.owner), lamports: entry.lamports, executable: false, data: Buffer.from(entry.data, "base64") });

/** A token account holding `amount` of a coin. */
function tokenAccountOf(mint, owner, amount, program) {
  const data = Buffer.alloc(165);
  key(mint).toBuffer().copy(data, 0);
  key(owner).toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data.writeUInt8(1, 108);
  return { owner: program.toBase58(), lamports: rentOf(165), data: data.toString("base64") };
}
/** The badge Meteora's access registry keeps for a coin: the account's mark, the coin, a score. */
function badgeOf(mint, owner = DLMM_PRO_ACCESS_REGISTRY) {
  const mark = Buffer.from(AccessRegistryIDL.accounts.find((entry) => entry.name === "TokenBadge").discriminator);
  const data = Buffer.concat([mark, key(mint).toBuffer(), Buffer.alloc(32)]);
  return { owner, lamports: rentOf(data.length), data: data.toString("base64") };
}

test("a coin the program takes only with Meteora's badge: the build passes the badge where the coin has one, and is refused where it has none", async () => {
  /* A coin with a permanent delegate — the program refused a pool of one on 15.11.2026 — and the creator's account of it. */
  const PERMANENT_DELEGATE = 12;
  const coin = Keypair.generate().publicKey.toBase58();
  const held = getAssociatedTokenAddressSync(key(coin), key(who.creator), true, TOKEN_2022_PROGRAM_ID).toBase58();
  const scene = { [coin]: mintWith(PERMANENT_DELEGATE, key(who.creator).toBuffer()), [held]: tokenAccountOf(coin, who.creator, 1_000_000n, TOKEN_2022_PROGRAM_ID) };
  const badge = deriveTokenBadge(key(coin)).toBase58();
  const request = { wallet: who.creator, tokenX: coin, tokenY: addresses.coinB, tickSpacing: 100, initialTickId: 0, baseFee: { kind: "fixed", bps: 100 }, dynamicFee: false, collectFee: "output" };
  const build = (more = {}) => withAccounts("rewardsRunning", { ...scene, ...more }).venue.pools.buildLaunchPool(request);
  assert.equal(await refused(() => build()), "BAD_INPUT", "no badge: refused before a signature, not by the chain after one");
  assert.equal(await refused(() => build({ [badge]: badgeOf(coin, TOKEN_PROGRAM_ID.toBase58()) })), "BAD_INPUT", "an account at the badge's address that is not the registry's");
  assert.equal(await refused(() => build({ [badge]: badgeOf(addresses.coin) })), "BAD_INPUT", "another coin's badge");
  assert.equal(await refused(() => build({ [badge]: dust() })), "BAD_INPUT", "lamports somebody left at the badge's address");
  const withBadge = await build({ [badge]: badgeOf(coin) });
  const create = assertSealed(withBadge, who.creator).instructions.find((ix) => ix.program === DLMM_PRO_PROGRAM);
  const badgeX = DlmmProIDL.instructions.find((ix) => ix.name === "initialize_launch_pool").accounts.findIndex((account) => account.name === "token_badge_x");
  assert.equal(create.keys[badgeX], badge, "the badge, where the program reads token X's");
  assert.equal(create.keys[badgeX + 1], DLMM_PRO_PROGRAM, "token Y needs none: the optional account is left out");
  /* The same coin as token Y: its badge goes where the program reads token Y's. */
  const asY = await withAccounts("rewardsRunning", { ...scene, [badge]: badgeOf(coin) }).venue.pools.buildLaunchPool({ ...request, tokenX: addresses.coinB, tokenY: coin });
  const createY = opened(asY).instructions.find((ix) => ix.program === DLMM_PRO_PROGRAM);
  assert.deepEqual([createY.keys[badgeX], createY.keys[badgeX + 1]], [DLMM_PRO_PROGRAM, badge]);
  {
    /*
     * A coin whose mint's bytes run past its last extension — here a metadata pointer, then zeros. The chain makes
     * such a mint: one whose length would be a multisig's, 355 bytes, is allocated two bytes longer. The token program
     * reads extensions to the first that is none; read past it, the zeros would be taken for extensions the program
     * does not take, and the coin refused for want of a badge it does not need. A tail of two bytes is the one the
     * chain leaves; the longer ones here hold the rule itself — the first that is none ends the reading.
     */
    const METADATA_POINTER = 18;
    const roomy = Keypair.generate().publicKey.toBase58();
    const account = getAssociatedTokenAddressSync(key(roomy), key(who.creator), true, TOKEN_2022_PROGRAM_ID).toBase58();
    const plainMint = mintWith(METADATA_POINTER, Buffer.alloc(64));
    for (const spare of [0, 2, 64, 301]) {
      const mint = withSpare(plainMint, spare);
      assert.deepEqual(mintExtensionTypes(accountInfoOf(mint).data.subarray(166)), [METADATA_POINTER], `${spare} spare bytes`);
      const built = await withAccounts("rewardsRunning", { [roomy]: mint, [account]: tokenAccountOf(roomy, who.creator, 1_000_000n, TOKEN_2022_PROGRAM_ID) }).venue.pools.buildLaunchPool({ ...request, tokenX: roomy });
      assert.equal(opened(built).instructions.find((ix) => ix.program === DLMM_PRO_PROGRAM).keys[badgeX], DLMM_PRO_PROGRAM, `${spare} spare bytes: no badge is asked for`);
    }
    /* An extension the program does not take is found wherever it stands, and what follows a blank is not read. */
    const two = Buffer.concat([Buffer.from(plainMint.data, "base64"), Buffer.from([PERMANENT_DELEGATE, 0, 32, 0]), Buffer.alloc(32)]);
    assert.deepEqual(mintExtensionTypes(two.subarray(166)), [METADATA_POINTER, PERMANENT_DELEGATE]);
    assert.deepEqual(mintExtensionTypes(Buffer.concat([Buffer.alloc(4), two.subarray(166)])), []);
  }
  {
    /*
     * The size of a coin's account is what the token program gives a new account of it: the mark that its owner cannot
     * change, and what the coin's own extensions ask at once — a transfer fee's withheld amount, a hook's flag, the
     * marks of a coin that cannot be transferred or can be paused. A confidential balance is the owner's to add later.
     */
    const sizeOf = (type, length) => tokenAccountBytesOf(key(coin), accountInfoOf(mintWith(type, Buffer.alloc(length))), TOKEN_2022_PROGRAM_ID);
    const [TRANSFER_FEE, CONFIDENTIAL, NON_TRANSFERABLE, TRANSFER_HOOK, PAUSABLE] = [1, 4, 9, 14, 26];
    assert.deepEqual(
      { metadata: sizeOf(18, 64), fee: sizeOf(TRANSFER_FEE, 108), confidential: sizeOf(CONFIDENTIAL, 65), fixed: sizeOf(NON_TRANSFERABLE, 0), hook: sizeOf(TRANSFER_HOOK, 64), pausable: sizeOf(PAUSABLE, 33), delegate: sizeOf(PERMANENT_DELEGATE, 32) },
      { metadata: 170, fee: 182, confidential: 170, fixed: 174, hook: 175, pausable: 174, delegate: 170 },
    );
    assert.equal(tokenAccountBytesOf(key(coin), accountInfoOf(mintWith(18, Buffer.alloc(64))), TOKEN_PROGRAM_ID), SIZES.tokenAccount, "the classic program's account is 165 bytes whatever is read");
    assert.equal(tokenAccountBytesOf(key(coin), null, TOKEN_2022_PROGRAM_ID), SIZES.tokenAccount2022, "a coin that cannot be read is given the venue's allowance");
  }
  /* What the program takes as it is asks for no badge: the rehearsal's coins — Token-2022 with their metadata — and USDC. */
  const usual = opened(await at("rewardsRunning").venue.pools.buildLaunchPool({ ...request, tokenX: addresses.coin })).instructions.find((ix) => ix.program === DLMM_PRO_PROGRAM);
  assert.deepEqual([usual.keys[badgeX], usual.keys[badgeX + 1]], [DLMM_PRO_PROGRAM, DLMM_PRO_PROGRAM]);

  /*
   * A reward's coin is held to more: a freeze authority alone asks for the badge — but for USDC and wrapped SOL. The
   * pool with liquidity mining, as it was before its first slot was set up: the tail of its reward slots blank.
   */
  const pool = fixture.snapshots.rewardsRunning.accounts[addresses.poolB];
  const blank = Buffer.from(pool.data, "base64");
  assert.equal(blank.length, SIZES.pool + SIZES.poolRewards);
  blank.fill(0, SIZES.pool);
  const unset = { [addresses.poolB]: { ...pool, data: blank.toString("base64") } };
  const frosty = Keypair.generate().publicKey.toBase58();
  const classic = (freezeAuthority) => {
    const data = Buffer.alloc(82);
    data.writeUInt8(6, 44);
    data.writeUInt8(1, 45);
    if (freezeAuthority) {
      data.writeUInt32LE(1, 46);
      key(freezeAuthority).toBuffer().copy(data, 50);
    }
    return { owner: TOKEN_PROGRAM_ID.toBase58(), lamports: rentOf(82), data: data.toString("base64") };
  };
  const setUp = (rewardMint, more = {}) => withAccounts("rewardsRunning", { ...unset, ...more }).venue.rewards.initialize({ pool: addresses.poolB, creator: who.creator, rewardMint });
  const rewardBadge = DlmmProIDL.instructions.find((ix) => ix.name === "initialize_reward").accounts.findIndex((account) => account.name === "token_badge");
  const badgeIn = (built) => opened(built).instructions.find((ix) => ix.program === DLMM_PRO_PROGRAM).keys[rewardBadge];
  assert.equal(await refused(() => setUp(frosty, { [frosty]: classic(who.creator) })), "BAD_INPUT", "a freeze authority, and no badge");
  assert.equal(badgeIn(await setUp(frosty, { [frosty]: classic(null) })), DLMM_PRO_PROGRAM, "the same coin with no freeze authority is taken as it is");
  const frostyBadge = deriveTokenBadge(key(frosty)).toBase58();
  assert.equal(badgeIn(await setUp(frosty, { [frosty]: classic(who.creator), [frostyBadge]: badgeOf(frosty) })), frostyBadge, "with its badge, the build passes it");
  /* USDC has a freeze authority on mainnet: the program takes it as a reward all the same, and the build asks for no badge. */
  assert.equal(badgeIn(await setUp(addresses.usdc, { [addresses.usdc]: classic(who.faucet) })), DLMM_PRO_PROGRAM);
  /* A reward in a Token-2022 coin with an extension beyond the three: refused like a pool of it. */
  assert.equal(await refused(() => setUp(coin, scene)), "BAD_INPUT");
  /* A coin that is not a coin at all is refused as that. */
  assert.equal(await refused(() => setUp(who.stranger)), "BAD_INPUT");
});

test("a removal names a band of the price: the least of each coin is what the slots pay at the end of the band that pays least of it", async () => {
  /* The position of the pool with rewards: one range, the price inside it. */
  const { venue, sdk } = at("theEnd");
  const { pool } = await sdk.state.fetchPoolWithExtensions(key(addresses.poolB));
  const { positionArray, positions } = await sdk.state.fetchPositionArrayWithPositions(derivePosition(key(addresses.positionB)), { withReward: true });
  assert.ok(positions.length === 1 && positions[0].tickLowerId <= pool.tickCurrentId && pool.tickCurrentId < positions[0].tickUpperId);
  const request = { pool: addresses.poolB, nftMint: addresses.positionB, owner: who.creator, bps: 10_000 };
  const [tight, roomy] = [await venue.positions.remove({ ...request, slippageBps: 0 }), await venue.positions.remove({ ...request, slippageBps: 100 })];
  /* The SDK's own arithmetic: what the unlocked liquidity pays at a price `bps` of itself away. */
  const square = BigInt(pool.sqrtPrice.toString()) ** 2n;
  const paysAt = (bps) => {
    const root = bps === 0 ? pool.sqrtPrice : new BN(isqrt((square * BigInt(10_000 + bps)) / 10_000n).toString());
    const tickCurrentId = bps === 0 ? pool.tickCurrentId : tickIdFromSqrtPrice(root);
    return positions.reduce(
      (total, slot) => {
        const amounts = getAmountsFromLiquidity({ tickCurrentId, tickLowerId: slot.tickLowerId, tickUpperId: slot.tickUpperId, currentSqrtPrice: root, liquidity: slot.unlockedLiquidity.neg() });
        return { x: total.x + BigInt(amounts.amountX.toString()), y: total.y + BigInt(amounts.amountY.toString()) };
      },
      { x: 0n, y: 0n },
    );
  };
  const now = paysAt(0);
  assert.deepEqual(tight.expected, { xRaw: now.x.toString(), yRaw: now.y.toString() });
  assert.deepEqual(tight.minimum, tight.expected, "no band: the least is exactly what it pays now");
  assert.deepEqual(roomy.expected, tight.expected, "what it pays at the build's price does not depend on the band");
  /* Of token X a removal pays least at the band's high end, of token Y at its low end. */
  assert.deepEqual(roomy.minimum, { xRaw: paysAt(100).x.toString(), yRaw: paysAt(-100).y.toString() });
  const least = { x: BigInt(roomy.minimum.xRaw), y: BigInt(roomy.minimum.yRaw) };
  for (const bps of [-100, -73, -18, -1, 0, 1, 14, 60, 100]) {
    const pays = paysAt(bps);
    assert.ok(pays.x >= least.x && pays.y >= least.y, `${bps} bps of the price: inside the band it lands`);
  }
  assert.ok(paysAt(130).x < least.x, "above the band it pays less of token X than the least");
  assert.ok(paysAt(-130).y < least.y, "below it, less of token Y");
  /*
   * A hundredth less of each coin's amount — a tolerance in the amounts — would not have been a hundredth of the price:
   * this removal pays less than that of token X once the price is a fifth of a percent higher, well inside the band.
   */
  assert.ok(paysAt(20).x < (now.x * 99n) / 100n, "a fifth of a percent of the price is more than a hundredth of the coin's amount");
  assert.ok(least.x < (now.x * 99n) / 100n && least.y < (now.y * 99n) / 100n, "so the band's least is lower than a hundredth off");
  /* The bytes: the SDK's own removal, with those minimums. */
  const direct = await sdk.position.removeLiquidityByBps({ pool: key(addresses.poolB), nftMint: key(addresses.positionB), owner: key(who.creator), signer: key(who.creator), tokenXMint: pool.tokenXMint, tokenYMint: pool.tokenYMint, tickRanges: positions.map(({ tickLowerId, tickUpperId }) => ({ tickLowerId, tickUpperId })), parameters: { minAmountX: new BN(roomy.minimum.xRaw), minAmountY: new BN(roomy.minimum.yRaw), expectedLayoutVersion: positionArray.layoutVersion, bps: 10_000, bitmap: liquidityBitmap([0]) } });
  assert.deepEqual(assertSealed(roomy, who.creator).instructions, ofSdk(direct.tx));
  assert.equal(await refused(() => venue.positions.remove({ ...request, slippageBps: 5_001 })), "BAD_INPUT");
  assert.equal(await refused(() => venue.positions.remove({ ...request, slippageBps: undefined })), "BAD_INPUT", "the band is always said");
  /* What the chain then did to a removal built for a band of 1 %, after trades moved the price inside it. */
  const moved = facts.review.removal;
  assert.ok(moved.movedBps >= 30 && moved.movedBps < moved.bandBps);
  assert.ok(BigInt(moved.paidX) >= BigInt(moved.minimum.xRaw) && BigInt(moved.paidY) >= BigInt(moved.minimum.yRaw), "it paid no less than the band's least");
  assert.ok(BigInt(moved.paidX) < (BigInt(moved.expected.xRaw) * 99n) / 100n, "and less of token X than a hundredth off the build's amount: the tolerance in amounts was refused there");
  assert.equal(moved.byAmountRefused, "ExceededSlippage");
});

test("fees in one coin are put back into a range that takes that coin alone anywhere in the band: a wider band puts them further from the price", async () => {
  /* The launch pool pays its fee in USDC alone; the price stands inside one range of the locked position, with ranges under it. */
  const { venue, sdk } = at("bidsFilled");
  const { pool } = await sdk.state.fetchPoolWithExtensions(key(addresses.pool));
  const view = await venue.positions.read({ pool: addresses.pool, nftMint: addresses.position });
  assert.ok(view.feeXRaw === "0" && BigInt(view.feeYRaw) > 0n);
  const request = { pool: addresses.pool, nftMint: addresses.position, owner: who.creator };
  const square = BigInt(pool.sqrtPrice.toString()) ** 2n;
  const lowEnd = (bps) => isqrt((square * BigInt(10_000 - bps)) / 10_000n);
  const edge = (tickId) => BigInt(getSqrtPriceFromTickId(tickId).toString());
  const under = view.slots.filter((slot) => slot.tickUpperId <= pool.tickCurrentId);
  const chosen = {};
  for (const bps of [0, 100, 1_000, 3_000]) {
    const build = await venue.positions.compound({ ...request, slippageBps: bps });
    const target = view.slots[build.slot];
    assert.ok(under.includes(target), `${bps} bps: a range under the price — it takes USDC alone`);
    assert.ok(edge(target.tickUpperId) <= lowEnd(bps), `${bps} bps: it is still under the price at the band's low end`);
    assert.ok(under.filter((slot) => slot.tickUpperId > target.tickUpperId).every((slot) => edge(slot.tickUpperId) > lowEnd(bps)), `${bps} bps: and it is the nearest that is`);
    chosen[bps] = build.slot;
  }
  const nearest = under.reduce((best, slot) => (slot.tickUpperId > best.tickUpperId ? slot : best)).index;
  assert.equal(chosen[0], nearest, "with no band: the range nearest under the price");
  assert.ok(chosen[1_000] < chosen[100] && chosen[3_000] < chosen[1_000], JSON.stringify(chosen));
  /* A range named by the caller is held to the same: one the price may enter inside the band is refused, not built to fail. */
  assert.equal((await venue.positions.compound({ ...request, slippageBps: 100, slot: chosen[100] })).slot, chosen[100]);
  assert.equal(await refused(() => venue.positions.compound({ ...request, slippageBps: 1_000, slot: chosen[100] })), "NOTHING_TO_DO");
  const inRange = view.slots.find((slot) => slot.inRange).index;
  assert.equal(await refused(() => venue.positions.compound({ ...request, slippageBps: 100, slot: inRange })), "NOTHING_TO_DO", "the range the price is in needs both coins, and one was earned");
  assert.equal(await refused(() => venue.positions.compound({ ...request, slippageBps: 100, slot: view.slots.length - 1 })), "NOTHING_TO_DO", "a range above the price takes the other coin");
  /* On the chain: the nearest range, with the price pushed into it inside the band, was refused; the venue's landed. */
  const ran = facts.review.compound;
  assert.ok(ran.venueSlot < ran.nearestSlot && -ran.movedBps < ran.bandBps, JSON.stringify(ran));
  assert.equal(ran.nearestRefused, "ExceededSlippage");
});

test("a caller's one compute limit is not put on the several calls of an opening", async () => {
  const { venue } = at("opened");
  const request = { pool: addresses.pool, wallet: who.creator, nftMint: Keypair.generate().publicKey.toBase58(), shape: { strategy: "curve", minTickId: terms.firstTick, maxTickId: terms.firstTick + 460 * terms.tickSpacing }, amountXRaw: "50000000000000", amountYRaw: "0", slippageBps: 0, lockBps: 10_000 };
  const [own, named] = [await venue.positions.open(request), await venue.positions.open(request, { units: 60_000 })];
  assert.deepEqual(named.steps.map((step) => [step.role, step.units]), own.steps.map((step) => [step.role, step.units]));
  assert.deepEqual(named.packed.map((tx) => tx.units), own.packed.map((tx) => tx.units));
  assert.ok(own.steps.every((step) => step.units > 15_000) && new Set(own.steps.map((step) => step.units)).size === own.steps.length, "each call has its own ceiling");
  /* A priority price is the caller's to name: it is paid over each call's own ceiling. */
  const priced = await venue.positions.open(request, { units: 60_000, priorityMicroLamports: 1_000 });
  assert.deepEqual(priced.steps.map((step) => step.feeLamports - own.steps[priced.steps.indexOf(step)].feeLamports), own.steps.map((step) => Math.ceil(step.units / 1_000)));
});

test("a deposit or an order beyond a pool's own bitmap of tick arrays makes the bitmap's extension first, where the pool has none", async () => {
  /* The pool of two coins, read as one of a spacing of 1 — where the bitmap in the pool itself ends at tick 65 535 — and with no extension. */
  const narrow = (more = {}) => withPool("theEnd", addresses.poolD, (pool) => ({ ...pool, tickSpacing: 1, ...more }));
  const { venue } = await narrow();
  const extension = deriveTickArrayBitmapExtension(key(addresses.poolD), key(DLMM_PRO_PROGRAM)).toBase58();
  const MAKE = Buffer.from(DlmmProIDL.instructions.find((ix) => ix.name === "initialize_tick_bitmap_extension").discriminator).toString("hex");
  const programCalls = (build) => opened(build).instructions.filter((ix) => ix.program === DLMM_PRO_PROGRAM);
  const position = (venueOf, minTickId) => venueOf.positions.open({ pool: addresses.poolD, wallet: who.creator, nftMint: Keypair.generate().publicKey.toBase58(), shape: { strategy: "spot", minTickId, maxTickId: minTickId + 20 }, amountXRaw: "1000000000", amountYRaw: "0", slippageBps: 0 });
  /* Inside the bitmap: the SDK's own deposit, nothing before it. */
  const inside = await position(venue, 60_000);
  const insideDeposit = programCalls(inside.steps.find((step) => step.role === "DEPOSIT"));
  assert.equal(insideDeposit.length, 1);
  assert.equal(insideDeposit[0].keys.includes(extension), false);
  /* Beyond it: the extension is made first — by the wallet, for the pool — and the deposit names it. */
  const beyond = await position(venue, 65_540);
  const deposit = beyond.steps.find((step) => step.role === "DEPOSIT");
  const calls = programCalls(deposit);
  assert.equal(calls.length, 2);
  assert.deepEqual({ data: calls[0].data, keys: calls[0].keys }, { data: MAKE, keys: [addresses.poolD, extension, who.creator, SystemProgram.programId.toBase58()] });
  assert.equal(calls[1].keys[3], extension, "where the deposit reads the pool's bitmap extension");
  assertSealed(deposit, who.creator);
  /* Its rent — 808 bytes that never come back — and its compute are told with the rest: both positions make one tick array. */
  assert.equal(beyond.rentLamports - inside.rentLamports, rentOf(SIZES.bitmapExtension));
  assert.equal(deposit.units - inside.steps.find((step) => step.role === "DEPOSIT").units, DLMM_PRO_UNITS.bitmapExtension);
  assert.equal(programCalls(beyond.packed.find((tx) => tx.roles.includes("DEPOSIT"))).filter((ix) => ix.data === MAKE).length, 1, "packed, it is made once, before the deposit");
  /* A limit order the same. */
  const order = (venueOf, minTickId) => venueOf.orders.place({ pool: addresses.poolD, wallet: who.creator, nftMint: Keypair.generate().publicKey.toBase58(), side: "ask", shape: { strategy: "spot", minTickId, maxTickId: minTickId + 4 }, totalAmountRaw: "50000000", slippageTicks: null, referralWallet: null });
  const [near, far] = [await order(venue, 60_000), await order(venue, 65_540)];
  assert.deepEqual(programCalls(far).map((ix) => ix.data === MAKE), [true, false]);
  assert.equal(programCalls(near).length, 1);
  assert.equal(programCalls(far)[1].keys[4], extension, "where the order reads the pool's bitmap extension");
  assert.equal(far.rentLamports - near.rentLamports, rentOf(SIZES.bitmapExtension));
  /* A relative order may land shifted with the price: it makes the extension when any tick in its reach lies beyond the bitmap. */
  const drifting = (slippageTicks) => venue.orders.place({ pool: addresses.poolD, wallet: who.creator, nftMint: Keypair.generate().publicKey.toBase58(), side: "ask", shape: { strategy: "spot", minTickId: 65_460, maxTickId: 65_464 }, totalAmountRaw: "50000000", slippageTicks, referralWallet: null });
  assert.equal(programCalls(await drifting(null)).length, 1, "fixed ticks inside the bitmap: nothing is made");
  assert.deepEqual(programCalls(await drifting(100)).map((ix) => ix.data === MAKE), [true, false], "a band that reaches past the bitmap's end: it is made");
  /* On a pool that says it has its extension the venue makes nothing: the SDK names the account itself. */
  const has = (await narrow({ isBitmapExtensionInitialized: 1 })).venue;
  const there = programCalls((await position(has, 65_540)).steps.find((step) => step.role === "DEPOSIT"));
  assert.equal(there.length, 1);
  assert.equal(there[0].keys[3], extension);
  /* The size is the one the program made — with a pool whose first price lies beyond the bitmap, and by a deposit and an order that were the first to go there. */
  assert.ok(chargedIn("createPoolFar").made.includes(SIZES.bitmapExtension));
  assert.ok(chargedIn("orderMakesExtension").made.includes(SIZES.bitmapExtension));
  assert.equal(facts.review.extension.extensionBytes, SIZES.bitmapExtension);
});

test("a reward's collect says what the position's slots already show as accrued, and is refused where nothing can have accrued", async () => {
  const request = { pool: addresses.poolB, nftMint: addresses.positionB, owner: who.creator };
  const { venue } = at("rewardsRunning");
  const [reward] = await venue.rewards.read(addresses.poolB);
  const now = fixture.snapshots.rewardsRunning.clock.unix;
  assert.ok(reward.running && now > reward.opensAt);
  assert.equal(reward.credited, false, "nothing has touched the pool since the emission was funded: nothing is credited to liquidity yet");
  /* A quarter of a day in, nothing is written into the position yet — nothing refreshed it: the build says so, and still builds. */
  const collect = await venue.rewards.collect(request);
  assert.equal(collect.accruedRaw, "0");
  assertSealed(collect, who.creator);
  /* The same position with the clock ten minutes before the emission starts: nothing accrued and nothing can have — refused. */
  const notYet = later("rewardsRunning", reward.opensAt - 600 - now).venue;
  assert.equal((await notYet.rewards.read(addresses.poolB))[0].running, false);
  assert.equal(await refused(() => notYet.rewards.collect(request)), "NOTHING_TO_DO");
  /* A second after it starts the same build is made: what accrued since is the collect's own refresh to count. */
  assertSealed(await later("rewardsRunning", reward.opensAt + 1 - now).venue.rewards.collect(request), who.creator);
  {
    /*
     * Between two emissions — the first ended, the next still ahead — what the first left the position is collected.
     * The slot's dates are the next emission's, and say nothing of what the one before it owes: «nothing was earned»
     * is said only of a slot nothing was ever credited to liquidity in.
     */
    const [next] = await at("theEnd").venue.rewards.read(addresses.poolB);
    assert.equal(next.credited, true);
    /* The moment the rehearsal collected at — a minute before the next emission opens — with the position's one range showing nothing written, as it did then. */
    const positionAddress = derivePosition(key(addresses.positionB)).toBase58();
    const shown = Buffer.from(fixture.snapshots.theEnd.accounts[positionAddress].data, "base64");
    shown.writeBigUInt64LE(0n, shown.length - (128 + 2 * 32) + 128 + 16);
    const gap = later("theEnd", next.opensAt - 60 - fixture.snapshots.theEnd.clock.unix, { [positionAddress]: { data: shown.toString("base64") } }).venue;
    const [slot] = await gap.rewards.read(addresses.poolB);
    assert.deepEqual({ running: slot.running, credited: slot.credited }, { running: false, credited: true });
    const between = await gap.rewards.collect(request);
    assert.equal(between.accruedRaw, "0", "the position's slots show nothing: only a refresh writes into them");
    assertSealed(between, who.creator);
    /* On the chain, in that very gap: the collect paid what the first emission ran after the position's last collect. */
    const paid = facts.rewardBetween;
    assert.ok(paid.accruedTold === "0" && BigInt(paid.paid) > 0n && BigInt(paid.due) >= BigInt(paid.paid) && BigInt(paid.due) - BigInt(paid.paid) <= 3n && paid.nextOpensIn > 0, JSON.stringify(paid));
    /* Asked again in that gap, with nothing owed any more: the build said «0» as before — it cannot tell the two apart — and the program took the collect and paid nothing. */
    assert.deepEqual(paid.again, { accruedTold: "0", landed: true, refused: null, paid: "0" });
    assert.deepEqual((await at("theEnd").venue.events.read(fixture.transactions.claimRewardBetween.signature)).map((event) => [event.name, event.data.amount]), [["evtClaimReward", paid.paid]]);
  }
  /* On the chain: a collect built after a deposit had refreshed the position said what was written, and paid that and what accrued since. */
  const ran = facts.review.reward;
  assert.equal(ran.firstAccruedTold, "0");
  assert.ok(BigInt(ran.firstPaid) > 0n && BigInt(ran.accruedTold) > 0n && BigInt(ran.paid) > BigInt(ran.accruedTold), JSON.stringify(ran));
});

test("a shape stands on no more ticks than a request can afford to work out", async () => {
  const pool = { tickSpacing: 1, tickCurrentId: 0 };
  assert.equal(shapeOf({ strategy: "spot", minTickId: 0, maxTickId: MAX_SHAPE_COLUMNS - 1 }, pool).columns.length, MAX_SHAPE_COLUMNS);
  const refusedShape = (work) => assert.throws(work, (error) => error instanceof DlmmProRefusal && error.code === "BAD_INPUT");
  /* One tick more. A limit order rests on the ticks themselves, a column each: its shape is refused. */
  refusedShape(() => shapeOf({ strategy: "spot", minTickId: 0, maxTickId: MAX_SHAPE_COLUMNS }, pool));
  {
    /*
     * A position holds an even shape as one range whatever its width, so it may take one wider than that: told as the
     * range the SDK merges every even shape into — the SDK's own, worked out here over the same ticks — with no columns.
     */
    const request = { strategy: "spot", minTickId: 0, maxTickId: MAX_SHAPE_COLUMNS };
    const { columns, ...told } = shapeOf(request, pool, 45, "ranges");
    const { columns: worked, ...own } = buildLiquidityShape({ strategy: StrategyType.Spot, minTickId: 0, maxTickId: MAX_SHAPE_COLUMNS, tickSpacing: 1, currentTickId: 0, maxRanges: 45 });
    assert.equal(worked.length, MAX_SHAPE_COLUMNS + 1);
    assert.deepEqual(columns, []);
    assert.deepEqual(plain(told), plain(own));
    assert.equal(told.ranges.length, 1);
    /* The whole of a pool's prices on the finest spacing — nearly a million ticks — is that one range still, told at once. */
    const began = Date.now();
    assert.deepEqual(shapeOf({ strategy: "spot", minTickId: -443_636, maxTickId: 443_635 }, pool, 45, "ranges").ranges.map((range) => [range.tickLowerId, range.tickUpperId]), [[-443_636, 443_636]]);
    assert.ok(Date.now() - began < 1_000);
    /* Its last tick may not reach past the program's last one; and no other shape is one range. */
    refusedShape(() => shapeOf({ strategy: "spot", minTickId: -443_636, maxTickId: 443_636 }, pool, 45, "ranges"));
    for (const strategy of ["curve", "bidAsk"]) refusedShape(() => shapeOf({ ...request, strategy }, pool, 45, "ranges"));
    refusedShape(() => shapeOf({ ...request, strategy: "custom", weights: [{ tickId: 0, weight: 1 }] }, pool, 45, "ranges"));
  }
  /* A full range of a spacing of 1 is nearly a million ticks: refused at once, not worked out for twenty seconds. */
  const started = Date.now();
  assert.throws(() => shapeOf({ strategy: "curve", minTickId: -443_636, maxTickId: 443_636 }, pool), (error) => error instanceof DlmmProRefusal && error.code === "BAD_INPUT");
  assert.ok(Date.now() - started < 1_000);
  /* The same width on a coarser spacing is a shape like any other. */
  assert.ok(shapeOf({ strategy: "curve", minTickId: -443_600, maxTickId: 443_500 }, { tickSpacing: 100, tickCurrentId: 0 }).ranges.length <= 45);
});

test("an even position over the whole of a pool's prices is the SDK's own open and deposit of one range", async () => {
  const { venue, sdk } = at("theEnd");
  const { pool } = await sdk.state.fetchPoolWithExtensions(key(addresses.poolB));
  const spacing = pool.tickSpacing;
  /* Every tick of the pool's spacing the program has: more than a shape's columns are worked out over. */
  const shape = { strategy: "spot", minTickId: Math.ceil(-443_636 / spacing) * spacing, maxTickId: Math.floor(443_636 / spacing) * spacing - spacing };
  assert.ok((shape.maxTickId - shape.minTickId) / spacing + 1 > MAX_SHAPE_COLUMNS);
  const nftMint = Keypair.generate().publicKey;
  const build = await venue.positions.open({ pool: addresses.poolB, wallet: who.creator, nftMint: nftMint.toBase58(), shape, amountXRaw: "1000000000", amountYRaw: "20000", slippageBps: 0 });
  assert.deepEqual(build.steps.map((step) => step.role), ["OPEN", "DEPOSIT"]);
  /* The SDK's own shape over the same ticks — worked out here, a column a tick — merges into the one range the venue told without working them out. */
  const own = buildLiquidityShape({ strategy: StrategyType.Spot, minTickId: shape.minTickId, maxTickId: shape.maxTickId, tickSpacing: spacing, currentTickId: pool.tickCurrentId, maxRanges: 45 });
  assert.deepEqual(build.shape, { strategy: "spot", columns: [], ranges: own.ranges });
  assert.deepEqual(own.ranges.map((range) => [range.tickLowerId, range.tickUpperId]), [[shape.minTickId, shape.maxTickId + spacing]]);
  /* The price is inside it: both coins go in, by the SDK's own arithmetic for that range. */
  const multiplier = new BN(build.deposit.multiplier);
  const takes = amountsFromShape({ ranges: own.ranges, currentTickId: pool.tickCurrentId, currentSqrtPrice: pool.sqrtPrice, multiplier }).reduce((total, item) => ({ x: total.x + BigInt(item.amountX.toString()), y: total.y + BigInt(item.amountY.toString()) }), { x: 0n, y: 0n });
  assert.deepEqual({ x: build.deposit.xRaw, y: build.deposit.yRaw }, { x: takes.x.toString(), y: takes.y.toString() });
  assert.ok(takes.x > 0n && takes.y > 0n && takes.x <= 1_000_000_000n && takes.y <= 20_000n, JSON.stringify(build.deposit));
  const tickRanges = own.ranges.map(({ tickLowerId, tickUpperId }) => ({ tickLowerId, tickUpperId }));
  const wallet = key(who.creator);
  const [openTx, depositTx] = [
    (await sdk.position.openPosition({ pool: key(addresses.poolB), owner: wallet, payer: wallet, nftMint, tickRanges })).tx,
    (await sdk.position.addLiquidityByWeight({ pool: key(addresses.poolB), nftMint, owner: wallet, signer: wallet, tokenXMint: pool.tokenXMint, tokenYMint: pool.tokenYMint, tickRanges, parameters: encodeAddLiquidityByWeight({ ranges: own.ranges, maxAmountX: new BN(build.deposit.maximumXRaw), maxAmountY: new BN(build.deposit.maximumYRaw), multiplier }) })).tx,
  ];
  assert.deepEqual(assertSealed(build.steps[0], who.creator, [nftMint.toBase58()]).instructions, ofSdk(openTx));
  assert.deepEqual(assertSealed(build.steps[1], who.creator).instructions, ofSdk(depositTx));
  /* A limit order of that width is refused — it would rest on every one of those ticks — and so is any other shape. */
  assert.equal(await refused(() => venue.orders.place({ pool: addresses.poolB, wallet: who.creator, nftMint: Keypair.generate().publicKey.toBase58(), side: "ask", shape, totalAmountRaw: "1000000000", slippageTicks: null, referralWallet: null })), "BAD_INPUT");
  assert.equal(await refused(() => venue.positions.open({ pool: addresses.poolB, wallet: who.creator, nftMint: Keypair.generate().publicKey.toBase58(), shape: { ...shape, strategy: "curve" }, amountXRaw: "1000000000", amountYRaw: "20000", slippageBps: 0 })), "BAD_INPUT");
  /* On the chain: the rehearsal opened that position on a pool of the same spacing, as one range, and took it out again. */
  const ran = facts.review.wholeRange;
  assert.ok(ran.tickSpacing === spacing && ran.ticks > MAX_SHAPE_COLUMNS && ran.ranges === 1 && BigInt(ran.tookX) > 0n && BigInt(ran.tookY) > 0n && ran.rentTold >= ran.rentMadeLamports, JSON.stringify(ran));
});

test("what a reward's collect says has accrued is what arrives — after the reward coin's own transfer fee", async () => {
  const moment = "rewardsRunning";
  const request = { pool: addresses.poolB, nftMint: addresses.positionB, owner: who.creator };
  const [reward] = await at(moment).venue.rewards.read(addresses.poolB);
  /*
   * The position made to show a million of the reward written into its one range. The program keeps a range as 128
   * bytes and then 32 for each of its two rewards: a checkpoint of 16, the amount, 8 to spare — the SDK's own layout,
   * and the SDK reads the amount back from where it is put.
   */
  const positionAddress = derivePosition(key(addresses.positionB)).toBase58();
  const data = Buffer.from(fixture.snapshots[moment].accounts[positionAddress].data, "base64");
  const RANGE = 128 + 2 * 32;
  data.writeBigUInt64LE(1_000_000n, data.length - RANGE + 128 + 16);
  const written = { [positionAddress]: { data: data.toString("base64") } };
  {
    const { venue, sdk } = withAccounts(moment, written);
    const { positions } = await sdk.state.fetchPositionArrayWithPositions(key(positionAddress), { withReward: true });
    assert.deepEqual(positions.map((position) => position.rewards.map((entry) => entry.pendingAmount.toString())), [["1000000", "0"]]);
    assert.equal((await venue.rewards.collect(request)).accruedRaw, "1000000", "a coin with no fee of its own: what is written is what arrives");
  }
  /* The same reward in a coin that keeps a part of every transfer: the owner is told what arrives. */
  const feeOf = (bps, most) => {
    const config = Buffer.alloc(108);
    for (const at of [72, 90]) {
      config.writeBigUInt64LE(most, at + 8);
      config.writeUInt16LE(bps, at + 16);
    }
    return mintWith(1, config);
  };
  const arrives = async (bps, most) => (await withAccounts(moment, { ...written, [reward.mint]: feeOf(bps, most) }).venue.rewards.collect(request)).accruedRaw;
  assert.equal(await arrives(100, 1_000_000_000n), "990000", "1 % of it is the coin's");
  assert.equal(await arrives(100, 5_000n), "995000", "and no more than the coin's most");
  assert.equal(await arrives(0, 0n), "1000000");
});

test("a build that pays a coin out is refused where the owner's account of that coin is frozen — and only where it pays that coin", async () => {
  const accountOf = (mint, owner, program) => getAssociatedTokenAddressSync(key(mint), key(owner), true, program).toBase58();
  const [usdcOf, coinOf, coinBOf] = [(owner) => accountOf(addresses.usdc, owner, TOKEN_PROGRAM_ID), (owner) => accountOf(addresses.coin, owner, TOKEN_2022_PROGRAM_ID), (owner) => accountOf(addresses.coinB, owner, TOKEN_2022_PROGRAM_ID)];
  /** The venue on a moment with one token account frozen — its state, as the token program keeps it. */
  const frozenAt = (moment, address) => {
    const entry = fixture.snapshots[moment].accounts[address];
    assert.ok(entry, `${address} is there at ${moment}`);
    const data = Buffer.from(entry.data, "base64");
    assert.equal(data.readUInt8(108), 1);
    data.writeUInt8(2, 108);
    return withAccounts(moment, { [address]: { data: data.toString("base64") } }).venue;
  };
  /* A removal from a range the price is inside pays both coins. */
  const remove = { pool: addresses.poolB, nftMint: addresses.positionB, owner: who.creator, bps: 1_000, slippageBps: 100 };
  assertSealed(await at("theEnd").venue.positions.remove(remove), who.creator);
  for (const account of [usdcOf(who.creator), coinBOf(who.creator)]) assert.equal(await refused(() => frozenAt("theEnd", account).positions.remove(remove)), "BAD_INPUT");
  {
    /*
     * A range wholly above the price pays one coin now — and the other as soon as the price is inside it. A band that
     * reaches into the range is held to the owner's accounts of both; with no band the removal pays the one, and is built.
     */
    const { venue, sdk } = at("theEnd");
    const { pool } = await sdk.state.fetchPoolWithExtensions(key(addresses.poolD));
    const view = await venue.positions.read({ pool: addresses.poolD, nftMint: addresses.positionD });
    const above = view.slots.map((slot, index) => ({ ...slot, index })).filter((slot) => slot.tickLowerId > pool.tickCurrentId && slot.unlocked !== "0").sort((a, b) => a.tickLowerId - b.tickLowerId)[0];
    assert.ok(above, "a range of the position lies wholly above the price");
    const reach = Math.ceil((1.0001 ** (above.tickLowerId - pool.tickCurrentId + pool.tickSpacing) - 1) * 10_000);
    const request = { pool: addresses.poolD, nftMint: addresses.positionD, owner: who.creator, bps: 1_000, slots: [above.index] };
    const mintY = pool.tokenYMint.toBase58();
    const yOfOwner = accountOf(mintY, who.creator, key(fixture.snapshots.theEnd.accounts[mintY].owner));
    const inBand = await venue.positions.remove({ ...request, slippageBps: reach });
    assert.equal(inBand.expected.yRaw, "0", "at the price of the build it pays token X alone");
    assert.ok(BigInt(inBand.minimum.xRaw) < BigInt(inBand.expected.xRaw), "and inside the band less of it: there the range pays token Y too");
    assert.equal(await refused(() => frozenAt("theEnd", yOfOwner).positions.remove({ ...request, slippageBps: reach })), "BAD_INPUT");
    assertSealed(await frozenAt("theEnd", yOfOwner).positions.remove({ ...request, slippageBps: 0 }), who.creator);
  }
  /* The launch position earns in USDC alone: its collect and its compound pay USDC out; a frozen account of the coin — which the collect pays nothing of — does not hold the collect up. */
  const fees = { pool: addresses.pool, nftMint: addresses.position, owner: who.creator };
  assert.equal(await refused(() => frozenAt("ordersFilling", usdcOf(who.creator)).positions.collect(fees)), "BAD_INPUT");
  assertSealed(await frozenAt("ordersFilling", coinOf(who.creator)).positions.collect(fees), who.creator);
  assert.equal(await refused(() => frozenAt("bidsFilled", usdcOf(who.creator)).positions.compound({ ...fees, slippageBps: 100 })), "BAD_INPUT");
  /* An ask's collect pays what its filled ticks earned — USDC; closing it pays back the coin that never sold as well. */
  const order = { pool: addresses.pool, nftMint: addresses.asks, owner: who.buyer };
  const filled = (await at("ordersFilling").venue.orders.read(order)).ticks.filter((tick) => tick.state === "filled").map((tick) => tick.tickId);
  assert.equal(await refused(() => frozenAt("ordersFilling", usdcOf(who.buyer)).orders.collect({ ...order, tickIds: filled })), "BAD_INPUT");
  assertSealed(await frozenAt("ordersFilling", coinOf(who.buyer)).orders.collect({ ...order, tickIds: filled }), who.buyer);
  assert.equal(await refused(() => frozenAt("ordersFilling", coinOf(who.buyer)).orders.close(order)), "BAD_INPUT");
  /* A reward is paid in its own coin. */
  const reward = { pool: addresses.poolB, nftMint: addresses.positionB, owner: who.creator };
  assertSealed(await at("rewardsRunning").venue.rewards.collect(reward), who.creator);
  assert.equal(await refused(() => frozenAt("rewardsRunning", coinOf(who.creator)).rewards.collect(reward)), "BAD_INPUT");
  {
    /* What an emission did not pay goes back to the slot's authority, into its own account of the reward's coin — after the emission has ended. */
    const [slot] = await at("theEnd").venue.rewards.read(addresses.poolB);
    const ended = slot.endsAt + 60 - fixture.snapshots.theEnd.clock.unix;
    const back = { pool: addresses.poolB, authority: who.creator };
    assertSealed(await later("theEnd", ended).venue.rewards.withdrawIneligible(back), who.creator);
    const account = coinOf(who.creator);
    const data = Buffer.from(fixture.snapshots.theEnd.accounts[account].data, "base64");
    data.writeUInt8(2, 108);
    assert.equal(await refused(() => later("theEnd", ended, { [account]: { data: data.toString("base64") } }).venue.rewards.withdrawIneligible(back)), "BAD_INPUT");
  }
  /* On the chain: the token program failed a collect whose account was frozen after it was built; with the account of the coin it pays nothing of frozen, the collect landed. */
  const ran = facts.review.frozen;
  assert.ok(ran.paidAccountRefused.includes("code: 17") && ran.unpaidAccountLanded === true && BigInt(ran.paidRaw) > 0n, JSON.stringify(ran));
  const [paid] = eventsNamed(await at("theEnd").venue.events.read(fixture.transactions.collectPastFrozen.signature), "evtClaimFee");
  assert.deepEqual({ x: paid.data.amountX, y: paid.data.amountY }, { x: "0", y: ran.paidRaw });
  /*
   * And so in every transaction recorded where a build paid nothing of a coin — an order's collect, two compounds, a
   * removal under the price, that collect: the owner's account of the coin stood among the accounts, and the token
   * program was never called with it. Only the token program reads whether an account is frozen.
   */
  const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);
  const tokenCallsWith = (name, address) => {
    const { record } = fixture.transactions[name];
    const keys = record.transaction.message.accountKeys;
    assert.ok(keys.includes(address), `${name} names the account`);
    return record.meta.innerInstructions.flatMap((group) => group.instructions).filter((ix) => TOKEN_PROGRAMS.has(keys[ix.programIdIndex]) && ix.accounts.some((index) => keys[index] === address)).length;
  };
  for (const [name, owner] of [["collectAsks", who.buyer], ["compound", who.creator], ["compoundOneSided", who.creator], ["removeCompounded", who.creator], ["collectPastFrozen", who.creator]]) {
    assert.deepEqual({ unpaid: tokenCallsWith(name, coinOf(owner)), paid: tokenCallsWith(name, usdcOf(owner)) > 0 }, { unpaid: 0, paid: true }, name);
  }
});

test("the volatility fee the venue reads is the SDK quote's in every branch of its clock: inside the filter, decaying, forgotten, and after the reference is too old", async () => {
  /* The launch pool after trading; only the clock moves. The program keeps a reference for ten seconds, lets it decay for two minutes, forgets it after that, and starts again after an hour. */
  const seen = [];
  for (const seconds of [0, 5, 9, 11, 60, 119, 121, 600, 3_599, 3_601, 86_400]) {
    const { venue, sdk } = later("afterTrading", seconds);
    const model = await venue.pools.read(addresses.pool);
    const amount = 1_000_000n;
    const { quote } = await sdk.pool.quoteExactIn({ pool: key(addresses.pool), inputAmount: new BN(amount.toString()), swapForY: false, hasReferral: false, swapper: key(who.buyer) });
    const charged = [quote.mmFee, quote.limitOrderFee, quote.protocolFee, quote.hostFee, quote.partnerFee].reduce((total, part) => total + BigInt(part.toString()), 0n);
    assert.equal(charged, (amount * BigInt(model.fee.numerator) + 999_999_999n) / 1_000_000_000n, `${seconds} s on: ${model.fee.baseBps} + ${model.fee.dynamicBps} bps`);
    seen.push(model.fee.dynamicBps);
  }
  assert.ok(seen[0] > 0, "after trading the volatility part is charged");
  assert.ok(new Set(seen).size >= 3, `the clock alone moves it: ${seen.join()}`);
  assert.ok(seen.at(-1) < seen[0], "and a day on it has fallen");
});

test("the program's two log events are read off the log, inside the program's own frames only", async () => {
  const { transactionResponseOf } = await import("../../../solana/v1-tx.ts");
  const coder = new DlmmProClient(at("opened").connection).program.coder.events;
  /* The event the program writes when a pool's bitmap extension is made: its mark, then the pool. */
  const mark = Buffer.from(DlmmProIDL.events.find((event) => event.name === "EvtInitializeBitmapExtension").discriminator);
  const line = `Program data: ${Buffer.concat([mark, key(addresses.pool).toBuffer()]).toString("base64")}`;
  assert.deepEqual(coder.decode(line.slice("Program data: ".length)).name, "evtInitializeBitmapExtension");
  const whole = transactionResponseOf(fixture.transactions.swapNoReferral.record);
  const withLog = (logMessages) => decodeDlmmProEvents({ ...whole, meta: { ...whole.meta, logMessages } }, DLMM_PRO_PROGRAM, coder);
  const inside = withLog([`Program ${DLMM_PRO_PROGRAM} invoke [1]`, line, `Program ${DLMM_PRO_PROGRAM} success`]);
  assert.deepEqual(inside.map((event) => [event.name, event.via]), [["evtSwap", "cpi"], ["evtInitializeBitmapExtension", "log"]]);
  assert.deepEqual(inside[1].data, { pool: addresses.pool });
  /* The same line written by another program, or by one the program called, is not the program's word. */
  const other = Keypair.generate().publicKey.toBase58();
  assert.deepEqual(withLog([`Program ${other} invoke [1]`, line, `Program ${other} success`]).map((event) => event.name), ["evtSwap"]);
  assert.deepEqual(withLog([`Program ${DLMM_PRO_PROGRAM} invoke [1]`, `Program ${other} invoke [2]`, line, `Program ${other} success`, `Program ${DLMM_PRO_PROGRAM} success`]).map((event) => event.name), ["evtSwap"]);
  /* An event the program writes as an inner instruction is not taken from a log line that carries its bytes. */
  const swapMark = Buffer.from(DlmmProIDL.events.find((event) => event.name === "EvtSwap").discriminator);
  assert.deepEqual(withLog([`Program ${DLMM_PRO_PROGRAM} invoke [1]`, `Program data: ${Buffer.concat([swapMark, Buffer.alloc(200)]).toString("base64")}`, "Program data: not base64 at all", `Program ${DLMM_PRO_PROGRAM} success`]).map((event) => event.name), ["evtSwap"]);
  /* On the chain: the deposit and the order that made a pool's extension wrote it to the log, and it reads so. */
  for (const name of ["depositMakesExtension", "orderMakesExtension"]) {
    const events = await at("theEnd").venue.events.read(fixture.transactions[name].signature);
    assert.ok(events.some((event) => event.name === "evtInitializeBitmapExtension" && event.via === "log"), `${name}: ${events.map((event) => event.name).join()}`);
  }
});

test("what the review found stated and never run, on the chain: a creator that is not the payer, a fee that falls with time, a swap's least, a long walk, a priority price, a badge, dust", () => {
  /*
   * This test reads the record alone — what the program did when the rehearsal put each statement to it. It does not
   * exercise the venue: it fails when a run recorded anew stops showing one of these facts, and the statement in the
   * venue's own words has to be read again. The venue's arithmetic for each is held by the tests above.
   */
  const review = facts.review;
  /* A fee that falls with time — 50 % to 1 % asked, in 600 steps: it settled where the build said, not where it was asked; an early swapper paid that, not the cliff. */
  assert.deepEqual({ asked: review.timeSchedule.askedEndBps, settled: review.timeSchedule.settledBps }, { asked: 100, settled: 106.14 });
  assert.ok(Math.abs(review.timeSchedule.earlySwapperPaidBps - 106.14) <= 0.5, String(review.timeSchedule.earlySwapperPaidBps));
  assert.deepEqual(review.timeSchedule.points.map((point) => [point.after, point.period, point.baseBps]).filter(([after]) => after !== 300), [[0, 0, 5_000], [600, 600, 106.14], [3_000, 600, 106.14]]);
  assert.ok(review.timeSchedule.points.every((point) => Math.abs(point.paidBps - point.baseBps) <= 0.5), JSON.stringify(review.timeSchedule.points));
  /* A swap's least is held to what the wallet receives after the coin's own transfer fee: an atom more was refused, exactly that landed. */
  assert.deepEqual([review.leastOut.overRefused, review.leastOut.movedRefused], ["ExceededSlippage", "ExceededSlippage"]);
  /* A walk of more than three tick arrays fits a message and its ceiling; a priority price was charged as told. */
  assert.ok(review.extension.walkArrays > 3 && review.extension.walkBytes <= MAX_TX_BYTES && review.extension.walkUnitsUsed * 11 <= review.extension.walkUnitsLimit * 10, JSON.stringify(review.extension));
  assert.equal(review.extension.priorityFeeLamports, LAMPORTS_PER_SIGNATURE + Math.ceil((review.extension.priorityUnitsLimit * review.extension.priorityMicroLamports) / 1_000_000));
  /* A deposit and an order beyond the bitmap without the extension were refused by the chain; the venue's made it first. */
  assert.deepEqual([review.extension.bareDepositRefused, review.orderExtension.bareOrderRefused], ["TickArrayBitmapExtensionAccountIsNotProvided", "TickArrayBitmapExtensionAccountIsNotProvided"]);
  assert.ok(review.extension.farRentTold >= review.extension.farRentMadeLamports);
  /* A coin with a permanent delegate: refused without a badge, taken with one. */
  assert.equal(review.badge.withoutBadgeRefused, "UnsupportedMint");
  /* So was a coin whose mint can be closed; a Token-2022 coin with a freeze authority and nothing else made its pool without one. */
  assert.equal(review.badge.closeAuthorityRefused, "UnsupportedMint");
  assert.ok(typeof review.badge.freezeAuthorityPool === "string" && review.badge.freezeAuthorityPool !== review.badge.pool);
  /* A reward's coin with a freeze authority was refused by the chain; so was a payer that is not the pool's creator setting its slot up. */
  assert.equal(review.reward.freezeAuthorityRefused, "UnsupportedMint");
  assert.equal(review.reward.payerRefused, "InvalidPermission");
  /* USDC has a freeze authority too, and the program took it as a reward without a badge. */
  assert.equal(review.reward.usdcTaken, true);
  /* An ask on fixed ticks the price had crossed was refused by the chain. */
  assert.equal(review.crossedOrder.refused, "InvalidParameters");
  /*
   * Lamports that lay at the addresses of a pool's oracle, vaults and extension — more at each than the chain asks an
   * empty account to keep, or they would not have lain there — lowered what the chain took by exactly themselves: the
   * same pools with nothing at their addresses took that much more.
   */
  const lay = Number(review.dust.lamportsAtEachAddress);
  assert.ok(lay > rentOf(0) && review.extension.dustLamports === review.dust.lamportsAtEachAddress);
  assert.deepEqual({ lay: review.dust.layLamports, less: review.dust.cleanRentMadeLamports - review.dust.rentMadeLamports }, { lay: 4 * lay, less: 4 * lay });
  assert.equal(review.extension.cleanPoolRentMadeLamports - review.extension.poolRentMadeLamports, 3 * lay);
  assert.equal(review.extension.extensionRentMadeLamports, rentOf(SIZES.bitmapExtension) - lay);
  assert.ok(review.dust.rentTold >= review.dust.cleanRentMadeLamports && review.extension.poolRentTold >= review.extension.cleanPoolRentMadeLamports);
  /*
   * A relative order was passed every tick array in its band's reach; of those that were missing the program made only
   * the ones the order stood in. What it was told over what the chain took is the heads of the two arrays its ticks
   * could have stood in, less those it made — and the spare bytes of its NFT, as an order on fixed ticks is told over.
   */
  assert.ok(review.wideBand.missingArrays > 2 && review.wideBand.madeArrays <= review.wideBand.stoodInArrays && review.wideBand.stoodInArrays <= 2, JSON.stringify(review.wideBand));
  assert.equal(review.wideBand.rentTold - review.wideBand.rentMadeLamports - (2 - review.wideBand.madeArrays) * rentOf(SIZES.tickArrayHead), review.orderExtension.rentTold - review.orderExtension.placedRentLamports);
});
