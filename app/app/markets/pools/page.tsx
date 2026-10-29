import type { Metadata } from "next";
import { Suspense } from "react";

import { HonestStateChip } from "@/app/shell/honest-state-chip";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { authorityViews } from "@/lib/core/authority-matrix";
import { ENFORCEMENT_WORDS, MODE_WORDS } from "@/lib/core/authority-words";
import { cleanSearch, isCatalogView, type CatalogView } from "@/lib/liquidity/catalog/model";
import { readPoolCatalog } from "@/lib/liquidity/catalog/service.server";

import { Page } from "../../launch/launch-core";
import { CatalogSkeleton, PoolsCatalog } from "./pools-catalog";
import { MyPositions } from "./my-positions";
import { poolsWords } from "./pools-words";
import styles from "./pools.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function generateMetadata(): Promise<Metadata> {
  const word = poolsWords(await solanaServerLocale());
  return { title: word("title"), description: word("lead") };
}

/**
 * «Ринки → Пули»: the catalogue of Meteora DLMM and DAMM v2 pools — read
 * only — with the wallet's own positions beside it. `?q=` searches all of
 * Meteora, `?venue=` opens a venue's tab. The heading is for a screen reader
 * (the menu names the page): the first thing seen is the one row of choices
 * and then the rows (B17). Above them, one line from the authority matrix (EXE-1): whether pool actions are open
 * here for each venue, who signs and who holds the bound — DLMM and DAMM v2 share the one gate, not one proof.
 */
export default async function PoolsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [locale, params] = await Promise.all([solanaServerLocale(), searchParams]);
  const word = poolsWords(locale);
  const search = cleanSearch(params.q);
  const view: CatalogView = isCatalogView(params.venue) ? params.venue : "all";
  const actions = authorityViews(["meteora-dlmm.liquidity", "meteora-damm2.liquidity"]);
  const dlmm = actions["meteora-dlmm.liquidity"];
  return (
    <Page kind="overview" className={styles.catalogPage} title={word("title")} lang={locale === "uk" ? "uk" : "en"} aside={<MyPositions locale={locale} />}>
      <p className={styles.authority}>
        {/* Each venue its own state: the catalogue lists DLMM and DAMM v2 pools, and only DLMM's cycle is proven. */}
        <span className={styles.authorityVenue} data-authority="meteora-dlmm.liquidity" title="Meteora DLMM">
          {word("kindStepped")} <HonestStateChip state={dlmm.state} locale={locale} />
        </span>
        <span className={styles.authorityVenue} data-authority="meteora-damm2.liquidity" title="Meteora DAMM v2">
          {word("kindSmooth")} <HonestStateChip state={actions["meteora-damm2.liquidity"].state} locale={locale} />
        </span>
        <span>
          {MODE_WORDS[dlmm.mode][locale]}. {ENFORCEMENT_WORDS[dlmm.enforcement][locale]}.
        </span>
      </p>
      <Suspense key={search ?? ""} fallback={<CatalogSkeleton />}>
        <CatalogData locale={locale} search={search} view={view} />
      </Suspense>
    </Page>
  );
}

async function CatalogData({ locale, search, view }: { locale: WorkspaceLocale; search: string | null; view: CatalogView }) {
  const catalog = await readPoolCatalog(search);
  return <PoolsCatalog catalog={catalog} locale={locale} initialView={view} />;
}
