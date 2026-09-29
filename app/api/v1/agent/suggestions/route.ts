import { NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { parseContextParam } from "@/lib/agent/context";
import { suggestionsFor } from "@/lib/agent/suggestions";
import type { AgentSuggestionsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiHeaders, apiMajorRefusal } from "@/lib/api/v1/http";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/agent/suggestions?context=` — the questions a person can ask
 * from a context, in the reader's language. Public: nothing here is the
 * wallet's. `context` is `asset:<mint>[:<symbol>]`, `plan:<id>`, `portfolio`,
 * `note:<id>` or `page:<name>`; absent, the general ones.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") === "uk" ? "uk" : "en";
  const context = parseContextParam(url.searchParams.get("context"));
  const body: AgentSuggestionsResponse = { context, suggestions: suggestionsFor(context, locale) };
  return NextResponse.json(body, { headers: { ...apiHeaders(), ...publicCacheHeaders(300, 600), ...rateLimitHeaders(rate), Vary: "X-Ryntra-API" } });
}
