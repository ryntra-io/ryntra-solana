import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { predictionFailure, predictionJson } from "@/lib/predictions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The provider's operational state where it is useful: the trading mode of the app, the signal engine's coverage, the venues switched off. */
export async function GET() {
  const engine = await getPredictionProvider().engine();
  if (!engine.ok) return predictionFailure(engine);
  return predictionJson({ engine: engine.value, readAt: new Date().toISOString() });
}
