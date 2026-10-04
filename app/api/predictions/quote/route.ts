import { z } from "zod";

import { storeSurvivesColdStart } from "@/lib/guard/store";
import { failure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { quotePaper } from "@/lib/predictions/paper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Body = z
  .object({
    eventId: Id,
    venueMarketId: Id,
    outcomeId: Id,
    side: z.enum(["buy", "sell"]),
    spendUsd: z.number().finite().positive().max(10_000).optional(),
    sellShares: z.number().finite().positive().max(1_000_000).optional(),
    planId: z.string().regex(/^pplan_[0-9a-f]{24}$/).nullable().optional(),
    locale: z.enum(["en", "uk"]).optional(),
  })
  .strict();

/**
 * The Review of a paper order: the route priced in paper mode for the
 * wallet's own session, the paper balance, the plan's conditions, every check
 * named — stored under the quote id so the order placed is exactly the one
 * reviewed.
 */
export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, Body);
  if (!read.ok) return read.response;
  const { actor } = resolved;
  if (!storeSurvivesColdStart(actor.store)) return predictionFailure(failure("UNAVAILABLE", "A paper order needs a durable store; this deployment has none."));
  const quoted = await quotePaper(actor.store, actor.provider, actor.wallet, read.body);
  if (!quoted.ok) return predictionFailure(quoted);
  return predictionJson({ wallet: actor.wallet, review: quoted.value.review, link: quoted.value.link, order: quoted.value.record });
}
