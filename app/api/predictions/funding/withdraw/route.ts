import { submitWithdrawal } from "@/lib/predictions/funding-account";
import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { WithdrawBodySchema } from "@/lib/predictions/route-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * The person confirmed the Review: priced again, recorded, then sent to the
 * person's own Solana wallet under the request id. `repriced` — it no longer
 * goes as reviewed and nothing was sent; `recorded` — the record says where
 * it stands, `unknown` included.
 */
export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, WithdrawBodySchema, 2_048);
  if (!read.ok) return read.response;
  const { actor } = resolved;
  const outcome = await submitWithdrawal(actor.store, actor.provider, actor.wallet, read.body);
  if (!outcome.ok) return predictionFailure(outcome);
  return predictionJson({ wallet: actor.wallet, ...outcome.value }, outcome.value.outcome === "recorded" ? 202 : 200);
}
