/**
 * What moves today: the companies and the crypto that moved most over 24
 * hours, from the lists Markets draws (the search index). Pure: the index in,
 * the movers out.
 *
 * Only what trades: the pool is each list's head by the day's volume, so a
 * thin token's wild print never tops the column. Memes and the dollars stay
 * out — memes have their own tab with the risk said first, and a dollar does
 * not move. A move is the day's change as the venue reports it; an unknown
 * change is not a move.
 */

import type { SearchIndex } from "./product-search.ts";

export type Mover = Readonly<{
  key: string;
  name: string;
  symbol: string;
  mint: string;
  icon: string | null;
  price: number;
  change24h: number;
  /** The day's trading, USD, as the list states it. */
  volume24h: number;
  kind: "company" | "crypto";
  href: string;
}>;

/** How deep into each list, by the day's volume, a move is looked for. */
export const MOVER_POOL = 24;
/**
 * A coin moves the market only if it trades: the venue files many a meme under
 * «crypto», and a thin token's swing is noise, not a move (B2b, critic 19.10).
 */
export const MOVER_MIN_VOLUME_USD = 5_000_000;

/**
 * `skip`: mints already drawn beside the movers (Home's «Ринки зараз» for a guest) — a move is looked for past them, so
 * two tables on one screen never repeat a row.
 */
export function moversOf(index: SearchIndex, count = 5, skip: ReadonlySet<string> = new Set()): readonly Mover[] {
  /* What is skipped is made up for: the move is looked for that many rows deeper. */
  const depth = MOVER_POOL + skip.size;
  const companies = index.companies.slice(0, depth).flatMap((card): Mover[] =>
    card.change24h === null || !Number.isFinite(card.change24h) || !(card.price > 0)
      ? []
      : [{ key: card.mint, name: card.name, symbol: card.ticker, mint: card.mint, icon: card.icon, price: card.price, change24h: card.change24h, volume24h: card.volume24h, kind: "company", href: `/app/stocks/${encodeURIComponent(card.ticker)}` }],
  );
  const memes = new Set(index.memes.map((meme) => meme.mint));
  const crypto = index.coins.slice(0, depth).flatMap((coin): Mover[] =>
    coin.change24h === null || !Number.isFinite(coin.change24h) || !(coin.price > 0) || memes.has(coin.mint) || !(coin.volume24h >= MOVER_MIN_VOLUME_USD)
      ? []
      : [{ key: coin.mint, name: coin.name, symbol: coin.symbol, mint: coin.mint, icon: coin.icon, price: coin.price, change24h: coin.change24h, volume24h: coin.volume24h, kind: "crypto", href: `/app/spot?mint=${encodeURIComponent(coin.mint)}` }],
  );
  const seen = new Set<string>(skip);
  return [...companies, ...crypto]
    .filter((mover) => !seen.has(mover.mint) && seen.add(mover.mint))
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h) || a.name.localeCompare(b.name))
    .slice(0, count);
}
