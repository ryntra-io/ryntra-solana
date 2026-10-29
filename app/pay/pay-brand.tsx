import { RyntraBrand } from "@/app/brand/ryntra-brand";

import styles from "./pay.module.css";

/** The payer page's one identity: the brand lockup from `app/brand/`, never a lettered tile (SOL-C3). */
export function PayBrand() {
  return (
    /* A whole page load, not a client navigation: /pay carries the core's stylesheets (SOL-C14), «/» its own. */
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a className={styles.brand} href="/">
      <RyntraBrand size={20} />
    </a>
  );
}
