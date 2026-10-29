import { creditsContextForWallet } from "@/app/api/v1/agent/runtime";
import { readAgentCredits } from "@/lib/agent/budget";
import { AssistantCreditOrderRequestSchema, type AssistantCreditOrderResponse, type AssistantCreditOrdersResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { orderView } from "@/lib/assistant/credits/order-view";
import { listOrders, openOrder, sweepOrders, treasuryFrom } from "@/lib/assistant/credits/purchase";
import { chainReference } from "@/lib/assistant/credits/purchase.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { FixedWindowLimiter, rateLimitHeaders } from "@/lib/http-control";
import { publicOriginOf } from "@/lib/pay/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Six orders a minute per wallet on a warm instance; the hour's limit is the store's. */
const limiter = new FixedWindowLimiter({ limit: 6, windowMs: 60_000, maxKeys: 5_000 });

/**
 * `GET /api/v1/assistant/credits/orders` (contract 1.54.0) — the proven
 * wallet's newest orders of credits, the ones that may still be paid read on
 * chain first (credited once), and the credits after them. The receipts.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const guard = getGuardRuntime();
  if (!storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Credits need a durable store; this deployment does not have one.");
  const nowMs = Date.now();
  const context = await creditsContextForWallet(proof.address, nowMs);
  if (!context) return apiFailure("CAPABILITY_UNAVAILABLE", "Credits are switched off on this deployment.");
  try {
    /* Where this deployment may not write (one writer behind many instances), the orders are shown as they stand. */
    const orders = guard.writes.allowed ? await sweepOrders(guard.store, proof.address, { read: chainReference(), nowMs }) : await listOrders(guard.store, proof.address, 10);
    const origin = publicOriginOf(request);
    const body: AssistantCreditOrdersResponse = { orders: orders.map((order) => orderView(order, origin, nowMs)), credits: await readAgentCredits(guard.store, context, nowMs) };
    return apiJson(body, 200, { "cache-control": "private, no-store" });
  } catch {
    return apiFailure("UNAVAILABLE", "The orders could not be read now.");
  }
}

/**
 * `POST /api/v1/assistant/credits/orders` (contract 1.54.0) — open an order
 * for one package: a payment request to Ryntra's treasury with its own
 * reference, paid on `/pay/<id>` within 15 minutes. Nothing is signed or sent
 * here; the person's wallet pays.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, AssistantCreditOrderRequestSchema, 512);
  if (!read.ok) return read.response;
  const rate = limiter.consume(proof.address);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many orders in a minute; try again shortly.", { headers: rateLimitHeaders(rate) });
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Credits need a durable store; this deployment does not have one.");
  const nowMs = Date.now();
  const context = await creditsContextForWallet(proof.address, nowMs);
  if (!context) return apiFailure("CAPABILITY_UNAVAILABLE", "Credits are switched off on this deployment.");
  const opened = await openOrder(guard.store, { wallet: proof.address, holder: context.holder, packageId: read.body.package, treasury: treasuryFrom(), locale: read.body.locale ?? "en", nowMs });
  if (!opened.ok) {
    const code = opened.code === "PURCHASE_CLOSED" ? "CAPABILITY_UNAVAILABLE" : opened.code === "ORDERS_LIMIT" ? "RATE_LIMITED" : opened.code === "UNAVAILABLE" ? "UNAVAILABLE" : "VALIDATION_ERROR";
    return apiFailure(code, opened.reason, { headers: rateLimitHeaders(rate) });
  }
  const body: AssistantCreditOrderResponse = { order: orderView(opened.order, publicOriginOf(request), nowMs), credits: await readAgentCredits(guard.store, context, nowMs) };
  return apiJson(body, 200, { ...rateLimitHeaders(rate), "cache-control": "private, no-store" });
}
