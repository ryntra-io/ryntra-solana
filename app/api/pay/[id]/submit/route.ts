import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { emptySettlement } from "@/lib/pay/model";
import { refreshPaymentSettlement } from "@/lib/pay/observe";
import { loadPublicPaymentRequest, paymentReadHandle } from "@/lib/pay/public";
import { readPaymentIntent, readPaymentRequest, readPaymentSettlement, writePaymentSettlement } from "@/lib/pay/store";
import { submitPaymentTransaction } from "@/lib/pay/transaction";
import { readSwapCarrier } from "@/lib/solana/swap-carrier.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z
  .object({
    intentId: z.string().min(8).max(64),
    signedWireBase64: z.string().min(64).max(20_000),
  })
  .strict();

function headers(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: headers(rate) });
}

/**
 * `POST /api/pay/:id/submit` — broadcast the bytes the wallet signed, once.
 *
 * The route accepts only a transaction whose message hash is the one pinned
 * when it was built for this request, records the signature as a pending
 * settlement so the page says "sent, waiting for the network", and returns
 * the refreshed public view. Confirmation comes from observing the reference,
 * never from the fact that a submit went out.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  /* The payment page's origin for a browser, the native bearer for the phone
     (1.22.0, the swap routes' rule since the mobile line's request 13): a
     bearer that fails is refused by its own code and never falls through, and
     a bearer pays only as its own wallet. The browser's refusal keeps its
     code and words. */
  const carrier = await readSwapCarrier(request, "This request did not come from the payment page.");
  if (!carrier.ok) return failure(carrier.status, carrier.code === "FORBIDDEN_ORIGIN" ? "FORBIDDEN" : carrier.code, carrier.message, rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = BodySchema.safeParse(body.value);
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", "The signed transaction was not accepted.", rate);

  const { id } = await context.params;
  const store = getGuardRuntime().store;
  const record = await readPaymentRequest(store, id);
  if (!record) return failure(404, "NOT_FOUND", "This payment link does not exist.", rate);

  /* A bearer submits only what was built for its own wallet. */
  if (carrier.carrier === "bearer") {
    const intent = await readPaymentIntent(store, parsed.data.intentId);
    if (intent && intent.payer !== carrier.address) return failure(403, "WALLET_MISMATCH", "The session's wallet is not the payer.", rate);
  }

  const handle = paymentReadHandle();
  const submitted = await submitPaymentTransaction({
    store,
    handle,
    requestId: record.id,
    intentId: parsed.data.intentId,
    signedWireBase64: parsed.data.signedWireBase64,
  });
  if (!submitted.ok) {
    const status = submitted.code === "SUBMIT_FAILED" ? 502 : submitted.code === "INTENT_EXPIRED" ? 410 : 409;
    return failure(status, submitted.code, submitted.reason, rate);
  }

  const now = new Date();
  const previous = (await readPaymentSettlement(store, record.id)) ?? emptySettlement(record.id, now.toISOString());
  if (previous.state !== "PAID" && previous.state !== "OVERPAID") {
    await writePaymentSettlement(store, { ...previous, state: "PENDING", signature: submitted.signature, checkedAt: now.toISOString() });
  }
  /* One immediate look. A just-sent transaction is usually not confirmed yet;
     the page keeps polling `/api/pay/:id`, which observes again. */
  await refreshPaymentSettlement({ store, handle, request: record, now, force: true });
  const view = await loadPublicPaymentRequest({ store, id: record.id, observe: false });
  return Response.json({ data: { signature: submitted.signature, view } }, { headers: headers(rate) });
}
