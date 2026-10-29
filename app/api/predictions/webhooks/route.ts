import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { handleAggWebhook, readWebhookSecret } from "@/lib/predictions/agg-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The aggregator's signed webhooks: trades placed and filled, and the final
 * fee of a trade, into Ryntra's fee ledger. Without the endpoint's signing
 * secret on this deployment it answers *not configured* and takes nothing.
 */
export async function POST(request: Request) {
  return handleAggWebhook(request, { secret: readWebhookSecret(), store: getGuardRuntime().store, noStore: privateNoStoreHeaders() });
}
