/**
 * Parsers for the three direct Robinhood read-only endpoints.
 *
 * Every rule below is the provider's own, taken from
 * `docs.robinhood.com/chain/stock-token-apis` rather than inferred from a
 * sample response — which matters here because this environment cannot fetch a
 * sample response at all, and a shape guessed from one lucky payload is how a
 * nullable field becomes a required one.
 *
 * **Three documented distinctions the schema makes and this parser keeps.**
 *
 *   1. `pendingMultiplier` is `""` — an empty string, not `null` and not `"0"` —
 *      when nothing is pending. `pendingMultiplierEffectiveTime` is *omitted*
 *      rather than nulled in that case. Collapsing either into a falsy check
 *      loses the difference between *no action scheduled* and *a field we
 *      failed to read*.
 *   2. `tradingCapabilities` is omitted or null when the underlying equity
 *      cannot be resolved at all, and each of its sub-fields is independently
 *      nullable when it can. The provider states the distinction explicitly:
 *      `null` means the field is unset, while `"untradable"` is an affirmative
 *      *not tradable*. `allDayTradability` adds a third state — `""`, a
 *      deliberate blank — which is neither of those.
 *   3. `dailyTradingVolume` is `"0"` **when unavailable**. So a zero here is a
 *      missing figure wearing a number's clothes. `RYN-TM-001` recorded the
 *      same trap on `USDG`, where a zero reads as *worthless* on a stablecoin.
 *      It parses to `null` with a reason, never to `0`.
 *
 * Nothing here throws on a malformed payload. A row that cannot be trusted is
 * dropped with its reason collected, because one bad entry must not blank a
 * surface that had two hundred good ones.
 */

import {
  RHJ_SURFACES,
  rhjIdentity,
  type DataRightsState,
  type ProductType,
  type SourceIdentity,
} from "./identity.ts";

export const ASSET_STATUSES = [
  "ASSET_STATUS_UNSPECIFIED",
  "ASSET_STATUS_ACTIVE",
  "ASSET_STATUS_INACTIVE",
] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** Every value the provider documents, including the nine marked forward-compatible. */
export const CORPORATE_ACTION_TYPES = [
  "CORPORATE_ACTION_TYPE_UNSPECIFIED",
  "CORPORATE_ACTION_TYPE_FORWARD_SPLIT",
  "CORPORATE_ACTION_TYPE_REVERSE_SPLIT",
  "CORPORATE_ACTION_TYPE_CASH_DIVIDEND",
  "CORPORATE_ACTION_TYPE_STOCK_DIVIDEND",
  "CORPORATE_ACTION_TYPE_SPIN_OFF",
  "CORPORATE_ACTION_TYPE_CASH_MERGER",
  "CORPORATE_ACTION_TYPE_STOCK_MERGER",
  "CORPORATE_ACTION_TYPE_STOCK_AND_CASH_MERGER",
  "CORPORATE_ACTION_TYPE_REDEMPTION",
  "CORPORATE_ACTION_TYPE_NAME_CHANGE",
  "CORPORATE_ACTION_TYPE_WORTHLESS_REMOVAL",
  "CORPORATE_ACTION_TYPE_RIGHTS_DISTRIBUTION",
  "CORPORATE_ACTION_TYPE_UNIT_SPLIT",
] as const;

export type CorporateActionType = (typeof CORPORATE_ACTION_TYPES)[number];

/** The four active at launch. The rest are accepted and carried, never invented. */
export const CORPORATE_ACTION_TYPES_ACTIVE: readonly CorporateActionType[] = [
  "CORPORATE_ACTION_TYPE_FORWARD_SPLIT",
  "CORPORATE_ACTION_TYPE_REVERSE_SPLIT",
  "CORPORATE_ACTION_TYPE_CASH_DIVIDEND",
  "CORPORATE_ACTION_TYPE_STOCK_DIVIDEND",
];

export const CORPORATE_ACTION_STATUSES = [
  "CORPORATE_ACTION_STATUS_UNSPECIFIED",
  "CORPORATE_ACTION_STATUS_IN_PROGRESS",
  "CORPORATE_ACTION_STATUS_COMPLETED",
] as const;

export type CorporateActionStatus = (typeof CORPORATE_ACTION_STATUSES)[number];

/** `details` carries exactly one key, and which one is decided by `type`. */
export const DETAILS_KEY_BY_TYPE: Readonly<Record<CorporateActionType, string | null>> = {
  CORPORATE_ACTION_TYPE_UNSPECIFIED: null,
  CORPORATE_ACTION_TYPE_FORWARD_SPLIT: "forwardSplit",
  CORPORATE_ACTION_TYPE_REVERSE_SPLIT: "reverseSplit",
  CORPORATE_ACTION_TYPE_CASH_DIVIDEND: "cashDividend",
  CORPORATE_ACTION_TYPE_STOCK_DIVIDEND: "stockDividend",
  CORPORATE_ACTION_TYPE_SPIN_OFF: "spinOff",
  CORPORATE_ACTION_TYPE_CASH_MERGER: "cashMerger",
  CORPORATE_ACTION_TYPE_STOCK_MERGER: "stockMerger",
  CORPORATE_ACTION_TYPE_STOCK_AND_CASH_MERGER: "stockAndCashMerger",
  CORPORATE_ACTION_TYPE_REDEMPTION: "redemption",
  CORPORATE_ACTION_TYPE_NAME_CHANGE: "nameChange",
  CORPORATE_ACTION_TYPE_WORTHLESS_REMOVAL: "worthlessRemoval",
  CORPORATE_ACTION_TYPE_RIGHTS_DISTRIBUTION: "rightsDistribution",
  CORPORATE_ACTION_TYPE_UNIT_SPLIT: "unitSplit",
};

export type Deployment = Readonly<{ contractAddress: string; chainId: number }>;

/**
 * `null` = the provider has not set this field on the underlier.
 * `""` = the provider's own explicit blank, which it documents separately.
 */
export type TradabilityField = string | null;

export type TradingCapabilities = Readonly<{
  fractionalTradability: TradabilityField;
  allDayTradability: TradabilityField;
  extendedHoursFractionalTradability: boolean | null;
}>;

export type RhjAsset = Readonly<{
  id: string;
  tokenSymbol: string;
  tokenName: string;
  deployments: readonly Deployment[];
  currentMultiplier: string;
  /** `null` when nothing is pending — the provider's `""` normalized once, here. */
  pendingMultiplier: string | null;
  /** `null` when absent, which the provider ties to there being nothing pending. */
  pendingMultiplierEffectiveTime: string | null;
  logoUrl: string | null;
  /** `null` when the underlying equity could not be resolved at all. */
  tradingCapabilities: TradingCapabilities | null;
  status: AssetStatus;
  identity: SourceIdentity;
}>;

export type RhjQuote = Readonly<{
  tokenSymbol: string;
  deployments: readonly Deployment[];
  bid: string;
  ask: string;
  currency: string;
  /** `null` when the provider sent `"0"`, which it documents as *unavailable*. */
  dailyTradingVolume: string | null;
  isTradingHalt: boolean;
  generatedAt: string;
  identity: SourceIdentity;
}>;

export type ProcessDate = Readonly<{ year: number; month: number; day: number }>;

export type RhjCorporateAction = Readonly<{
  id: string;
  type: CorporateActionType;
  status: CorporateActionStatus;
  /** `null` on an in-progress row with no scheduled date. Never today's date. */
  processDate: ProcessDate | null;
  tokenSymbol: string;
  deployments: readonly Deployment[];
  detailsKey: string | null;
  details: Readonly<Record<string, unknown>> | null;
  identity: SourceIdentity;
}>;

export type ParseResult<T> = Readonly<{
  rows: readonly T[];
  /** One line per row that could not be trusted, naming what was wrong with it. */
  dropped: readonly string[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Exact decimal text only. A number arriving as a JSON float is refused, not coerced. */
function decimalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^-?\d+(\.\d+)?$/.test(value) ? value : null;
}

function parseDeployments(value: unknown): readonly Deployment[] {
  if (!Array.isArray(value)) return [];
  const out: Deployment[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const contractAddress = str(entry.contractAddress);
    const chainId = entry.chainId;
    if (contractAddress === null || typeof chainId !== "number" || !Number.isInteger(chainId)) continue;
    out.push(Object.freeze({ contractAddress, chainId }));
  }
  return Object.freeze(out);
}

/**
 * A sub-field is absent (`undefined`) or unset (`null`) → `null`.
 * Anything else the provider sends, including `""`, is carried through verbatim,
 * because the provider assigns `""` its own meaning on `allDayTradability`.
 */
function tradabilityField(value: unknown): TradabilityField {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : null;
}

function parseTradingCapabilities(value: unknown): TradingCapabilities | null {
  if (!isRecord(value)) return null;
  const extended = value.extendedHoursFractionalTradability;
  return Object.freeze({
    fractionalTradability: tradabilityField(value.fractionalTradability),
    allDayTradability: tradabilityField(value.allDayTradability),
    extendedHoursFractionalTradability: typeof extended === "boolean" ? extended : null,
  });
}

function productTypeOf(tokenName: string): ProductType {
  /* The API does not distinguish an ETF token from a stock token, and this
     product will not guess one from a ticker. Both are `STOCK_TOKEN` — a
     tokenized debt security issued by RHJ — which is what they legally are. */
  void tokenName;
  return "STOCK_TOKEN";
}

export type ParseContext = Readonly<{
  receivedAt: string;
  dataRightsState: DataRightsState;
  maxAgeSeconds: number;
}>;

/** `GET /rhj/assets` → asset metadata, the multiplier, and per-chain deployments. */
export function parseAssets(payload: unknown, context: ParseContext): ParseResult<RhjAsset> {
  const rows: RhjAsset[] = [];
  const dropped: string[] = [];
  const list = isRecord(payload) ? payload.assets : undefined;
  if (!Array.isArray(list)) {
    return { rows: [], dropped: ["the response has no `assets` array"] };
  }

  for (const [index, entry] of list.entries()) {
    if (!isRecord(entry)) {
      dropped.push(`assets[${index}] is not an object`);
      continue;
    }
    const id = str(entry.id);
    const tokenSymbol = str(entry.tokenSymbol);
    const currentMultiplier = decimalText(entry.currentMultiplier);
    const statusText = str(entry.status);
    if (id === null || tokenSymbol === null) {
      dropped.push(`assets[${index}] has no id or tokenSymbol`);
      continue;
    }
    if (currentMultiplier === null) {
      /* Without the multiplier nothing on this asset can be compared across
         bases, so the row is dropped rather than carried with a hole that a
         later caller would fill with 1.0. */
      dropped.push(`${tokenSymbol}: currentMultiplier is not exact decimal text`);
      continue;
    }
    const status = (ASSET_STATUSES as readonly string[]).includes(statusText ?? "")
      ? (statusText as AssetStatus)
      : "ASSET_STATUS_UNSPECIFIED";

    const pendingRaw = entry.pendingMultiplier;
    /* `""` is the documented "nothing pending". Anything else must still be an
       exact decimal or it is not a multiplier we will act on. */
    const pendingMultiplier =
      pendingRaw === "" || pendingRaw === undefined || pendingRaw === null ? null : decimalText(pendingRaw);

    rows.push(
      Object.freeze({
        id,
        tokenSymbol,
        tokenName: str(entry.tokenName) ?? tokenSymbol,
        deployments: parseDeployments(entry.deployments),
        currentMultiplier,
        pendingMultiplier,
        pendingMultiplierEffectiveTime: str(entry.pendingMultiplierEffectiveTime),
        logoUrl: str(entry.logoUrl),
        tradingCapabilities: parseTradingCapabilities(entry.tradingCapabilities),
        status,
        identity: rhjIdentity({
          surfaceId: RHJ_SURFACES.assets,
          instrumentId: tokenSymbol,
          productType: productTypeOf(str(entry.tokenName) ?? ""),
          /* Asset metadata is not a price. It gets no role rather than a
             default one, so nothing can pick it up and compare it. */
          priceRole: null,
          /* The endpoint carries no timestamp field at all. */
          observedAt: null,
          receivedAt: context.receivedAt,
          dataRightsState: context.dataRightsState,
          maxAgeSeconds: context.maxAgeSeconds,
        }),
      }),
    );
  }
  return { rows: Object.freeze(rows), dropped: Object.freeze(dropped) };
}

/** `GET /rhj/prices/{symbol}` → raw underlying-equity bid/ask. Never multiplier-adjusted. */
export function parsePrices(payload: unknown, context: ParseContext): ParseResult<RhjQuote> {
  const rows: RhjQuote[] = [];
  const dropped: string[] = [];
  const list = isRecord(payload) ? payload.quotes : undefined;
  if (!Array.isArray(list)) {
    return { rows: [], dropped: ["the response has no `quotes` array"] };
  }

  for (const [index, entry] of list.entries()) {
    if (!isRecord(entry)) {
      dropped.push(`quotes[${index}] is not an object`);
      continue;
    }
    const tokenSymbol = str(entry.tokenSymbol);
    const bid = decimalText(entry.bid);
    const ask = decimalText(entry.ask);
    const generatedAt = str(entry.generatedAt);
    if (tokenSymbol === null) {
      dropped.push(`quotes[${index}] has no tokenSymbol`);
      continue;
    }
    if (bid === null || ask === null) {
      dropped.push(`${tokenSymbol}: bid or ask is not exact decimal text`);
      continue;
    }
    if (generatedAt === null) {
      /* `generatedAt` is the only freshness this API gives. A quote without it
         cannot be aged, and an unageable price on a monitoring surface is worse
         than an absent one. */
      dropped.push(`${tokenSymbol}: no generatedAt, so the quote cannot be aged`);
      continue;
    }
    const volumeText = decimalText(entry.dailyTradingVolume);

    rows.push(
      Object.freeze({
        tokenSymbol,
        deployments: parseDeployments(entry.deployments),
        bid,
        ask,
        currency: str(entry.currency) ?? "USD",
        /* Documented: `"0"` means unavailable. It becomes absence, not zero. */
        dailyTradingVolume: volumeText === null || /^-?0(\.0+)?$/.test(volumeText) ? null : volumeText,
        isTradingHalt: entry.isTradingHalt === true,
        generatedAt,
        identity: rhjIdentity({
          surfaceId: RHJ_SURFACES.prices,
          instrumentId: tokenSymbol,
          productType: "STOCK_TOKEN",
          /* The provider states it plainly: this is the raw underlying equity
             passed through as-is. That is a REFERENCE and never an EXECUTABLE. */
          priceRole: "REFERENCE",
          observedAt: generatedAt,
          receivedAt: context.receivedAt,
          dataRightsState: context.dataRightsState,
          maxAgeSeconds: context.maxAgeSeconds,
        }),
      }),
    );
  }
  return { rows: Object.freeze(rows), dropped: Object.freeze(dropped) };
}

/** `GET /rhj/corporate-actions` → processed actions, most-recent `processDate` first. */
export function parseCorporateActions(
  payload: unknown,
  context: ParseContext,
): ParseResult<RhjCorporateAction> {
  const rows: RhjCorporateAction[] = [];
  const dropped: string[] = [];
  const list = isRecord(payload) ? payload.corpActions : undefined;
  if (!Array.isArray(list)) {
    return { rows: [], dropped: ["the response has no `corpActions` array"] };
  }

  for (const [index, entry] of list.entries()) {
    if (!isRecord(entry)) {
      dropped.push(`corpActions[${index}] is not an object`);
      continue;
    }
    const id = str(entry.id);
    const tokenSymbol = str(entry.tokenSymbol);
    const typeText = str(entry.type);
    const statusText = str(entry.status);
    if (id === null || tokenSymbol === null) {
      dropped.push(`corpActions[${index}] has no id or tokenSymbol`);
      continue;
    }
    if (!(CORPORATE_ACTION_TYPES as readonly string[]).includes(typeText ?? "")) {
      /* A type this build has never heard of is dropped with its literal value
         rather than mapped to UNSPECIFIED, because the provider may add one and
         a silently-unspecified corporate action is a silently-missed one. */
      dropped.push(`${tokenSymbol}: unknown corporate action type ${JSON.stringify(typeText)}`);
      continue;
    }
    const type = typeText as CorporateActionType;
    const status = (CORPORATE_ACTION_STATUSES as readonly string[]).includes(statusText ?? "")
      ? (statusText as CorporateActionStatus)
      : "CORPORATE_ACTION_STATUS_UNSPECIFIED";

    const detailsKey = DETAILS_KEY_BY_TYPE[type];
    const detailsRoot = isRecord(entry.details) ? entry.details : null;
    const details =
      detailsKey !== null && detailsRoot !== null && isRecord(detailsRoot[detailsKey])
        ? (detailsRoot[detailsKey] as Record<string, unknown>)
        : null;

    rows.push(
      Object.freeze({
        id,
        type,
        status,
        processDate: parseProcessDate(entry.processDate),
        tokenSymbol,
        deployments: parseDeployments(entry.deployments),
        detailsKey,
        details: details === null ? null : Object.freeze({ ...details }),
        identity: rhjIdentity({
          surfaceId: RHJ_SURFACES.corporateActions,
          instrumentId: tokenSymbol,
          productType: "STOCK_TOKEN",
          priceRole: null,
          /* `processDate` is a scheduling date, not an observation time, and the
             provider says so. It is never promoted into `observedAt`. */
          observedAt: null,
          receivedAt: context.receivedAt,
          dataRightsState: context.dataRightsState,
          maxAgeSeconds: context.maxAgeSeconds,
        }),
      }),
    );
  }
  return { rows: Object.freeze(rows), dropped: Object.freeze(dropped) };
}

function parseProcessDate(value: unknown): ProcessDate | null {
  if (!isRecord(value)) return null;
  const { year, month, day } = value;
  if (typeof year !== "number" || !Number.isInteger(year) || year < 1900) return null;
  const m = typeof month === "number" && Number.isInteger(month) ? month : 0;
  const d = typeof day === "number" && Number.isInteger(day) ? day : 0;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return Object.freeze({ year, month: m, day: d });
}

/** `YYYY-MM-DD`, or `null` when there is no scheduled date. Never substituted. */
export function processDateText(date: ProcessDate | null): string | null {
  if (date === null) return null;
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}
