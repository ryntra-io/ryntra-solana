import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { failure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson } from "@/lib/predictions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The live prices of a market: its midpoint, each outcome's, every matched venue's. Never cached. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!ID.test(id)) return predictionFailure(failure("VALIDATION_ERROR", "That is not a market id."));
  const extra = (new URL(request.url).searchParams.get("also") ?? "").split(",").map((s) => s.trim()).filter((s) => ID.test(s)).slice(0, 20);
  const prices = await getPredictionProvider().prices([id, ...extra]);
  if (!prices.ok) return predictionFailure(prices);
  return predictionJson({ prices: prices.value, readAt: new Date().toISOString() });
}
