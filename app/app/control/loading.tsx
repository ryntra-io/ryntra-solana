import styles from "@/app/app/home-surface.module.css";

/**
 * The loading state, as reserved geometry.
 *
 * No tile from an earlier read is on this screen — only the shape one will
 * occupy. A control surface that shows its last state while fetching the next
 * is the most convincing way to tell a reader nothing is wrong.
 */
export default function ControlLoading() {
  return (
    <div className={styles.surface} data-surface-state="LOADING" aria-busy="true">
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Ryntra Home</p>
          <h1>Control</h1>
        </div>
      </header>

      <section aria-label="Loading the control projections">
        <div className={styles.tiles}>
          {["one", "two", "three", "four", "five", "six"].map((key) => (
            <div key={key} className={`${styles.skeleton} ${styles.skeletonRow}`} />
          ))}
        </div>
      </section>
    </div>
  );
}
