"use client";

import Link from "next/link";

import type { WorkspaceLocale } from "@/app/shell/locale";

import { AccountCard } from "./account-card";
import styles from "./predictions.module.css";
import { usePaperAccount } from "./use-paper-account";
import { wordsFor } from "./words";

/**
 * *Paper Predictions* on the Portfolio page (`RYN-PREDICTIONS-001` item 18):
 * the paper account in its own section, under its own heading, with the one
 * sentence that matters — nothing here is part of the real portfolio total.
 * A guest sees nothing (the page above already asks for the wallet); a
 * proven wallet without a paper account sees how to enable one.
 */
export function PaperPortfolioSection({ locale }: { locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const account = usePaperAccount();
  if (account.state.status === "guest") return null;
  return (
    <section className={styles.page} aria-labelledby="paper-predictions-title" style={{ marginTop: "var(--ry-s4)" }}>
      <header className={styles.head}>
        <div className={styles.headTitle}>
          <h2 id="paper-predictions-title" style={{ margin: 0, fontSize: "var(--ry-fs-dense)", fontWeight: 700, color: "var(--ry-text)" }}>
            {locale === "uk" ? "Paper-прогнози" : "Paper Predictions"}
          </h2>
          <p className={styles.tagline}>{locale === "uk" ? "Симульовані кошти — не входять у суму вашого портфеля." : "Simulated funds — never part of your portfolio total."}</p>
        </div>
        <div className={styles.actions}>
          <Link className="rw-btn" href="/app/predictions" prefetch={false}>
            {word("title")}
          </Link>
        </div>
      </header>
      <AccountCard account={account} locale={locale} />
    </section>
  );
}
