import { mintSafety } from "@/lib/bots/backtest/mint-safety";
import { clientIp, FixedWindowLimiter, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { readTokenRiskFacts } from "@/lib/solana/risk-facts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * Which tokens a bot may stand on: `GET ?mint=<a>&mint=<b>` — for each mint,
 * whether it passes the bots' filter (no Token-2022 permanent delegate,
 * transfer hook, freeze authority or transfer fee), from the market-data
 * gateway's chain facts. A mint whose facts were not read does not pass.
 * Read-only, public data.
 */

const LIMITER = new FixedWindowLimiter({ limit: 60, windowMs: 60_000, maxKeys: 5_000 });
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const rate = LIMITER.consume(`bots-safety:${clientIp(request.headers)}`);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const mints = [...new Set(new URL(request.url).searchParams.getAll("mint"))];
  if (mints.length === 0 || mints.length > 4 || !mints.every((mint) => MINT.test(mint))) return failure(400, "VALIDATION_ERROR", "One to four mints by address.", rate);
  const readings = await Promise.all(mints.map((mint) => readTokenRiskFacts({ mint })));
  const tokens = Object.fromEntries(readings.map((reading) => [reading.mint, mintSafety(reading.state === "READ" ? reading.facts.mint_account : null)]));
  return Response.json({ tokens, ok: Object.values(tokens).every((token) => token.ok) }, { headers: { ...rateLimitHeaders(rate), "cache-control": "public, max-age=60" } });
}
