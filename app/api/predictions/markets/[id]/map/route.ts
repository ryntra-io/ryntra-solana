import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { failure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson } from "@/lib/predictions/http";
import { readMarketMap } from "@/lib/predictions/market-map-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The market map of one market of an event, for the outcome the person
 * picked (`outcome`): the markets the provider's model links with and
 * against it and on the same theme, each with its price and day's move and
 * what in the dates or status could work against the link. A group
 * whose read failed is a state of that group, never a failed answer.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const query = new URL(request.url).searchParams;
  const eventId = query.get("event") ?? "";
  const outcomeId = query.get("outcome") ?? "";
  if (!ID.test(id) || !ID.test(eventId) || !ID.test(outcomeId)) return predictionFailure(failure("VALIDATION_ERROR", "That is not an outcome of a market of an event."));
  const provider = getPredictionProvider();
  const event = await provider.event(eventId);
  if (!event.ok) return predictionFailure(event);
  const market = event.value.markets.find((m) => m.id === id);
  if (!market || !market.outcomes.some((o) => o.id === outcomeId)) return predictionFailure(failure("NOT_FOUND", "That outcome is not in this market of this event."));
  return predictionJson({ map: await readMarketMap(provider, event.value, market, outcomeId) });
}
