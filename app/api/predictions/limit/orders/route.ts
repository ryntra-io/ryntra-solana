import { z } from "zod";

import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { placeLimitOrder, readLimitOrders } from "@/lib/predictions/limit";
import { predictionsLocale } from "@/lib/predictions/locale.server";
import { predictionTransports } from "@/lib/predictions/notify/transports.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ id: z.string().regex(/^plim_[0-9a-f]{24}$/) }).strict();

/**
 * The wallet's limit orders, the working ones read back from the venue
 * first — so the state on the page is the venue's state, not a guess — with
 * whatever moved since the last read told to the person through the one
 * prediction channel.
 */
export async function GET(request: Request) {
  const resolved = await requirePredictionActor(request, "read");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const view = await readLimitOrders(actor.store, actor.provider, actor.wallet, process.env, Date.now(), {
    locale: await predictionsLocale(),
    transports: predictionTransports(actor.store),
  });
  return predictionJson(view);
}

/**
 * *Place the limit order* — the person's own act on a Review that did not
 * refuse. One Review sends one order: a second press finds the record taken
 * and gets it as it stands.
 */
export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, Body);
  if (!read.ok) return read.response;
  const { actor } = resolved;
  const placed = await placeLimitOrder(actor.store, actor.provider, actor.wallet, read.body.id);
  if (!placed.ok) return predictionFailure(placed);
  return predictionJson({ wallet: actor.wallet, order: placed.value }, placed.value.state === "sending" ? 202 : 200);
}
