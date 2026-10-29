import Link from "next/link";

import { payCopy } from "@/lib/site/pay-copy";
import { publicServerLocale } from "@/lib/site/server-locale";

import { PayBrand } from "../pay-brand";
import styles from "../pay.module.css";

/** A wrong or retired link says so in the payer's words, and offers nothing else. */
export default async function PayNotFound() {
  const copy = payCopy(await publicServerLocale());
  return (
    <main className={styles.page} id="main-content">
      <div className={styles.frame}>
        <header className={styles.top}>
          <PayBrand />
        </header>
        <section className={styles.missing}>
          <h1>{copy.notFoundTitle}</h1>
          <p>{copy.notFoundBody}</p>
          <Link className={styles.secondary} href="/">{copy.aboutRyntra}</Link>
        </section>
      </div>
    </main>
  );
}
