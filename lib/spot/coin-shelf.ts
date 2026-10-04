/**
 * Dollars and crypto on «Простий»'s Markets: «Долари (USDC, USDT) ·
 * Крипта». Pure — the list the Spot registry already reads in, cards out.
 *
 * **Dollars** are the two dollar tokens, USDC then USDT, when the venue
 * lists them. **Crypto** is the venue's verified crypto — never a meme
 * (memes are «Профі»'s), never a token the venue marks suspicious, never a
 * dollar token again — by the day's volume, the same neutral order for
 * everyone, a handful at a time. Nothing here is a recommendation; the order
 * is the provider's own figure.
 */

import type { SpotMarketListRow } from "./markets.ts";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

/** The dollar tokens, in their order on the shelf. */
const DOLLARS: readonly string[] = [USDC_MINT, USDT_MINT];

/**
 * Money tokens the venue lists among its majors — none of them is «crypto» to
 * a beginner. By mint for the ones the product already names elsewhere
 * (`lib/liquidity/model.ts`), and by the symbol's own word for the rest
 * (USDe, FDUSD, EURC …): a dollar or a euro token says so in its symbol.
 */
const DOLLAR_LIKE: ReadonlySet<string> = new Set([
  USDC_MINT,
  USDT_MINT,
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", // PYUSD
  "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA", // USDS
]);
const MONEY_SYMBOL = /usd|eur/i;

/** Crypto cards on Markets before «Показати ще». */
export const CRYPTO_SHOWN = 8;

export type ShelfCoin = Readonly<{
  name: string;
  symbol: string;
  mint: string;
  icon: string | null;
  price: number;
  change24h: number | null;
  volume24h: number;
}>;

export type CoinShelf = Readonly<{ dollars: readonly ShelfCoin[]; crypto: readonly ShelfCoin[] }>;

/** The name a person knows a coin by. SOL is listed by the venue as its wrapped form. */
function coinName(row: SpotMarketListRow): string {
  if (row.mint === WRAPPED_SOL) return "Solana";
  if (row.mint === USDC_MINT) return "USD Coin";
  if (row.mint === USDT_MINT) return "Tether USD";
  return row.name;
}

const priced = (row: SpotMarketListRow): boolean => typeof row.price === "number" && Number.isFinite(row.price) && row.price > 0;

function coinOf(row: SpotMarketListRow): ShelfCoin {
  return {
    name: coinName(row),
    symbol: row.mint === WRAPPED_SOL ? "SOL" : row.symbol,
    mint: row.mint,
    icon: row.icon,
    price: row.price as number,
    change24h: typeof row.change24hPct === "number" && Number.isFinite(row.change24hPct) ? Math.round(row.change24hPct * 100) / 100 : null,
    volume24h: Math.round(row.volume24hUsd ?? 0),
  };
}

/**
 * Memes on Markets' own tab: the venue's verified memes —
 * never one it marks suspicious — by the day's volume, the same neutral order
 * for everyone. The tab states the risk before a single figure; this list is
 * only what the venue lists, never a pick.
 */
export function memeShelf(rows: readonly SpotMarketListRow[]): readonly ShelfCoin[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (row.category !== "meme" || !row.verified || row.suspicious || !priced(row) || seen.has(row.mint)) return false;
      seen.add(row.mint);
      return true;
    })
    .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
    .map(coinOf);
}

export function coinShelf(rows: readonly SpotMarketListRow[]): CoinShelf {
  const byMint = new Map(rows.map((row) => [row.mint, row]));
  const dollars = DOLLARS.flatMap((mint) => {
    const row = byMint.get(mint);
    return row && priced(row) ? [coinOf(row)] : [];
  });
  const crypto = rows
    .filter((row) => row.category === "crypto" && row.verified && !row.suspicious && !DOLLAR_LIKE.has(row.mint) && !MONEY_SYMBOL.test(row.symbol) && priced(row))
    .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
    .map(coinOf);
  return { dollars, crypto };
}
