import { predictionFailure, predictionJson, requirePredictionActor } from "@/lib/predictions/http";
import { revokeLink } from "@/lib/predictions/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sign the provider session out and wipe its tokens; the wallet signs again to open a new one. */
export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const revoked = await revokeLink(actor.store, actor.provider, actor.wallet);
  if (!revoked.ok) return predictionFailure(revoked);
  return predictionJson({ wallet: actor.wallet, link: revoked.value });
}
