import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { engineBotsReaders } from "@/lib/assistant/bots/readers.server";
import { BotsToolRequestSchema } from "@/lib/assistant/bots/schema";
import { runBotsTool } from "@/lib/assistant/bots/tools";
import { clientIp, FixedWindowLimiter, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A warm instance's burst bound per address: the hub asks once a coin, a horizon and an amount. */
const limiter = new FixedWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 5_000 });

/**
 * `POST /api/v1/assistant/bots` — Ryntra's tools for the bots hub (CITY-133):
 * `weather`, `suggest`, `simulate`, `explain` and `draft`. A body is a choice,
 * numbers and addresses (`lib/assistant/bots/schema.ts`, any other key
 * refused); every figure is read here from the engine — the chart's candles,
 * the weather, the backtest with its costs, the wallet's Hangar on the chain.
 *
 * Drafts only: nothing here signs, sends, holds a key or reaches a wallet;
 * a draft is a bot's settings the city opens in its own review. No model is
 * called and no credit is taken (AI-04 is open, `lib/assistant/bots/credits.ts`).
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = limiter.consume(`assistant-bots:${clientIp(request.headers)}`);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests in a minute; ask again shortly.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, BotsToolRequestSchema, 2_048);
  if (!read.ok) return read.response;
  const answer = await runBotsTool(read.body, engineBotsReaders());
  return apiJson(answer, 200, { ...rateLimitHeaders(rate), "cache-control": "private, no-store" });
}
