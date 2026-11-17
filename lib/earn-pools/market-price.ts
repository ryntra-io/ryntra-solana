/**
 * Where the market prices a coin: Jupiter's Price API for a few mints, asked beside a pool's bins so the
 * screen can say when the pool's own price stands far from it. A courtesy read: no answer is no price, never a guess.
 */

import { normalizePriceMap } from "../solana/catalog.ts";
import { resolveJupiterCatalogEndpoint } from "../solana/quotes.ts";

export const MARKET_DEADLINE_MS = 4_000;

/** Jupiter's dollar price of each mint: its keyed endpoint when the server holds a key, the keyless one otherwise. A mint it does not price is absent. */
export async function jupiterUsd(mints: readonly string[], fetchImpl: typeof fetch = fetch): Promise<Readonly<Record<string, number>>> {
  const endpoint = resolveJupiterCatalogEndpoint();
  const origin = endpoint.tier === "pro" ? "https://api.jup.ag/price/v3" : "https://lite-api.jup.ag/price/v3";
  const response = await fetchImpl(`${origin}?ids=${mints.map(encodeURIComponent).join(",")}`, {
    headers: endpoint.apiKey ? { "x-api-key": endpoint.apiKey, accept: "application/json" } : { accept: "application/json" },
    signal: AbortSignal.timeout(MARKET_DEADLINE_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    return {};
  }
  const out: Record<string, number> = {};
  for (const [mint, text] of Object.entries(normalizePriceMap(await response.json()))) {
    const usd = Number(text);
    if (Number.isFinite(usd) && usd > 0) out[mint] = usd;
  }
  return out;
}
