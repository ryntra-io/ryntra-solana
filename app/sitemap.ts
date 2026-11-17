import type { MetadataRoute } from "next";
import { CITY_PAGES, type CityPage } from "../city/lib/open/site-map.ts";
import { localizedUrl } from "./seo.ts";
import { CITY_PATH, SHELF_IDS, SHELVES, shelfOn } from "../terminal/shell/shelves.ts";

/**
 * The sitemap is where the site says what it wants found — and only that: the live addresses of the city
 * (`city/lib/open/site-map.ts`).
 *
 * On 2026-10-31 it still named 103 addresses, and 102 of them were pages of the old site — the documentation at both of
 * its addresses, About, Contact, Security, Stats, the legal texts, the partner Terms — drawn in the old interface nobody
 * is to see (decision 75). They stay reachable for whoever holds a link, out of the index (`X-Robots-Tag: noindex`,
 * `next.config.ts`), until the city takes each over at its own address, when it comes back here.
 *
 * What is deliberately absent: the old interface (`/app/*`, the Solana workspace, Mission Control), which only leads
 * into the city; the short addresses (`/launch`, `/trade` …), which only lead into it; a
 * coin's tower `/c/<mint>`, shared but never offered to the index. `lastModified` is the date the page last changed
 * what it is — not a build time, which would tell a crawler every page changed on every deploy.
 */

type Entry = MetadataRoute.Sitemap[number];

function entryOf(page: CityPage): Entry {
  return {
    url: localizedUrl(page.path, "en"),
    lastModified: new Date(`${page.updated}T00:00:00.000Z`),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  };
}

/** The day the terminal became the home page. */
const TERMINAL_DAY = "2026-11-16";

/**
 * The terminal's pages once it is the home page: `/` is its Market, each section that is on stands at its own
 * address (a person's Portfolio excepted — nothing in it is for a search engine), and the city stands at `/city`.
 * «Launched on Ryntra» (`/launches`) leads to Launch then, so it leaves the list.
 */
function terminalPages(): CityPage[] {
  const sections = SHELF_IDS.filter((id) => id !== "market" && id !== "portfolio" && shelfOn(id)).map(
    (id): CityPage => ({ path: SHELVES[id].path, updated: TERMINAL_DAY, priority: 0.8, changeFrequency: "daily" }),
  );
  return [...sections, { path: CITY_PATH, updated: TERMINAL_DAY, priority: 0.6, changeFrequency: "daily" }];
}

/** Every entry: the live addresses, in English alone (the address has no Ukrainian twin; its words follow the reader). */
export function sitemapEntries(): MetadataRoute.Sitemap {
  if (!shelfOn("market")) return CITY_PAGES.map(entryOf);
  const home = { path: "/", updated: TERMINAL_DAY, priority: 1, changeFrequency: "daily" } as const satisfies CityPage;
  const rest = CITY_PAGES.filter((page) => page.path !== "/" && page.path !== "/launches");
  return [home, ...terminalPages(), ...rest].map(entryOf);
}

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries();
}
