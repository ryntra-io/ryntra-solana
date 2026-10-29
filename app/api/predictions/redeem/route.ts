import { z } from "zod";

import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { collectMarkets } from "@/lib/predictions/settle-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({ outcomeIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).min(1).max(20) }).strict();

/**
 * *Collect* — the person's own act on resolved winning live positions the
 * provider marks payable; the answer is the receipt.
 *
 * Since PM-05 a win arrives without this being pressed, and the press takes
 * the same path as the sweep: one record per market, so a press during a
 * sweep — or two presses — ask the venue once.
 */
export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, Body);
  if (!read.ok) return read.response;
  const { actor } = resolved;
  const collected = await collectMarkets(actor.store, actor.provider, actor.wallet, read.body.outcomeIds);
  if (!collected.ok) return predictionFailure(collected);
  return predictionJson({ wallet: actor.wallet, receipt: collected.value.receipt, collects: collected.value.collects });
}
