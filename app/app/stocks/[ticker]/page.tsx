import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { companyCard } from "@/app/brand/page-card";
import { APP_MARKETS_PATH, indexedPageMetadata, localizedUrl, pageCardImage } from "@/app/seo";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { companyCardInputOf, companyName, companyPagePath, companySeoInputOf, companyTicker, shelfTickers } from "@/lib/site/company-page";
import { companySearchDescription, companySearchTitle } from "@/lib/site/company-seo";
import { breadcrumbList, companyEntity, jsonLdScript, webPage } from "@/lib/site/structured-data";
import { readStockAsset } from "@/lib/stocks/asset.server";
import { lifecycleEventFor } from "@/lib/stocks/lifecycle-events";
import { retiredTokenFor } from "@/lib/stocks/retired";
import { findStockRow, type StockRow } from "@/lib/stocks/universe.server";

import { CompanyUnavailable, CompanyView, RetiredCompany } from "./company-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const TICKER = /^[A-Za-z0-9._-]{1,44}$/;

/**
 * A company page's words for a search result and a share: the company's name
 * first, never the token's; its address in the page's language, the Ukrainian
 * one at `/uk/app/stocks/…`; its own card. Offered to the index when its token
 * is the one the shelf's card opens — the rest of a company's tokens, an
 * unknown ticker and a retired one stay out, as the cabinet's layout says.
 */
export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw);
  if (!TICKER.test(ticker)) return { title: ticker };
  const retired = retiredTokenFor(ticker);
  if (retired) return { title: retired.symbol };
  const [found, locale] = await Promise.all([findStockRow(ticker), solanaServerLocale()]);
  const row = found.ok ? found.row : null;
  if (!found.ok || !row) return { title: ticker };
  const input = companySeoInputOf(row);
  return indexedPageMetadata({
    path: companyPagePath(row),
    locale,
    title: companySearchTitle(input, locale),
    description: companySearchDescription(input, locale),
    image: pageCardImage(locale, ["company", row.representation.symbol], companyCard(companyCardInputOf(row), locale)),
    index: shelfTickers(found.universe).has(row.representation.symbol),
  });
}

/** The page's structured data: a page about the company — never a product with a price — and where it sits under Markets. */
function CompanyGraph({ row, locale }: { row: StockRow; locale: "en" | "uk" }) {
  const input = companySeoInputOf(row);
  const url = localizedUrl(companyPagePath(row), locale);
  const name = companyName(row);
  const graph = [
    webPage({ url, name: companySearchTitle(input, locale), description: companySearchDescription(input, locale), locale, crumbs: [], about: companyEntity({ name, tickerSymbol: companyTicker(row) }) }),
    breadcrumbList(url, [
      { name: "Ryntra", url: localizedUrl("/", locale) },
      { name: locale === "uk" ? "Ринки" : "Markets", url: localizedUrl(APP_MARKETS_PATH, locale) },
      { name, url },
    ]),
  ];
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />;
}

/**
 * A company's page — one for everyone.
 *
 * The company by its name, a big price, a line chart, one line of truth, one
 * action — *Купити* and its sheet — and under *Деталі* every card the stock
 * desk's asset page carried: the market and the issuer's reference, what the
 * token is, the deal for an amount with the other representations compared,
 * the pools, the onchain activity and the risk card with the way into a plan,
 * Ryntra's Brief and Critic on request, and the chain facts
 * (`company-view.tsx`). The candles and the full ticket are Spot's, one press
 * from the chart. An unknown ticker lands on the product's own not-found page
 * (`not-found.tsx`); a token Ryntra no longer supports says so, and where it
 * can be sold.
 */
export default async function StockAssetPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw);
  if (!TICKER.test(ticker)) notFound();
  const locale = await solanaServerLocale();
  const retired = retiredTokenFor(ticker);
  if (retired) return <RetiredCompany locale={locale} token={retired} />;
  const read = await readStockAsset(ticker);
  if (!read.ok && read.code === "UNKNOWN_ASSET") notFound();
  if (!read.ok) return <CompanyUnavailable locale={locale} ticker={ticker} />;
  /* A token whose issuer opened a swap window: the listed token the swap goes into, read from the same universe — its price on the exchange and what it is, for the swap's Review. */
  const into = lifecycleEventFor(read.asset.row.representation.mint)?.watch?.into ?? null;
  const found = into ? await findStockRow(into.mint) : null;
  const target = found && found.ok ? found.row : null;
  /* «Шлях компанії»: the company's other token on the path — what it is (its issuer's fee) on this page's strip. */
  const path = read.asset.row.companyPath;
  const other = path?.steps.find((step) => step.step !== path.at && (step.step === "private" || step.step === "solana"))?.token ?? null;
  const otherRead = other && other.mint !== into?.mint ? await findStockRow(other.mint) : null;
  const counterpart = other && other.mint === into?.mint ? target : otherRead && otherRead.ok ? otherRead.row : null;
  return (
    <>
      <CompanyGraph row={read.asset.row} locale={locale} />
      <CompanyView locale={locale} asset={read.asset} target={target} counterpart={counterpart} nowMs={Date.now()} />
    </>
  );
}
