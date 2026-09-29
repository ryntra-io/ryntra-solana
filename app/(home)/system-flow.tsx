import type { PublicCopy } from "@/lib/site/public-copy";

import { FlowScene } from "./flow-scene";
import styles from "./landing.module.css";

/*
 * Scene 4 — how Ryntra works, as an interactive rail rather than a monospace
 * arrow chain or a row of small pills. The scene itself lives in FlowScene.
 */

export function SystemFlow({ copy }: { copy: PublicCopy }) {
  return (
    <section className={styles.section} id="how" data-ry-ground="midnight">
      <div className={styles.wrap}>
        <p className={`${styles.eyebrow} ${styles.flowEyebrow}`}>{copy.flowEyebrow}</p>
        <FlowScene copy={copy} />
      </div>
    </section>
  );
}
