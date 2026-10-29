/**
 * A market's cover through the city's own origin. The venues' covers live on `assets.agg.market`, and the city's page
 * carries the site's policy, which loads images from itself and two named hosts only — so a cover asked for straight
 * from AGG is refused by the browser and the card shows its emblem forever. The page asks the city's route
 * (`app/api/city/predict/cover`) instead, and the route fetches that one host's covers and nothing else.
 *
 * AGG serves each cover in sizes: `original.webp`, and squares of 44, 48 and 60 px only (read 29.10 — 80, 96 and 120
 * answer 403, so a row that asked for them lost its picture). A place drawn at `px` takes the square that is sharp at
 * twice its size, and the original when none is.
 */

/** The covers AGG serves for events and markets, and only those: one host, one shape of path, WebP. */
export const COVER = /^https:\/\/assets\.agg\.market\/(?:events|markets)\/[a-z0-9-]{1,32}\/(?!\.{1,2}\/)[A-Za-z0-9._-]{1,128}\/cover\/(?:original|raw|\d{2,4})\.webp$/;

/** The route the page asks. */
export const COVER_ROUTE = '/api/city/predict/cover';

/** The squares AGG serves beside the original, px. */
const SQUARES = [44, 48, 60] as const;

/** Whether an address is a cover the route will fetch. */
export function isCover(url: unknown): url is string {
  return typeof url === 'string' && url.length <= 512 && COVER.test(url);
}

/** The address the page loads a cover from, sharp at `px` CSS pixels; null for anything that is not an AGG cover. */
export function coverSrc(url: string | null | undefined, px = 0): string | null {
  if (!isCover(url)) return null;
  const square = px > 0 ? SQUARES.find((s) => s >= px * 2) : undefined;
  const sized = square ? url.replace(/\/(?:original|raw|\d{2,4})\.webp$/, `/${square}.webp`) : url;
  return `${COVER_ROUTE}?u=${encodeURIComponent(sized)}`;
}
