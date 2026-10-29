import type { LaunchCrewResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { crewOpenOn } from "@/lib/core/launch/crew";
import { rateLimitHeaders } from "@/lib/http-control";
import { crewView, isCrewId, readCrew } from "@/lib/launch/crew.server";
import { launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/launch/crews/{id}` (contract 1.74.0, MC-2) — a crew as anyone reads it: the creator, the ticker, each
 * invitee's handle, part, answer and the words they say yes to; the wallets only of those who said yes. Public.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { id } = await context.params;
  if (!isCrewId(id)) return apiFailure("LAUNCH_NOT_FOUND", "No such crew.");
  const crew = await readCrew({ store: deps.store, cluster: deps.network.cluster }, id).catch(() => undefined);
  if (crew === undefined) return apiFailure("UNAVAILABLE", "The crew could not be read now; try again.");
  if (!crew) return apiFailure("LAUNCH_NOT_FOUND", "No such crew.");
  return apiJson({ network: deps.network.chain, crew: crewView(crew, Date.now()), open: crewOpenOn(deps.network.cluster) } satisfies LaunchCrewResponse, 200, rateLimitHeaders(rate));
}
