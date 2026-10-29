/**
 * Phoenix perpetuals as «Торгівля → Ф'ючерси» of Ryntra on Solana reads them — the
 * public API's answers turned into what the page draws, and nothing else. Read only: no wallet signs here, no order
 * is built, no key is held; the person's positions and orders are read by the wallet's public address alone.
 *
 * The shapes are the official SDK's (`@ellipsis-labs/rise` 0.6.2, 12.10.2026 — the source of the B7a audit,
 * `docs/research/phoenix-2026-10-20/REPORT.md` §9): `GET /v1/view/exchange/markets`, `GET /v1/markets/stats/latest`,
 * `GET /v1/view/orderbook/{symbol}`, `GET /v1/candles_v2/{symbol}` and `GET /v1/trader/state/{authority}`. Every
 * field is checked here rather than trusted: a field that is missing or not a number is no number on the screen.
 *
 * Units (SDK `units.ts`): the quote is USDC with six decimals, so a quote lot is a millionth of a dollar; a price in
 * ticks is ticks × `tickSize` × 10^`baseLotsDecimals` / 10^6 dollars; a base lot is 10^−`baseLotsDecimals` of the
 * asset (`baseLotsDecimals` may be negative — PUMP is −2). The book's levels are dollars and base units already.
 *
 * The funding rate is read from `GET /v1/funding/{symbol}/rates`, whose field names its unit (`fundingRatePercentage`,
 * PERP-4) — never from the stats' `current_funding_rate`, whose unit the SDK does not name (B7a §9): a number a hundred
 * times wrong is worse than none. The open interest is read from the
 * market's configuration, whose field names its unit (`statsSnapshot.openInterestBaseLots`, PERP-2), and not drawn
 * until a live read fixes whether one side or both are counted.
 */

import type { PhoenixMarginWire } from "./collateral-model.ts";

export const PHOENIX_API_URL = "https://perp-api.phoenix.trade";

/** A market symbol as Phoenix writes it (SOL, BTC, FARTCOIN, WTIOIL): letters and digits, never a path. */
export const SYMBOL = /^[A-Za-z0-9]{1,20}$/;

/** A Solana address: base58, 32 to 44 characters. */
export const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const FUTURES_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type FuturesTimeframe = (typeof FUTURES_TIMEFRAMES)[number];

export const isFuturesTimeframe = (value: unknown): value is FuturesTimeframe => typeof value === "string" && (FUTURES_TIMEFRAMES as readonly string[]).includes(value);

/** A bar's length in ms, per timeframe. */
export const TIMEFRAME_MS: Readonly<Record<FuturesTimeframe, number>> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

/**
 * How long the edge keeps one candles read, in seconds: five on the minute's bars, up to thirty on the day's. The
 * route serves a copy at most twice that old (its life, then as long again while it refetches).
 */
export function candlesCacheSeconds(timeframe: FuturesTimeframe): number {
  return Math.min(30, Math.max(5, Math.round(TIMEFRAME_MS[timeframe] / 120_000)));
}

/** How many bars one read asks for: enough to fill a wide chart, one page of the API. */
export const CANDLES_PER_READ = 500;

/**
 * The catalog's groups (PERP-4, spec §6.3): crypto, commodities and equity as Phoenix's catalog names them. Phoenix's
 * catalog (SDK 0.6.2) has no asset-class field: `commodityMetadata.isCommodity` marks every market that trades by a
 * calendar — gold and oil as much as Tesla — and `metadata.classifications` carries tags such as `pre-ipo` and
 * `new-listing`. A class word in `classifications` is taken when Phoenix sends one; a calendar market without one is
 * `rwa` — commodities and equity together, honestly unsplit — and a market without a calendar trades around the clock:
 * crypto.
 */
export const FUTURES_GROUPS = ["crypto", "commodity", "equity", "rwa"] as const;
export type FuturesGroup = (typeof FUTURES_GROUPS)[number];

/**
 * Where a market stands now (spec §6.3, a must for RWA): `trading`; `underlyingClosed` — the market it follows is shut
 * (Phoenix's session word `closed`); `internalPricing` — the underlying is shut and Phoenix prices the perpetual itself
 * in a band around the last known index (`afterHours`); `paused` — Phoenix holds the market (any listing word but
 * `active`); `unknown` — a calendar market whose session word Ryntra does not know: never «trading» on a guess.
 */
export type FuturesMarketState = "trading" | "underlyingClosed" | "internalPricing" | "paused" | "unknown";

export type FuturesMarket = Readonly<{
  symbol: string;
  /** `active` trades; `gated` is listed by the exchange but not open to orders (SDK `exchange-cache/store.ts`). */
  status: "active" | "gated";
  /** Where the market stands now, its session included (PERP-4); absent from an answer before PERP-4 — read as `status`. */
  state?: FuturesMarketState;
  /** The catalog's group (PERP-4); absent before PERP-4. */
  group?: FuturesGroup;
  /** Phoenix's own name of the market (`metadata.name`), and the words it is also found by (`searchAliases`). */
  name?: string | null;
  aliases?: readonly string[];
  /** Seconds between funding settlements and the next settlement's time, ms (`fundingIntervalSeconds`, `statsSnapshot`). */
  fundingIntervalSeconds?: number | null;
  nextFundingAt?: number | null;
  /** Commodities and stocks trade by a calendar (`commodityMetadata.isCommodity`). */
  calendar: boolean;
  /** A calendar market's session word as Phoenix sends it; null for a market that trades around the clock. */
  session: string | null;
  /** The highest leverage of the first tier: a bigger position gets less (`leverageTiers`). */
  maxLeverage: number | null;
  /**
   * The leverage tiers from the smallest position up (PERP-2): up to `maxSizeUnits` of the asset a position takes this
   * leverage; a bigger one the next tier's. The last tier has no ceiling (null). Empty when Phoenix sent none.
   */
  leverageTiers?: readonly LeverageTier[];
  /**
   * The maintenance margin as a share of the initial margin (`riskFactors.maintenance`, 0.5 = half): with the tier's
   * leverage it gives the margin a position must keep — the ticket's estimate of the liquidation price. Null when not sent.
   */
  maintenanceRatio?: number | null;
  /** All open positions on the market, one side counted, in the asset (`statsSnapshot.openInterestBaseLots`). */
  openInterestUnits?: number | null;
  isolatedOnly: boolean;
  /** Quote lots per base lot per tick, and the base decimals: the units of the trader state's ticks and lots. */
  tickSize: number | null;
  baseLotsDecimals: number | null;
  /** Phoenix's fee on the part that takes liquidity and on the part that rests, fractions of the notional (B6b); null when not sent. */
  takerRate?: number | null;
  makerRate?: number | null;
  markPrice: number | null;
  /** The median of the market's oracles — Phoenix's index price. */
  oraclePrice: number | null;
  /** The mark price a day ago; the change is counted from it. */
  prevDayMarkPrice: number | null;
  dayVolumeUsd: number | null;
}>;

export type LeverageTier = Readonly<{ maxLeverage: number; maxSizeUnits: number | null }>;

export type FuturesMarkets = Readonly<{ markets: readonly FuturesMarket[]; observedAt: number }>;

export type BookLevelRow = Readonly<{ price: number; size: number }>;

export type FuturesBook = Readonly<{ symbol: string; slot: number | null; bids: readonly BookLevelRow[]; asks: readonly BookLevelRow[]; observedAt: number }>;

export type FuturesCandle = Readonly<{ t: number; o: number; h: number; l: number; c: number; v: number | null; final: boolean }>;

export type FuturesCandles = Readonly<{
  symbol: string;
  timeframe: FuturesTimeframe;
  /** The traded price's bars and the mark price's, from the same read. */
  last: readonly FuturesCandle[];
  mark: readonly FuturesCandle[];
  observedAt: number;
}>;

export type FuturesSide = "long" | "short";

export type FuturesPosition = Readonly<{
  symbol: string;
  subaccount: number;
  side: FuturesSide;
  /** In the base asset, always positive; `side` says which way. Null when Phoenix sent lots and the market's decimals
      are not known — the position is still shown, its size unknown. */
  size: number | null;
  entryPrice: number | null;
  /** The position's take profit and stop loss as Phoenix's conditional orders hold them, trigger prices in dollars (B6b); null — none. */
  tpPrice?: number | null;
  slPrice?: number | null;
}>;

export type FuturesOrder = Readonly<{
  id: string;
  symbol: string;
  subaccount: number;
  side: "buy" | "sell";
  type: string;
  price: number | null;
  /** What is left to fill, in the base asset. */
  size: number | null;
  reduceOnly: boolean;
  stop: boolean;
  status: string;
  /** Phoenix's sequence number of the order, the id a cancel names (B6b); null when Phoenix sent none. */
  sequence?: string | null;
  /**
   * The index of the position's conditional order this row is the placed leg of (PERP-5): Phoenix's own order rows
   * carry no index, so it comes from the position's trigger that names this sequence number. Absent — this row is not
   * a conditional order of a position Ryntra can read, and no single cancel of it can be built.
   */
  conditional?: number | null;
  /** Which leg of the position it is, where the index is known. */
  conditionalLeg?: "tp" | "sl" | null;
}>;

/** The trader account's state in Phoenix's words: `active` trades, `frozen` waits for access, `uninitialized` has none. */
export type FuturesAccountState = "none" | "uninitialized" | "cold" | "active" | "reduceOnly" | "frozen" | "unknown";

export type FuturesAccount = Readonly<{
  wallet: string;
  state: FuturesAccountState;
  /** USDC on the account across its subaccounts, in dollars. */
  collateralUsd: number | null;
  /** SOL posted as collateral (`spotCollaterals`), in SOL — counted at a discount by Phoenix, never added to the dollars here. */
  collateralSol: number | null;
  positions: readonly FuturesPosition[];
  orders: readonly FuturesOrder[];
  /** The account's margin (B6, `/v1/view/trader`); null when not read or there is no account. */
  margin?: PhoenixMarginWire | null;
  /** The margin of each other subaccount that holds a position — isolated margin, one market each (SOL-C7); absent when none. */
  subaccountMargins?: readonly PhoenixMarginWire[];
  observedAt: number;
}>;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** A finite number from a number or a decimal string; null for anything else. */
export function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const positive = (value: unknown): number | null => {
  const parsed = num(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

/** Symbols compare case-blind, as the SDK's own lookups do; Phoenix's spelling is what is sent and shown. */
export const symbolKey = (symbol: string): string => symbol.toLowerCase();

/** A fee rate as Phoenix sends it (0.00035 is 3.5 bps); null for anything that is not a plausible rate. */
function feeRate(value: unknown): number | null {
  const parsed = num(value);
  return parsed !== null && parsed >= 0 && parsed < 0.01 ? parsed : null;
}

/** Whether a conditional trigger of a position still stands: Phoenix's own word for its state. */
const triggerStands = (entry: Json): boolean => {
  const status = text(entry.status, "active").toLowerCase();
  return status === "active" || status === "pending" || status === "open";
};

/**
 * The orders a position's conditional triggers are placed as, by the sequence number each names (PERP-5): the only
 * place a conditional order's index comes from, so a single cancel of one can be built from the table.
 */
function attachedConditionals(position: Json, into: Map<string, Readonly<{ index: number; leg: "tp" | "sl" }>>): void {
  const read = (list: unknown, key: string, leg: "tp" | "sl") => {
    for (const entry of Array.isArray(list) ? list : []) {
      if (!isObject(entry) || !isObject(entry.trigger) || !triggerStands(entry)) continue;
      const index = num(entry[key]);
      const attached = entry.trigger.attachedOrderSequenceNumber;
      if (index === null || !Number.isInteger(index) || index < 1 || index > 191) continue;
      if (typeof attached !== "string" || !/^\d{1,20}$/.test(attached)) continue;
      if (!into.has(attached)) into.set(attached, { index, leg });
    }
  };
  read(position.conditionalTakeProfitTriggers, "conditionalTakeProfitId", "tp");
  read(position.conditionalStopLossTriggers, "conditionalStopLossId", "sl");
}

/** The first trigger price of a position's conditional TP or SL that still stands, in dollars. */
function triggerPrice(list: unknown, market: MarketUnits | undefined): number | null {
  for (const entry of Array.isArray(list) ? list : []) {
    if (!isObject(entry) || !isObject(entry.trigger) || !triggerStands(entry)) continue;
    const price = positive(ticksToUsd(entry.trigger.triggerPriceTicks, market));
    if (price !== null) return price;
  }
  return null;
}

/** The first tier's leverage is the market's highest: a bigger position slides down the tiers (B7a §1). */
function maxLeverageOf(tiers: unknown): number | null {
  if (!Array.isArray(tiers)) return null;
  const values = tiers.map((tier) => (isObject(tier) ? positive(tier.maxLeverage) : null)).filter((value): value is number => value !== null);
  return values.length ? Math.max(...values) : null;
}

/** The tiers as sizes in the asset, smallest first; a tier without a size bound is the last and has no ceiling. */
function tiersOf(tiers: unknown, decimals: number | null): LeverageTier[] {
  if (!Array.isArray(tiers) || decimals === null) return [];
  const out: LeverageTier[] = [];
  for (const tier of tiers) {
    if (!isObject(tier)) continue;
    const leverage = positive(tier.maxLeverage);
    if (leverage === null) continue;
    const lots = positive(tier.maxSizeBaseLots);
    out.push({ maxLeverage: leverage, maxSizeUnits: lots === null ? null : lots * 10 ** -decimals });
  }
  return out.sort((a, b) => (a.maxSizeUnits ?? Infinity) - (b.maxSizeUnits ?? Infinity));
}

/** `riskFactors.maintenance` as a share: the basis points when sent, else the percentage. Null when neither is a share. */
function maintenanceOf(factors: unknown): number | null {
  if (!isObject(factors)) return null;
  const bps = positive(factors.maintenanceBps);
  const share = bps !== null ? bps / 10_000 : (positive(factors.maintenance) ?? NaN) / 100;
  return Number.isFinite(share) && share > 0 && share <= 1 ? share : null;
}

/** The open interest in the asset, from the configuration's snapshot of the market. */
function openInterestOf(snapshot: unknown, decimals: number | null): number | null {
  if (!isObject(snapshot) || decimals === null) return null;
  const lots = num(snapshot.openInterestBaseLots);
  return lots !== null && lots >= 0 ? lots * 10 ** -decimals : null;
}

/** Session words as Phoenix writes them, spaces, dashes and case dropped (`afterHours`, `after-hours`). */
const sessionKey = (word: string | null): string => (word ?? "").replace(/[\s_-]/g, "").toLowerCase();

/** Where a market stands, from its listing word and, for a calendar market, its session (see `FuturesMarketState`). */
export function marketStateOf(lifecycle: string, calendar: boolean, session: string | null, afterHours = false): FuturesMarketState {
  if (lifecycle.trim().toLowerCase() !== "active") return "paused";
  if (!calendar) return "trading";
  const key = sessionKey(session);
  if (afterHours || key === "afterhours") return "internalPricing";
  if (key === "closed") return "underlyingClosed";
  if (key === "open" || key === "active") return "trading";
  return "unknown";
}

const CLASS_WORDS: readonly (readonly [RegExp, FuturesGroup])[] = [
  [/^(equity|equities|stock|stocks)$/, "equity"],
  [/^(commodity|commodities)$/, "commodity"],
  [/^(crypto|cryptocurrency)$/, "crypto"],
];

/** The catalog's group of a market (see `FuturesGroup`): a class word Phoenix sends, else by its calendar. */
export function groupOf(classifications: unknown, calendar: boolean): FuturesGroup {
  for (const word of Array.isArray(classifications) ? classifications : []) {
    if (typeof word !== "string") continue;
    const key = word.trim().toLowerCase();
    const found = CLASS_WORDS.find(([pattern]) => pattern.test(key));
    if (found) return found[1];
  }
  return calendar ? "rwa" : "crypto";
}

/** A time Phoenix sends in seconds or in ms, as ms; null for anything that is not a time. */
function msOf(value: unknown): number | null {
  const parsed = num(value);
  if (parsed === null || parsed <= 0) return null;
  return parsed < 1e12 ? parsed * 1000 : parsed;
}

/**
 * The next funding settlement after `now`, ms: the interval's start (`statsSnapshot.fundingStartIntervalTimestamp`)
 * stepped by the interval until it is ahead. Null without both.
 */
export function nextFundingAt(start: unknown, intervalSeconds: number | null, now: number): number | null {
  const from = msOf(start);
  if (from === null || intervalSeconds === null || !(intervalSeconds > 0)) return null;
  const span = intervalSeconds * 1000;
  return now < from + span ? from + span : from + span * Math.ceil((now - from) / span + 1e-9);
}

/** The words a market is also found by: its name and Phoenix's aliases, short and few. */
function aliasesOf(metadata: Json | null): string[] {
  const list = metadata && Array.isArray(metadata.searchAliases) ? metadata.searchAliases : [];
  return list.filter((word): word is string => typeof word === "string" && word.trim().length > 0 && word.length <= 40).slice(0, 12);
}

/**
 * The market list: the exchange's configuration joined with the latest stats, by symbol. A market the configuration
 * lists without stats still shows its name and leverage; stats without a configured market are left out — there is no
 * market to open. Sorted by the day's volume, the busiest first; markets without one keep the exchange's order after.
 */
export function marketsFrom(config: unknown, stats: unknown, observedAt: number): FuturesMarkets {
  const statsList = isObject(stats) && Array.isArray(stats.markets) ? stats.markets : [];
  const bySymbol = new Map<string, Json>();
  for (const entry of statsList) if (isObject(entry) && typeof entry.symbol === "string") bySymbol.set(symbolKey(entry.symbol), entry);
  const configured = Array.isArray(config) ? config : [];
  const markets: FuturesMarket[] = [];
  const seen = new Set<string>();
  for (const raw of configured) {
    if (!isObject(raw) || typeof raw.symbol !== "string" || !SYMBOL.test(raw.symbol)) continue;
    /* Phoenix's own spelling travels on (kBONK stays kBONK); matching is case-blind. */
    const symbol = raw.symbol;
    if (seen.has(symbolKey(symbol))) continue;
    seen.add(symbolKey(symbol));
    const stat = bySymbol.get(symbolKey(symbol));
    const commodity = isObject(raw.commodityMetadata) ? raw.commodityMetadata : null;
    const lifecycle = text(raw.marketStatus).trim().toLowerCase();
    /* A closed or tombstoned market has nothing left to show; every other word but `active` is gated (SDK `toLifecycle`). */
    if (lifecycle === "closed" || lifecycle === "tombstoned") continue;
    const calendar = commodity?.isCommodity === true;
    const decimals = num(raw.baseLotsDecimals);
    const session = calendar ? text(commodity?.status) || null : null;
    const metadata = isObject(raw.metadata) ? raw.metadata : null;
    const interval = positive(raw.fundingIntervalSeconds);
    markets.push({
      symbol,
      status: lifecycle === "active" ? "active" : "gated",
      state: marketStateOf(lifecycle, calendar, session, commodity?.isAfterHours === true),
      group: groupOf(metadata?.classifications, calendar),
      name: metadata && typeof metadata.name === "string" && metadata.name.trim() ? metadata.name.trim().slice(0, 80) : null,
      aliases: aliasesOf(metadata),
      fundingIntervalSeconds: interval,
      nextFundingAt: nextFundingAt(isObject(raw.statsSnapshot) ? raw.statsSnapshot.fundingStartIntervalTimestamp : null, interval, observedAt),
      calendar,
      session,
      maxLeverage: maxLeverageOf(raw.leverageTiers),
      leverageTiers: tiersOf(raw.leverageTiers, decimals !== null && Number.isInteger(decimals) ? decimals : null),
      maintenanceRatio: maintenanceOf(raw.riskFactors),
      openInterestUnits: openInterestOf(raw.statsSnapshot, decimals !== null && Number.isInteger(decimals) ? decimals : null),
      isolatedOnly: raw.isolatedOnly === true,
      tickSize: positive(raw.tickSize),
      baseLotsDecimals: decimals !== null && Number.isInteger(decimals) ? decimals : null,
      takerRate: feeRate(raw.takerFee),
      makerRate: feeRate(raw.makerFee),
      markPrice: positive(stat?.mark_price),
      oraclePrice: positive(stat?.oracle_price),
      prevDayMarkPrice: positive(stat?.prev_day_mark_price),
      dayVolumeUsd: (() => {
        const volume = num(stat?.day_volume_usd);
        return volume !== null && volume >= 0 ? volume : null;
      })(),
    });
  }
  const order = new Map(markets.map((market, index) => [market.symbol, index]));
  markets.sort((a, b) => (b.dayVolumeUsd ?? -1) - (a.dayVolumeUsd ?? -1) || (order.get(a.symbol) ?? 0) - (order.get(b.symbol) ?? 0));
  return { markets, observedAt };
}

/**
 * The mark price against the index (spec §6.3), signed: what the mark is above (+) or below (−) the index, in dollars
 * and as a fraction of the index. Null without both.
 */
export function markIndexGap(market: Pick<FuturesMarket, "markPrice" | "oraclePrice">): Readonly<{ usd: number; fraction: number }> | null {
  const { markPrice, oraclePrice } = market;
  if (markPrice === null || oraclePrice === null || !(oraclePrice > 0)) return null;
  return { usd: markPrice - oraclePrice, fraction: markPrice / oraclePrice - 1 };
}

/** A market's state for an answer read before PERP-4 carried one: its listing word alone. */
export const stateOf = (market: Pick<FuturesMarket, "status" | "state">): FuturesMarketState => market.state ?? (market.status === "active" ? "trading" : "paused");

/** Whether a market's text matches a search: its symbol, Phoenix's name and aliases, case-blind. */
export function marketMatches(market: Pick<FuturesMarket, "symbol" | "name" | "aliases">, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [market.symbol, market.name ?? "", ...(market.aliases ?? [])].some((word) => word.toLowerCase().includes(needle));
}

/* ------------------------------------------------------------------ funding */

/** The oldest point that still says the rate now. */
export const FUNDING_MAX_AGE_MS = 6 * 3_600_000;

/** The market's funding as Phoenix's rates read names it (`GET /v1/funding/{symbol}/rates`, `fundingRatePercentage`). */
export type FuturesFunding = Readonly<{
  symbol: string;
  /** The newest rate, a per cent of the position's value for one period; positive — longs pay. */
  ratePercent: number;
  /** When Phoenix stated it, ms. */
  at: number;
  /** The period one rate is for, seconds — the spacing of Phoenix's own points; null when one point came. */
  periodSeconds: number | null;
  observedAt: number;
}>;

/**
 * The newest funding rate of `GET /v1/funding/{symbol}/rates` (SDK `FundingRateHistoryResponse`): the field names its
 * unit — a percentage — unlike the stats' `current_funding_rate`, whose unit the SDK does not name (B7a §9). Null when
 * Phoenix sent no usable point.
 */
export function fundingFrom(raw: unknown, symbol: string, observedAt: number): FuturesFunding | null {
  const rates = isObject(raw) && Array.isArray(raw.rates) ? raw.rates : [];
  const points: { at: number; rate: number }[] = [];
  for (const point of rates) {
    if (!isObject(point)) continue;
    const at = msOf(point.timestamp) ?? (typeof point.timestamp === "string" ? Date.parse(point.timestamp) : NaN);
    const rate = num(point.fundingRatePercentage);
    /* Five per cent a period is no rate Phoenix pays: a unit misread, never shown. */
    if (Number.isFinite(at) && at > 0 && rate !== null && Math.abs(rate) < 5) points.push({ at, rate });
  }
  if (points.length === 0) return null;
  points.sort((a, b) => b.at - a.at);
  const [newest, before] = points;
  /* A rate older than six hours is history, not the rate now. */
  if (observedAt - newest!.at > FUNDING_MAX_AGE_MS) return null;
  const spacing = before ? (newest!.at - before.at) / 1000 : null;
  return { symbol, ratePercent: newest!.rate, at: newest!.at, periodSeconds: spacing !== null && spacing > 0 ? Math.round(spacing) : null, observedAt };
}

/**
 * Who pays the funding now, cautiously: positive — longs, negative — shorts, and only where the mark's side of the
 * index agrees with the rate's sign (the same rule as the Review's `fundingOf`); null when they disagree or are unknown.
 */
export function fundingPayer(ratePercent: number, gap: Readonly<{ usd: number }> | null): "long" | "short" | null {
  if (ratePercent === 0 || gap === null || gap.usd === 0) return null;
  return ratePercent > 0 === gap.usd > 0 ? (ratePercent > 0 ? "long" : "short") : null;
}

/** The day's change of the mark price, as a fraction; null without both prices. */
export function dayChange(market: Pick<FuturesMarket, "markPrice" | "prevDayMarkPrice">): number | null {
  const { markPrice, prevDayMarkPrice } = market;
  if (markPrice === null || prevDayMarkPrice === null) return null;
  return markPrice / prevDayMarkPrice - 1;
}

function levels(raw: unknown, side: "bid" | "ask"): BookLevelRow[] {
  if (!Array.isArray(raw)) return [];
  const out: BookLevelRow[] = [];
  for (const level of raw) {
    if (!Array.isArray(level)) continue;
    const price = positive(level[0]);
    const size = positive(level[1]);
    if (price !== null && size !== null) out.push({ price, size });
  }
  /* Bids from the best (highest) down, asks from the best (lowest) up — the core's order. */
  return out.sort((a, b) => (side === "bid" ? b.price - a.price : a.price - b.price));
}

/** The book of `GET /v1/view/orderbook/{symbol}`: dollars and base units per level. */
export function bookFrom(raw: unknown, symbol: string, observedAt: number): FuturesBook {
  const body = isObject(raw) ? raw : {};
  const slot = num(body.slot);
  return { symbol, slot: slot !== null && slot >= 0 ? slot : null, bids: levels(body.bids, "bid"), asks: levels(body.asks, "ask"), observedAt };
}

function candle(raw: Json, keys: readonly [string, string, string, string]): FuturesCandle | null {
  const t = num(raw.time);
  const [o, h, l, c] = keys.map((key) => positive(raw[key]));
  if (t === null || t <= 0 || o == null || h == null || l == null || c == null) return null;
  const volume = num(raw.volume);
  return {
    t: Math.floor(t),
    o,
    /* A broken print never turns a bar inside out: the high is the highest of the four, the low the lowest. */
    h: Math.max(o, h, l, c),
    l: Math.min(o, h, l, c),
    c,
    v: volume !== null && volume >= 0 ? volume : null,
    final: raw.isFinal === true,
  };
}

/** The bars of `GET /v1/candles_v2/{symbol}`: times in ms, the traded price's OHLC and the mark price's, oldest first. */
export function candlesFrom(raw: unknown, symbol: string, timeframe: FuturesTimeframe, observedAt: number): FuturesCandles {
  const bars = isObject(raw) && Array.isArray(raw.bars) ? raw.bars : [];
  const last = new Map<number, FuturesCandle>();
  const mark = new Map<number, FuturesCandle>();
  for (const bar of bars) {
    if (!isObject(bar)) continue;
    const traded = candle(bar, ["open", "high", "low", "close"]);
    if (traded) last.set(traded.t, traded);
    const marked = candle(bar, ["markOpen", "markHigh", "markLow", "markClose"]);
    if (marked) mark.set(marked.t, { ...marked, v: null });
  }
  const sorted = (map: Map<number, FuturesCandle>) => [...map.values()].sort((a, b) => a.t - b.t);
  return { symbol, timeframe, last: sorted(last), mark: sorted(mark), observedAt };
}

/**
 * The query of one candles read: exactly `CANDLES_PER_READ` buckets, the newest the open one — `to` is exclusive and
 * ends the bucket of `now`, so a page of `limit` bars can never leave the open bar out.
 */
export function candlesQuery(timeframe: FuturesTimeframe, now: number): string {
  const span = TIMEFRAME_MS[timeframe];
  const to = Math.floor(now / span) * span + span;
  const from = to - span * CANDLES_PER_READ;
  return new URLSearchParams({ timeframe, from: String(from), to: String(to), limit: String(CANDLES_PER_READ), includePartial: "true" }).toString();
}

const ACCOUNT_STATES: ReadonlySet<string> = new Set(["uninitialized", "cold", "active", "reduceOnly", "frozen"]);

type MarketUnits = Pick<FuturesMarket, "tickSize" | "baseLotsDecimals">;

/** Lots of the base asset in the asset itself; null without the market's decimals. */
export function lotsToUnits(lots: unknown, decimals: number | null): number | null {
  const value = num(lots);
  if (value === null || decimals === null) return null;
  return value / 10 ** decimals;
}

/** A price in ticks in dollars (SDK `ticksToUsdWithMarketParams`); null without the market's tick size and decimals. */
export function ticksToUsd(ticks: unknown, units: MarketUnits | undefined): number | null {
  const value = num(ticks);
  if (value === null || !units || units.tickSize === null || units.baseLotsDecimals === null) return null;
  return (value * units.tickSize * 10 ** units.baseLotsDecimals) / 1_000_000;
}

/** A market's price step in dollars (SDK `ticksToUsdWithMarketParams` of one tick); null without its units. */
export function tickUsd(market: MarketUnits | undefined): number | null {
  return positive(ticksToUsd(1, market));
}

/** A market's size step in the base asset: one base lot; null without its decimals. */
export function lotUnits(market: Pick<FuturesMarket, "baseLotsDecimals"> | undefined): number | null {
  if (!market || market.baseLotsDecimals === null) return null;
  return 10 ** -market.baseLotsDecimals;
}

/** A signed size: the API's own units when it sends them, else lots by the market's decimals. */
function signedSize(units: unknown, lots: unknown, decimals: number | null): number | null {
  return num(units) ?? lotsToUnits(lots, decimals);
}

/**
 * The trader state of `GET /v1/trader/state/{authority}` (PDA index 0 — the same account phoenix.trade opens, B7a §7):
 * every subaccount's collateral, positions and resting orders. `markets` gives the units of each symbol for the
 * fields that come in ticks and lots only. Closed rows are left out.
 */
export function accountFrom(raw: unknown, wallet: string, markets: readonly FuturesMarket[], observedAt: number): FuturesAccount {
  const unitsBy = new Map(markets.map((market) => [symbolKey(market.symbol), market]));
  const body = isObject(raw) ? raw : {};
  const snapshot = isObject(body.snapshot) ? body.snapshot : {};
  const capabilities = isObject(snapshot.capabilities) ? snapshot.capabilities : {};
  const stateWord = text(capabilities.state);
  const state: FuturesAccountState = ACCOUNT_STATES.has(stateWord) ? (stateWord as FuturesAccountState) : "unknown";
  const subaccounts = Array.isArray(snapshot.subaccounts) ? snapshot.subaccounts.filter(isObject) : [];
  let collateralLots: number | null = null;
  let collateralSol: number | null = null;
  const positions: FuturesPosition[] = [];
  const orders: FuturesOrder[] = [];
  for (const sub of subaccounts) {
    const index = num(sub.subaccountIndex) ?? 0;
    const collateral = num(sub.collateral);
    if (collateral !== null) collateralLots = (collateralLots ?? 0) + collateral;
    /* SOL as collateral (B7a §2): its own balance in lamports, never folded into the dollars. */
    for (const spot of Array.isArray(sub.spotCollaterals) ? sub.spotCollaterals : []) {
      if (!isObject(spot) || text(spot.symbol).toUpperCase() !== "SOL") continue;
      const balance = num(spot.balance);
      const decimals = num(spot.decimals);
      if (balance !== null && decimals !== null && Number.isInteger(decimals) && decimals >= 0) collateralSol = (collateralSol ?? 0) + balance / 10 ** decimals;
    }
    const attached = new Map<string, Readonly<{ index: number; leg: "tp" | "sl" }>>();
    for (const position of Array.isArray(sub.positions) ? sub.positions : []) {
      if (!isObject(position) || typeof position.symbol !== "string") continue;
      attachedConditionals(position, attached);
      const symbol = position.symbol;
      const market = unitsBy.get(symbolKey(symbol));
      const size = signedSize(position.basePositionUnits, position.basePositionLots, market?.baseLotsDecimals ?? null);
      /* The lots' sign says the side even when their unit is unknown: such a position is shown with no size, never hidden. */
      const signed = size ?? num(position.basePositionLots);
      if (signed === null || signed === 0) continue;
      positions.push({
        symbol,
        subaccount: index,
        side: signed > 0 ? "long" : "short",
        size: size === null ? null : Math.abs(size),
        entryPrice: positive(position.entryPriceUsd) ?? positive(ticksToUsd(position.entryPriceTicks, market)),
        tpPrice: triggerPrice(position.conditionalTakeProfitTriggers, market),
        slPrice: triggerPrice(position.conditionalStopLossTriggers, market),
      });
    }
    for (const group of Array.isArray(sub.orders) ? sub.orders : []) {
      if (!isObject(group) || typeof group.symbol !== "string" || !Array.isArray(group.orders)) continue;
      const symbol = group.symbol;
      const market = unitsBy.get(symbolKey(symbol));
      for (const order of group.orders) {
        if (!isObject(order) || order.change === "closed") continue;
        const left = signedSize(order.sizeRemainingUnits, order.sizeRemainingLots, market?.baseLotsDecimals ?? null);
        if (left !== null && left <= 0) continue;
        const sequence = typeof order.orderSequenceNumber === "string" && /^\d{1,20}$/.test(order.orderSequenceNumber) ? order.orderSequenceNumber : null;
        const leg = sequence === null ? undefined : attached.get(sequence);
        orders.push({
          id: `${index}:${symbol}:${text(order.orderSequenceNumber, String(orders.length))}`,
          symbol,
          subaccount: index,
          side: order.side === "ask" ? "sell" : "buy",
          type: text(order.orderType, "limit"),
          price: positive(order.priceUsd) ?? positive(ticksToUsd(order.priceTicks, market)),
          size: left === null ? null : Math.abs(left),
          reduceOnly: order.reduceOnly === true,
          stop: order.isStopLoss === true || order.isConditionalOrder === true,
          status: text(order.status, "open"),
          sequence,
          ...(leg ? { conditional: leg.index, conditionalLeg: leg.leg } : {}),
        });
      }
    }
  }
  return {
    wallet,
    state: subaccounts.length === 0 && state === "unknown" ? "none" : state,
    collateralUsd: collateralLots === null ? null : collateralLots / 1_000_000,
    collateralSol,
    positions,
    orders,
    observedAt,
  };
}

/** A wallet Phoenix has never seen: no trader account, nothing to show but that. */
export function noAccount(wallet: string, observedAt: number): FuturesAccount {
  return { wallet, state: "none", collateralUsd: null, collateralSol: null, positions: [], orders: [], observedAt };
}

/** A position's unrealised result at the mark price, in dollars — counted here, not Phoenix's figure; null without both prices. */
export function unrealisedPnl(position: Pick<FuturesPosition, "side" | "size" | "entryPrice">, markPrice: number | null): number | null {
  if (position.entryPrice === null || position.size === null || markPrice === null) return null;
  const direction = position.side === "long" ? 1 : -1;
  return (markPrice - position.entryPrice) * position.size * direction;
}
