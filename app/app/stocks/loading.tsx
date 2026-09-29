import { StocksSkeleton } from "./stocks-skeleton";
import styles from "./stocks.module.css";

/** The segment's loading state — the head's shapes, then the page's own skeleton. */
export default function StocksLoading() {
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <span className={styles.bone} style={{ width: 120, height: 28 }} />
        <span className={styles.bone} style={{ width: 240, height: 44 }} />
      </div>
      <StocksSkeleton />
    </div>
  );
}
