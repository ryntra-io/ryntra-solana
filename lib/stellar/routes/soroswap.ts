import { NATIVE_ASSET, formatAsset, parseAsset, type AssetIdentity } from "../asset.ts";
import { resolved, unavailable, type Evidence, type EvidenceSource, type EvidenceSources } from "../evidence.ts";
import type { RouteFee, RouteHop, RoutePlan } from "./plan.ts";

/**
 * Soroswap, read honestly.
 *
 * Soroswap is the building block selected for liquidity and route evidence. Its API was read live on 2026-08-14 and it
 * divides cleanly in two, which is the fact that shapes this whole file:
 *
 * ```text
 * public, no key      GET /health        indexer reachability and which protocols it indexes
 *                     GET /api/tokens    contract metadata (mainnet list is empty)
 *                     GET /api-json      the OpenAPI document
 *
 * key required, 403   POST /quote        the route evidence this product wants
 *                     GET  /pools        pool depth
 *                     GET  /price        prices
 *                     GET  /protocols    the protocol list
 *                     GET  /asset-list   the asset index
 * ```
 *
 * The key comes from registering an account at `api.soroswap.finance/register`.
 * **No agent may do that**, so it is a founder action and this adapter is built
 * to be finished by one rather than to pretend it already was.
 *
 * ## What that means in practice
 *
 * `readSoroswapHealth` works **today**, against the real API, with no
 * credentials. It is the whole of what the Providers surface can honestly show
 * about this provider, and it is not nothing: it says whether the indexer is
 * reachable and which protocols it is indexing per network, which is exactly the
 * information that decides whether a quote would even be meaningful.
 *
 * `readSoroswapRoute` is complete and returns `UNAVAILABLE` with the exact
 * reason and the exact next step while no key is configured. It does **not**
 * return a fabricated plan, a cached plan, or a plan computed by us. The one
 * thing a route-evidence adapter must never do is invent the evidence.
 *
 * ## The key never reaches a browser
 *
 * Every function here reads `process.env` and is called from server components
 * only. `routes.test.mjs` asserts that no client component imports this module,
 * for the same reason `wallets.test.mjs` asserts exactly one file imports the
 * wallet package: a credential in a client bundle is a credential published.
 */

export const SOROSWAP_API = "https://api.soroswap.finance";

/** The environment variable that finishes this integration. */
export const SOROSWAP_KEY_ENV = "SOROSWAP_API_KEY";

/** Exactly what a person has to do, named once so every surface quotes the same thing. */
export const SOROSWAP_GATE =
  "Register at api.soroswap.finance/register, generate an API key, and set SOROSWAP_API_KEY in the deployment environment. No agent may create that account.";

const source = (label: string, url: string): EvidenceSource => ({
  ref: `soroswap:${url}`,
  label,
});

/**
 * How long each answer stays fresh.
 *
 * A quote is the shortest-lived thing this product reads. Thirty seconds is
 * generous for a number that exists to be signed against — past that the
 * envelope says `STALE` and the surface has to say so rather than presenting an
 * old price as a current one. Indexer health moves at the pace of somebody
 * else's deployment, so a minute is right.
 */
export const SOROSWAP_FRESHNESS_SECONDS = { health: 60, quote: 30 } as const;

function apiKey(): string | null {
  const value = process.env[SOROSWAP_KEY_ENV];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Whether the credential-bearing half of this provider can be reached at all. */
export function soroswapIsConfigured(): boolean {
  return apiKey() !== null;
}

async function getJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: true; value: unknown } | { ok: false; reason: string; status: number | null }> {
  const { timeoutMs = 8000, ...rest } = init;
  try {
    const response = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      /* 403 is the shape this provider returns for "no key", and it is worth
         distinguishing from an outage: one is a founder action and the other is
         somebody else's incident. */
      return {
        ok: false,
        status: response.status,
        reason:
          response.status === 401 || response.status === 403
            ? `Soroswap refused the request (${response.status}). This endpoint requires an API key.`
            : `Soroswap answered ${response.status}.`,
      };
    }
    return { ok: true, value: await response.json() };
  } catch (error) {
    return { ok: false, status: null, reason: `Soroswap did not answer: ${(error as Error).message}` };
  }
}

// ------------------------------------------------------------------ health --

export type SoroswapHealth = Readonly<{
  reachable: boolean;
  /** Which protocols the indexer covers, per network, in the provider's own words. */
  indexed: Readonly<{ mainnet: readonly string[]; testnet: readonly string[] }>;
  /** Whether this deployment holds a key for the credentialed half. */
  configured: boolean;
}>;

/**
 * The public half, and it needs no credential.
 *
 * This is what makes Soroswap a real entry on the Providers surface today rather
 * than a name in a list: the indexer's own reachability, and the protocols it
 * says it indexes — on 2026-08-14 that was `soroswap, phoenix, aqua, sdex` on
 * mainnet and nothing on testnet, which is itself worth knowing before anybody
 * expects testnet route evidence.
 */
export async function readSoroswapHealth(): Promise<Evidence<SoroswapHealth>> {
  const url = `${SOROSWAP_API}/health`;
  const sources: EvidenceSources = [source("Soroswap API health", url)];
  const result = await getJson(url);

  if (!result.ok) return unavailable(result.reason, sources);

  const body = result.value as { status?: { indexer?: Record<string, unknown>; reachable?: unknown } };
  const indexer = body.status?.indexer ?? {};
  const list = (value: unknown): readonly string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

  if (typeof body.status?.reachable !== "boolean") {
    return unavailable("Soroswap answered, but not with a health document this adapter recognises.", sources);
  }

  return resolved({
    data: {
      reachable: body.status.reachable,
      indexed: { mainnet: list(indexer.mainnet), testnet: list(indexer.testnet) },
      configured: soroswapIsConfigured(),
    },
    sources,
    observedAt: new Date(),
    maxAgeSeconds: SOROSWAP_FRESHNESS_SECONDS.health,
  });
}

// ------------------------------------------------------------------- quote --

export type RouteRequest = Readonly<{
  assetIn: AssetIdentity;
  assetOut: AssetIdentity;
  /** In the asset's own smallest unit, as a string. Never a float. */
  amountIn: string;
  slippageBps: number;
  network: "mainnet" | "testnet";
}>;

/** How Soroswap names an asset in a request: a contract id, or `native`. */
function soroswapAsset(asset: AssetIdentity): string | null {
  if (asset.native) return NATIVE_ASSET.contractId ?? "native";
  return asset.contractId;
}

/**
 * Route evidence from Soroswap.
 *
 * Complete, and currently unreachable. Without a key it returns `UNAVAILABLE`
 * naming the endpoint, the status and the exact gate — which is the honest
 * result, and the one the Markets surface renders.
 *
 * When a key exists this issues the real `POST /quote` and normalizes the answer
 * into a `RoutePlan`. Two rules govern that normalization and both are refusals:
 *
 *   a response with no `amountOutMin` resolves `UNAVAILABLE`, because a quote
 *     without a floor is a number that can move against you between reading it
 *     and signing it;
 *
 *   nothing is computed to fill a gap — a missing price impact is `null`, never
 *     a figure this product derived and presented as the provider's.
 */
export async function readSoroswapRoute(request: RouteRequest): Promise<Evidence<RoutePlan>> {
  const url = `${SOROSWAP_API}/quote?network=${request.network}`;
  const sources: EvidenceSources = [source("Soroswap routing API", url)];

  const key = apiKey();
  if (!key) {
    return unavailable(
      `Soroswap route evidence needs an API key and this deployment has none. ${SOROSWAP_GATE}`,
      sources,
    );
  }

  const assetIn = soroswapAsset(request.assetIn);
  const assetOut = soroswapAsset(request.assetOut);
  if (!assetIn || !assetOut) {
    return unavailable(
      `Soroswap quotes by contract address, and ${formatAsset(!assetIn ? request.assetIn : request.assetOut)} has none resolved. A classic asset needs its SAC address before it can be routed.`,
      sources,
    );
  }

  const result = await getJson(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      assetIn,
      assetOut,
      amount: request.amountIn,
      tradeType: "EXACT_IN",
      slippageBps: request.slippageBps,
    }),
  });

  if (!result.ok) return unavailable(result.reason, sources);

  const body = result.value as Record<string, unknown>;
  const expectedOut = typeof body.amountOut === "string" ? body.amountOut : null;
  const minimumOut = typeof body.amountOutMin === "string" ? body.amountOutMin : null;

  if (!expectedOut) return unavailable("Soroswap answered without an output amount.", sources);
  if (!minimumOut) {
    return unavailable(
      "Soroswap answered without a minimum output. A quote with no floor is not route evidence — the delivered amount could move against you between reading it and signing it, with nothing to reconcile against.",
      sources,
    );
  }

  const hops: RouteHop[] = [];
  const rawPath = Array.isArray(body.routePlan) ? body.routePlan : [];
  for (const leg of rawPath) {
    const entry = leg as Record<string, unknown>;
    const from = typeof entry.assetIn === "string" ? parseAsset(entry.assetIn) : null;
    const to = typeof entry.assetOut === "string" ? parseAsset(entry.assetOut) : null;
    if (!from?.ok || !to?.ok) continue;
    hops.push({
      protocol: typeof entry.protocol === "string" ? entry.protocol : "unstated",
      from: from.asset,
      to: to.asset,
      share: typeof entry.percent === "number" ? entry.percent / 100 : null,
    });
  }

  const fees: RouteFee[] = [];
  if (typeof body.platformFee === "string") {
    fees.push({
      taker: "Soroswap",
      amount: body.platformFee,
      assetCode: request.assetIn.code,
      reason: "Aggregator fee, as reported by the provider.",
    });
  }

  return resolved({
    data: {
      provider: "Soroswap",
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      amountIn: request.amountIn,
      expectedOut,
      minimumOut,
      slippageBps: request.slippageBps,
      priceImpact: typeof body.priceImpactPct === "number" ? body.priceImpactPct / 100 : null,
      fees,
      hops,
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
      quoteId: typeof body.quoteId === "string" ? body.quoteId : null,
    },
    sources,
    observedAt: new Date(),
    maxAgeSeconds: SOROSWAP_FRESHNESS_SECONDS.quote,
  });
}
