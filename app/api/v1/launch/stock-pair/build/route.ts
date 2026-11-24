import { LaunchStockPairBuildRequestSchema, type LaunchStockPairBuildResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { stockPairOpen } from "@/lib/core/launch/stock-pair";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchDeps, launchFailureCode } from "@/lib/launch/runtime.server";
import { QUOTE_CONFIG_VERSIONS, type QuoteConfigVersion } from "@/lib/core/launch/quote-asset";
import { honestyPlain, prepareStockPairConfig } from "@/lib/launch/stock-pair.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/stock-pair/build` — the config of one coin launched against a stock:
 * the stock read now (the register, Meteora's badge, the shelf), the curve sized in the stock's units, and the bytes the
 * creator signs first and pays the rent of — as «Розширений»'s config, sent by `advanced/config/submit`, its fresh key
 * sealed on the server until then. Beside them, the facts of the line before the signature. Served only where
 * `RYNTRA_LAUNCH_STOCK_PAIR=open`; elsewhere CAPABILITY_UNAVAILABLE.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!stockPairOpen(process.env)) return apiFailure("CAPABILITY_UNAVAILABLE", "A launch paired with a stock is not offered here.");
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused; nothing was built.");
  const rate = await consumeSharedLaunchWrite("build", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, LaunchStockPairBuildRequestSchema);
  if (!read.ok) return read.response;
  const prepared = await prepareStockPairConfig(deps, read.body).catch(() => null);
  if (!prepared) return apiFailure("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  if (!prepared.ok) return apiFailure(launchFailureCode(prepared.code, request.headers), prepared.message);
  const quote = prepared.quote;
  const version = quote?.configVersion;
  if (!quote || !(QUOTE_CONFIG_VERSIONS as readonly string[]).includes(version ?? "")) return apiFailure("UNAVAILABLE", "The stock could not be read now; nothing was built. Try again.");
  return apiJson({
    buildId: prepared.buildId,
    network: deps.network.chain,
    config: prepared.config,
    unsignedWireBase64: prepared.wireBase64,
    terms: prepared.terms,
    creatorCostLamports: prepared.creatorCostLamports,
    quote: { ...quote, configVersion: version as QuoteConfigVersion },
    stockPair: { ...prepared.stockPair, honesty: honestyPlain(prepared.stockPair.honesty) },
    expiresAt: prepared.expiresAt,
    signableMs: prepared.signableMs,
  } satisfies LaunchStockPairBuildResponse);
}
