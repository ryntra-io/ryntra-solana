/* Binance instrument identity (read-only discovery).

   Ryntra's chain-scoped `InstrumentKey` in `../domain/instrument.ts` keys an instrument by the
   CHAIN it settles on, which is correct for Robinhood Chain and HyperCore and cannot express a
   centralized venue: nothing about a Binance USDⓈ-M contract settles on a chain. Rather than
   invent a chain id for an exchange — the exact fabrication `domain/ids.ts` warns against for
   HyperCore's EVM id — Binance instruments carry their own venue-scoped key.

   The key is deliberately wider than "symbol". Binance quotes `TSLA` on at least two unrelated
   surfaces (a USDT-margined TradFi perpetual and a spot tokenized security), and Robinhood Chain
   quotes a third `TSLA` that a holder custodies themselves. Those are three different risks and
   three different custody models, so they must be three different ids. */

/** One exact Binance market surface. Never collapse two of these into "Binance". */
export type BinanceSurfaceId =
  | "binance-spot"
  | "binance-margin"
  | "binance-usdm-futures"
  | "binance-coinm-futures"
  | "binance-convert"
  | "binance-equity";

/** The product type of one instrument on one surface. */
export type BinanceProductType =
  | "spot-crypto"
  | "margin-crypto"
  | "crypto-perpetual"
  | "tradifi-perpetual"
  | "dated-future"
  | "convert-pair"
  | "spot-tokenized-equity";

export type BinanceSurfaceMeta = {
  id: BinanceSurfaceId;
  label: string;
  /** The REST origin this surface's public data is served from. */
  restBaseUrl: string;
  /** Path prefix that identifies the surface within that origin. */
  pathPrefix: string;
  products: readonly BinanceProductType[];
};

export const BINANCE_SURFACES: Record<BinanceSurfaceId, BinanceSurfaceMeta> = {
  "binance-spot": {
    id: "binance-spot",
    label: "Binance Spot",
    restBaseUrl: "https://api.binance.com",
    pathPrefix: "/api/v3",
    products: ["spot-crypto"],
  },
  "binance-margin": {
    id: "binance-margin",
    label: "Binance Margin",
    restBaseUrl: "https://api.binance.com",
    pathPrefix: "/sapi/v1/margin",
    products: ["margin-crypto"],
  },
  "binance-usdm-futures": {
    id: "binance-usdm-futures",
    label: "Binance USDⓈ-M Futures",
    restBaseUrl: "https://fapi.binance.com",
    pathPrefix: "/fapi/v1",
    products: ["crypto-perpetual", "tradifi-perpetual", "dated-future"],
  },
  "binance-coinm-futures": {
    id: "binance-coinm-futures",
    label: "Binance COIN-M Futures",
    restBaseUrl: "https://dapi.binance.com",
    pathPrefix: "/dapi/v1",
    products: ["crypto-perpetual", "dated-future"],
  },
  "binance-convert": {
    id: "binance-convert",
    label: "Binance Convert",
    restBaseUrl: "https://api.binance.com",
    pathPrefix: "/sapi/v1/convert",
    products: ["convert-pair"],
  },
  "binance-equity": {
    id: "binance-equity",
    label: "Binance Stocks (tokenized securities)",
    restBaseUrl: "https://api.binance.com",
    pathPrefix: "/sapi/v1/equity",
    products: ["spot-tokenized-equity"],
  },
};

export type BinanceInstrumentKey = {
  /** The operator. Constant, and present so the id can never be read as chain-scoped. */
  venue: "binance";
  surface: BinanceSurfaceId;
  product: BinanceProductType;
  /** Canonical base symbol as the venue spells it, e.g. "BTC", "TSLA". */
  base: string;
  /** Quote asset, e.g. "USDT", "USDC", "USD". */
  quote: string;
  /** Settlement / margin asset when it differs from the quote (COIN-M), else null. */
  settle: string | null;
  /** Delivery timestamp (unix ms) for dated futures, null for spot and perpetuals. */
  expiry: number | null;
};

/** Stable string form for maps, journal rows and idempotency scopes. */
export function binanceInstrumentId(k: BinanceInstrumentKey): string {
  const settle = k.settle && k.settle !== k.quote ? `@${k.settle}` : "";
  const expiry = k.expiry == null ? "" : `#${k.expiry}`;
  return `${k.venue}:${k.surface}:${k.product}:${k.base}/${k.quote}${settle}${expiry}`;
}

/** Trading hours of the UNDERLYING, not of the contract. */
export type UnderlyingHours = "equities-rth" | "24-7" | "unknown";

/** The venue's own close-only / halted signal on the Stocks surface. */
export type BinanceTradability = "BUY_SELL" | "BUY" | "SELL" | "NONE";

export type BinanceInstrumentRecord = {
  key: BinanceInstrumentKey;
  label: string;
  /** Whether the venue currently permits opening AND closing. Close-only is not tradable. */
  tradable: boolean;
  /** The exact venue value that produced `tradable`, so a refusal can be explained. */
  tradabilityReason: string;
  /** `underlyingType` for TradFi contracts (EQUITY, COMMODITY, HK_EQUITY, …), else null. */
  underlyingClass: string | null;
  /** Hours of the underlying. The contract's own session behaviour is NOT established here. */
  marketHours: UnderlyingHours;
  /** Other Binance surfaces this same symbol is permitted on, e.g. margin alongside spot. */
  alsoPermittedOn: BinanceSurfaceId[];
};

/** Underlying classes the venue marks as traditional-finance equity-like. */
const EQUITY_UNDERLYINGS = new Set(["EQUITY", "KR_EQUITY", "HK_EQUITY", "CN_EQUITY", "PREMARKET"]);

export type RawSpotSymbol = {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed?: boolean;
  isMarginTradingAllowed?: boolean;
  permissionSets?: readonly (readonly string[])[];
};

export function normalizeSpotSymbol(raw: RawSpotSymbol): BinanceInstrumentRecord {
  const permissions = new Set((raw.permissionSets ?? []).flat());
  const marginPermitted = raw.isMarginTradingAllowed === true || permissions.has("MARGIN");

  return {
    key: {
      venue: "binance",
      surface: "binance-spot",
      product: "spot-crypto",
      base: raw.baseAsset,
      quote: raw.quoteAsset,
      settle: null,
      expiry: null,
    },
    label: `${raw.baseAsset}/${raw.quoteAsset} spot`,
    // `BREAK` is the venue saying this symbol is not trading. Defaulting it to tradable would
    // present a halted market as an open one.
    tradable: raw.status === "TRADING" && raw.isSpotTradingAllowed !== false,
    tradabilityReason: raw.status,
    underlyingClass: null,
    marketHours: "24-7",
    alsoPermittedOn: marginPermitted ? ["binance-margin"] : [],
  };
}

export type RawFuturesSymbol = {
  symbol: string;
  status?: string;
  contractStatus?: string;
  baseAsset: string;
  quoteAsset: string;
  marginAsset?: string;
  contractType: string;
  underlyingType?: string;
  underlyingSubType?: readonly string[];
  deliveryDate?: number;
};

/** Delivery timestamp Binance uses for contracts that never expire (year 2100). */
const PERPETUAL_DELIVERY_SENTINEL = 4133404800000;

function futuresProduct(contractType: string): BinanceProductType {
  if (contractType === "TRADIFI_PERPETUAL") return "tradifi-perpetual";
  if (contractType === "PERPETUAL") return "crypto-perpetual";
  return "dated-future";
}

function normalizeFuturesSymbol(raw: RawFuturesSymbol, surface: BinanceSurfaceId): BinanceInstrumentRecord {
  const product = futuresProduct(raw.contractType);
  const underlyingClass = product === "tradifi-perpetual" ? (raw.underlyingType ?? null) : null;
  const dated = product === "dated-future";
  const status = raw.status ?? raw.contractStatus ?? "UNKNOWN";

  return {
    key: {
      venue: "binance",
      surface,
      product,
      base: raw.baseAsset,
      quote: raw.quoteAsset,
      settle: raw.marginAsset ?? null,
      expiry: dated && raw.deliveryDate != null && raw.deliveryDate !== PERPETUAL_DELIVERY_SENTINEL
        ? raw.deliveryDate
        : null,
    },
    label: `${raw.symbol} ${raw.contractType.toLowerCase().replace(/_/g, " ")}`,
    tradable: status === "TRADING",
    tradabilityReason: status,
    underlyingClass,
    marketHours: underlyingClass == null
      ? "24-7"
      : EQUITY_UNDERLYINGS.has(underlyingClass)
        ? "equities-rth"
        // A metal or an index is neither crypto's 24/7 nor an equity session, and this
        // discovery did not establish its calendar. "unknown" is the honest value.
        : "unknown",
    alsoPermittedOn: [],
  };
}

export function normalizeUsdmSymbol(raw: RawFuturesSymbol): BinanceInstrumentRecord {
  return normalizeFuturesSymbol(raw, "binance-usdm-futures");
}

export function normalizeCoinmSymbol(raw: RawFuturesSymbol): BinanceInstrumentRecord {
  return normalizeFuturesSymbol(raw, "binance-coinm-futures");
}

export type RawEquitySymbol = {
  /** Plain uppercase US ticker; the venue documents `AAPL`, never `EQ_AAPL` or `AAPLUSDT`. */
  symbol: string;
  quoteAsset?: string;
  tradability?: BinanceTradability;
};

export function normalizeEquitySymbol(raw: RawEquitySymbol): BinanceInstrumentRecord {
  const tradability = raw.tradability ?? "NONE";

  return {
    key: {
      venue: "binance",
      surface: "binance-equity",
      product: "spot-tokenized-equity",
      base: raw.symbol,
      // The venue documents USDC as the default when `quoteAsset` is omitted.
      quote: raw.quoteAsset ?? "USDC",
      settle: null,
      expiry: null,
    },
    label: `${raw.symbol} tokenized security`,
    // Only BUY_SELL is a two-sided market. BUY and SELL are one-directional, and treating a
    // close-only instrument as tradable would let a plan open a position it cannot open.
    tradable: tradability === "BUY_SELL",
    tradabilityReason: tradability,
    underlyingClass: "EQUITY",
    marketHours: "equities-rth",
    alsoPermittedOn: [],
  };
}
