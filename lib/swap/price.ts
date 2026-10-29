/**
 * What one unit of an asset is worth in dollars — a display figure, and never
 * anything else.
 *
 * A person typing `5` on the Swap form sees `5`. Whether that is five dollars
 * or five hundred was on no surface at all, on any of the four networks. This
 * is the number that goes under the amount.
 *
 * ## Why a fourth provider, and why this one
 *
 * There was no price source in this product for anything off Solana. Jupiter's
 * catalogue carries `usdPrice` for mints and knows nothing else; Relay's
 * currency index carries symbol, decimals and a logo and **no price at all**
 * (checked live 2026-09-10); and a provider quote states USD only once both
 * wallets are known, which is after the moment the figure is wanted — a person
 * types an amount long before they have pasted a destination.
 *
 * DefiLlama's coins API answers all four networks keylessly, by **each token's
 * own chain and its own address**, which is the property that matters here:
 * nothing is mapped, substituted or assumed to be the same asset as something
 * on another chain. USDG on Robinhood Chain is priced as USDG on Robinhood
 * Chain — the chain is served under the slug `robinhood`, verified live on
 * 2026-09-10 — rather than borrowed from a token that shares its symbol.
 *
 * ## It decides nothing, and the code has to make that impossible to forget
 *
 * This figure never sizes a swap, never gates a button, never enters a plan and
 * never reaches a signature. What is signed is the quote's own minimum, from
 * the rail that will fill it. A dollar line is there so a person knows what
 * they are about to move; if it is wrong by a cent nobody is harmed, and if it
 * is missing the form still works. That is why every failure here returns
 * `null` rather than an error: **no price is a state this surface renders**, and
 * a stale or unconfident one is treated as no price rather than shown.
 *
 * Read-only, server-side, and batched. Server-side is deliberate: the browser
 * asking a third party about each token would leak which assets a person is
 * looking at to somebody who has no business knowing.
 */

import { resolveSwapAsset, type SwapNetwork, type SwapSideRef } from "./catalog.ts";

export const DEFILLAMA_COINS_ORIGIN = "https://coins.llama.fi";

/**
 * How each network is named in a DefiLlama key.
 *
 * Keyed rather than derived, for the reason the catalogue gives twice over: a
 * chain of ternaries ending in a default is how a fourth network quietly wears
 * a third one's name, and here that would put another chain's price under a
 * person's amount. Robinhood Chain answers to `robinhood`; the alias
 * `robinhoodchain` also resolves and is not used, so there is one name.
 */
const PRICE_CHAIN_SLUG: Readonly<Record<SwapNetwork, string>> = {
  solana: "solana",
  base: "base",
  ethereum: "ethereum",
  arbitrum: "arbitrum",
  optimism: "optimism",
  polygon: "polygon",
  /* DefiLlama still keys BNB Chain under its former name. A slug is whatever the
     price source calls the chain, not what the chain calls itself, and guessing
     `bnb` here would silently return no price on every BNB asset. */
  bnb: "bsc",
  robinhood: "robinhood",
  /* Read 2026-10-15: `arc:0x3600…` answers USDC with confidence 0.99. */
  arc: "arc",
};

/** The address a chain's own coin is priced under; it has no contract of its own. */
const NATIVE_COIN_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * How confident the source is that this is a real price, and how old it may be.
 *
 * A thin token with two trades a day is priced with real confidence and a
 * timestamp an hour old; a token nobody prices at all comes back absent. What
 * these two bounds exclude is the middle — a figure the source itself doubts,
 * or one old enough to be about a different market. Both render as no dollar
 * line, which is a state this surface already has.
 */
const MINIMUM_CONFIDENCE = 0.9;
const MAXIMUM_AGE_SECONDS = 3_600;

export type SwapUnitPrice = Readonly<{
  network: SwapNetwork;
  asset: string;
  /** Dollars per whole unit, as the source stated it. Never rounded here. */
  usd: number;
  confidence: number;
  observedAt: string;
}>;

export type SwapPriceDependencies = Readonly<{
  fetchImpl?: typeof fetch;
  origin?: string;
  timeoutMs?: number;
  now?: () => number;
}>;

/**
 * The DefiLlama key for one side, or null when this product cannot name the
 * token — which is the same answer as "no price", and deliberately so.
 */
export function priceKeyFor(side: SwapSideRef): string | null {
  const resolved = resolveSwapAsset(side);
  if (!resolved) return null;
  const slug = PRICE_CHAIN_SLUG[resolved.network];
  if (resolved.network === "solana") {
    const mint = resolved.solanaMint ?? resolved.asset;
    return mint ? `${slug}:${mint}` : null;
  }
  /* A catalogue asset states its contract and the native coin has none; an
     arbitrary token reached this point as its own `0x` address. */
  const contract = resolved.catalog ? resolved.catalog.address ?? NATIVE_COIN_ADDRESS : resolved.asset;
  return `${slug}:${contract}`;
}

type Coin = Readonly<{ price?: unknown; confidence?: unknown; timestamp?: unknown }>;

function readCoin(value: unknown): Readonly<{ price: number; confidence: number; timestamp: number }> | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Coin;
  const price = typeof row.price === "number" ? row.price : Number.NaN;
  /* A price of zero is not a price. Nothing here trades at exactly nothing, and
     a zero under an amount reads as "this is worthless" rather than "unknown". */
  if (!Number.isFinite(price) || price <= 0) return null;
  const confidence = typeof row.confidence === "number" ? row.confidence : 1;
  const timestamp = typeof row.timestamp === "number" ? row.timestamp : 0;
  return { price, confidence, timestamp };
}

/**
 * Ask for several sides at once.
 *
 * Both legs of the form change together, so they are asked together: one
 * upstream request per change rather than one per leg. A side this product
 * cannot name is simply absent from the answer.
 */
export async function readSwapUnitPrices(
  sides: readonly SwapSideRef[],
  deps: SwapPriceDependencies = {},
): Promise<readonly SwapUnitPrice[]> {
  const wanted = new Map<string, SwapSideRef>();
  for (const side of sides.slice(0, 8)) {
    const key = priceKeyFor(side);
    if (key) wanted.set(key, side);
  }
  if (wanted.size === 0) return [];

  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const url = `${deps.origin ?? DEFILLAMA_COINS_ORIGIN}/prices/current/${[...wanted.keys()].map(encodeURIComponent).join(",")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 6_000);
  let body: unknown;
  try {
    const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) return [];
    body = await response.json();
  } catch {
    /* A price nobody could read is no price. The form keeps working. */
    return [];
  } finally {
    clearTimeout(timer);
  }

  const coins = (body as { coins?: Record<string, unknown> } | null)?.coins;
  if (typeof coins !== "object" || coins === null) return [];

  const out: SwapUnitPrice[] = [];
  for (const [key, side] of wanted) {
    const coin = readCoin(coins[key]);
    if (!coin) continue;
    if (coin.confidence < MINIMUM_CONFIDENCE) continue;
    const ageSeconds = Math.round(now() / 1000 - coin.timestamp);
    if (coin.timestamp > 0 && ageSeconds > MAXIMUM_AGE_SECONDS) continue;
    out.push({
      network: side.network,
      asset: side.asset,
      usd: coin.price,
      confidence: coin.confidence,
      observedAt: new Date(coin.timestamp > 0 ? coin.timestamp * 1000 : now()).toISOString(),
    });
  }
  return out;
}

/**
 * What a raw amount of an asset is worth, in dollars.
 *
 * Exact integer arithmetic down to the cent rather than `Number(raw) / 10**d`,
 * which loses the low digits of an 18-decimal amount before the multiply ever
 * happens. Returns null for anything it cannot compute, because a wrong dollar
 * figure under an amount is worse than none.
 */
/**
 * The scale the price is carried at while the multiply happens.
 *
 * Twelve places, not six. Six looked like plenty — nobody reads a millionth of
 * a dollar — and it is catastrophically wrong at the other end of the range:
 * BONK trades near $0.0000027, which rounds to three micro-dollars, an eleven
 * per cent error before the amount is even multiplied. A million BONK would
 * have read $3.00 against a true $2.69. Twelve places hold seven significant
 * digits of a price that small, and the largest price anyone will meet here
 * stays far inside what the arithmetic can carry.
 */
const PRICE_SCALE = 1_000_000_000_000n;

export function usdValueOfRaw(raw: string, decimals: number, unitUsd: number): number | null {
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  if (!Number.isFinite(unitUsd) || unitUsd <= 0) return null;
  const scaled = BigInt(Math.round(unitUsd * Number(PRICE_SCALE)));
  if (scaled <= 0n) return null;
  const value = (BigInt(raw) * scaled) / 10n ** BigInt(decimals);
  return Number(value) / Number(PRICE_SCALE);
}
