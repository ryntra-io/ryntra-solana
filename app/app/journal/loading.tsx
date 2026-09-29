import styles from "./journal.module.css";

/**
 * The loading state, as reserved geometry.
 *
 * No cycle from an earlier read is on this screen — only the shape one will
 * occupy. A journal that shows last week's entries while fetching this week's
 * is the most convincing way to tell a reader that nothing has happened.
 *
 * The pulse sits behind `prefers-reduced-motion` in the stylesheet, so with
 * motion reduced this is a still, correctly sized placeholder rather than
 * nothing at all.
 */
export default function JournalLoading() {
  return (
    <div className={styles.surface} data-surface-state="LOADING" aria-busy="true">
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Review</p>
          <h1>Journal</h1>
        </div>
      </header>

      <ul className={styles.stages} aria-label="Loading the cycle">
        {["plan", "decision", "outcome", "conclusion"].map((key) => (
          <li key={key} className={styles.stage}>
            <p className={`${styles.skeleton} ${styles.skeletonLine}`} />
          </li>
        ))}
      </ul>

      <ul className={styles.cycles} aria-label="Loading the cycles">
        {["one", "two", "three"].map((key) => (
          <li key={key} className={`${styles.skeleton} ${styles.skeletonRow}`} />
        ))}
      </ul>
    </div>
  );
}
