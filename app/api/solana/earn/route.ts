import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { WALLET_ADDRESS } from "@/lib/earn/model";
import { readEarnSurface } from "@/lib/earn/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * Earn as it stands right now: every provider with its markets or the reason it has none, this wallet's
 * positions read from the chain, and whether an action is open here at all.
 *
 * Builds nothing and signs nothing, so it is behind a read's rate limit rather than the action door. A
 * provider that cannot be reached is said to be unreachable in its own row; the page never draws a market
 * list that is empty because a key is missing.
 */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  const headers = { "cache-control": "private, no-store" };
  if (!rate.allowed) return Response.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429, headers });
  const owner = new URL(request.url).searchParams.get("owner");
  const surface = await readEarnSurface(owner && WALLET_ADDRESS.test(owner) ? owner : null);
  return Response.json(surface, { headers });
}
