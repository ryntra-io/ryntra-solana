import Link from "next/link";

import { INVEST_WORDS } from "@/app/app/invest/invest-words";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import { wordsFor } from "../stock-model";
import styles from "../stocks.module.css";
import { MissingTicker } from "./missing-ticker";

/**
 * An unknown ticker inside the product: the product's rail, header, type and
 * language around one composed panel — what happened, the way back to the
 * list, and Spot for a token the list does not carry. Never the framework's
 * bare page.
 */
export default async function StockNotFound() {
  const locale = await solanaServerLocale();
  const word = wordsFor(locale);
  return (
    <section className={styles.page} aria-labelledby="missing-title">
      <p className={styles.crumbs}>
        {/* A company lives in Markets, so the way back is Markets. */}
        <Link href="/app/markets" prefetch={false}>
          {INVEST_WORDS.marketsTitle[locale]}
        </Link>
        <MissingTicker />
      </p>
      <div className={`${styles.card} ${styles.missing}`} role="status">
        <h1 id="missing-title">{word("notFoundTitle")}</h1>
        <p>{word("notFoundBody")}</p>
        <div className={styles.missingActions}>
          <Link className="ryntra-button ryntra-button--primary" href="/app/markets?tab=stocks" prefetch={false}>
            <span className="ryntra-button__label">{word("browseStocks")}</span>
          </Link>
          <Link className="ryntra-button ryntra-button--secondary" href="/app/spot?view=stock" prefetch={false}>
            <span className="ryntra-button__label">{word("openSpot")}</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
