import { creditsContextForWallet } from "@/app/api/v1/agent/runtime";
import { readAgentCredits } from "@/lib/agent/budget";
import type { AssistantCreditOrderResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { orderView } from "@/lib/assistant/credits/order-view";
import { readOrder, settleOrder } from "@/lib/assistant/credits/purchase";
import { chainReference } from "@/lib/assistant/credits/purchase.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { publicOriginOf } from "@/lib/pay/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/assistant/credits/orders/<id>` (contract 1.54.0) — one order of
 * the proven wallet: the chain read for its reference (at most every eight
 * seconds), credits added once for what reached the treasury, the receipt.
 * Another wallet's order is not found.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const guard = getGuardRuntime();
  if (!storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Credits need a durable store; this deployment does not have one.");
  const nowMs = Date.now();
  const credits = await creditsContextForWallet(proof.address, nowMs);
  if (!credits) return apiFailure("CAPABILITY_UNAVAILABLE", "Credits are switched off on this deployment.");
  const { id } = await context.params;
  try {
    const found = await readOrder(guard.store, id);
    if (!found || found.wallet !== proof.address) return apiFailure("CREDIT_ORDER_NOT_FOUND", "No order of this wallet has that id.");
    const order = guard.writes.allowed ? ((await settleOrder(guard.store, id, { read: chainReference(), nowMs })) ?? found) : found;
    const body: AssistantCreditOrderResponse = { order: orderView(order, publicOriginOf(request), nowMs), credits: await readAgentCredits(guard.store, credits, nowMs) };
    return apiJson(body, 200, { "cache-control": "private, no-store" });
  } catch {
    return apiFailure("UNAVAILABLE", "The order could not be read now.");
  }
}
