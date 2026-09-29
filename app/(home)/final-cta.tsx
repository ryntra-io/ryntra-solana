import Link from "next/link";

import type { PublicCopy } from "@/lib/site/public-copy";

import styles from "./landing.module.css";

/*
 * Scene 5 — the closing scene. The claim, the two doors, and one faint echo
 * of the decision signal above the headline so the page ends where it began:
 * evidence to receipt. No third trust essay, no second dashboard.
 */

export function FinalCta({ copy }: { copy: PublicCopy }) {
  const signalNodes = [
    copy.heroEvidenceLabel,
    copy.heroRiskLabel,
    copy.heroStepAuth,
    `${copy.heroReceiptWord} ✓`,
  ];

  return (
    <section className={`${styles.section} ${styles.ctaScene}`} id="cta" data-ry-ground="midnight">
      <div className={styles.ctaHalo} aria-hidden="true" />

      <div className={styles.ctaInner}>
        <div className={styles.ctaSignal} aria-hidden="true">
          <div className={styles.heroSignalTrack} />
          <div className={styles.heroSignalNodes}>
            {signalNodes.map((node) => (
              <span key={node} className={styles.heroSignalNode}>
                {node}
              </span>
            ))}
          </div>
        </div>

        <h2 className={styles.ctaHeadline}>
          {copy.ctaLine1}
          <br />
          {copy.ctaLine2}
          <br />
          <span className={styles.accent}>{copy.ctaLine3}</span>
        </h2>

        <div className={styles.ctaActions}>
          <Link className={`${styles.btnPrimary} ${styles.btnHero}`} href="/solana/workspace">
            {copy.navOpen}
          </Link>
          <Link className={`${styles.btnGhost} ${styles.btnHero}`} href="/agents/workspace">
            {copy.navAgents}
          </Link>
        </div>
      </div>
    </section>
  );
}
