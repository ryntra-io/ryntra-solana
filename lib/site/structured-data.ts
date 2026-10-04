/**
 * The structured data of the pages offered to the index, in the page's
 * language and naming the page's own address in it. `Organization` and
 * `WebSite` are the root layout's, once per page; each page adds what it is —
 * a web page, a collection, an article, an about or a contact page — and where
 * it sits, as breadcrumbs.
 *
 * What is deliberately never here: a price, a rating, an offer of a token.
 * The token is not sold by Ryntra and its price is live, so a company page is
 * a page *about* the company (`Corporation`, or `Organization` for a private
 * one), not a product.
 */

export const SITE_ORIGIN = "https://ryntra.io";
export const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`;
export const WEBSITE_ID = `${SITE_ORIGIN}/#website`;

export type JsonLd = Readonly<Record<string, unknown>>;
export type Crumb = Readonly<{ name: string; url: string }>;

/** The graph as a page writes it: `<` escaped, so no string in it can close the script. */
export function jsonLdScript(graph: readonly JsonLd[]): string {
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}

export function breadcrumbList(url: string, crumbs: readonly Crumb[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumbs`,
    itemListElement: crumbs.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, name: crumb.name, item: crumb.url })),
  };
}

export type PageType = "WebPage" | "CollectionPage" | "AboutPage" | "ContactPage";

/** A page: its kind, address, name and description in its language, the site it belongs to, and what it is about. */
export function webPage(page: Readonly<{ type?: PageType; url: string; name: string; description: string; locale: string; crumbs?: readonly Crumb[]; about?: JsonLd; extra?: JsonLd }>): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": page.type ?? "WebPage",
    "@id": `${page.url}#page`,
    url: page.url,
    name: page.name,
    description: page.description,
    inLanguage: page.locale,
    isPartOf: { "@id": WEBSITE_ID },
    publisher: { "@id": ORGANIZATION_ID },
    ...(page.crumbs ? { breadcrumb: { "@id": `${page.url}#breadcrumbs` } } : {}),
    ...(page.about ? { about: page.about } : {}),
    ...(page.extra ?? {}),
  };
}

/** A documentation page: an article on how to use the product, dated by its content. */
export function techArticle(article: Readonly<{ url: string; headline: string; description: string; locale: string; dateModified: string; section: string }>): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "@id": `${article.url}#article`,
    url: article.url,
    mainEntityOfPage: article.url,
    headline: article.headline,
    description: article.description,
    inLanguage: article.locale,
    articleSection: article.section,
    dateModified: article.dateModified,
    isPartOf: { "@id": WEBSITE_ID },
    publisher: { "@id": ORGANIZATION_ID },
    author: { "@id": ORGANIZATION_ID },
    breadcrumb: { "@id": `${article.url}#breadcrumbs` },
  };
}

/** The company a page is about: a listed one by its name and its share's ticker, a private one by its name. */
export function companyEntity(company: Readonly<{ name: string; tickerSymbol: string | null }>): JsonLd {
  return company.tickerSymbol
    ? { "@type": "Corporation", name: company.name, tickerSymbol: company.tickerSymbol }
    : { "@type": "Organization", name: company.name };
}

/** A list of pages — Markets' companies by name and address, in the list's own order, never with a price. */
export function itemList(url: string, items: readonly Crumb[]): JsonLd {
  return {
    "@type": "ItemList",
    "@id": `${url}#list`,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, url: item.url })),
  };
}
