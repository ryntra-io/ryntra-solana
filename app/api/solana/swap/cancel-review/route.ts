import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { createIndependentReadHandle, createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import {
  expireUnclaimedSwapOwnerReview,
  readSwapOwnerLock,
} from "@/lib/solana/swap-owner-lock";
import { SwapExecutionBundleSchema } from "@/lib/solana/swap-execution-review";
import { readSwapCarrier, walletMismatch } from "@/lib/solana/swap-carrier.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RequestSchema = z
  .object({
    owner: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    requestId: z.string().min(1).max(128),
  })
  .strict();

function headers(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: headers(rate) });
}

/** Owner cancellation of bytes that were issued but never server-claimed. */
export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  /* The site's origin for a browser, the native bearer for the phone; a
     bearer that fails is refused by its own code and never falls through
     (`lib/solana/swap-carrier.ts`). */
  const carrier = await readSwapCarrier(request, "Review cancellation must come from this site.");
  if (!carrier.ok) return failure(carrier.status, carrier.code, carrier.message, rate);
  /* No owner session. Cancellation is already narrow enough to be safe in
     public: it touches only a Review that was issued and never signed, it must
     name that Review's exact `requestId`, and anything already carrying a
     signature is refused below. The worst a stranger could do is cancel an
     unsigned Review whose id they would have to know; no value moves either
     way. A native session cancels its own wallet's Review only. */
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", "The cancellation request did not match its schema.", rate);
  if (walletMismatch(carrier, parsed.data.owner)) return failure(403, "WALLET_MISMATCH", "The session's wallet is not the owner of this Review.", rate);

  const store = getGuardRuntime().store;
  if (store.durability !== "DURABLE_MULTI_WRITER") {
    return failure(503, "STORE_NOT_DURABLE", "Review cancellation requires the durable owner lock.", rate);
  }
  const lock = await readSwapOwnerLock({ store, owner: parsed.data.owner });
  if (!lock.ok) return failure(409, lock.code, lock.reason, rate);
  if (
    lock.record.state !== "REVIEW_ISSUED" ||
    lock.record.signature !== null ||
    lock.record.requestId !== parsed.data.requestId
  ) {
    return failure(409, "OWNER_SWAP_LOCK_MISMATCH", "Only the exact unclaimed issued Review can be cancelled.", rate);
  }
  const bundle = SwapExecutionBundleSchema.safeParse(lock.record.bundle);
  if (!bundle.success) return failure(503, "OWNER_SWAP_LOCK_UNAVAILABLE", "The stored exact Review bundle is malformed.", rate);
  const primary = createSolanaRpcHandle({ network: "mainnet" });
  const independent = createIndependentReadHandle(primary);
  if (!independent) return failure(503, "NO_INDEPENDENT_RPC", "No independent blockhash operator is configured.", rate);
  let valid: boolean;
  try {
    valid = Boolean((await withRpcDiscipline(independent, (abortSignal) =>
      independent.rpc
        .isBlockhashValid(bundle.data.inspection.blockhash as never, { commitment: "confirmed" })
        .send({ abortSignal }),
    )).value);
  } catch {
    return failure(503, "BLOCKHASH_VALIDITY_UNKNOWN", "The exact issued Review blockhash could not be checked.", rate);
  }
  if (valid) {
    return failure(409, "BLOCKHASH_STILL_VALID", "The exact issued bytes remain valid; cancellation must wait.", rate);
  }
  const expired = await expireUnclaimedSwapOwnerReview({
    store,
    owner: parsed.data.owner,
    requestId: parsed.data.requestId,
    at: new Date().toISOString(),
  });
  if (!expired.ok) return failure(409, expired.code, expired.reason, rate);
  return Response.json(
    {
      state: "EXPIRED_BEFORE_SUBMIT",
      owner: parsed.data.owner,
      requestId: parsed.data.requestId,
      blockhashValid: false,
    },
    { headers: headers(rate) },
  );
}
