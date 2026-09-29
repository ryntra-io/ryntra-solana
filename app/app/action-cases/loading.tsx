import styles from "./decisions.module.css";

/**
 * The loading state, as reserved geometry.
 *
 * No case from an earlier read is on this screen — only the shape one will
 * occupy. A decision queue that shows its last result while fetching the next
 * is the most convincing way to tell a reader that nothing is waiting on them,
 * and it is the exact defect this state exists to prevent.
 *
 * The pulse sits behind `prefers-reduced-motion` in the stylesheet, so with
 * motion reduced this is a still, correctly sized placeholder rather than
 * nothing at all.
 */
export default function DecisionsLoading() {
  return (
    <div className={styles.surface} data-surface-state="LOADING" aria-busy="true">
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Ryntra Home</p>
          <h1>Decisions</h1>
        </div>
      </header>

      <section className={styles.book} aria-label="Loading the decision queue">
        <ul className={styles.cases}>
          {["one", "two", "three"].map((key) => (
            <li key={key} className={`${styles.skeleton} ${styles.skeletonRow}`} />
          ))}
        </ul>
      </section>

      <section className={styles.book} aria-label="Loading the exact actions">
        <div className={styles.facts}>
          {["context", "authority", "cases"].map((key) => (
            <div key={key} className={styles.fact}>
              <p className={`${styles.skeleton} ${styles.skeletonLine}`} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
