import { AssistantPlanRecheckSchema } from "@/lib/api/v1/contract";
import { apiFailure, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { recheckAssistantPlan } from "@/lib/assistant/plans/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

import { PLAN_ID, planAnswer } from "../../http";
import { planDepsFor } from "../../runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/assistant/plans/{id}/critic` (contract 1.61.0) — the strong
 * critic again on the plan's current version, at `prices.recheck`, held
 * before the call and taken only when its findings came back.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id } = await params;
  if (!PLAN_ID.test(id)) return apiFailure("ASSISTANT_PLAN_NOT_FOUND", "No plan of this wallet has that id.");
  const read = await readApiBody(request, AssistantPlanRecheckSchema, 1_024);
  if (!read.ok) return read.response;
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Trade plans need a durable store; this deployment does not have one.");
  return planAnswer(await recheckAssistantPlan(await planDepsFor(request, proof.address), proof.address, id, { ifVersion: read.body.ifVersion, acceptCredits: read.body.acceptCredits, locale: read.body.locale }));
}
