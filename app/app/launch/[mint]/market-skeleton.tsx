"use client";

import { Block, Skeleton } from "@ryntra/core/ui";
import type { ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";

import { coreLang } from "../launch-blocks";
import { launchWords } from "../launch-words";
import styles from "../launch.module.css";

/**
 * The market's skeleton in the market's own shape: the price block with
 * the line of what is worth a look, the chart's box at the chart's height, the trade beside it, the sections' bar and
 * the first section — each placeholder at the height its block takes once the figures come, so nothing below moves
 * when they do. The route's own skeleton (`loading.tsx`) draws the same, without the token's blocks.
 */
export function TokenMarketSkeleton({ locale, symbol, slots }: { locale: WorkspaceLocale; symbol: string | null; slots?: Partial<Readonly<{ head: ReactNode; share: ReactNode; about: ReactNode; offer: ReactNode }>> }) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  return (
    <div className={styles.tokenLayout} aria-busy="true" data-market-skeleton>
      <div className={styles.headSlot}>
        {slots?.head}
        <div className={styles.priceSkeleton}>
          <Skeleton hero lines={2} label={word("marketReading")} />
        </div>
        <div className={styles.stripSkeleton} aria-hidden />
      </div>
      <Block title={word("chartTitle")} titleAs="h2" icon="chart-line" lang={lang} className={styles.slotChart} aria-live="polite">
        <div className={styles.legendSkeleton} aria-hidden />
        <div className={styles.chartCanvas}>
          <span className={styles.chartPlaceholder} aria-hidden />
        </div>
      </Block>
      <div className={styles.asideCol}>
        {slots?.offer ? <div className={styles.slotOffer}>{slots.offer}</div> : null}
        <div className={styles.slotTrade}>
          <Block title={symbol ? word("tradeJump", { symbol }) : word("buy")} titleAs="h2" lang={lang} className={styles.tradeCard}>
            <div className={styles.tradeSkeleton}>
              <Skeleton lines={4} label={word("marketReading")} />
            </div>
          </Block>
        </div>
        <p className={styles.noGuarantee}>{word("noGuarantee")}</p>
        <div className={styles.slotShare}>{slots?.share ?? <div className={styles.shareSkeleton} aria-hidden />}</div>
      </div>
      <div className={styles.mainCol}>
        <div className={styles.tabsSkeleton} aria-hidden />
        <div className={styles.sectionPanel}>
          <div className={styles.engineSkeleton}>
            <Block title={word("engineTitle")} titleAs="h2" lang={lang} loading />
          </div>
          {slots?.about ? <div className={styles.slotAbout}>{slots.about}</div> : null}
        </div>
      </div>
    </div>
  );
}
