"use client";

import { ArrowLeft } from "@phosphor-icons/react";
import { NAV_WORDS } from "@ryntra/core/nav";
import { Block, Page, Skeleton } from "@ryntra/core/ui";
import Link from "next/link";

import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";

import { TokenMarketSkeleton } from "./[mint]/market-skeleton";
import { launchWords } from "./launch-words";
import styles from "./launch.module.css";

/*
 * «Лаунч» while the server reads the chain (B15): a launched token's page reads its record and the chain before it can
 * name the token, so until then the page stands in its own shape — the way back, the heading's place, the market and
 * the trade's places — rather than a bare «Завантаження…».
 */

/** A launched token's page: the way back to every launch, the heading's place, the market and the trade beside it. */
export function LaunchTokenLoading() {
  const { locale } = useSolanaI18n();
  const word = launchWords(locale);
  const lang = locale === "uk" ? ("uk" as const) : ("en" as const);
  /* The heading's place at the heading's height — the token's picture is 40 px — and the market in its own shape (SOL-P1). */
  return (
    <div className={styles.page} aria-busy="true" data-surface-state="LOADING">
      <Link className={styles.backLink} href="/app/launch/markets" prefetch={false}>
        <ArrowLeft size={14} aria-hidden /> {word("marketsAll")}
      </Link>
      <Page
        kind="overview"
        className={styles.corePage}
        lang={lang}
        title={<span className={`${styles.skeletonTitle} ${styles.skeletonTokenTitle}`} aria-label={word("marketReading")} />}
        lead={<span className={styles.skeletonLead} aria-hidden />}
      >
        <TokenMarketSkeleton locale={locale} symbol={null} />
      </Page>
    </div>
  );
}

/** «Лаунчі на Ryntra»: the heading and the table's place. */
export function LaunchMarketsLoading() {
  const { locale } = useSolanaI18n();
  const word = launchWords(locale);
  const lang = locale === "uk" ? ("uk" as const) : ("en" as const);
  return (
    <Page kind="overview" className={styles.corePage} title={NAV_WORDS[locale].items.launch} lang={lang} aria-busy="true" data-surface-state="LOADING">
      <Block title={word("marketsTable")} titleAs="h2" icon="chart-column" lang={lang}>
        <Skeleton lines={6} label={word("marketsReading")} />
      </Block>
    </Page>
  );
}
