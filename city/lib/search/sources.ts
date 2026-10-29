import { shownText } from '../../../lib/world/text-safety/clean.ts';
import { lookalikeOf } from '../../../lib/world/text-safety/lookalike.ts';
import { API_HEADERS } from '../launch/engine.ts';
import { sameOriginImage } from '../launch/towers.ts';
import { isMint } from './mint.ts';
import { spotIcon, type CatalogRow, type IndexCoin } from './rank.ts';

/**
 * What the search and a coin's link read from the engine — read-only routes, the same every Ryntra client calls:
 * a Ryntra launch (`GET /api/v1/launch/{mint}`), one market of Jupiter's (`GET /api/spot/market?mint=`), the index of
 * the coins Markets lists (`GET /api/search`) and Jupiter's catalogue (`POST /api/solana/tokens/search`). An answer
 * that is not the engine's reads as nothing: a coin is never named from a guess.
 */

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export type ReadOptions = Readonly<{ fetch?: Fetcher; signal?: AbortSignal }>;

/** One coin as the engine names it: enough to open its trade card. */
export type CoinFacts = Readonly<{ mint: string; symbol: string; name: string; icon: string | null; launch: boolean; verified: boolean | null }>;

const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null);
/** A coin's own words, somebody else's text (CITY-73): hidden characters out, a disguised word or an order held. */
const words = (value: unknown, kind: 'symbol' | 'name', max: number): string | null => (typeof value === 'string' && value.length <= max ? shownText(value, kind, max) : null);
/** A ticker that passes for a known coin it is not is never vouched for. */
const ownTicker = (symbol: string, mint: string): boolean => lookalikeOf(symbol, mint) === null;
const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

export function factsFromLaunch(mint: string, body: unknown): CoinFacts | null {
  const view = record(body);
  const symbol = words(view?.symbol, 'symbol', 32);
  const name = words(view?.name, 'name', 128);
  if (!view || view.token !== mint || !symbol || !name) return null;
  return { mint, symbol, name, icon: sameOriginImage(typeof view.image === 'string' ? view.image : null), launch: true, verified: false };
}

export function factsFromMarket(mint: string, body: unknown): CoinFacts | null {
  const market = record(record(body)?.market);
  const symbol = words(market?.symbol, 'symbol', 32);
  if (!market || market.mint !== mint || !symbol) return null;
  return { mint, symbol, name: words(market.name, 'name', 128) ?? symbol, icon: spotIcon(mint, text(market.icon, 512)), launch: false, verified: market.verified === true && ownTicker(symbol, mint) };
}

export function parseIndex(body: unknown): IndexCoin[] {
  const index = record(body);
  if (!index) return [];
  const rows: IndexCoin[] = [];
  for (const list of [index.coins, index.memes, index.dollars]) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const row = record(raw);
      const symbol = words(row?.symbol, 'symbol', 32);
      if (!row || !isMint(row.mint) || !symbol) continue;
      rows.push({ mint: row.mint, symbol, name: words(row.name, 'name', 128) ?? symbol, icon: text(row.icon, 512) });
    }
  }
  return rows;
}

export function parseCatalog(body: unknown): CatalogRow[] {
  const tokens = record(body)?.tokens;
  if (!Array.isArray(tokens)) return [];
  return tokens.flatMap((raw) => {
    const row = record(raw);
    if (!row || !isMint(row.mint)) return [];
    return [{ mint: row.mint, symbol: words(row.symbol, 'symbol', 32), name: words(row.name, 'name', 128), icon: text(row.icon, 512), isVerified: typeof row.isVerified === 'boolean' ? row.isVerified : null, isSuspicious: row.isSuspicious === true }];
  });
}

async function json(fetcher: Fetcher, url: string, init: RequestInit): Promise<unknown> {
  try {
    const response = await fetcher(url, init);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    if (init.signal?.aborted) throw error;
    return null;
  }
}

const browserFetch: Fetcher = (input, init) => fetch(input, init);

/** A Ryntra launch's own name first; otherwise Jupiter's market of the mint; nothing when neither knows it. */
export async function readCoinFacts(mint: string, options: ReadOptions = {}): Promise<CoinFacts | null> {
  if (!isMint(mint)) return null;
  const fetcher = options.fetch ?? browserFetch;
  const [launch, market] = await Promise.all([
    json(fetcher, `/api/v1/launch/${mint}`, { headers: API_HEADERS, signal: options.signal, cache: 'no-store' }),
    json(fetcher, `/api/spot/market?mint=${mint}`, { headers: { accept: 'application/json' }, signal: options.signal }),
  ]);
  const fromLaunch = factsFromLaunch(mint, launch);
  const fromMarket = factsFromMarket(mint, market) ?? (fromLaunch ? null : factsFromCatalog(mint, await searchCatalog(mint, options)));
  if (fromLaunch) return { ...fromLaunch, icon: fromLaunch.icon ?? fromMarket?.icon ?? null };
  return fromMarket;
}

/** The catalogue's row of this very mint, when the market read did not answer. */
export function factsFromCatalog(mint: string, rows: readonly CatalogRow[]): CoinFacts | null {
  const row = rows.find((r) => r.mint === mint && r.symbol);
  if (!row?.symbol) return null;
  return { mint, symbol: row.symbol, name: row.name ?? row.symbol, icon: spotIcon(mint, row.icon), launch: false, verified: row.isVerified === true && !row.isSuspicious && ownTicker(row.symbol, mint) };
}

export async function readIndex(options: ReadOptions = {}): Promise<IndexCoin[]> {
  return parseIndex(await json(options.fetch ?? browserFetch, '/api/search', { headers: { accept: 'application/json' }, signal: options.signal }));
}

export async function searchCatalog(query: string, options: ReadOptions = {}): Promise<CatalogRow[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > 64) return [];
  return parseCatalog(
    await json(options.fetch ?? browserFetch, '/api/solana/tokens/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: trimmed, limit: 8 }),
      signal: options.signal,
    }),
  );
}
