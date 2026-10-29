import { after } from "next/server";

import { BASE58, type LaunchMarketResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { serverTimingOf } from "@/lib/core/pipeline";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { LAUNCH_READ_HEADER } from "@/lib/launch/read-header";
import { launchMarketCached, readLaunchMarketAnswer, readLaunchMarketFacts } from "@/lib/launch/market.server";
import { launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/v1/launch/{mint}/market` (contract 1.27.0) — a Ryntra launch's
 * market as the chain shows it now: the price and market cap, the curve's way
 * to the DEX and its fee now, the holders with their labels and the groups'
 * shares, the trades, the chart, the facts of risk with what each rests on,
 * and the creator's other launches. Public. A cold read answers first with
 * what the newest page of the history reached (SOL-P1), the header
 * `x-ryntra-read: first` saying so; the next ask has the full read.
 */
export async function GET(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  try {
    const started = performance.now();
    const cached = launchMarketCached(deps, mint);
    const { facts, first, behind } = await readLaunchMarketAnswer(deps, mint);
    if (!facts) return apiFailure("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here, or its creation is not confirmed yet.");
    /* SOL-P1: how long each step of the read took — a read served from memory names only that. */
    const timing = serverTimingOf(cached ? [] : facts.timings, [{ name: cached ? "cache" : first ? "first" : "read", ms: performance.now() - started }]);
    /* A first answer: what the newest page of the history did not reach is said as not read yet — ask again in a moment.
       The full read goes on after the answer, the function kept alive for it, so the next ask finds it. */
    if (behind) after(() => readLaunchMarketFacts(deps, mint).then(() => undefined, () => undefined));
    return apiJson(facts.response satisfies LaunchMarketResponse, 200, { "server-timing": timing, ...(first ? { [LAUNCH_READ_HEADER]: "first" } : {}) });
  } catch {
    return apiFailure("UNAVAILABLE", "The chain could not be read now; try again.");
  }
}
