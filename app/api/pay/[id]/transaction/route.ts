import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { derivePaymentStatus } from "@/lib/pay/model";
import { paymentReadHandle } from "@/lib/pay/public";
import { readPaymentRequest, readPaymentSettlement } from "@/lib/pay/store";
import { buildPaymentTransaction } from "@/lib/pay/transaction";
import { readSwapCarrier, walletMismatch } from "@/lib/solana/swap-carrier.server";
import { parseHumanAmount } from "@/lib/solana/amounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const BodySchema = z
  .object({
    payer: z.string().regex(BASE58),
    /** Display-unit amount the payer typed; required only for an open request. */
    amount: z.string().max(40).nullable().optional(),
  })
  .strict();

function headers(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: headers(rate) });
}

/**
 * `POST /api/pay/:id/transaction` — the unsigned transfer a payer's wallet
 * will sign. Refused for anything that is not awaiting payment, so a paid or
 * expired link cannot be paid twice by a stale tab.
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
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", "That is not a wallet address.", rate);
  if (walletMismatch(carrier, parsed.data.payer)) return failure(403, "WALLET_MISMATCH", "The session's wallet is not the payer.", rate);

  const { id } = await context.params;
  const store = getGuardRuntime().store;
  const record = await readPaymentRequest(store, id);
  if (!record) return failure(404, "NOT_FOUND", "This payment link does not exist.", rate);

  const now = new Date();
  const settlement = await readPaymentSettlement(store, record.id);
  const status = derivePaymentStatus({ request: record, settlement, now });
  if (status.status === "PAID") return failure(409, "ALREADY_PAID", "This request has already been paid.", rate);
  if (status.status === "EXPIRED") return failure(410, "EXPIRED", "This request has expired.", rate);
  if (settlement?.state === "PENDING") return failure(409, "PAYMENT_PENDING", "A payment for this request is already on its way.", rate);

  let amountRaw: string | null = record.amountRaw;
  if (amountRaw === null) {
    const typed = parsed.data.amount?.trim() || "";
    if (typed === "") return failure(400, "AMOUNT_REQUIRED", "Enter the amount you want to pay.", rate);
    const human = parseHumanAmount(typed, record.decimals);
    if (!human.ok) return failure(400, "AMOUNT_INVALID", human.reason, rate);
    if (human.raw === "0") return failure(400, "AMOUNT_INVALID", "The amount must be more than zero.", rate);
    amountRaw = human.raw;
  }

  const built = await buildPaymentTransaction({
    store,
    handle: paymentReadHandle(),
    request: record,
    payer: parsed.data.payer,
    amountRaw,
    now,
  });
  if (!built.ok) {
    const status = built.code === "STORE_FAILED" || built.code === "EPOCH_UNAVAILABLE" || built.code === "MINT_UNREADABLE" ? 503 : 422;
    return failure(status, built.code, built.reason, rate);
  }
  return Response.json({ data: built }, { headers: headers(rate) });
}
