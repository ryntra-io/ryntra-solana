/**
 * Source identity for a direct Robinhood read — and the reason a price carries
 * a *role* rather than a name.
 *
 * **Every observation says where it came from.** Not as a label appended for
 * display, but as a structure the observation cannot exist without. An
 * observation whose origin is optional is one refactor away from being a number
 * with no provenance, and this product's whole claim is that it never has one.
 *
 * **`priceRole` is the load-bearing field.** Robinhood publishes two figures for
 * the same instrument that are not the same quantity:
 *
 *   - `GET /rhj/prices/{symbol}` returns the **raw underlying-equity** bid/ask,
 *     explicitly *not* multiplier-adjusted. That is a `REFERENCE`.
 *   - The onchain Chainlink feed returns the **multiplier-adjusted** value —
 *     the token, not the share. That is an `ORACLE`.
 *
 * Their provider's own documentation says it in one sentence: *"If you mix the
 * two, apply currentMultiplier from /assets to convert."* A product that stores
 * both under one field called `price` will eventually average them, and after a
 * 4:1 split the error is 300%. So the role is part of the type, `comparePrices`
 * refuses a pair whose bases disagree, and there is no code path that produces
 * a single blended figure.
 *
 * **Freshness is only ever as precise as the source allows.** `/prices` carries
 * `generatedAt` and a published 15-second cache window, so it can be measured.
 * `/assets` and `/corporate-actions` carry **no timestamp field at all**, and
 * `/assets` publishes no cache window either — the documentation states one for
 * `/prices` (15s) and one for `/corporate-actions` (1 hour) and none for
 * `/assets`. Those become `observedAt: null`, `cacheWindow: null` and
 * `freshnessState: "UNKNOWN"` rather than a plausible default. Inventing
 * staleness precision a REST endpoint does not give is the exact defect
 * `rwa-risk-signals` names second on its honesty list.
 */

/** Where a figure sits relative to the thing it measures. Never averaged. */
export const PRICE_ROLES = ["REFERENCE", "ORACLE", "EXECUTABLE", "MARK", "INDEX"] as const;

export type PriceRole = (typeof PRICE_ROLES)[number];

/**
 * What the figure is denominated in, which is *not* the same question as which
 * role it plays. A REFERENCE quote on the raw underlying and an ORACLE reading
 * on the token are both prices of "AAPL" and are different quantities.
 */
export const PRICE_BASES = ["UNDERLYING_SHARE", "TOKEN"] as const;

export type PriceBasis = (typeof PRICE_BASES)[number];

/** The role→basis map is fixed by the provider's contract, not by a caller. */
const ROLE_BASIS: Readonly<Record<PriceRole, PriceBasis>> = {
  /* The REST endpoint passes the underlying equity's bid/ask through as-is. */
  REFERENCE: "UNDERLYING_SHARE",
  /* Chainlink stock feeds on Robinhood Chain are multiplier-adjusted. */
  ORACLE: "TOKEN",
  /* A venue quote is for the token that actually changes hands. */
  EXECUTABLE: "TOKEN",
  /* A perp mark references the token's market. */
  MARK: "TOKEN",
  /* An index level is a composite; it is never an instrument price. */
  INDEX: "TOKEN",
};

export function basisOf(role: PriceRole): PriceBasis {
  return ROLE_BASIS[role];
}

export const PRODUCT_TYPES = [
  "STOCK_TOKEN",
  "ETF_TOKEN",
  "UNDERLYING_EQUITY",
  "CRYPTO",
  "STABLECOIN",
] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];

/**
 * How close the source is to the fact.
 *
 * `ISSUER` is RHJ stating something about its own instrument; `VENUE` is a
 * market reporting its own book; `ORACLE` is a feed contract; `DERIVED` is
 * arithmetic this product did over other observations, which is never promoted
 * to a source in its own right.
 */
export const AUTHORITATIVENESS = ["ISSUER", "VENUE", "ORACLE", "DERIVED"] as const;

export type Authoritativeness = (typeof AUTHORITATIVENESS)[number];

/**
 * `WITHIN_CACHE` is a real, separate answer from `FRESH`: the provider caches
 * these endpoints and says so, so a reading inside its published window is
 * current-as-designed rather than either live or stale.
 */
export const FRESHNESS_STATES = ["FRESH", "WITHIN_CACHE", "STALE", "UNKNOWN"] as const;

export type FreshnessState = (typeof FRESHNESS_STATES)[number];

/**
 * What the provider allowed, as the provider answered it.
 *
 * `JURISDICTION_BLOCKED` exists because it is the answer this environment
 * actually receives. It is recorded as the venue's own decision and shown as
 * such — never predicted, never simulated, and never routed around.
 */
export const DATA_RIGHTS_STATES = [
  "PUBLIC_READ",
  "JURISDICTION_BLOCKED",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "UNKNOWN",
] as const;

export type DataRightsState = (typeof DATA_RIGHTS_STATES)[number];

export type SourceIdentity = Readonly<{
  ecosystemId: string;
  networkId: string | null;
  /** Absent for an issuer read: RHJ is not a venue and pretending otherwise would rank it as one. */
  venueId: string | null;
  providerId: string;
  surfaceId: string;
  /** `null` only for an observation about the source itself rather than an instrument. */
  instrumentId: string | null;
  productType: ProductType;
  /** `null` when the observation is not a price at all. A status is not a price with no role. */
  priceRole: PriceRole | null;
  authoritativeness: Authoritativeness;
  /** What the source says about when it observed. `null` when the source states nothing. */
  observedAt: string | null;
  /** When this process received it. Always known, always separate from `observedAt`. */
  receivedAt: string;
  /** Published cache window in seconds. `null` when the provider publishes none. */
  cacheWindow: number | null;
  freshnessState: FreshnessState;
  dataRightsState: DataRightsState;
}>;

/** The three surfaces this module reads, and the two windows their docs publish. */
export const RHJ_PROVIDER_ID = "robinhood-rhj";
export const RHJ_ECOSYSTEM_ID = "robinhood-chain";
export const RHJ_NETWORK_ID = "robinhood-chain-4663";

export const RHJ_SURFACES = {
  assets: "rhj-assets",
  prices: "rhj-prices",
  corporateActions: "rhj-corporate-actions",
} as const;

export type RhjSurfaceId = (typeof RHJ_SURFACES)[keyof typeof RHJ_SURFACES];

/**
 * Published cache windows, in seconds.
 *
 * `assets` is `null` on purpose and a test pins it there. The provider's page
 * carries a Cache/Rate-Limit table for `/prices` and `/corporate-actions` and
 * none for `/assets`, while stating that every endpoint is cached. So the
 * honest record is *cached, window not published* — which is a different fact
 * from 15 seconds and a different fact from uncached.
 */
export const RHJ_CACHE_WINDOW_SECONDS: Readonly<Record<RhjSurfaceId, number | null>> = {
  "rhj-assets": null,
  "rhj-prices": 15,
  "rhj-corporate-actions": 3_600,
};

/** Documented ceiling, shared by all three endpoints. */
export const RHJ_RATE_LIMIT_PER_SECOND = 60;

function isIsoInstant(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

/**
 * Freshness from what the source actually stated.
 *
 * No `observedAt` means `UNKNOWN`, whatever the cache window says — a window
 * without a timestamp bounds nothing. A reading inside the window is
 * `WITHIN_CACHE` rather than `FRESH`, because the provider itself says these
 * responses are served from a cache; calling that "fresh" would overstate a
 * figure the provider never claimed was live.
 */
export function freshnessOf(input: Readonly<{
  observedAt: string | null;
  receivedAt: string;
  cacheWindow: number | null;
  maxAgeSeconds: number;
}>): FreshnessState {
  const { observedAt, receivedAt, cacheWindow, maxAgeSeconds } = input;
  if (observedAt === null) return "UNKNOWN";
  if (!isIsoInstant(observedAt) || !isIsoInstant(receivedAt)) return "UNKNOWN";

  const ageSeconds = (Date.parse(receivedAt) - Date.parse(observedAt)) / 1000;
  /* A source dated after we received it is not fresh, it is unexplained. */
  if (ageSeconds < 0) return "UNKNOWN";
  if (ageSeconds > maxAgeSeconds) return "STALE";
  if (cacheWindow !== null && ageSeconds <= cacheWindow) return "WITHIN_CACHE";
  return "FRESH";
}

export type IdentityInput = Readonly<{
  surfaceId: RhjSurfaceId;
  instrumentId: string | null;
  productType: ProductType;
  priceRole: PriceRole | null;
  observedAt: string | null;
  receivedAt: string;
  dataRightsState: DataRightsState;
  maxAgeSeconds: number;
  venueId?: string | null;
}>;

/**
 * The only constructor. Every field is filled here or the observation does not
 * exist — which is what makes "every observation carries its identity" a
 * structural property rather than a habit.
 */
export function rhjIdentity(input: IdentityInput): SourceIdentity {
  const cacheWindow = RHJ_CACHE_WINDOW_SECONDS[input.surfaceId];
  return Object.freeze({
    ecosystemId: RHJ_ECOSYSTEM_ID,
    networkId: RHJ_NETWORK_ID,
    /* RHJ is the issuer. A read of its API is not a venue quote and must not be
       ranked beside one, so `venueId` stays null unless a caller names a venue. */
    venueId: input.venueId ?? null,
    providerId: RHJ_PROVIDER_ID,
    surfaceId: input.surfaceId,
    instrumentId: input.instrumentId,
    productType: input.productType,
    priceRole: input.priceRole,
    authoritativeness: "ISSUER",
    observedAt: input.observedAt,
    receivedAt: input.receivedAt,
    cacheWindow,
    freshnessState: freshnessOf({
      observedAt: input.observedAt,
      receivedAt: input.receivedAt,
      cacheWindow,
      maxAgeSeconds: input.maxAgeSeconds,
    }),
    dataRightsState: input.dataRightsState,
  });
}

/** Every field a `SourceIdentity` must carry, as data, so a test can assert the shape. */
export const SOURCE_IDENTITY_FIELDS = [
  "ecosystemId",
  "networkId",
  "venueId",
  "providerId",
  "surfaceId",
  "instrumentId",
  "productType",
  "priceRole",
  "authoritativeness",
  "observedAt",
  "receivedAt",
  "cacheWindow",
  "freshnessState",
  "dataRightsState",
] as const;
