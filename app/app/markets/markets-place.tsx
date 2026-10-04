import { Suspense } from "react";

import styles from "@/app/app/invest/invest.module.css";
import { placePages } from "@/app/shell/domains";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { PRODUCT_ROUTES } from "@/app/shell/product-routes";
import { coinShelf, memeShelf, USDC_MINT, USDT_MINT } from "@/lib/spot/coin-shelf";
import { toListRow } from "@/lib/spot/markets";
import { listSpotMarkets, readSpotMarket } from "@/lib/spot/markets.server";
import { shelfCompanies, shelfPrivateCompanies } from "@/lib/stocks/shelf";
import { readStockUniverse } from "@/lib/stocks/universe.server";

import {
  CoinSections,
  CoinsFailed,
  CoinsSkeleton,
  CoinsSlot,
  CompaniesFailed,
  CompaniesSections,
  CompaniesSkeleton,
  CompaniesSlot,
  MarketsTabs,
  MemeSections,
  MemesFailed,
  MemesSkeleton,
  MemesSlot,
  type ExperiencedTool,
} from "./markets-surface";
import { isMarketsTab, type MarketsTab } from "./tabs";

/** Coins carried to the browser: «Усі» shows six, the Crypto tab «Показати ще» the rest of these. */
const CRYPTO_CARRIED = 60;
/** Memes carried to the browser, for the Memes tab. */
const MEMES_CARRIED = 60;

/**
 * Ринки — the second of the five places, at `/app/markets` and at
 * `/app/stocks` too: the title, the tabs and «Для досвідчених» at once — the
 * pages the registry puts in Markets (`PLACE_PAGES`), drawn from it rather
 * than written here — and the companies, the coins and the memes streaming
 * in behind fallbacks of their own shape.
 */
export function MarketsPlace({ locale, tab = "all" }: { locale: WorkspaceLocale; tab?: string | null }) {
  const tools: ExperiencedTool[] = placePages("markets", PRODUCT_ROUTES, locale).map((page) => ({ id: page.id, label: page.label, href: page.href }));
  const initialTab: MarketsTab = isMarketsTab(tab) ? tab : "all";
  return (
    <div className={`${styles.page} ${styles.wide}`}>
      <MarketsTabs locale={locale} tools={tools} initialTab={initialTab}>
        <CompaniesSlot locale={locale}>
          <Suspense fallback={<CompaniesSkeleton locale={locale} />}>
            <Companies locale={locale} />
          </Suspense>
        </CompaniesSlot>
        <CoinsSlot locale={locale}>
          <Suspense fallback={<CoinsSkeleton locale={locale} />}>
            <Coins locale={locale} />
          </Suspense>
        </CoinsSlot>
        <MemesSlot locale={locale}>
          <Suspense fallback={<MemesSkeleton locale={locale} />}>
            <Memes locale={locale} />
          </Suspense>
        </MemesSlot>
      </MarketsTabs>
    </div>
  );
}

async function Companies({ locale }: { locale: WorkspaceLocale }) {
  const read = await readStockUniverse();
  if (!read.ok) return <CompaniesFailed locale={locale} />;
  return <CompaniesSections data={{ companies: shelfCompanies(read.universe.rows), privateCompanies: shelfPrivateCompanies(read.universe.rows) }} locale={locale} />;
}

async function Coins({ locale }: { locale: WorkspaceLocale }) {
  /* The ranked crypto list sinks the dollar tokens below everything else, so
     the two dollars are read by their own address — each from the registry's
     fifteen-second cache — rather than hoped for at the bottom of a list. */
  const [read, ...dollars] = await Promise.all([listSpotMarkets("crypto", 400), ...[USDC_MINT, USDT_MINT].map((mint) => readSpotMarket(mint))]);
  const dollarRows = dollars.flatMap((answer) => (answer.ok && answer.market ? [toListRow(answer.market)] : []));
  if (!read.ok && dollarRows.length === 0) return <CoinsFailed locale={locale} />;
  const shelf = coinShelf([...(read.ok ? read.rows : []), ...dollarRows]);
  return <CoinSections data={{ dollars: shelf.dollars, crypto: shelf.crypto.slice(0, CRYPTO_CARRIED) }} locale={locale} />;
}

async function Memes({ locale }: { locale: WorkspaceLocale }) {
  /* The same ranked reads Spot and Trends keep warm; the venue's verified
     memes only, by the day's volume, the risk said before any figure. */
  const read = await listSpotMarkets("meme", 200);
  if (!read.ok) return <MemesFailed locale={locale} />;
  return <MemeSections data={{ memes: memeShelf(read.rows).slice(0, MEMES_CARRIED) }} locale={locale} />;
}
