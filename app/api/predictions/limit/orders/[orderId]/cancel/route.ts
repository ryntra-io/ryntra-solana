import { failure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson, requirePredictionActor } from "@/lib/predictions/http";
import { LIMIT_ID, cancelLimitOrder } from "@/lib/predictions/limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** *Cancel* — one act on what has not filled; a part already filled stays filled. */
export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  if (!LIMIT_ID.test(orderId)) return predictionFailure(failure("VALIDATION_ERROR", "That is not a limit-order id."));
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const cancelled = await cancelLimitOrder(actor.store, actor.provider, actor.wallet, orderId);
  if (!cancelled.ok) return predictionFailure(cancelled);
  return predictionJson({ wallet: actor.wallet, order: cancelled.value });
}
