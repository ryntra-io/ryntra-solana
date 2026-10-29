import type { TeamResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { teamDepsOrRefusal, teamFailure } from "@/lib/team/http.server";
import { readTeam } from "@/lib/team/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/teams/{id}` (contract 1.75.0, TEAM-1) — the team as the proven wallet may read it: the list to an
 * active member, the journal to one who reads receipts, the treasury's signers on chain beside the list. A wallet not
 * in the team gets `TEAM_NOT_FOUND`, the same as for a team that is not there.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = teamDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const { id } = await context.params;
  const team = await readTeam(served.deps, id, proof.address);
  if (!team.ok) return teamFailure(team);
  return apiJson({ team: team.team } satisfies TeamResponse, 200, rateLimitHeaders(rate));
}
