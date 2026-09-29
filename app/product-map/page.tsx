import Link from "next/link";

import { FrozenFooter, FrozenHeader } from "@/app/site/frozen/chrome";
import { productCopy } from "@/lib/site/product-copy";
import { PRODUCT_MAP_LABELS, productMapEntries, type ProductMapLabel } from "@/lib/site/product-map";
import { publicServerLocale } from "@/lib/site/server-locale";

import styles from "@/app/product/product.module.css";

export const revalidate = 3600;

/**
 * `/product-map` — the whole accepted direction, including what is not built.
 *
 * The owner's decision of 2026-09-04 draws the line this page exists on:
 * *working app navigation is only usable routes; the Product Map is the full
 * accepted direction.* The rail throws rather than render a destination with no
 * page — canon §0.7, after a rail of nineteen dead `Soon` rows — and this is
 * where the things that have no page yet are described properly, so that taking
 * them out of the menu never took them out of the product.
 *
 * Every card is projected from the capability registry. There is no array in
 * this file to add a capability to, which is the point: a hand-written public
 * list is the `Soon` defect with a larger audience.
 *
 * What no card carries: a task id, a canary word, or a date. The registry's
 * `gate` field names rows like `RYN-SOL-M4`, canon §0.5 keeps internal
 * vocabulary off customer surfaces, and nothing here is scheduled.
 */
export default async function ProductMapPage() {
  const locale = await publicServerLocale();
  const copy = productCopy(locale);
  const entries = productMapEntries(locale);

  const groups = PRODUCT_MAP_LABELS.map((label: ProductMapLabel) => ({
    label,
    rows: entries.filter((entry) => entry.label === label),
  })).filter((group) => group.rows.length > 0);

  return (
    <>
      <FrozenHeader mainId="main-content" />

      <main id="main-content" className={styles.page} tabIndex={-1}>
        <section className={styles.band}>
          <div className={styles.wrap}>
            <p className={styles.eyebrow}>{copy.mapEyebrow}</p>
            <h1 className={styles.title}>
              {copy.mapTitle} <span className={styles.accent}>{entries.length}</span>
            </h1>
            <p className={styles.lead}>{copy.mapLead}</p>

            <div className={styles.legend}>
              {groups.map((group) => (
                <span className={styles.legendItem} key={group.label}>
                  {copy.labels[group.label]}
                  <span className={styles.legendCount} translate="no">
                    {group.rows.length}
                  </span>
                </span>
              ))}
            </div>

            <p className={styles.shotCaption}>{copy.mapRailNote}</p>
          </div>
        </section>

        <section className={`${styles.band} ${styles.bandAlt}`}>
          <div className={styles.wrap}>
            {groups.map((group) => (
              <div className={styles.group} key={group.label}>
                <div className={styles.groupHead}>
                  <h2 className={styles.groupTitle}>{copy.labels[group.label]}</h2>
                  <p className={styles.groupNote}>{copy.labelNotes[group.label]}</p>
                </div>
                <div className={styles.cards}>
                  {group.rows.map((entry) => (
                    <div className={styles.card} key={entry.id}>
                      <div className={styles.cardHead}>
                        <h3 className={styles.cardName}>{entry.name}</h3>
                        <span className={styles.chip} data-label={entry.label}>
                          {copy.labels[entry.label]}
                        </span>
                      </div>
                      <p className={styles.cardBody}>{entry.blurb}</p>
                      {entry.href ? (
                        <Link className={styles.cardLink} href={entry.href}>
                          {copy.mapOpens}
                        </Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.band}>
          <div className={styles.wrap}>
            <div className={styles.actions}>
              <Link className={styles.primary} href="/solana/workspace">
                {copy.open}
              </Link>
              <Link className={styles.ghost} href="/product">
                {copy.title} {copy.titleAccent}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <FrozenFooter />
    </>
  );
}
