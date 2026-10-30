import type { MetadataRoute } from "next";
import { CUSTOMER_REDIRECTS } from "../lib/product/customer-routing.ts";
import { LANDING_IS_LIVE } from "../lib/site/home-to-app.ts";
import { COMPANY_PAGES_UPDATED, DOCS_UPDATED, HOME_UPDATED, LANDING_UPDATED, MARKETS_UPDATED, MISSION_CONTROL_UPDATED } from "../lib/site/page-dates.ts";
import { DOC_PAGES, docsHref } from "./docs/content/index.ts";
import { languageAlternates, localizedUrl, SITE } from "./seo.ts";

export { COMPANY_PAGES_UPDATED, DOCS_UPDATED, HOME_UPDATED, LANDING_UPDATED, MARKETS_UPDATED, MISSION_CONTROL_UPDATED };

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
 * Since the new site's technical pass every page offered to the index is
 * listed at both of its addresses — English without a prefix, Ukrainian at
 * `/uk` and the same path — each entry naming the pair and `x-default` as
 * `xhtml:link`: the landing, Home, Markets, the public pages, the
 * documentation and the companies' pages the shelf opens. The legal texts are
 * English only until a lawyer's word. The creator partner Terms name their
 * language in the query (`?lang=en|uk`) and are listed at both.
 *
 * What is deliberately absent: the old interface — the cabinet (`/app/*`,
 * Home, Markets and the companies' pages among it), its Solana workspace and
 * Mission Control — which only leads into the city since CITY-13;
 * older pages kept for whoever holds their link, not offered to the index;
 * the open-source page `/developers` and the developer references for Guard
 * and Agent Control (reachable, `noindex`: not the product the site
 * describes); the legal review candidates (`noindex`). `lastModified` is the
 * date the page's content last changed (`lib/site/page-dates.ts`) — not a
 * build time, which would tell a crawler every page changed on every deploy.
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
    priority: page.group === "start" || page.group === "trade" ? 0.7 : 0.6,
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

/**
 * The creator partner programme's public Terms. Its
 * language is in the query, not a `/uk` prefix — `?lang=en` and `?lang=uk`,
 * each the canonical address the page itself names, the pair as alternates.
 */
export const PARTNER_TERMS_PATH = "/promo/partners/terms";
export const PARTNER_TERMS_UPDATED = "2026-10-17";

function partnerTermsEntries(): Entry[] {
  const at = (locale: "en" | "uk") => `${SITE}${PARTNER_TERMS_PATH}?lang=${locale}`;
  const languages = { en: at("en"), uk: at("uk"), "x-default": at("en") };
  return (["en", "uk"] as const).map((locale) => ({
    url: at(locale),
    lastModified: new Date(`${PARTNER_TERMS_UPDATED}T00:00:00.000Z`),
    changeFrequency: "monthly",
    priority: 0.4,
    alternates: { languages },
  }));
}

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
 * Every entry: the city at `/`, then the public pages and the documentation —
 * each at both addresses — and the partner Terms.
 */
export function sitemapEntries(): MetadataRoute.Sitemap {
  return [
    /* The city at `/`, in English alone (decision 70); while ryntra.io's home page leads into the app
       (`lib/site/home-to-app.ts`) it is not advertised. */
    ...(LANDING_IS_LIVE ? [{ url: localizedUrl("/", "en"), lastModified: new Date(`${MISSION_CONTROL_UPDATED}T00:00:00.000Z`), changeFrequency: "weekly" as const, priority: 1 }] : []),
    ...PUBLIC_PAGES.filter((page) => !redirected.has(page.path)).flatMap(entriesOf),
    ...partnerTermsEntries(),
  ];
}

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries();
}
