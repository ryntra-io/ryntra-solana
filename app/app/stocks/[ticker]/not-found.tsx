import Link from "next/link";

import { INVEST_WORDS } from "@/app/app/invest/invest-words";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import { wordsFor } from "../stock-model";
import styles from "../stocks.module.css";
import { MissingTicker } from "./missing-ticker";

/**
 * An unknown ticker inside the product (`RYN-FIRST-SCREEN-001`): the
 * product's rail, header, type and language around one composed panel —
 * what happened, the way back to the list, and Spot for a token the list
 * does not carry. Never the framework's bare page.
 */
export default async function StockNotFound() {
  const locale = await solanaServerLocale();
  const word = wordsFor(locale);
  return (
    <section className={styles.page} aria-labelledby="missing-title">
      <p className={styles.crumbs}>
        {/* A company lives in Markets, so the way back is Markets (canon v5.3 В28). */}
        <Link href="/app/markets" prefetch={false}>
          {INVEST_WORDS.marketsTitle[locale]}
        </Link>
        <MissingTicker />
      </p>
      <div className={`${styles.card} ${styles.missing}`} role="status">
        <h1 id="missing-title">{word("notFoundTitle")}</h1>
        <p>{word("notFoundBody")}</p>
        <div className={styles.missingActions}>
          <Link className="rw-btn rw-btn--primary" href="/app/stocks" prefetch={false}>
            {word("browseStocks")}
          </Link>
          <Link className="rw-btn" href="/app/spot?view=stock" prefetch={false}>
            {word("openSpot")}
          </Link>
        </div>
      </div>
    </section>
  );
}
