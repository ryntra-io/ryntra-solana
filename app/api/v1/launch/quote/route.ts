import { LaunchQuoteRequestSchema, type LaunchQuoteResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { createMeteoraDbcLaunchVenue } from "@/lib/core/venues/meteora-dbc/launch.server";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { launchDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/launch/quote` (contract 1.25.0) — what the creator's first
 * purchase buys on the fresh curve of a preset, and the most it may spend
 * under the preset's cap. Exact: the purchase lands in the transaction that
 * opens the curve, so nothing trades before it. Reads the config; builds
 * nothing.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused for a moment; try again later.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, LaunchQuoteRequestSchema);
  if (!read.ok) return read.response;
  if (!deps.network.configs[read.body.preset]) return apiFailure("VALIDATION_ERROR", "preset: not on this network");
  const venue = createMeteoraDbcLaunchVenue({ connection: deps.connection, configs: deps.network.configs, poolPayer: deps.poolPayer.publicKey.toBase58() });
  const quote = await venue.firstBuyQuote(read.body.preset, read.body.amountRaw, deps.network.pairs[read.body.preset].mint).catch(() => null);
  if (!quote) return apiFailure("UNAVAILABLE", "The curve could not be read. Try again.");
  return apiJson({
    preset: quote.preset,
    pairMint: quote.pairMint,
    amountInRaw: quote.amountInRaw,
    tokensOutRaw: quote.tokensOutRaw,
    capRaw: quote.capRaw,
    maxAmountInRaw: quote.maxAmountInRaw,
    withinCap: quote.withinCap,
  } satisfies LaunchQuoteResponse);
}
