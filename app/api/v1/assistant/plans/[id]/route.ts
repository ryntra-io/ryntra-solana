import { AssistantPlanUpdateSchema } from "@/lib/api/v1/contract";
import { apiFailure, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { editAssistantPlan, readAssistantPlanAnswer } from "@/lib/assistant/plans/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

import { localeOf, PLAN_ID, planAnswer } from "../http";
import { planDepsFor } from "../runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/assistant/plans/{id}` (contract 1.61.0) — one plan with every
 * version, its critic, its journal, what Нагляд says of it and «План проти
 * реальності»: every trade under the person's plan against it, its receipt
 * and its risk in words. Reads only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const { id } = await params;
  if (!PLAN_ID.test(id)) return apiFailure("ASSISTANT_PLAN_NOT_FOUND", "No plan of this wallet has that id.");
  const guard = getGuardRuntime();
  if (!storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Trade plans need a durable store; this deployment does not have one.");
  return planAnswer(await readAssistantPlanAnswer(await planDepsFor(request, proof.address), proof.address, id, localeOf(request)));
}

/**
 * `PUT /api/v1/assistant/plans/{id}` — the person's change: a new version,
 * checked by the plan engine's own rules (free); the strong critic again
 * only on `POST …/critic`. Refused once the plan is approved — it is then
 * changed on its own page, and that change comes back here as a version.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id } = await params;
  if (!PLAN_ID.test(id)) return apiFailure("ASSISTANT_PLAN_NOT_FOUND", "No plan of this wallet has that id.");
  const read = await readApiBody(request, AssistantPlanUpdateSchema, 2_048);
  if (!read.ok) return read.response;
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Trade plans need a durable store; this deployment does not have one.");
  const body = read.body;
  return planAnswer(await editAssistantPlan(await planDepsFor(request, proof.address), proof.address, id, { ifVersion: body.ifVersion, thesis: body.thesis, entryUsd: body.entryUsd, maxPriceUsd: body.maxPriceUsd, invalidationUsd: body.invalidationUsd, targetsUsd: body.targetsUsd, riskUsd: body.riskUsd, budgetUsd: body.budgetUsd, reason: body.reason, locale: body.locale }));
}
