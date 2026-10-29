import type { TeamRolesResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import {
  HIGH_RISK_PERMISSIONS,
  TEAM_KINDS,
  TEAM_LIMITS,
  TEAM_MATRIX,
  TEAM_PERMISSIONS,
  TEAM_PERMISSION_AUTHORITY,
  TEAM_PERMISSION_RISK,
  TEAM_ROLES,
  TEAM_SQUADS_PERMISSION,
  type HighRiskPermission,
} from "@/lib/core/team/roles";
import { rateLimitHeaders } from "@/lib/http-control";
import { teamsServed } from "@/lib/team/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const high = (permission: string): permission is HighRiskPermission => (HIGH_RISK_PERMISSIONS as readonly string[]).includes(permission);

/**
 * `GET /api/v1/teams/roles` (contract 1.75.0, TEAM-1) — the matrix every team check runs on, and whether teams are
 * served here. Public.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const served = teamsServed();
  return apiJson(
    {
      kinds: [...TEAM_KINDS],
      roles: [...TEAM_ROLES],
      permissions: TEAM_PERMISSIONS.map((id) => ({
        id,
        risk: TEAM_PERMISSION_RISK[id],
        authority: high(id) ? [...TEAM_PERMISSION_AUTHORITY[id]] : [],
        squadsPermission: high(id) ? TEAM_SQUADS_PERMISSION[id] : null,
      })),
      matrix: Object.fromEntries(TEAM_ROLES.map((role) => [role, { ...TEAM_MATRIX[role] }])) as TeamRolesResponse["matrix"],
      limits: {
        membersPerTeam: TEAM_LIMITS.membersPerTeam,
        teamsCreatedPerWallet: TEAM_LIMITS.teamsCreatedPerWallet,
        membershipsPerWallet: TEAM_LIMITS.membershipsPerWallet,
        invitationsPerWallet: TEAM_LIMITS.invitationsPerWallet,
        inviteDays: TEAM_LIMITS.inviteDays,
      },
      open: served.served,
      network: served.served ? served.deps.network : null,
    } satisfies TeamRolesResponse,
    200,
    rateLimitHeaders(rate),
  );
}
