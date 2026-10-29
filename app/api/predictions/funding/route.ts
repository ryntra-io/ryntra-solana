import { readFunding } from "@/lib/predictions/funding-account";
import { predictionFailure, predictionJson, requirePredictionActor } from "@/lib/predictions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The account's live money: whether it is switched on here, who holds it,
 * the Solana deposit address, the balance, the recent deposits and the
 * withdrawals Ryntra recorded (the ones still moving re-read). Switched off,
 * only the records are read — the provider is not asked for an address.
 */
export async function GET(request: Request) {
  const resolved = await requirePredictionActor(request, "read");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const view = await readFunding(actor.store, actor.provider, actor.wallet);
  if (!view.ok) return predictionFailure(view);
  return predictionJson({ wallet: actor.wallet, ...view.value });
}
