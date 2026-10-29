import { previewWithdrawal } from "@/lib/predictions/funding-account";
import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { WithdrawPreviewBodySchema } from "@/lib/predictions/route-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A withdrawal into the person's own Solana wallet, priced now: what arrives and the fee. Creates nothing. */
export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, WithdrawPreviewBodySchema, 1_024);
  if (!read.ok) return read.response;
  const { actor } = resolved;
  const preview = await previewWithdrawal(actor.store, actor.provider, actor.wallet, read.body);
  if (!preview.ok) return predictionFailure(preview);
  return predictionJson({ wallet: actor.wallet, destination: actor.wallet, preview: preview.value });
}
