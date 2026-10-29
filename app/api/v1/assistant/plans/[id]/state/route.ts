import { AssistantPlanStateRequestSchema } from "@/lib/api/v1/contract";
import { apiFailure, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { setAssistantPlanState } from "@/lib/assistant/plans/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

import { PLAN_ID, planAnswer } from "../../http";
import { planDepsFor } from "../../runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/assistant/plans/{id}/state` (contract 1.61.0) — the person's
 * word on their plan: `approved` writes their own Trading Plan from the
 * current version, `watching` makes it active so Нагляд watches it,
 * `cancelled` ends it. The Trading Plan is the furthest this goes: the
 * Review and the wallet's signature stay on the plan's own page.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id } = await params;
  if (!PLAN_ID.test(id)) return apiFailure("ASSISTANT_PLAN_NOT_FOUND", "No plan of this wallet has that id.");
  const read = await readApiBody(request, AssistantPlanStateRequestSchema, 512);
  if (!read.ok) return read.response;
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Trade plans need a durable store; this deployment does not have one.");
  return planAnswer(await setAssistantPlanState(await planDepsFor(request, proof.address), proof.address, id, { to: read.body.to, ifVersion: read.body.ifVersion, locale: read.body.locale }));
}
