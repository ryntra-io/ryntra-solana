import styles from "@/app/app/home-surface.module.css";

/**
 * The loading state, as reserved geometry.
 *
 * No answer from an earlier read is on this screen — only the shape one will
 * occupy. A workbench that shows its last answer while fetching the next is the
 * most convincing way to tell a reader that a stale fact is current, and it is
 * the exact defect this state exists to prevent.
 */
export default function AdviserLoading() {
  return (
    <div className={styles.surface} data-surface-state="LOADING" aria-busy="true">
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Ryntra Home</p>
          <h1>Adviser</h1>
        </div>
      </header>

      <section aria-label="Loading the questions this account raised">
        <ul className={styles.questions}>
          {["one", "two", "three"].map((key) => (
            <li key={key} className={`${styles.skeleton} ${styles.skeletonRow}`} />
          ))}
        </ul>
      </section>

      <section aria-label="Loading the answer">
        <div className={styles.facts}>
          {["answer", "facts", "versions"].map((key) => (
            <div key={key} className={styles.fact}>
              <p className={`${styles.skeleton} ${styles.skeletonLine}`} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
