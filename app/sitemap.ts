import type { MetadataRoute } from "next";
import { CITY_PAGES, type CityPage } from "../city/lib/open/site-map.ts";
import { localizedUrl } from "./seo.ts";

/**
 * The sitemap is where the site says what it wants found — and only that: the live addresses of the city
 * (`city/lib/open/site-map.ts`, CITY-159).
 *
 * On 2026-10-31 it still named 103 addresses, and 102 of them were pages of the old site — the documentation at both of
 * its addresses, About, Contact, Security, Stats, the legal texts, the partner Terms — drawn in the old interface nobody
 * is to see (decision 75). They stay reachable for whoever holds a link, out of the index (`X-Robots-Tag: noindex`,
 * `next.config.ts`), until the city takes each over at its own address (CITY-157), when it comes back here.
 *
 * What is deliberately absent: the old interface (`/app/*`, the Solana workspace, Mission Control), which only leads
 * into the city since CITY-13; the short addresses (`/launch`, `/trade` …), which only lead into it since CITY-159; a
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

/** Every entry: the city's live addresses, in English alone (the city's address has no Ukrainian twin; its words follow the reader). */
export function sitemapEntries(): MetadataRoute.Sitemap {
  return CITY_PAGES.map(entryOf);
}

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries();
}
