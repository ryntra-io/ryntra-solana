import { TeamTreasuryRequestSchema, type TeamResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeTeamWrite, teamDepsOrRefusal, teamFailure } from "@/lib/team/http.server";
import { linkTreasury } from "@/lib/team/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/v1/teams/{id}/treasury` (contract 1.75.0, TEAM-1) — an active Owner links the team's Squads v4 multisig
 * (SOL-4) once, read on chain: their own wallet must be one of its members. A linked treasury is the rules money obeys:
 * no single Owner repoints or drops it (`TEAM_FORBIDDEN`). The link gives nobody a key.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = teamDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeTeamWrite(request.headers);
  if (!rate.ok) return rate.response;
  const read = await readApiBody(request, TeamTreasuryRequestSchema);
  if (!read.ok) return read.response;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id } = await context.params;
  const team = await linkTreasury(served.deps, { id, actor: proof.address, multisig: read.body.multisig });
  if (!team.ok) return teamFailure(team);
  return apiJson({ team: team.team } satisfies TeamResponse, 200, rate.headers);
}
