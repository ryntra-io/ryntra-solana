import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { failure } from "@/lib/predictions/failure";
import { optionalPredictionActor, predictionFailure, predictionJson } from "@/lib/predictions/http";
import type { PredictionEventSummary } from "@/lib/predictions/model";
import type { DiscoverPage } from "@/lib/predictions/provider";
import { readWatchlist } from "@/lib/predictions/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SORTS = new Set(["volume24h", "volume", "newest", "ending"]);

/**
 * Discovery (`RYN-PREDICTIONS-001`): the provider's real categories, a page
 * of open events by category and sort, or a text search — the leading
 * probabilities read live in one batch. With a proven wallet the answer also
 * names which of the events are watched. Public otherwise; nothing here
 * needs the paper account.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const category = url.searchParams.get("category")?.trim() || null;
  const sortParam = url.searchParams.get("sort") ?? "volume24h";
  const sort = (SORTS.has(sortParam) ? sortParam : "volume24h") as "volume24h" | "volume" | "newest" | "ending";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 24) || 24, 1), 50);
  const cursor = url.searchParams.get("cursor") || null;
  if (q.length > 200) return predictionFailure(failure("VALIDATION_ERROR", "The search is too long."));

  const provider = getPredictionProvider();
  const [categories, listed, actor] = await Promise.all([
    provider.categories(),
    q.length > 0 ? provider.search(q, Math.min(limit, 30)) : provider.discover({ category, sort, limit, cursor, endDateFrom: sort === "ending" ? new Date().toISOString() : null }),
    optionalPredictionActor(request),
  ]);
  if (!listed.ok) return predictionFailure(listed);
  const watched = actor ? (await readWatchlist(actor.store, actor.wallet)).map((e) => e.eventId) : [];
  const value: DiscoverPage | readonly PredictionEventSummary[] = listed.value;
  const page: DiscoverPage = Array.isArray(value) ? { events: value as readonly PredictionEventSummary[], nextCursor: null, readAt: new Date().toISOString() } : (value as DiscoverPage);
  return predictionJson({
    categories: categories.ok ? categories.value : [],
    categoriesUnavailable: !categories.ok,
    query: { q: q || null, category, sort, limit },
    events: page.events,
    nextCursor: page.nextCursor,
    readAt: page.readAt,
    watched,
    wallet: actor?.wallet ?? null,
  });
}
