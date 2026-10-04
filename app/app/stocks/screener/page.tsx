import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Suspense } from "react";

import { INVEST_WORDS } from "@/app/app/invest/invest-words";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { readStockUniverse } from "@/lib/stocks/universe.server";

import { stripOf, toSlimRow, wordsFor } from "../stock-model";
import { StockScreener } from "../stock-screener";
import { StockSources, StockStripBar } from "../stock-strip";
import { StocksSkeleton } from "../stocks-skeleton";
import styles from "../stocks.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;
export const metadata = { title: "Stocks" };

const SPOT_STOCKS = "/app/spot?view=stock";

/**
 * Stocks — the screener, the tool Markets holds a tap deeper (one version for
 * everyone): the market strip — the US session, how many tokens are listed
 * and traded today, the issuers — over every confirmed representation with
 * the venue's figures, the issuer's reference and session where there is one,
 * filtered and sorted in the browser over the server's cached universe. The
 * desk's collections are its filters (traded, liquid, pre-IPO) and its
 * sortable columns (the day's gainers and losers). The executable quote for
 * an amount lives on a company's page and in Spot, never on four hundred rows
 * at once.
 */
export default async function StocksScreenerPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; kind?: string | string[] }> }) {
  const locale = await solanaServerLocale();
  const word = wordsFor(locale);
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const initialQuery = typeof raw === "string" ? raw.slice(0, 64) : "";
  /* `?kind=preipo` opens the screener on the pre-IPO instruments; anything else is the remembered filter. */
  const kindRaw = Array.isArray(params.kind) ? params.kind[0] : params.kind;
  const initialKind = kindRaw === "preipo" || kindRaw === "listed" ? kindRaw : "all";
  return (
    <section className={styles.page} aria-labelledby="screener-title">
      <header className={styles.head}>
        <div className={styles.headTitle}>
          {/* Stocks lives in Markets, so the way back is Markets. */}
          <p className={styles.crumbs}>
            <Link href="/app/markets" prefetch={false}>
              {INVEST_WORDS.marketsTitle[locale]}
            </Link>
            <span aria-hidden="true">/</span>
            <span>{word("title")}</span>
          </p>
          <h1 id="screener-title">{word("title")}</h1>
        </div>
        <div className={styles.actions}>
          <Link className="rw-btn rw-btn--primary" href={SPOT_STOCKS}>
            <span>{word("tradeInSpot")}</span>
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </Link>
        </div>
      </header>
      <Suspense fallback={<StocksSkeleton />}>
        <ScreenerBody locale={locale} initialQuery={initialQuery} initialKind={initialKind} />
      </Suspense>
    </section>
  );
}

async function ScreenerBody({ locale, initialQuery, initialKind }: { locale: WorkspaceLocale; initialQuery: string; initialKind: "all" | "listed" | "preipo" }) {
  const word = wordsFor(locale);
  const read = await readStockUniverse();
  if (!read.ok) {
    return (
      <div className={`${styles.card} ${styles.unavailable}`} role="status">
        <b>{word("unavailableTitle")}</b>
        <p>{word("unavailable")}</p>
        <Link className="rw-btn" href={SPOT_STOCKS}>
          {word("openSpot")}
        </Link>
      </div>
    );
  }
  const nowMs = Date.now();
  const rows = read.universe.rows.map((row) => toSlimRow(row, nowMs));
  const strip = stripOf(read.universe);
  return (
    <>
      <StockStripBar strip={strip} locale={locale} />
      <StockScreener rows={rows} locale={locale} initialQuery={initialQuery} initialKind={initialKind} sources={<StockSources locale={locale} catalogueDown={!read.universe.issuerCatalogue.ok} strip={strip} />} />
    </>
  );
}
