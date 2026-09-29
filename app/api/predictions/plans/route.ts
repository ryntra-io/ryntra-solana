import { storeSurvivesColdStart } from "@/lib/guard/store";
import { failure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { syncMonitorsForWallet } from "@/lib/monitoring/service.server";
import { createPredictionPlan, listPredictionPlans, PredictionPlanCreateSchema } from "@/lib/predictions/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The wallet's Prediction Plans, newest first; `POST` writes one, validated and sized by the server. */
export async function GET(request: Request) {
  const resolved = await requirePredictionActor(request, "read");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  return predictionJson({ wallet: actor.wallet, plans: await listPredictionPlans(actor.store, actor.wallet) });
}

export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, PredictionPlanCreateSchema, 32_768);
  if (!read.ok) return read.response;
  const { actor } = resolved;
  if (!storeSurvivesColdStart(actor.store)) return predictionFailure(failure("UNAVAILABLE", "A plan needs a durable store; this deployment has none."));
  const created = await createPredictionPlan(actor.store, { owner: actor.wallet, rules: read.body.rules, activate: read.body.activate });
  if (!created.ok) return predictionFailure(created);
  await syncMonitorsForWallet(actor.store, actor.wallet, Date.now()).catch(() => undefined);
  return predictionJson({ wallet: actor.wallet, plan: created.value }, 201);
}
