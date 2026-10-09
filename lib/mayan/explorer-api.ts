/**
 * Mayan explorer API — where a cross-chain swap is, read from the provider.
 *
 * `GET explorer-api.mayan.finance/v3/swap/trx/{hash}` answers for the source
 * transaction (a Solana signature or an EVM hash). Its `clientStatus` is the
 * only tri-state the card shows a person; the granular `status` and every hash
 * are kept for the order record and the Pro disclosure. A `404` means Mayan has
 * not indexed the transaction yet — that is `found: false`, not an error, and
 * never a reason to submit anything again.
 */

import { z } from "zod";

import type { CrossSwapClientStatus, CrossSwapProviderLookup, CrossSwapProviderStatus } from "../swap/cross-swap-status.ts";

/* The provider status shape now lives beside the catalog, because Relay has
   to answer in it too. Re-exported here so every existing importer of this
   module keeps working unchanged. `MayanClientStatus` keeps its old name as
   an alias of the shared one. */
export type { CrossSwapClientStatus, CrossSwapProviderLookup, CrossSwapProviderStatus };
export type MayanClientStatus = CrossSwapClientStatus;

export const MAYAN_EXPLORER_API_ORIGIN = "https://explorer-api.mayan.finance";

const ResponseSchema = z
  .object({
    clientStatus: z.enum(["INPROGRESS", "COMPLETED", "REFUNDED"]).optional(),
    status: z.string().optional(),
    service: z.string().optional(),
    orderId: z.string().optional(),
    orderHash: z.string().optional(),
    sourceTxHash: z.string().optional(),
    fulfillTxHash: z.string().nullable().optional(),
    redeemTxHash: z.string().nullable().optional(),
    refundTxHash: z.string().nullable().optional(),
    unlockTxHash: z.string().nullable().optional(),
    toAmount: z.union([z.number(), z.string()]).nullable().optional(),
    toAmount64: z.string().nullable().optional(),
    refundAmount: z.union([z.number(), z.string()]).nullable().optional(),
    refundChain: z.string().nullable().optional(),
    refundTokenAddress: z.string().nullable().optional(),
    refundTokenSymbol: z.string().nullable().optional(),
    /* The applied referrer rate and Mayan's own share, both stated by
       `/v3/swaps` on a finished swap. Read 2026-09-10; the first version of this
       parser had neither and reported their absence as the provider's. */
    referrerBps: z.number().nullable().optional(),
    mayanBps: z.number().nullable().optional(),
    initiatedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
    statusUpdatedAt: z.string().nullable().optional(),
  })
  .passthrough();

export type MayanExplorerDependencies = Readonly<{
  fetchImpl?: typeof fetch;
  now?: () => Date;
  origin?: string;
  timeoutMs?: number;
}>;

const HASH = /^[1-9A-HJ-NP-Za-km-z]{64,90}$|^0x[0-9a-fA-F]{64}$/;

/**
 * What Mayan says happened to the referrer fee on a finished swap.
 *
 * `referrerBps` is the rate that was **applied**, not the rate that was asked
 * for, and the difference is the whole point: Mayan answers `0` on the routes
 * that earn nothing however the quote was set — a plain USDC-to-USDC MCTP
 * transfer has no destination swap, and a Wormhole transfer that does not swap
 * does not qualify.
 *
 * A rate is not an amount. The fee is taken from a different asset on a
 * different chain per method, so no raw figure is derived here from bps; the
 * amount stays `null` and the fee is therefore never counted as income. That
 * gap is exactly why this lane's Mayan fee is not switched on.
 */
function readMayanReferrerSettlement(
  data: Readonly<{ referrerBps?: number | null; clientStatus?: string | null }>,
): CrossSwapProviderStatus["serviceFee"] {
  const bps = data.referrerBps;
  if (typeof bps !== "number") return null;
  const finished = data.clientStatus === "COMPLETED";
  return {
    /* Applied, and only on an order that completed — Mayan pays a referrer fee
       on completion, never on a refund. */
    collected: finished && bps > 0,
    quotedUsd: null,
    paidUsd: null,
    /* Deliberately unread: see the note above. */
    paidAmountRaw: null,
  };
}

export function buildMayanStatusUrl(sourceTxHash: string, origin: string = MAYAN_EXPLORER_API_ORIGIN): string {
  if (!HASH.test(sourceTxHash)) throw new TypeError("A source transaction is a base58 signature or a 0x hash.");
  return new URL(`/v3/swap/trx/${sourceTxHash}`, origin).toString();
}

export async function fetchMayanSwapStatus(sourceTxHash: string, deps: MayanExplorerDependencies = {}): Promise<CrossSwapProviderLookup> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const observedAt = now().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 10_000);
  let response: Response;
  try {
    response = await fetchImpl(buildMayanStatusUrl(sourceTxHash, deps.origin), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    return { found: false, reason: "TRANSPORT", status: null, message: error instanceof Error ? error.message : String(error), observedAt };
  }
  clearTimeout(timer);
  if (response.status === 404) return { found: false, reason: "NOT_INDEXED", observedAt };
  if (response.status === 429) return { found: false, reason: "RATE_LIMITED", status: 429, message: "Mayan is rate-limiting status reads.", observedAt };
  if (!response.ok) return { found: false, reason: "HTTP_ERROR", status: response.status, message: `Mayan answered HTTP ${response.status}.`, observedAt };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { found: false, reason: "UNREADABLE", status: response.status, message: "Mayan's status answer was not JSON.", observedAt };
  }
  const parsed = ResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return { found: false, reason: "UNREADABLE", status: response.status, message: "Mayan's status answer did not have the expected shape.", observedAt };
  }
  return normalizeMayanSwapStatus(parsed.data, observedAt);
}

export function normalizeMayanSwapStatus(data: z.output<typeof ResponseSchema>, observedAt: string): CrossSwapProviderStatus {
  const refund =
    data.refundTxHash || data.refundAmount != null || data.refundTokenAddress
      ? {
          chain: data.refundChain ?? null,
          tokenAddress: data.refundTokenAddress ?? null,
          tokenSymbol: data.refundTokenSymbol ?? null,
          amount: data.refundAmount == null ? null : String(data.refundAmount),
        }
      : null;
  return {
    found: true,
    clientStatus: data.clientStatus ?? null,
    status: data.status ?? null,
    service: data.service ?? null,
    orderId: data.orderId ?? data.orderHash ?? null,
    sourceTxHash: data.sourceTxHash ?? null,
    destinationTxHash: data.fulfillTxHash ?? data.redeemTxHash ?? null,
    refundTxHash: data.refundTxHash ?? null,
    toAmount: data.toAmount == null ? null : String(data.toAmount),
    /* Mayan **does** state the applied referrer rate
       on a finished swap: `/v3/swaps` carries `referrerBps` and `mayanBps` beside
       `service`, `fromAmount` and `toAmount`. The first pass here read no such
       field and concluded there was none to read, which was a fact about this
       parser rather than about Mayan.

       What is stated is the **rate**, and this lane's fee is off until the raw
       amount is read back as well — the rate is applied to a different asset on a
       different chain per method (`referrer.ts`), so a raw amount cannot be
       inferred from bps alone. Until then `null` means *not read yet*, and
       nothing counts a Mayan fee as income. */
    serviceFee: readMayanReferrerSettlement(data),
    refund,
    completedAt: data.completedAt ?? null,
    statusUpdatedAt: data.statusUpdatedAt ?? null,
    observedAt,
  };
}
