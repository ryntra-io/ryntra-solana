/**
 * The ticket's margin by Phoenix's own calculator (PERP-4; spec §12 «Rise SDK, not home-made formulas»; REVIEW §6.1):
 * the margin an order takes, the most it may be at the picked leverage, the account's health and the estimated
 * liquidation price after it — every figure from the margin module of `@ellipsis-labs/rise` 0.6.2, the same module the
 * SDK's own trader-state pipeline feeds (`buildSubaccountMarginInputsFromSnapshot`), never a formula of Ryntra's.
 *
 * In: Phoenix's public reads as they come — the exchange's markets (`/v1/view/exchange/markets`), the latest stats
 * (`/v1/markets/stats/latest`), the wallet's trader state (`/v1/trader/state/{w}`) and, for SOL posted as collateral,
 * the collateral assets (`/v1/collateral/assets`). Out: plain numbers for the ticket. Read only — nothing is built,
 * signed or sent; the Review (Hawkeye on the simulated transaction) stays the figure that counts before a signature.
 *
 * The SDK is ~1 MB with its WebSocket machinery, so it stays on the server (B6's rule); the page asks
 * `/api/solana/futures/ticket`.
 */

import {
  NATIVE_SOL_ASSET_INDEX,
  buildNormalizedMarketParamsBySymbol,
  buildSubaccountMarginInputsFromSnapshot,
  computeDraftOrderMarginRequirementFromInputs,
  computeMaxDraftOrderSizeForAvailableMarginFromInputs,
  computeSubaccountLiquidationPricesFromInputs,
  computeSubaccountMarginFromInputs,
  priceUsdToTicks,
  simulatePositionFillFromInputs,
  type MarginCalculationOptions,
  type MarginRiskTier,
  type MarginSnapshotSubaccount,
  type MarketParams,
  type SpotCollateralAssetParams,
  type SubaccountMarginInputs,
} from "@ellipsis-labs/rise";

import { SYMBOL, num, symbolKey } from "./market-data.ts";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

const QUOTE_LOTS_PER_USD = 1_000_000;
/** The share of the free margin the most leaves untouched: a price that moves between the ticket and the chain. */
export const MARGIN_ROOM_BPS = 100n;

const usd = (quoteLots: bigint | string): number => Number(BigInt(quoteLots)) / QUOTE_LOTS_PER_USD;

/** A whole non-negative integer as the SDK's decimal string; null for anything else. */
function wholeText(value: unknown): string | null {
  if (typeof value === "string" && /^\d{1,30}$/.test(value.trim())) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

/**
 * A risk factor in basis points, as the calculator takes it: Phoenix's `…Bps` field when sent, else its per cent × 100
 * (SDK 0.6.2 sends both; `maintenance` became a per cent in 0.6.2). Null when it is not a whole number of bps in range.
 */
function factorBps(factors: Json, key: string): string | null {
  const bps = num(factors[`${key}Bps`]);
  const percent = num(factors[key]);
  const value = bps ?? (percent === null ? null : percent * 100);
  if (value === null || value < 0 || value > 10_000) return null;
  const rounded = Math.round(value);
  return Math.abs(rounded - value) < 1e-6 ? String(rounded) : null;
}

/**
 * The calculator's market parameters from Phoenix's exchange view and latest stats (the conversion of the SDK's
 * `buildMarketParamsFromSummary`, from the view's own fields): ticks, decimals, the leverage tiers in base lots with
 * their limit-order factor, the risk factors in bps, and the mark and index prices in ticks. A market without a mark,
 * a tick or a whole tier is left out — the calculator then says it cannot count rather than counting it wrong.
 */
export function marketParamsFrom(config: unknown, stats: unknown): MarketParams[] {
  const statsList = isObject(stats) && Array.isArray(stats.markets) ? stats.markets : [];
  const statsBy = new Map<string, Json>();
  for (const entry of statsList) if (isObject(entry) && typeof entry.symbol === "string") statsBy.set(symbolKey(entry.symbol), entry);
  const out: MarketParams[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(config) ? config : []) {
    if (!isObject(raw) || typeof raw.symbol !== "string" || !SYMBOL.test(raw.symbol) || seen.has(symbolKey(raw.symbol))) continue;
    const lifecycle = typeof raw.marketStatus === "string" ? raw.marketStatus.trim().toLowerCase() : "";
    if (lifecycle === "closed" || lifecycle === "tombstoned") continue;
    const tickSize = num(raw.tickSize);
    const decimals = num(raw.baseLotsDecimals);
    const assetId = num(raw.assetId);
    const stat = statsBy.get(symbolKey(raw.symbol));
    const mark = num(stat?.mark_price);
    const index = num(stat?.oracle_price);
    const factors = isObject(raw.riskFactors) ? raw.riskFactors : null;
    if (tickSize === null || !Number.isSafeInteger(tickSize) || tickSize <= 0 || decimals === null || !Number.isInteger(decimals) || assetId === null || !factors || mark === null || !(mark > 0)) continue;
    const tiers = (Array.isArray(raw.leverageTiers) ? raw.leverageTiers : []).map((tier) => {
      if (!isObject(tier)) return null;
      const upper = wholeText(tier.maxSizeBaseLots);
      const leverage = num(tier.maxLeverage);
      const limitFactor = factorBps(tier, "limitOrderRiskFactor");
      return upper !== null && leverage !== null && Number.isInteger(leverage) && leverage >= 1 && limitFactor !== null ? { upperBoundSize: upper, maxLeverage: String(leverage), limitOrderRiskFactorBps: limitFactor } : null;
    });
    const risk = ["maintenance", "backstop", "highRisk", "cancelOrder", "upnl", "upnlForWithdrawals"].map((key) => factorBps(factors, key));
    if (tiers.length === 0 || tiers.some((tier) => tier === null) || risk.some((value) => value === null)) continue;
    const [maintenance, backstop, highRisk, cancelOrder, upnl, upnlForWithdrawals] = risk as string[];
    const units = { baseLotsDecimals: decimals, tickSizeInQuoteLotsPerBaseLot: tickSize };
    seen.add(symbolKey(raw.symbol));
    out.push({
      symbol: raw.symbol,
      assetId,
      markPriceTicks: priceUsdToTicks(mark, units),
      ...(index !== null && index > 0 ? { indexPriceTicks: priceUsdToTicks(index, units) } : {}),
      tickSize: String(tickSize),
      baseLotDecimals: decimals,
      leverageTiers: tiers as MarketParams["leverageTiers"],
      riskFactors: { maintenanceMarginFactorBps: maintenance!, backstopMarginFactorBps: backstop!, highRiskMarginFactorBps: highRisk! },
      cancelOrderRiskFactorBps: cancelOrder!,
      upnlRiskFactor: upnl!,
      upnlRiskFactorForWithdrawals: upnlForWithdrawals!,
      isolatedOnly: raw.isolatedOnly === true,
    });
  }
  return out;
}

/**
 * SOL posted as collateral, valued as Phoenix values it: the asset's discount curve from `/v1/collateral/assets` and
 * the price of the perpetual it names (SDK `spotCollateralParamsFromAssets`, by index). Empty when the read failed.
 */
export function spotParamsFrom(assets: unknown, markets: readonly MarketParams[]): Record<number, SpotCollateralAssetParams> {
  const byAsset = new Map(markets.map((market) => [market.assetId, market]));
  const out: Record<number, SpotCollateralAssetParams> = {};
  for (const asset of isObject(assets) && Array.isArray(assets.assets) ? assets.assets : []) {
    if (!isObject(asset) || !isObject(asset.spot) || asset.spot.isActive !== true) continue;
    const index = num(asset.assetIndex);
    const decimals = num(asset.decimals);
    const perp = num(asset.spot.perpAssetIndex);
    const market = perp === null ? undefined : byAsset.get(perp);
    const cap = wholeText(asset.spot.maxGlobalBalance);
    const low = num(asset.spot.minMarginDiscountBps);
    const high = num(asset.spot.maxMarginDiscountBps);
    if (index === null || decimals === null || !market || cap === null || low === null || high === null) continue;
    out[index] = {
      assetIndex: index,
      decimals,
      pricingMarketSymbol: market.symbol,
      ...(market.indexPriceTicks ? { indexPriceTicks: market.indexPriceTicks } : {}),
      maxGlobalBalance: cap,
      minMarginDiscountBps: low,
      maxMarginDiscountBps: high,
    };
  }
  return out;
}

/** The calculator's view of one subaccount, and whether some collateral it holds could not be valued. */
export type MarginAccount = Readonly<{ subaccount: SubaccountMarginInputs; spotUnvalued: boolean }>;

/**
 * Subaccount `index` of a trader state (`GET /v1/trader/state/{w}`) as the calculator's inputs — the SDK's own
 * conversion. Null when the state has no such subaccount. A SOL balance whose curve was not read is `spotUnvalued`:
 * the figures would count the account poorer than Phoenix does.
 */
export function marginAccountFrom(state: unknown, spot: Record<number, SpotCollateralAssetParams>, index = 0): MarginAccount | null {
  const snapshot = isObject(state) && isObject(state.snapshot) ? state.snapshot : null;
  const raw = (snapshot && Array.isArray(snapshot.subaccounts) ? snapshot.subaccounts : []).find((sub) => isObject(sub) && num(sub.subaccountIndex) === index);
  if (!isObject(raw)) return null;
  const spotRows = (Array.isArray(raw.spotCollaterals) ? raw.spotCollaterals : []).filter(isObject);
  const held = spotRows.filter((row) => (num(row.balance) ?? 0) > 0);
  const spotUnvalued = held.some((row) => !spot[num(row.assetIndex) ?? NATIVE_SOL_ASSET_INDEX]);
  const subaccount = buildSubaccountMarginInputsFromSnapshot(raw as unknown as MarginSnapshotSubaccount, { spotCollateralParamsByIndex: spot });
  return { subaccount, spotUnvalued };
}

export type TicketDraft = Readonly<{
  symbol: string;
  side: "long" | "short";
  type: "market" | "limit";
  /** A limit's price in ticks; a market order is counted at the mark, its worst price by `slippageBps` for the margin. */
  limitTicks: bigint | null;
  /** The size typed, in base lots; null — the most only. */
  sizeLots: bigint | null;
  reduceOnly: boolean;
  /** The leverage picked: the order's margin is counted at it, never above the tier's (SDK order leverage limits). */
  leverage: number;
  slippageBps: number;
  /** The fees out of the same collateral, a fraction of the notional: Phoenix's taker rate and Ryntra's. */
  feeRate: number;
  /** Where the page's book fills a market order now, ticks; the mark without it. */
  fillTicks?: bigint | null;
}>;

export type TicketLiquidation = Readonly<{ kind: "price"; priceUsd: number }> | Readonly<{ kind: "none" }> | Readonly<{ kind: "unknown" }>;

export type MarginHealth = Readonly<{
  riskTier: MarginRiskTier;
  /** Phoenix's account value: collateral, unrealised result and funding. */
  portfolioUsd: number;
  /** The collateral that counts for margin (discounted). */
  effectiveUsd: number;
  initialMarginUsd: number;
  maintenanceMarginUsd: number;
  /** What new orders may still take: effective collateral less initial margin, never below nothing. */
  availableUsd: number;
}>;

export type TicketMargin = Readonly<{
  symbol: string;
  /** The account now, by the calculator; null without an account. */
  account: MarginHealth | null;
  /** The most the order may be in base lots at the picked leverage, its fees out and a per cent of room; null — unknown. */
  maxLots: string | null;
  /** The typed size; null without one. */
  order: Readonly<{
    /** The initial margin Phoenix holds for what the order adds (protocol), and at the picked leverage. */
    marginUsd: number;
    marginAtLeverageUsd: number;
    feesUsd: number;
    /** Whether the free collateral carries the order with its fees (a cut always is). */
    carried: boolean;
    liquidation: TicketLiquidation;
    /** The account after the order fills, by the calculator. */
    after: MarginHealth | null;
  }> | null;
  /** The mark the figures are counted at, USD. */
  markUsd: number;
}>;

function healthOf(margin: ReturnType<typeof computeSubaccountMarginFromInputs>["margin"]): MarginHealth {
  const effective = BigInt(margin.effectiveCollateralQuoteLots);
  const initial = BigInt(margin.initialMarginQuoteLots);
  return {
    riskTier: margin.riskTier,
    portfolioUsd: usd(margin.portfolioValueQuoteLots),
    effectiveUsd: usd(effective),
    initialMarginUsd: usd(initial),
    maintenanceMarginUsd: usd(margin.maintenanceMarginQuoteLots),
    availableUsd: usd(effective > initial ? effective - initial : 0n),
  };
}

/** Ticks moved by bps away from the side's favour: up for a buy, down for a sell — the worst price the tolerance allows. */
const worstTicks = (ticks: bigint, side: "long" | "short", bps: number): bigint => {
  const factor = BigInt(Math.max(0, Math.round(bps)));
  return side === "long" ? (ticks * (10_000n + factor) + 9_999n) / 10_000n : (ticks * (10_000n - factor)) / 10_000n;
};

/**
 * The ticket's figures by the SDK: the account's health now, the most the order may be, and for a typed size the margin
 * it takes, its fees, whether the collateral carries it, the account after and the estimated liquidation price.
 * Null when the market is not one the calculator can count (no mark, no tiers).
 */
export function ticketMargin(input: Readonly<{ markets: readonly MarketParams[]; account: MarginAccount | null; draft: TicketDraft }>): TicketMargin | null {
  const { draft } = input;
  const target = input.markets.find((market) => symbolKey(market.symbol) === symbolKey(draft.symbol));
  if (!target || target.isolatedOnly) return null;
  const symbol = target.symbol;
  const markets = buildNormalizedMarketParamsBySymbol([...input.markets]);
  const params = markets[symbol]!;
  const markTicks = params.markPriceTicks;
  const markUsd = Number(markTicks * params.tickSize) * 10 ** params.baseLotDecimals / QUOTE_LOTS_PER_USD;
  const leverage = Math.max(1, Math.floor(draft.leverage));
  const options: MarginCalculationOptions = { orderLeverageLimitsBySymbol: { [symbol]: leverage } };
  const sdkSide = draft.side === "long" ? "bid" : "ask";
  /* The margin of a market order at its worst price; a limit at its own. */
  const priceTicks = draft.type === "limit" && draft.limitTicks !== null ? draft.limitTicks : worstTicks(markTicks, draft.side, draft.slippageBps);
  const quotePerLot = priceTicks * params.tickSize;
  const feeOf = (lots: bigint): bigint => BigInt(Math.ceil(Number(lots * quotePerLot) * Math.max(0, draft.feeRate)));

  if (!input.account) return { symbol, account: null, maxLots: null, order: null, markUsd };
  const { subaccount, spotUnvalued } = input.account;
  let before: ReturnType<typeof computeSubaccountMarginFromInputs>;
  try {
    before = computeSubaccountMarginFromInputs(subaccount, markets);
  } catch {
    /* A position on a market the calculator cannot count (no mark now): no figure rather than a wrong one. */
    return { symbol, account: null, maxLots: null, order: null, markUsd };
  }
  const account = healthOf(before.margin);
  const available = BigInt(before.margin.effectiveCollateralQuoteLots) - BigInt(before.margin.initialMarginQuoteLots);
  const held = BigInt(subaccount.markets.find((market) => symbolKey(market.symbol) === symbolKey(symbol))?.position?.basePositionLots ?? "0");

  /* The most: the calculator's largest size whose margin at the picked leverage fits the free margin less a per cent of
     room and the order's own fees — sized once, then again with those fees out (smaller, so its fees are smaller still). */
  let maxLots: bigint | null = null;
  const room = available > 0n ? (available * (10_000n - MARGIN_ROOM_BPS)) / 10_000n : 0n;
  const topLeverage = params.leverageTiers.reduce((most, tier) => (tier.maxLeverage > most ? tier.maxLeverage : most), 1n);
  const ceiling = quotePerLot > 0n ? (room * topLeverage) / quotePerLot + 1n : 0n;
  const most = (free: bigint): bigint =>
    computeMaxDraftOrderSizeForAvailableMarginFromInputs({
      subaccount,
      markets,
      draftOrder: { symbol, side: sdkSide, orderType: draft.type, priceTicks, reduceOnly: draft.reduceOnly },
      maxSizeBaseLots: draft.reduceOnly ? (held < 0n ? -held : held) : ceiling,
      availableMarginQuoteLots: free,
      options,
    });
  try {
    const first = most(room);
    maxLots = draft.reduceOnly ? first : most(room - feeOf(first) > 0n ? room - feeOf(first) : 0n);
  } catch {
    maxLots = null;
  }

  let order: NonNullable<TicketMargin["order"]> | null = null;
  if (draft.sizeLots !== null && draft.sizeLots > 0n) {
    try {
      const requirement = computeDraftOrderMarginRequirementFromInputs({
        subaccount,
        markets,
        draftOrder: { symbol, side: sdkSide, orderType: draft.type, priceTicks, sizeBaseLots: draft.sizeLots, reduceOnly: draft.reduceOnly },
        options,
      });
      const protocol = BigInt(requirement.protocolMarginRequirementQuoteLots);
      const fees = draft.type === "market" ? feeOf(draft.sizeLots) : 0n;
      const signed = draft.side === "long" ? draft.sizeLots : -draft.sizeLots;
      const reduces = held !== 0n && (held > 0n) !== (signed > 0n) && (signed < 0n ? -signed : signed) <= (held < 0n ? -held : held);
      /* A limit rests: its position is counted as filled at its price; a market order at the book's fill, else the mark. */
      const fillTicks = draft.type === "limit" && draft.limitTicks !== null ? draft.limitTicks : draft.fillTicks && draft.fillTicks > 0n ? draft.fillTicks : markTicks;
      const fill = simulatePositionFillFromInputs({ subaccount, symbol, side: sdkSide, baseLots: draft.sizeLots.toString(), priceTicks: fillTicks.toString(), feeQuoteLots: fees.toString(), marginMode: "cross" }, markets);
      const after = held + signed;
      const liquidationUsd = fill.liquidationPrice?.liquidationPriceUsd ?? null;
      const liquidation: TicketLiquidation =
        after === 0n
          ? { kind: "none" }
          : spotUnvalued
            ? { kind: "unknown" }
            : liquidationUsd !== null && liquidationUsd > 0
              ? { kind: "price", priceUsd: liquidationUsd }
              : /* A long the account covers down to nothing is never liquidated; a short with no price is not known here. */
                after > 0n
                ? { kind: "none" }
                : { kind: "unknown" };
      order = {
        marginUsd: usd(protocol),
        marginAtLeverageUsd: usd(requirement.marginRequirementQuoteLots),
        feesUsd: usd(fees),
        carried: draft.reduceOnly || reduces || protocol + fees <= (available > 0n ? available : 0n),
        liquidation,
        after: healthOf(fill.margin.margin),
      };
    } catch {
      order = null;
    }
  }
  return { symbol, account, maxLots: maxLots === null ? null : maxLots.toString(), order, markUsd };
}

/**
 * The static liquidation price of every position of a subaccount now, by the calculator — the figure the SDK names the
 * one to hold against Hawkeye and Phoenix's own risk view (`computeSubaccountLiquidationPricesFromMargin`). For the
 * parity check with `/v1/view/trader` (`scripts/phoenix/margin-parity.mjs`).
 */
export function liquidationPricesOf(markets: readonly MarketParams[], account: MarginAccount): ReadonlyMap<string, number | null> {
  const prices = computeSubaccountLiquidationPricesFromInputs(account.subaccount, buildNormalizedMarketParamsBySymbol([...markets]));
  return new Map(prices.positions.map((position) => [position.symbol, position.liquidationPriceUsd]));
}
