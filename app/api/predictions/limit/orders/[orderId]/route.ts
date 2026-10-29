import { failure } from "@/lib/predictions/failure";
import { predictionJson, requirePredictionActor, predictionFailure } from "@/lib/predictions/http";
import { LIMIT_ID, readLimitRecord, syncLimitOrder } from "@/lib/predictions/limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One limit order, read back from the venue while it is still working. */
export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  if (!LIMIT_ID.test(orderId)) return predictionFailure(failure("VALIDATION_ERROR", "That is not a limit-order id."));
  const resolved = await requirePredictionActor(request, "read");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const current = await readLimitRecord(actor.store, actor.wallet, orderId);
  if (!current) return predictionFailure(failure("NOT_FOUND", "No such limit order for this wallet."));
  const synced = await syncLimitOrder(actor.store, actor.provider, actor.wallet, orderId);
  if (synced.ok) return predictionJson({ wallet: actor.wallet, order: synced.value });
  /* The venue could not be read: what the store holds is what is shown, and the read is named. */
  return predictionJson({ wallet: actor.wallet, order: current, sync: { code: synced.code, message: synced.message } });
}
