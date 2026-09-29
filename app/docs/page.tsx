import type { Metadata } from "next";

import { docsCard } from "@/app/brand/page-card";
import { localizedUrl, pageCardImage } from "@/app/seo";
import { sitePageMetadata } from "@/app/site/seo";
import { DOCS_UPDATED } from "@/lib/site/page-dates";
import { publicServerLocale } from "@/lib/site/server-locale";
import { breadcrumbList, jsonLdScript, webPage } from "@/lib/site/structured-data";

import { OVERVIEW } from "./content/start";
import { DocsPage } from "./docs-page";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await publicServerLocale();
  const card = docsCard("", locale);
  return sitePageMetadata({
    path: "/docs",
    title: OVERVIEW.seoTitle?.[locale] ?? (locale === "uk" ? "Документація Ryntra" : "Ryntra Docs"),
    description: OVERVIEW.summary[locale],
    keywords: ["ryntra documentation", "how to buy tokenized stocks", "tokenized stocks from $1", "autoinvest", "xstocks", "prestocks"],
    locale,
    ...(card ? { image: pageCardImage(locale, ["docs"], card) } : {}),
  });
}

export default async function Page() {
  const locale = await publicServerLocale();
  const url = localizedUrl("/docs", locale);
  const name = locale === "uk" ? "Документація Ryntra" : "Ryntra Docs";
  const graph = [
    webPage({ type: "CollectionPage", url, name, description: OVERVIEW.summary[locale], locale, crumbs: [], extra: { dateModified: DOCS_UPDATED } }),
    breadcrumbList(url, [
      { name: "Ryntra", url: localizedUrl("/", locale) },
      { name, url },
    ]),
  ];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />
      <DocsPage view={{ kind: "page", page: OVERVIEW }} />
    </>
  );
}
