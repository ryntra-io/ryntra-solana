import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { loadIssuerKey } from "@/lib/agent-control/issuer";
import { OutcomeReceiptArtifactSchema } from "@/lib/agent-control/artifacts";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import {
  markCrossSwapReceipted,
  readCrossSwapOrder,
  type CrossSwapOrderRecord,
} from "@/lib/mayan/cross-swap-order";
import { fetchMayanSwapStatus } from "@/lib/mayan/explorer-api";
import { fetchRelayIntentStatus } from "@/lib/relay/status-api";
import { resolveRelayApiKey } from "@/lib/relay/api-key.server";
import { recordCrossSwapBenefits, refreshCrossSwapBenefits } from "@/lib/rewards/cross-swap-settlement.server";
import { crossSwapOutcome, recordSolanaAction } from "@/lib/solana/action-ledger";
import { crossSwapReceiptFacts, mintCrossSwapOutcomeReceipt } from "@/lib/solana/cross-swap-receipt";
import { verifySolanaOutcomeReceipt } from "@/lib/solana/receipt";
import { historyDestinationFor } from "@/lib/swap/cross-swap-service";
import { parseHumanAmount } from "@/lib/swap/catalog";
import type { CrossSwapProviderStatus } from "@/lib/swap/cross-swap-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The receipt for a finished cross-chain operation.
 *
 * The Bridge page had no such document. Send, Swap and the CCTP bridge each
 * ended in a signed `OUTCOME_RECEIPT@2.0.0`; the lane a person is actually sent
 * to when they want funds on Solana ended in a History row and nothing to keep.
 *
 * ## Why this route is also the healing path
 *
 * `../status` returns early for an order that has already reached a terminal
 * state — correctly, because polling a finished order should not keep paying
 * for the provider call. The consequence is that an order which completed
 * before a field existed never gains it. Both real fills of 2026-09-11 are in
 * exactly that position: completed, fee collected by Relay, and no fee, no
 * transaction hashes and no reward anywhere in this product.
 *
 * So issuing a receipt reads the fill once, writes down everything it learns —
 * the fee, both chains' transactions, the amount that actually arrived — and
 * records the rewards that were never recorded. One provider call, at the one
 * moment there is a reason to make it.
 *
 * ## Minted once
 *
 * A stored receipt is returned as it was stored, never rebuilt. `createdAt` and
 * the issuer signature move with the clock, so a second mint over identical
 * facts is a different content hash — and the hash is what the Activity row was
 * written with.
 */

const RequestSchema = z.object({ intentDigest: z.string().regex(/^0x[0-9a-f]{64}$/) }).strict();

function headers(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}
function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: headers(rate) });
}

/** The states a statement may be made about. Everything else is still moving. */
const TERMINAL: readonly CrossSwapOrderRecord["state"][] = ["COMPLETED", "REFUNDED", "SOURCE_FAILED", "EXPIRED_BEFORE_SUBMIT"];

function solanaWalletOf(record: CrossSwapOrderRecord): string | null {
  if (record.sourceChain === "solana") return record.sourceWallet;
  if (record.destinationChain === "solana") return record.destinationWallet;
  return null;
}

function verified(receipt: unknown, publicKey: string | null) {
  const parsed = OutcomeReceiptArtifactSchema.safeParse(receipt);
  if (!parsed.success) return null;
  const check = verifySolanaOutcomeReceipt(parsed.data, {
    trustedPublicKeys: publicKey ? [publicKey] : undefined,
  });
  return {
    recognised: check.recognised,
    schemaValid: check.schema.valid,
    integrityValid: check.integrity.valid,
    issuer: check.issuer.verdict,
    binding: check.binding.verdict,
  };
}

export async function POST(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", "The receipt request did not match its schema.", rate);

  const store = getGuardRuntime().store;
  const read = await readCrossSwapOrder({ store, intentDigest: parsed.data.intentDigest });
  if (!read.ok) return failure(read.code === "CROSS_SWAP_ORDER_ABSENT" ? 404 : 503, read.code, read.reason, rate);
  const record = read.record;
  const issuerKey = loadIssuerKey();

  /* The one already issued, exactly as it was issued. */
  if (record.receipt !== null && record.receiptHash !== null) {
    const stored = OutcomeReceiptArtifactSchema.safeParse(record.receipt);
    if (stored.success) {
      if (record.state === "COMPLETED") await refreshCrossSwapBenefits(store, record.intentDigest, { now: new Date().toISOString() }).catch(() => undefined);
      return Response.json(
        {
          data: {
            receipt: stored.data,
            receiptHash: record.receiptHash,
            issued: false,
            verification: verified(stored.data, issuerKey?.publicKey ?? null),
          },
        },
        { headers: headers(rate) },
      );
    }
    /* A stored document that will not parse is not a licence to mint a second
       one under a hash the row already names. It is a fault to report. */
    return failure(503, "RECEIPT_UNREADABLE", "A receipt is recorded for this operation but could not be read back.", rate);
  }

  if (!TERMINAL.includes(record.state)) {
    return failure(409, "CROSS_SWAP_IN_MOTION", "This operation has not finished, so there is nothing to state about it yet.", rate);
  }
  if (!issuerKey) {
    return failure(503, "RECEIPT_NOT_SIGNED", "This deployment has no document-signing key, so it cannot issue a receipt.", rate);
  }

  /*
   * The fill, read once.
   *
   * Only a completed order has one, and only a completed order has a fee that
   * was taken. A refused or refunded order is stated from the record alone —
   * asking the provider about it would buy nothing the record does not already
   * hold.
   */
  const now = new Date().toISOString();
  let lookup: CrossSwapProviderStatus | null = null;
  if (record.state === "COMPLETED") {
    const relayRequestId = record.provider === "RELAY" ? record.quoteId : null;
    const answer = relayRequestId
      ? await fetchRelayIntentStatus(relayRequestId, { apiKey: resolveRelayApiKey() })
      : record.sourceTxHash
        ? await fetchMayanSwapStatus(record.sourceTxHash)
        : null;
    if (answer?.found) lookup = answer;
  }

  const minted = mintCrossSwapOutcomeReceipt({
    id: `outcome_solana_cross_swap_${record.intentDigest.slice(2, 18)}`,
    /* The order's own Review digest, written by the server at plan time. No
       client-supplied proof is accepted here, and none is needed: the binding
       is already durable and a caller cannot reach past it. */
    actionPassportHash: record.reviewDigest,
    facts: crossSwapReceiptFacts(record, lookup, now, parseHumanAmount),
  });
  if (!minted.ok) return failure(422, minted.code, minted.reason, rate);
  if (record.state === "COMPLETED") await recordCrossSwapBenefits(store, record, lookup, { now });

  const attached = await markCrossSwapReceipted({
    store,
    intentDigest: record.intentDigest,
    receiptHash: minted.receipt.contentHash,
    receipt: minted.receipt,
    at: now,
  });
  if (!attached.ok) {
    /*
     * Two requests raced and the other one won.
     *
     * That is not an error to report: the operation has a receipt, it is simply
     * not the document this request built a moment ago. The right answer is the
     * one that is recorded — the same one the Activity row names by hash — so
     * it is read back and returned, and the losing mint is discarded. A refusal
     * for any other reason is reported as itself rather than dressed as this.
     */
    const settled = await readCrossSwapOrder({ store, intentDigest: record.intentDigest });
    const existing = settled.ok ? OutcomeReceiptArtifactSchema.safeParse(settled.record.receipt) : null;
    if (existing?.success && settled.ok && settled.record.receiptHash) {
      return Response.json(
        {
          data: {
            receipt: existing.data,
            receiptHash: settled.record.receiptHash,
            issued: false,
            verification: verified(existing.data, issuerKey.publicKey),
          },
        },
        { headers: headers(rate) },
      );
    }
    return failure(503, attached.code, attached.reason, rate);
  }

  /*
   * Everything this read established, written down where a person will look.
   *
   * Non-fatal by construction — `recordSolanaAction` returns rather than throws
   * — so a history write that fails cannot cost the receipt that has already
   * been issued.
   */
  const wallet = solanaWalletOf(attached.record) ?? attached.record.destinationWallet;
  const receivedRaw = minted.facts.amounts.receivedRaw;
  const feeFacts = minted.facts.fee;
  await recordSolanaAction(store, {
    network: "mainnet",
    wallet,
    actionId: attached.record.intentDigest,
    lane: "CROSS_SWAP",
    outcome: crossSwapOutcome(attached.record.state),
    out: { mint: null, amountRaw: attached.record.amountInRaw, decimals: attached.record.fromDecimals, symbol: attached.record.fromSymbol },
    ...(receivedRaw ? { in: { mint: null, amountRaw: receivedRaw, decimals: attached.record.toDecimals, symbol: attached.record.toSymbol } } : {}),
    destination: historyDestinationFor(attached.record.destinationChain),
    ...(minted.facts.source.txHash ? { sourceTx: minted.facts.source.txHash } : {}),
    ...(minted.facts.destination.txHash ? { destinationTx: minted.facts.destination.txHash } : {}),
    /* Only a fee the provider actually reported on. An unread one leaves the
       row's fee untouched rather than writing a `collected: false` that reads
       like a measured nothing — the row already says nothing, honestly. */
    ...(feeFacts.reported
      ? {
          fee: {
            collected: feeFacts.collected,
            basisPoints: feeFacts.basisPoints,
            amountRaw: feeFacts.paidAmountRaw,
            decimals: feeFacts.decimals,
            symbol: feeFacts.symbol,
            usd: feeFacts.paidUsd,
            asset: null,
            providerRaw: lookup?.serviceFee?.settlement?.providerRaw ?? null,
            ryntraRaw: lookup?.serviceFee?.settlement?.ryntraRaw ?? null,
          },
        }
      : {}),
    receiptHash: minted.receipt.contentHash,
    now,
  });

  /* The rewards this operation earned and never recorded. Keyed by the
     provider's own operation reference, so an order whose status route already
     wrote them writes the same rows again rather than new income. */
  return Response.json(
    {
      data: {
        receipt: minted.receipt,
        receiptHash: minted.receipt.contentHash,
        issued: true,
        verification: verified(minted.receipt, issuerKey.publicKey),
      },
    },
    { headers: headers(rate) },
  );
}
