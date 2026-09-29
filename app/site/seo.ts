import type { Metadata } from "next";

import { PRODUCT_CANON } from "@/lib/product/canon";
import { HOMEPAGE_CATEGORY, HOMEPAGE_COPY } from "@/lib/site/homepage-copy";
import { SITE_NAME, TWITTER, landingOgImage, languageAlternates, localizedUrl, openGraphLocales } from "@/app/seo";

/**
 * Metadata for the redesigned public pages.
 *
 * One builder rather than four hand-written objects, because the failure mode
 * is drift: a page whose card says something the page itself no longer claims.
 * The description passed in here is the same sentence the page leads with.
 *
 * In the language the page is drawn in (the plan of `RYN-SITE-V5-001` §4):
 * the canonical is that language's address — `/uk/security` for the Ukrainian
 * page — and a page offered in both languages names the pair as `hreflang`.
 */
export function sitePageMetadata({
  path,
  title,
  description,
  keywords = [],
  /** Guard and developer surfaces take the Guard descriptor (canon §19). */
  audience = "company",
  /**
   * A page that still answers but is no longer part of the story the site
   * tells search engines — a reviewer artifact kept for whoever holds its
   * link (Master Plan §4). It keeps its canonical URL and its card, so a
   * shared link still unfurls; it is simply not offered to the index.
   */
  index = true,
  /** The language the page is drawn in. */
  locale = "en",
  /** The page's own share card; the landing's card, in the page's language, where it has none. */
  image,
}: {
  path: string;
  title: string;
  description: string;
  keywords?: readonly string[];
  audience?: "company" | "guard";
  index?: boolean;
  locale?: "en" | "uk";
  image?: Readonly<{ url: string; alt: string }>;
}): Metadata {
  const canonical = localizedUrl(path, locale);
  const languages = index ? languageAlternates(path) : undefined;
  const category = audience === "guard" ? PRODUCT_CANON.guardCategory : HOMEPAGE_CATEGORY;
  /* The landing's card, where a page has none of its own — the Owner's line of
     2026-09-26. The canon's old trust line said «Paper-first», which the
     product no longer is. */
  const card = image ?? { url: landingOgImage(locale), alt: HOMEPAGE_COPY[locale].ogAlt };

  return {
    title,
    description,
    keywords: [...keywords],
    category,
    robots: index ? { index: true, follow: true } : { index: false, follow: false },
    alternates: { canonical, ...(languages ? { languages } : {}) },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description,
      url: canonical,
      ...openGraphLocales(path, locale),
      images: [{ url: card.url, width: 1200, height: 630, alt: card.alt }],
    },
    twitter: {
      card: "summary_large_image",
      site: TWITTER,
      creator: TWITTER,
      title,
      description,
      images: [card.url],
    },
  };
}
