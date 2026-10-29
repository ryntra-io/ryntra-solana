import type { WorkspaceLocale } from "@/app/shell/locale";

import styles from "./predictions.module.css";
import { wordsFor } from "./words";

/** Who holds the money, behind a disclosure: the money card, the Review and the rules say it in the same words. */
export function Custody({ locale, paper = false }: { locale: WorkspaceLocale; paper?: boolean }) {
  const word = wordsFor(locale);
  return (
    <details className={styles.disclosure}>
      <summary>{word("custodyTitle")}</summary>
      <div className={styles.disclosureBody}>
        <p>{word("custodyLine")}</p>
        {paper ? <p>{word("custodyPaper")}</p> : null}
      </div>
    </details>
  );
}
