import styles from "@/app/app/home-surface.module.css";

/**
 * The loading state, as reserved geometry.
 *
 * Nothing from an earlier read is shown here. A surface that renders its last
 * state while fetching the next is the most convincing way to tell a reader
 * everything is fine.
 */
export default function OperationsLoading() {
  return (
    <div className={styles.surface} data-surface-state="LOADING" aria-busy="true">
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Ryntra Home</p>
          <h1>Operations</h1>
        </div>
      </header>

      <section aria-label="Loading">
        <div className={styles.tiles}>
          {["one", "two", "three", "four", "five", "six"].map((key) => (
            <div key={key} className={`${styles.skeleton} ${styles.skeletonRow}`} />
          ))}
        </div>
      </section>
    </div>
  );
}
