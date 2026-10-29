import type { DevPlanResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { buildDevPlan } from "@/lib/developer/plan.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/developer/plan` (contract 1.83.0, DEV-2) — what the console is made of: environments, scopes, events,
 * bounds, the quota windows with whichever numbers this deployment states, the webhook signing scheme, and the shape
 * a tariff has with nothing filling it. Public: no wallet and no key.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  return apiJson(buildDevPlan() satisfies DevPlanResponse, 200, rateLimitHeaders(rate));
}
