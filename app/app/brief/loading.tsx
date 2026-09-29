import styles from "@/app/app/home-surface.module.css";

/**
 * The loading state, as reserved geometry.
 *
 * Nothing from an earlier brief is on this screen. A digest that shows
 * yesterday's lines while today's are still loading is the most convincing way
 * to tell a reader nothing happened.
 */
export default function BriefLoading() {
  return (
    <div className={styles.surface} data-surface-state="LOADING" aria-busy="true">
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Ryntra Home</p>
          <h1>Daily Brief</h1>
        </div>
      </header>

      <section aria-label="Loading the brief">
        <div className={styles.tiles}>
          {["one", "two", "three", "four", "five"].map((key) => (
            <div key={key} className={`${styles.skeleton} ${styles.skeletonRow}`} />
          ))}
        </div>
      </section>
    </div>
  );
}
