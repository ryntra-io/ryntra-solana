import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import {
  applyCrossSwapProviderStatus,
  crossSwapRecovery,
  expireReservedCrossSwap,
  markCrossSwapChecked,
  markCrossSwapSourceFailed,
  readCrossSwapOrder,
  type CrossSwapOrderRecord,
} from "@/lib/mayan/cross-swap-order";
import { historyDestinationFor } from "@/lib/swap/cross-swap-service";
import { resolveCrossSwapCanary, type CrossSwapCanaryResolution } from "@/lib/solana/cross-swap-canary-record";
import { resolveSolanaCrossSwapRouteState } from "@/lib/solana/lane-state";
import { fetchMayanSwapStatus } from "@/lib/mayan/explorer-api";
import { fetchRelayIntentStatus } from "@/lib/relay/status-api";
import { crossSwapOutcome, recordSolanaAction } from "@/lib/solana/action-ledger";
import { measuredFeeBps } from "@/lib/solana/cross-swap-receipt";
import type { CrossSwapProviderStatus } from "@/lib/swap/cross-swap-status";
import { recordCrossSwapBenefits, refreshCrossSwapBenefits } from "@/lib/rewards/cross-swap-settlement.server";
import { createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import { parseHumanAmount } from "@/lib/swap/catalog";
import { resolveRelayApiKey } from "@/lib/relay/api-key.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Declared like its siblings: an undeclared budget is a bodyless 502 with nothing logged. */
export const maxDuration = 30;

/**
 * Where a cross-chain swap is — read from the record, the source chain and
 * Mayan, in that order, and written back.
 *
 * This is also the reload path: a card that finds an intent digest in the
 * browser asks here and gets the same answer a fresh tab would. It reads and
 * records; it never builds, signs or sends, and it has no way to.
 */

const RequestSchema = z.object({ intentDigest: z.string().regex(/^0x[0-9a-f]{64}$/) }).strict();

function headers(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}
function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: headers(rate) });
}

function view(record: CrossSwapOrderRecord) {
  const recovery = crossSwapRecovery(record);
  return {
    intentDigest: record.intentDigest,
    state: record.state,
    attempt: record.attempt,
    tuple: record.tupleId,
    route: record.route,
    from: { network: record.sourceChain, symbol: record.fromSymbol, decimals: record.fromDecimals, amountRaw: record.amountInRaw, wallet: record.sourceWallet },
    to: { network: record.destinationChain, symbol: record.toSymbol, decimals: record.toDecimals, expectedRaw: record.expectedOutRaw, minimumRaw: record.minimumOutRaw, wallet: record.destinationWallet },
    deadlineUnix: record.deadlineUnix,
    sourceTxHash: record.sourceTxHash,
    destinationTxHash: record.destinationTxHash,
    refundTxHash: record.refundTxHash,
    receivedAmount: record.receivedAmount,
    refund: record.refund,
    providerStatus: record.providerStatus,
    reservedAt: record.reservedAt,
    updatedAt: record.updatedAt,
    lastCheckedAt: record.lastCheckedAt,
    recovery,
    shouldPollAgain: recovery.inMotion,
  };
}

/**
 * A controlled operation that has reached an end state returns the route to
 * closed, and records how it ended.
 *
 * Called wherever the status route settles an order. It is deliberately
 * idempotent and deliberately one-directional: every resolution closes, none
 * opens. `OPEN` is a decision a person takes afterwards, with the report in
 * front of them, by changing the variable themselves — nothing in this file
 * can reach it.
 */
const CANARY_RESOLUTION: Partial<Record<CrossSwapOrderRecord["state"], CrossSwapCanaryResolution>> = {
  COMPLETED: "SUCCESS",
  SOURCE_FAILED: "FAILED",
  REFUNDED: "REFUNDED",
  /* Resolved by reading, which is what `RECOVERY_REQUIRED` means once somebody
     has looked: the operation is over either way and the route stays closed. */
  RECOVERY_REQUIRED: "RECOVERED",
};

async function settleCanary(store: ReturnType<typeof getGuardRuntime>["store"], record: CrossSwapOrderRecord, now: string) {
  const resolution = CANARY_RESOLUTION[record.state];
  if (!resolution) return;
  if (resolveSolanaCrossSwapRouteState(record.sourceChain, record.destinationChain) !== "CANARY") return;
  await resolveCrossSwapCanary(store, resolution, now);
}

/**
 * The Solana wallet a cross-chain operation belongs to, or null.
 *
 * History and Rewards are both scoped to a Solana address, and this lane can in
 * principle carry a pair with Solana on neither side. Naming that case returns
 * null rather than crediting an EVM address into a ledger whose entries are
 * claimed on Solana.
 */
function solanaWalletOf(record: CrossSwapOrderRecord): string | null {
  if (record.sourceChain === "solana") return record.sourceWallet;
  if (record.destinationChain === "solana") return record.destinationWallet;
  return null;
}

/**
 * The fee as the row states it: what was charged, and whether it was taken.
 *
 * Read from the provider's report of this fill and from nowhere else. A lookup
 * that has nothing to say leaves the row's fee untouched rather than writing a
 * zero, because a zero here would read as "this cost you nothing".
 */
function feeForRow(record: CrossSwapOrderRecord, lookup: CrossSwapProviderStatus | null) {
  const fee = lookup?.serviceFee;
  if (!fee) return undefined;
  const amountRaw = fee.settlement?.userPaidRaw ?? fee.paidAmountRaw ?? null;
  return {
    collected: fee.collected,
    /* Measured against what was sent, never assumed from the current rate: an
       order quoted before the rate changed paid what it paid. */
    basisPoints: fee.basisPoints !== undefined ? fee.basisPoints : measuredFeeBps(amountRaw, record.amountInRaw),
    amountRaw,
    decimals: fee.currency !== undefined ? fee.currency?.decimals ?? null : record.fromDecimals,
    symbol: fee.currency !== undefined ? fee.currency?.symbol ?? null : record.fromSymbol,
    usd: fee.paidUsd ?? null,
    /* The fee is taken in the asset that was sent, and Relay states the split
       itself: none of it is Relay's, whose own charge is a separate line. */
    asset: fee.currency?.address ?? null,
    providerRaw: fee.settlement?.providerRaw ?? null,
    ryntraRaw: fee.settlement?.ryntraRaw ?? null,
  };
}

async function syncHistory(
  store: ReturnType<typeof getGuardRuntime>["store"],
  record: CrossSwapOrderRecord,
  now: string,
  lookup: CrossSwapProviderStatus | null = null,
) {
  /* Read off the record, never by finding the pair in a list. The list is a
     shortlist since the lane widened which assets it carries, so a lookup
     would miss every pair outside it — and this function returns early on a
     miss, which would leave money moving with History silent about it. */
  const receivedRaw = record.state === "COMPLETED" && record.receivedAmount ? parseHumanAmount(record.receivedAmount, record.toDecimals) : null;
  const wallet = solanaWalletOf(record) ?? record.destinationWallet;
  const fee = feeForRow(record, lookup);
  return recordSolanaAction(store, {
    network: "mainnet",
    wallet,
    actionId: record.intentDigest,
    lane: "CROSS_SWAP",
    outcome: crossSwapOutcome(record.state),
    out: { mint: null, amountRaw: record.amountInRaw, decimals: record.fromDecimals, symbol: record.fromSymbol },
    ...(receivedRaw ? { in: { mint: null, amountRaw: receivedRaw, decimals: record.toDecimals, symbol: record.toSymbol } } : {}),
    destination: historyDestinationFor(record.destinationChain),
    ...(record.sourceTxHash && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(record.sourceTxHash) ? { signature: record.sourceTxHash } : {}),
    /* Both chains' own transactions, in the shape each chain uses. The
       base58-only `signature` above cannot hold an EVM hash, which is why a
       row whose money left Base had no link to anything at all. */
    ...(record.sourceTxHash ? { sourceTx: record.sourceTxHash } : {}),
    ...(record.destinationTxHash ? { destinationTx: record.destinationTxHash } : {}),
    ...(fee ? { fee } : {}),
    now,
  });
}

export async function POST(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", "The status request did not match its schema.", rate);

  const store = getGuardRuntime().store;
  const read = await readCrossSwapOrder({ store, intentDigest: parsed.data.intentDigest });
  if (!read.ok) return failure(read.code === "CROSS_SWAP_ORDER_ABSENT" ? 404 : 503, read.code, read.reason, rate);
  let record = read.record;
  const now = new Date().toISOString();

  if (record.state === "RESERVED" && record.provider === "RELAY" && Date.parse(now) >= record.deadlineUnix * 1000) {
    const expired = await expireReservedCrossSwap({ store, intentDigest: record.intentDigest, at: now });
    if (expired.ok) record = expired.record;
    else if (expired.record) record = expired.record;
  }

  if (record.state === "RESERVED" || record.state === "EXPIRED_BEFORE_SUBMIT" || record.state === "SOURCE_FAILED" || record.state === "COMPLETED" || record.state === "REFUNDED") {
    if (record.state === "COMPLETED") await refreshCrossSwapBenefits(store, record.intentDigest, { now }).catch(() => undefined);
    return Response.json({ order: view(record), provider: null, observedAt: now }, { headers: headers(rate) });
  }
  const sourceTxHash = record.sourceTxHash;
  /* Relay is asked about the *intent*, by the request id the quote returned
     and the record kept, so it can answer for an order whose source hash
     never came back — the SUBMITTED_UNKNOWN case, which is exactly the one
     somebody needs an answer to. Mayan is asked by source transaction and
     has nothing to say until there is one. */
  const relayRequestId = record.provider === "RELAY" ? record.quoteId : null;
  if (!sourceTxHash && !relayRequestId) {
    /* The boundary was crossed and nothing came back. Reading only. */
    return Response.json({ order: view(record), provider: null, observedAt: now }, { headers: headers(rate) });
  }

  /* A Solana source that landed and failed moved nothing; say so before asking the provider. */
  if (sourceTxHash && record.sourceChain === "solana" && record.state === "SUBMITTED") {
    try {
      const handle = createSolanaRpcHandle({ network: "mainnet" });
      const statuses = await withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc.getSignatureStatuses([sourceTxHash as never], { searchTransactionHistory: true }).send({ abortSignal }),
      );
      const status = statuses.value[0];
      if (status && status.err !== null && status.err !== undefined) {
        const failed = await markCrossSwapSourceFailed({ store, intentDigest: record.intentDigest, at: now });
        if (failed.ok) {
          record = failed.record;
          await syncHistory(store, record, now);
          await settleCanary(store, record, now);
          return Response.json({ order: view(record), provider: null, observedAt: now }, { headers: headers(rate) });
        }
      }
    } catch {
      /* An unreadable cluster is not a failed order; the provider is asked next. */
    }
  }

  /* The provider asked is the one the record says carried this order, never
     the one the networks suggest: an order is read back long after the
     classifier that chose its provider, and asking the wrong one would
     report a live order as one nobody has heard of. */
  const lookup = relayRequestId
    ? await fetchRelayIntentStatus(relayRequestId, { apiKey: resolveRelayApiKey() })
    : await fetchMayanSwapStatus(sourceTxHash as string);
  if (!lookup.found) {
    const checked = await markCrossSwapChecked({ store, intentDigest: record.intentDigest, at: now });
    if (checked.ok) record = checked.record;
    return Response.json(
      { order: view(record), provider: { found: false, reason: lookup.reason }, observedAt: now },
      { headers: headers(rate) },
    );
  }
  const applied = await applyCrossSwapProviderStatus({ store, intentDigest: record.intentDigest, status: lookup, at: now });
  if (applied.ok) {
    record = applied.record;
    if (record.state === "COMPLETED") await recordCrossSwapBenefits(store, record, lookup, { now });
    else await syncHistory(store, record, now, lookup);
    await settleCanary(store, record, now);
    /*
     * Rewards, for the Solana wallet this operation belongs to.
     *
     * This used to require `record.sourceChain === "solana"`, on the reasoning
     * that the source wallet is the one that paid. The reasoning was right and
     * the condition was wrong, and the first two real fills proved it: both
     * started on an EVM chain — Base and Robinhood Chain — Relay confirmed both
     * fees as *paid*, and neither reached the ledger. The direction the money
     * travelled is not a fact about whose fee it was.
     *
     * What the condition was protecting is real and is kept: a cross-chain
     * order's other side may be somebody else's address entirely, and a reward
     * is claimed on Solana. So the entry is keyed to the Solana wallet on this
     * order, and a pair with Solana on neither side accrues nothing rather than
     * crediting an address that could never claim it.
     *
     * Keyed by the provider's own operation reference, so polling a finished
     * order writes the same rows rather than new income, and non-fatal like
     * every other reward write.
     */

  }
  return Response.json(
    {
      order: view(record),
      provider: { found: true, clientStatus: lookup.clientStatus, status: lookup.status, destinationTxHash: lookup.destinationTxHash, refund: lookup.refund, statusUpdatedAt: lookup.statusUpdatedAt },
      observedAt: now,
    },
    { headers: headers(rate) },
  );
}
