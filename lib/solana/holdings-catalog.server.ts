/**
 * Names and prices for the coins a wallet holds — the catalogue half of
 * `POST /api/solana/holdings`, made to survive the provider saying no.
 *
 * Why this exists (2026-11-05): the Portfolio window on ryntra.io showed USDC
 * as `EPjF…Dt1v · Not verified`, every price as «—» and the total as «—».
 * The route itself answered; what failed was Jupiter. Production logs that
 * day carry `MARKETS_RATE_LIMITED: Jupiter rate-limited the token catalogue`
 * on the swap routes, and the Spot pulse polls the same keyed budget a
 * thousand times a day. The holdings route asked the catalogue live on every
 * read, with a one-second bound, no memory and no second host, and caught the
 * refusal silently — so a spent minute of budget turned every row of a
 * person's money into a bare address.
 *
 * The answer, in the order it is tried for each mint:
 *  1. a fresh read (the keyed host; when it refuses, the keyless one, which
 *     has its own budget);
 *  2. what this instance already holds — the last good read of this route,
 *     and the Spot lists and details in memory (`cachedSpotMarkets`);
 *  3. for the handful of canonical mints, their known name — never a price.
 * A price older than `PRICE_STALE_MS` is not served: an old number is worse
 * than «—» in a total. A name lasts a day.
 */

import { fetchTokenCatalog, nativeSolPriceMint, type TokenCatalogEntry, type TokenCatalogResult } from "./catalog.ts";
import { cachedSpotMarkets, readSpotMarketsByMint } from "../spot/markets.server.ts";
import type { SpotMarket } from "../spot/markets.ts";

/** A read this young is used as it is and not asked again. */
export const PRICE_FRESH_MS = 60_000;
/** Past this, a held price is dropped rather than added to anyone's total. */
export const PRICE_STALE_MS = 15 * 60_000;
/** A held name, symbol and icon are good for a day. */
export const IDENTITY_TTL_MS = 24 * 60 * 60_000;
const MEMORY_CAP = 5_000;

/**
 * The canonical mints whose names are not in doubt — identity only. They are
 * the coins a person most often holds, so a refused catalogue must never
 * reduce them to an address. No price lives here: a price comes from a read.
 */
export const KNOWN_MINTS: Readonly<Record<string, Readonly<{ symbol: string; name: string }>>> = {
  So11111111111111111111111111111111111111112: { symbol: "SOL", name: "Wrapped SOL" },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", name: "USD Coin" },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", name: "USDT" },
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": { symbol: "PYUSD", name: "PayPal USD" },
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: { symbol: "JitoSOL", name: "Jito Staked SOL" },
  jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v: { symbol: "JupSOL", name: "Jupiter Staked SOL" },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: "mSOL", name: "Marinade staked SOL" },
  "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm": { symbol: "INF", name: "Infinity" },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: "JUP", name: "Jupiter" },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: "Bonk", name: "Bonk" },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: { symbol: "WIF", name: "dogwifhat" },
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: { symbol: "JTO", name: "Jito" },
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: { symbol: "PYTH", name: "Pyth Network" },
};

const KNOWN_SOURCE = { ref: "ryntra:known-mints", label: "Ryntra, canonical mints (name only)" } as const;

type Held = { entry: TokenCatalogEntry; identityAt: number; priceAt: number | null };
const memory = new Map<string, Held>();

/** Test seam: forget every held read. */
export function resetHoldingsCatalogMemory(): void {
  memory.clear();
}

function remember(entry: TokenCatalogEntry, at: number): void {
  const held = memory.get(entry.mint);
  const priced = entry.usdPrice !== null && Number(entry.usdPrice) > 0;
  memory.delete(entry.mint);
  memory.set(entry.mint, {
    entry: priced || !held ? entry : { ...entry, usdPrice: held.entry.usdPrice, dayChangePct: entry.dayChangePct ?? held.entry.dayChangePct },
    identityAt: at,
    priceAt: priced ? at : (held?.priceAt ?? null),
  });
  while (memory.size > MEMORY_CAP) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

function entryOfMarket(market: SpotMarket, ref: string, label: string): TokenCatalogEntry {
  return {
    mint: market.mint,
    symbol: market.symbol || null,
    name: market.name || null,
    isVerified: market.verified,
    isSuspicious: market.audit.suspicious,
    usdPrice: market.price !== null && market.price > 0 ? String(market.price) : null,
    source: { ref, label },
    icon: market.icon,
    category: market.category,
    dayChangePct: market.change24hPct,
  };
}

/** Joins two reads of one mint: the first one's facts win, the second fills what the first lacks. */
function merge(first: TokenCatalogEntry, second: TokenCatalogEntry | undefined): TokenCatalogEntry {
  if (!second) return first;
  return {
    ...first,
    symbol: first.symbol ?? second.symbol,
    name: first.name ?? second.name,
    isVerified: first.isVerified ?? second.isVerified,
    usdPrice: first.usdPrice ?? second.usdPrice,
    icon: first.icon ?? second.icon ?? null,
    category: first.category ?? second.category ?? null,
    dayChangePct: first.dayChangePct ?? second.dayChangePct ?? null,
  };
}

export type HoldingsCatalog = Readonly<{
  byMint: Readonly<Record<string, TokenCatalogEntry>>;
  /** The keyed (or keyless) price read's own answer, as the route reports it. */
  catalog: TokenCatalogResult;
  /** Mints named or priced from memory or the known list because the live read did not answer for them. */
  fromMemory: number;
  /** How the live reads went, for the route's timing header. */
  liveMs: number;
}>;

export type HoldingsCatalogDeps = Readonly<{
  now?: () => number;
  fetchCatalog?: typeof fetchTokenCatalog;
  readWide?: typeof readSpotMarketsByMint;
  cachedMarkets?: typeof cachedSpotMarkets;
  /** The most the live reads may take before memory answers instead; they finish behind the answer and warm it for the next read. */
  budgetMs?: number;
}>;

/** What the route can spare for the catalogue inside its own deadline. */
export const CATALOG_BUDGET_MS = 2_600;

const WIDE_CAP = 300;
const WIDE_BATCH = 100;
const PRICE_CAP = 50;

/**
 * Names and prices for `priced` (read with the price feed first: SOL and the
 * coins most likely to carry value) and `all` (everything held, named by the
 * catalogue search). Never throws; a mint nobody can name stays absent and
 * the row says so.
 */
export async function readHoldingsCatalog(
  priced: readonly string[],
  all: readonly string[],
  signal: AbortSignal | undefined,
  deps: HoldingsCatalogDeps = {},
): Promise<HoldingsCatalog> {
  const now = deps.now ?? Date.now;
  const fetchCatalog = deps.fetchCatalog ?? fetchTokenCatalog;
  const readWide = deps.readWide ?? readSpotMarketsByMint;
  const cachedMarkets = deps.cachedMarkets ?? cachedSpotMarkets;
  const started = now();
  const sol = nativeSolPriceMint();
  const pricedMints = [...new Set([sol, ...priced])].slice(0, PRICE_CAP);
  const wideMints = [...new Set([sol, ...all])].slice(0, WIDE_CAP);

  /* What is fresh enough is not asked for again. */
  const fresh = (mint: string) => {
    const held = memory.get(mint);
    return Boolean(held && held.priceAt !== null && started - held.priceAt < PRICE_FRESH_MS && started - held.identityAt < PRICE_FRESH_MS);
  };
  const pricedToRead = pricedMints.filter((mint) => !fresh(mint));
  const wideToRead = wideMints.filter((mint) => !fresh(mint));

  const readPriced = async (): Promise<TokenCatalogResult> => {
    if (pricedToRead.length === 0) return { ok: true, byMint: {}, missing: [], observedAt: new Date(started).toISOString() };
    const first = await fetchCatalog(pricedToRead, 1_800, signal);
    if (first.ok || signal?.aborted || first.code !== "RATE_LIMITED") return first;
    /* The keyed budget is spent: the keyless host has a budget of its own. A 429 answers in milliseconds, so there is time. */
    const second = await fetchCatalog(pricedToRead, 1_800, signal, "lite");
    return second.ok ? second : first;
  };
  const readWideBatch = async (batch: readonly string[]): Promise<Record<string, TokenCatalogEntry>> => {
    try {
      const read = await readWide(batch, 2_500);
      if (!read.ok) return {};
      const out: Record<string, TokenCatalogEntry> = {};
      for (const [mint, market] of read.byMint) out[mint] = entryOfMarket(market, `jupiter:mainnet:tokens:search:${batch.length}`, "Jupiter Tokens API, search by mint");
      return out;
    } catch {
      return {};
    }
  };
  const batches = Array.from({ length: Math.ceil(wideToRead.length / WIDE_BATCH) }, (_, index) => wideToRead.slice(index * WIDE_BATCH, (index + 1) * WIDE_BATCH));
  /* Every live answer is remembered when it lands, even one that lands after the budget. */
  const pricedRead = readPriced()
    .catch((failure: unknown): TokenCatalogResult => ({ ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) }));
  const wideRead = Promise.all(batches.map(readWideBatch));
  void Promise.all([pricedRead, wideRead]).then(([lateCatalog, lateWide]) => {
    const at = now();
    for (const part of lateWide) for (const entry of Object.values(part)) remember(entry, at);
    if (lateCatalog.ok) for (const entry of Object.values(lateCatalog.byMint)) remember(merge(entry, memory.get(entry.mint)?.entry), at);
  });
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const outOfTime = new Promise<"BUDGET">((resolve) => { budgetTimer = setTimeout(() => resolve("BUDGET"), deps.budgetMs ?? CATALOG_BUDGET_MS); });
  const raced = await Promise.race([Promise.all([pricedRead, wideRead]), outOfTime]);
  clearTimeout(budgetTimer);
  const [catalog, wide]: [TokenCatalogResult, Record<string, TokenCatalogEntry>[]] = raced === "BUDGET"
    ? [{ ok: false, code: "UNREACHABLE", reason: "The catalogue did not answer inside the read's budget." }, []]
    : raced;
  const readAt = now();
  const liveMs = readAt - started;

  /* Live answers first: the price feed's figure, the search's icon, category and day. */
  const live: Record<string, TokenCatalogEntry> = Object.assign({}, ...wide);
  if (catalog.ok) {
    for (const [mint, entry] of Object.entries(catalog.byMint)) {
      const wideEntry = live[mint];
      live[mint] = wideEntry
        ? { ...entry, icon: wideEntry.icon ?? null, category: wideEntry.category ?? null, dayChangePct: wideEntry.dayChangePct ?? null, usdPrice: entry.usdPrice ?? wideEntry.usdPrice, symbol: entry.symbol ?? wideEntry.symbol, name: entry.name ?? wideEntry.name, isVerified: entry.isVerified ?? wideEntry.isVerified }
        : entry;
    }
  }
  for (const entry of Object.values(live)) remember(entry, readAt);

  /* Then memory, for every mint the live reads did not price or name. */
  const byMint: Record<string, TokenCatalogEntry> = {};
  let fromMemory = 0;
  const named = [...new Set([...wideMints, ...pricedMints])];
  const lacking = named.filter((mint) => !live[mint] || live[mint].usdPrice === null || !live[mint].symbol);
  const markets = lacking.length ? cachedMarkets(lacking) : new Map<string, { market: SpotMarket; readAt: number }>();
  for (const mint of named) {
    let entry = live[mint];
    const fromLive = Boolean(entry && entry.usdPrice !== null && entry.symbol);
    if (!fromLive) {
      const held = memory.get(mint);
      const heldEntry = held && readAt - held.identityAt < IDENTITY_TTL_MS
        ? { ...held.entry, usdPrice: held.priceAt !== null && readAt - held.priceAt < PRICE_STALE_MS ? held.entry.usdPrice : null }
        : undefined;
      const market = markets.get(mint);
      const marketEntry = market
        ? { ...entryOfMarket(market.market, "jupiter:mainnet:tokens:held", "Jupiter Tokens API, read earlier by Ryntra"), usdPrice: readAt - market.readAt < PRICE_STALE_MS && market.market.price !== null && market.market.price > 0 ? String(market.market.price) : null }
        : undefined;
      const known = KNOWN_MINTS[mint];
      const knownEntry: TokenCatalogEntry | undefined = known
        ? { mint, symbol: known.symbol, name: known.name, isVerified: true, isSuspicious: false, usdPrice: null, source: KNOWN_SOURCE }
        : undefined;
      const before = entry;
      for (const next of [heldEntry, marketEntry, knownEntry]) {
        if (!next) continue;
        entry = entry ? merge(entry, next) : next;
      }
      if (entry && entry !== before) fromMemory += 1;
    }
    if (entry) byMint[mint] = entry;
  }
  return { byMint, catalog, fromMemory, liveMs };
}
