import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { failure, type PredictionFailure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson } from "@/lib/predictions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

type Part<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: PredictionFailure["code"] }>;
const part = <T>(r: Readonly<{ ok: true; value: T }> | PredictionFailure): Part<T> => (r.ok ? r : { ok: false, code: r.code });

/**
 * Research on one market, every part answered on its own: the provider's
 * generated signals (model named), the ripple candidates, the news window,
 * and the related markets for the market's question. A part the provider
 * does not have is a state of that part, never a failed page.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!ID.test(id)) return predictionFailure(failure("VALIDATION_ERROR", "That is not a market id."));
  const text = (new URL(request.url).searchParams.get("text") ?? "").trim().slice(0, 300);
  const provider = getPredictionProvider();
  const [signals, expand, hedge, news, related] = await Promise.all([
    provider.signals(id),
    provider.ripple(id, "expand", 8),
    provider.ripple(id, "hedge", 8),
    provider.news(id, 5),
    text.length > 0 ? provider.related(text, 8) : Promise.resolve({ ok: true as const, value: [] }),
  ]);
  return predictionJson({ signals: part(signals), expand: part(expand), hedge: part(hedge), news: part(news), related: part(related), readAt: new Date().toISOString() });
}
