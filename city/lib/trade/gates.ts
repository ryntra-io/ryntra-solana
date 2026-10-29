/**
 * The deployment's two switches for trading in the city, read once from the build's environment.
 *
 * - `NEXT_PUBLIC_RYNTRA_CITY_TRADE` — trading from a tower: open to everyone since the live signed buy and sell on
 *   production; `closed` puts the cards back to «soon» without a code change. Swapping any coin for any coin rides on
 *   it: it is the same engine route and the same signature.
 * - `NEXT_PUBLIC_RYNTRA_CITY_SPOT` — limit and stop orders and «My orders»: a new path for money, so shut until the
 *   Owner opens it with `open` after a canary of a small amount. Anything else keeps the card on the market price only.
 */

export function tradeOpen(value: string | undefined): boolean {
  return value !== 'closed';
}

export function spotOpen(value: string | undefined): boolean {
  return value === 'open';
}

export const TRADE_OPEN = tradeOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_TRADE);
export const SPOT_OPEN = spotOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_SPOT);
