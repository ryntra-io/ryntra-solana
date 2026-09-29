import type { PayLinkResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { rateLimitHeaders } from "@/lib/http-control";
import { publicOriginOf } from "@/lib/pay/link";
import { readPayLink } from "@/lib/pay/links.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/pay/requests/{id}` — one payment link's state (contract
 * 1.22.0), read exactly as its page `/pay/{id}` reads it: the reference
 * observed on the chain when the last read is older than the page's freshness
 * rule, a paid link paid for good. For anyone with the link, like the page —
 * everything here is what the creator put in the link or what the chain
 * already publishes; nothing of the creator's account or session.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { id } = await context.params;
  let link;
  try {
    link = await readPayLink(getGuardRuntime().store, { id, origin: publicOriginOf(request) });
  } catch {
    return apiFailure("UNAVAILABLE", "The payment link could not be read. Try again.");
  }
  if (!link) return apiFailure("PAY_LINK_NOT_FOUND", "This payment link does not exist.");
  return apiJson({ link } satisfies PayLinkResponse);
}
