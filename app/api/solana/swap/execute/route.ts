import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { settleSolanaSwap, swapSettleContext } from "@/lib/core/solana-swap/settle";
import { resolveSolanaLaneState } from "@/lib/solana/lane-state";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import {
  SwapExecutionBundleSchema,
  SwapExecutionProofSchema,
  type SwapExecutionBundle,
} from "@/lib/solana/swap-execution-review";
import { readSwapCarrier, walletMismatch } from "@/lib/solana/swap-carrier.server";
import { REFERRAL_COOKIE } from "@/lib/rewards/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The one-shot swap execute route.
 *
 * `../../transfer/settle` stays the only route that broadcasts a transaction
 * through Ryntra's own RPC. This route delegates the broadcast to Jupiter
 * `/execute` — and holds it behind the same discipline: the issuer-signed
 * execution bundle must return unchanged, the wallet's returned bytes must be
 * EXACTLY the reviewed message (a swap has no augmentation lane), the durable
 * owner lock and the submit-once boundary are both crossed before the single
 * POST, and afterwards the only legal follow-up is an independent chain read
 * by signature — never a second execute. The wallet's visible confirmation
 * over the reviewed message is the human approval.
 *
 * It no longer reserves against the owner-canary ledger. That ledger accounts
 * a bounded $20 experiment; charging every swap of a person's own funds
 * against it made the product stop working after the twentieth dollar, and
 * the submit-once guarantee never rested on it — it rests on the send-attempt
 * boundary and the owner lock, both of which are unchanged.
 */

const RequestSchema = z
  .object({
    bundle: SwapExecutionBundleSchema,
    proof: SwapExecutionProofSchema,
    signedTransactionBase64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(6_000),
    /**
     * The exact bytes that were handed to the wallet.
     *
     * Needed only to say what a modifying wallet changed, and safe to accept
     * from the browser because it is checked against the issuer-signed
     * bundle's own message hash before it is used for anything.
     */
    reviewedTransactionBase64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(6_000).optional(),
  })
  .strict();

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(
  status: number,
  code: string,
  message: string,
  rate: RateLimitDecision,
  extra: object = {},
) {
  return Response.json(
    { error: { code, message, ...extra } },
    { status, headers: responseHeaders(rate) },
  );
}

/**
 * Every refusal above the signature claim is one the network never saw.
 *
 * The browser writes its attempt down BEFORE it sends this request, because a
 * reply that never arrives has to be treated as possibly submitted. But a
 * reply that DOES arrive and says "refused before I claimed anything" is proof
 * of the opposite — and without that proof the browser kept a signature this
 * server had never heard of, offering a recovery that could only ever answer
 * 409 and locking the wallet out of its own product. Saying which side of the
 * boundary a refusal falls on is what lets the browser let go.
 */
function refuseBeforeSubmit(
  status: number,
  code: string,
  message: string,
  rate: RateLimitDecision,
  extra: object = {},
) {
  return failure(status, code, message, rate, { ...extra, submitBoundary: "NOT_CROSSED" });
}

/** The invitation a browser carries from `/r/<code>` (the phone sends no cookie). */
function carriedReferralCode(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== REFERRAL_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return refuseBeforeSubmit(429, "RATE_LIMITED", "Too many requests.", rate);
  /* The site's origin for a browser, the native bearer for the phone; a
     bearer that fails is refused by its own code and never falls through
     (`lib/solana/swap-carrier.ts`). Nothing was claimed yet either way. */
  const carrier = await readSwapCarrier(request, "The owner-canary execute request must come from this site.");
  if (!carrier.ok) return refuseBeforeSubmit(carrier.status, carrier.code, carrier.message, rate);
  /* No owner session. This route submits bytes the connected wallet has
     already signed, and it will only submit bytes that are EXACTLY the
     issuer-signed reviewed message — so the authorization is the signature
     itself, not a login; a native session may only submit its own wallet's
     bytes (bound to the bundle's taker below). The owner lock, the
     submit-once boundary and the returned-bytes comparison are all unchanged
     below.

     The lane stop replaces it as the operator control. It is checked here as
     well as on `/order` because a Review issued a minute ago must not become
     submittable after an operator has closed the lane. Recovery and
     cancellation deliberately carry no such check: a wallet that already
     signed must always be able to find out what happened. */
  if (resolveSolanaLaneState("SWAP") !== "OPEN") {
    return refuseBeforeSubmit(409, "SWAP_PAUSED", "Swapping is turned off right now.", rate);
  }
  const body = await readAgentControlJson(request);
  if (!body.ok) return refuseBeforeSubmit(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return refuseBeforeSubmit(400, "VALIDATION_ERROR", "The execute request did not match its schema.", rate);
  }
  const { bundle, proof, signedTransactionBase64, reviewedTransactionBase64 } = parsed.data;
  /* A native session submits for its own wallet only. */
  if (walletMismatch(carrier, bundle.taker)) {
    return refuseBeforeSubmit(403, "WALLET_MISMATCH", "The session's wallet is not the taker of this bundle.", rate);
  }

  /* From here the swap's settle half of the core pipeline
     (`lib/core/solana-swap/settle.ts`) runs: the shared safety chain over the
     signed bytes — the issuer proof, the transaction check, the signature, the
     plan, the independent reader, the adopted bytes proved again, the owner
     lock — then one send, the chain's own read, the Receipt, the history row
     with its fee, and the rewards. A refusal before the send says the network
     never saw the bytes (`refuseBeforeSubmit`, `submitBoundary: "NOT_CROSSED"`). */
  const context = swapSettleContext({
    bundle: bundle as SwapExecutionBundle,
    proof,
    signedTransactionBase64,
    reviewedTransactionBase64,
    referralCode: carriedReferralCode(request),
  });
  const run = await settleSolanaSwap(context);
  if (!run.completed) {
    const stop = run.stop;
    if (stop.kind === "answer") return Response.json(stop.answer.body, { status: stop.answer.status, headers: responseHeaders(rate) });
    const { status, code, message, extra, beforeSubmit } = stop.refusal;
    return beforeSubmit ? refuseBeforeSubmit(status, code, message, rate, extra) : failure(status, code, message, rate, extra);
  }
  const answer = context.answer as NonNullable<typeof context.answer>;
  return Response.json(answer.body, { status: answer.status, headers: responseHeaders(rate) });
}
