import { TeamMemberChangeRequestSchema, type TeamMemberChangeResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeTeamWrite, teamDepsOrRefusal, teamFailure } from "@/lib/team/http.server";
import { changeMember } from "@/lib/team/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/v1/teams/{id}/members/{wallet}` (contract 1.75.0, TEAM-1) — `accept`: the invited wallet's own yes;
 * `role`: a new role, by a member who keeps both places; `remove`: by such a member, or by the wallet itself (leaving,
 * or saying no). The last active Owner neither leaves nor is demoted. `team` is null once the wallet left.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; wallet: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = teamDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeTeamWrite(request.headers);
  if (!rate.ok) return rate.response;
  const read = await readApiBody(request, TeamMemberChangeRequestSchema);
  if (!read.ok) return read.response;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id, wallet } = await context.params;
  const changed = await changeMember(served.deps, { id, actor: proof.address, wallet, change: read.body });
  if (!changed.ok) return teamFailure(changed);
  return apiJson({ team: changed.team } satisfies TeamMemberChangeResponse, 200, rate.headers);
}
