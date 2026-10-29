import { SITE_ORIGIN } from '../../../lib/product/app-address.ts';
import { isMint } from '../search/mint.ts';

/**
 * The address of one coin in the city: `https://ryntra.io/c/<mint>` opens the city on that coin — its tower when it
 * stands in the skyline, its trade card when it does not — and its preview on X and Telegram is that coin's own card.
 * Every share of a coin points here. The site's origin is the one the product names (`lib/product/app-address.ts`).
 */
export function coinPath(mint: string): string {
  return isMint(mint) ? `/c/${mint}` : '/';
}

export function coinLink(mint: string): string {
  const path = coinPath(mint);
  return path === '/' ? SITE_ORIGIN : `${SITE_ORIGIN}${path}`;
}
