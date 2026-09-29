import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { PredictionPlanUpdateSchema, readPredictionPlan, updatePredictionPlan } from "@/lib/predictions/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const resolved = await requirePredictionActor(request, "read");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const plan = await readPredictionPlan(actor.store, actor.wallet, id);
  if (!plan.ok) return predictionFailure(plan);
  return predictionJson({ wallet: actor.wallet, plan: plan.value });
}

/** An edit is a new version; the body names the version it read, and a stale one is refused. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, PredictionPlanUpdateSchema, 32_768);
  if (!read.ok) return read.response;
  const { actor } = resolved;
  const updated = await updatePredictionPlan(actor.store, actor.wallet, id, read.body);
  if (!updated.ok) return predictionFailure(updated);
  return predictionJson({ wallet: actor.wallet, plan: updated.value });
}
