import Image from "next/image";
import Link from "next/link";

import { GROUP_LABELS, PRODUCT_GROUP_IDS } from "@/app/shell/domains";
import product from "@/app/product/product.module.css";
import type { PublicCopy } from "@/lib/site/public-copy";
import type { PublicLocale } from "@/lib/site/locale";

import styles from "./landing.module.css";

/*
 * Scene 2 — the product, photographed rather than drawn.
 *
 * It replaced `HomeScene`, which sold `Ryntra Home` at `/app` as one of two
 * flagships and illustrated it with a console showing a portfolio belonging to
 * nobody. Two things ended that scene. The cabinet is not the product — the One
 * Ryntra decision of 2026-09-04 made the six-domain shell on Solana Mainnet the
 * thing a customer opens — and a drawn console is a picture of an idea where a
 * screenshot of the real thing was available all along.
 *
 * The four groups come from `app/shell/domains.ts`, which is where the product
 * structure is decided. A homepage that retyped them would be a second list, and
 * second lists disagree silently. The groups rather than the eleven pages: this
 * row is a summary of what the product is, and eleven chips is a menu.
 */
export function ProductScene({ copy, locale }: { copy: PublicCopy; locale: PublicLocale }) {
  return (
    <section className={`${styles.section} ${styles.sectionHome}`} id="product" data-ry-ground="midnight">
      <div className={styles.wrap}>
        <div className={styles.centred}>
          <div className={styles.centredCopy}>
            <p className={styles.eyebrow}>{copy.productEyebrow}</p>
            <h2 className={`${styles.h2} ${styles.h2Home}`}>{copy.productHeadline}</h2>
            <p className={styles.lead}>{copy.productLead}</p>
          </div>
        </div>

        <div className={product.shot}>
          <Image
            src="/product/markets.png"
            alt={copy.productShotAlt}
            width={3200}
            height={1800}
            sizes="(max-width: 1240px) 100vw, 1160px"
            priority
          />
        </div>

        <div className={product.facts}>
          {PRODUCT_GROUP_IDS.map((id) => (
            <span className={product.fact} key={id}>
              {GROUP_LABELS[id][locale === "uk" ? "uk" : "en"]}
            </span>
          ))}
        </div>

        <div className={styles.btnRow}>
          <Link className={styles.btnPrimary} href="/solana/workspace">
            {copy.navOpen}
          </Link>
          <Link className={styles.btnGhost} href="/product">
            {copy.productMore}
          </Link>
        </div>
      </div>
    </section>
  );
}
