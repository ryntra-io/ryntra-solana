import { Flask } from "@phosphor-icons/react/dist/ssr";

import type { WorkspaceLocale } from "@/app/shell/locale";

import styles from "./predictions.module.css";
import { wordsFor } from "./words";

/** The one mark of the mode on a screen, under its title: a simulation, and no real funds — quiet, never the orange of an action. */
export function SimulationLine({ locale }: { locale: WorkspaceLocale }) {
  return (
    <p className={styles.simLine}>
      <Flask size={14} weight="bold" aria-hidden="true" />
      {wordsFor(locale)("simulation")}
    </p>
  );
}
