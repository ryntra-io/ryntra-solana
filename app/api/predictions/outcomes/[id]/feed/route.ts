import type { HistoryLoad } from "@ryntra/core/adapters";

import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { AGG_PAGE_LIMIT, AGG_RESOLUTIONS, aggPage, pageSpan, resolutionOfKey, type AggResolution } from "@/lib/predictions/chart-feed";
import { failure } from "@/lib/predictions/failure";
import { gatewayHistory, gatewayOutcome, readGatewayEnv } from "@/lib/predictions/gateway";
import { predictionFailure, predictionJson } from "@/lib/predictions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const LOADS: readonly HistoryLoad[] = ["init", "forward", "backward"];
/** The aggregator's bars open on the hour for a week, as the market page always opened; the gateway's on its minute. */
const AGG_OPENING = "1h";

/**
 * An outcome's chart in the core's contract, for the market page's big chart:
 *
 * - `?part=instrument` — where its bars come from (`gateway` where Ryntra's gateway records the market, `aggregator`
 *   otherwise), the resolutions that source serves and the one to open on;
 * - `?part=history&via=…&resolution=1m&load=init&timestamp=…&limit=…` — a page of its «yes» bars on the probability
 *   scale from the source the view was opened on. One view never mixes the two: a page the gateway cannot give is a
 *   failure the chart shows, not the aggregator's bars spliced in.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!ID.test(id)) return predictionFailure(failure("VALIDATION_ERROR", "That is not an outcome id."));
  const url = new URL(request.url);
  const env = readGatewayEnv();

  if (url.searchParams.get("part") === "instrument") {
    const known = await gatewayOutcome(env, id);
    if (known && known.resolutions.length > 0) return predictionJson({ via: "gateway", resolutions: known.resolutions, opening: known.defaultResolution, volume: known.volume });
    return predictionJson({ via: "aggregator", resolutions: AGG_RESOLUTIONS, opening: AGG_OPENING, volume: null });
  }

  const via = url.searchParams.get("via") === "gateway" ? "gateway" : "aggregator";
  const resolution = url.searchParams.get("resolution") ?? AGG_OPENING;
  if (!resolutionOfKey(resolution)) return predictionFailure(failure("VALIDATION_ERROR", "That is not a resolution."));
  const load = (url.searchParams.get("load") ?? "init") as HistoryLoad;
  if (!LOADS.includes(load)) return predictionFailure(failure("VALIDATION_ERROR", "load is init, forward or backward."));
  const ts = url.searchParams.get("timestamp");
  const timestamp = ts === null || ts === "" ? null : Number(ts);
  if (timestamp !== null && !Number.isSafeInteger(timestamp)) return predictionFailure(failure("VALIDATION_ERROR", "timestamp is whole ms."));
  if (load !== "init" && timestamp === null) return predictionFailure(failure("VALIDATION_ERROR", "A page after the first needs its timestamp."));
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 300) || 300, 1), AGG_PAGE_LIMIT);

  if (via === "gateway") {
    const page = await gatewayHistory(env, id, { resolution, load, timestamp, limit });
    if (page?.kind === "page") return predictionJson({ via, page: page.page });
    return predictionFailure(failure("PROVIDER_UNAVAILABLE", "The market-data gateway did not answer this page."));
  }

  if (!(AGG_RESOLUTIONS as readonly string[]).includes(resolution)) return predictionFailure(failure("VALIDATION_ERROR", "The aggregator has no bars of that resolution."));
  // Newer than the newest bar the aggregator has nothing but the live bar, which comes another way.
  if (load === "backward") return predictionFailure(failure("VALIDATION_ERROR", "The aggregator's newest page is the first one."));
  const now = Date.now();
  const to = load === "forward" && timestamp !== null ? timestamp : now;
  // The newest page is read up to «now» under one cache key, so every viewer and every poll shares the server's read.
  const chart = await getPredictionProvider().chart(id, resolution as AggResolution, limit, load === "forward" ? to : undefined);
  if (!chart.ok) return predictionFailure(chart);
  return predictionJson({ via, page: aggPage(chart.value, { load, from: to - pageSpan(resolution as AggResolution, limit), to, limit }, now) });
}
