/**
 * Spot markets — the reads behind `/api/spot/markets` and `/api/spot/market`.
 *
 * Jupiter Tokens V2 is the one source. Three ranked lists (`toptraded`,
 * `toporganicscore`, `toptrending`, each capped at 100 by the provider) give
 * the day's traffic; the `verified` universe (3,346 rows, 4.9 MB, brotli on the
 * wire) gives every tagged stock, meme and major so a category view is
 * complete rather than whatever happened to trend today. The universe is
 * cached for four minutes per instance and refreshed in the background; the
 * ranked lists for one minute. A list is `stale` only when the oldest read
 * behind the rows it shows is older than five minutes, or when one of them is
 * the held copy of a read whose refresh failed — and then it names that read's
 * time as `lastGoodAt`. A read past
 * its minute that is being refreshed behind the answer is not stale.
 *
 * The live `tag` endpoint accepts only `lst` and `verified` on 2026-09-11 —
 * `stocks`, documented, answers *Invalid tag provided* — which is why the
 * categories are derived from each row's own tags rather than asked for.
 *
 * Search is passed straight to `/search`, which handles symbol, name and mint
 * itself and answers within a second keyless.
 */

import { after } from "next/server.js";

import { jupiterBackgroundAllowed, noteJupiterResponse } from "../solana/jupiter-budget.ts";
import { resolveJupiterCatalogEndpoint, type JupiterTier } from "../solana/quotes.ts";
import { isUnsupportedMarket, normalizeSpotMarket, rankMarkets, rankSearch, type SpotMarket, type SpotMarketListRow, type SpotView } from "./markets.ts";
import { coinScreenerRow, rankScreenerCoins, type ScreenerRow } from "../markets/screener.ts";
import { tokenFactsOf, type TokenFacts } from "./token-page.ts";

const LITE_BASE = "https://lite-api.jup.ag/tokens/v2";
const PRO_BASE = "https://api.jup.ag/tokens/v2";

/* Four minutes, not ten: the universe carries the prices of every category
   row the ranked lists do not, and a list is stale past five minutes. */
const UNIVERSE_TTL_MS = 4 * 60_000;
const RANKED_TTL_MS = 60_000;
/**
 * A market list is stale only past this: the oldest read behind the rows it
 * shows is older than five minutes (SOL-D1). Measured on 2026-10-19: the coin
 * list said `stale: true` while its prices moved from read to read, because
 * every read past its minute was called stale while its refresh ran.
 */
export const SPOT_LIST_STALE_AFTER_MS = 5 * 60_000;
/**
 * A refresh whose failure lands this long after it started outlived a frozen
 * function — its timer fired on the thaw — and says nothing about the
 * provider, so the held copy is not marked as kept after a failure. The
 * longest honest attempt is the universe's: 20 s, a paced pause of at most
 * 3.6 s, and 20 s again.
 */
const REFRESH_FROZEN_AFTER_MS = 50_000;
/** After a failed refresh the held copy is served this long before the provider is asked again: a down source is not asked on every request. */
const REFRESH_COOLDOWN_MS = 15_000;
/** A read already past five minutes is waited for this long before the held copy is served stale — an idle instance's first answer. */
const OLD_READ_WAIT_MS = 4_000;
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
  /** A detail read keeps the token page's facts of the same rows (`tokenFactsOf`), so the page asks Jupiter once. */
  keepFacts = false,
): Promise<{ ok: true; rows: SpotMarket[] } | SpotSourceFailure> {
  const read = await getRawRows(path, ceiling, timeoutMs);
  if (!read.ok) return read;
  const rows: SpotMarket[] = [];
  for (const raw of read.raw) {
    const market = normalizeSpotMarket(raw);
    if (market) rows.push(market);
    if (market && keepFacts) {
      const facts = tokenFactsOf(raw);
      if (facts) tokenFacts.set(facts.mint, { value: facts, readAt: Date.now() });
    }
  }
  return { ok: true, rows };
}

/** One Tokens V2 list as Jupiter answered it — the rows not yet read into any shape. */
async function getRawRows(path: string, ceiling: number, timeoutMs: number): Promise<{ ok: true; raw: readonly unknown[] } | SpotSourceFailure> {
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
  return { ok: true, raw: body };
}

const rawCaches = new Map<string, Cached<readonly unknown[]>>();
/** The most lists the raw cache keeps. */
const RAW_KEYS = 48;
const rawInflight = new Map<string, Promise<{ ok: true; raw: readonly unknown[] } | SpotSourceFailure>>();

/**
 * A Tokens V2 list as Jupiter answered it, for a reader that needs more of a
 * row than the market shape keeps (Pulse: the launchpad, the four windows,
 * the day a token left its curve). The same rule as every list here: fresh →
 * as it is; stale within the grace → as it is, stated stale, and read again
 * behind it while the provider's window allows; older → read now, one read
 * shared by everyone asking.
 */
export async function readJupiterList(path: string, ttlMs: number, graceMs = STALE_GRACE_MS): Promise<{ ok: true; raw: readonly unknown[]; readAt: number; stale: boolean } | SpotSourceFailure> {
  const now = Date.now();
  const hit = rawCaches.get(path);
  if (hit && now - hit.readAt < ttlMs) return { ok: true, raw: hit.value, readAt: hit.readAt, stale: false };
  const refresh = () => {
    const pending = rawInflight.get(path);
    if (pending) return pending;
    const run = getRawRows(path, LIST_CEILING_BYTES, 8_000)
      .then((result) => {
        if (result.ok) {
          /* The newest read last; the oldest key goes once the cache holds its ceiling — searches by mint make a new key often. */
          rawCaches.delete(path);
          rawCaches.set(path, { value: result.raw, readAt: Date.now() });
          while (rawCaches.size > RAW_KEYS) rawCaches.delete(rawCaches.keys().next().value as string);
        }
        return result;
      })
      .catch((failure: unknown): SpotSourceFailure => ({ ok: false, code: "UNREACHABLE", reason: `The catalogue read failed: ${failure instanceof Error ? failure.message : String(failure)}` }))
      .finally(() => {
        if (rawInflight.get(path) === run) rawInflight.delete(path);
      });
    rawInflight.set(path, run);
    return run;
  };
  if (hit && now - hit.readAt < graceMs) {
    if (jupiterBackgroundAllowed(now)) void refresh();
    return { ok: true, raw: hit.value, readAt: hit.readAt, stale: true };
  }
  const result = await refresh();
  if (!result.ok) {
    /* The read failed: the held copy, within the catalogue's own grace, with its own time. */
    if (hit && now - hit.readAt < STALE_GRACE_MS) return { ok: true, raw: hit.value, readAt: hit.readAt, stale: true };
    return result;
  }
  return { ok: true, raw: result.raw, readAt: rawCaches.get(path)?.readAt ?? Date.now(), stale: false };
}

/* ------------------------------------------------------------- the caches */

/* `failedAt`: the last refresh of this read failed after it was taken, so
   until one succeeds the copy is served as held after a failure. */
const caches = new Map<string, Cached<SpotMarket[]> & { failedAt: number | null }>();
/* One upstream read per key at a time, cold or stale: every concurrent
   request for the same list waits on the same download. Before this the
   dedupe covered only a stale refresh — a cold instance answering two list
   requests in the same second downloaded the 5 MB universe twice and asked
   the provider eight questions where four would do. */
const inflight = new Map<string, Promise<{ ok: true; rows: SpotMarket[] } | SpotSourceFailure>>();
/** When each running read was asked: a caller waits for an old read only within the first seconds of its refresh. */
const inflightStartedAt = new Map<string, number>();

/** One list read as served: its rows, when they were read, and whether this is the copy held after a failed refresh. */
type ListRead = Readonly<{ ok: true; rows: SpotMarket[]; readAt: number; fromReserve: boolean }>;

/**
 * Read through a cache: fresh → return; past its TTL within grace → return
 * and refresh in the background; older or absent → read now, sharing one read
 * with everyone else asking for the same key. Whether the answer is stale is
 * the list's to judge (`listFreshness`), not the cache's: a read past its TTL
 * whose refresh is running is not stale.
 */
async function cachedRows(
  key: string,
  ttlMs: number,
  read: () => Promise<{ ok: true; rows: SpotMarket[] } | SpotSourceFailure>,
): Promise<ListRead | SpotSourceFailure> {
  const now = Date.now();
  const hit = caches.get(key);
  if (hit && now - hit.readAt < ttlMs) return { ok: true, rows: hit.value, readAt: hit.readAt, fromReserve: hit.failedAt !== null };
  const refresh = () => {
    const pending = inflight.get(key);
    if (pending) {
      /* Joining a read keeps this request's function alive for it too. */
      keepAlive(pending);
      return pending;
    }
    const startedAt = Date.now();
    /* A read is dated when it was asked: a download that slept with the function is not younger for it. */
    const run = read()
      .catch((failure: unknown): SpotSourceFailure => ({
        ok: false,
        code: "UNREACHABLE",
        reason: `The catalogue read failed: ${failure instanceof Error ? failure.message : String(failure)}`,
      }))
      .then((result) => {
        if (result.ok) {
          caches.set(key, { value: result.rows, readAt: startedAt, failedAt: null });
        } else {
          const held = caches.get(key);
          const frozen = Date.now() - startedAt > REFRESH_FROZEN_AFTER_MS;
          if (held && !frozen) held.failedAt = Date.now();
          console.warn(`spot markets: the ${key} read failed (${result.code}${frozen ? ", after a frozen function" : ""}): ${result.reason}${held ? "; the held copy is served" : ""}`);
        }
        return result;
      })
      .finally(() => {
        if (inflight.get(key) === run) {
          inflight.delete(key);
          inflightStartedAt.delete(key);
        }
      });
    inflight.set(key, run);
    inflightStartedAt.set(key, startedAt);
    keepAlive(run);
    return run;
  };
  if (hit && now - hit.readAt < STALE_GRACE_MS) {
    /* A refresh is background work: it waits while the provider's window is
       nearly spent, and for a while after a failed one, and the last good
       read is served meanwhile, so a person's own quote is not the request
       the window refuses. */
    const coolingDown = hit.failedAt !== null && now - hit.failedAt < REFRESH_COOLDOWN_MS;
    if (jupiterBackgroundAllowed(now) && !coolingDown) {
      const pending = refresh();
      /* A read already past five minutes would make the answer stale: it is
         waited for briefly — within the first seconds of its refresh only, so
         a slow source costs each caller nothing once that window is gone. */
      const wait = OLD_READ_WAIT_MS - (Date.now() - (inflightStartedAt.get(key) ?? 0));
      if (now - hit.readAt > SPOT_LIST_STALE_AFTER_MS && wait > 0) await settledWithin(pending, wait);
    }
    const held = caches.get(key) ?? hit;
    return { ok: true, rows: held.value, readAt: held.readAt, fromReserve: held.failedAt !== null };
  }
  const result = await refresh();
  if (!result.ok) return result;
  const fresh = caches.get(key);
  return { ok: true, rows: result.rows, readAt: fresh?.readAt ?? Date.now(), fromReserve: false };
}

/**
 * Keep the function alive until a refresh lands, wherever it was started — a
 * route, a page, a stock universe build. A refresh left behind an answer
 * froze with the function, timed out on the thaw, and its list stayed past
 * its TTL until the hour's grace ran out. Outside a request (a test, a
 * cache's own revalidation) there is nothing to keep alive.
 */
function keepAlive(run: Promise<unknown>): void {
  try {
    /* The promise form: it goes to the platform's waitUntil at once. The
       function form waits for the response's close, and one registered
       after the close is never run and holds the invocation to its limit. */
    after(run.then(() => undefined));
  } catch {
    /* not in a request */
  }
}

/** Wait for a promise at most `ms`; the timer is cleared when the promise wins, so it does not outlive it. */
async function settledWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const elapsed = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([promise, elapsed]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The refreshes still running behind the answers already given, if any —
 * each is already kept alive by `after()` where it started (`keepAlive`);
 * this lets a caller or a test wait for them to land.
 */
export function spotListRefreshes(): Promise<void> | null {
  if (inflight.size === 0) return null;
  return Promise.allSettled([...inflight.values()]).then(() => undefined);
}

/**
 * How long the edge may keep a fresh list: its thirty seconds and its
 * revalidation window, both inside what is left of the five minutes after the
 * oldest read behind the rows (SOL-D1: the edge never serves a list as fresh
 * past the moment the server would call it stale). Null when too little is
 * left to keep it at all.
 */
export function spotListEdgeSeconds(oldestReadAt: string, now: number): Readonly<{ ttl: number; revalidate: number }> | null {
  const left = Math.floor((Date.parse(oldestReadAt) + SPOT_LIST_STALE_AFTER_MS - now) / 1000);
  const ttl = Math.min(30, left);
  const revalidate = Math.min(120, left - ttl);
  return ttl >= 1 && revalidate >= 1 ? { ttl, revalidate } : null;
}

/**
 * How fresh a list is, judged by the reads behind the rows it shows — each
 * row by the first read whose copy of it the list's own filter `keeps`, which
 * is the copy shown (`rankMarkets` and `rankScreenerCoins` keep the first
 * such copy of a mint). Stale when the oldest of
 * those reads is older than five minutes or one of them is the copy held
 * after a failed refresh; `lastGoodAt` is then the oldest read's time. A list
 * that shows nothing is judged by every read it made.
 */
export function listFreshness(
  reads: readonly Pick<ListRead, "rows" | "readAt" | "fromReserve">[],
  shownMints: readonly string[],
  now: number,
  keeps: (market: SpotMarket) => boolean = () => true,
): Readonly<{ oldestReadAt: number; stale: boolean }> {
  const shown = new Set(shownMints);
  const origin = new Map<string, (typeof reads)[number]>();
  for (const read of reads) for (const row of read.rows) if (shown.has(row.mint) && !origin.has(row.mint) && keeps(row)) origin.set(row.mint, read);
  const behind = new Set<(typeof reads)[number]>();
  for (const mint of shownMints) {
    const read = origin.get(mint);
    if (read) behind.add(read);
  }
  const judged = behind.size > 0 ? [...behind] : reads;
  const oldestReadAt = Math.min(...judged.map((read) => read.readAt));
  return { oldestReadAt, stale: now - oldestReadAt > SPOT_LIST_STALE_AFTER_MS || judged.some((read) => read.fromReserve) };
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
  /** The oldest read behind the rows shown, present only when `stale` (request 57 (b) of the phone line). */
  lastGoodAt?: string;
  /** The oldest read behind the rows shown, always: the route keeps the list at the edge no longer than it stays fresh. Not on the wire. */
  oldestReadAt: string;
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
 * from `Memes` for being newer than the four-minute universe read.
 */
export async function listSpotMarkets(view: Exclude<SpotView, "watchlist">, limit: number): Promise<SpotMarketsRead | SpotSourceFailure> {
  /* A tokenized stock is a stock by the issuer's tag on the verified list;
     the organic-score and trending lists are where memes surface and add no
     stock the universe lacks, so the stock view asks only for the traded
     list — the minute-fresh prices of the most traded stocks — over the
     four-minute universe: two reads instead of four (measured 2026-09-15,
     when the stock universe build and the Spot list together spent the
     provider's window). */
  /* The universe is asked beside the ranked lists, not after them: an old read's brief wait is spent once per list, not twice. */
  const [rankedReads, universe] = await Promise.all([
    view === "stock"
      ? Promise.all([readRanked("toptraded")])
      : Promise.all([readRanked("toptraded"), readRanked("toporganicscore"), readRanked("toptrending")]),
    readUniverse(),
  ]);
  const ranked = rankedReads.filter((read): read is Extract<typeof read, { ok: true }> => read.ok);
  if (ranked.length === 0 && !universe.ok) return universe;
  const pool: SpotMarket[] = [];
  for (const read of ranked) pool.push(...read.rows);
  if (universe.ok) pool.push(...universe.rows);
  const endpoint = resolveJupiterCatalogEndpoint();
  /* In the pool's order: a row is credited to the first read it was found in. */
  const reads = [...ranked, ...(universe.ok ? [universe] : [])];
  const rows = rankMarkets(pool, view, limit);
  /* A list that did not answer leaves its rows out; it does not age the rows
     shown, so it is not `stale`. The universe's absence is `partial`. */
  const freshness = listFreshness(reads, rows.map((row) => row.mint), Date.now(), (market) => !isUnsupportedMarket(market) && (view === "all" || market.category === view));
  return {
    ok: true,
    rows,
    observedAt: new Date(Math.max(...reads.map((read) => read.readAt))).toISOString(),
    stale: freshness.stale,
    ...(freshness.stale ? { lastGoodAt: new Date(freshness.oldestReadAt).toISOString() } : {}),
    oldestReadAt: new Date(freshness.oldestReadAt).toISOString(),
    partial: !universe.ok,
    source: { label: `Jupiter Tokens API, ${endpoint.tier} tier`, tier: endpoint.tier },
  };
}

/**
 * The coins of «Ринки»: the same three ranked lists and the
 * verified universe Spot reads — the same caches, no read of its own — with
 * the figures Spot's compact list drops (the hour's change, market cap, the
 * first pool's age, the organic score and the audit), the most traded of
 * each kind.
 */
export async function listScreenerCoins(limit: Readonly<{ meme: number; crypto: number }>): Promise<Readonly<{ ok: true; rows: readonly ScreenerRow[]; observedAt: string; stale: boolean; lastGoodAt?: string }> | SpotSourceFailure> {
  const [rankedReads, universe] = await Promise.all([Promise.all([readRanked("toptraded"), readRanked("toporganicscore"), readRanked("toptrending")]), readUniverse()]);
  const ranked = rankedReads.filter((read): read is Extract<typeof read, { ok: true }> => read.ok);
  if (ranked.length === 0 && !universe.ok) return universe;
  const pool: SpotMarket[] = [];
  for (const read of ranked) pool.push(...read.rows);
  if (universe.ok) pool.push(...universe.rows);
  const reads = [...ranked, ...(universe.ok ? [universe] : [])];
  const now = Date.now();
  const rows = rankScreenerCoins(pool, limit, now);
  /* The same rule as the Spot list (`listFreshness`). */
  const freshness = listFreshness(reads, rows.map((row) => row.mint), now, (market) => {
    const kind = coinScreenerRow(market, now)?.kind;
    return kind === "meme" || kind === "crypto";
  });
  return {
    ok: true,
    rows,
    observedAt: new Date(Math.max(...reads.map((read) => read.readAt))).toISOString(),
    stale: freshness.stale,
    ...(freshness.stale ? { lastGoodAt: new Date(freshness.oldestReadAt).toISOString() } : {}),
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
    oldestReadAt: new Date().toISOString(),
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
/* The token page's facts of the rows a detail read answered — the same read, kept beside the market. */
const tokenFacts = new Map<string, { value: TokenFacts; readAt: number }>();

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
  const read = await getRows(`/search?query=${encodeURIComponent(mint)}`, LIST_CEILING_BYTES, 8_000, true);
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

/**
 * The token page's facts of one mint (`token-page.ts`): the market's own
 * detail read, then the facts it kept. Null with the market when Jupiter does
 * not list the mint; the market without facts only when the row carried none.
 */
export async function readSpotTokenFacts(mint: string): Promise<{ ok: true; market: SpotMarket | null; facts: TokenFacts | null; observedAt: string; stale: boolean } | SpotSourceFailure> {
  const read = await readSpotMarket(mint);
  if (!read.ok) return read;
  if (!read.market) return { ok: true, market: null, facts: null, observedAt: read.observedAt, stale: false };
  return { ok: true, market: read.market, facts: tokenFacts.get(mint)?.value ?? null, observedAt: read.observedAt, stale: read.stale };
}

/**
 * Up to a hundred mints with the token page's facts of each (creator, creation) — one search, as
 * `readSpotMarketsByMint`; «Стеження за гаманцями» (SOL-R4) labels a wallet's trades by them.
 */
export async function readSpotFactsByMint(mints: readonly string[], timeoutMs = 8_000): Promise<{ ok: true; byMint: ReadonlyMap<string, SpotMarket>; facts: ReadonlyMap<string, TokenFacts>; observedAt: string } | SpotSourceFailure> {
  const unique = [...new Set(mints)].slice(0, 100);
  if (unique.length === 0) return { ok: true, byMint: new Map(), facts: new Map(), observedAt: new Date().toISOString() };
  const read = await getRows(`/search?query=${encodeURIComponent(unique.join(","))}`, LIST_CEILING_BYTES, timeoutMs, true);
  if (!read.ok) return read;
  const byMint = new Map<string, SpotMarket>();
  const facts = new Map<string, TokenFacts>();
  for (const market of read.rows) {
    if (!unique.includes(market.mint) || byMint.has(market.mint)) continue;
    byMint.set(market.mint, market);
    const kept = tokenFacts.get(market.mint)?.value;
    if (kept) facts.set(market.mint, kept);
  }
  return { ok: true, byMint, facts, observedAt: new Date().toISOString() };
}

/** Test seam: forget every cached read. */
export function resetSpotMarketCaches(): void {
  caches.clear();
  inflight.clear();
  inflightStartedAt.clear();
  details.clear();
  tokenFacts.clear();
  rawCaches.clear();
  rawInflight.clear();
}
