import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { resolveRelayApiKey } from "@/lib/relay/api-key.server";
import { chainById, fetchBridgeChains } from "@/lib/relay/bridge-chains";
import { searchBridgeTokens } from "@/lib/relay/bridge-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * The coins of one network, from Relay's index: its own list first, a search by ticker, name or pasted
 * address on any network it carries. Every coin keeps Relay's «verified»; nothing is hidden for lacking it. With no
 * search the network's own coin stands first.
 *
 * `GET ?chain=<Relay chain id>&q=<term>`
 */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  const headers = { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
  const fail = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers });
  if (!rate.allowed) return fail(429, "RATE_LIMITED", "Too many requests.");

  const url = new URL(request.url);
  const chainId = Number(url.searchParams.get("chain"));
  const term = (url.searchParams.get("q") ?? "").trim().slice(0, 64);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return fail(400, "VALIDATION_ERROR", "Name a network.");

  const apiKey = resolveRelayApiKey();
  const index = await fetchBridgeChains({ apiKey });
  const chain = index.ok ? chainById(index.chains, chainId) : null;
  if (index.ok && !chain) return fail(404, "UNKNOWN_CHAIN", "That network is not carried right now.");

  const found = await searchBridgeTokens({ chainId, term, limit: term ? 30 : 40 }, { apiKey });
  if (!found.ok) {
    // The network's own coin and Relay's featured coins still answer, so an outage narrows the list instead of emptying it.
    if (chain && !term) {
      const tokens = [chain.native, ...chain.featured].map((token) => ({ ...token, logo: token.logo !== null }));
      return Response.json({ chain: chainId, tokens, degraded: true }, { headers });
    }
    return fail(found.code === "RATE_LIMITED" ? 429 : 502, `TOKENS_${found.code}`, "The coins could not be read right now.");
  }

  const tokens = [...found.tokens];
  if (chain && !term && !tokens.some((token) => token.address.toLowerCase() === chain.native.address.toLowerCase())) tokens.unshift(chain.native);
  return Response.json({ chain: chainId, tokens: tokens.map((token) => ({ ...token, logo: token.logo !== null })) }, { headers });
}
