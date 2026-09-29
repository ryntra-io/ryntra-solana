import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { failure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson } from "@/lib/predictions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The order books of a market on every venue of its cluster, and the best levels across them. Never cached. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!ID.test(id)) return predictionFailure(failure("VALIDATION_ERROR", "That is not a market id."));
  const depth = Math.min(Math.max(Number(new URL(request.url).searchParams.get("depth") ?? 10) || 10, 1), 50);
  const book = await getPredictionProvider().book(id, depth);
  if (!book.ok) return predictionFailure(book);
  return predictionJson({ book: book.value });
}
