import { TeamCreateRequestSchema, type TeamResponse, type TeamsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { consumeTeamWrite, teamDepsOrRefusal, teamFailure } from "@/lib/team/http.server";
import { createTeam, listTeams, readTeam } from "@/lib/team/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** `GET /api/v1/teams` (contract 1.75.0, TEAM-1) — the proven wallet's teams on this network, invitations included. */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = teamDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const teams = await listTeams(served.deps, proof.address);
  if (!teams.ok) return teamFailure(teams);
  return apiJson({ network: served.deps.network, teams: teams.teams.slice(0, 100) } satisfies TeamsResponse, 200, rateLimitHeaders(rate));
}

/** `POST /api/v1/teams` (contract 1.75.0, TEAM-1) — a team made by the proven wallet, its first Owner. */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = teamDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeTeamWrite(request.headers);
  if (!rate.ok) return rate.response;
  const read = await readApiBody(request, TeamCreateRequestSchema);
  if (!read.ok) return read.response;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const made = await createTeam(served.deps, { wallet: proof.address, name: read.body.name, kind: read.body.kind });
  if (!made.ok) return teamFailure(made);
  const team = await readTeam(served.deps, made.state.team.id, proof.address);
  if (!team.ok) return teamFailure(team);
  return apiJson({ team: team.team } satisfies TeamResponse, 200, rate.headers);
}
