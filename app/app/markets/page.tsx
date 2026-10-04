import { Suspense } from "react";

import { APP_MARKETS_PATH, appPageWords, buildAppMarketsMetadata, localizedUrl } from "@/app/seo";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { breadcrumbList, itemList, jsonLdScript, webPage } from "@/lib/site/structured-data";
import { companyShelf } from "@/lib/stocks/shelf";
import { readStockUniverse } from "@/lib/stocks/universe.server";

import { MarketsPlace } from "./markets-place";

export const dynamic = "force-dynamic";
export const revalidate = 0;
/* A cold read of the catalogue can take seconds; the page is sent at once
   and the lists stream in behind fallbacks of their own shape. */
export const maxDuration = 60;

/* Markets is offered to the index in both languages: its own words, its
   card, its canonical without the tab. */
export async function generateMetadata() {
  return buildAppMarketsMetadata(await solanaServerLocale());
}

/** Ринки — the second of the five places, the same for every person and every guest, in tabs; `?tab=` opens one. */
export default async function MarketsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [locale, params] = await Promise.all([solanaServerLocale(), searchParams]);
  const tab = typeof params.tab === "string" ? params.tab : null;
  return (
    <>
      <Suspense fallback={null}>
        <MarketsGraph locale={locale} />
      </Suspense>
      <MarketsPlace locale={locale} tab={tab} />
    </>
  );
}

/**
 * Markets' structured data: a collection of the shelf's companies — the
 * listed ones, then the private ones — each by its name and its page's
 * address in the page's language, never with a price. It streams with the
 * catalogue the server keeps warm; where the catalogue is silent, the page
 * says what it is without the list.
 */
async function MarketsGraph({ locale }: { locale: WorkspaceLocale }) {
  const url = localizedUrl(APP_MARKETS_PATH, locale);
  const words = appPageWords("markets", locale);
  const read = await readStockUniverse();
  const shelf = read.ok ? companyShelf(read.universe) : null;
  const companies = shelf ? [...shelf.companies, ...shelf.privateCompanies].map((card) => ({ name: card.name, url: localizedUrl(`/app/stocks/${card.ticker}`, locale) })) : [];
  const graph = [
    webPage({ type: "CollectionPage", url, name: words.title, description: words.description, locale, crumbs: [], ...(companies.length ? { extra: { mainEntity: itemList(url, companies) } } : {}) }),
    breadcrumbList(url, [
      { name: "Ryntra", url: localizedUrl("/", locale) },
      { name: locale === "uk" ? "Ринки" : "Markets", url },
    ]),
  ];
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />;
}
