import type { PlanResultsResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { listPlanResults } from "@/lib/plans/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Plan vs Actual across every plan of the proven wallet, newest settled
 * first — what Results draws. The same shape as one plan's results; the
 * static segment wins over `{id}` in the router, and `results` is not a
 * plan id anyway.
 *
 * 1.9.0: the feed is no longer only the trades.
 * `outcomes` carries the plans that made none and why — a maximum price
 * never met, a liquidity floor never cleared, a window that closed — as
 * first-class results rather than an absence; `positions` says what each
 * plan's executions add up to and whether it is still open; `summary`
 * counts the feed so a surface need not.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const read = await listPlanResults(getGuardRuntime().store, proof.address);
  return apiJson({
    address: proof.address,
    results: [...read.results],
    sync: read.sync,
    outcomes: [...read.outcomes],
    positions: [...read.positions],
    summary: read.summary,
  } satisfies PlanResultsResponse);
}
