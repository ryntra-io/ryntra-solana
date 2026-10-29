import { getGuardRuntime } from "@/lib/guard/runtime";
import { clientIp, FixedWindowLimiter, rateLimitHeaders } from "@/lib/http-control";
import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { readJournal, scoreJournal, settleJournal, type JournalRecord, type JournalScore } from "@/lib/predictions/assistant/journal";
import { failure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson } from "@/lib/predictions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const limiter = new FixedWindowLimiter({ limit: 20, windowMs: 60_000, maxKeys: 5_000 });
/** The score is read and settled at most every few minutes per instance; a disclosure opened in between gets the same. */
const FRESH_MS = 5 * 60_000;
let cached: Readonly<{ at: number; score: JournalScore; records: readonly JournalRecord[] }> | null = null;

/**
 * `GET /api/predictions/assistant/journal` — Ryntra's journal of
 * assessments, scored: the market's Brier beside Ryntra's (none while it
 * gives no probability of its own) and the calibration table. A read first
 * checks a few unsettled markets; `?market=` adds that market's lines.
 */
export async function GET(request: Request) {
  const rate = limiter.consume(clientIp(request.headers));
  if (!rate.allowed) return predictionFailure(failure("RATE_LIMITED", "Too many reads in a minute; try again shortly.", { retryAfterSeconds: 60 }));
  const now = Date.now();
  if (!cached || now - cached.at > FRESH_MS) {
    const store = getGuardRuntime().store;
    await settleJournal(store, getPredictionProvider(), now).catch(() => 0);
    const records = await readJournal(store).catch(() => null);
    if (!records) return predictionFailure(failure("UNAVAILABLE", "The journal could not be read just now."));
    cached = { at: now, score: scoreJournal(records), records };
  }
  const market = new URL(request.url).searchParams.get("market");
  const own = market && ID.test(market) ? cached.records.filter((r) => r.venueMarketId === market).map((r) => ({ outcomeId: r.outcomeId, outcomeLabel: r.outcomeLabel, lines: r.lines.length, settled: r.settled })) : null;
  return predictionJson({ score: cached.score, market: own, readAt: new Date(cached.at).toISOString() }, 200, rateLimitHeaders(rate));
}
