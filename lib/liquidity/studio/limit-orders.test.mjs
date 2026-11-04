import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";

import { parseLimitInput, reviewLimitAction, submitLiquidityAction } from "./actions.ts";
import { LiquidityRefusal } from "./contract.ts";
import { DLMM_PROGRAM } from "./dlmm.ts";
import {
  assertLimitBins,
  createLimitVenue,
  LIMIT_MAKER_SHARE_BPS,
  MAX_LIMIT_BINS,
  rollAmount,
  sideFits,
  spreadAmount,
  statusOf,
  unitsFromTokens,
} from "./limit-orders.ts";
import { builtCallsOnly, readTicket } from "./ticket.ts";

const require = createRequire(import.meta.url);
const SDK = require("@meteora-ag/dlmm");
const DLMMClass = SDK.default ?? SDK;

const KEY = "a-test-key-that-is-long-enough";
const OPEN = { RYNTRA_LIQUIDITY_ACTIONS: "OPEN", BETA_TOKEN_SECRET: KEY };
const OWNER = Keypair.generate();
const OWNER_ADDRESS = OWNER.publicKey.toBase58();
const STRANGER = Keypair.generate().publicKey;
const POOL = Keypair.generate().publicKey;
const STOCK = Keypair.generate().publicKey;
const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const ACTIVE = 100;
const BIN_STEP = 20;

const refusal = (code) => (error) => error instanceof LiquidityRefusal && error.code === code;

/* ------------------------------------------------------------------ pure */

test("token figures the SDK prints come back to base units without a float", () => {
  assert.equal(unitsFromTokens("12.5", 6), 12_500_000n);
  assert.equal(unitsFromTokens("0.000001", 6), 1n);
  assert.equal(unitsFromTokens("1e-7", 9), 100n);
  assert.equal(unitsFromTokens("1.2e+21", 0), 1_200_000_000_000_000_000_000n);
  assert.equal(unitsFromTokens("0.1234567891", 6), 123_456n, "floored past the token's decimals");
  assert.equal(unitsFromTokens("0", 9), 0n);
  assert.throws(() => unitsFromTokens("-1", 6));
});

test("an order's bins: ordered, at most fifty, inside the pool's ids", () => {
  assert.equal(assertLimitBins({ lower: 101, upper: 101 }, 400_000), 1);
  assert.equal(assertLimitBins({ lower: 101, upper: 150 }, 400_000), MAX_LIMIT_BINS);
  assert.throws(() => assertLimitBins({ lower: 101, upper: 151 }, 400_000), refusal("RANGE_TOO_WIDE"));
  assert.throws(() => assertLimitBins({ lower: 120, upper: 110 }, 400_000), refusal("RANGE_INVALID"));
  assert.throws(() => assertLimitBins({ lower: 1.5, upper: 2 }, 400_000), refusal("RANGE_INVALID"));
  assert.throws(() => assertLimitBins({ lower: 500_001, upper: 500_002 }, 400_000), refusal("RANGE_INVALID"));
});

test("an ask sits wholly over the price, a bid wholly under it — never on the active bin", () => {
  assert.equal(sideFits("ask", { lower: ACTIVE + 1, upper: ACTIVE + 5 }, ACTIVE), true);
  assert.equal(sideFits("ask", { lower: ACTIVE, upper: ACTIVE + 5 }, ACTIVE), false);
  assert.equal(sideFits("bid", { lower: ACTIVE - 5, upper: ACTIVE - 1 }, ACTIVE), true);
  assert.equal(sideFits("bid", { lower: ACTIVE - 5, upper: ACTIVE }, ACTIVE), false);
});

test("the amount spreads evenly, the remainder in the bin nearest the price, nothing lost", () => {
  const ask = spreadAmount("ask", { lower: 101, upper: 103 }, 10n);
  assert.deepEqual(ask, [{ bin: 101, amount: 4n }, { bin: 102, amount: 3n }, { bin: 103, amount: 3n }]);
  const bid = spreadAmount("bid", { lower: 97, upper: 99 }, 10n);
  assert.deepEqual(bid, [{ bin: 99, amount: 4n }, { bin: 98, amount: 3n }, { bin: 97, amount: 3n }]);
  assert.equal([...ask].reduce((t, r) => t + r.amount, 0n), 10n);
  assert.throws(() => spreadAmount("ask", { lower: 101, upper: 110 }, 9n), refusal("AMOUNT_ZERO"), "every bin gets something");
});

test("an order's state from its bins, and a roll places a hair less than the fills brought", () => {
  assert.equal(statusOf([{ status: "filled" }, { status: "filled" }]), "filled");
  assert.equal(statusOf([{ status: "filled" }, { status: "open" }]), "partial");
  assert.equal(statusOf([{ status: "open" }]), "open");
  assert.equal(statusOf([]), "open");
  assert.equal(rollAmount(1_000_000n), 999_900n);
  assert.equal(rollAmount(50n), 49n, "at least one base unit of room");
  assert.equal(rollAmount(1n), 0n);
});

/* ------------------------------------------- the venue, on the real SDK's builders */

/**
 * A DLMM pool the real SDK object stands for, without a network: its place / cancel / close builders are the SDK's
 * own; what would read the chain (the parsed order, the rent quote, the fee) answers from memory.
 */
function pool({ limitOrders = true, enabled = true, order = null } = {}) {
  const connection = new Connection("http://127.0.0.1:9");
  connection.getAccountInfo = async (key) => {
    if (order && key.equals(order.address)) return order.info;
    return { owner: new PublicKey(DLMM_PROGRAM), lamports: 1, data: Buffer.alloc(8), executable: false }; // bin arrays exist
  };
  connection.getLatestBlockhash = async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1_000 });
  connection.getMinimumBalanceForRentExemption = async (bytes) => bytes * 7;
  connection.getSlot = async () => 5;
  connection.getProgramAccounts = async () => (order ? [{ pubkey: order.address, account: { data: POOL.toBuffer() } }] : []);
  const program = SDK.createProgram(connection, { cluster: "mainnet-beta" });
  const dlmm = Object.create(DLMMClass.prototype);
  Object.assign(dlmm, {
    pubkey: POOL,
    program,
    opt: { cluster: "mainnet-beta" },
    binArrayBitmapExtension: null,
    lbPair: {
      activeId: ACTIVE,
      binStep: BIN_STEP,
      status: enabled ? 0 : 1,
      reserveX: Keypair.generate().publicKey,
      reserveY: Keypair.generate().publicKey,
      parameters: { functionType: limitOrders ? 2 : 1 },
      rewardInfos: [],
    },
    tokenX: { publicKey: STOCK, mint: { address: STOCK, decimals: 8, tlvData: Buffer.alloc(0) }, owner: TOKEN_2022_PROGRAM_ID, transferHookAccountMetas: [], amount: 0n },
    tokenY: { publicKey: NATIVE_MINT, mint: { address: NATIVE_MINT, decimals: 9, tlvData: Buffer.alloc(0) }, owner: TOKEN_PROGRAM_ID, transferHookAccountMetas: [], amount: 0n },
  });
  dlmm.getDynamicFee = () => ({ toString: () => "0.3" });
  dlmm.quoteCreateLimitOrder = async ({ bins }) => ({ limitOrderCost: 0, binArraysCount: bins.length > 40 ? 1 : 0, binArrayCost: 0, bitmapExtensionCost: 0 });
  dlmm.getLimitOrder = async (key) => {
    if (!order || !key.equals(order.address)) throw new Error("Unknown position account");
    return { publicKey: key, limitOrderData: order.parsed };
  };
  dlmm.getLimitOrderByUserAndLbPair = async () => (order ? [{ publicKey: order.address, limitOrderData: order.parsed }] : []);
  const sdk = {
    DLMM: { create: async () => dlmm },
    createProgram: SDK.createProgram,
    getPriceOfBinByBinId: SDK.getPriceOfBinByBinId,
    isSupportLimitOrder: SDK.isSupportLimitOrder,
    limitOrderFilter: SDK.limitOrderFilter,
    limitOrderOwnerFilter: SDK.limitOrderOwnerFilter,
  };
  const fresh = [];
  const venue = createLimitVenue({
    connection,
    sdk,
    now: () => 1_000,
    newKeypair: () => {
      const key = Keypair.generate();
      fresh.push(key);
      return key;
    },
  });
  return { venue, connection, fresh, dlmm };
}

/** A filled ask of 1 stock token (8 decimals) at bin 110 that brought 0.5 SOL and a little fee, as the SDK parses it. */
function filledAsk({ owner = OWNER.publicKey, status = 2 } = {}) {
  const address = Keypair.generate().publicKey;
  const data = Buffer.concat([Buffer.alloc(8, 1), POOL.toBuffer(), owner.toBuffer(), Buffer.alloc(80)]);
  const bin = {
    binId: 110,
    empty: false,
    depositAmountX: "1",
    depositAmountY: "0",
    unfilledAmountX: status === 2 ? "0" : "0.6",
    unfilledAmountY: "0",
    swappedAmountX: "0",
    swappedAmountY: status === 2 ? "0.5" : "0.2",
    isAskSide: true,
    filledAmountX: status === 2 ? "1" : "0.4",
    filledAmountY: "0",
    feeAmountX: "0",
    feeAmountY: "0.000750001",
    status,
  };
  return {
    address,
    info: { owner: new PublicKey(DLMM_PROGRAM), lamports: 2_040_000, data, executable: false },
    parsed: {
      totalDepositAmountX: "1",
      totalDepositAmountY: "0",
      limitOrderBinData: [bin],
      totalUnfilledAmountX: bin.unfilledAmountX,
      totalUnfilledAmountY: "0",
      totalFilledAmountX: bin.filledAmountX,
      totalFilledAmountY: "0",
      totalSwappedAmountX: "0",
      totalSwappedAmountY: bin.swappedAmountY,
      totalFeeAmountX: "0",
      totalFeeAmountY: "0.000750001",
      transferFeeExcludedWithdrawableAmountX: bin.unfilledAmountX,
      transferFeeExcludedWithdrawableAmountY: status === 2 ? "0.500750001" : "0.200750001",
    },
  };
}

const placeAsk = (amount = "100000000", bins = { lower: 105, upper: 107 }) => ({ pool: POOL.toBase58(), owner: OWNER_ADDRESS, side: "ask", amount, bins });

test("place: no Ryntra fee, the maker's half of the swap fee said, the order's deposit refundable, what all of it brings", async () => {
  const { venue } = pool();
  const preview = await venue.previewPlace(placeAsk());
  assert.equal(preview.action, "limit_place");
  assert.deepEqual(preview.fees, [], "no fee row of Ryntra's");
  assert.equal(preview.makerShareBps, LIMIT_MAKER_SHARE_BPS);
  assert.equal(preview.feeBps, 30);
  assert.equal(preview.transactions, 1);
  assert.deepEqual(preview.rent.map((r) => [r.what, r.direction, r.refundable]), [["limit_order", "pay", true]]);
  assert.equal(preview.rent[0].lamports, String((120 + 3 * 32) * 7), "the order's account sized as the program sizes it");
  assert.deepEqual(preview.place.spread, [{ bin: 105, amount: "33333334" }, { bin: 106, amount: "33333333" }, { bin: 107, amount: "33333333" }]);
  assert.equal(preview.place.deposit.asset, STOCK.toBase58());
  assert.equal(preview.place.fullFill.asset, NATIVE_MINT.toBase58());
  assert.ok(BigInt(preview.place.fullFill.units) > 0n);
  assert.ok(Number(preview.place.lowerPrice) < Number(preview.place.upperPrice));
});

test("place: refused on the wrong side, a pool that takes no limit orders, a disabled pool, a zero amount", async () => {
  await assert.rejects(pool().venue.previewPlace(placeAsk("1", { lower: 95, upper: 99 })), refusal("SIDE_NOT_ACCEPTED"));
  await assert.rejects(pool().venue.previewPlace({ ...placeAsk(), side: "bid", bins: { lower: 101, upper: 101 } }), refusal("SIDE_NOT_ACCEPTED"));
  await assert.rejects(pool({ limitOrders: false }).venue.previewPlace(placeAsk()), refusal("LIMIT_NOT_SUPPORTED"));
  await assert.rejects(pool({ enabled: false }).venue.previewPlace(placeAsk()), refusal("POOL_DISABLED"));
  await assert.rejects(pool().venue.previewPlace(placeAsk("0")), refusal("AMOUNT_ZERO"));
  await assert.rejects(pool().venue.previewPlace({ ...placeAsk(), owner: "not-a-key" }), refusal("BAD_REQUEST"));
});

test("place builds the SDK's own instruction: the person's wallet pays, a fresh key signs for the order account, the relay's call check passes", async () => {
  const { venue, fresh } = pool();
  const built = await venue.buildPlace(await venue.previewPlace({ ...placeAsk("2000000000"), side: "bid", bins: { lower: 95, upper: 99 } }));
  assert.equal(built.transactions.length, 1);
  assert.equal(built.order, fresh[0].publicKey.toBase58());
  assert.deepEqual(built.transactions[0].presigned, [fresh[0].publicKey.toBase58()]);
  const tx = Transaction.from(Buffer.from(built.transactions[0].wireBase64, "base64"));
  assert.equal(tx.feePayer.toBase58(), OWNER_ADDRESS);
  assert.ok(tx.instructions.some((ix) => ix.programId.toBase58() === DLMM_PROGRAM));
  const signers = tx.signatures.map((s) => s.publicKey.toBase58()).sort();
  assert.deepEqual(signers, [OWNER_ADDRESS, fresh[0].publicKey.toBase58()].sort(), "only the wallet and the order's fresh key");
  assert.equal(tx.signatures.find((s) => s.publicKey.equals(OWNER.publicKey)).signature, null, "the build never signs for the person");
  assert.deepEqual(builtCallsOnly(built.transactions[0].wireBase64, OWNER_ADDRESS, DLMM_PROGRAM), { ok: true }, "a bid paid in SOL wraps and unwraps only the person's own SOL");
});

test("place: a price that walked into the order's bins since the preview is refused, never placed to trade at once", async () => {
  const { venue, dlmm } = pool();
  const preview = await venue.previewPlace(placeAsk());
  dlmm.lbPair.activeId = 106;
  await assert.rejects(venue.buildPlace(preview), refusal("PREVIEW_EXPIRED"));
  dlmm.lbPair.activeId = ACTIVE;
  await assert.rejects(venue.buildPlace({ ...preview, expiresAt: 0 }), refusal("PREVIEW_EXPIRED"));
  await assert.rejects(venue.buildPlace({ ...preview, place: { ...preview.place, deposit: { ...preview.place.deposit, units: "1" } } }), refusal("PREVIEW_EXPIRED"), "the build places what the preview says or nothing");
});

test("cancel: everything the order holds comes back, the account closes, only for its owner", async () => {
  const order = filledAsk({ status: 1 });
  const { venue } = pool({ order });
  const preview = await venue.previewCancel({ order: order.address.toBase58(), owner: OWNER_ADDRESS });
  assert.equal(preview.order.status, "partial");
  assert.equal(preview.order.filledBps, 4_000);
  assert.equal(preview.back.x.units, "60000000");
  assert.equal(preview.back.y.units, "200750001");
  assert.deepEqual(preview.rent, [{ what: "limit_order", direction: "return", lamports: "2040000", refundable: true }]);
  const built = await venue.buildCancel(preview);
  assert.deepEqual(built.transactions[0].presigned, [], "no key but the wallet's");
  assert.deepEqual(builtCallsOnly(built.transactions[0].wireBase64, OWNER_ADDRESS, DLMM_PROGRAM), { ok: true });
  const tx = Transaction.from(Buffer.from(built.transactions[0].wireBase64, "base64"));
  assert.equal(tx.instructions.filter((ix) => ix.programId.toBase58() === DLMM_PROGRAM).length, 2, "cancel, then close in the same transaction");

  const stranger = filledAsk({ owner: STRANGER });
  await assert.rejects(pool({ order: stranger }).venue.previewCancel({ order: stranger.address.toBase58(), owner: OWNER_ADDRESS }), refusal("NOT_OWNER"));
  await assert.rejects(pool().venue.previewCancel({ order: Keypair.generate().publicKey.toBase58(), owner: OWNER_ADDRESS }), refusal("ORDER_NOT_FOUND"));
});

test("roll (the Wheel): a filled sale is taken and a purchase placed with what it brought, in one prompt of two transactions", async () => {
  const order = filledAsk();
  const { venue, fresh } = pool({ order });
  const preview = await venue.previewRoll({ order: order.address.toBase58(), owner: OWNER_ADDRESS, bins: { lower: 98, upper: 98 } });
  assert.equal(preview.transactions, 2);
  assert.equal(preview.place.side, "bid");
  assert.equal(preview.place.deposit.units, String(rollAmount(500_750_001n)), "what the sale brought, a hair less");
  assert.equal(preview.place.deposit.asset, NATIVE_MINT.toBase58());
  const built = await venue.buildRoll(preview);
  assert.equal(built.transactions.length, 2);
  assert.deepEqual(built.transactions[0].presigned, []);
  assert.deepEqual(built.transactions[1].presigned, [fresh[0].publicKey.toBase58()], "the new order's key signs the second only");
  for (const tx of built.transactions) assert.deepEqual(builtCallsOnly(tx.wireBase64, OWNER_ADDRESS, DLMM_PROGRAM), { ok: true });

  await assert.rejects(pool({ order: filledAsk({ status: 1 }) }).venue.previewRoll({ order: filledAsk().address.toBase58(), owner: OWNER_ADDRESS, bins: { lower: 98, upper: 98 } }), refusal("ORDER_NOT_FOUND"));
  const partial = filledAsk({ status: 1 });
  await assert.rejects(pool({ order: partial }).venue.previewRoll({ order: partial.address.toBase58(), owner: OWNER_ADDRESS, bins: { lower: 98, upper: 98 } }), refusal("NOT_FILLED"));
  await assert.rejects(pool({ order }).venue.previewRoll({ order: order.address.toBase58(), owner: OWNER_ADDRESS, bins: { lower: 101, upper: 101 } }), refusal("SIDE_NOT_ACCEPTED"), "the purchase sits under the price");
});

test("a wallet's orders read from the program's accounts, with what each holds and brought", async () => {
  const order = filledAsk();
  const { venue } = pool({ order });
  const orders = await venue.orders(OWNER_ADDRESS);
  assert.equal(orders.length, 1);
  const [view] = orders;
  assert.equal(view.side, "ask");
  assert.equal(view.status, "filled");
  assert.equal(view.deposit.units, "100000000");
  assert.equal(view.proceeds.units, "500000000");
  assert.equal(view.makerFees.y.units, "750001");
  assert.equal(view.withdrawable.y.units, "500750001");
});

/* ------------------------------------------------- the Review and the relay */

test("limit input is read field by field; anything else is refused before the chain is asked", () => {
  const place = { action: "limit_place", venue: "meteora-dlmm", request: placeAsk() };
  assert.deepEqual(parseLimitInput(place), place);
  assert.equal(parseLimitInput({ ...place, venue: "meteora-damm2" }), null);
  assert.equal(parseLimitInput({ ...place, request: { ...placeAsk(), side: "both" } }), null);
  assert.equal(parseLimitInput({ ...place, request: { ...placeAsk(), amount: "1.5" } }), null);
  assert.equal(parseLimitInput({ ...place, request: { ...placeAsk(), bins: { lower: 1 } } }), null);
  assert.deepEqual(parseLimitInput({ action: "limit_cancel", venue: "meteora-dlmm", request: { order: POOL.toBase58(), owner: OWNER_ADDRESS, extra: 1 } }), { action: "limit_cancel", venue: "meteora-dlmm", request: { order: POOL.toBase58(), owner: OWNER_ADDRESS } });
  assert.equal(parseLimitInput({ action: "add", venue: "meteora-dlmm", request: placeAsk() }), null, "a pool action is not a limit order");
});

const chainAt = (blocksLeft) => () => ({
  epochInfo: async () => ({ blockHeight: 1_000n - BigInt(blocksLeft), absoluteSlot: 9_000_000n }),
  performanceSamples: async () => [{ numSlots: 300n, samplePeriodSecs: 60 }],
});

function reviewDeps(made, env = OPEN, prices = { x: 200, y: 150 }) {
  const sent = [];
  made.connection.simulateTransaction = async () => ({ value: { err: null, logs: [] } });
  made.connection.sendRawTransaction = async (bytes) => {
    sent.push(Buffer.from(bytes).toString("base64"));
    return "sig";
  };
  made.connection.getSignatureStatuses = async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] });
  return {
    sent,
    deps: {
      env,
      connections: [made.connection],
      venuesFor: () => ({}),
      limitVenueFor: () => made.venue,
      pricesOf: async () => ({ x: prices.x, y: prices.y, xMint: STOCK.toBase58(), yMint: NATIVE_MINT.toBase58() }),
      forget: () => undefined,
      takeFreshKey: (pk) => made.fresh.find((k) => k.publicKey.toBase58() === pk) ?? null,
      chainReader: chainAt(120),
      pollMs: 1,
      relayMs: 2_000,
    },
  };
}

test("Review: a limit order is sealed like a pool action — gate, canary ceiling, ticket naming the action, fresh key added only by the relay", async () => {
  const body = { action: "limit_place", venue: "meteora-dlmm", request: placeAsk("100000000") };
  const closed = await reviewLimitAction(body, reviewDeps(pool(), { BETA_TOKEN_SECRET: KEY }).deps);
  assert.equal(closed.code, "ACTIONS_CLOSED", "closed by the engine's gate by default");
  const unwired = await reviewLimitAction(body, { ...reviewDeps(pool()).deps, limitVenueFor: undefined });
  assert.equal(unwired.code, "ACTIONS_UNAVAILABLE");

  const canary = { RYNTRA_LIQUIDITY_ACTIONS: "CANARY", RYNTRA_LIQUIDITY_CANARY_WALLET: OWNER_ADDRESS, BETA_TOKEN_SECRET: KEY };
  const over = await reviewLimitAction(body, reviewDeps(pool(), canary).deps);
  assert.equal(over.code, "CANARY_LIMIT", "1 token at $200 is over the canary's $5");
  const unpriced = await reviewLimitAction(body, reviewDeps(pool(), canary, { x: null, y: 150 }).deps);
  assert.equal(unpriced.code, "CANARY_UNPRICED");

  const made = pool();
  const { deps, sent } = reviewDeps(made);
  const reviewed = await reviewLimitAction(body, deps);
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  assert.equal(reviewed.value.depositUsd, 200);
  assert.equal(reviewed.value.preview.action, "limit_place");
  assert.equal(reviewed.value.position, made.fresh[0].publicKey.toBase58());
  const ticket = readTicket(reviewed.value.ticket, OPEN);
  assert.equal(ticket.ok, true);
  assert.equal(ticket.ticket.action, "limit_place");
  const shown = Transaction.from(Buffer.from(reviewed.value.transactions[0].wireBase64, "base64"));
  assert.ok(shown.signatures.every((e) => e.signature === null || e.signature.every((b) => b === 0)), "the wallet sees bytes nobody signed");

  shown.partialSign(OWNER);
  const relayed = await submitLiquidityAction({ ticket: reviewed.value.ticket, signed: [shown.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64")] }, deps);
  assert.equal(relayed.ok, true);
  assert.equal(relayed.value.settled, true);
  assert.equal(Transaction.from(Buffer.from(sent[0], "base64")).verifySignatures(true), true, "the wallet's and the order key's signatures, both real");
});

test("Review: refusals keep their codes and statuses", async () => {
  const made = pool({ limitOrders: false });
  const answer = await reviewLimitAction({ action: "limit_place", venue: "meteora-dlmm", request: placeAsk() }, reviewDeps(made).deps);
  assert.deepEqual([answer.status, answer.code], [422, "LIMIT_NOT_SUPPORTED"]);
  const gone = await reviewLimitAction({ action: "limit_cancel", venue: "meteora-dlmm", request: { order: Keypair.generate().publicKey.toBase58(), owner: OWNER_ADDRESS } }, reviewDeps(pool()).deps);
  assert.deepEqual([gone.status, gone.code], [404, "ORDER_NOT_FOUND"]);
});
