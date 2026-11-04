import { isBacktestPeriod, poolInstrument, type BacktestPeriod } from "@/lib/bots/backtest/candles";
import { readCandles } from "@/lib/bots/backtest/candles.server";
import { marketWeather } from "@/lib/bots/weather/weather";
import { clientIp, FixedWindowLimiter, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * The market's weather for bots: `GET ?pool=<address>&period=7d|30d|180d`
 * (30 days by default) — trend, range or chop over the market-data gateway's
 * candles of the pool, one plain line and a fit for every kind of bot. A read
 * of public data; the past bars, never a forecast.
 */

const LIMITER = new FixedWindowLimiter({ limit: 60, windowMs: 60_000, maxKeys: 5_000 });

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const rate = LIMITER.consume(`bots-weather:${clientIp(request.headers)}`);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const params = new URL(request.url).searchParams;
  const instrument = poolInstrument(params.get("pool") ?? "");
  const asked = params.get("period") ?? "30d";
  if (!instrument || !isBacktestPeriod(asked)) return failure(400, "VALIDATION_ERROR", "A pool by its address and a period of 7d, 30d or 180d.", rate);
  const period: BacktestPeriod = asked;
  const read = await readCandles(instrument, period);
  if (!read.ok) return failure(read.reason === "UNKNOWN_INSTRUMENT" ? 404 : 503, read.reason, "The pool's candles could not be read.", rate);
  const weather = marketWeather(read.candles);
  if (!weather) return failure(422, "TOO_FEW_BARS", "Too few candles to read the weather.", rate);
  return Response.json({ instrument, period, weather }, { headers: { ...rateLimitHeaders(rate), "cache-control": "public, max-age=60, stale-while-revalidate=120" } });
}
