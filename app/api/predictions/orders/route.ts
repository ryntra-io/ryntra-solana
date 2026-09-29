import { z } from "zod";

import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { listPaperOrders, placePaper } from "@/lib/predictions/paper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({ quoteId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }).strict();

/** Ryntra's own paper-order records for the wallet, newest first. */
export async function GET(request: Request) {
  const resolved = await requirePredictionActor(request, "read");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  return predictionJson({ wallet: actor.wallet, orders: await listPaperOrders(actor.store, actor.wallet) });
}

/**
 * *Place paper order* — the person's own act on a Review that did not refuse.
 * The provider accepts the fill; the execution is polled to its terminal
 * state; the record carries whatever the provider said, and nothing more.
 */
export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, Body);
  if (!read.ok) return read.response;
  const { actor } = resolved;
  const placed = await placePaper(actor.store, actor.provider, actor.wallet, read.body.quoteId);
  if (!placed.ok) return predictionFailure(placed);
  return predictionJson({ wallet: actor.wallet, order: placed.value }, placed.value.state === "submitted" ? 202 : 200);
}
