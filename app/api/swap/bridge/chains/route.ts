import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { resolveRelayApiKey } from "@/lib/relay/api-key.server";
import { bridgeChainView, fetchBridgeChains } from "@/lib/relay/bridge-chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Every network the Bridge can carry this minute: Relay's own `/chains`, whole — Solana first, then the ones
 * most reached for, then the rest by name — each with the wallet that signs on it, or the deposit address that stands
 * in for one. Read every few minutes, not per visit; a chain Relay closes leaves the list without a release.
 */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  const headers = { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
  if (!rate.allowed) return Response.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429, headers });
  const index = await fetchBridgeChains({ apiKey: resolveRelayApiKey() });
  if (!index.ok) return Response.json({ error: { code: "CHAINS_UNAVAILABLE", message: "The networks could not be read right now." } }, { status: 502, headers });
  return Response.json({ chains: index.chains.map(bridgeChainView), observedAt: index.observedAt }, { headers });
}
