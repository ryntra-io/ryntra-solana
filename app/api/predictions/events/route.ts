import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { failure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson } from "@/lib/predictions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Several events by id (the watchlist, the plans): summaries with live leading prices; an id the provider no longer has is dropped. */
export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ID.test(s))
    .slice(0, 40);
  if (ids.length === 0) return predictionFailure(failure("VALIDATION_ERROR", "Name at least one event id."));
  const events = await getPredictionProvider().events(ids);
  if (!events.ok) return predictionFailure(events);
  return predictionJson({ events: events.value, readAt: new Date().toISOString() });
}
