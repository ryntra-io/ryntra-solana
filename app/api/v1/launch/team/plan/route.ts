import { ALLOCATION_CATEGORIES, ALLOCATION_MAX_DAYS, ALLOCATION_TOTAL_PCT, TEAM_LAUNCH_AUTHORITY, TEAM_LAUNCH_STEPS, teamLaunchServedFor } from "@/lib/core/launch/team-launch";
import { BUDGET_RULE, BUDGET_SOURCES } from "@/lib/core/launch/budget";
import { FEE_SHARE_MAX_RECIPIENTS, FEE_SHARE_MIN_BPS } from "@/lib/core/launch/fee-shares";
import { findAuthority, resolveAuthority } from "@/lib/core/authority-matrix";
import { isTeamId } from "@/lib/core/team/roles";
import type { TeamLaunchPlanResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { authorizeTeamAction } from "@/lib/team/service.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { launchPeopleServed } from "@/lib/launch/runtime.server";
import { teamLaunchDeps, withOneTreasuryRead } from "@/lib/launch/team-launch.server";

type TeamLaunchDecision = NonNullable<TeamLaunchPlanResponse["steps"][number]["decisions"]>[number];

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/launch/team/plan?team=` (contract 1.77.0, MOS-2) — the eight steps of the Team Launch wizard, the
 * TEAM-1 rights each one needs, the bounds the steps obey and the EXE-1 row they all run through, resolved on this
 * deployment. With `team=` and a proven wallet it also carries that wallet's own decision for every step, so the
 * column can mark what it may commit and what waits for the treasury.
 *
 * The read is honest about the switch rather than silent: `open` is false until the owner says the word in the moment
 * of the action, and a canary admits only the wallets the deployment names.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = teamLaunchDeps();
  if (!served.ok) return apiFailure(served.reason === "NO_LAUNCH" ? "LAUNCH_UNAVAILABLE" : "CAPABILITY_UNAVAILABLE", served.message);
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const team = new URL(request.url).searchParams.get("team");
  if (team !== null && !isTeamId(team)) return apiFailure("VALIDATION_ERROR", "team: not a team id.");

  /* A proven wallet is required to decide a team's steps, and welcome without one: a canary can only answer «open» to
     a wallet it can name. Without any wallet the plan is still the plan, and a canary reads as not open — which is
     what it is for a wallet it cannot name. */
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok && team !== null) return proof.response;
  const wallet = proof.ok ? proof.address : null;

  const row = findAuthority(TEAM_LAUNCH_AUTHORITY);
  if (!row) return apiFailure("UNAVAILABLE", "The launch's authority row is not registered.");
  const resolved = resolveAuthority(row, served.deps.env);

  /* Each right is decided once for the whole plan, and the treasury is read from the chain once: the eight steps name
     five rights between them, and three of those ask the same multisig. */
  const steps: TeamLaunchPlanResponse["steps"] = [];
  const decided = new Map<string, TeamLaunchDecision>();
  const deps = team === null || wallet === null ? null : withOneTreasuryRead(served.deps.team);
  for (const step of TEAM_LAUNCH_STEPS) {
    const entry: TeamLaunchPlanResponse["steps"][number] = { n: step.n, key: step.key, permissions: [...step.permissions], name: { ...step.name } };
    if (deps !== null && team !== null && wallet !== null) {
      const decisions: TeamLaunchDecision[] = [];
      for (const permission of step.permissions) {
        let decision = decided.get(permission);
        if (!decision) {
          const checked = await authorizeTeamAction(deps, { teamId: team, wallet, permission, authority: permission === "deploy" ? TEAM_LAUNCH_AUTHORITY : null });
          /* A wallet that is not in the team learns nothing of it — the same answer as a team that is not there. */
          if (!checked.ok) return apiFailure(checked.code === "NOT_FOUND" ? "TEAM_NOT_FOUND" : checked.code === "INVALID" ? "VALIDATION_ERROR" : "UNAVAILABLE", checked.message);
          const { permission: id, allowed, grant, requires, refusal, multisig, squadsPermission } = checked.decision;
          decision = { permission: id, allowed, grant, requires, refusal, multisig, squadsPermission };
          decided.set(permission, decision);
        }
        decisions.push(decision);
      }
      entry.decisions = decisions;
    }
    steps.push(entry);
  }

  return apiJson(
    {
      open: teamLaunchServedFor(wallet, served.deps.env).served,
      network: served.deps.network.cluster,
      /* Unread is «not now»: the review never promises a ladder on a guess. */
      peopleServed: await launchPeopleServed(served.deps.network, getGuardRuntime().store).catch(() => false),
      steps,
      bounds: {
        allocationTotalPct: ALLOCATION_TOTAL_PCT,
        allocationCategories: [...ALLOCATION_CATEGORIES],
        allocationMaxDays: ALLOCATION_MAX_DAYS,
        budgetSources: [...BUDGET_SOURCES],
        deployedBpsMax: BUDGET_RULE.deployMaxBps,
        pauseOnDropBps: BUDGET_RULE.dropStopBps,
        feeShareMaxRecipients: FEE_SHARE_MAX_RECIPIENTS,
        feeShareMinBps: FEE_SHARE_MIN_BPS,
      },
      authority: { id: row.id, state: resolved.state, enforcement: row.enforcement, signer: row.signer },
    } satisfies TeamLaunchPlanResponse,
    200,
    rateLimitHeaders(rate),
  );
}
