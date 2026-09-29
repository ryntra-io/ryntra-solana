import styles from "./research.module.css";

/**
 * The loading state, as reserved geometry.
 *
 * No change from an earlier read is on this screen — only the shape one will
 * occupy. A radar that shows its last result while fetching the next is the
 * most convincing way to tell a reader that nothing has happened, and it is the
 * exact defect this state exists to prevent.
 *
 * The pulse sits behind `prefers-reduced-motion` in the stylesheet, so with
 * motion reduced this is a still, correctly sized placeholder rather than
 * nothing at all.
 */
export default function ResearchLoading() {
  return (
    <div className={styles.surface} data-surface-state="LOADING" aria-busy="true">
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Ryntra Home</p>
          <h1>Research</h1>
        </div>
      </header>

      <section className={styles.rule} aria-label="Loading the Radar views">
        <ul className={styles.views}>
          {["a", "b", "c", "d", "e", "f"].map((key) => (
            <li key={key} className={`${styles.skeleton} ${styles.skeletonPill}`} />
          ))}
        </ul>
        <ul className={styles.changes}>
          {["one", "two", "three"].map((key) => (
            <li key={key} className={`${styles.skeleton} ${styles.skeletonRow}`} />
          ))}
        </ul>
      </section>

      <section className={styles.rule} aria-label="Loading the research mandate">
        <div className={styles.facts}>
          {["version", "state", "scope", "sources"].map((key) => (
            <div key={key} className={styles.fact}>
              <p className={`${styles.skeleton} ${styles.skeletonLine}`} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
