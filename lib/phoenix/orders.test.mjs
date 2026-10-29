// Run from repo root: node --test lib/phoenix/orders.test.mjs
//
// B6b — orders on Phoenix from the person's wallet: the gate, the request, the units, the fees, the funding, the plan of
// instructions an order is, what a built transaction may call (on instructions built by Phoenix's own SDK 0.6.2 — its
// resolved builders, over a test exchange's accounts), the liquidation price and the margin from Phoenix's view program
// (Hawkeye's return bytes as the program writes them), the ticket, and the Review and the relay against a chain that
// answers from the test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildCancelAllIxResolved,
  buildCancelConditionalOrderIx,
  buildCancelOrdersByIdIxResolved,
  buildCreateConditionalOrdersAccountIx,
  buildHawkeyeViewFundingIx,
  buildHawkeyeViewLiquidationPriceIx,
  buildHawkeyeViewMarginForAssetIx,
  buildHawkeyeViewMarginIx,
  buildPlaceLimitOrderIxResolved,
  buildPlaceMarketOrderIxResolved,
  buildPlacePositionConditionalOrderIx,
  buildPlacePostOnlyOrderIxResolved,
  decodeHawkeyeReturnData,
  flight,
  HAWKEYE_PROGRAM_ADDRESS,
  OrderFlags,
  Side,
} from "@ellipsis-labs/rise";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";

import { traderAccountOf, web3Instruction } from "./collateral.ts";
import { afterFromHawkeye, reviewOrder, submitOrder, worstTicksOf } from "./orders-actions.ts";
import { fillsFrom, marketFactsFrom, traderFactsFrom } from "./orders-facts.ts";
import { orderReviewHandler, orderSubmitHandler } from "./orders-routes.ts";
import {
  admitOrders,
  builderFeeUsd,
  builderOf,
  CANARY_MAX_NOTIONAL_USD,
  conditionalOrdersOf,
  fillsSummary,
  FLIGHT_PROGRAM,
  flightBuilderState,
  flightGlobalState,
  feeSplitOf,
  fundingOf,
  issueOrderTicket,
  legsSideOk,
  leverageOf,
  lotsFromUnits,
  orderCallsOnly,
  orderOutcomeOf,
  orderRelayAfterSigning,
  parseOrderRequest,
  perpFeeUsd,
  planOrder,
  priceImpactPercent,
  PHOENIX_GLOBAL_CONFIG,
  PHOENIX_LOG_AUTHORITY,
  readOrderTicket,
  stepData,
  ticksFromUsd,
  unitsTextFromLots,
  usdFromTicks,
  usdTextFromTicks,
} from "./orders.ts";
import { PHOENIX_PROGRAM } from "./collateral.ts";

const OWNER = Keypair.fromSeed(new Uint8Array(32).fill(7));
const OWNER_ADDRESS = OWNER.publicKey.toBase58();
const STRANGER = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey.toBase58();
const BUILDER = Keypair.fromSeed(new Uint8Array(32).fill(11)).publicKey.toBase58();
const KEY = "a-test-key-that-is-long-enough";
const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const TRADER = traderAccountOf(OWNER_ADDRESS);

/* A test exchange: Phoenix's own program and log accounts, the rest stand-in keys in Phoenix's places. */
const key = (seed) => Keypair.fromSeed(new Uint8Array(32).fill(seed)).publicKey.toBase58();
const EXCHANGE = {
  phoenixProgramAddress: PHOENIX_PROGRAM,
  logAuthorityAddress: PHOENIX_LOG_AUTHORITY,
  globalConfigurationAddress: PHOENIX_GLOBAL_CONFIG,
  perpAssetMap: key(21),
  globalTraderIndex: [key(22), key(23)],
  activeTraderBuffer: [key(24), key(25)],
};
const BOOK = key(31);
const SPLINE = key(32);
/* SOL-like units: one tick is a cent, one lot a hundredth of SOL. */
const UNITS = { tickSize: 100, baseLotsDecimals: 2 };
const MARKET = { symbol: "SOL", assetId: 0, units: UNITS, orderbook: BOOK, spline: SPLINE, takerRate: 0.00035, makerRate: 0.00005, markUsd: 150, indexUsd: 149.9, status: "active", isolatedOnly: false, fundingIntervalSeconds: 3600 };

const open = { RYNTRA_PHOENIX_ORDERS: "OPEN", BETA_TOKEN_SECRET: KEY };
const canary = { RYNTRA_PHOENIX_ORDERS: "CANARY", RYNTRA_PHOENIX_CANARY_WALLET: OWNER_ADDRESS, BETA_TOKEN_SECRET: KEY };

/** Each plan step as Phoenix's SDK builds it, over the test exchange — the routed ones through the builder's proxy. */
async function sdkBuild(owner, steps, builder = null) {
  const trader = traderAccountOf(owner);
  const out = [];
  for (const step of steps) {
    let ix;
    const resolved = { exchange: EXCHANGE, market: { marketAddress: BOOK, splineCollection: SPLINE }, trader: { authority: owner, traderAccount: trader } };
    if (step.ix === "market") ix = buildPlaceMarketOrderIxResolved({ ...resolved, orderPacket: step.packet });
    else if (step.ix === "limit") ix = buildPlaceLimitOrderIxResolved({ ...resolved, orderPacket: step.packet });
    else if (step.ix === "postOnly") ix = buildPlacePostOnlyOrderIxResolved({ ...resolved, orderPacket: step.packet });
    else if (step.ix === "cancelAll") ix = buildCancelAllIxResolved({ ...resolved });
    else if (step.ix === "cancelOrders") ix = buildCancelOrdersByIdIxResolved({ ...resolved, orderIds: step.orders.map((order) => ({ nodePointer: null, orderId: { priceInTicks: order.priceInTicks, orderSequenceNumber: order.orderSequenceNumber } })) });
    else if (step.ix === "createConditional") ix = buildCreateConditionalOrdersAccountIx({ payer: owner, traderWallet: owner, traderAccount: trader, traderConditionalOrders: conditionalOrdersOf(trader), capacity: step.capacity });
    else if (step.ix === "cancelConditional") ix = buildCancelConditionalOrderIx({ traderAccount: trader, traderWallet: owner, orderbook: BOOK, traderConditionalOrders: conditionalOrdersOf(trader), conditionalOrderIndex: step.index, disableFirst: true, disableSecond: true });
    else ix = buildPlacePositionConditionalOrderIx({ payer: owner, traderAccount: trader, perpAssetMap: EXCHANGE.perpAssetMap, globalTraderIndex: EXCHANGE.globalTraderIndex, activeTraderBuffer: EXCHANGE.activeTraderBuffer, orderbook: BOOK, splineCollection: SPLINE, traderWallet: owner, traderConditionalOrders: conditionalOrdersOf(trader), assetId: step.assetId, greaterTriggerOrder: step.greater, lessTriggerOrder: step.less, sizeBaseLots: null, sizePercent: 100 });
    if (builder && (step.ix === "market" || step.ix === "limit" || step.ix === "postOnly" || step.ix === "positionConditional")) {
      ix = await flight.buildProxyInstructionIx({ builderAuthority: builder, builderTraderAccount: traderAccountOf(builder), traderWallet: owner, innerInstruction: ix });
    }
    out.push(ix);
  }
  return out;
}

const txOf = (kit, payer = OWNER.publicKey) => new Transaction({ feePayer: payer, blockhash: BLOCKHASH, lastValidBlockHeight: 1_000 }).add(...kit.map(web3Instruction));
const expectation = (steps, builder = null) => ({ owner: OWNER_ADDRESS, steps, orderbook: BOOK, spline: SPLINE, builder });
const ask = (over = {}) => ({ kind: "open", owner: OWNER_ADDRESS, symbol: "SOL", side: "long", type: "market", size: "10", ...over });

/* ------------------------------------------------------------------ gate */

test("the gate: closed unless set; a canary admits one wallet with a notional ceiling; open admits all; the builder is a public key or nothing", () => {
  assert.deepEqual(admitOrders(OWNER_ADDRESS, {}), { ok: false, code: "ORDERS_CLOSED" });
  assert.deepEqual(admitOrders(OWNER_ADDRESS, { RYNTRA_PHOENIX_ORDERS: "yes" }), { ok: false, code: "ORDERS_CLOSED" });
  assert.deepEqual(admitOrders(OWNER_ADDRESS, canary), { ok: true, mode: "CANARY", maxNotionalUsd: CANARY_MAX_NOTIONAL_USD });
  assert.deepEqual(admitOrders(STRANGER, canary), { ok: false, code: "ORDERS_CLOSED" });
  assert.deepEqual(admitOrders(OWNER_ADDRESS, { RYNTRA_PHOENIX_ORDERS: "CANARY" }), { ok: false, code: "ORDERS_CLOSED" }, "a canary with no wallet admits nobody");
  assert.deepEqual(admitOrders(null, { RYNTRA_PHOENIX_ORDERS: " open " }), { ok: true, mode: "OPEN", maxNotionalUsd: null });
  assert.equal(admitOrders(OWNER_ADDRESS, { RYNTRA_PHOENIX_COLLATERAL: "OPEN" }).ok, false, "the collateral's gate does not open orders");
  assert.equal(builderOf({}), null);
  assert.equal(builderOf({ RYNTRA_PHOENIX_BUILDER: "not-a-key" }), null);
  assert.equal(builderOf({ RYNTRA_PHOENIX_BUILDER: ` ${BUILDER} ` }), BUILDER);
});

/* --------------------------------------------------------------- request */

test("a request: field by field, digits of lots and ticks; a limit carries no TP/SL; the tolerance stays within 0.1–5 %", () => {
  assert.deepEqual(parseOrderRequest(ask()), { kind: "open", owner: OWNER_ADDRESS, symbol: "SOL", side: "long", type: "market", tif: "fok", sizeLots: 10n, priceTicks: null, slippageBps: 50, tpTicks: null, slTicks: null });
  assert.equal(parseOrderRequest(ask({ tp: "16000", sl: "14000" })).tpTicks, 16000n);
  assert.equal(parseOrderRequest(ask({ format: "v1" })).format, "v1");
  assert.equal(parseOrderRequest(ask({ type: "limit", price: "14500" })).priceTicks, 14500n);
  for (const bad of [ask({ size: "0" }), ask({ size: "1.5" }), ask({ size: 10 }), ask({ side: "buy" }), ask({ symbol: "SOL/USDC" }), ask({ owner: "x" }), ask({ type: "limit" }), ask({ type: "limit", price: "14500", tp: "16000" }), ask({ price: "14500" }), ask({ slippageBps: 5 }), ask({ slippageBps: 900 }), ask({ tp: "abc" }), ask({ format: "v0" }), ask({ kind: "swap" })]) {
    assert.equal(parseOrderRequest(bad), null, JSON.stringify(bad));
  }
  /* PERP-5: the time in force, within what the SDK has for each type — anything else is no request of ours. */
  assert.equal(parseOrderRequest(ask({ tif: "ioc" })).tif, "ioc");
  assert.equal(parseOrderRequest(ask({ type: "limit", price: "14500", tif: "post_only" })).tif, "post_only");
  assert.equal(parseOrderRequest(ask({ type: "limit", price: "14500" })).tif, "gtc", "a limit rests unless it was asked to do otherwise");
  for (const bad of [ask({ tif: "gtc" }), ask({ tif: "post_only" }), ask({ type: "limit", price: "14500", tif: "ioc" }), ask({ tif: "whatever" })]) {
    assert.equal(parseOrderRequest(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(parseOrderRequest({ kind: "cancelAll", owner: OWNER_ADDRESS, symbol: "SOL" }), { kind: "cancelAll", owner: OWNER_ADDRESS, symbol: "SOL" });
  assert.deepEqual(parseOrderRequest({ kind: "cancelConditional", owner: OWNER_ADDRESS, symbol: "SOL", index: 4 }), { kind: "cancelConditional", owner: OWNER_ADDRESS, symbol: "SOL", index: 4 });
  for (const bad of [{ kind: "cancelConditional", owner: OWNER_ADDRESS, symbol: "SOL", index: 0 }, { kind: "cancelConditional", owner: OWNER_ADDRESS, symbol: "SOL", index: 192 }, { kind: "cancelConditional", owner: OWNER_ADDRESS, symbol: "SOL", index: "4" }, { kind: "cancelConditional", owner: OWNER_ADDRESS, symbol: "SOL" }]) {
    assert.equal(parseOrderRequest(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(parseOrderRequest({ kind: "reduce", owner: OWNER_ADDRESS, symbol: "SOL", size: "5", close: true }), { kind: "reduce", owner: OWNER_ADDRESS, symbol: "SOL", sizeLots: 5n, close: true, slippageBps: 50 });
  assert.deepEqual(parseOrderRequest({ kind: "protect", owner: OWNER_ADDRESS, symbol: "SOL", tp: null, sl: "14000" }), { kind: "protect", owner: OWNER_ADDRESS, symbol: "SOL", tpTicks: null, slTicks: 14000n });
  assert.deepEqual(parseOrderRequest({ kind: "cancel", owner: OWNER_ADDRESS, symbol: "SOL", order: "9223372036854775900" }), { kind: "cancel", owner: OWNER_ADDRESS, symbol: "SOL", orderSequenceNumber: 9223372036854775900n });
  assert.equal(parseOrderRequest({ kind: "cancel", owner: OWNER_ADDRESS, symbol: "SOL", order: "99999999999999999999" }), null, "beyond a u64");
  assert.deepEqual(parseOrderRequest({ kind: "cancel", owner: OWNER_ADDRESS, symbol: "SOL", order: "18446744073709551000" }), { kind: "cancel", owner: OWNER_ADDRESS, symbol: "SOL", orderSequenceNumber: 18446744073709551000n }, "a bid's id is a bit-inverted u64 — twenty digits");
});

/* ------------------------------------------------------------------ units */

test("units: dollars to ticks keep the limit (down to buy, up to sell), lots never round up, and back again exactly", () => {
  assert.equal(ticksFromUsd("135.87", UNITS, "floor"), 13587n);
  assert.equal(ticksFromUsd("135,875", UNITS, "floor"), 13587n);
  assert.equal(ticksFromUsd("135.875", UNITS, "ceil"), 13588n);
  assert.equal(ticksFromUsd("0", UNITS, "floor"), null);
  assert.equal(ticksFromUsd("1e3", UNITS, "floor"), null);
  assert.equal(usdFromTicks(13587n, UNITS), 135.87);
  assert.equal(usdTextFromTicks(13587n, UNITS), "135.87");
  assert.equal(lotsFromUnits("0.257", 2), 25n, "a size never rounds up");
  assert.equal(unitsTextFromLots(25n, 2), "0.25");
  /* PUMP: base lot decimals −2 — a lot is a hundred tokens. */
  const pump = { tickSize: 1, baseLotsDecimals: -2 };
  assert.equal(lotsFromUnits("12345", -2), 123n);
  assert.equal(unitsTextFromLots(123n, -2), "12300");
  assert.equal(usdTextFromTicks(5n, pump), "0.00000005");
  assert.equal(ticksFromUsd("0.00000005", pump, "floor"), 5n);
});

/* ---------------------------------------------------------- fees, funding */

test("fees: Phoenix's taker rate on the notional, rounded up to the micro-dollar; the builder's bps the same way; none is a rebate", () => {
  assert.equal(perpFeeUsd(15, 0.00035), 0.00525);
  assert.equal(perpFeeUsd(1000, 0.00035), 0.35);
  assert.equal(perpFeeUsd(1, 0.000001234), 0.000002, "a fraction of a micro-dollar is paid as one");
  assert.equal(perpFeeUsd(15, -0.0001), null);
  assert.equal(builderFeeUsd(1000, 2), 0.2, "2 bps on a thousand dollars");
  assert.equal(builderFeeUsd(1000, 0), 0);
  assert.equal(builderFeeUsd(1000, 2.5), null);
});

test("funding: Hawkeye's micro-bps as a per cent an hour, and who pays only where the mark agrees with the sign", () => {
  assert.deepEqual(fundingOf(1_250_000n, 150.1, 150), { ratePercent: 0.0125, payer: "long" });
  assert.deepEqual(fundingOf(-500_000n, 149.9, 150), { ratePercent: -0.005, payer: "short" });
  assert.deepEqual(fundingOf(1_250_000n, 149.9, 150), { ratePercent: 0.0125, payer: null }, "a sign the mark contradicts names no payer");
  assert.deepEqual(fundingOf(0n, 150, 150), { ratePercent: 0, payer: null });
  assert.equal(fundingOf(null, 150, 150), null);
});

test("leverage and the legs' sides", () => {
  assert.equal(leverageOf(300, 100), 3);
  assert.equal(leverageOf(-300, 100), 3, "a short's value counts as much");
  assert.equal(leverageOf(300, 0), null);
  assert.equal(legsSideOk("long", 150, 160, 140), null);
  assert.equal(legsSideOk("long", 150, 140, null), "TP_SIDE");
  assert.equal(legsSideOk("long", 150, null, 155), "SL_SIDE");
  assert.equal(legsSideOk("short", 150, 140, 160), null);
  assert.equal(legsSideOk("short", 150, 160, null), "TP_SIDE");
});

/* ------------------------------------------------------------------- plan */

const plan = (request, over = {}) => planOrder({ request: parseOrderRequest(request), assetId: 0, worstTicks: 15075n, position: null, order: null, conditionalAccount: true, ...over });

test("the plan: a market order fills all or nothing within its worst price; a limit rests; TP/SL ride with a market order on the whole position", () => {
  const market = plan(ask());
  assert.equal(market.ok, true);
  assert.equal(market.steps.length, 1);
  assert.deepEqual([market.steps[0].ix, market.steps[0].packet.side, market.steps[0].packet.numBaseLots, market.steps[0].packet.minBaseLotsToFill, market.steps[0].packet.priceInTicks, market.steps[0].packet.orderFlags], ["market", Side.Bid, 10n, 10n, 15075n, OrderFlags.None]);
  const short = plan(ask({ side: "short" }), { worstTicks: 14925n });
  assert.equal(short.steps[0].packet.side, Side.Ask);
  const limit = plan(ask({ type: "limit", price: "14500" }));
  assert.deepEqual([limit.steps[0].ix, limit.steps[0].packet.priceInTicks, limit.steps[0].packet.numBaseLots], ["limit", 14500n, 10n]);
  /* TP/SL with no account for them yet: it is opened, then they are set — the long's TP above, its SL below. */
  const legs = plan(ask({ tp: "16000", sl: "14000" }), { conditionalAccount: false });
  assert.deepEqual(legs.steps.map((step) => step.ix), ["market", "createConditional", "positionConditional"]);
  assert.equal(legs.steps[2].greater.triggerPrice, 16000n);
  assert.equal(legs.steps[2].less.triggerPrice, 14000n);
  assert.equal(legs.steps[2].greater.tradeSide, Side.Ask, "a long's TP sells");
  /* Old TP/SL are lifted first. */
  const replaced = plan(ask({ tp: "16000" }), { position: { lots: 5n, conditionalIndexes: [3] } });
  assert.deepEqual(replaced.steps.map((step) => step.ix), ["market", "cancelConditional", "positionConditional"]);
  assert.equal(replaced.clearsLegs, true);
  assert.equal(plan(ask({ tp: "16000" }), { position: { lots: -20n, conditionalIndexes: [] } }).code, "LEGS_SIDE", "a market order that cuts the position carries no TP/SL");
  assert.equal(plan(ask(), { worstTicks: null }).code, "PRICE_UNKNOWN");
});

test("the plan: a cut and a close are reduce-only market orders on the position's other side; a close takes Phoenix's own size and lifts the TP/SL", () => {
  const position = { lots: -30n, conditionalIndexes: [4, 7] };
  const cut = plan({ kind: "reduce", owner: OWNER_ADDRESS, symbol: "SOL", size: "10" }, { position });
  assert.deepEqual([cut.side, cut.sizeLots, cut.steps.length, cut.steps[0].packet.side, cut.steps[0].packet.orderFlags], ["short", 10n, 1, Side.Bid, OrderFlags.ReduceOnly]);
  const close = plan({ kind: "reduce", owner: OWNER_ADDRESS, symbol: "SOL", size: "1", close: true }, { position });
  assert.equal(close.steps[0].packet.numBaseLots, 30n, "the browser's size does not speak for a close");
  assert.deepEqual(close.steps.map((step) => step.ix), ["market", "cancelConditional", "cancelConditional"]);
  assert.equal(plan({ kind: "reduce", owner: OWNER_ADDRESS, symbol: "SOL", size: "31" }, { position }).code, "OVER_POSITION");
  assert.equal(plan({ kind: "reduce", owner: OWNER_ADDRESS, symbol: "SOL", size: "1" }).code, "NO_POSITION");
});

test("the plan: TP/SL alone, and a cancel of a resting order by Phoenix's own id and price", () => {
  const position = { lots: 30n, conditionalIndexes: [2] };
  const protect = plan({ kind: "protect", owner: OWNER_ADDRESS, symbol: "SOL", sl: "14000" }, { position });
  assert.deepEqual(protect.steps.map((step) => step.ix), ["cancelConditional", "positionConditional"]);
  assert.equal(protect.steps[1].greater, null);
  const lift = plan({ kind: "protect", owner: OWNER_ADDRESS, symbol: "SOL" }, { position });
  assert.deepEqual(lift.steps.map((step) => step.ix), ["cancelConditional"], "both empty lifts what is there");
  assert.equal(plan({ kind: "protect", owner: OWNER_ADDRESS, symbol: "SOL" }, { position: { lots: 30n, conditionalIndexes: [] } }).code, "NOTHING_TO_CHANGE");
  const order = { orderSequenceNumber: 77n, priceTicks: 14500n, side: "buy", sizeLots: 10n };
  const cancel = plan({ kind: "cancel", owner: OWNER_ADDRESS, symbol: "SOL", order: "77" }, { order });
  assert.deepEqual(cancel.steps, [{ ix: "cancelOrders", orders: [{ orderSequenceNumber: 77n, priceInTicks: 14500n }] }]);
  assert.equal(plan({ kind: "cancel", owner: OWNER_ADDRESS, symbol: "SOL", order: "78" }, { order }).code, "NO_ORDER");
});

/* --------------------------------------------------- what a build may call */

test("Phoenix's SDK builds every step with exactly the bytes the plan encodes", async () => {
  const steps = [
    ...plan(ask({ tp: "16000", sl: "14000" }), { conditionalAccount: false, position: { lots: 5n, conditionalIndexes: [3] } }).steps,
    ...plan({ kind: "cancel", owner: OWNER_ADDRESS, symbol: "SOL", order: "77" }, { order: { orderSequenceNumber: 77n, priceTicks: 14500n, side: "buy", sizeLots: 10n } }).steps,
  ];
  const kit = await sdkBuild(OWNER_ADDRESS, steps);
  assert.equal(kit.length, steps.length);
  kit.forEach((ix, index) => assert.deepEqual(Buffer.from(ix.data), Buffer.from(stepData(steps[index])), steps[index].ix));
  assert.deepEqual(orderCallsOnly(txOf(kit), expectation(steps)), { ok: true });
});

test("a build is refused for anything but the reviewed order: another size, signer, market, step, order of steps or payer", async () => {
  const steps = plan(ask({ tp: "16000" })).steps;
  const kit = await sdkBuild(OWNER_ADDRESS, steps);
  /* Another size than reviewed. */
  const bigger = await sdkBuild(OWNER_ADDRESS, plan(ask({ size: "11", tp: "16000" })).steps);
  assert.equal(orderCallsOnly(txOf(bigger), expectation(steps)).ok, false);
  /* Another wallet's trader account. */
  const other = await sdkBuild(STRANGER, steps);
  assert.equal(orderCallsOnly(txOf(other), expectation(steps)).ok, false);
  /* Another market's book. */
  const moved = kit.map((ix) => ({ ...ix, accounts: ix.accounts.map((account) => (account.address === BOOK ? { ...account, address: key(40) } : account)) }));
  assert.equal(orderCallsOnly(txOf(moved), expectation(steps)).ok, false);
  /* A step the plan does not name, or the steps out of order. */
  const extra = await sdkBuild(OWNER_ADDRESS, plan({ kind: "cancel", owner: OWNER_ADDRESS, symbol: "SOL", order: "77" }, { order: { orderSequenceNumber: 77n, priceTicks: 14500n, side: "buy", sizeLots: 1n } }).steps);
  assert.equal(orderCallsOnly(txOf([...kit, ...extra]), expectation(steps)).ok, false);
  assert.equal(orderCallsOnly(txOf([...kit].reverse()), expectation(steps)).ok, false);
  assert.equal(orderCallsOnly(txOf(kit.slice(0, 1)), expectation(steps)).ok, false, "a missing step");
  /* Someone else pays, or signs. */
  assert.equal(orderCallsOnly(txOf(kit, new PublicKey(STRANGER)), expectation(steps)).ok, false);
  const cosigned = [{ ...kit[0], accounts: [...kit[0].accounts, { address: STRANGER, role: 2 }] }, ...kit.slice(1)];
  assert.equal(orderCallsOnly(txOf(cosigned), expectation(steps)).ok, false);
  /* Not routed through a builder when one is set, or routed when none is. */
  assert.equal(orderCallsOnly(txOf(kit), expectation(steps, BUILDER)).ok, false);
  const routed = await sdkBuild(OWNER_ADDRESS, steps, BUILDER);
  assert.equal(orderCallsOnly(txOf(routed), expectation(steps)).ok, false);
});

test("through Ryntra's builder: Flight's proxy of exactly the reviewed order; another builder or a fee override is refused", async () => {
  const steps = [...plan(ask({ sl: "14000" }), { conditionalAccount: false }).steps];
  const routed = await sdkBuild(OWNER_ADDRESS, steps, BUILDER);
  assert.deepEqual(routed.map((ix) => ix.programAddress), [FLIGHT_PROGRAM, PHOENIX_PROGRAM, FLIGHT_PROGRAM], "the TP/SL account is opened natively");
  assert.deepEqual(routed[0].accounts.slice(0, 6).map((account) => account.address), [flightGlobalState(), PHOENIX_PROGRAM, BUILDER, traderAccountOf(BUILDER), flightBuilderState(BUILDER), OWNER_ADDRESS], "the SDK's own Flight addresses");
  assert.deepEqual(orderCallsOnly(txOf(routed), expectation(steps, BUILDER)), { ok: true });
  const another = await sdkBuild(OWNER_ADDRESS, steps, STRANGER);
  assert.equal(orderCallsOnly(txOf(another), expectation(steps, BUILDER)).ok, false);
  const override = await flight.buildProxyInstructionIx({ builderAuthority: BUILDER, builderTraderAccount: traderAccountOf(BUILDER), traderWallet: OWNER_ADDRESS, feeBpsOverride: 10n, innerInstruction: (await sdkBuild(OWNER_ADDRESS, steps.slice(0, 1)))[0] });
  assert.equal(orderCallsOnly(txOf([override, ...routed.slice(1)]), expectation(steps, BUILDER)).ok, false);
});

/* ---------------------------------------------------------------- Hawkeye */

const magic = (label) => createHash("sha256").update(label).digest().subarray(0, 8);
const hawkeyeTag = (view) => createHash("sha256").update(`global:${view}`).digest().subarray(0, 8);

/** Hawkeye's return bytes as the program writes them (SDK `hawkeye.ts` decoders' layout). */
const RETURNS = {
  margin({ collateral, effective, free = 0n, riskTier = 0 }) {
    const b = Buffer.alloc(112);
    magic("return:phoenix_hawkeye_margin").copy(b, 0);
    b.writeUInt16LE(1, 8);
    b.writeUInt8(riskTier, 13);
    b.writeBigInt64LE(collateral, 16);
    b.writeBigInt64LE(effective, 24);
    b.writeBigInt64LE(free, 32);
    return b;
  },
  asset({ lots, value = 0n, entry = 0n }) {
    const b = Buffer.alloc(128);
    magic("return:phoenix_hawkeye_asset").copy(b, 0);
    b.writeUInt16LE(1, 12);
    b.writeBigInt64LE(lots, 24);
    b.writeBigUInt64LE(entry, 48);
    b.writeBigInt64LE(value, 56);
    return b;
  },
  liquidation({ status = 1, side = 1, ticks = 0n }) {
    const b = Buffer.alloc(56);
    magic("return:phoenix_hawkeye_liquidation_price").copy(b, 0);
    b.writeUInt16LE(1, 12);
    b.writeUInt8(status, 14);
    b.writeUInt8(side, 15);
    b.writeBigUInt64LE(ticks, 16);
    return b;
  },
  funding({ projected }) {
    const b = Buffer.alloc(48);
    magic("return:phoenix_hawkeye_funding").copy(b, 0);
    b.writeUInt16LE(1, 12);
    b.writeBigInt64LE(projected, 40);
    return b;
  },
};

test("Hawkeye's bytes decode by the SDK, and the account after the order reads from them: liquidation price, leverage, the collateral's change", () => {
  const margin = decodeHawkeyeReturnData(RETURNS.margin({ collateral: 100_000_000n, effective: 99_500_000n, free: 90_000_000n, riskTier: 0 }));
  const asset = decodeHawkeyeReturnData(RETURNS.asset({ lots: 10n, value: 15_000_000n, entry: 1_500_000n }));
  const liquidation = decodeHawkeyeReturnData(RETURNS.liquidation({ status: 1, side: 1, ticks: 1_234n }));
  const before = decodeHawkeyeReturnData(RETURNS.margin({ collateral: 100_005_250n, effective: 100_005_250n }));
  assert.deepEqual([margin.kind, asset.kind, liquidation.kind, liquidation.status.label], ["view_margin", "view_margin_for_asset", "view_liquidation_price", "found"]);
  const after = afterFromHawkeye({ margin, asset, liquidation }, before, UNITS);
  assert.equal(after.positionUnits, "0.1");
  assert.equal(after.liquidationUsd, 12.34);
  assert.equal(after.entryUsd, 150, "quote lots per base lot, in dollars per SOL");
  assert.equal(after.positionValueUsd, 15);
  assert.equal(Math.round(after.leverage * 10_000) / 10_000, 0.1508);
  assert.equal(Math.round(after.collateralChangeUsd * 1e6), -5_250, "the fee as the collateral lost it");
  assert.equal(after.freeCollateralUsd, 90);
  assert.equal(after.riskTier, "safe");
  /* Flat after a close: no liquidation price, no leverage. */
  const flat = afterFromHawkeye({ margin, asset: decodeHawkeyeReturnData(RETURNS.asset({ lots: 0n })), liquidation: decodeHawkeyeReturnData(RETURNS.liquidation({ status: 0, side: 0 })) }, before, UNITS);
  assert.deepEqual([flat.positionUnits, flat.liquidationUsd, flat.leverage, flat.liquidationStatus], ["0", null, null, "no_position"]);
});

test("a market order's worst price: the mark moved by the tolerance, never widened by rounding", () => {
  assert.equal(worstTicksOf(150, true, 50, UNITS), 15075n);
  assert.equal(worstTicksOf(150, false, 50, UNITS), 14925n);
  assert.equal(worstTicksOf(150.0049, true, 10, UNITS), 15015n, "150.15 rounded down for a buy");
  assert.equal(worstTicksOf(null, true, 50, UNITS), null);
});

/* ------------------------------------------------------------------ facts */

test("Phoenix's answers as facts: the market's units and accounts, the position at subaccount 0 with its TP/SL, plain resting orders", () => {
  const config = [{ symbol: "SOL", assetId: 0, marketStatus: "active", marketPubkey: BOOK, splinePubkey: SPLINE, tickSize: 100, baseLotsDecimals: 2, takerFee: 0.00035, makerFee: 0.00005, isolatedOnly: false, fundingIntervalSeconds: 3600, leverageTiers: [] }];
  const facts = marketFactsFrom(config, { markets: [{ symbol: "sol", mark_price: "150", oracle_price: 149.9 }] }, "Sol");
  assert.deepEqual(facts, { ...MARKET, symbol: "SOL" });
  assert.equal(marketFactsFrom([{ ...config[0], tickSize: 0 }], null, "SOL"), null, "no order on guessed units");
  assert.equal(marketFactsFrom(config, null, "BTC"), null);
  assert.equal(marketFactsFrom(config, null, "SOL").markUsd, null);
  assert.equal(marketFactsFrom([{ ...config[0], marketStatus: "postOnly" }], null, "SOL").status, "gated");

  const state = {
    snapshot: {
      capabilities: { state: "active", capabilities: { riskIncreasingTrade: { immediate: true }, riskReducingTrade: { immediate: true } } },
      subaccounts: [
        {
          subaccountIndex: 0,
          positions: [
            {
              symbol: "SOL",
              basePositionLots: "-30",
              conditionalTakeProfitTriggers: [{ conditionalTakeProfitId: "4", status: "active", trigger: { triggerPriceTicks: "13000", attachedOrderSequenceNumber: "78" } }],
              conditionalStopLossTriggers: [{ conditionalStopLossId: "9", status: "active", trigger: { triggerPriceTicks: "16500" } }, { conditionalStopLossId: "11", status: "cancelled", trigger: { triggerPriceTicks: "17000" } }],
            },
          ],
          orders: [{ symbol: "SOL", orders: [{ orderSequenceNumber: "77", priceTicks: "14500", side: "bid", sizeRemainingLots: "10" }, { orderSequenceNumber: "78", priceTicks: "16000", side: "ask", isConditionalOrder: true }] }],
        },
        { subaccountIndex: 3, positions: [{ symbol: "SOL", basePositionLots: "99" }] },
      ],
    },
  };
  const traderNow = traderFactsFrom(state, "SOL");
  assert.deepEqual(traderNow.position, { lots: -30n, conditionalIndexes: [4, 9] });
  /* `orders` is what a cancel by id may name: a conditional order has no id of its own to be cancelled by. */
  assert.deepEqual(traderNow.orders, [{ orderSequenceNumber: 77n, priceTicks: 14500n, side: "buy", sizeLots: 10n }]);
  /* `resting` is what «cancel all» removes: every order of this wallet standing in this market's book. */
  assert.deepEqual(
    traderNow.resting.map((row) => row.orderSequenceNumber),
    [77n, 78n],
  );
  /* PERP-5: each conditional order with the index a single cancel of it names, the legs on it and their triggers. */
  assert.deepEqual(traderNow.conditionals, [
    { index: 4, legs: ["tp"], tpTicks: 13000n, slTicks: null },
    { index: 9, legs: ["sl"], tpTicks: null, slTicks: 16500n },
  ]);
  /* A take profit and a stop loss placed together are one conditional order: both legs under one index. */
  const shared = traderFactsFrom(
    {
      snapshot: {
        capabilities: { state: "active", capabilities: {} },
        subaccounts: [
          {
            subaccountIndex: 0,
            positions: [
              {
                symbol: "SOL",
                basePositionLots: "10",
                conditionalTakeProfitTriggers: [{ conditionalTakeProfitId: "4", status: "active", trigger: { triggerPriceTicks: "17000" } }],
                conditionalStopLossTriggers: [{ conditionalStopLossId: "4", status: "active", trigger: { triggerPriceTicks: "13000" } }],
              },
            ],
            orders: [],
          },
        ],
      },
    },
    "SOL",
  );
  assert.deepEqual(shared.conditionals, [{ index: 4, legs: ["tp", "sl"], tpTicks: 17000n, slTicks: 13000n }]);
  assert.deepEqual(shared.position.conditionalIndexes, [4], "one order, one index — the cancel takes it whole");
  assert.deepEqual(traderFactsFrom({}, "SOL"), { found: false });
  const frozen = traderFactsFrom({ snapshot: { capabilities: { state: "frozen", capabilities: {} }, subaccounts: [] } }, "SOL");
  assert.deepEqual(frozen, { found: true, canAddRisk: false, canReduceRisk: false, position: null, orders: [], resting: [], conditionals: [] });
});

test("a receipt's fills: one signature's, the size from Phoenix's lots, a price or a fee in a unit this page does not know is dropped", () => {
  const history = {
    data: [
      { signature: "SIG", baseLotsDelta: "6", price: "150.02", fees: "0.0032", realizedPnl: "0", liquidity: "taker" },
      { signature: "SIG", baseLotsDelta: "4", price: "150.05", fees: "0.0021", realizedPnl: "0", liquidity: "taker" },
      { signature: "OTHER", baseLotsDelta: "1", price: "150", fees: "0", realizedPnl: "0" },
      { signature: "SIG", baseLotsDelta: "1", price: "15002000", fees: "1", realizedPnl: "0" },
      { signature: "SIG", baseLotsDelta: "2", price: "150", fees: "3200", realizedPnl: "0" },
    ],
  };
  const fills = fillsFrom(history, "SIG", UNITS, 150, 0.00035);
  assert.equal(fills.length, 3, "a price a hundred thousand times the mark is no fill this page can state");
  assert.equal(fills[2].feeUsd, null, "a fee far beyond Phoenix's rate is not printed");
  const summary = fillsSummary(fills.slice(0, 2));
  assert.equal(summary.sizeUnits, 0.1);
  assert.equal(Math.round(summary.averageUsd * 1e4) / 1e4, 150.032);
  assert.equal(Math.round(summary.feeUsd * 1e6), 5_300);
  assert.deepEqual(fillsSummary([]), { sizeUnits: 0, averageUsd: null, feeUsd: null, realizedPnlUsd: null });
});

/* ------------------------------------------------------------------ ticket */

test("the ticket: sealed under the orders' own purpose, read back whole, refused when stale or touched", () => {
  const ticket = issueOrderTicket({ owner: OWNER_ADDRESS, kind: "open", symbol: "SOL", notionalMicro: "15075000", messages: ["a".repeat(64)] }, open, 1_000, 60_000);
  assert.equal(readOrderTicket(ticket, open, 2_000).ok, true);
  assert.equal(readOrderTicket(ticket, open, 70_000).code, "TICKET_EXPIRED");
  assert.equal(readOrderTicket(`${ticket.slice(0, -2)}xx`, open, 2_000).code, "TICKET_INVALID");
  assert.equal(readOrderTicket(ticket, { BETA_TOKEN_SECRET: "another-key-long-enough" }, 2_000).code, "TICKET_INVALID");
  assert.equal(issueOrderTicket({ owner: OWNER_ADDRESS, kind: "open", symbol: "SOL", notionalMicro: "1", messages: ["a".repeat(64)] }, {}, 1_000, 60_000), null);
});

test("after the wallet signed, only the relay's own refusals mean nothing was sent", () => {
  assert.deepEqual(orderRelayAfterSigning({ ok: false, code: "ORDERS_CLOSED" }, ["s"]), { ok: false, code: "ORDERS_CLOSED" });
  assert.deepEqual(orderRelayAfterSigning({ ok: false, code: "HTTP_504" }, ["s"]), { ok: true, value: { results: [{ signature: "s", state: "UNKNOWN", reason: null }], settled: false } });
});

/* --------------------------------------------------------- review, relay */

const sentPhoenix = (tx) => tx.instructions.some((ix) => ix.programId.toBase58() === PHOENIX_PROGRAM || ix.programId.toBase58() === FLIGHT_PROGRAM);
const viewOf = (tx) => {
  const last = tx.instructions[tx.instructions.length - 1];
  if (last.programId.toBase58() !== HAWKEYE_PROGRAM_ADDRESS) return null;
  for (const view of ["view_margin_for_asset", "view_margin", "view_liquidation_price", "view_funding"]) if (last.data.subarray(0, 8).equals(hawkeyeTag(view))) return view;
  return "unknown";
};

/**
 * A chain that answers from the test: a blockhash, the TP/SL account (there or not), and the simulations — the order's
 * own, and Phoenix's views of the account before it (no order in the transaction) and after it.
 */
function chain({ before = { collateral: 100_000_000n, lots: 0n }, after = { collateral: 99_994_750n, lots: 10n, value: 15_000_000n, liquidation: 1_234n }, conditional = true, simulationError = null, send = "ok", seen = true, rent = 1_000_000n } = {}) {
  const calls = { sent: 0, simulated: 0 };
  const answer = (value) => ({ result: { value } });
  const connection = {
    async getLatestBlockhash() {
      return { blockhash: BLOCKHASH, lastValidBlockHeight: 1_150 };
    },
    async getAccountInfo(address) {
      assert.equal(address.toBase58(), conditionalOrdersOf(TRADER), "only the TP/SL account is read");
      return conditional ? { data: Buffer.alloc(8), lamports: 1 } : null;
    },
    async _rpcRequest(method, args) {
      assert.equal(method, "simulateTransaction");
      calls.simulated += 1;
      const tx = Transaction.from(Buffer.from(args[0], "base64"));
      const view = viewOf(tx);
      if (!view) {
        if (simulationError) return answer({ err: simulationError, logs: ["Program log: refused"] });
        const watched = args[1].accounts?.addresses ?? [];
        return answer({ err: null, unitsConsumed: 120_000, loadedAccountsDataSize: 1_500_000, accounts: watched.map(() => ({ lamports: Number(rent), data: ["", "base64"] })) });
      }
      const state = sentPhoenix(tx) ? after : before;
      const bytes =
        view === "view_margin"
          ? RETURNS.margin({ collateral: state.collateral, effective: state.collateral })
          : view === "view_margin_for_asset"
            ? RETURNS.asset({ lots: state.lots, value: state.value ?? 0n, entry: state.lots === 0n ? 0n : 1_500_000n })
            : view === "view_liquidation_price"
              ? RETURNS.liquidation({ status: state.lots === 0n ? 0 : 1, ticks: state.liquidation ?? 0n })
              : RETURNS.funding({ projected: 1_250_000n });
      return answer({ err: null, unitsConsumed: 50_000, returnData: { programId: HAWKEYE_PROGRAM_ADDRESS, data: [bytes.toString("base64"), "base64"] } });
    },
    sendRawTransaction() {
      calls.sent += 1;
      if (send instanceof Error) return Promise.reject(send);
      return Promise.resolve("sig");
    },
    async getSignatureStatuses(signatures) {
      return { value: signatures.map(() => (seen ? { confirmationStatus: "confirmed", err: null } : null)) };
    },
  };
  return { connection, calls };
}

const READER = { epochInfo: async () => ({ blockHeight: 1_000, absoluteSlot: 2_000 }), performanceSamples: async () => [{ numSlots: 100, samplePeriodSecs: 40 }] };
const VIEWS = {
  margin: buildHawkeyeViewMarginIx({ ...EXCHANGE, traderAccount: TRADER }),
  asset: buildHawkeyeViewMarginForAssetIx({ ...EXCHANGE, traderAccount: TRADER, assetId: 0 }),
  liquidation: buildHawkeyeViewLiquidationPriceIx({ ...EXCHANGE, traderAccount: TRADER, assetId: 0 }),
  funding: buildHawkeyeViewFundingIx({ ...EXCHANGE, traderAccount: TRADER, assetId: 0 }),
};
const FACTS = { found: true, canAddRisk: true, canReduceRisk: true, position: null, orders: [], resting: [], conditionals: [] };

/* Phoenix's book as the Review reads it (PERP-5): the price impact and a post-only order's cross check come from it. */
const DEPTH = { bids: [{ price: 150.7, size: 5 }, { price: 150.6, size: 20 }], asks: [{ price: 150.8, size: 0.05 }, { price: 150.9, size: 20 }] };

function deps(env, { trader = FACTS, market = MARKET, builderBps = 2, fills = [], book = DEPTH, ...chainOptions } = {}) {
  const { connection, calls } = chain(chainOptions);
  return {
    calls,
    deps: {
      env,
      connections: [connection],
      readMarket: async () => market,
      readTrader: async () => trader,
      readBook: async () => book,
      build: (owner, _symbol, steps, builder) => sdkBuild(owner, steps, builder),
      views: async () => VIEWS,
      builderBps: async () => builderBps,
      readFills: async () => fills,
      chainReader: () => READER,
      now: () => 5_000,
      pollMs: 1,
    },
  };
}

test("Review refuses before anything is built: a closed gate, the canary's ceiling, a gated or isolated market, no account, a frozen one, legs on the wrong side", async () => {
  assert.equal((await reviewOrder(ask(), deps({}).deps)).code, "ORDERS_CLOSED");
  assert.equal((await reviewOrder(ask({ size: "14" }), deps(canary).deps)).code, "CANARY_LIMIT", "0.14 SOL at 150.75 is over the canary's 20 dollars");
  assert.equal((await reviewOrder(ask({ size: "13" }), deps(canary, { after: { collateral: 99_990_000n, lots: 13n, liquidation: 1_234n } }).deps)).ok, true, "0.13 SOL is under it");
  assert.equal((await reviewOrder(ask({ size: "0" }), deps(open).deps)).code, "BAD_REQUEST");
  assert.equal((await reviewOrder(ask({ size: "1", type: "limit", price: "5000" }), deps(open).deps)).code, "BELOW_MINIMUM", "0.01 SOL at 50 dollars is half a dollar");
  assert.equal((await reviewOrder(ask(), deps(open, { market: { ...MARKET, status: "gated" } }).deps)).code, "MARKET_GATED");
  assert.equal((await reviewOrder(ask(), deps(open, { market: { ...MARKET, isolatedOnly: true } }).deps)).code, "ISOLATED_ONLY");
  assert.equal((await reviewOrder(ask(), deps(open, { market: null }).deps)).code, "PHOENIX_UNAVAILABLE");
  assert.equal((await reviewOrder(ask(), deps(open, { trader: { found: false } }).deps)).code, "ACCOUNT_NEEDED");
  assert.equal((await reviewOrder(ask(), deps(open, { trader: { ...FACTS, canAddRisk: false } }).deps)).code, "TRADING_CLOSED");
  assert.equal((await reviewOrder(ask({ tp: "14000" }), deps(open).deps)).code, "TP_SIDE");
  assert.equal((await reviewOrder(ask(), deps(open, { market: { ...MARKET, markUsd: null } }).deps)).code, "PRICE_UNKNOWN");
  assert.equal((await reviewOrder(ask(), deps(open, { simulationError: "InsufficientFundsForFee" }).deps)).code, "NEEDS_SOL");
  assert.equal((await reviewOrder(ask(), deps(open, { simulationError: { InstructionError: [2, { Custom: 6 }] } }).deps)).code, "SIMULATION_FAILED");
  assert.equal((await reviewOrder(ask(), deps({ ...open, RYNTRA_PHOENIX_BUILDER: BUILDER }, { builderBps: null }).deps)).code, "BUILDER_UNAVAILABLE", "a builder set but not active: no fee is promised that the chain would not take");
});

test("a market long's Review: the sealed bytes are the plan's, and the figures are Phoenix's view of the account after them", async () => {
  const { deps: d } = deps({ ...open, RYNTRA_PHOENIX_BUILDER: BUILDER });
  const answer = await reviewOrder(ask({ sl: "14000" }), d);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const review = answer.value;
  assert.deepEqual([review.kind, review.side, review.type, review.sizeLots, review.sizeUnits, review.slippageBps], ["open", "long", "market", "10", "0.1", 50]);
  assert.equal(review.priceUsd, 150.75, "the worst price the order may fill at");
  assert.equal(Math.round(review.notionalUsd * 1e6), 15_075_000);
  assert.deepEqual(review.fees, { takerRate: 0.00035, makerRate: 0.00005, venueUsd: 0.005277, venueLiquidity: "taker", builderBps: 2, builderUsd: 0.003015 });
  assert.equal(review.after.liquidationUsd, 12.34);
  assert.equal(review.after.positionUnits, "0.1");
  assert.equal(review.before.positionUnits, "0");
  assert.equal(Math.round(review.after.collateralChangeUsd * 1e6), -5_250);
  assert.deepEqual(review.funding, { ratePercent: 0.0125, payer: "long", intervalSeconds: 3600 });
  assert.equal(review.slUsd, 140);
  assert.equal(review.rentLamports, "0", "the TP/SL account is there already");
  assert.equal(review.traderAccount, TRADER);
  const tx = Transaction.from(Buffer.from(review.transaction.wireBase64, "base64"));
  assert.equal(tx.feePayer.toBase58(), OWNER_ADDRESS);
  assert.equal(readOrderTicket(review.ticket, open, 5_001).ticket.notionalMicro, "15075000");
  /* Opening the TP/SL account: its rent is the wallet's, from the simulation. */
  const opening = await reviewOrder(ask({ sl: "14000" }), deps(open, { conditional: false, rent: 2_500_000n }).deps);
  assert.equal(opening.value.rentLamports, "2500000");
});

test("a market order the book would not fill in full is refused; a limit rests and its Review counts the maker's rate", async () => {
  const unfilled = await reviewOrder(ask(), deps(open, { after: { collateral: 100_000_000n, lots: 0n } }).deps);
  assert.equal(unfilled.code, "NOT_FILLABLE");
  const limit = await reviewOrder(ask({ type: "limit", price: "14500" }), deps(open, { after: { collateral: 100_000_000n, lots: 0n } }).deps);
  assert.equal(limit.ok, true, JSON.stringify(limit));
  assert.deepEqual([limit.value.type, limit.value.priceUsd, limit.value.fees.makerRate, limit.value.fees.builderBps], ["limit", 145, 0.00005, 0]);
});

test("a close takes the position as Phoenix holds it, reduce-only, and lifts its TP/SL; a cancel names the resting order", async () => {
  const position = { lots: 30n, conditionalIndexes: [4] };
  const close = await reviewOrder({ kind: "reduce", owner: OWNER_ADDRESS, symbol: "SOL", size: "1", close: true }, deps(open, { trader: { ...FACTS, canAddRisk: false, position }, before: { collateral: 100_000_000n, lots: 30n, liquidation: 1_234n }, after: { collateral: 100_100_000n, lots: 0n } }).deps);
  assert.equal(close.ok, true, JSON.stringify(close));
  assert.deepEqual([close.value.kind, close.value.side, close.value.sizeLots, close.value.clearsLegs, close.value.after.positionUnits, close.value.after.liquidationUsd], ["reduce", "long", "30", true, "0", null]);
  assert.equal(close.value.priceUsd, 149.25, "a long is closed by selling, no lower than the mark less the tolerance");
  const order = { orderSequenceNumber: 77n, priceTicks: 14500n, side: "buy", sizeLots: 10n };
  const cancel = await reviewOrder({ kind: "cancel", owner: OWNER_ADDRESS, symbol: "SOL", order: "77" }, deps(open, { trader: { ...FACTS, orders: [order] } }).deps);
  assert.equal(cancel.ok, true, JSON.stringify(cancel));
  assert.deepEqual(cancel.value.order, { id: "77", side: "buy", priceUsd: 145, sizeUnits: "0.1" });
  assert.equal(cancel.value.notionalUsd, null);
  assert.equal(cancel.value.fees.venueUsd, 0);
});

/* Request 72: a bid's sequence on Phoenix is 20 digits — the top of a u64 — and its cancel answered BAD_REQUEST. */
const BID_SEQUENCE = "18446744073709551598";
const ASK_SEQUENCE = "19";

test("request 72: a bid's 20-digit id is cancelled as Phoenix holds it, an ask's short one as before", async () => {
  const cancelOf = (order) => ({ kind: "cancel", owner: OWNER_ADDRESS, symbol: "SOL", order });
  /* The id read back from Phoenix's view of the wallet, as a string, whole. */
  const view = { snapshot: { capabilities: { state: "active", capabilities: { riskIncreasingTrade: { immediate: true }, riskReducingTrade: { immediate: true } } }, subaccounts: [{ subaccountIndex: 0, positions: [], orders: [{ symbol: "SOL", orders: [{ orderSequenceNumber: BID_SEQUENCE, priceTicks: "14500", side: "bid", sizeRemainingLots: "10" }, { orderSequenceNumber: ASK_SEQUENCE, priceTicks: "16000", side: "ask", sizeRemainingLots: "4" }] }] }] } };
  const facts = traderFactsFrom(view, "SOL");
  const [bid, ask_] = facts.orders;
  assert.deepEqual(bid, { orderSequenceNumber: 18446744073709551598n, priceTicks: 14500n, side: "buy", sizeLots: 10n });
  assert.deepEqual(ask_, { orderSequenceNumber: 19n, priceTicks: 16000n, side: "sell", sizeLots: 4n });
  /* The request: up to a u64's 20 digits; past a u64, zero, a number or a sign is refused. */
  assert.equal(parseOrderRequest(cancelOf(BID_SEQUENCE)).orderSequenceNumber, 18446744073709551598n);
  assert.equal(parseOrderRequest(cancelOf("18446744073709551615")).orderSequenceNumber, 18446744073709551615n, "the largest u64");
  assert.equal(parseOrderRequest(cancelOf(ASK_SEQUENCE)).orderSequenceNumber, 19n);
  for (const bad of ["18446744073709551616", "184467440737095515980", "0", "-19", " 19", 19, 18446744073709551598n, null]) assert.equal(parseOrderRequest(cancelOf(bad)), null, String(bad));
  /* The plan and Phoenix's SDK carry the id unchanged, byte for byte. */
  const bidPlan = plan(cancelOf(BID_SEQUENCE), { order: bid });
  const askPlan = plan(cancelOf(ASK_SEQUENCE), { order: ask_ });
  assert.deepEqual(bidPlan.steps, [{ ix: "cancelOrders", orders: [{ orderSequenceNumber: 18446744073709551598n, priceInTicks: 14500n }] }]);
  assert.deepEqual(askPlan.steps, [{ ix: "cancelOrders", orders: [{ orderSequenceNumber: 19n, priceInTicks: 16000n }] }]);
  assert.equal(plan(cancelOf("18446744073709551597"), { order: bid }).code, "NO_ORDER", "a neighbour's id is not this order");
  for (const steps of [bidPlan.steps, askPlan.steps]) {
    const kit = await sdkBuild(OWNER_ADDRESS, steps);
    assert.deepEqual(Buffer.from(kit[0].data), Buffer.from(stepData(steps[0])));
    assert.deepEqual(orderCallsOnly(txOf(kit), expectation(steps)), { ok: true });
  }
  /* The Review: built, not BAD_REQUEST, and it names the order by the same digits. */
  const bidReview = await reviewOrder(cancelOf(BID_SEQUENCE), deps(open, { trader: { ...FACTS, orders: [bid, ask_] } }).deps);
  assert.equal(bidReview.ok, true, JSON.stringify(bidReview));
  assert.deepEqual(bidReview.value.order, { id: BID_SEQUENCE, side: "buy", priceUsd: 145, sizeUnits: "0.1" });
  const askReview = await reviewOrder(cancelOf(ASK_SEQUENCE), deps(open, { trader: { ...FACTS, orders: [bid, ask_] } }).deps);
  assert.equal(askReview.ok, true, JSON.stringify(askReview));
  assert.deepEqual([askReview.value.order.id, askReview.value.order.side], [ASK_SEQUENCE, "sell"]);
});

test("the relay sends the signed bytes once, reads the chain and Phoenix's fills; a closed gate or another ticket sends nothing", async () => {
  const fills = [{ sizeUnits: 0.1, priceUsd: 150.03, feeUsd: 0.0053, realizedPnlUsd: 0, liquidity: "taker" }];
  const { deps: d, calls } = deps(open, { fills });
  const review = (await reviewOrder(ask(), d)).value;
  const tx = Transaction.from(Buffer.from(review.transaction.wireBase64, "base64"));
  tx.sign(OWNER);
  const body = { ticket: review.ticket, signed: [tx.serialize().toString("base64")] };
  const relayed = await submitOrder(body, d);
  assert.equal(relayed.ok, true, JSON.stringify(relayed));
  assert.deepEqual([relayed.value.settled, relayed.value.results[0].state, relayed.value.results[0].fills], [true, "LANDED", fills]);
  assert.equal(calls.sent, 1);
  assert.equal((await submitOrder(body, { ...d, env: { BETA_TOKEN_SECRET: KEY } })).code, "ORDERS_CLOSED");
  assert.equal((await submitOrder({ ticket: "x.y", signed: body.signed }, d)).code, "TICKET_INVALID");
  /* Bytes other than the reviewed: another order signed under this ticket. */
  const other = (await reviewOrder(ask({ size: "11" }), deps(open, { after: { collateral: 99_990_000n, lots: 11n, liquidation: 1_234n } }).deps)).value;
  const otherTx = Transaction.from(Buffer.from(other.transaction.wireBase64, "base64"));
  otherTx.sign(OWNER);
  assert.equal((await submitOrder({ ticket: review.ticket, signed: [otherTx.serialize().toString("base64")] }, d)).code, "SIGNED_MISMATCH");
  /* Opened at the Review, a canary of a smaller ceiling at the relay. */
  const big = (await reviewOrder(ask({ size: "20" }), deps(open, { after: { collateral: 99_990_000n, lots: 20n, liquidation: 1_234n } }).deps)).value;
  const bigTx = Transaction.from(Buffer.from(big.transaction.wireBase64, "base64"));
  bigTx.sign(OWNER);
  assert.equal((await submitOrder({ ticket: big.ticket, signed: [bigTx.serialize().toString("base64")] }, { ...d, env: canary })).code, "CANARY_LIMIT");
  assert.equal(calls.sent, 1, "nothing more was sent");
});

test("the routes: the session's wallet must be the order's", async () => {
  const door = (mismatch) => async () => ({ ok: true, body: ask(), rate: { allowed: true, limit: 10, remaining: 9, resetAt: 0 }, mismatch: () => mismatch });
  const review = orderReviewHandler({ openDoor: door(true), review: async () => assert.fail("not asked") });
  assert.equal((await review(new Request("https://ryntra.io"))).status, 403);
  const ok = orderReviewHandler({ openDoor: door(false), review: async () => ({ ok: false, status: 409, code: "ACCOUNT_NEEDED", reason: "no" }) });
  const response = await ok(new Request("https://ryntra.io"));
  assert.deepEqual([response.status, (await response.json()).error.code], [409, "ACCOUNT_NEEDED"]);
  const ticket = issueOrderTicket({ owner: OWNER_ADDRESS, kind: "open", symbol: "SOL", notionalMicro: "1", messages: ["a".repeat(64)] }, open, Date.now(), 60_000);
  const submitDoor = async () => ({ ok: true, body: { ticket, signed: [] }, rate: { allowed: true, limit: 10, remaining: 9, resetAt: 0 }, mismatch: (owner) => owner === OWNER_ADDRESS });
  const submit = orderSubmitHandler({ openDoor: submitDoor, submit: async () => assert.fail("not sent"), env: () => open });
  assert.equal((await submit(new Request("https://ryntra.io"))).status, 403);
});

test("the critic's cases: a far limit is refused; a sell counts at the mark when that is higher; legs need the mark; nothing rides after the book", async () => {
  /* A short limit of 13 SOL at 1.50 would fill against bids near 150: refused as a market order without its guard. */
  assert.equal((await reviewOrder(ask({ side: "short", type: "limit", price: "150", size: "1300" }), deps(canary).deps)).code, "LIMIT_FAR");
  assert.equal((await reviewOrder(ask({ type: "limit", price: "16000" }), deps(open).deps)).code, "LIMIT_FAR", "a buy limit 6.7 % over the mark");
  /* A sell limit under the mark within 5 % counts at the mark: 0.13 SOL × 150 = 19.50 passes the canary's 20; 0.14 × 150 = 21 does not. */
  assert.equal((await reviewOrder(ask({ side: "short", type: "limit", price: "14300", size: "14" }), deps(canary, { after: { collateral: 100_000_000n, lots: 0n } }).deps)).code, "CANARY_LIMIT");
  const sell = await reviewOrder(ask({ side: "short", type: "limit", price: "14300", size: "13" }), deps(canary, { after: { collateral: 100_000_000n, lots: 0n } }).deps);
  assert.equal(sell.ok, true, JSON.stringify(sell));
  assert.equal(sell.value.notionalUsd, 19.5);
  /* A market sell counts at the mark, never at its worst price: fees are never shown smaller than taken. */
  const short = await reviewOrder(ask({ side: "short" }), deps(open, { after: { collateral: 99_990_000n, lots: -10n, liquidation: 30_000n } }).deps);
  assert.equal(short.value.notionalUsd, 15);
  assert.equal(short.value.priceUsd, 149.25, "the worst price still bounds the fill");
  /* TP/SL without the mark: the sides cannot be checked. */
  const position = { lots: 30n, conditionalIndexes: [] };
  assert.equal((await reviewOrder({ kind: "protect", owner: OWNER_ADDRESS, symbol: "SOL", sl: "16000" }, deps(open, { trader: { ...FACTS, position }, market: { ...MARKET, markUsd: null } }).deps)).code, "PRICE_UNKNOWN");
  /* An account appended after the book and the spline, natively or through the builder's proxy. */
  const steps = plan(ask()).steps;
  const [native] = await sdkBuild(OWNER_ADDRESS, steps);
  const tailed = { ...native, accounts: [...native.accounts, { address: key(41), role: 1 }] };
  assert.equal(orderCallsOnly(txOf([tailed]), expectation(steps)).ok, false);
  const [routed] = await sdkBuild(OWNER_ADDRESS, steps, BUILDER);
  const routedTail = { ...routed, accounts: [...routed.accounts, { address: key(41), role: 1 }] };
  assert.equal(orderCallsOnly(txOf([routedTail]), expectation(steps, BUILDER)).ok, false);
});

/* ------------------------------------------------------- PERP-5: the deal */

test("post-only, IOC and FOK within the SDK: the packets, the bytes and what rides through the builder (PERP-5)", async () => {
  /* FOK — the market order Ryntra has always sent: its least fill is its whole size. */
  const fok = planOrder({ request: parseOrderRequest(ask()), assetId: 0, worstTicks: 15_075n, position: null, order: null, conditionalAccount: true });
  assert.equal(fok.steps[0].packet.minBaseLotsToFill, 10n);
  /* IOC — the same packet with a least fill of one lot: whatever the book gives now, the rest cancelled. */
  const ioc = planOrder({ request: parseOrderRequest(ask({ tif: "ioc" })), assetId: 0, worstTicks: 15_075n, position: null, order: null, conditionalAccount: true });
  assert.equal(ioc.steps[0].packet.minBaseLotsToFill, 1n);
  assert.equal(ioc.steps[0].packet.numBaseLots, 10n);
  /* Post-only — the SDK's own `PostOnly` packet, which never slides onto another price. */
  const postOnly = planOrder({ request: parseOrderRequest(ask({ type: "limit", price: "14500", tif: "post_only" })), assetId: 0, worstTicks: null, position: null, order: null, conditionalAccount: true });
  assert.deepEqual(postOnly.steps.map((step) => step.ix), ["postOnly"]);
  assert.equal(postOnly.steps[0].packet.slide, false);
  assert.equal(postOnly.steps[0].packet.priceInTicks, 14_500n);
  assert.equal(postOnly.steps[0].packet.orderFlags, OrderFlags.None);
  /* Phoenix places a post-only order through its own `PlaceLimitOrder` with another packet kind: the tag is the
     limit's, the first byte of the packet is not — and the byte-for-byte check covers both. */
  const limit = planOrder({ request: parseOrderRequest(ask({ type: "limit", price: "14500" })), assetId: 0, worstTicks: null, position: null, order: null, conditionalAccount: true });
  assert.ok(Buffer.from(stepData(postOnly.steps[0])).subarray(0, 8).equals(Buffer.from(stepData(limit.steps[0])).subarray(0, 8)));
  assert.notEqual(Buffer.from(stepData(postOnly.steps[0]))[8], Buffer.from(stepData(limit.steps[0]))[8]);
  /* Both built transactions pass only as the plan has them, and both ride through Ryntra's builder when one is set. */
  for (const plan of [ioc, postOnly]) {
    const kit = await sdkBuild(OWNER_ADDRESS, plan.steps);
    assert.deepEqual(orderCallsOnly(txOf(kit), expectation(plan.steps)), { ok: true });
    const routed = await sdkBuild(OWNER_ADDRESS, plan.steps, BUILDER);
    assert.deepEqual(orderCallsOnly(txOf(routed), expectation(plan.steps, BUILDER)), { ok: true });
    assert.equal(orderCallsOnly(txOf(kit), expectation(plan.steps, BUILDER)).ok, false, "a builder set and the order not routed through it");
  }
});

test("«cancel all» and one conditional order: the plan, the bytes and the facts each needs (PERP-5)", async () => {
  const resting = [
    { orderSequenceNumber: 77n, priceTicks: 14_500n, side: "buy", sizeLots: 10n },
    { orderSequenceNumber: 78n, priceTicks: 16_000n, side: "sell", sizeLots: 5n },
  ];
  const request = parseOrderRequest({ kind: "cancelAll", owner: OWNER_ADDRESS, symbol: "SOL" });
  /* With nothing resting there is nothing to sign: said before a transaction is built. */
  assert.equal(planOrder({ request, assetId: 0, worstTicks: null, position: null, order: null, resting: [], conditionalAccount: true }).code, "NO_ORDERS");
  const plan = planOrder({ request, assetId: 0, worstTicks: null, position: null, order: null, resting, conditionalAccount: true });
  assert.deepEqual(plan.steps, [{ ix: "cancelAll" }]);
  /* Phoenix's `CancelAll` carries its tag and nothing else: one instruction for every resting order of this market. */
  assert.equal(stepData(plan.steps[0]).length, 8);
  const kit = await sdkBuild(OWNER_ADDRESS, plan.steps);
  assert.deepEqual(orderCallsOnly(txOf(kit), expectation(plan.steps)), { ok: true });
  /* A cancel never rides through the builder: there is no fill in it to charge. */
  assert.deepEqual(orderCallsOnly(txOf(kit), expectation(plan.steps, BUILDER)), { ok: true });

  const conditionals = [{ index: 4, legs: ["tp", "sl"], tpTicks: 16_000n, slTicks: 13_000n }];
  const leg = parseOrderRequest({ kind: "cancelConditional", owner: OWNER_ADDRESS, symbol: "SOL", index: 4 });
  const held = { lots: 10n, conditionalIndexes: [4] };
  assert.equal(planOrder({ request: leg, assetId: 0, worstTicks: null, position: held, order: null, conditionals: [], conditionalAccount: true }).code, "NO_CONDITIONAL");
  const lift = planOrder({ request: leg, assetId: 0, worstTicks: null, position: held, order: null, conditionals, conditionalAccount: true });
  assert.deepEqual(lift.steps, [{ ix: "cancelConditional", index: 4 }]);
  const legKit = await sdkBuild(OWNER_ADDRESS, lift.steps);
  assert.deepEqual(orderCallsOnly(txOf(legKit), expectation(lift.steps)), { ok: true });
});

test("the price impact, the fee split and the outcome of a landed order (PERP-5, spec §10, §11.2, §17)", () => {
  /* The impact is how much worse the walk of the book fills than its best level — positive against the trader. */
  assert.equal(priceImpactPercent("long", 101, 100), 1);
  assert.equal(priceImpactPercent("short", 99, 100), 1);
  assert.equal(priceImpactPercent("long", 100, 100), 0);
  assert.equal(priceImpactPercent("long", null, 100), null);
  assert.equal(priceImpactPercent("long", 100, 0), null);

  /* Phoenix's fee at the rate of each fill, Ryntra's on the taker part alone: a maker fill brings the builder nothing. */
  const fills = [
    { sizeUnits: 1, priceUsd: 100, feeUsd: 0.055, realizedPnlUsd: 0, liquidity: "taker" },
    { sizeUnits: 1, priceUsd: 100, feeUsd: 0.005, realizedPnlUsd: 0, liquidity: "maker" },
  ];
  const split = feeSplitOf(fills, { takerRate: 0.00035, makerRate: 0.00005, builderBps: 2 });
  assert.equal(Math.round(split.phoenixUsd * 1e6), 40_000, "0.035 % of 100 and 0.005 % of 100");
  assert.equal(Math.round(split.ryntraUsd * 1e6), 20_000, "2 bps of the taker's 100 only");
  assert.equal(Math.round(split.recordedUsd * 1e6), 60_000);
  assert.equal(split.agrees, true);
  /* A recorded total the split cannot account for is said, never papered over. */
  const odd = feeSplitOf([{ sizeUnits: 1, priceUsd: 100, feeUsd: 1, realizedPnlUsd: 0, liquidity: "taker" }], { takerRate: 0.00035, makerRate: 0.00005, builderBps: 2 });
  assert.equal(odd.agrees, false);
  /* A rate Phoenix did not send leaves its side unknown rather than zero. */
  assert.equal(feeSplitOf(fills, { takerRate: null, makerRate: null, builderBps: 2 }).phoenixUsd, null);
  assert.deepEqual(feeSplitOf([], { takerRate: 0.00035, makerRate: 0.00005, builderBps: 2 }), { phoenixUsd: null, ryntraUsd: null, recordedUsd: null, agrees: null });

  /* Nothing says «filled» before the chain and Phoenix's record both say so. */
  const outcome = (over) => orderOutcomeOf({ state: "LANDED", kind: "open", tif: "fok", sizeUnits: 2, filledUnits: 2, ...over });
  assert.equal(outcome({ state: "UNKNOWN" }), "pending");
  assert.equal(outcome({ state: "FAILED" }), "failed");
  assert.equal(outcome({ filledUnits: null }), "pending", "an order that had to fill, landed, and Phoenix has not shown the fills");
  assert.equal(outcome({ filledUnits: null, tif: "gtc" }), "accepted", "an order that rests needs no fill to be an answer");
  assert.equal(outcome({ filledUnits: null, tif: "post_only" }), "accepted");
  assert.equal(outcome({}), "filled");
  assert.equal(outcome({ filledUnits: 1 }), "partial");
  assert.equal(outcome({ filledUnits: 1, tif: "ioc" }), "partial", "the remainder was cancelled");
  assert.equal(outcome({ filledUnits: 0 }), "cancelled", "a fill-or-kill that filled nothing is cancelled");
  assert.equal(outcome({ filledUnits: 0, tif: "gtc" }), "accepted", "a limit that filled nothing rests");
  assert.equal(outcome({ filledUnits: 0, tif: "post_only" }), "accepted");
  assert.equal(outcome({ filledUnits: 1, tif: "gtc" }), "partial");
  assert.equal(outcome({ kind: "cancel", tif: null, filledUnits: null }), "cancelled");
  assert.equal(outcome({ kind: "cancelAll", tif: null, filledUnits: null }), "cancelled");
  assert.equal(outcome({ kind: "cancelConditional", tif: null, filledUnits: null }), "cancelled");
  assert.equal(outcome({ kind: "protect", tif: null, filledUnits: null }), "set");
});

test("the Review of PERP-5: the impact from Phoenix's book, a crossing post-only refused, an IOC that fills part, «cancel all» with its count", async () => {
  /* The book: 0.05 SOL at 150.80 then the rest at 150.90 — a tenth of a SOL fills at the average of the walk. */
  const review = await reviewOrder(ask({ size: "10", tif: "ioc" }), deps(open, { after: { collateral: 99_994_750n, lots: 6n, value: 9_000_000n, liquidation: 1_234n } }).deps);
  assert.equal(review.ok, true, "an immediate-or-cancel that filled part of its size is an order");
  assert.equal(review.value.tif, "ioc");
  assert.ok(Math.abs(review.value.impact.averageUsd - (0.05 * 150.8 + 0.05 * 150.9) / 0.1) < 1e-9);
  assert.equal(review.value.impact.bestUsd, 150.8);
  assert.ok(review.value.impact.percent > 0, "size costs; the Review says how much");
  assert.equal(review.value.book, "walked");
  /* A fill-or-kill of the same size, filled only in part, is not an order at all. */
  const fok = await reviewOrder(ask({ size: "10" }), deps(open, { after: { collateral: 99_994_750n, lots: 6n, value: 9_000_000n, liquidation: 1_234n } }).deps);
  assert.equal(fok.code, "NOT_FILLABLE");
  /* An immediate-or-cancel that filled nothing is still not an order. */
  const none = await reviewOrder(ask({ size: "10", tif: "ioc" }), deps(open, { after: { collateral: 100_000_000n, lots: 0n, value: 0n } }).deps);
  assert.equal(none.code, "NOT_FILLABLE");

  /* A post-only order priced into the book is refused before anything is built; one that only rests is reviewed, and
     Phoenix charges it the maker rate while Ryntra charges it nothing. */
  const crossing = await reviewOrder(ask({ size: "10", type: "limit", price: "15090", tif: "post_only" }), deps(open).deps);
  assert.equal(crossing.code, "POST_ONLY_CROSS");
  const resting = await reviewOrder(ask({ size: "10", type: "limit", price: "15000", tif: "post_only" }), deps(open, { after: { collateral: 100_000_000n, lots: 0n, value: 0n } }).deps);
  assert.equal(resting.ok, true);
  assert.equal(resting.value.fees.venueLiquidity, "maker");
  assert.equal(resting.value.fees.builderUsd, 0, "a post-only order never takes liquidity, so Flight takes nothing");
  assert.equal(resting.value.impact, null, "an order that takes no liquidity moves no price");
  assert.equal(resting.value.book, "resting");
  /* A plain limit may rest or may cross: the Review says that, never «it takes no liquidity». */
  const plain = await reviewOrder(ask({ size: "10", type: "limit", price: "15000" }), deps(open, { after: { collateral: 100_000_000n, lots: 0n, value: 0n } }).deps);
  assert.equal(plain.value.book, "unsure");
  assert.equal(plain.value.fees.venueLiquidity, "mixed");

  /* «Cancel all» names the scope and the count, as the spec asks, and seals a transaction of one instruction. */
  const resting2 = [{ orderSequenceNumber: 77n, priceTicks: 14_500n, side: "buy", sizeLots: 10n }, { orderSequenceNumber: 78n, priceTicks: 16_000n, side: "sell", sizeLots: 5n }];
  const all = await reviewOrder({ kind: "cancelAll", owner: OWNER_ADDRESS, symbol: "SOL" }, deps(open, { trader: { ...FACTS, resting: resting2 } }).deps);
  assert.equal(all.ok, true);
  assert.deepEqual(all.value.cancelAll, { count: 2, sizeUnits: "0.15" }, "both sides' magnitudes added");
  /* A row whose remainder Phoenix did not send leaves the size unknown rather than silently smaller than it is. */
  const partSized = await reviewOrder({ kind: "cancelAll", owner: OWNER_ADDRESS, symbol: "SOL" }, deps(open, { trader: { ...FACTS, resting: [resting2[0], { ...resting2[1], sizeLots: null }] } }).deps);
  assert.deepEqual(partSized.value.cancelAll, { count: 2, sizeUnits: null });
  assert.equal(all.value.tif, null);
  const empty = await reviewOrder({ kind: "cancelAll", owner: OWNER_ADDRESS, symbol: "SOL" }, deps(open).deps);
  assert.equal(empty.code, "NO_ORDERS");

  /* One conditional order of the position, by the index Phoenix's own trigger names. */
  const held = { ...FACTS, position: { lots: 10n, conditionalIndexes: [4] }, conditionals: [{ index: 4, legs: ["tp", "sl"], tpTicks: 16_000n, slTicks: 14_000n }] };
  const leg = await reviewOrder({ kind: "cancelConditional", owner: OWNER_ADDRESS, symbol: "SOL", index: 4 }, deps(open, { trader: held }).deps);
  assert.equal(leg.ok, true);
  /* Both triggers of the one conditional order are named: Phoenix's cancel takes it whole, and the words say so. */
  assert.deepEqual(leg.value.conditional, { index: 4, legs: ["tp", "sl"], tpUsd: 160, slUsd: 140 });
  assert.equal((await reviewOrder({ kind: "cancelConditional", owner: OWNER_ADDRESS, symbol: "SOL", index: 7 }, deps(open, { trader: held }).deps)).code, "NO_CONDITIONAL");

  /* Phoenix's book that did not answer leaves the impact unknown — never a number made up. */
  const quiet = await reviewOrder(ask({ size: "10", tif: "ioc" }), deps(open, { book: null, after: { collateral: 99_994_750n, lots: 10n, value: 15_000_000n, liquidation: 1_234n } }).deps);
  assert.equal(quiet.ok, true);
  assert.equal(quiet.value.impact, null);
  assert.equal(quiet.value.book, "quiet", "a book that did not answer is not a book that said «not this size»");
  /* An immediate-or-cancel the book cannot fill whole is an order, and the Review says what the book said. */
  const thin = await reviewOrder(ask({ size: "2100", tif: "ioc" }), deps(open, { after: { collateral: 99_994_750n, lots: 2_005n, value: 3_000_000_000n, liquidation: 1_234n } }).deps);
  assert.equal(thin.ok, true);
  assert.equal(thin.value.book, "thin");
  assert.equal(thin.value.impact, null);
});
