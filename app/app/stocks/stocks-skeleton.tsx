import styles from "./stocks.module.css";

const ROWS = 10;

/**
 * The stock surface before its figures: the same shapes the page draws —
 * the strip of instruments and the table's rows — so what arrives fills in
 * rather than jumps in. One skeleton serves Discover, the screener and the
 * asset page; the page's own Suspense boundary shows the same shapes while
 * the universe streams behind the head.
 */
export function StocksSkeleton() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite" data-surface-state="LOADING">
      <div className={`${styles.card} ${styles.strip}`}>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className={styles.metric}>
            <span className={styles.bone} style={{ width: "40%", height: 10 }} />
            <span className={styles.bone} style={{ width: "62%", height: 22 }} />
            <span className={styles.bone} style={{ width: "50%", height: 10 }} />
          </div>
        ))}
      </div>
      <div className={styles.card}>
        <div className={styles.toolbar}>
          <span className={styles.bone} style={{ width: 280, height: 40 }} />
          <span className={styles.bone} style={{ width: 360, height: 34, marginInlineStart: "auto" }} />
        </div>
        <div className={styles.boneRows}>
          {Array.from({ length: ROWS }, (_, index) => (
            <div key={index} className={styles.boneRow}>
              <span className={styles.boneStock}>
                <span className={`${styles.bone} ${styles.boneIcon}`} />
                <span className={styles.bone} style={{ width: `${34 + ((index * 7) % 30)}%`, height: 12 }} />
              </span>
              {Array.from({ length: 5 }, (_, column) => (
                <span key={column} className={styles.bone} style={{ width: `${44 + ((index + column) * 9) % 40}%`, height: 12, marginInlineStart: "auto" }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
