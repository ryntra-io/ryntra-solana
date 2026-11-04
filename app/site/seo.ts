import type { Metadata } from "next";

import { PRODUCT_CANON } from "@/lib/product/canon";
import { HOMEPAGE_CATEGORY } from "@/lib/site/homepage-copy";
import { SITE_NAME, TWITTER, cardAltFor, landingOgImage, languageAlternates, localizedUrl, openGraphLocales } from "@/app/seo";

/**
 * Metadata for the redesigned public pages.
 *
 * One builder rather than four hand-written objects, because the failure mode
 * is drift: a page whose card says something the page itself no longer claims.
 * The description passed in here is the same sentence the page leads with.
 *
 * In the language the page is drawn in: the canonical is that language's
 * address — `/uk/security` for the Ukrainian page — and a page offered in
 * both languages names the pair as `hreflang`.
 */
export function sitePageMetadata({
  path,
  title,
  description,
  keywords = [],
  /** Guard and developer surfaces take the Guard descriptor. */
  audience = "company",
  /**
   * A page that still answers but is no longer part of the story the site
   * tells search engines — a reviewer artifact kept for whoever holds its
   * link. It keeps its canonical URL and its card, so a shared link still
   * unfurls; it is simply not offered to the index.
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
  /* The city's card (CITY-158), where a page has none of its own, and its own words as the alt. */
  const card = image ?? { url: landingOgImage(locale), alt: cardAltFor(locale) };

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
