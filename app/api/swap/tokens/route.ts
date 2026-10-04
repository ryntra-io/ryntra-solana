import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { searchSwapTokens } from "@/lib/relay/currencies";
import { searchTokenCatalog } from "@/lib/solana/catalog";
import { assetRoutableOnNetwork, catalogAssets, isSwapNetwork, type SwapNetwork } from "@/lib/swap/catalog";
import { resolveRelayApiKey } from "@/lib/relay/api-key.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Find a token on any of the four networks, by ticker, name or address.
 *
 * The cross-chain swap carries arbitrary tokens, and a pair a person cannot
 * name is a pair they cannot make. Solana already had this —
 * `/api/solana/tokens/search`, over Jupiter's catalogue — so that path is
 * reused rather than replaced: it is the one this product has shipped on, it
 * carries Jupiter's own `isVerified` and `isSuspicious`, and swapping it for a
 * second source would trade a known answer for a new one. The three EVM
 * networks come from Relay's index, which is the same index the quote will be
 * priced against.
 *
 * Reads only. Nothing here is a recommendation, and every token a person picks
 * is re-read at quote time for the fact that actually decides a swap — its
 * decimals.
 *
 * ## `verified` is the answer, not a decoration
 *
 * Searching `USDC` on Solana returns the real one and four impostors wearing
 * variations of the name. This route returns them all, flagged, and never
 * silently drops or reorders them into a preference: hiding a token somebody
 * actually holds is its own defect, and a surface that shows only "safe"
 * results teaches people that everything shown is safe.
 */

const RequestSchema = z
  .object({
    network: z.string(),
    query: z.string().min(1).max(64),
    limit: z.number().int().min(1).max(50).default(24),
  })
  .strict();

export type SwapTokenResult = Readonly<{
  network: SwapNetwork;
  address: string;
  symbol: string;
  name: string | null;
  decimals: number;
  verified: boolean;
  /** True when the source actively flags it, not merely when it is unvouched. */
  suspicious: boolean;
  native: boolean;
}>;

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: responseHeaders(rate) });
}

/** The chain's own assets, so an empty search still offers the obvious ones. */
function catalogMatches(network: SwapNetwork, query: string): readonly SwapTokenResult[] {
  const needle = query.trim().toLowerCase();
  return catalogAssets(network)
    .filter((asset) => asset.code.toLowerCase().includes(needle) || asset.symbol.toLowerCase().includes(needle) || (asset.address ?? "").toLowerCase() === needle)
    .map((asset) => ({
      network,
      address: asset.address ?? asset.solanaMint ?? "",
      symbol: asset.symbol,
      name: asset.symbol,
      decimals: asset.decimals,
      verified: true,
      suspicious: false,
      native: asset.kind === "NATIVE",
    }));
}

export async function POST(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success || !isSwapNetwork(parsed.data.network)) {
    return failure(400, "VALIDATION_ERROR", "The token search did not match its schema.", rate);
  }
  const { network, query, limit } = { ...parsed.data, network: parsed.data.network as SwapNetwork };

  if (network === "solana") {
    const found = await searchTokenCatalog(query, limit);
    if (!found.ok) {
      const fallback = catalogMatches(network, query);
      if (fallback.length > 0) return Response.json({ network, tokens: fallback, degraded: true }, { headers: responseHeaders(rate) });
      return failure(502, "TOKENS_UNAVAILABLE", "The token catalogue could not be read.", rate);
    }
    /* A row with no decimals cannot size a swap, so it is not offered as a
       choice — the same refusal the quote would make later, made earlier and
       without wasting the person's time. */
    const tokens: SwapTokenResult[] = found.rows
      .filter((row): row is typeof row & { decimals: number; symbol: string } => row.decimals !== null && row.symbol !== null)
      .map((row) => ({
        network,
        address: row.mint,
        symbol: row.symbol,
        name: row.name ?? null,
        decimals: row.decimals,
        verified: row.isVerified === true,
        suspicious: row.isSuspicious === true,
        native: row.mint === "So11111111111111111111111111111111111111112",
      }));
    return Response.json({ network, tokens }, { headers: responseHeaders(rate) });
  }

  const found = await searchSwapTokens({ network, term: query, limit }, { apiKey: resolveRelayApiKey() });
  if (!found.ok) {
    /* The catalogue's own assets still answer, so a provider outage narrows
       the choice rather than emptying the form. */
    const fallback = catalogMatches(network, query);
    if (fallback.length > 0) return Response.json({ network, tokens: fallback, degraded: true }, { headers: responseHeaders(rate) });
    return failure(found.code === "RATE_LIMITED" ? 429 : 502, `TOKENS_${found.code}`, found.reason, rate);
  }

  const seen = new Set<string>();
  const tokens: SwapTokenResult[] = [];
  for (const row of [...catalogMatches(network, query), ...found.tokens.map((token) => ({ ...token, suspicious: false }))]) {
    const key = row.address.toLowerCase();
    if (seen.has(key)) continue;
    /* An asset the network's router refuses outright is not a choice, and
       listing it would be the worst kind of wrong: Robinhood Chain's index
       knows TSLA and NVDA by name while its router answers
       `UNSUPPORTED_CURRENCY` to both, in both directions. A person would pick
       one, and nothing downstream could ever build it. */
    if (!assetRoutableOnNetwork(network, row.address)) continue;
    seen.add(key);
    tokens.push(row);
  }
  return Response.json({ network, tokens }, { headers: responseHeaders(rate) });
}
