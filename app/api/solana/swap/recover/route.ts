import { z } from "zod";
import { recordSwapSettlementBenefits } from "@/lib/rewards/swap-settlement";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { loadIssuerKey } from "@/lib/agent-control/issuer";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { readSignatureStatus } from "@/lib/solana/recover";
import { createIndependentReadHandle, createSolanaRpcHandle } from "@/lib/solana/rpc";
import { readSwapOwnerRecovery } from "@/lib/solana/swap-owner-lock";
import { recoverSwapOutcome, recoverUnrecordedSwap } from "@/lib/solana/swap-recovery";
import {
  SwapExecutionBundleSchema,
  SwapExecutionProofSchema,
  type SwapExecutionBundle,
} from "@/lib/solana/swap-execution-review";
import { readSwapCarrier, walletMismatch } from "@/lib/solana/swap-carrier.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RequestSchema = z
  .object({
    owner: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
    requestId: z.string().min(1).max(128).optional(),
  })
  .strict();

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: responseHeaders(rate) });
}

/**
 * Read one signature already across the durable submit boundary.
 *
 * This route accepts no transaction bytes and imports no submit adapter. It
 * can only verify the issuer-bound bundle, read the independent operator,
 * reconcile, and mint or report the Receipt.
 */
export async function POST(request: Request) {
  /* Recovery is a read and belongs on the read budget: the card polls it every
     three seconds while an outcome is open, which is twenty a minute against an
     action window of twelve, and exhausting that window would also refuse the
     calls the person needs to act. This route submits nothing. */
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  /* The site's origin for a browser, the native bearer for the phone; a
     bearer that fails is refused by its own code and never falls through
     (`lib/solana/swap-carrier.ts`). */
  const carrier = await readSwapCarrier(request, "The swap recovery request must come from this site.");
  if (!carrier.ok) return failure(carrier.status, carrier.code, carrier.message, rate);
  /* No owner session. Recovery accepts no transaction bytes and imports no
     submit adapter — it can only verify a bundle this deployment's own issuer
     key signed, read the chain independently and reconcile. Presenting that
     bundle is the authorization, and a person whose swap went quiet must be
     able to find out what happened to their money without an admin login. A
     native session recovers its own wallet's swap only. */
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", "The recovery request did not match its schema.", rate);
  if (walletMismatch(carrier, parsed.data.owner)) return failure(403, "WALLET_MISMATCH", "The session's wallet is not the owner of this swap.", rate);

  const issuerKey = loadIssuerKey();
  if (!issuerKey) return failure(503, "ISSUER_KEY_MISSING", "This deployment cannot verify or mint the swap recovery proof.", rate);
  const store = getGuardRuntime().store;
  if (store.durability !== "DURABLE_MULTI_WRITER") {
    return failure(503, "STORE_NOT_DURABLE", "Swap recovery requires the durable multi-writer attempt ledger.", rate);
  }
  const primaryForLookup = createSolanaRpcHandle({ network: "mainnet" });
  const independentForLookup = createIndependentReadHandle(primaryForLookup);

  const recovery = await readSwapOwnerRecovery({
    store,
    owner: parsed.data.owner,
    signature: parsed.data.signature,
  });
  if (!recovery.ok) {
    // An unseen signature may belong to execute still running before its durable claim.
    // Release only against the matching issuer-bound Review and independent expiry proof.
    if (!independentForLookup) return failure(503, "NO_INDEPENDENT_RPC", "No independent read operator is configured.", rate);
    const status = await readSignatureStatus(independentForLookup, parsed.data.signature);
    const result = await recoverUnrecordedSwap({ store, owner: parsed.data.owner,
      signature: parsed.data.signature, requestId: parsed.data.requestId, status,
      handle: independentForLookup, trustedPublicKey: issuerKey.publicKey });
    return Response.json(result, { status: result.state === "UNKNOWN_TO_CHAIN" ? 200 : 202, headers: responseHeaders(rate) });
  }
  const bundle = SwapExecutionBundleSchema.safeParse(recovery.record.bundle);
  const proof = SwapExecutionProofSchema.safeParse(recovery.record.proof);
  if (!bundle.success || !proof.success) {
    return failure(503, "OWNER_SWAP_LOCK_UNAVAILABLE", "The durable recovery bundle or proof is malformed.", rate);
  }
  const independent = independentForLookup;
  if (!independent) return failure(503, "NO_INDEPENDENT_RPC", "No independent read operator is configured.", rate);

  const result = await recoverSwapOutcome({
    store,
    bundle: bundle.data as SwapExecutionBundle,
    proof: proof.data,
    trustedPublicKey: issuerKey.publicKey,
    signature: parsed.data.signature,
    handle: independent,
    environment: process.env,
  });
  if (result.state === "REFUSED") return failure(409, result.code, result.reason, rate);
  if ((result.state === "RECOVERED" || result.state === "ALREADY_RECEIPTED") && result.receipt) {
    await recordSwapSettlementBenefits(store, { bundle: bundle.data, receipt: result.receipt, signature: parsed.data.signature, now: new Date().toISOString() });
  }
  return Response.json(result, {
    status: result.state === "PENDING" ? 202 : 200,
    headers: responseHeaders(rate),
  });
}
