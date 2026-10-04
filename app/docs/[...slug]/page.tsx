import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { docsCard } from "@/app/brand/page-card";
import { localizedUrl, pageCardImage } from "@/app/seo";
import { sitePageMetadata } from "@/app/site/seo";
import { DOCS_UPDATED } from "@/lib/site/page-dates";
import { publicServerLocale } from "@/lib/site/server-locale";
import { breadcrumbList, jsonLdScript, techArticle } from "@/lib/site/structured-data";

import { DOC_PAGES, docPageBySlug } from "../content";
import { GROUP_TITLES } from "../content/model";
import { DocsPage } from "../docs-page";

/**
 * Every documentation page but the hub: `/docs/trade/swap` is the page whose
 * slug is `trade/swap`, and `/uk/docs/trade/swap` the same page in Ukrainian
 * (`middleware.ts`). The three developer references have their own
 * routes beside this one and win by being static. An unknown slug is a 404,
 * never a fallback page pretending to be documentation.
 */

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_PAGES.filter((page) => page.slug).map((page) => ({ slug: page.slug.split("/") }));
}

function docsTitle(locale: "en" | "uk"): string {
  return locale === "uk" ? "Документація Ryntra" : "Ryntra Docs";
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = docPageBySlug(slug.join("/"));
  if (!page) return {};
  const locale = await publicServerLocale();
  const card = docsCard(page.slug, locale);
  return sitePageMetadata({
    path: `/docs/${page.slug}`,
    /* A page's own search title where it says more than the heading; else «{title} — Ryntra Docs». */
    title: page.seoTitle?.[locale] ?? `${page.title[locale]} — ${docsTitle(locale)}`,
    description: page.summary[locale],
    locale,
    ...(card ? { image: pageCardImage(locale, ["docs", ...page.slug.split("/")], card) } : {}),
  });
}

export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const page = docPageBySlug(slug.join("/"));
  if (!page) notFound();
  const locale = await publicServerLocale();
  const url = localizedUrl(`/docs/${page.slug}`, locale);
  const graph = [
    techArticle({ url, headline: page.title[locale], description: page.summary[locale], locale, dateModified: DOCS_UPDATED, section: GROUP_TITLES[page.group][locale] }),
    breadcrumbList(url, [
      { name: "Ryntra", url: localizedUrl("/", locale) },
      { name: docsTitle(locale), url: localizedUrl("/docs", locale) },
      { name: page.title[locale], url },
    ]),
  ];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />
      <DocsPage view={{ kind: "page", page }} />
    </>
  );
}
