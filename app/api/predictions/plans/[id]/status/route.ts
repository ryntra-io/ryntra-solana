import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { syncMonitorsForWallet } from "@/lib/monitoring/service.server";
import { PredictionPlanStatusSchema, setPredictionPlanStatus } from "@/lib/predictions/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Activate a draft or cancel a plan; a journal entry either way. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, PredictionPlanStatusSchema);
  if (!read.ok) return read.response;
  const { actor } = resolved;
  const changed = await setPredictionPlanStatus(actor.store, actor.wallet, id, read.body);
  if (!changed.ok) return predictionFailure(changed);
  await syncMonitorsForWallet(actor.store, actor.wallet, Date.now()).catch(() => undefined);
  return predictionJson({ wallet: actor.wallet, plan: changed.value });
}
