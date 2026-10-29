// Run from repo root: node --test lib/phoenix/margin.test.mjs
//
// PERP-4 — the ticket's margin, the most and the liquidation by Phoenix's own calculator (`@ellipsis-labs/rise`
// 0.6.2, margin module), never a formula of Ryntra's (spec §12; REVIEW §6.1). The parity: on test positions — a flat
// account, a long that grows, a short, a cut, a limit, a second market, SOL as collateral — every figure the ticket
// shows equals the SDK's own answer to the same question, and the static liquidation price equals the SDK's
// Hawkeye-compatible closed form. The live check against Phoenix's risk view is `scripts/phoenix/margin-parity.mjs`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildNormalizedMarketParamsBySymbol,
  buildSubaccountMarginInputsFromSnapshot,
  calculateLiquidationPriceUsd,
  computeDraftOrderMarginRequirementFromInputs,
  computeMaxDraftOrderSizeForAvailableMarginFromInputs,
  computeSubaccountMarginFromInputs,
  simulatePositionFillFromInputs,
} from "@ellipsis-labs/rise";

import { MARGIN_ROOM_BPS, liquidationPricesOf, marginAccountFrom, marketParamsFrom, spotParamsFrom, ticketMargin } from "./margin.ts";

/* Phoenix's exchange view and stats, in the SDK's schemas (api/exchange/types.ts, api/markets/types.ts). */
const RISK = { maintenance: 50, maintenanceBps: 5000, backstop: 30, highRisk: 20, cancelOrder: 75, upnl: 50, upnlForWithdrawals: 0 };
const tier = (maxLeverage, maxSizeBaseLots) => ({ maxLeverage, maxSizeBaseLots, limitOrderRiskFactor: 60 });
const CONFIG = [
  { symbol: "SOL", assetId: 1, marketStatus: "active", tickSize: 1, baseLotsDecimals: 3, takerFee: 0.00035, makerFee: 0.00005, leverageTiers: [tier(20, 1_000_000), tier(10, 5_000_000)], riskFactors: RISK, isolatedOnly: false },
  { symbol: "BTC", assetId: 2, marketStatus: "active", tickSize: 100, baseLotsDecimals: 4, leverageTiers: [tier(20, 100_000)], riskFactors: { ...RISK, maintenanceBps: undefined, maintenance: 40 }, isolatedOnly: false },
  { symbol: "GOLD", assetId: 3, marketStatus: "active", tickSize: 1, baseLotsDecimals: 2, leverageTiers: [tier(10, 50_000)], riskFactors: RISK, isolatedOnly: true },
  { symbol: "NOMARK", assetId: 4, marketStatus: "active", tickSize: 1, baseLotsDecimals: 2, leverageTiers: [tier(5, 100)], riskFactors: RISK, isolatedOnly: false },
  { symbol: "HALF", assetId: 5, marketStatus: "active", tickSize: 1, baseLotsDecimals: 2, leverageTiers: [tier(2.5, 100)], riskFactors: RISK, isolatedOnly: false },
  { symbol: "OLD", assetId: 6, marketStatus: "tombstoned", tickSize: 1, baseLotsDecimals: 2, leverageTiers: [tier(5, 100)], riskFactors: RISK },
];
const STATS = {
  markets: [
    { symbol: "SOL", mark_price: 180, oracle_price: 179.9 },
    { symbol: "BTC", mark_price: 100_000, oracle_price: 100_010 },
    { symbol: "GOLD", mark_price: 4_000, oracle_price: 4_001 },
    { symbol: "HALF", mark_price: 10, oracle_price: 10 },
    { symbol: "OLD", mark_price: 1 },
  ],
};
const MARKETS = marketParamsFrom(CONFIG, STATS);
const NORMAL = buildNormalizedMarketParamsBySymbol(MARKETS);

/* Trader states in the SDK's schema (api/traders/traderState.ts): collateral in quote lots, positions and orders in lots and ticks. */
const position = (symbol, lots, entryTicks, quoteLots) => ({ symbol, positionSequenceNumber: "1", basePositionLots: String(lots), entryPriceTicks: String(entryTicks), virtualQuotePositionLots: String(quoteLots), unsettledFundingQuoteLots: "0", accumulatedFundingQuoteLots: "0", takeProfitTriggers: [], stopLossTriggers: [], conditionalTakeProfitTriggers: [], conditionalStopLossTriggers: [] });
const order = (seq, side, ticks, lots, reduceOnly = false) => ({ orderSequenceNumber: String(seq), side, orderType: "limit", priceTicks: String(ticks), priceUsd: "0", sizeRemainingLots: String(lots), initialSizeLots: String(lots), reduceOnly, status: "active" });
const stateOf = (sub) => ({ authority: "W", traderPdaIndex: 0, slot: 1, slotIndex: 0, snapshot: { version: 1, subaccounts: [{ subaccountIndex: 0, sequence: 1, collateral: "0", positions: [], orders: [], splines: [], triggers: [], ...sub }] } });

/* A long of 2 SOL entered at $170 (170 000 ticks; a quote lot per tick per lot), a short of 0.01 BTC at $101 000 (a tick is
   a dollar: 100 quote lots × 10^4 / 10^6), a resting bid. */
const ACCOUNTS = {
  flat: stateOf({ collateral: "250000000" }),
  long: stateOf({ collateral: "100000000", positions: [position("SOL", 2_000, 170_000, -340_000_000)] }),
  short: stateOf({ collateral: "300000000", positions: [position("BTC", -100, 101_000, 1_010_000_000)] }),
  mixed: stateOf({ collateral: "150000000", positions: [position("SOL", -1_000, 185_000, 185_000_000), position("BTC", 50, 99_000, -495_000_000)], orders: [{ symbol: "SOL", orders: [order(7, "bid", 175_000, 500)] }] }),
};

const draft = (patch) => ({ symbol: "SOL", side: "long", type: "market", limitTicks: null, sizeLots: 1_000n, reduceOnly: false, leverage: 5, slippageBps: 50, feeRate: 0.00055, fillTicks: null, ...patch });
const usd = (lots) => Number(BigInt(lots)) / 1e6;
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≠ ${expected}`);

test("the calculator's market parameters: bps from Phoenix's own fields, per cent × 100 without them; markets it cannot count left out", () => {
  assert.deepEqual(MARKETS.map((market) => market.symbol), ["SOL", "BTC", "GOLD"]);
  const [sol, btc] = MARKETS;
  assert.equal(sol.markPriceTicks, "180000", "$180 at a quote lot per tick per thousandth: 180 000 ticks");
  assert.equal(sol.indexPriceTicks, "179900");
  assert.deepEqual(sol.leverageTiers[0], { upperBoundSize: "1000000", maxLeverage: "20", limitOrderRiskFactorBps: "6000" });
  assert.equal(sol.riskFactors.maintenanceMarginFactorBps, "5000");
  assert.equal(btc.riskFactors.maintenanceMarginFactorBps, "4000", "a per cent without its bps field");
  assert.equal(sol.cancelOrderRiskFactorBps, "7500");
  assert.equal(sol.upnlRiskFactor, "5000");
  /* NOMARK has no stats, HALF a leverage that is not whole, OLD is tombstoned: none is counted on a guess. */
});

test("parity: the ticket's margin and most are the SDK's own answers, on every test position", () => {
  for (const [name, state] of Object.entries(ACCOUNTS)) {
    const account = marginAccountFrom(state, {});
    for (const shape of [draft({}), draft({ side: "short" }), draft({ type: "limit", limitTicks: 172_000n }), draft({ side: "short", reduceOnly: true, sizeLots: 500n }), draft({ leverage: 20 }), draft({ symbol: "BTC", sizeLots: 20n, leverage: 3 })]) {
      const figures = ticketMargin({ markets: MARKETS, account, draft: shape });
      const label = `${name} · ${shape.symbol} ${shape.side} ${shape.type}${shape.reduceOnly ? " reduce" : ""} ${shape.leverage}×`;
      const sub = buildSubaccountMarginInputsFromSnapshot(state.snapshot.subaccounts[0]);
      const before = computeSubaccountMarginFromInputs(sub, NORMAL);
      const effective = BigInt(before.margin.effectiveCollateralQuoteLots);
      const initial = BigInt(before.margin.initialMarginQuoteLots);
      assert.equal(figures.account.availableUsd, usd(effective > initial ? effective - initial : 0n), `${label}: free margin`);
      assert.equal(figures.account.riskTier, before.margin.riskTier, `${label}: risk tier`);
      const mark = BigInt(NORMAL[shape.symbol].markPriceTicks);
      const bps = BigInt(shape.slippageBps);
      const priceTicks = shape.type === "limit" ? shape.limitTicks : shape.side === "long" ? (mark * (10_000n + bps) + 9_999n) / 10_000n : (mark * (10_000n - bps)) / 10_000n;
      const sdkSide = shape.side === "long" ? "bid" : "ask";
      const options = { orderLeverageLimitsBySymbol: { [shape.symbol]: shape.leverage } };
      const requirement = computeDraftOrderMarginRequirementFromInputs({ subaccount: sub, markets: NORMAL, draftOrder: { symbol: shape.symbol, side: sdkSide, orderType: shape.type, priceTicks, sizeBaseLots: shape.sizeLots, reduceOnly: shape.reduceOnly }, options });
      assert.equal(figures.order.marginUsd, usd(requirement.protocolMarginRequirementQuoteLots), `${label}: margin Phoenix holds`);
      assert.equal(figures.order.marginAtLeverageUsd, usd(requirement.marginRequirementQuoteLots), `${label}: margin at the picked leverage`);
      /* The most: the SDK's largest size for the free margin less the room, then less that size's fees. */
      const room = effective - initial > 0n ? ((effective - initial) * (10_000n - MARGIN_ROOM_BPS)) / 10_000n : 0n;
      const quotePerLot = priceTicks * BigInt(NORMAL[shape.symbol].tickSize);
      const held = BigInt(sub.markets.find((market) => market.symbol === shape.symbol)?.position?.basePositionLots ?? "0");
      const ceiling = (room * 20n) / quotePerLot + 1n;
      const most = (free) => computeMaxDraftOrderSizeForAvailableMarginFromInputs({ subaccount: sub, markets: NORMAL, draftOrder: { symbol: shape.symbol, side: sdkSide, orderType: shape.type, priceTicks, reduceOnly: shape.reduceOnly }, maxSizeBaseLots: shape.reduceOnly ? (held < 0n ? -held : held) : ceiling, availableMarginQuoteLots: free, options });
      const fee = (lots) => BigInt(Math.ceil(Number(lots * quotePerLot) * shape.feeRate));
      const first = most(room);
      const expected = shape.reduceOnly ? first : most(room - fee(first) > 0n ? room - fee(first) : 0n);
      assert.equal(figures.maxLots, expected.toString(), `${label}: the most`);
      /* The most at its own size fits: margin at the leverage and fees within the free margin. */
      if (!shape.reduceOnly && expected > 0n) {
        const at = computeDraftOrderMarginRequirementFromInputs({ subaccount: sub, markets: NORMAL, draftOrder: { symbol: shape.symbol, side: sdkSide, orderType: shape.type, priceTicks, sizeBaseLots: expected, reduceOnly: false }, options });
        assert.ok(BigInt(at.marginRequirementQuoteLots) + (shape.type === "market" ? fee(expected) : 0n) <= effective - initial, `${label}: the most fits its fees`);
      }
    }
  }
});

test("parity: the liquidation after the order is the SDK's own simulated fill, and the static price its Hawkeye-compatible boundary", () => {
  for (const [name, state] of Object.entries(ACCOUNTS)) {
    const account = marginAccountFrom(state, {});
    const sub = account.subaccount;
    for (const shape of [draft({}), draft({ side: "short", sizeLots: 300n }), draft({ type: "limit", limitTicks: 176_000n, sizeLots: 400n }), draft({ fillTicks: 180_200n })]) {
      const figures = ticketMargin({ markets: MARKETS, account, draft: shape });
      const mark = BigInt(NORMAL.SOL.markPriceTicks);
      const fillTicks = shape.type === "limit" ? shape.limitTicks : shape.fillTicks ?? mark;
      /* Fees on the market order's worst price, the margin's price; a resting limit pays none up front. */
      const worst = shape.side === "long" ? (mark * 10_050n + 9_999n) / 10_000n : (mark * 9_950n) / 10_000n;
      const fees = shape.type === "market" ? BigInt(Math.ceil(Number(shape.sizeLots * worst) * shape.feeRate)) : 0n;
      const fill = simulatePositionFillFromInputs({ subaccount: sub, symbol: "SOL", side: shape.side === "long" ? "bid" : "ask", baseLots: shape.sizeLots.toString(), priceTicks: fillTicks.toString(), feeQuoteLots: fees.toString(), marginMode: "cross" }, NORMAL);
      const sdk = fill.liquidationPrice?.liquidationPriceUsd ?? null;
      const label = `${name} · ${shape.side} ${shape.type}`;
      if (figures.order.liquidation.kind === "price") assert.equal(figures.order.liquidation.priceUsd, sdk, `${label}: liquidation`);
      else assert.ok(sdk === null || !(sdk > 0), `${label}: no price where the SDK has one (${sdk})`);
      assert.equal(figures.order.after.riskTier, fill.margin.margin.riskTier, `${label}: risk after`);
    }
    /* Now, before any order: the SDK's tick search against its own closed form — the one equation Hawkeye solves. */
    const before = computeSubaccountMarginFromInputs(sub, NORMAL);
    for (const [symbol, price] of liquidationPricesOf(MARKETS, account)) {
      const market = before.marketMargins.find((entry) => entry.symbol === symbol);
      const params = NORMAL[symbol];
      const lots = Number(market.basePositionLots);
      const unit = 10 ** -params.baseLotDecimals;
      const others = before.marketMargins.filter((entry) => entry.symbol !== symbol);
      const sum = (rows, key) => rows.reduce((total, row) => total + usd(row[key]), 0);
      const tierLeverage = Number(params.leverageTiers[0].maxLeverage);
      const closed = calculateLiquidationPriceUsd({
        positionSize: lots * unit,
        entryPriceUsd: -usd(market.virtualQuotePositionLots) / (lots * unit),
        leverage: tierLeverage,
        maintenanceMarginBps: Number(params.riskFactors.maintenanceMarginFactorBps),
        upnlRiskFactorBps: Number(params.upnlRiskFactor),
        collateralUsd: usd(before.margin.collateralBalanceQuoteLots) + usd(before.margin.unsettledFundingQuoteLots),
        otherAssetUnrealizedPnlUsd: sum(others, "discountedUnrealizedPnlQuoteLots"),
        otherAssetMaintenanceMarginUsd: sum(others, "maintenanceMarginQuoteLots") + usd(market.limitOrderMarginQuoteLots) * 0,
      });
      if (price === null) assert.ok(closed === null || !(closed > 0), `${name} ${symbol}: none where the closed form has ${closed}`);
      /* One tick of the search: the closed form is the boundary the program's search lands on. */
      else if (before.marketMargins.length === 1 && BigInt(before.limitOrders.length) === 0n) near(price, closed, Number(params.tickSize) * 10 ** params.baseLotDecimals / 1e6 * 2, `${name} ${symbol}: static liquidation`);
    }
  }
});

test("SOL as collateral counts as Phoenix counts it, and never on a guess", () => {
  const state = stateOf({ collateral: "10000000", spotCollaterals: [{ assetIndex: 0xffff0000, symbol: "SOL", balance: "2000000000", decimals: 9 }], positions: [position("SOL", 1_000, 180_000, -180_000_000)] });
  /* Without the asset's curve, the account would read poorer than Phoenix's: the liquidation is not shown. */
  const unvalued = marginAccountFrom(state, {});
  assert.equal(unvalued.spotUnvalued, true);
  assert.equal(ticketMargin({ markets: MARKETS, account: unvalued, draft: draft({ sizeLots: 100n }) }).order.liquidation.kind, "unknown");
  const assets = { assets: [{ assetIndex: 0xffff0000, symbol: "SOL", decimals: 9, spot: { isActive: true, perpAssetIndex: 1, maxPerTraderBalance: "1000000000000", maxGlobalBalance: "100000000000000", currGlobalBalance: "0", minMarginDiscountBps: 1000, maxMarginDiscountBps: 3000, maxLiquidationDiscountBps: 0, minLiquidationSlippageBps: 0, maxLiquidationSize: "0" } }] };
  const spot = spotParamsFrom(assets, MARKETS);
  assert.equal(spot[0xffff0000].pricingMarketSymbol, "SOL");
  const valued = marginAccountFrom(state, spot);
  assert.equal(valued.spotUnvalued, false);
  const figures = ticketMargin({ markets: MARKETS, account: valued, draft: draft({ sizeLots: 100n }) });
  /* Two SOL at $179.90 less a discount between 10 and 30 %: between $251 and $324 more than the USDC alone. */
  const plain = ticketMargin({ markets: MARKETS, account: unvalued, draft: draft({ sizeLots: 100n }) });
  const extra = figures.account.effectiveUsd - plain.account.effectiveUsd;
  assert.ok(extra > 251 && extra < 324, `SOL counted at ${extra}`);
  assert.equal(figures.order.liquidation.kind, "price");
});

test("what the calculator cannot count is said, not made up", () => {
  /* No account: no most, no order figures. */
  assert.deepEqual(ticketMargin({ markets: MARKETS, account: null, draft: draft({}) }), { symbol: "SOL", account: null, maxLots: null, order: null, markUsd: 180 });
  /* A market without a mark, or one only isolated margin trades (the ticket's cross margin does not): nothing. */
  assert.equal(ticketMargin({ markets: MARKETS, account: marginAccountFrom(ACCOUNTS.flat, {}), draft: draft({ symbol: "NOMARK" }) }), null);
  assert.equal(ticketMargin({ markets: MARKETS, account: marginAccountFrom(ACCOUNTS.flat, {}), draft: draft({ symbol: "GOLD" }) }), null);
  /* A position on a market the calculator cannot price: the whole account is unknown rather than counted without it. */
  const stray = marginAccountFrom(stateOf({ collateral: "100000000", positions: [position("NOMARK", 10, 100, -1_000)] }), {});
  const figures = ticketMargin({ markets: MARKETS, account: stray, draft: draft({}) });
  assert.equal(figures.account, null);
  assert.equal(figures.maxLots, null);
  /* A flat account after a cut that closes the position: no liquidation at all. */
  const close = ticketMargin({ markets: MARKETS, account: marginAccountFrom(ACCOUNTS.long, {}), draft: draft({ side: "short", reduceOnly: true, sizeLots: 2_000n }) });
  assert.deepEqual(close.order.liquidation, { kind: "none" });
  assert.equal(close.order.carried, true, "a cut is always carried");
  /* A size the collateral cannot carry is said so: the margin with its fees over the free margin. */
  const over = ticketMargin({ markets: MARKETS, account: marginAccountFrom(ACCOUNTS.flat, {}), draft: draft({ sizeLots: 100_000n, leverage: 20 }) });
  assert.equal(over.order.carried, false);
  /* A subaccount the state does not have reads as no account. */
  assert.equal(marginAccountFrom(ACCOUNTS.flat, {}, 3), null);
});

test("the ticket's estimate is no longer a formula of Ryntra's: the page asks the server, the server the SDK", () => {
  const form = readFileSync(new URL("../../app/solana/workspace/futures/perp-ticket-form.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(form, /liquidationEstimate\(|maxOrderUsd\(|marginCarried\(/, "the ticket's own margin formulas are gone");
  assert.match(form, /useTicketMargin|ticketMargin|margin\.order/, "the ticket reads the SDK's figures");
  const route = readFileSync(new URL("../../app/api/solana/futures/ticket/route.ts", import.meta.url), "utf8");
  assert.match(route, /readTicketMargin/);
  assert.match(route, /"private"/, "the person's account is never cached at the edge");
  const server = readFileSync(new URL("./margin.server.ts", import.meta.url), "utf8");
  assert.match(server, /^import "server-only";/m, "the SDK stays on the server");
  assert.doesNotMatch(server, /sign|secret|privateKey/i);
});
