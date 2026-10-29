import { failure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson, requirePredictionActor } from "@/lib/predictions/http";
import { cancelOrder } from "@/lib/predictions/paper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** *Cancel the rest* — the person's own act on an order that is still working; a part already filled stays filled. */
export async function POST(request: Request, context: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await context.params;
  if (!ID.test(quoteId)) return predictionFailure(failure("VALIDATION_ERROR", "That is not a quote id."));
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const cancelled = await cancelOrder(actor.store, actor.provider, actor.wallet, quoteId);
  if (!cancelled.ok) return predictionFailure(cancelled);
  return predictionJson({ wallet: actor.wallet, order: cancelled.value });
}
