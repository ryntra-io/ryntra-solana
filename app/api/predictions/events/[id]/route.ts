import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { failure } from "@/lib/predictions/failure";
import { optionalPredictionActor, predictionFailure, predictionJson } from "@/lib/predictions/http";
import { readWatchlist } from "@/lib/predictions/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** One event with its markets across venues, live midpoints, rules and settlement differences; the watch state for a proven wallet. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!ID.test(id)) return predictionFailure(failure("VALIDATION_ERROR", "That is not an event id."));
  const [event, actor] = await Promise.all([getPredictionProvider().event(id), optionalPredictionActor(request)]);
  if (!event.ok) return predictionFailure(event);
  const watch = actor ? (await readWatchlist(actor.store, actor.wallet)).find((e) => e.eventId === id) ?? null : null;
  return predictionJson({ event: event.value, watch, wallet: actor?.wallet ?? null, readAt: new Date().toISOString() });
}
