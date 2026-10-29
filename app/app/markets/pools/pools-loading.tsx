"use client";

import { Block, Page, Skeleton } from "@ryntra/core/ui";
import Link from "next/link";

import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";

import { CatalogSkeleton } from "./pools-catalog";
import { poolsWords } from "./pools-words";
import styles from "./pools.module.css";

/*
 * «Пули» while the server reads the chain (B15): the page's own frame — its heading, its blocks in their places, each
 * block's bars — from the first paint, never a bare «Завантаження…» under the tabs. Next shows these as each route's
 * `loading.tsx` the moment a link is pressed; the figures fill the same places when they come.
 */

function useWords() {
  const { locale } = useSolanaI18n();
  return { word: poolsWords(locale), lang: locale === "uk" ? ("uk" as const) : ("en" as const) };
}

/** The catalogue: its heading, the toolbar and the table's rows over the whole width — the side column of positions stands
    only beside a wallet, which is not known yet (B17). */
export function PoolsCatalogLoading() {
  const { word, lang } = useWords();
  return (
    <Page kind="overview" className={styles.catalogPage} title={word("title")} lang={lang}>
      <CatalogSkeleton label={word("loadingCatalog")} />
    </Page>
  );
}

/** One pool: the way back, the heading's place, the facts, the distribution and the simulator in their own blocks. */
export function PoolLoading() {
  const { word, lang } = useWords();
  return (
    <Page
      kind="overview"
      className={styles.page}
      title={<span className={styles.bone} style={{ display: "inline-block", width: 180, height: 28, verticalAlign: "middle" }} aria-label={word("loadingPool")} />}
      lang={lang}
      action={<span className={styles.bone} style={{ display: "inline-block", width: 160, height: 40 }} aria-hidden />}
      aside={
        <Block title={word("myPositionsHere")} titleAs="h2" icon="wallet" lang={lang} data-pools="positions">
          <Skeleton lines={3} label={word("loadingPositions")} />
        </Block>
      }
      aria-busy="true"
      data-surface-state="LOADING"
    >
      <Link href="/app/markets/pools" className={styles.back}>
        ← {word("back")}
      </Link>
      <Block title={word("facts")} titleAs="h2" icon="chart-column" lang={lang} data-pools="facts">
        <Skeleton hero lines={6} label={word("loadingPool")} />
      </Block>
      <Block title={word("distribution")} titleAs="h2" icon="chart-column" lang={lang} data-pools="distribution">
        <span className={styles.bone} style={{ height: 180 }} />
      </Block>
      <Block title={word("simulator")} titleAs="h2" icon="chart-column" lang={lang} data-pools="simulator">
        <Skeleton lines={3} label={word("loadingPool")} />
      </Block>
    </Page>
  );
}

/** «Додати ліквідність»: the action page's one column with the form's place in it. */
export function AddLiquidityLoading() {
  const { word, lang } = useWords();
  return (
    <Page kind="action" className={styles.page} title={word("addTitle")} lang={lang} aria-busy="true" data-surface-state="LOADING">
      <Skeleton hero lines={6} label={word("loadingPool")} />
    </Page>
  );
}

/** A position's page: the action column under its own heading. */
export function ManagePositionLoading() {
  const { word, lang } = useWords();
  return (
    <Page kind="action" className={styles.page} title={word("manageTitle")} lang={lang} aria-busy="true" data-surface-state="LOADING">
      <Skeleton hero lines={4} label={word("loadingPositions")} />
    </Page>
  );
}
