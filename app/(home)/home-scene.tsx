import Link from "next/link";

import type { PublicCopy } from "@/lib/site/public-copy";

import { HomeConsole } from "./home-console";
import styles from "./landing.module.css";

/*
 * Scene 2 — Ryntra Home, shown rather than described.
 *
 * One product panel with three areas behind tabs; the prose that used to sit
 * in three text cards is now the one-line lead of the tab it described. The
 * CTA opens the real workspace.
 */

export function HomeScene({ copy }: { copy: PublicCopy }) {
  return (
    <section className={`${styles.section} ${styles.sectionHome}`} id="product" data-ry-ground="midnight">
      <div className={styles.wrap}>
        <div className={styles.centred}>
          <div className={styles.centredCopy}>
            <p className={styles.eyebrow}>{copy.homeEyebrow}</p>
            <h2 className={`${styles.h2} ${styles.h2Home}`}>{copy.homeHeadline}</h2>
            <p className={styles.lead}>{copy.homeLead}</p>
            <p className={styles.acDemo}>{copy.homeDemo}</p>
          </div>
        </div>

        {/* One marker above the panel says Interactive demo; the corner does
            not repeat it — a product that keeps calling itself illustrative
            reads as a prototype. */}
        <div className={`${styles.panelFrame} ${styles.homeFrame} ${styles.homeFramePlus}`}>
          <div className={styles.panelBar}>
            <span className={styles.panelBarName}>RYNTRA HOME</span>
            <span className={styles.panelBarSpacer} />
          </div>

          <div className={styles.homePad}>
            <HomeConsole copy={copy} />
          </div>
        </div>

        <div className={styles.btnRow}>
          <Link className={styles.btnPrimary} href="/app">
            {copy.homeCta}
          </Link>
        </div>
      </div>
    </section>
  );
}
