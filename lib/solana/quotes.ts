/**
 * Jupiter Swap API V2 quote/order/execute boundary.
 *
 * Production is keyed and fail-closed. Keyless access is reachable only when
 * the caller explicitly selects the labelled degraded mode; a failed keyed
 * request is never retried against another access tier. A quote asks `/order`
 * without a taker, so that response is quote-only and any returned transaction
 * is refused. Execution adds the taker order (`fetchJupiterExecutableOrder`,
 * which returns a signable transaction) and the one-shot `/execute` client
 * (`executeJupiterOrder`). The execute client never retries: once the POST may
 * have left the process, every failure is reported as possibly submitted and
 * the caller recovers by signature through an independent chain read — never
 * by calling `/execute` again. `/build` — the router lane fee policy v2 takes
 * for most flows — lives in `jupiter-build.ts` and returns the same order
 * shape with `path: "BUILD_SUBMIT"`: bytes this deployment assembled from
 * Jupiter's instructions, never sent to `/execute`.
 */

import {
  serviceFeeNotApplied,
  serviceFeeQuoted,
  serviceFeeUnconfigured,
  type RyntraServiceFee,
} from "../swap/service-fee.ts";
import type { EvidenceSource } from "./evidence.ts";

import { JUPITER_ORDER_RETRY_WAIT_MAX_MS, jupiterRetryWaitMs, noteJupiterResponse } from "./jupiter-budget.ts";

export const JUPITER_SWAP_V2_BASE_URL = "https://api.jup.ag/swap/v2";
const MAX_JUPITER_ORDER_BYTES = 512 * 1024;
export const MAX_ROUTE_HOPS = 32;
const MAX_PROVIDER_TEXT = 256;

/**
 * How long a built order stays signable.
 *
 * This was 15 seconds, and 15 seconds is not a review window — it is a
 * countdown a person cannot win. Someone read the Review panel, pressed
 * the button, answered the wallet, and the window had already closed: the card
 * showed ORDER_EXPIRED before the wallet came back. Nothing in the signing
 * path is even bounded by it, because `withWalletPromptTimeout` in
 * `wallet.client.ts` wraps `connect()` and never `signTransaction` — the human
 * takes as long as they take, against a clock that had already started when
 * the order was built and while they were still reading.
 *
 * This is the Review's reading window, not the bytes' life. The bytes live as
 * long as the blockhash the provider built with: 150 blocks, which since
 * mainnet slots became 200 ms (measured 2026-10-17) is about thirty seconds,
 * part of it already spent by Jupiter. AG-1 keeps the two apart: the person
 * reads at their own pace for this window, and the order route says how long
 * the bytes may still be signed (`signableMs`, from `lastValidBlockHeight` and
 * the block height read through `getEpochInfo` — never `getBlockHeight`, which
 * the default public endpoint answers with its slot, about 22 million too
 * high; `blockhash-life.ts`). A Review signed later gets fresh bytes at the
 * moment of signing, and the wallet opens on them only when the minimum and
 * every fee are no worse (`freshOrderNoWorse`).
 *
 * 45 seconds, under the 60-second ceiling the normalizer enforces below.
 * `swap-freshness.test.mjs` fails the build if this ever drops below what a
 * person can read inside — the fix for short bytes is fresh bytes, never a
 * shorter Review.
 */
export const JUPITER_ORDER_REVIEW_WINDOW_MS = 45_000;

/**
 * The smallest window a person could plausibly answer a wallet inside.
 *
 * Not a target — a floor, so the constant above can be tuned without anyone
 * re-creating the failure it was raised for.
 */
export const MINIMUM_HUMAN_REVIEW_WINDOW_MS = 30_000;

export const JUPITER_ENV_OVERRIDES = {
  apiKey: "RYNTRA_JUPITER_API_KEY",
} as const;

export type JupiterTier = "lite" | "pro";
export type JupiterSwapAccess = "production" | "degraded";

/** Tokens/Price keep their own honest fallback; this is not the swap contract. */
export type JupiterCatalogEndpoint = Readonly<{
  tier: JupiterTier;
  apiKey: string | null;
}>;

export function resolveJupiterCatalogEndpoint(): JupiterCatalogEndpoint {
  const apiKey = process.env[JUPITER_ENV_OVERRIDES.apiKey]?.trim() || null;
  return { tier: apiKey ? "pro" : "lite", apiKey };
}

export type JupiterSwapEndpointFailure = Readonly<{
  ok: false;
  code: "PRODUCTION_KEY_REQUIRED";
  reason: string;
}>;

export type JupiterSwapEndpoint = Readonly<{
  ok: true;
  access: JupiterSwapAccess;
  tier: JupiterTier;
  baseUrl: typeof JUPITER_SWAP_V2_BASE_URL;
  orderUrl: `${typeof JUPITER_SWAP_V2_BASE_URL}/order`;
  buildUrl: `${typeof JUPITER_SWAP_V2_BASE_URL}/build`;
  executeUrl: `${typeof JUPITER_SWAP_V2_BASE_URL}/execute`;
  label: string;
  /** The key lives only in this closure, never in serializable endpoint state. */
  authorizationHeaders(): Readonly<Record<string, string>>;
}>;

export type JupiterSwapEndpointSelection = JupiterSwapEndpoint | JupiterSwapEndpointFailure;

export function resolveJupiterSwapEndpoint(
  options: Readonly<{ access?: JupiterSwapAccess; apiKey?: string | null }> = {},
): JupiterSwapEndpointSelection {
  const access = options.access ?? "production";
  if (access === "degraded") {
    return {
      ok: true,
      access,
      tier: "lite",
      baseUrl: JUPITER_SWAP_V2_BASE_URL,
      orderUrl: `${JUPITER_SWAP_V2_BASE_URL}/order`,
      buildUrl: `${JUPITER_SWAP_V2_BASE_URL}/build`,
      executeUrl: `${JUPITER_SWAP_V2_BASE_URL}/execute`,
      label: "Jupiter Swap API V2 · explicit keyless degraded access",
      authorizationHeaders: () => ({}),
    };
  }

  const apiKey = options.apiKey === undefined
    ? process.env[JUPITER_ENV_OVERRIDES.apiKey]?.trim() || null
    : options.apiKey?.trim() || null;
  if (!apiKey) {
    return {
      ok: false,
      code: "PRODUCTION_KEY_REQUIRED",
      reason:
        "Jupiter production access is not configured. Add RYNTRA_JUPITER_API_KEY or explicitly choose the labelled keyless fallback.",
    };
  }

  return {
    ok: true,
    access,
    tier: "pro",
    baseUrl: JUPITER_SWAP_V2_BASE_URL,
    orderUrl: `${JUPITER_SWAP_V2_BASE_URL}/order`,
    buildUrl: `${JUPITER_SWAP_V2_BASE_URL}/build`,
    executeUrl: `${JUPITER_SWAP_V2_BASE_URL}/execute`,
    label: "Jupiter Swap API V2 · keyed production access",
    authorizationHeaders: () => ({ "x-api-key": apiKey }),
  };
}

/**
 * Ryntra's integrator fee on a Jupiter order, or nothing.
 *
 * Both fields go on the wire together or neither does — `referralAccount`
 * without `referralFee` is not a smaller fee, it is a malformed request. The
 * caller resolves this once from configuration; this module never reads the
 * environment.
 *
 * ## Two documented consequences a caller must know about
 *
 * 1. **`mode` becomes `manual`.** Any optional parameter does that. What it does
 *    *not* do is narrow the router set: Jupiter's own routing-impact matrix
 *    marks `referralAccount` & `referralFee` as `Yes` for Metis, JupiterZ, Dflow
 *    and OKX alike — only `payer` disables the last three, and this lane never
 *    sends `payer`. So the fee costs a label, not a price.
 * 2. **Jupiter's gas sponsorship stops firing.** With referral fees set, the
 *    taker pays their own signature, priority and output-account rent. That is a
 *    real cost moved onto the person, it is stated in the response's own fee
 *    fields, and the surface shows it there rather than in a footnote.
 */
export type JupiterReferral = Readonly<{
  /** Base58 referral account created against Jupiter's Ultra referral project. */
  account: string;
  /** Basis points, 50–255 per Jupiter's documented range. */
  feeBps: number;
}>;

export type JupiterOrderRequest = Readonly<{
  inputMint: string;
  outputMint: string;
  /** Raw base units of the input mint. */
  amountRaw: string;
  /** Ryntra's fee. Absent or null asks for no fee and says so in `ryntraFee`. */
  referral?: JupiterReferral | null;
  /**
   * Routers this request may not use.
   *
   * Set by the caller only to re-ask after a router answered with a quote that
   * did not agree with itself. `excludeRouters` takes a comma-separated list and
   * refuses cleanly with HTTP 400 when every router is excluded (checked live,
   * 2026-09-10), so a route that genuinely cannot be served fails as a route
   * rather than as a silence.
   */
  excludeRouters?: readonly string[];
}>;

export type JupiterRouteHop = Readonly<{
  ammKey: string;
  label: string;
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  outAmountRaw: string;
  basisPoints: number;
}>;

export type JupiterOrderQuote = Readonly<{
  schema: "ryntra.solana.jupiter-order-quote";
  schemaVersion: "1.0.0";
  provider: "jupiter";
  /** `/order` priced and built it and `/execute` lands it; or `/build` gave the instructions and this deployment assembled and sends the bytes. */
  path: JupiterSwapPath;
  access: JupiterSwapAccess;
  tier: JupiterTier;
  execution: "NOT_EXECUTED";
  swapType: string;
  swapMode: string;
  router: string;
  mode: string;
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  outAmountRaw: string;
  minReceivedRaw: string;
  slippageBps: number;
  priceImpactPct: string;
  inUsdValue: string | null;
  outUsdValue: string | null;
  swapUsdValue: string | null;
  totalFeeBasisPoints: number;
  totalFeeMint: string;
  platformFee: Readonly<{ basisPoints: number; mint: string; amountRaw: string | null }>;
  /** `/order` does not separately quote a route/provider amount. Never infer it. */
  providerFee: Readonly<{ basisPoints: null; mint: null; amountRaw: null }>;
  /**
   * Ryntra's service fee — 50 bps on Jupiter, `RYNTRA_SERVICE_FEE_POLICY` —
   * as Jupiter's own answer states it.
   *
   * This was a hard-coded zero for as long as this lane sent no referral
   * parameters. It is now read from the response, and the read is deliberately
   * narrow — see `readJupiterServiceFee`.
   */
  ryntraFee: RyntraServiceFee;
  /**
   * The referral account Jupiter says it used, echoed straight back.
   *
   * This is the one field that decides whether the fee exists, so it is carried
   * separately from the interpretation of it.
   */
  providerReferralAccount: string | null;
  /**
   * `/build` only: the fee wallet and the canonical token account the fee is
   * paid into, named in the bytes. Absent — not null — on `/order`, so a
   * Review sealed before this field existed hashes as it always did.
   */
  ryntraFeeAccount?: Readonly<{ owner: string; account: string }>;
  signatureFeeLamports: string;
  signatureFeePayer: string | null;
  priorityFeeLamports: string;
  priorityFeePayer: string | null;
  rentFeeLamports: string;
  rentFeePayer: string | null;
  gasless: boolean;
  guaranteedPrice: boolean;
  jitOptimized: boolean;
  route: readonly JupiterRouteHop[];
  routeAffectingOptions: readonly string[];
  requestId: string;
  taker: null;
  transactionBase64: null;
  providerExpiresAt: string | null;
  reviewExpiresAt: string;
  latencyMs: number;
  observedAt: string;
  source: EvidenceSource;
}>;

export const JUPITER_SWAP_PATHS = ["ORDER_EXECUTE", "BUILD_SUBMIT"] as const;
export type JupiterSwapPath = (typeof JUPITER_SWAP_PATHS)[number];

export type JupiterOrderFailure = Readonly<{
  ok: false;
  code:
    | "PRODUCTION_KEY_REQUIRED"
    | "NO_ROUTE"
    | "REFUSED"
    | "RATE_LIMITED"
    | "HTTP_ERROR"
    | "UNREACHABLE"
    | "MALFORMED"
    /** The quote did not agree with itself and no other router answered better. */
    | "IMPLAUSIBLE_QUOTE";
  errorCode: string | null;
  status: number | null;
  reason: string;
  access: JupiterSwapAccess | null;
  /**
   * On `RATE_LIMITED` only: the provider's own pause when it is short enough
   * to be worth a single bounded wait on a read that moves nothing; null when
   * the window resets later than that, or the provider did not say. Never set
   * on any other refusal, and never read by the execute path.
   */
  retryWaitMs?: number | null;
}>;

export type JupiterOrderResult = Readonly<{ ok: true; order: JupiterOrderQuote }> | JupiterOrderFailure;

export const NO_ROUTE_CODES: ReadonlySet<string> = new Set([
  "COULD_NOT_FIND_ANY_ROUTE",
  "NO_ROUTES_FOUND",
  "ROUTE_PLAN_DOES_NOT_CONSUME_ALL_THE_AMOUNT",
]);

export function asText(value: unknown, field: string, maxLength = MAX_PROVIDER_TEXT): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`${field} is missing or outside its text bound.`);
  }
  return value;
}

export function asOptionalText(value: unknown, field: string, maxLength = MAX_PROVIDER_TEXT): string | null {
  if (value === null || value === undefined) return null;
  return asText(value, field, maxLength);
}

export function asAmount(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new Error(`${field} is not a raw unsigned amount string.`);
  }
  return value;
}

function asIntegerAmount(value: unknown, field: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return asAmount(value, field);
}

export function asInteger(value: unknown, field: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${field} is not a bounded non-negative integer.`);
  }
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} is not boolean.`);
  return value;
}

export function asNumericText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.length > 0 && value.length <= 128) return value;
  throw new Error(`${field} is not a bounded numeric value.`);
}

export function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function asOptionalInstant(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  let instant: Date;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${field} is not a valid instant.`);
    instant = new Date(value > 1e12 ? value : value * 1000);
  } else {
    const text = asText(value, field, 64);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) {
      throw new Error(`${field} requires an explicit UTC or offset RFC3339 instant.`);
    }
    instant = new Date(text);
  }
  if (!Number.isFinite(instant.getTime())) throw new Error(`${field} is not a valid instant.`);
  return instant.toISOString();
}

function earlierInstant(left: string, right: string | null): string {
  if (!right) return left;
  return Date.parse(right) < Date.parse(left) ? right : left;
}

type JupiterOrderNormalizeMeta = Readonly<{
  access: JupiterSwapAccess;
  latencyMs: number;
  observedAt: string;
  reviewWindowMs: number;
  sourceHost: string;
  routeAffectingOptions: readonly string[];
  /** What was asked for, so the answer can be checked against it rather than believed. */
  referral?: JupiterReferral | null;
  /** Why a configured referral was kept off the wire, when it was. */
  referralDropped?: JupiterReferralDrop | null;
}>;

/**
 * Jupiter's documented share of an integrator fee. Twenty per cent of the gross,
 * before anything reaches the referral token account.
 */
export const JUPITER_REFERRAL_PROVIDER_SHARE_PERCENT = 20;

/**
 * Ryntra's fee, read out of Jupiter's answer — and the reading is deliberately
 * narrow, because every wider reading would claim money in a case where Jupiter
 * documents that none is taken.
 *
 * `referralAccount` echoed back is the load-bearing signal. Jupiter states it in
 * the response "if set", and the failure mode it detects is the documented one:
 * *if the `referralTokenAccount` for the fee mint is not initialised, the order
 * still returns and executes without the integrator's fee.* A swap that works
 * and earns nothing is the normal shape of that mistake, so an unechoed account
 * is `NOT_APPLIED` rather than a quiet zero.
 *
 * A total `feeBps` **below** what was asked for is Jupiter's documented fallback
 * to its own platform fee, and is reported as not applied. Verified live on
 * 2026-09-10 against `api.jup.ag`: 1 SOL → USDC came back `feeBps: 2` with no
 * referral and `feeBps: 50` with one, `platformFee.feeBps` mirroring the total
 * in both cases — so an active referral **replaces** Jupiter's platform fee
 * rather than stacking on it, and the top-level total is the right thing to
 * compare against.
 *
 * ## The amount is not in this answer, and is not invented here
 *
 * Jupiter's documentation shows `platformFee.amount`; the live API returns no
 * `amount` key at all, with or without a `taker` (checked both ways, same day).
 * So a quote states the **rate and the mint** and nothing else, and that is what
 * a Review shows. The amount arrives later and from the chain: a V2 referral
 * token account is a plain ATA whose authority is the referral account, so the
 * fee lands as an ordinary token-balance movement that `observeSwap` reads back
 * exactly. Estimating it from the rate is the one thing this must not do.
 */
function readJupiterServiceFee(
  raw: Record<string, unknown>,
  requested: JupiterReferral | null,
  stated: Readonly<{ totalFeeBasisPoints: number; totalFeeMint: string; platformFeeAmountRaw: string | null }>,
  dropped: JupiterReferralDrop | null = null,
): Readonly<{ fee: RyntraServiceFee; providerReferralAccount: string | null }> {
  const providerReferralAccount = asOptionalText(raw.referralAccount, "referralAccount", 44);
  if (!requested) {
    if (dropped === "BELOW_PROVIDER_MINIMUM") {
      return {
        providerReferralAccount,
        fee: serviceFeeNotApplied(
          "JUPITER_REFERRAL",
          `Jupiter's minimum referral fee is ${JUPITER_REFERRAL_FEE_MIN_BPS} bps and Ryntra's rate for this flow is lower, so no fee is requested on this route. The swap still executes.`,
        ),
      };
    }
    return {
      providerReferralAccount,
      fee: serviceFeeUnconfigured("JUPITER_REFERRAL", "No Jupiter referral account is configured, so no integrator fee was requested."),
    };
  }
  if (providerReferralAccount !== requested.account) {
    return {
      providerReferralAccount,
      fee: serviceFeeNotApplied(
        "JUPITER_REFERRAL",
        `Jupiter did not apply the referral account on this order; the referral token account for ${stated.totalFeeMint} is most likely not initialised. The swap still executes.`,
        requested.feeBps,
      ),
    };
  }
  if (stated.totalFeeBasisPoints < requested.feeBps) {
    return {
      providerReferralAccount,
      fee: serviceFeeNotApplied(
        "JUPITER_REFERRAL",
        `Jupiter charged ${stated.totalFeeBasisPoints} bps against the ${requested.feeBps} bps requested, which is its documented fallback to its own platform fee.`,
        requested.feeBps,
      ),
    };
  }
  const whollyOurs = stated.totalFeeBasisPoints === requested.feeBps;
  return {
    providerReferralAccount,
    fee: serviceFeeQuoted("JUPITER_REFERRAL", {
      basisPoints: requested.feeBps,
      asset: stated.totalFeeMint,
      amountRaw: whollyOurs ? stated.platformFeeAmountRaw : null,
      providerRetainedPercent: JUPITER_REFERRAL_PROVIDER_SHARE_PERCENT,
      requestedBasisPoints: requested.feeBps,
    }),
  };
}

type JupiterOrderSharedFields = Omit<
  JupiterOrderQuote,
  "schema" | "schemaVersion" | "provider" | "path" | "execution" | "taker" | "transactionBase64"
>;

function normalizeJupiterOrderShared(
  raw: Record<string, unknown>,
  meta: JupiterOrderNormalizeMeta,
): JupiterOrderSharedFields {
  const routePlan = raw.routePlan;
  if (!Array.isArray(routePlan) || routePlan.length > MAX_ROUTE_HOPS) {
    throw new Error(`routePlan must be an array with at most ${MAX_ROUTE_HOPS} hops.`);
  }
  const route = routePlan.map((candidate, index): JupiterRouteHop => {
    const hop = asObject(candidate, `routePlan[${index}]`);
    const swap = asObject(hop.swapInfo, `routePlan[${index}].swapInfo`);
    return {
      ammKey: asText(swap.ammKey, `routePlan[${index}].ammKey`, 44),
      label: asText(swap.label, `routePlan[${index}].label`, 96),
      inputMint: asText(swap.inputMint, `routePlan[${index}].inputMint`, 44),
      outputMint: asText(swap.outputMint, `routePlan[${index}].outputMint`, 44),
      inAmountRaw: asAmount(swap.inAmount, `routePlan[${index}].inAmount`),
      outAmountRaw: asAmount(swap.outAmount, `routePlan[${index}].outAmount`),
      basisPoints: asInteger(hop.bps, `routePlan[${index}].bps`, 10_000),
    };
  });

  const platform = asObject(raw.platformFee, "platformFee");

  const observedMs = Date.parse(meta.observedAt);
  if (!Number.isFinite(observedMs)) throw new Error("observedAt is not a valid instant.");
  if (!Number.isSafeInteger(meta.reviewWindowMs) || meta.reviewWindowMs <= 0 || meta.reviewWindowMs > 60_000) {
    throw new Error("reviewWindowMs is outside the bounded review window.");
  }
  const providerExpiresAt = asOptionalInstant(raw.expireAt, "expireAt");
  const localExpiry = new Date(observedMs + meta.reviewWindowMs).toISOString();

  const totalFeeBasisPoints = asInteger(raw.feeBps, "feeBps", 10_000);
  const totalFeeMint = asText(raw.feeMint, "feeMint", 44);
  const platformFeeAmountRaw = asOptionalRawAmount(platform.amount, "platformFee.amount");
  const service = readJupiterServiceFee(raw, meta.referral ?? null, { totalFeeBasisPoints, totalFeeMint, platformFeeAmountRaw }, meta.referralDropped ?? null);

  return {
    access: meta.access,
    tier: meta.access === "production" ? "pro" : "lite",
    swapType: asText(raw.swapType, "swapType", 64),
    swapMode: asText(raw.swapMode, "swapMode", 64),
    router: asText(raw.router, "router", 64),
    mode: asText(raw.mode, "mode", 64),
    inputMint: asText(raw.inputMint, "inputMint", 44),
    outputMint: asText(raw.outputMint, "outputMint", 44),
    inAmountRaw: asAmount(raw.inAmount, "inAmount"),
    outAmountRaw: asAmount(raw.outAmount, "outAmount"),
    minReceivedRaw: asAmount(raw.otherAmountThreshold, "otherAmountThreshold"),
    slippageBps: asInteger(raw.slippageBps, "slippageBps", 10_000),
    priceImpactPct: asText(raw.priceImpactPct, "priceImpactPct", 128),
    inUsdValue: asNumericText(raw.inUsdValue, "inUsdValue"),
    outUsdValue: asNumericText(raw.outUsdValue, "outUsdValue"),
    swapUsdValue: asNumericText(raw.swapUsdValue, "swapUsdValue"),
    totalFeeBasisPoints,
    totalFeeMint,
    platformFee: {
      basisPoints: asInteger(platform.feeBps, "platformFee.feeBps", 10_000),
      mint: asText(platform.feeMint, "platformFee.feeMint", 44),
      amountRaw: platformFeeAmountRaw,
    },
    providerFee: { basisPoints: null, mint: null, amountRaw: null },
    ryntraFee: service.fee,
    providerReferralAccount: service.providerReferralAccount,
    signatureFeeLamports: String(asInteger(raw.signatureFeeLamports, "signatureFeeLamports")),
    signatureFeePayer: asOptionalText(raw.signatureFeePayer, "signatureFeePayer", 44),
    priorityFeeLamports: String(asInteger(raw.prioritizationFeeLamports, "prioritizationFeeLamports")),
    priorityFeePayer: asOptionalText(raw.prioritizationFeePayer, "prioritizationFeePayer", 44),
    rentFeeLamports: String(asInteger(raw.rentFeeLamports, "rentFeeLamports")),
    rentFeePayer: asOptionalText(raw.rentFeePayer, "rentFeePayer", 44),
    gasless: asBoolean(raw.gasless, "gasless"),
    guaranteedPrice: asBoolean(raw.guaranteedPrice, "guaranteedPrice"),
    jitOptimized: asBoolean(raw.jitOptimized, "jitOptimized"),
    route,
    routeAffectingOptions: [...meta.routeAffectingOptions],
    requestId: asText(raw.requestId, "requestId", 128),
    providerExpiresAt,
    reviewExpiresAt: earlierInstant(localExpiry, providerExpiresAt),
    latencyMs: meta.latencyMs,
    observedAt: meta.observedAt,
    source: {
      ref: `jupiter:mainnet:swap-v2:order:${asText(raw.inputMint, "inputMint", 44)}->${asText(raw.outputMint, "outputMint", 44)}`,
      label:
        meta.access === "production"
          ? `Jupiter Swap API V2, keyed production (${meta.sourceHost})`
          : `Jupiter Swap API V2, explicit keyless degraded access (${meta.sourceHost})`,
    },
  };
}

export function normalizeJupiterOrder(
  body: unknown,
  meta: JupiterOrderNormalizeMeta,
): JupiterOrderQuote {
  const raw = asObject(body, "order");
  if (raw.transaction !== null) {
    throw new Error("transaction must be null for the quote-only order request.");
  }
  if (raw.taker !== null) {
    throw new Error("taker must be null for the quote-only order request.");
  }
  return {
    schema: "ryntra.solana.jupiter-order-quote",
    schemaVersion: "1.0.0",
    provider: "jupiter",
    path: "ORDER_EXECUTE",
    execution: "NOT_EXECUTED",
    taker: null,
    transactionBase64: null,
    ...normalizeJupiterOrderShared(raw, meta),
  };
}

/** Wire base64 of a 1232-byte packet is ~1644 characters; this bound is generous. */
const MAX_JUPITER_TRANSACTION_BASE64 = 6_000;
const BASE64_TEXT = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * A taker order: the same quote surface plus the provider-built, signable
 * transaction. Nothing here is submitted — signing stays with the person's
 * wallet and submission goes through `executeJupiterOrder` exactly once.
 */
export type JupiterExecutableOrder = Omit<
  JupiterOrderQuote,
  "schema" | "execution" | "taker" | "transactionBase64"
> &
  Readonly<{
    schema: "ryntra.solana.jupiter-executable-order";
    execution: "EXECUTABLE_NOT_SUBMITTED";
    taker: string;
    transactionBase64: string;
    lastValidBlockHeight: string;
  }>;

export function normalizeJupiterExecutableOrder(
  body: unknown,
  meta: JupiterOrderNormalizeMeta & Readonly<{ expectedTaker: string }>,
): JupiterExecutableOrder {
  const raw = asObject(body, "order");
  const taker = asText(raw.taker, "taker", 44);
  if (taker !== meta.expectedTaker) {
    throw new Error("order taker does not match the requested taker.");
  }
  const transactionBase64 = asText(raw.transaction, "transaction", MAX_JUPITER_TRANSACTION_BASE64);
  if (!BASE64_TEXT.test(transactionBase64)) {
    throw new Error("transaction is not canonical base64.");
  }
  return {
    schema: "ryntra.solana.jupiter-executable-order",
    execution: "EXECUTABLE_NOT_SUBMITTED",
    taker,
    transactionBase64,
    lastValidBlockHeight: asIntegerAmount(raw.lastValidBlockHeight, "lastValidBlockHeight"),
    ...normalizeJupiterOrderShared(raw, meta),
    schemaVersion: "1.0.0",
    provider: "jupiter",
    path: "ORDER_EXECUTE",
  };
}

/**
 * The gain past which a quote stops being an offer.
 *
 * Nobody is handed value for swapping. A route that claims to return materially
 * more dollars than it consumed is not a generous route, it is a wrong number —
 * and a wrong number that reaches a person as a price is worse than no price,
 * because they will press it and the chain will refuse them.
 *
 * Twenty per cent, and the width is the point. Healthy quotes agree with
 * themselves to within about **0.02%** — measured across ten consecutive
 * SOL → USDC orders on 2026-09-10, where `inUsdValue` and `outUsdValue` never
 * parted by more than two hundredths of a per cent. The slack above that is for
 * a thinly-priced token whose feed is stale, which is a real thing and must not
 * be refused. What this catches is the other kind: 1 SOL quoted at **642 USDC**
 * while Jupiter's own price API and its other routers said **101**, a claimed
 * gain of 532%, seen the same day.
 */
export const JUPITER_IMPLAUSIBLE_GAIN_BPS = 2_000;

export type JupiterQuoteValueCheck =
  | Readonly<{ plausible: true }>
  | Readonly<{ plausible: false; gainBps: number; inUsd: number; outUsd: number }>;

/**
 * Does this quote agree with itself?
 *
 * Both figures are Jupiter's own — `inUsdValue` is the input priced by its feed,
 * `outUsdValue` the output priced by the same feed — so this asks the provider
 * whether its two halves add up, rather than second-guessing it with an outside
 * price. On the healthy quotes above, `outUsdValue` tracks `outAmount` exactly.
 *
 * **Only a gain fails.** A loss is a cost and costs are legitimate; the swap
 * card already shows price impact and slippage, and refusing a bad price would
 * be taking a decision that belongs to the person. This asymmetry is deliberate.
 *
 * **Missing figures never fail.** Jupiter states no USD value for a token it
 * cannot price, and refusing those would quietly remove every unpriced token
 * from the product. Unable to check is not the same as failed.
 */
export function assessJupiterQuoteValue(
  order: Pick<JupiterOrderQuote, "inUsdValue" | "outUsdValue">,
): JupiterQuoteValueCheck {
  const inUsd = Number(order.inUsdValue);
  const outUsd = Number(order.outUsdValue);
  if (!Number.isFinite(inUsd) || !Number.isFinite(outUsd) || inUsd <= 0 || outUsd <= 0) return { plausible: true };
  const gainBps = Math.round(((outUsd - inUsd) / inUsd) * 10_000);
  return gainBps > JUPITER_IMPLAUSIBLE_GAIN_BPS ? { plausible: false, gainBps, inUsd, outUsd } : { plausible: true };
}

export function assessJupiterOrderFreshness(
  order: Pick<JupiterOrderQuote, "reviewExpiresAt">,
  now = new Date(),
): "FRESH" | "EXPIRED" | "UNKNOWN" {
  const expiry = Date.parse(order.reviewExpiresAt);
  const current = now.getTime();
  if (!Number.isFinite(expiry) || !Number.isFinite(current)) return "UNKNOWN";
  return current < expiry ? "FRESH" : "EXPIRED";
}

export class JupiterResponseReadError extends Error {}

function parseJupiterJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new JupiterResponseReadError("Jupiter returned unreadable or malformed JSON.");
  }
}

export async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes > MAX_JUPITER_ORDER_BYTES) {
      await response.body?.cancel();
      throw new JupiterResponseReadError("Jupiter order exceeds the response byte ceiling.");
    }
  }
  /* A successful order must be JSON by content type. A refusal is read even
     as `text/plain`: Jupiter's fee-range 400 arrives that way, and a refusal
     that cannot be read is a refusal that cannot be recognised — which on
     2026-09-11 turned a fee it would not take into a lane it could not serve. */
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json") && (response.ok || !contentType.startsWith("text/"))) {
    await response.body?.cancel();
    throw new JupiterResponseReadError("Jupiter order did not return application/json.");
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_JUPITER_ORDER_BYTES) {
      throw new JupiterResponseReadError("Jupiter order exceeds the response byte ceiling.");
    }
    return parseJupiterJson(text);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let seen = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > MAX_JUPITER_ORDER_BYTES) {
      await reader.cancel();
      throw new JupiterResponseReadError("Jupiter order exceeds the response byte ceiling.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return parseJupiterJson(text + decoder.decode());
}

/**
 * Jupiter's own range for `referralFee`, verified live on 2026-09-11 with the
 * exact answer: HTTP 400, *"The referralFee parameter must be between 50 and
 * 255 (inclusive)"* — as `text/plain`, which is why the read below accepts a
 * refusal in that shape. A check the day before, when the rate moved to 25,
 * had recorded 200 at 10 and 25; whatever answered then, the provider refuses
 * 25 today, and lowering this floor to match the constant took the whole
 * Solana swap lane down for one minute on production.
 */
export const JUPITER_REFERRAL_FEE_MIN_BPS = 50;
export const JUPITER_REFERRAL_FEE_MAX_BPS = 255;

export type JupiterReferralDrop = "BELOW_PROVIDER_MINIMUM" | "MALFORMED";

/**
 * A referral this module will actually send, or nothing — and why nothing.
 *
 * A fee below the provider's minimum is not sent, because the provider refuses
 * it outright and a configuration must never turn a working swap into an
 * unavailable market. It is also not hidden: the reason travels into the fee
 * the Review and the receipt print, so *no fee on this route* is stated as
 * what it is — the product's rate is under Jupiter's floor — rather than as an
 * account nobody configured.
 */
function referralOrNull(referral: JupiterReferral | null | undefined): Readonly<{ referral: JupiterReferral | null; dropped: JupiterReferralDrop | null }> {
  if (!referral) return { referral: null, dropped: null };
  if (!Number.isSafeInteger(referral.feeBps) || referral.feeBps > JUPITER_REFERRAL_FEE_MAX_BPS || referral.feeBps < 1) return { referral: null, dropped: "MALFORMED" };
  if (referral.feeBps < JUPITER_REFERRAL_FEE_MIN_BPS) return { referral: null, dropped: "BELOW_PROVIDER_MINIMUM" };
  if (referral.account.length < 32 || referral.account.length > 44) return { referral: null, dropped: "MALFORMED" };
  return { referral, dropped: null };
}

/**
 * Put the fee on the wire, and say out loud that it changed the request.
 *
 * `routeAffectingOptions` is carried into the Review and the receipt, so a
 * person reading either can see that this order was `manual` rather than `ultra`
 * and why. Jupiter's matrix says referral parameters keep every router eligible,
 * so this is a label on the request rather than an admission about the price —
 * but a label nobody records is a label nobody can check.
 */
function applyJupiterReferral(url: URL, referral: JupiterReferral | null): readonly string[] {
  if (!referral) return [];
  url.searchParams.set("referralAccount", referral.account);
  url.searchParams.set("referralFee", String(referral.feeBps));
  return [`referralFee=${referral.feeBps}`, "referralAccount=set"];
}

/**
 * Did Jupiter refuse this order **because of the fee**?
 *
 * It answers HTTP 400 for a referral account it cannot find under its own
 * program — verified live on 2026-09-10, where two well-formed addresses each
 * produced *"Please check that referralAccount is initialized under REFER4Zgm…"*.
 * `referral-account.server.ts` verifies the account against the chain precisely
 * so this never happens; this is the second answer to the same question, because
 * the first one is a check and this one is the provider's own verdict.
 *
 * The consequence of missing it would be the whole Solana swap lane reported to
 * people as an unavailable market, over a fee. So a refusal that names the fee is
 * recognised and the fee is dropped — once, on a read that moves nothing.
 */
function refusedForTheFee(status: number, body: unknown): boolean {
  /* Narrow on purpose, in three ways at once, because this is **not** a
     universal way around a provider error. It fires only on HTTP 400 — never on
     429, never on a 5xx, never on a refusal with no body — and only when
     Jupiter's own text names one of the two fee parameters or the referral
     program itself. Anything else is a refusal and stays one.

     It also cannot reach a submitted transaction. This is the quote boundary;
     `executeJupiterOrder` performs at most one network attempt and has no retry
     of any kind, which is the rule that keeps an ambiguous submit from being
     sent twice. Dropping a fee re-asks for a **price**. */
  if (status !== 400) return false;
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const text = [record.error, record.errorMessage, record.message].filter((value): value is string => typeof value === "string").join(" ");
  if (text.length === 0) return false;
  return /\breferralAccount\b|\breferralFee\b|REFER4Zgm/i.test(text);
}

/**
 * Ask again without the router that answered badly, exactly once.
 *
 * The rule is the shape of this: filter the problem quote out and get another
 * usable route, without rewriting routing and without substituting numbers on
 * top of an order that already exists. So the router is named to Jupiter's own
 * `excludeRouters` and the whole order is asked for again — a new quote, a new
 * minimum, a new transaction, a new Review. Nothing is patched.
 *
 * Once. If the second answer also disagrees with itself, something is wrong that
 * a third request will not fix, and the honest end is a refusal that says the
 * quote could not be trusted rather than a price that cannot be filled.
 */
async function retryWithoutRouter<T extends Readonly<{ ok: boolean }>>(
  router: string,
  alreadyExcluded: readonly string[],
  value: Extract<JupiterQuoteValueCheck, { plausible: false }>,
  again: (next: readonly string[]) => Promise<T>,
  access: JupiterSwapAccess,
): Promise<T | JupiterOrderFailure> {
  const reason =
    `Jupiter's own figures disagree with each other on this quote: ${value.inUsd.toFixed(2)} USD in and ` +
    `${value.outUsd.toFixed(2)} USD out, a claimed gain of ${(value.gainBps / 100).toFixed(1)}%. ` +
    "A swap does not hand anybody value, so this is a wrong number rather than an offer.";
  if (router.length === 0 || alreadyExcluded.includes(router)) {
    return { ok: false, code: "IMPLAUSIBLE_QUOTE", errorCode: null, status: null, access, reason };
  }
  return again([...alreadyExcluded, router]);
}

export async function fetchJupiterOrder(
  request: JupiterOrderRequest,
  selection: JupiterSwapEndpointSelection = resolveJupiterSwapEndpoint(),
  dependencies: Readonly<{
    fetchImpl?: typeof fetch;
    now?: () => Date;
    timeoutMs?: number;
    reviewWindowMs?: number;
  }> = {},
): Promise<JupiterOrderResult> {
  if (!selection.ok) {
    return { ...selection, errorCode: null, status: null, access: null };
  }
  const pinnedOrderUrl = `${JUPITER_SWAP_V2_BASE_URL}/order` as const;
  const pinnedBuildUrl = `${JUPITER_SWAP_V2_BASE_URL}/build` as const;
  const tierMatchesAccess =
    (selection.access === "production" && selection.tier === "pro") ||
    (selection.access === "degraded" && selection.tier === "lite");
  if (
    selection.baseUrl !== JUPITER_SWAP_V2_BASE_URL ||
    selection.orderUrl !== pinnedOrderUrl ||
    selection.buildUrl !== pinnedBuildUrl ||
    !tierMatchesAccess
  ) {
    return {
      ok: false,
      code: "MALFORMED",
      errorCode: null,
      status: null,
      access: selection.access,
      reason: "Jupiter endpoint selection failed its pinned origin and path contract.",
    };
  }
  const url = new URL(pinnedOrderUrl);
  url.searchParams.set("inputMint", request.inputMint);
  url.searchParams.set("outputMint", request.outputMint);
  url.searchParams.set("amount", request.amountRaw);
  const { referral, dropped: referralDropped } = referralOrNull(request.referral);
  const excluded = request.excludeRouters ?? [];
  if (excluded.length > 0) url.searchParams.set("excludeRouters", excluded.join(","));
  const routeAffectingOptions = [
    ...(excluded.length > 0 ? [`excludeRouters=${excluded.join(",")}`] : []),
    ...applyJupiterReferral(url, referral),
  ];

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? 8_000;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: selection.authorizationHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return {
      ok: false,
      code: "UNREACHABLE",
      errorCode: null,
      status: null,
      access: selection.access,
      reason: "Jupiter did not answer within the request deadline.",
    };
  }
  noteJupiterResponse(response.headers, "shared");

  let body: unknown;
  try {
    body = await readBoundedJson(response);
  } catch (failure) {
    return {
      ok: false,
      code: "MALFORMED",
      errorCode: null,
      status: response.status,
      access: selection.access,
      reason:
        failure instanceof JupiterResponseReadError
          ? failure.message
          : "Jupiter returned unreadable or malformed JSON.",
    };
  }

  if (!response.ok) {
    /* A refusal that names the fee costs the fee, never the swap. One retry
       without it, on a read that moves nothing; `referral` is null on the second
       pass so this cannot recur. Nothing else about the request changes — in
       particular not the access tier, which is never retried. */
    if (referral && refusedForTheFee(response.status, body)) {
      return fetchJupiterOrder({ ...request, referral: null }, selection, dependencies);
    }
    const errorBody = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const errorCode =
      typeof errorBody.errorCode === "string" && /^[A-Z0-9_:-]{1,96}$/.test(errorBody.errorCode)
        ? errorBody.errorCode
        : null;
    if (response.status === 429) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        errorCode,
        status: response.status,
        access: selection.access,
        retryWaitMs: jupiterRetryWaitMs(response.headers),
        reason: `${selection.label} was rate-limited. Refreshing later asks for a new order; no fallback ran.`,
      };
    }
    if (errorCode && NO_ROUTE_CODES.has(errorCode)) {
      return {
        ok: false,
        code: "NO_ROUTE",
        errorCode,
        status: response.status,
        access: selection.access,
        reason: "Jupiter found no route for this pair at this amount.",
      };
    }
    return {
      ok: false,
      code: response.status >= 500 ? "HTTP_ERROR" : "REFUSED",
      errorCode,
      status: response.status,
      access: selection.access,
      reason: `Jupiter refused the order with HTTP ${response.status}.`,
    };
  }

  const observedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  try {
    const order = normalizeJupiterOrder(body, {
      access: selection.access,
      latencyMs: Date.now() - started,
      observedAt,
      reviewWindowMs: dependencies.reviewWindowMs ?? JUPITER_ORDER_REVIEW_WINDOW_MS,
      sourceHost: url.host,
      routeAffectingOptions,
      referral,
      referralDropped,
    });
    if (order.inputMint !== request.inputMint) {
      throw new Error("order inputMint does not match the requested input mint.");
    }
    if (order.outputMint !== request.outputMint) {
      throw new Error("order outputMint does not match the requested output mint.");
    }
    if (order.inAmountRaw !== request.amountRaw) {
      throw new Error("order inAmount does not match the requested input amount.");
    }
    const value = assessJupiterQuoteValue(order);
    if (!value.plausible) {
      return retryWithoutRouter(order.router, excluded, value, (next) => fetchJupiterOrder({ ...request, excludeRouters: next }, selection, dependencies), selection.access);
    }
    return {
      ok: true,
      order,
    };
  } catch (failure) {
    return {
      ok: false,
      code: "MALFORMED",
      errorCode: null,
      status: response.status,
      access: selection.access,
      reason: `Jupiter answered 200 with a shape this version cannot vouch for: ${failure instanceof Error ? failure.message : "unknown shape"}`,
    };
  }
}

export type JupiterExecutableOrderRequest = Readonly<{
  inputMint: string;
  outputMint: string;
  /** Raw base units of the input mint. */
  amountRaw: string;
  /** The wallet that will sign; Jupiter builds the transaction around it. */
  taker: string;
  /** Ryntra's fee. Absent or null asks for no fee and says so in `ryntraFee`. */
  referral?: JupiterReferral | null;
  /** Routers this request may not use; `jupiterz` is always among them here. */
  excludeRouters?: readonly string[];
  /**
   * A fixed slippage bound for the transaction, in basis points. Absent, the
   * venue's own estimate decides (RTSE, applied on `/order` by default);
   * present, it replaces that estimate — Jupiter's documented behaviour —
   * so the minimum the chain enforces is this bound. Under a Trading Plan it
   * is the plan's `execution.maxSlippageBps`: the rule the person wrote is
   * what the transaction holds, not a number the venue chose.
   */
  slippageBps?: number;
}>;

/** A whole number of basis points the venue accepts as a fixed bound. */
export const JUPITER_ORDER_SLIPPAGE_MAX_BPS = 10_000;

export type JupiterExecutableOrderFailure = Readonly<{
  ok: false;
  code: JupiterOrderFailure["code"] | "BUILD_FAILED";
  errorCode: string | null;
  status: number | null;
  reason: string;
  access: JupiterSwapAccess | null;
  /** The router Jupiter named when the quote existed but the build failed. */
  router: string | null;
  /**
   * On `RATE_LIMITED` only: the provider's own pause when it is short enough
   * to wait for (`jupiterRetryWaitMs` up to `JUPITER_ORDER_RETRY_WAIT_MAX_MS`,
   * ten seconds — the person is waiting on this one press), so the order route
   * may ask once more before any lock is crossed (`askOnceMoreAfterRate`);
   * null when the window resets later. Never read by `/execute`, which is never
   * asked twice.
   */
  retryWaitMs?: number | null;
}>;

export type JupiterExecutableOrderResult =
  | Readonly<{ ok: true; order: JupiterExecutableOrder }>
  | JupiterExecutableOrderFailure;

/**
 * Fetch a fresh taker-pays order — quote plus signable transaction.
 *
 * The swap path does not implement JupiterZ's market-maker fee payer /
 * co-signature semantics, so the executable canary excludes that router by
 * name. Jupiter's documented response-level fee-payer check remains mandatory
 * because the exclusion alone does not disable every future gasless path.
 *
 * Three optional parameters go out and no others: `excludeRouters=jupiterz` for
 * the reason above; — when one is configured —
 * `referralAccount`/`referralFee` for Ryntra's service fee, 50 bps on Jupiter
 * (the rate is `RYNTRA_SERVICE_FEE_POLICY`); and — only when the caller names
 * one — `slippageBps`, a fixed bound in place of the venue's estimate (under a
 * Trading Plan, the plan's own rule). Still no `payer` and no `receiver`:
 * `payer` is the parameter that would actually narrow routing, and this lane
 * does not send it.
 */
export async function fetchJupiterExecutableOrder(
  request: JupiterExecutableOrderRequest,
  selection: JupiterSwapEndpointSelection = resolveJupiterSwapEndpoint(),
  dependencies: Readonly<{
    fetchImpl?: typeof fetch;
    now?: () => Date;
    timeoutMs?: number;
    reviewWindowMs?: number;
  }> = {},
): Promise<JupiterExecutableOrderResult> {
  if (!selection.ok) {
    return { ...selection, errorCode: null, status: null, access: null, router: null };
  }
  const pinnedOrderUrl = `${JUPITER_SWAP_V2_BASE_URL}/order` as const;
  const tierMatchesAccess =
    (selection.access === "production" && selection.tier === "pro") ||
    (selection.access === "degraded" && selection.tier === "lite");
  if (
    selection.baseUrl !== JUPITER_SWAP_V2_BASE_URL ||
    selection.orderUrl !== pinnedOrderUrl ||
    !tierMatchesAccess
  ) {
    return {
      ok: false,
      code: "MALFORMED",
      errorCode: null,
      status: null,
      access: selection.access,
      router: null,
      reason: "Jupiter endpoint selection failed its pinned origin and path contract.",
    };
  }
  const url = new URL(pinnedOrderUrl);
  url.searchParams.set("inputMint", request.inputMint);
  url.searchParams.set("outputMint", request.outputMint);
  url.searchParams.set("amount", request.amountRaw);
  url.searchParams.set("taker", request.taker);
  /* `jupiterz` is always excluded here — the swap path does not implement its
     market-maker co-signature semantics — and anything the caller adds is a
     router that already answered with a quote that did not agree with itself. */
  const excluded = [...new Set(["jupiterz", ...(request.excludeRouters ?? [])])];
  url.searchParams.set("excludeRouters", excluded.join(","));
  /* A slippage bound is a rule the person wrote; a value that is not a whole
     number of basis points the venue accepts is refused here, never rounded
     into a bound nobody wrote. */
  const slippageBps = request.slippageBps;
  if (slippageBps !== undefined && (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > JUPITER_ORDER_SLIPPAGE_MAX_BPS)) {
    return {
      ok: false,
      code: "MALFORMED",
      errorCode: null,
      status: null,
      access: selection.access,
      router: null,
      reason: `The slippage bound must be a whole number of basis points between 1 and ${JUPITER_ORDER_SLIPPAGE_MAX_BPS}.`,
    };
  }
  if (slippageBps !== undefined) url.searchParams.set("slippageBps", String(slippageBps));
  const { referral, dropped: referralDropped } = referralOrNull(request.referral);
  const routeAffectingOptions = [
    `excludeRouters=${excluded.join(",")}`,
    ...(slippageBps !== undefined ? [`slippageBps=${slippageBps}`] : []),
    ...applyJupiterReferral(url, referral),
  ];

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? 8_000;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: selection.authorizationHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return {
      ok: false,
      code: "UNREACHABLE",
      errorCode: null,
      status: null,
      access: selection.access,
      router: null,
      reason: "Jupiter did not answer within the request deadline.",
    };
  }
  noteJupiterResponse(response.headers, "shared");

  let body: unknown;
  try {
    body = await readBoundedJson(response);
  } catch (failure) {
    return {
      ok: false,
      code: "MALFORMED",
      errorCode: null,
      status: response.status,
      access: selection.access,
      router: null,
      reason:
        failure instanceof JupiterResponseReadError
          ? failure.message
          : "Jupiter returned unreadable or malformed JSON.",
    };
  }

  const rawBody = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const bodyErrorCode =
    typeof rawBody.errorCode === "string" && /^[A-Z0-9_:-]{1,96}$/.test(rawBody.errorCode)
      ? rawBody.errorCode
      : typeof rawBody.errorCode === "number" && Number.isSafeInteger(rawBody.errorCode) && Math.abs(rawBody.errorCode) <= 1_000_000
        ? String(rawBody.errorCode)
      : null;

  if (!response.ok) {
    /* Same rule on the signable path: the fee is dropped, the order is not. */
    if (referral && refusedForTheFee(response.status, body)) {
      return fetchJupiterExecutableOrder({ ...request, referral: null }, selection, dependencies);
    }
    if (response.status === 429) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        errorCode: bodyErrorCode,
        status: response.status,
        access: selection.access,
        router: null,
        /* A person's own order waits for the window itself, up to its ten seconds; a read, 2.5 s. */
        retryWaitMs: jupiterRetryWaitMs(response.headers, Date.now(), JUPITER_ORDER_RETRY_WAIT_MAX_MS),
        reason: `${selection.label} was rate-limited. Refreshing later asks for a new order; no fallback ran.`,
      };
    }
    if (bodyErrorCode && NO_ROUTE_CODES.has(bodyErrorCode)) {
      return {
        ok: false,
        code: "NO_ROUTE",
        errorCode: bodyErrorCode,
        status: response.status,
        access: selection.access,
        router: null,
        reason: "Jupiter found no route for this pair at this amount.",
      };
    }
    /* Jupiter states its reason in the body, in plain words, and this threw it
       away and printed the status number instead.
       The branch below — a 200 with no transaction — has carried the venue's
       own sentence since it was written ("Insufficient funds"), and it is the
       reason that path is diagnosable and this one was not. On 2026-09-10 a
       wallet could not swap at all, the screen said "the swap provider refused
       this request", the log said `HTTP 400`, and the actual sentence Jupiter
       had written was sitting in a body nobody kept.
       Bounded and quoted, so a provider's words stay visibly the provider's. */
    const stated =
      typeof rawBody.error === "string" && rawBody.error.length > 0 && rawBody.error.length <= 300
        ? rawBody.error
        : null;
    return {
      ok: false,
      code: response.status >= 500 ? "HTTP_ERROR" : "REFUSED",
      errorCode: bodyErrorCode,
      status: response.status,
      access: selection.access,
      router: null,
      reason: stated
        ? `Jupiter refused the order with HTTP ${response.status}: ${stated}`
        : `Jupiter refused the order with HTTP ${response.status}.`,
    };
  }

  /* A quote with an empty or absent transaction means the price exists but the
     build failed. It must never be signed; the honest surface shows router,
     errorCode and — when the venue states one — its own reason. "Insufficient
     funds" is the common one, and a person told only that the build failed has
     been given the least useful half of the answer they already own. */
  if (rawBody.transaction === "" || rawBody.transaction === null || rawBody.transaction === undefined) {
    const router = typeof rawBody.router === "string" && rawBody.router.length <= 64 ? rawBody.router : null;
    const stated =
      typeof rawBody.error === "string" && rawBody.error.length > 0 && rawBody.error.length <= 200
        ? rawBody.error
        : null;
    return {
      ok: false,
      code: "BUILD_FAILED",
      errorCode: bodyErrorCode,
      status: response.status,
      access: selection.access,
      router,
      reason: stated
        ? `Jupiter quoted the pair but would not build a signable transaction: ${stated}.`
        : "Jupiter quoted the pair but could not build a signable transaction. Ask for a fresh order; do not sign.",
    };
  }

  const observedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  try {
    const order = normalizeJupiterExecutableOrder(body, {
      access: selection.access,
      latencyMs: Date.now() - started,
      observedAt,
      reviewWindowMs: dependencies.reviewWindowMs ?? JUPITER_ORDER_REVIEW_WINDOW_MS,
      sourceHost: url.host,
      routeAffectingOptions,
      referral,
      referralDropped,
      expectedTaker: request.taker,
    });
    if (order.inputMint !== request.inputMint) {
      throw new Error("order inputMint does not match the requested input mint.");
    }
    if (order.outputMint !== request.outputMint) {
      throw new Error("order outputMint does not match the requested output mint.");
    }
    if (order.inAmountRaw !== request.amountRaw) {
      throw new Error("order inAmount does not match the requested input amount.");
    }
    const value = assessJupiterQuoteValue(order);
    if (!value.plausible) {
      const retry = await retryWithoutRouter(order.router, excluded, value, (next) => fetchJupiterExecutableOrder({ ...request, excludeRouters: next }, selection, dependencies), selection.access);
      return retry.ok ? retry : { ...retry, router: order.router };
    }
    return { ok: true, order };
  } catch (failure) {
    return {
      ok: false,
      code: "MALFORMED",
      errorCode: null,
      status: response.status,
      access: selection.access,
      router: null,
      reason: `Jupiter answered 200 with a shape this version cannot vouch for: ${failure instanceof Error ? failure.message : "unknown shape"}`,
    };
  }
}

export type JupiterExecuteRequest = Readonly<{
  /** The wallet-signed transaction, exact bytes, base64. */
  signedTransactionBase64: string;
  /** The requestId returned by the same `/order` response that built the bytes. */
  requestId: string;
}>;

export type JupiterExecuteReport = Readonly<{
  schema: "ryntra.solana.jupiter-execute-report";
  schemaVersion: "1.0.0";
  status: "Success" | "Failed";
  /** Provider result code: 0 success, negative values per the documented map. */
  code: number;
  signature: string | null;
  /** Wallet-facing totals. */
  totalInputAmountRaw: string | null;
  totalOutputAmountRaw: string | null;
  /** Route accounting — a different meaning from the totals; never swap them. */
  inputAmountResultRaw: string | null;
  outputAmountResultRaw: string | null;
  providerError: string | null;
  httpStatus: number;
  latencyMs: number;
  observedAt: string;
  source: EvidenceSource;
}>;

export type JupiterExecuteFailure = Readonly<{
  ok: false;
  code:
    | "PRODUCTION_KEY_REQUIRED"
    | "PINNED_CONTRACT"
    | "AMBIGUOUS_NETWORK"
    | "AMBIGUOUS_HTTP"
    | "AMBIGUOUS_MALFORMED";
  status: number | null;
  reason: string;
  /**
   * True whenever the POST may have left this process. The caller then treats
   * the swap as SUBMITTED_UNKNOWN and recovers by signature through an
   * independent chain read — it never calls `/execute` again.
   */
  possiblySubmitted: boolean;
  access: JupiterSwapAccess | null;
}>;

export type JupiterExecuteResult =
  | Readonly<{ ok: true; report: JupiterExecuteReport }>
  | JupiterExecuteFailure;

function asExecuteCode(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Math.abs(value) > 1_000_000) {
    throw new Error("execute code is not a bounded integer.");
  }
  return value;
}

function asOptionalRawAmount(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new Error(`${field} is not a raw unsigned amount.`);
}

/**
 * One-shot Jupiter `/execute`. This function performs at most ONE network
 * attempt and never retries: any failure after the request may have left the
 * process is reported with `possiblySubmitted: true`, and the caller's only
 * legal follow-up is an independent chain read by signature.
 */
export async function executeJupiterOrder(
  request: JupiterExecuteRequest,
  selection: JupiterSwapEndpointSelection = resolveJupiterSwapEndpoint(),
  dependencies: Readonly<{
    fetchImpl?: typeof fetch;
    now?: () => Date;
    timeoutMs?: number;
  }> = {},
): Promise<JupiterExecuteResult> {
  if (!selection.ok) {
    return {
      ok: false,
      code: "PRODUCTION_KEY_REQUIRED",
      status: null,
      reason: selection.reason,
      possiblySubmitted: false,
      access: null,
    };
  }
  const pinnedExecuteUrl = `${JUPITER_SWAP_V2_BASE_URL}/execute` as const;
  if (selection.baseUrl !== JUPITER_SWAP_V2_BASE_URL || selection.executeUrl !== pinnedExecuteUrl) {
    return {
      ok: false,
      code: "PINNED_CONTRACT",
      status: null,
      reason: "Jupiter endpoint selection failed its pinned origin and path contract.",
      possiblySubmitted: false,
      access: selection.access,
    };
  }
  if (!BASE64_TEXT.test(request.signedTransactionBase64) || request.signedTransactionBase64.length > MAX_JUPITER_TRANSACTION_BASE64) {
    return {
      ok: false,
      code: "PINNED_CONTRACT",
      status: null,
      reason: "The signed transaction is not canonical base64 within the wire bound; nothing was sent.",
      possiblySubmitted: false,
      access: selection.access,
    };
  }
  if (request.requestId.length === 0 || request.requestId.length > 128) {
    return {
      ok: false,
      code: "PINNED_CONTRACT",
      status: null,
      reason: "The requestId is missing or outside its bound; nothing was sent.",
      possiblySubmitted: false,
      access: selection.access,
    };
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? 30_000;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(pinnedExecuteUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...selection.authorizationHeaders() },
      body: JSON.stringify({
        signedTransaction: request.signedTransactionBase64,
        requestId: request.requestId,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return {
      ok: false,
      code: "AMBIGUOUS_NETWORK",
      status: null,
      reason:
        "The execute request did not complete. The transaction may still have been submitted; recover by signature through an independent chain read. Never execute again.",
      possiblySubmitted: true,
      access: selection.access,
    };
  }
  noteJupiterResponse(response.headers, "execute");

  let body: unknown;
  try {
    body = await readBoundedJson(response);
  } catch {
    return {
      ok: false,
      code: response.ok ? "AMBIGUOUS_MALFORMED" : "AMBIGUOUS_HTTP",
      status: response.status,
      reason: `Jupiter answered HTTP ${response.status} without a readable JSON body. Recover by signature; never execute again.`,
      possiblySubmitted: true,
      access: selection.access,
    };
  }

  const observedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  if (!response.ok) {
    const providerError = typeof raw.error === "string" ? raw.error.slice(0, MAX_PROVIDER_TEXT) : null;
    return {
      ok: false,
      code: "AMBIGUOUS_HTTP",
      status: response.status,
      reason: `Jupiter answered HTTP ${response.status}${providerError ? ` (${providerError})` : ""}. Recover by signature; never execute again.`,
      possiblySubmitted: true,
      access: selection.access,
    };
  }

  try {
    const status = asText(raw.status, "status", 16);
    if (status !== "Success" && status !== "Failed") {
      throw new Error("status is neither Success nor Failed.");
    }
    const signature = asOptionalText(raw.signature, "signature", 128);
    if (status === "Success" && signature === null) {
      throw new Error("a Success report requires the landed signature.");
    }
    const code = asExecuteCode(raw.code);
    if ((status === "Success" && code !== 0) || (status === "Failed" && code === 0)) {
      throw new Error(`status ${status} contradicts provider code ${code}.`);
    }
    const report: JupiterExecuteReport = {
      schema: "ryntra.solana.jupiter-execute-report",
      schemaVersion: "1.0.0",
      status,
      code,
      signature,
      totalInputAmountRaw: asOptionalRawAmount(raw.totalInputAmount, "totalInputAmount"),
      totalOutputAmountRaw: asOptionalRawAmount(raw.totalOutputAmount, "totalOutputAmount"),
      inputAmountResultRaw: asOptionalRawAmount(raw.inputAmountResult, "inputAmountResult"),
      outputAmountResultRaw: asOptionalRawAmount(raw.outputAmountResult, "outputAmountResult"),
      providerError: typeof raw.error === "string" ? raw.error.slice(0, MAX_PROVIDER_TEXT) : null,
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      observedAt,
      source: {
        ref: `jupiter:mainnet:swap-v2:execute:${request.requestId}`,
        label:
          selection.access === "production"
            ? "Jupiter Swap API V2 execute, keyed production (api.jup.ag)"
            : "Jupiter Swap API V2 execute, explicit keyless degraded access (api.jup.ag)",
      },
    };
    return { ok: true, report };
  } catch (failure) {
    return {
      ok: false,
      code: "AMBIGUOUS_MALFORMED",
      status: response.status,
      reason: `Jupiter answered 200 with a shape this version cannot vouch for: ${failure instanceof Error ? failure.message : "unknown shape"}. The transaction may have landed; recover by signature.`,
      possiblySubmitted: true,
      access: selection.access,
    };
  }
}

/** Signed exact difference `a - b` between two raw base-unit strings. */
export function rawDelta(a: string, b: string): string {
  return (BigInt(a) - BigInt(b)).toString();
}
