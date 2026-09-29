/**
 * Spot markets — the reads behind `/api/spot/markets` and `/api/spot/market`.
 *
 * Jupiter Tokens V2 is the one source. Three ranked lists (`toptraded`,
 * `toporganicscore`, `toptrending`, each capped at 100 by the provider) give
 * the day's traffic; the `verified` universe (3,346 rows, 4.9 MB, brotli on the
 * wire) gives every tagged stock, meme and major so a category view is
 * complete rather than whatever happened to trend today. The universe is
 * cached for ten minutes per instance and refreshed in the background; the
 * ranked lists for one minute. A failed refresh serves the last good read and
 * says so through `stale`.
 *
 * The live `tag` endpoint accepts only `lst` and `verified` on 2026-09-11 —
 * `stocks`, documented, answers *Invalid tag provided* — which is why the
 * categories are derived from each row's own tags rather than asked for.
 *
 * Search is passed straight to `/search`, which handles symbol, name and mint
 * itself and answers within a second keyless.
 */

import { jupiterBackgroundAllowed, noteJupiterResponse } from "../solana/jupiter-budget.ts";
import { resolveJupiterCatalogEndpoint, type JupiterTier } from "../solana/quotes.ts";
import { normalizeSpotMarket, rankMarkets, rankSearch, type SpotMarket, type SpotMarketListRow, type SpotView } from "./markets.ts";

const LITE_BASE = "https://lite-api.jup.ag/tokens/v2";
const PRO_BASE = "https://api.jup.ag/tokens/v2";

const UNIVERSE_TTL_MS = 10 * 60_000;
const RANKED_TTL_MS = 60_000;
const DETAIL_TTL_MS = 15_000;
/** While the provider's window is nearly spent, a detail this young is served as it is, stated stale, rather than asked for again. */
const DETAIL_LOW_BUDGET_MS = 120_000;
/** Serve a stale read for at most this long before saying the source is gone. */
const STALE_GRACE_MS = 60 * 60_000;
const UNIVERSE_CEILING_BYTES = 24 * 1024 * 1024;
const LIST_CEILING_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 20_000;

export type SpotSourceFailure = Readonly<{
  ok: false;
  code: "RATE_LIMITED" | "REFUSED" | "UNREACHABLE" | "MALFORMED";
  reason: string;
}>;

type Cached<T> = { value: T; readAt: number };

function baseOf(tier: JupiterTier): string {
  return tier === "pro" ? PRO_BASE : LITE_BASE;
}

/* A keyless catalogue read that is refused as too frequent is asked once
   more after the provider's own pause, with a little jitter so four reads
   refused together do not return together. Measured on production on
   2026-09-14: a cold instance answering the page's first list, its second
   list and its market detail at once — nine catalogue calls inside one
   second — had all of them refused, and the person saw an empty market
   column until they changed tab. */
const RETRY_AFTER_DEFAULT_MS = 1_200;
const RETRY_AFTER_MAX_MS = 3_000;
const RETRY_JITTER_MS = 600;

function retryAfterMs(response: Response): number {
  const header = Number(response.headers.get("retry-after") ?? "");
  const base = Number.isFinite(header) && header > 0 ? Math.min(header * 1_000, RETRY_AFTER_MAX_MS) : RETRY_AFTER_DEFAULT_MS;
  return base + Math.floor(Math.random() * RETRY_JITTER_MS);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function readBounded(response: Response, ceiling: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes > ceiling) {
      await response.body?.cancel();
      throw new Error(`Jupiter response exceeds the ${ceiling}-byte ceiling.`);
    }
  }
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let seen = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > ceiling) {
      await reader.cancel();
      throw new Error(`Jupiter response exceeds the ${ceiling}-byte ceiling.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function getRows(
  path: string,
  ceiling: number,
  timeoutMs: number,
): Promise<{ ok: true; rows: SpotMarket[] } | SpotSourceFailure> {
  const endpoint = resolveJupiterCatalogEndpoint();
  let response: Response;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetch(`${baseOf(endpoint.tier)}${path}`, {
        headers: endpoint.apiKey ? { "x-api-key": endpoint.apiKey, accept: "application/json" } : { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (failure) {
      return { ok: false, code: "UNREACHABLE", reason: `Jupiter did not answer: ${failure instanceof Error ? failure.message : String(failure)}` };
    }
    noteJupiterResponse(response.headers);
    if (response.status !== 429) break;
    const pause = retryAfterMs(response);
    await response.body?.cancel();
    if (attempt > 0) return { ok: false, code: "RATE_LIMITED", reason: "Jupiter rate-limited the token catalogue." };
    await sleep(pause);
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, code: "REFUSED", reason: `Jupiter refused the catalogue: HTTP ${response.status}` };
  }
  let body: unknown;
  try {
    body = JSON.parse(await readBounded(response, ceiling)) as unknown;
  } catch (failure) {
    return { ok: false, code: "MALFORMED", reason: failure instanceof Error ? failure.message : "Jupiter returned unreadable JSON." };
  }
  if (!Array.isArray(body)) {
    /* The tag endpoint answers `{status: 400, message}` with HTTP 200 for a tag
       it does not know — a 200 that is a refusal, so it is read as one. */
    const message = body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
      ? (body as { message: string }).message
      : "Jupiter Tokens did not return an array.";
    return { ok: false, code: "MALFORMED", reason: message };
  }
  if (body.length > MAX_ROWS) return { ok: false, code: "MALFORMED", reason: `Jupiter Tokens exceeded the ${MAX_ROWS}-row ceiling.` };
  const rows: SpotMarket[] = [];
  for (const raw of body) {
    const market = normalizeSpotMarket(raw);
    if (market) rows.push(market);
  }
  return { ok: true, rows };
}

/* ------------------------------------------------------------- the caches */

const caches = new Map<string, Cached<SpotMarket[]>>();
/* One upstream read per key at a time, cold or stale: every concurrent
   request for the same list waits on the same download. Before this the
   dedupe covered only a stale refresh — a cold instance answering two list
   requests in the same second downloaded the 5 MB universe twice and asked
   the provider eight questions where four would do. */
const inflight = new Map<string, Promise<{ ok: true; rows: SpotMarket[] } | SpotSourceFailure>>();

/**
 * Read through a cache: fresh → return; stale within grace → return and
 * refresh in the background; older or absent → read now, sharing one read
 * with everyone else asking for the same key.
 */
async function cachedRows(
  key: string,
  ttlMs: number,
  read: () => Promise<{ ok: true; rows: SpotMarket[] } | SpotSourceFailure>,
): Promise<{ ok: true; rows: SpotMarket[]; readAt: number; stale: boolean } | SpotSourceFailure> {
  const now = Date.now();
  const hit = caches.get(key);
  if (hit && now - hit.readAt < ttlMs) return { ok: true, rows: hit.value, readAt: hit.readAt, stale: false };
  const refresh = () => {
    const pending = inflight.get(key);
    if (pending) return pending;
    const run = read()
      .then((result) => {
        if (result.ok) caches.set(key, { value: result.rows, readAt: Date.now() });
        return result;
      })
      .catch((failure: unknown): SpotSourceFailure => ({
        ok: false,
        code: "UNREACHABLE",
        reason: `The catalogue read failed: ${failure instanceof Error ? failure.message : String(failure)}`,
      }))
      .finally(() => {
        if (inflight.get(key) === run) inflight.delete(key);
      });
    inflight.set(key, run);
    return run;
  };
  if (hit && now - hit.readAt < STALE_GRACE_MS) {
    /* A refresh is background work: it waits while the provider's window is
       nearly spent, and the last good read is served, stated stale, so a
       person's own quote is not the request the window refuses. */
    if (jupiterBackgroundAllowed(now)) void refresh();
    return { ok: true, rows: hit.value, readAt: hit.readAt, stale: true };
  }
  const result = await refresh();
  if (!result.ok) return result;
  const fresh = caches.get(key);
  return { ok: true, rows: result.rows, readAt: fresh?.readAt ?? Date.now(), stale: false };
}

function readUniverse() {
  return cachedRows("universe:verified", UNIVERSE_TTL_MS, () => getRows("/tag?query=verified", UNIVERSE_CEILING_BYTES, 20_000));
}

function readRanked(category: "toptraded" | "toporganicscore" | "toptrending") {
  return cachedRows(`ranked:${category}`, RANKED_TTL_MS, () => getRows(`/${category}/24h?limit=100`, LIST_CEILING_BYTES, 8_000));
}

export type SpotMarketsRead = Readonly<{
  ok: true;
  rows: readonly SpotMarketListRow[];
  observedAt: string;
  stale: boolean;
  /**
   * True when the verified universe did not answer and only the ranked
   * lists did: `All` is still the day's traffic, but a category view may be
   * missing most of its rows, which the page must say rather than print
   * *No markets in this category*.
   */
  partial: boolean;
  source: Readonly<{ label: string; tier: JupiterTier }>;
}>;

/**
 * The market list for one view.
 *
 * `all` is the day's traffic first — the three ranked lists, which is where the
 * unverified tokens people are actually trading appear, labelled as unverified
 * — with the verified universe behind it. A category is the universe filtered
 * by tag, with the ranked rows merged in so a trending meme is not missing
 * from `Memes` for being newer than the ten-minute universe read.
 */
export async function listSpotMarkets(view: Exclude<SpotView, "watchlist">, limit: number): Promise<SpotMarketsRead | SpotSourceFailure> {
  /* A tokenized stock is a stock by the issuer's tag on the verified list;
     the organic-score and trending lists are where memes surface and add no
     stock the universe lacks, so the stock view asks only for the traded
     list — the minute-fresh prices of the most traded stocks — over the
     ten-minute universe: two reads instead of four (measured 2026-09-15,
     when the stock universe build and the Spot list together spent the
     provider's window). */
  const rankedReads = view === "stock"
    ? await Promise.all([readRanked("toptraded")])
    : await Promise.all([readRanked("toptraded"), readRanked("toporganicscore"), readRanked("toptrending")]);
  const universe = await readUniverse();
  const ranked = rankedReads.filter((read): read is Extract<typeof read, { ok: true }> => read.ok);
  if (ranked.length === 0 && !universe.ok) return universe;
  const pool: SpotMarket[] = [];
  for (const read of ranked) pool.push(...read.rows);
  if (universe.ok) pool.push(...universe.rows);
  const endpoint = resolveJupiterCatalogEndpoint();
  const reads = [...ranked, ...(universe.ok ? [universe] : [])];
  return {
    ok: true,
    rows: rankMarkets(pool, view, limit),
    observedAt: new Date(Math.max(...reads.map((read) => read.readAt))).toISOString(),
    stale: reads.some((read) => read.stale) || !universe.ok || ranked.length < rankedReads.length,
    partial: !universe.ok,
    source: { label: `Jupiter Tokens API, ${endpoint.tier} tier`, tier: endpoint.tier },
  };
}

export async function searchSpotMarkets(query: string, limit: number): Promise<SpotMarketsRead | SpotSourceFailure> {
  const trimmed = query.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return { ok: false, code: "MALFORMED", reason: "A search needs one to sixty-four characters." };
  const read = await getRows(`/search?query=${encodeURIComponent(trimmed)}`, LIST_CEILING_BYTES, 8_000);
  if (!read.ok) return read;
  const endpoint = resolveJupiterCatalogEndpoint();
  return {
    ok: true,
    rows: rankSearch(read.rows, trimmed, limit),
    observedAt: new Date().toISOString(),
    stale: false,
    partial: false,
    source: { label: `Jupiter Tokens API, ${endpoint.tier} tier`, tier: endpoint.tier },
  };
}

/**
 * Up to a hundred mints in one read — the watchlist, and the wallet's own
 * holdings, both of which are a list of addresses rather than a query. Order
 * of the input is kept; a mint the provider does not know is absent, which the
 * caller reports as *not in the catalogue* rather than inventing a row.
 */
export async function readSpotMarketsByMint(mints: readonly string[], timeoutMs = 8_000): Promise<{ ok: true; byMint: ReadonlyMap<string, SpotMarket>; observedAt: string } | SpotSourceFailure> {
  const unique = [...new Set(mints)].slice(0, 100);
  if (unique.length === 0) return { ok: true, byMint: new Map(), observedAt: new Date().toISOString() };
  const read = await getRows(`/search?query=${encodeURIComponent(unique.join(","))}`, LIST_CEILING_BYTES, timeoutMs);
  if (!read.ok) return read;
  const byMint = new Map<string, SpotMarket>();
  for (const market of read.rows) if (unique.includes(market.mint) && !byMint.has(market.mint)) byMint.set(market.mint, market);
  return { ok: true, byMint, observedAt: new Date().toISOString() };
}

const details = new Map<string, { value: SpotMarket; readAt: number }>();

/**
 * One market, fresh to fifteen seconds. `/search` by mint is what the provider
 * caches shortest (ten seconds), so this is as live as its price gets without
 * a stream; the header polls it.
 */
export async function readSpotMarket(mint: string): Promise<{ ok: true; market: SpotMarket; observedAt: string; stale: boolean } | { ok: true; market: null; observedAt: string; stale: false } | SpotSourceFailure> {
  const hit = details.get(mint);
  const now = Date.now();
  if (hit && now - hit.readAt < DETAIL_TTL_MS) return { ok: true, market: hit.value, observedAt: new Date(hit.readAt).toISOString(), stale: false };
  /* The header polls every fifteen seconds; while the provider's window is
     nearly spent, a two-minute-old detail is served and named stale rather
     than spending what a person's Review may need. */
  if (hit && now - hit.readAt < DETAIL_LOW_BUDGET_MS && !jupiterBackgroundAllowed(now)) {
    return { ok: true, market: hit.value, observedAt: new Date(hit.readAt).toISOString(), stale: true };
  }
  const read = await getRows(`/search?query=${encodeURIComponent(mint)}`, LIST_CEILING_BYTES, 8_000);
  if (!read.ok) {
    if (hit && now - hit.readAt < STALE_GRACE_MS) return { ok: true, market: hit.value, observedAt: new Date(hit.readAt).toISOString(), stale: true };
    return read;
  }
  const market = read.rows.find((row) => row.mint === mint) ?? null;
  if (!market) return { ok: true, market: null, observedAt: new Date().toISOString(), stale: false };
  details.set(mint, { value: market, readAt: Date.now() });
  return { ok: true, market, observedAt: new Date().toISOString(), stale: false };
}

/**
 * The icon the catalogue names for a mint, from what is already in memory
 * first — the universe, the ranked lists, the detail reads — and by one
 * search only when nothing here has seen the mint. The icon route calls this
 * once per mint per hour, and a market list of 150 rows must not become 150
 * searches against a 0.5-request-per-second keyless budget.
 */
export async function lookupSpotIcon(mint: string): Promise<string | null> {
  const detail = details.get(mint);
  if (detail) return detail.value.icon;
  for (const cached of caches.values()) {
    const found = cached.value.find((market) => market.mint === mint);
    if (found) return found.icon;
  }
  const read = await readSpotMarket(mint);
  return read.ok && read.market ? read.market.icon : null;
}

/** Test seam: forget every cached read. */
export function resetSpotMarketCaches(): void {
  caches.clear();
  inflight.clear();
  details.clear();
}
