import { NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { buildCapabilities } from "@/lib/api/v1/capabilities.server";
import { apiFailure, apiHeaders, apiMajorRefusal } from "@/lib/api/v1/http";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What this deployment serves a native client: the contract version and the
 * majors still served, the minimum app version, the network, every registered
 * module with its readiness and its routes, the signing modes, the auth
 * routes and their lifetimes, the watchlist limit, the attribution identity.
 *
 * Public and unauthenticated — a client reads it before it signs anything.
 * Cached briefly at the edge; a readiness flip in the registry is a
 * deployment, so a minute of cache never serves a stale promise for long.
 * The cache varies on the contract header: measured on production on
 * 2026-09-15, a request naming major 2 was served the cached major-1 answer
 * instead of the 426 the function returns, because the edge keyed the entry
 * by URL alone.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const capabilities = buildCapabilities();
  return NextResponse.json(capabilities, { headers: { ...apiHeaders(), ...publicCacheHeaders(60, 300), ...rateLimitHeaders(rate), Vary: "X-Ryntra-API" } });
}
