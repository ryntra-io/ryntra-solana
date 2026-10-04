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
  kind: "company" | "crypto";
  href: string;
}>;

/** How deep into each list, by the day's volume, a move is looked for. */
export const MOVER_POOL = 24;

export function moversOf(index: SearchIndex, count = 5): readonly Mover[] {
  const companies = index.companies.slice(0, MOVER_POOL).flatMap((card): Mover[] =>
    card.change24h === null || !Number.isFinite(card.change24h) || !(card.price > 0)
      ? []
      : [{ key: card.mint, name: card.name, symbol: card.ticker, mint: card.mint, icon: card.icon, price: card.price, change24h: card.change24h, kind: "company", href: `/app/stocks/${encodeURIComponent(card.ticker)}` }],
  );
  const crypto = index.coins.slice(0, MOVER_POOL).flatMap((coin): Mover[] =>
    coin.change24h === null || !Number.isFinite(coin.change24h) || !(coin.price > 0)
      ? []
      : [{ key: coin.mint, name: coin.name, symbol: coin.symbol, mint: coin.mint, icon: coin.icon, price: coin.price, change24h: coin.change24h, kind: "crypto", href: `/app/spot?mint=${encodeURIComponent(coin.mint)}` }],
  );
  const seen = new Set<string>();
  return [...companies, ...crypto]
    .filter((mover) => !seen.has(mover.mint) && seen.add(mover.mint))
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h) || a.name.localeCompare(b.name))
    .slice(0, count);
}
