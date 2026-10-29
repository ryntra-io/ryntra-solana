import { creditsContextForWallet } from "@/app/api/v1/agent/runtime";
import { sweepOrders } from "@/lib/assistant/credits/purchase";
import { chainReference } from "@/lib/assistant/credits/purchase.server";
import { readCreditsResponse } from "@/lib/assistant/credits/view";
import type { AssistantCreditsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SWEEP_BUDGET_MS = 2_500;

/**
 * `GET /api/v1/assistant/credits` (contract 1.52.0, 1.54.0) — the proven wallet's
 * credits: the day's free ones, the balance, what is held, the day's cap,
 * every action's price, and the latest entries. The account's, once the
 * wallet is linked to one. 1.54.0: an order of credits that may still be paid
 * is read on chain first, so credits bought while the page was closed are
 * there when it opens; and `purchase` says what is sold here.
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
    /* Bought credits are added before the read — within a short budget: a slow network never holds the credits back. */
    if (guard.writes.allowed) await Promise.race([sweepOrders(guard.store, proof.address, { read: chainReference(), nowMs }).catch(() => null), new Promise((resolve) => setTimeout(resolve, SWEEP_BUDGET_MS))]);
    return apiJson((await readCreditsResponse(guard.store, context, nowMs)) satisfies AssistantCreditsResponse, 200, { "cache-control": "private, no-store" });
  } catch {
    return apiFailure("UNAVAILABLE", "The credits could not be read now.");
  }
}
