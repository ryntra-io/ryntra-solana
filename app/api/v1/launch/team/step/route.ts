import { TeamLaunchStepRequestSchema, type ApiErrorCode, type TeamLaunchStepResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { teamLaunchStepByKey } from "@/lib/core/launch/team-launch";
import { rateLimitHeaders } from "@/lib/http-control";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { launchPeopleServed } from "@/lib/launch/runtime.server";
import { commitTeamLaunchStep, consumeTeamLaunchStep, teamLaunchDeps, type TeamLaunchRefusal } from "@/lib/launch/team-launch.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const FAILURE: Readonly<Record<TeamLaunchRefusal, ApiErrorCode>> = Object.freeze({
  CLOSED: "LAUNCH_TEAM_CLOSED",
  NOT_WHITELISTED: "LAUNCH_TEAM_CLOSED",
  FORBIDDEN: "TEAM_FORBIDDEN",
  NOT_FOUND: "TEAM_NOT_FOUND",
  INVALID: "VALIDATION_ERROR",
  UNAVAILABLE: "UNAVAILABLE",
});

/**
 * `POST /api/v1/launch/team/step` (contract 1.77.0, MOS-2) — one step of the Team Launch wizard, committed by the
 * proven wallet: the deployment's switch, then every TEAM-1 right the step needs, then the step's own rules, then one
 * EXE-2 action, whose `actionId` the answer carries. The same step with the same fields replays that one action
 * (`replay: true`) rather than opening a second.
 *
 * Nothing here builds a transaction, signs, sends or deploys. Step 08 answers with the review the signature would be
 * made over — the simulation, every fee as its own row, the market's budget, the Constitution's fields and the
 * chronicle — and ends there.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = teamLaunchDeps();
  if (!served.ok) return apiFailure(served.reason === "NO_LAUNCH" ? "LAUNCH_UNAVAILABLE" : "CAPABILITY_UNAVAILABLE", served.message);
  const rate = consumeTeamLaunchStep(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, TeamLaunchStepRequestSchema);
  if (!read.ok) return read.response;
  const step = teamLaunchStepByKey(read.body.step);
  if (!step) return apiFailure("VALIDATION_ERROR", "step: not a step of the wizard.");
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;

  /* Whether Ryntra's executor claims the market's budget on people's markets here now (SOL-L6); unread is «not now». */
  const peopleServed = step.key === "review" ? await launchPeopleServed(served.deps.network, getGuardRuntime().store).catch(() => false) : false;
  const committed = await commitTeamLaunchStep({ ...served.deps, peopleServed }, { wallet: proof.address, step, draft: read.body.draft }).catch(() => null);
  if (!committed) return apiFailure("UNAVAILABLE", "The step could not be recorded; try again.");
  if (!committed.ok) return apiFailure(FAILURE[committed.code], committed.message);

  return apiJson(
    {
      step: step.key,
      actionId: committed.actionId,
      replay: committed.replay,
      decisions: step.permissions.map((permission) => {
        const { allowed, grant, requires, refusal, multisig, squadsPermission } = committed.decisions[permission]!;
        return { permission, allowed, grant, requires, refusal, multisig, squadsPermission };
      }),
      review: committed.review
        ? {
            ...committed.review,
            simulation: {
              ...committed.review.simulation,
              supplyRaw: committed.review.simulation.supplyRaw.toString(10),
              circulatingRaw: committed.review.simulation.circulatingRaw.toString(10),
              lockedRaw: committed.review.simulation.lockedRaw.toString(10),
              firstBuyQuoteRaw: committed.review.simulation.firstBuyQuoteRaw.toString(10),
              firstBuyCapRaw: committed.review.simulation.firstBuyCapRaw.toString(10),
              allocation: committed.review.simulation.allocation.map((unit) => ({ ...unit, unitsRaw: unit.unitsRaw.toString(10) })),
              sniperFee: { ...committed.review.simulation.sniperFee },
              exitLiquidity: { ...committed.review.simulation.exitLiquidity },
            },
            fees: committed.review.fees.map((row) => ({ ...row, name: { ...row.name } })),
            budget: { ...committed.review.budget, sources: [...committed.review.budget.sources], minStepRaw: committed.review.budget.minStepRaw.toString(10) },
            constitution: committed.review.constitution.map((row) => ({ ...row })),
            chronicle: committed.review.chronicle.map((row) => ({ ...row, name: { ...row.name } })),
            problems: [...committed.review.problems],
          }
        : null,
    } satisfies TeamLaunchStepResponse,
    200,
    rateLimitHeaders(rate),
  );
}
