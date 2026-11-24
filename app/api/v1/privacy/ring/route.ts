import { NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";
import { openNetwork, relayKey } from "@/lib/privacy/relay-key.server";
import { readRingCount } from "@/lib/privacy/ring-count";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * `GET /api/v1/privacy/ring`: the ring's counter behind the private band's «i» — the SOL in the ring and the
 * number of private balances (`lib/privacy/ring-count.ts`). Reading only; the server's Helius key never leaves it. The
 * warm instance keeps a read a minute and the edge a minute more, so the counter costs the ring one batch a minute at
 * most. On the network `NEXT_PUBLIC_RYNTRA_PRIVATE` opens (`devnet`, or `mainnet` with its key), with that network's key
 * — otherwise 404.
 */
export async function GET(request: Request) {
  const network = openNetwork();
  if (!network) return new NextResponse(null, { status: 404 });
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  const limits = rateLimitHeaders(rate);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many reads from this address; wait a minute.", { headers: limits });
  const count = await readRingCount({ key: relayKey(network), network }).catch(() => null);
  if (!count) return apiFailure("UNAVAILABLE", "The ring could not be read right now; ask again in a minute.", { headers: limits });
  return apiJson({ count }, 200, { ...publicCacheHeaders(60, 120), ...limits, Vary: "X-Ryntra-API" });
}
