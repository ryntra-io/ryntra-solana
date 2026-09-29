import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { loadPublicPaymentRequest } from "@/lib/pay/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/api/pay/:id` — the current truth about one payment request, for anyone
 * with the link.
 *
 * Public by the same rule the passport is: everything here is either what the
 * creator chose to put in the link (token, amount, description, recipient) or
 * a fact the chain already publishes (paid, by which signature). Nothing about
 * the creator's account or session is read on this path, let alone returned.
 * The status is derived on the server from the stored observation, refreshed
 * when it is stale, so a page that polls this cannot outrun the truth.
 */
function headers(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) {
    return Response.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429, headers: headers(rate) });
  }
  const { id } = await context.params;
  const view = await loadPublicPaymentRequest({ store: getGuardRuntime().store, id });
  if (!view) {
    return Response.json({ error: { code: "NOT_FOUND", message: "This payment link does not exist." } }, { status: 404, headers: headers(rate) });
  }
  return Response.json({ data: view }, { headers: headers(rate) });
}
