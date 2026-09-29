/**
 * What a finished Relay request actually paid — the fill, and Ryntra's app fee.
 *
 * One request for both, because it is the same document and Relay charges for the
 * question. The distinction this module exists to preserve is between a fee that
 * was **quoted** and one that was **taken**: Relay is explicit that an unsupported
 * operation collects nothing and returns no error, and its same-chain collection
 * happens through a secondary swap only when the fee clears **$0.025** — which at
 * 25 bps is a swap of about $10. So a small swap can quote a fee and collect
 * none, and nothing here may round a quote up into revenue.
 *
 * ## Why there are two endpoints
 *
 * `GET /requests/v3` is the current endpoint and **requires `x-api-key`** — the
 * anonymous call answers `400 FST_ERR_VALIDATION`. `GET /requests/v2` is
 * deprecated: it states its own sunset in-band (`deprecatedAt 2026-07-22`,
 * `throttledFrom 2026-09-01`, `sunsetAt 2026-11-24`) and its rate limit is being
 * reduced in stages already.
 *
 * v3 is used whenever a key is configured. v2 remains as the rollback for the one
 * state that would otherwise be silent breakage: a deployment with no key, where
 * refusing to read at all would leave Activity with no actual amount and Rewards
 * accruing nothing. The version that answered is reported, so "we are on v3" is
 * an observation rather than a belief.
 *
 * ## What moved between the two
 *
 * | v2 | v3 |
 * |---|---|
 * | `?hash=` | `?depositTxHash=` |
 * | `data.metadata.currencyOut.amountFormatted` | `data.route.actual.destination.outputCurrency.amountFormatted` |
 * | — | same-chain has no destination side: fall back to `origin.outputCurrency` |
 * | `data.appFees` (quoted) + `data.paidAppFees` (actual) | `data.appFees.{quoted,actual,currency}` |
 * | `inTxs[].hash` | `inTxs[].txHash` |
 */

import { RELAY_API_ORIGIN } from "./chains.ts";
import { relayHeaders, type RelayAuth } from "./http.ts";
import type { CrossSwapProviderStatus } from "../swap/cross-swap-status.ts";

export const RELAY_REQUESTS_V3_PATH = "/requests/v3";
/** Kept for the no-key rollback only. Retired by Relay on 2026-11-24. */
export const RELAY_REQUESTS_V2_PATH = "/requests/v2";

export type RelayRequestsVersion = "v3" | "v2";

export type RelayFinishedRequest = Readonly<{
  /** Human decimal of what actually arrived, read from settlement rather than the quote. */
  toAmount: string | null;
  serviceFee: CrossSwapProviderStatus["serviceFee"];
  /** Which endpoint answered. Observed, so a claim about the migration can be checked. */
  version: RelayRequestsVersion;
}>;

export type RelayRequestsDependencies = RelayAuth &
  Readonly<{
    fetchImpl?: typeof fetch;
    origin?: string;
    timeoutMs?: number;
  }>;

type AppFeeEntry = Readonly<{ recipient?: unknown; bps?: unknown; amount?: unknown; amountUsd?: unknown }>;

function firstAppFee(entries: unknown): AppFeeEntry | null {
  return Array.isArray(entries) && entries.length > 0 && typeof entries[0] === "object" && entries[0] !== null
    ? (entries[0] as AppFeeEntry)
    : null;
}

function usdNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rawAmount(value: unknown): string | null {
  return typeof value === "string" && /^[0-9]+$/.test(value) ? value : null;
}

function humanAmount(value: unknown): string | null {
  return typeof value === "string" && /^[0-9]+(\.[0-9]+)?$/.test(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * The fee shape both versions produce, built from a quoted entry and a paid one.
 *
 * `collected` means a positive amount arrived. An entry that exists with a null or
 * zero amount is Relay saying nothing was taken, and is recorded as such. Relay
 * takes no cut of an app fee — its own charge is the platform fee, a separate line
 * — so what the person paid and what Ryntra is owed are the same number, and the
 * provider's share is a stated zero rather than an unknown. Keyed by the source
 * transaction, which is the same key on every re-read, so polling a finished
 * request cannot count the income twice.
 */
function serviceFeeFrom(quoted: AppFeeEntry | null, paid: AppFeeEntry | null, operationRef: string, currencyValue: unknown): CrossSwapProviderStatus["serviceFee"] {
  if (quoted === null && paid === null) return null;
  const paidAmountRaw = rawAmount(paid?.amount);
  const paidUsd = usdNumber(paid?.amountUsd);
  const metadata = record(currencyValue);
  const currency = typeof metadata?.symbol === "string" && typeof metadata.decimals === "number" && Number.isInteger(metadata.decimals) && metadata.decimals >= 0 && metadata.decimals <= 36
    ? { address: typeof metadata.address === "string" ? metadata.address : null, symbol: metadata.symbol, decimals: metadata.decimals } : null;
  const bps = Number(paid?.bps ?? quoted?.bps);
  return {
    collected: paidAmountRaw !== null ? BigInt(paidAmountRaw) > 0n : (paidUsd ?? 0) > 0,
    quotedUsd: usdNumber(quoted?.amountUsd),
    paidUsd,
    paidAmountRaw,
    currency,
    basisPoints: Number.isInteger(bps) && bps >= 0 && bps <= 10_000 ? bps : null,
    settlement: {
      userPaidRaw: paidAmountRaw,
      providerRaw: paidAmountRaw === null ? null : "0",
      ryntraRaw: paidAmountRaw,
      basis: "OBSERVED",
      operationRef,
    },
  };
}

/**
 * What arrived, from v3's route object.
 *
 * Only `actual` supplies a received amount. `quoted` can identify that a
 * destination phase exists, but contributes no amount. The origin output of
 * a cross-chain route is an intermediate asset, not the recipient's fill.
 */
function receivedAmountV3(data: Record<string, unknown> | null): string | null {
  const route = record(data?.route);
  const actual = record(route?.actual);
  if (!actual) return null;
  // A destination phase in the quoted route identifies a cross-chain request.
  // Its origin output is an intermediate asset, never the recipient's fill.
  const crossChain = record(route?.quoted)?.destination != null || actual.destination != null;
  const side = record(crossChain ? actual.destination : actual.origin);
  return humanAmount(record(side?.outputCurrency)?.amountFormatted);
}

async function readJson(
  url: string,
  deps: RelayRequestsDependencies,
  auth: RelayAuth,
): Promise<Record<string, unknown> | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 10_000);
  try {
    const response = await fetchImpl(url, { method: "GET", headers: relayHeaders(auth), signal: controller.signal });
    if (!response.ok) return null;
    return record(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function firstRequest(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  const requests = payload?.requests;
  return Array.isArray(requests) && requests.length > 0 ? record(requests[0]) : null;
}

async function readV3(sourceTxHash: string, deps: RelayRequestsDependencies): Promise<RelayFinishedRequest | null> {
  const url = new URL(RELAY_REQUESTS_V3_PATH, deps.origin ?? RELAY_API_ORIGIN);
  url.searchParams.set("depositTxHash", sourceTxHash);
  url.searchParams.set("limit", "1");
  const request = firstRequest(await readJson(url.toString(), deps, { apiKey: deps.apiKey }));
  if (request === null) return null;
  const data = record(request.data);
  const appFees = record(data?.appFees);
  return {
    toAmount: receivedAmountV3(data),
    serviceFee: Array.isArray(appFees?.actual) ? serviceFeeFrom(firstAppFee(appFees?.quoted), firstAppFee(appFees?.actual), sourceTxHash, appFees?.currency) : null,
    version: "v3",
  };
}

async function readV2(sourceTxHash: string, deps: RelayRequestsDependencies): Promise<RelayFinishedRequest | null> {
  const url = new URL(RELAY_REQUESTS_V2_PATH, deps.origin ?? RELAY_API_ORIGIN);
  url.searchParams.set("hash", sourceTxHash);
  /* No key is sent on the rollback path: v2 answers anonymously, and this branch
     exists precisely for the deployment that has no key to send. */
  const request = firstRequest(await readJson(url.toString(), deps, {}));
  if (request === null) return null;
  const data = record(request.data);
  const metadata = record(data?.metadata);
  /* v2 states the fill under `data.metadata.currencyOut`; the top-level
     `data.currencyOut` is null on this route. Both are read, the nested one
     first, and the fee fields the same way. */
  const amount = humanAmount(record(metadata?.currencyOut)?.amountFormatted ?? record(data?.currencyOut)?.amountFormatted);
  const quoted = firstAppFee(metadata?.appFees ?? data?.appFees);
  const actual = metadata?.paidAppFees ?? data?.paidAppFees;
  const paid = firstAppFee(actual);
  return { toAmount: amount, serviceFee: Array.isArray(actual) ? serviceFeeFrom(quoted, paid, sourceTxHash, data?.appFeeCurrencyObject ?? metadata?.appFeeCurrencyObject) : null, version: "v2" };
}

/**
 * Read the finished request, preferring v3 and falling back to v2.
 *
 * A failure here costs the amount and nothing else: the order is still complete
 * and the destination transaction is still on the record, which is the thing
 * anybody can check independently.
 */
export async function fetchRelayFinishedRequest(
  sourceTxHash: string,
  deps: RelayRequestsDependencies = {},
): Promise<RelayFinishedRequest | null> {
  const hasKey = typeof deps.apiKey === "string" && deps.apiKey.trim().length > 0;
  if (hasKey) {
    const v3 = await readV3(sourceTxHash, deps);
    if (v3 !== null) return v3;
  }
  return readV2(sourceTxHash, deps);
}
