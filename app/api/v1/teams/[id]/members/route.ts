import { TeamInviteRequestSchema, type TeamResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeTeamWrite, teamDepsOrRefusal, teamFailure } from "@/lib/team/http.server";
import { inviteMember } from "@/lib/team/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/v1/teams/{id}/members` (contract 1.75.0, TEAM-1) — an invitation by a member whose role keeps the place:
 * an Owner any, an Admin those below Admin. The role is held only once the invited wallet says yes.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = teamDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeTeamWrite(request.headers);
  if (!rate.ok) return rate.response;
  const read = await readApiBody(request, TeamInviteRequestSchema);
  if (!read.ok) return read.response;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id } = await context.params;
  const team = await inviteMember(served.deps, { id, actor: proof.address, wallet: read.body.wallet, role: read.body.role, label: read.body.label ?? null });
  if (!team.ok) return teamFailure(team);
  return apiJson({ team: team.team } satisfies TeamResponse, 200, rate.headers);
}
