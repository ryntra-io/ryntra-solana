import { PLAN_ID, type PlanResultsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { planFailure } from "@/lib/plans/http";
import { getPlanResults } from "@/lib/plans/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Plan vs Actual for one plan of the proven wallet (`RYN-STRATEGY-PLAN-001`
 * stage B): one result per execution — the version it was bound to, the
 * Strategy block that stood before the signature, the History row the chain
 * settled — newest first. The read reconciles the plan against History
 * first, so an execution the plan missed is on it by the time it is read;
 * `sync` says whether every write landed.
 *
 * 1.9.0 (`RYN-RESULTS-MEMORY-001`): the same answer carries `positions` —
 * what this plan's own executions add up to — and, when the plan made no
 * trade at all, the one `outcomes` entry saying why. A plan is in one or
 * the other, never both.
 */

type Params = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(request: Request, { params }: Params) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const { id } = await params;
  if (!PLAN_ID.test(id)) return apiFailure("VALIDATION_ERROR", "id: not a plan id.");
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const read = await getPlanResults(getGuardRuntime().store, proof.address, id);
  if (!read.ok) return planFailure(read);
  return apiJson({
    address: proof.address,
    results: [...read.results],
    sync: read.sync,
    outcomes: [...read.outcomes],
    positions: [...read.positions],
    summary: read.summary,
  } satisfies PlanResultsResponse);
}
