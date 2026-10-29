import { bareSymbol, pastedMint } from './mint.ts';

/**
 * The city's search: one list of coins from four places — the towers of the city (instant, on this device), the Ryntra
 * launches the Launch Docks read, the engine's index of the coins Markets lists (`GET /api/search`), and Jupiter's
 * catalogue through the engine (`POST /api/solana/tokens/search`) for everything else. A coin found in several is one
 * row, and a tower is always said as one.
 */

export type HitSource = 'city' | 'launch' | 'index' | 'catalog';

export type CoinHit = Readonly<{
  mint: string;
  /** Null for a pool the city shows without a name: it is found by its address only, never by a word. */
  symbol: string | null;
  name: string | null;
  /** A same-origin picture address, or null for the plain disc. */
  icon: string | null;
  /** It stands in the city now: picking it flies there. */
  inCity: boolean;
  source: HitSource;
  /** Jupiter's verification as the source says it; null where the source does not say. */
  verified: boolean | null;
  /** A coin launched on Ryntra. */
  launch: boolean;
}>;

/** A tower as the search needs it (`city/lib/market/types.ts` `Tower`). */
export type TowerLike = Readonly<{ id: string; symbol: string; name: string; icon: string | null; verified: boolean }>;
/** A launch as the search needs it (`city/lib/launch/towers.ts` `LaunchTower`). */
export type LaunchLike = Readonly<{ token: string; symbol: string; name: string; image: string | null }>;
/** A coin of the engine's index (`lib/spot/coin-shelf.ts` `ShelfCoin`). */
export type IndexCoin = Readonly<{ mint: string; symbol: string; name: string; icon: string | null }>;
/** A row of Jupiter's catalogue as the engine returns it (`lib/solana/catalog.ts` `TokenSearchRow`). */
export type CatalogRow = Readonly<{ mint: string; symbol: string | null; name: string | null; icon: string | null; isVerified: boolean | null; isSuspicious: boolean }>;

const SOURCE_ORDER: Record<HitSource, number> = { city: 0, launch: 1, index: 2, catalog: 3 };

/** A catalogue's picture through the engine's icon route: https only, the address the catalogue named. */
export function spotIcon(mint: string, url: string | null): string | null {
  if (!url || url.length > 512 || !url.startsWith('https://')) return null;
  return `/api/spot/icon?mint=${encodeURIComponent(mint)}&u=${encodeURIComponent(url)}`;
}

/** The city's towers. A tower Jupiter has not verified and Ryntra did not launch keeps no name here either. */
export function cityHits(towers: readonly TowerLike[], launches: ReadonlySet<string> = new Set()): CoinHit[] {
  return towers.map((t) => {
    const launch = launches.has(t.id);
    const named = t.verified || launch;
    return {
      mint: t.id,
      symbol: named ? bareSymbol(t.symbol) : null,
      name: named ? t.name : null,
      icon: t.verified && t.icon ? `/api/icon/${t.id}` : null,
      inCity: true,
      source: 'city' as const,
      verified: t.verified,
      launch,
    };
  });
}

/** Ryntra launches the docks know, standing in the city or not yet. */
export function launchHits(launches: readonly LaunchLike[], inCity: ReadonlySet<string>): CoinHit[] {
  return launches.map((l) => ({
    mint: l.token,
    symbol: bareSymbol(l.symbol),
    name: l.name,
    icon: l.image,
    inCity: inCity.has(l.token),
    source: 'launch' as const,
    verified: false,
    launch: true,
  }));
}

export function indexHits(coins: readonly IndexCoin[], inCity: ReadonlySet<string>): CoinHit[] {
  return coins.map((c) => ({
    mint: c.mint,
    symbol: bareSymbol(c.symbol),
    name: c.name,
    icon: spotIcon(c.mint, c.icon),
    inCity: inCity.has(c.mint),
    source: 'index' as const,
    verified: null,
    launch: false,
  }));
}

export function catalogHits(rows: readonly CatalogRow[], inCity: ReadonlySet<string>): CoinHit[] {
  return rows.flatMap((r) =>
    r.symbol
      ? [
          {
            mint: r.mint,
            symbol: bareSymbol(r.symbol),
            name: r.name,
            icon: spotIcon(r.mint, r.icon),
            inCity: inCity.has(r.mint),
            source: 'catalog' as const,
            verified: r.isVerified === true && !r.isSuspicious,
            launch: false,
          },
        ]
      : [],
  );
}

/**
 * How well a coin answers what was typed: a pasted address finds its own coin only; a word finds tickers first — the
 * whole ticker, then its start — then names, then a ticker or name that only contains it. 0 is no match.
 */
export function matchScore(hit: CoinHit, query: string): number {
  const typed = query.trim();
  if (!typed) return 0;
  const mint = pastedMint(typed);
  if (mint) return hit.mint === mint ? 1000 : 0;
  if (!hit.symbol) return 0;
  const q = bareSymbol(typed);
  const sym = hit.symbol.toUpperCase();
  const name = (hit.name ?? '').toUpperCase();
  if (!q) return 0;
  if (sym === q) return 100;
  if (sym.startsWith(q)) return 80 - Math.min(10, sym.length - q.length);
  if (name === q) return 70;
  if (name.startsWith(q)) return 60;
  if (name.split(/[\s\-_.]+/).some((word) => word.startsWith(q))) return 50;
  if (q.length >= 2 && sym.includes(q)) return 40;
  if (q.length >= 3 && name.includes(q)) return 30;
  return 0;
}

/** Two rows of one coin become one: the city's word on where it stands, the first name and picture any source has. */
function combine(a: CoinHit, b: CoinHit): CoinHit {
  const [first, second] = SOURCE_ORDER[a.source] <= SOURCE_ORDER[b.source] ? [a, b] : [b, a];
  /* A pool the city shows without a name stays without one, whatever another list calls it. */
  const anonymous = first.source === 'city' && first.symbol === null;
  return {
    ...first,
    symbol: anonymous ? null : (first.symbol ?? second.symbol),
    name: anonymous ? null : (first.name ?? second.name),
    icon: anonymous ? null : (first.icon ?? second.icon),
    inCity: a.inCity || b.inCity,
    launch: a.launch || b.launch,
    verified: first.verified ?? second.verified,
  };
}

/**
 * Every source's rows for one query, as one ranked list: one row per mint, the best match first; among equals a tower
 * first, then the launch, then the index and the catalogue in their own order (the index lists by volume).
 */
export function mergeHits(lists: readonly (readonly CoinHit[])[], query: string, limit = 8): CoinHit[] {
  const byMint = new Map<string, { hit: CoinHit; order: number }>();
  let order = 0;
  for (const list of lists) {
    for (const hit of list) {
      const known = byMint.get(hit.mint);
      byMint.set(hit.mint, known ? { hit: combine(known.hit, hit), order: known.order } : { hit, order: order++ });
    }
  }
  return [...byMint.values()]
    .map((entry) => ({ ...entry, score: matchScore(entry.hit, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.hit.inCity) - Number(a.hit.inCity) || SOURCE_ORDER[a.hit.source] - SOURCE_ORDER[b.hit.source] || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.hit);
}
