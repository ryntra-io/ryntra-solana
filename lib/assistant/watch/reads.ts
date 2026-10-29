/**
 * One read of the market for every watched token of a pass (AI-05): Jupiter
 * Price v3 in batches of 50, DexScreener `tokens/v1` in batches of 30 — so
 * a thousand rules on SOL are one request to each, and a hundred tokens are
 * two and four. Each request is bounded in time; a source that fails leaves
 * its figures null, and a token none of the two answered for is «not read».
 * Keyless where it can be: Jupiter's key only where the deployment set one.
 * Reads only.
 */

import { composeMintRead, DEXSCREENER_BATCH, dexTokensUrl, JUPITER_BATCH, jupiterPriceUrl, parseJupiterPrices, type MintRead } from "./market.ts";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type WatchReadDeps = Readonly<{
  fetchImpl?: FetchLike;
  /** Jupiter Price v3: the lite host without a key, the pro host with one. */
  jupiter: Readonly<{ url: string; apiKey: string | null }>;
  timeoutMs?: number;
  clock: () => number;
}>;

export type WatchReads = Readonly<{
  reads: ReadonlyMap<string, MintRead>;
  /** Requests made, by source — what «one read for everyone» is measured by. */
  requests: Readonly<{ jupiter: number; dex: number }>;
}>;

function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}

async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, timeoutMs: number): Promise<Readonly<{ ok: true; body: unknown }> | Readonly<{ ok: false }>> {
  try {
    const response = await fetchImpl(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false };
    }
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false };
  }
}

export async function readWatchMarkets(mints: readonly string[], deps: WatchReadDeps): Promise<WatchReads> {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = deps.timeoutMs ?? 6_000;
  const unique = [...new Set(mints)];
  const requests = { jupiter: 0, dex: 0 };

  const jupiterBatches = batches(unique, JUPITER_BATCH);
  const dexBatches = batches(unique, DEXSCREENER_BATCH);
  const prices = new Map<string, { price: number | null; change24h: number | null }>();
  const jupiterAnswered = new Set<string>();
  const dexBodies = new Map<string, unknown>();

  await Promise.all([
    ...jupiterBatches.map(async (batch) => {
      requests.jupiter += 1;
      const got = await getJson(fetchImpl, jupiterPriceUrl(deps.jupiter.url, batch), deps.jupiter.apiKey ? { "x-api-key": deps.jupiter.apiKey } : {}, timeoutMs);
      if (!got.ok) return;
      for (const mint of batch) jupiterAnswered.add(mint);
      for (const [mint, row] of parseJupiterPrices(got.body)) prices.set(mint, row);
    }),
    ...dexBatches.map(async (batch) => {
      requests.dex += 1;
      const got = await getJson(fetchImpl, dexTokensUrl(batch), {}, timeoutMs);
      if (!got.ok) return;
      for (const mint of batch) dexBodies.set(mint, got.body);
    }),
  ]);

  const observedAt = new Date(deps.clock()).toISOString();
  const reads = new Map<string, MintRead>();
  for (const mint of unique) {
    reads.set(
      mint,
      composeMintRead({ mint, observedAt, jupiter: prices.get(mint) ?? null, jupiterAnswered: jupiterAnswered.has(mint), dexBody: dexBodies.get(mint) ?? null, dexAnswered: dexBodies.has(mint) }),
    );
  }
  return { reads, requests };
}
