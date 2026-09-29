import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { failure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson } from "@/lib/predictions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const RESOLUTIONS = new Set(["1m", "5m", "1h", "1d"]);

/** The price history of an outcome as bars from the provider; the client draws it in Ryntra's chart. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!ID.test(id)) return predictionFailure(failure("VALIDATION_ERROR", "That is not an outcome id."));
  const url = new URL(request.url);
  const resolutionParam = url.searchParams.get("resolution") ?? "1h";
  const resolution = (RESOLUTIONS.has(resolutionParam) ? resolutionParam : "1h") as "1m" | "5m" | "1h" | "1d";
  const countBack = Math.min(Math.max(Number(url.searchParams.get("countBack") ?? 96) || 96, 2), 500);
  const chart = await getPredictionProvider().chart(id, resolution, countBack);
  if (!chart.ok) return predictionFailure(chart);
  return predictionJson({ chart: chart.value, readAt: new Date().toISOString() });
}
