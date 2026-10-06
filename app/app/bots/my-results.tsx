"use client";

import { ResultsPanel } from "@/app/app/results/results-panel";
import type { WorkspaceLocale } from "@/app/shell/locale";

import { botsWords } from "./bots-words";
import styles from "./bots.module.css";

/**
 * What the plans did, in «Мої боти»: every operation made under a plan, the
 * positions they add up to, the plans that made no trade and the rule that
 * refused them, and the memory of facts each citing its record — the panel
 * that was the Results page. Embedded: it draws nothing — no second gate, no
 * second «confirm», no empty state — until a confirmed wallet has results.
 */
export function MyResults({ locale }: { locale: WorkspaceLocale }) {
  const word = botsWords(locale);
  return (
    /* No box of its own: when the panel has nothing to show, nothing stands in the page — not even a gap. */
    <div style={{ display: "contents" }}>
      <ResultsPanel
        locale={locale}
        embedded
        head={
          <div className={styles.blockHead}>
            <h2 id="bots-results" className={styles.blockTitle}>{word("results")}</h2>
            <p className={styles.blockNote}>{word("resultsLead")}</p>
          </div>
        }
      />
    </div>
  );
}
