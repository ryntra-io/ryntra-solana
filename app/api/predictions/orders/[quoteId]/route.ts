import { failure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson, requirePredictionActor } from "@/lib/predictions/http";
import { readPaperOrder, syncPaperOrder } from "@/lib/predictions/paper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** One paper order, re-read from the provider while it is not terminal yet. */
export async function GET(request: Request, context: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await context.params;
  if (!ID.test(quoteId)) return predictionFailure(failure("VALIDATION_ERROR", "That is not a quote id."));
  const resolved = await requirePredictionActor(request, "read");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const current = await readPaperOrder(actor.store, actor.wallet, quoteId);
  if (!current) return predictionFailure(failure("NOT_FOUND", "No such paper order for this wallet."));
  if (current.state !== "submitted") return predictionJson({ wallet: actor.wallet, order: current });
  const synced = await syncPaperOrder(actor.store, actor.provider, actor.wallet, quoteId);
  if (synced.ok) return predictionJson({ wallet: actor.wallet, order: synced.value });
  return predictionJson({ wallet: actor.wallet, order: current, sync: { code: synced.code, message: synced.message } });
}
