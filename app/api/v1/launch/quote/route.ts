import { LaunchQuoteRequestSchema, type LaunchQuoteResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { createMeteoraDbcLaunchVenue } from "@/lib/core/venues/meteora-dbc/launch.server";
import { rateLimitHeaders } from "@/lib/http-control";
import { advancedPresetOf } from "@/lib/core/launch/advanced";
import { advancedConfigFor } from "@/lib/launch/advanced.server";
import { launchNetwork, launchPair } from "@/lib/launch/config.server";
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
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused; nothing was built.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, LaunchQuoteRequestSchema);
  if (!read.ok) return read.response;
  const { preset, pairMint, advancedConfig } = read.body;
  /* «Спільнота» names its community; «Розширений» its own config, which the creator made here (SOL-L5). */
  if (pairMint !== undefined && preset !== "community") return apiFailure("VALIDATION_ERROR", "pairMint: «Спільнота» only");
  if ((advancedConfig !== undefined) !== (preset === "advanced")) return apiFailure("VALIDATION_ERROR", "advancedConfig: «Розширений» only, and always");
  let configs = deps.network.configs;
  let custom;
  if (preset === "advanced") {
    const made = await advancedConfigFor(deps, null, advancedConfig ?? "").catch(() => null);
    if (!made) return apiFailure("UNAVAILABLE", "The config could not be read. Try again.");
    if ("ok" in made) return apiFailure("VALIDATION_ERROR", `advancedConfig: ${made.message}`);
    configs = { ...configs, advanced: made.config };
    custom = advancedPresetOf(made.terms);
  } else if (!deps.network.configs[preset]) return apiFailure("VALIDATION_ERROR", "preset: not on this network");
  let pair;
  try {
    pair = launchPair(deps.network, preset, pairMint);
  } catch {
    return apiFailure("VALIDATION_ERROR", "pairMint: not offered on this network");
  }
  const venue = createMeteoraDbcLaunchVenue({ connection: deps.connection, configs, poolPayer: deps.poolPayer.publicKey.toBase58(), advancedFeeClaimer: deps.network.advanced?.feeClaimer ?? null });
  const quote = await venue.firstBuyQuote(preset, read.body.amountRaw, pair.mint, custom).catch(() => null);
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
