/**
 * What the site offers a search engine (CITY-159): the live addresses of the city, and nothing else.
 *
 * Until 31.10 the sitemap named 103 addresses and 102 of them were the old site's pages — the documentation in two
 * languages, About, Contact, Security, Stats, the legal texts — each still drawn in the old interface, which nobody is to
 * see (decision 75). The city's own pages are listed here as they come: a document the city's windows take over at its
 * own address (CITY-157) moves from `AWAITING_CITY` to `CITY_PAGES` in the same change.
 *
 * `/c/<mint>` (a coin's tower) is not listed: one page per mint, scams' among them — shared, never offered to the index
 * (`app/c/[mint]/page.tsx`). `/window` is a window on a second screen, never a page to find.
 *
 * Pure data, no imports: the build's config reads this file before anything is compiled.
 */

export type CityPage = Readonly<{
  path: string;
  /** The day the page last changed what it is — never a build time, which would tell a crawler it changes on every deploy. */
  updated: string;
  priority: number;
  changeFrequency: 'daily' | 'weekly' | 'monthly';
}>;

/** The live addresses of the city, the first one first. */
export const CITY_PAGES: readonly CityPage[] = [
  /* The city itself: the live market, every coin a tower — its towers change by the minute. */
  { path: '/', updated: '2026-10-31', priority: 1, changeFrequency: 'daily' },
];

/**
 * The site's public pages that still answer in the old interface, each until the city takes it over at the same
 * address (CITY-157: the help, the legal texts, About, the documentation). They stay reachable — a store listing, a
 * law and old links name them — but they are not in the sitemap, and they answer with `X-Robots-Tag: noindex` so an
 * index forgets them. A pattern is a Next source; each comes with its Ukrainian address where it has one.
 *
 * The partner Terms (`/promo/partners/terms`) are the Growth line's page: out of the sitemap, the rest is that line's.
 */
export const AWAITING_CITY = [
  '/docs/:path*',
  '/company',
  '/contact',
  '/support',
  '/security',
  '/methodology',
  '/stats',
  '/legal/:path*',
] as const;

/** The sources the old pages answer at: each pattern, and its Ukrainian twin where the site has one. */
export function awaitingSources(): string[] {
  return AWAITING_CITY.flatMap((source) => (source.startsWith('/legal') ? [source] : [source, `/uk${source}`]));
}
