/**
 * Relay execution status — where a Robinhood Chain swap is, read from Relay.
 *
 * `GET api.relay.link/intents/status/v3?requestId=…`. The request id is the
 * one the quote returned and the order record kept; unlike Mayan, Relay is
 * asked about the *intent*, not about the source transaction, so a status can
 * be read before the deposit has even been indexed.
 *
 * The endpoint is chosen rather than copied: every quote's own `check` object
 * still names `/intents/status`, which Relay's documentation marks deprecated
 * in favour of v3. v3 is the same question with the answers this lane actually
 * needs — a distinct `refund` state, and `failReason`/`refundFailReason` for
 * the operator trail. Its status enum was read from Relay's OpenAPI document
 * on 2026-09-09, not from a blog post: `refund`, `waiting`, `depositing`,
 * `failure`, `pending`, `submitted`, `success`.
 *
 * ## The one mapping that matters
 *
 * A person sees three things, and `failure` is deliberately not one of them.
 * Relay reports `failure` for an intent that never got its deposit as well as
 * for one that got it and could not be filled — the difference is whether
 * value moved, and it is not in this field. So `failure` maps to a null
 * client status and the order state machine decides from what it already knows
 * about the source transaction. A lane that guessed here would either tell
 * somebody their money is safe when it has left, or open a recovery for an
 * intent that never started.
 */

import { z } from "zod";

import type { CrossSwapClientStatus, CrossSwapProviderLookup, CrossSwapProviderStatus } from "../swap/cross-swap-status.ts";
import { RELAY_API_ORIGIN } from "./chains.ts";
import { relayHeaders } from "./http.ts";
import { fetchRelayFinishedRequest } from "./requests-api.ts";

export const RELAY_STATUS_PATH = "/intents/status/v3";
/*
 * What the fill actually paid lives one endpoint away, in `requests-api.ts`.
 *
 * This endpoint reports whether an intent succeeded and the two transaction
 * hashes, and nothing about amounts — which is what left History saying "Swapped
 * across chains 0.05 SOL" with no idea what came back. The Requests endpoint
 * carries the received amount and both app-fee phases, and is asked by the
 * **source transaction hash** the status answer here provides. It is read only
 * once an intent has finished, because before then there is no fill to report and
 * every poll would pay for the question.
 */

export const RELAY_STATUSES = ["refund", "waiting", "depositing", "failure", "pending", "submitted", "success"] as const;
export type RelayStatus = (typeof RELAY_STATUSES)[number];

const ResponseSchema = z
  .object({
    status: z.string().optional(),
    details: z.string().optional(),
    inTxHashes: z.array(z.string()).nullable().optional(),
    txHashes: z.array(z.string()).nullable().optional(),
    updatedAt: z.union([z.string(), z.number()]).nullable().optional(),
    originChainId: z.number().nullable().optional(),
    destinationChainId: z.number().nullable().optional(),
    quoteCreatedAt: z.union([z.string(), z.number()]).nullable().optional(),
    failReason: z.string().nullable().optional(),
    refundFailReason: z.string().nullable().optional(),
  })
  .passthrough();

export type RelayStatusDependencies = Readonly<{
  fetchImpl?: typeof fetch;
  now?: () => Date;
  origin?: string;
  timeoutMs?: number;
  /**
   * Ryntra's Relay API key, resolved by the server route that calls this.
   *
   * Not read from the environment here: this module is importable by a surface a
   * browser loads. Absent, the status read is anonymous — which Relay still
   * answers — and the fill is read from the deprecated v2 endpoint rather than
   * from v3, which refuses an unauthenticated call.
   */
  apiKey?: string | null;
}>;

const REQUEST_ID = /^0x[0-9a-fA-F]{64}$/;

export function buildRelayStatusUrl(requestId: string, origin: string = RELAY_API_ORIGIN): string {
  if (!REQUEST_ID.test(requestId)) throw new TypeError("A Relay request id is a 0x-prefixed 32-byte hex string.");
  const url = new URL(RELAY_STATUS_PATH, origin);
  url.searchParams.set("requestId", requestId);
  return url.toString();
}

/**
 * Relay's status in the tri-state a person is shown, or null when the answer
 * does not decide it. See the module note on `failure`.
 */
export function relayClientStatus(status: string | null): CrossSwapClientStatus | null {
  switch (status) {
    case "success":
      return "COMPLETED";
    case "refund":
      return "REFUNDED";
    case "waiting":
    case "depositing":
    case "pending":
    case "submitted":
      return "INPROGRESS";
    default:
      return null;
  }
}

function timestamp(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  /* Relay states seconds; a millisecond reading would put every timestamp in
     1970 and make a fresh order look stale to anything that compares them. */
  const ms = value < 1e12 ? value * 1000 : value;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeRelayStatus(data: z.output<typeof ResponseSchema>, observedAt: string): CrossSwapProviderStatus {
  const status = data.status ?? null;
  const clientStatus = relayClientStatus(status);
  const destinationTxHash = data.txHashes?.at(-1) ?? null;
  const sourceTxHash = data.inTxHashes?.[0] ?? null;
  /* Relay pays a refund on the source chain and reports it in the same
     `txHashes` array as a fill. Only a `refund` status makes that hash a
     refund, so the two are never both populated from one field. */
  const refunded = status === "refund";
  const reason = data.failReason ?? data.refundFailReason ?? null;
  return {
    found: true,
    clientStatus,
    status: reason === null ? status : `${status ?? "unknown"}: ${reason}`,
    service: "relay",
    orderId: null,
    sourceTxHash,
    destinationTxHash: refunded ? null : destinationTxHash,
    refundTxHash: refunded ? destinationTxHash : null,
    /* Filled in by the caller from the Requests endpoint once the intent is
       finished; this endpoint carries no amount at all — and says nothing about
       app fees either, so both arrive from the same later read. */
    toAmount: null,
    serviceFee: null,
    refund: refunded ? { chain: null, tokenAddress: null, tokenSymbol: null, amount: null } : null,
    completedAt: clientStatus === "COMPLETED" ? timestamp(data.updatedAt) : null,
    statusUpdatedAt: timestamp(data.updatedAt),
    observedAt,
  };
}

export async function fetchRelayIntentStatus(requestId: string, deps: RelayStatusDependencies = {}): Promise<CrossSwapProviderLookup> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const observedAt = now().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 10_000);
  let response: Response;
  try {
    response = await fetchImpl(buildRelayStatusUrl(requestId, deps.origin), {
      method: "GET",
      headers: relayHeaders({ apiKey: deps.apiKey }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    return { found: false, reason: "TRANSPORT", status: null, message: error instanceof Error ? error.message : String(error), observedAt };
  }
  clearTimeout(timer);
  if (response.status === 404) return { found: false, reason: "NOT_INDEXED", observedAt };
  if (response.status === 429) return { found: false, reason: "RATE_LIMITED", status: 429, message: "Relay is rate-limiting status reads.", observedAt };
  if (!response.ok) return { found: false, reason: "HTTP_ERROR", status: response.status, message: `Relay answered HTTP ${response.status}.`, observedAt };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { found: false, reason: "UNREADABLE", status: response.status, message: "Relay's status answer was not JSON.", observedAt };
  }
  const parsed = ResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return { found: false, reason: "UNREADABLE", status: response.status, message: "Relay's status answer did not have the expected shape.", observedAt };
  }
  /* Relay answers 200 with `unknown` for an intent it has never seen — the
     same thing Mayan says with a 404, and the same thing this lane must not
     treat as a failure. */
  if ((parsed.data.status ?? "unknown") === "unknown") return { found: false, reason: "NOT_INDEXED", observedAt };
  const normalized = normalizeRelayStatus(parsed.data, observedAt);
  if (normalized.clientStatus !== "COMPLETED") return normalized;
  /* What the fill paid, in Relay's own words. A failure here costs the amount
     and nothing else: the order is still COMPLETED and History still carries
     the destination transaction, which is the thing anyone can check. */
  if (!normalized.sourceTxHash) return normalized;
  const filled = await fetchRelayFinishedRequest(normalized.sourceTxHash, deps);
  if (filled === null) return normalized;
  return { ...normalized, toAmount: filled.toAmount ?? normalized.toAmount, serviceFee: filled.serviceFee };
}
