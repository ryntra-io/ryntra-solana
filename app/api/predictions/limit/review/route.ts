import { z } from "zod";

import { storeSurvivesColdStart } from "@/lib/guard/store";
import { failure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { LIMIT_LIVES, LIMIT_MAX_AMOUNT_USD, LIMIT_PRICE_MAX, LIMIT_PRICE_MIN, reviewLimitOrder, type LimitLife } from "@/lib/predictions/limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Body = z
  .object({
    eventId: Id,
    venueMarketId: Id,
    outcomeId: Id,
    /** The price as a probability: what one share costs at most. */
    price: z.number().finite().min(LIMIT_PRICE_MIN).max(LIMIT_PRICE_MAX),
    amountUsd: z.number().finite().positive().max(LIMIT_MAX_AMOUNT_USD),
    life: z.enum([...LIMIT_LIVES] as [LimitLife, ...LimitLife[]]),
    planId: z.string().regex(/^pplan_[0-9a-f]{24}$/).nullable().optional(),
    locale: z.enum(["en", "uk"]).optional(),
    mode: z.enum(["paper", "live"]).optional(),
  })
  .strict();

/**
 * The Review of a limit order: the market and its book read fresh, the price
 * moved onto the venue's grid in the person's favour, the arithmetic stated,
 * the plan's conditions judged. Nothing is placed here — the Review is stored
 * under its own id and the person confirms it.
 */
export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, Body);
  if (!read.ok) return read.response;
  const { actor } = resolved;
  if (!storeSurvivesColdStart(actor.store)) return predictionFailure(failure("UNAVAILABLE", "A limit order needs a durable store; this deployment has none."));
  const reviewed = await reviewLimitOrder(actor.store, actor.provider, actor.wallet, read.body);
  if (!reviewed.ok) return predictionFailure(reviewed);
  return predictionJson({ wallet: actor.wallet, review: reviewed.value.review, order: reviewed.value.record, link: reviewed.value.link });
}
