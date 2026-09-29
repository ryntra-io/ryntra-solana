import type { MetadataRoute } from "next";
import { CUSTOMER_REDIRECTS } from "../lib/product/customer-routing.ts";
import { hasUkAddress } from "../lib/site/localized.ts";
import { COMPANY_PAGES_UPDATED, DOCS_UPDATED, HOME_UPDATED, LANDING_UPDATED, MARKETS_UPDATED } from "../lib/site/page-dates.ts";
import { DOC_PAGES, docsHref } from "./docs/content/index.ts";
import { APP_HOME_PATH, APP_MARKETS_PATH, languageAlternates, localizedUrl } from "./seo.ts";

export { COMPANY_PAGES_UPDATED, DOCS_UPDATED, HOME_UPDATED, LANDING_UPDATED, MARKETS_UPDATED };

/**
 * The sitemap is where the site says what it wants found — and only that.
 *
 * On 2026-09-14 it still advertised twenty-four URLs, and nineteen of them
 * answered with a redirect: the product map, the handbook chapters, the
 * developer portal's old addresses, the Ukrainian landing — every one
 * consolidated on 2026-09-05 into the cabinet and the guides, or parked on
 * 2026-09-13, with the sitemap never told. A crawler offered a
 * redirect learns that the site does not know its own shape, and the stale
 * address keeps ranking above the page that replaced it. So every entry is a
 * page that answers 200 with `index, follow`, and a test refuses any entry
 * that `CUSTOMER_REDIRECTS` sends elsewhere.
 *
 * Since the technical subtask of the new site (`RYN-SITE-V5-001`, subtask 4,
 * the plan's §4) every page offered to the index is listed at both of its
 * addresses — English without a prefix, Ukrainian at `/uk` and the same path —
 * each entry naming the pair and `x-default` as `xhtml:link`: the landing,
 * Home, Markets, the public pages, the documentation and the companies' pages
 * the shelf opens. The legal texts are English only until a lawyer's word.
 *
 * What is deliberately absent: the rest of the cabinet (`/app/*`, `noindex`);
 * older pages kept for whoever holds their link, not offered to the index
 * (Master Plan §4); the open-source page
 * `/developers` and the developer references for Guard and Agent Control
 * (reachable, `noindex`: not the product the site describes); the legal
 * review candidates (`noindex`). `lastModified` is the date the page's
 * content last changed (`lib/site/page-dates.ts`) — not a build time, which
 * would tell a crawler every page changed on every deploy.
 */

type PublicPage = Readonly<{
  path: string;
  priority: number;
  updated: string;
  changeFrequency: "weekly" | "monthly";
}>;

/** The public pages, by how load-bearing each is for a stranger's first question. */
export const PUBLIC_PAGES: readonly PublicPage[] = [
  /* The documentation: the hub, then every page of it — each one answers a
     question a person who has decided to try the product asks next, and
     each is the page a search engine should send them to for it. */
  { path: "/docs", priority: 0.8, updated: DOCS_UPDATED, changeFrequency: "weekly" },
  ...DOC_PAGES.filter((page) => page.slug).map((page): PublicPage => ({
    path: docsHref(page.slug),
    priority: page.group === "start" || page.group === "invest" ? 0.7 : 0.6,
    updated: DOCS_UPDATED,
    changeFrequency: "monthly",
  })),
  /* Who builds Ryntra, the rules it keeps and how it earns. */
  { path: "/company", priority: 0.5, updated: "2026-09-26", changeFrequency: "monthly" },
  /* How to reach the people behind it. */
  { path: "/contact", priority: 0.5, updated: "2026-09-26", changeFrequency: "monthly" },
  /* How to get help — the guides, History and the inbox; the Android app's store listing names it. */
  { path: "/support", priority: 0.5, updated: "2026-09-29", changeFrequency: "monthly" },
  /* What the product can touch and what it structurally cannot — the first
     question a careful reader asks of anything that signs with a wallet. */
  { path: "/security", priority: 0.6, updated: "2026-09-26", changeFrequency: "monthly" },
  /* Where every figure the product shows comes from, and when. */
  { path: "/methodology", priority: 0.5, updated: "2026-09-26", changeFrequency: "monthly" },
  /* What has actually been routed, counted from the chain by one written rule — its words in both languages since 2026-09-27. */
  { path: "/stats", priority: 0.5, updated: "2026-09-27", changeFrequency: "weekly" },
  /* The policies, dated by their own effective dates. */
  { path: "/legal/terms", priority: 0.3, updated: "2026-09-14", changeFrequency: "monthly" },
  { path: "/legal/privacy", priority: 0.3, updated: "2026-09-29", changeFrequency: "monthly" },
];

/** The cabinet's pages offered to the index: Home, Markets, and every company the shelf opens (read live). */
export const APP_PAGES: readonly PublicPage[] = [
  { path: APP_HOME_PATH, priority: 0.9, updated: HOME_UPDATED, changeFrequency: "weekly" },
  { path: APP_MARKETS_PATH, priority: 0.8, updated: MARKETS_UPDATED, changeFrequency: "weekly" },
];

const redirected = new Set(CUSTOMER_REDIRECTS.map((row) => row.source));

type Entry = MetadataRoute.Sitemap[number];

/** A page's entries: one per address it has, each naming the pair where there are two. */
function entriesOf(page: PublicPage): Entry[] {
  const lastModified = new Date(`${page.updated}T00:00:00.000Z`);
  const languages = languageAlternates(page.path);
  if (!languages) return [{ url: localizedUrl(page.path, "en"), lastModified, changeFrequency: page.changeFrequency, priority: page.priority }];
  return (["en", "uk"] as const).map((locale) => ({
    url: localizedUrl(page.path, locale),
    lastModified,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
    alternates: { languages },
  }));
}

/**
 * Every entry, for the company pages it is handed: the landing first, then
 * Home and Markets, the public pages and the documentation, then the
 * companies — each at both addresses.
 */
export function sitemapEntries(companyTickers: readonly string[]): MetadataRoute.Sitemap {
  const companies = [...new Set(companyTickers)]
    .sort()
    .map((ticker): PublicPage => ({ path: `/app/stocks/${ticker}`, priority: 0.6, updated: COMPANY_PAGES_UPDATED, changeFrequency: "weekly" }))
    .filter((page) => hasUkAddress(page.path));
  return [
    ...entriesOf({ path: "/", priority: 1, updated: LANDING_UPDATED, changeFrequency: "weekly" }),
    ...APP_PAGES.flatMap(entriesOf),
    ...PUBLIC_PAGES.filter((page) => !redirected.has(page.path)).flatMap(entriesOf),
    ...companies.flatMap(entriesOf),
  ];
}

/* Read on request from the catalogue the server keeps warm, so the companies
   are the shelf's of the day — never a list baked into a build. */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  /* Loaded here, not at the top, so a test of the entries never reaches for the network. */
  const [{ readStockUniverse }, { shelfTickers }] = await Promise.all([import("../lib/stocks/universe.server.ts"), import("../lib/site/company-page.ts")]);
  const read = await readStockUniverse();
  /* A silent catalogue drops the companies for this answer and nothing else: the site's own pages are always listed. */
  return sitemapEntries(read.ok ? [...shelfTickers(read.universe)] : []);
}
