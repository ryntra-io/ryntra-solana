import type { TeamCheckResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { TEAM_PERMISSIONS, type TeamPermission } from "@/lib/core/team/roles";
import { rateLimitHeaders } from "@/lib/http-control";
import { teamDepsOrRefusal, teamFailure } from "@/lib/team/http.server";
import { authorizeTeamAction } from "@/lib/team/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const isPermission = (value: string | null): value is TeamPermission => value !== null && (TEAM_PERMISSIONS as readonly string[]).includes(value);

/**
 * `GET /api/v1/teams/{id}/check?permission=&authority=` (contract 1.75.0, TEAM-1) — the server's decision for the
 * proven wallet: the same `authorizeTeamAction` every team action takes before anything is built.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = teamDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const query = new URL(request.url).searchParams;
  const permission = query.get("permission");
  if (!isPermission(permission)) return apiFailure("VALIDATION_ERROR", "permission: not a team right.");
  const authority = query.get("authority");
  if (authority !== null && !/^[a-z0-9-]+\.[a-z0-9-]+$/.test(authority)) return apiFailure("VALIDATION_ERROR", "authority: not an authority row id.");
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const { id } = await context.params;
  const checked = await authorizeTeamAction(served.deps, { teamId: id, wallet: proof.address, permission, authority });
  if (!checked.ok) return teamFailure(checked);
  return apiJson({ teamId: id, wallet: proof.address, ...checked.decision } satisfies TeamCheckResponse, 200, rateLimitHeaders(rate));
}
