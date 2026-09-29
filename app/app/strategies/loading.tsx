import styles from "./my-strategies.module.css";
import plans from "./plans/plans.module.css";

/**
 * The loading state, as reserved geometry.
 *
 * No plan from an earlier read is on this screen — only the shape one will
 * occupy: the title, the four counts, two plan cards. A lifecycle that shows
 * its previous state while fetching the next is the most convincing way to
 * tell a reader a plan is somewhere it is not.
 */
export default function StrategiesLoading() {
  return (
    <section className={styles.page} aria-busy="true" aria-label="Loading">
      <header className={styles.head}>
        <div className={styles.title}>
          <span className={styles.bone} style={{ width: 220, height: 28 }} />
          <span className={styles.bone} style={{ width: 340, height: 14 }} />
        </div>
      </header>
      <div className={`${plans.card} ${plans.summary}`}>
        {["attention", "active", "drafts", "results"].map((key) => (
          <span key={key} className={plans.tile}>
            <span className={styles.bone} style={{ width: 96, height: 11 }} />
            <span className={styles.bone} style={{ width: 40, height: 28 }} />
          </span>
        ))}
      </div>
      <ul className={plans.planGrid}>
        {["one", "two"].map((key) => (
          <li key={key} className={`${plans.card} ${plans.planCard}`}>
            <span className={styles.bone} style={{ width: "60%", height: 40 }} />
            <span className={styles.bone} style={{ width: "100%", height: 44 }} />
            <span className={styles.bone} style={{ width: "50%", height: 14 }} />
          </li>
        ))}
      </ul>
    </section>
  );
}
