import { NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { apiFailure, apiHeaders, apiMajorRefusal } from "@/lib/api/v1/http";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";
import { isDepthKind, isDepthList, isDepthWindow, savedMints } from "@/lib/market-depth/model";
import { readDepth, readSaved } from "@/lib/market-depth/read.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/market/depth?list=&window=` — one list of the Market with every figure of its coins, from
 * Jupiter's Token API v2: `list` — trending · fresh · gainers · losers · traded · stocks; `window` — 5m · 1h · 6h ·
 * 24h (the window «trending», «traded», «gainers» and «losers» are ranked over); `list=saved&mints=a,b,…` — the coins a
 * person starred (up to 50), by mint; `kind` (1.102.0) — all · meme · crypto · stock · preipo: «all» is the memes and the
 * crypto together, a company's token stands only under its own kind. Public, as the market is; the edge keeps
 * an answer for 30 seconds and the server reads each Jupiter path at most once in 45.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  const limits = rateLimitHeaders(rate);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: limits });
  const params = new URL(request.url).searchParams;
  const list = params.get("list") ?? "trending";
  const window = params.get("window") ?? "1h";
  const kind = params.get("kind") ?? "all";
  if (list === "saved") {
    const mints = savedMints(params.get("mints"));
    if (!mints) return apiFailure("VALIDATION_ERROR", "mints must be up to 50 Solana addresses, comma-separated.", { headers: limits });
    const saved = await readSaved(mints).catch(() => null);
    if (!saved) return apiFailure("UNAVAILABLE", "The market did not answer. Try again.", { headers: limits });
    return NextResponse.json(saved, { headers: { ...apiHeaders(), ...publicCacheHeaders(30, 120), ...limits, Vary: "X-Ryntra-API" } });
  }
  if (!isDepthList(list)) return apiFailure("VALIDATION_ERROR", "list must be trending, fresh, gainers, losers, traded or stocks.", { headers: limits });
  if (!isDepthWindow(window)) return apiFailure("VALIDATION_ERROR", "window must be 5m, 1h, 6h or 24h.", { headers: limits });
  if (!isDepthKind(kind)) return apiFailure("VALIDATION_ERROR", "kind must be all, meme, crypto, stock or preipo.", { headers: limits });
  const answer = await readDepth(list, window, fetch, kind).catch(() => null);
  if (!answer) return apiFailure("UNAVAILABLE", "The market did not answer. Try again.", { headers: limits });
  return NextResponse.json(answer, { headers: { ...apiHeaders(), ...publicCacheHeaders(30, 120), ...limits, Vary: "X-Ryntra-API" } });
}
