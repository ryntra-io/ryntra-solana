import { failure } from "@/lib/predictions/failure";
import { checkWithdrawal } from "@/lib/predictions/funding-account";
import { predictionFailure, predictionJson, requirePredictionActor } from "@/lib/predictions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One withdrawal, checked now: re-read while it moves; asked again under the
 * same request id while its state is unknown. A change of state, so a
 * mutation: it comes from this site only.
 */
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await context.params;
  if (!ID.test(requestId)) return predictionFailure(failure("VALIDATION_ERROR", "That is not a withdrawal id."));
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const checked = await checkWithdrawal(actor.store, actor.provider, actor.wallet, requestId);
  if (!checked.ok) return predictionFailure(checked);
  return predictionJson({ wallet: actor.wallet, withdrawal: checked.value });
}
