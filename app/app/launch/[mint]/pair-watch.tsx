import { Warning } from "@phosphor-icons/react/dist/ssr";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchTokenResponse } from "@/lib/api/v1/contract";

import { formatDate } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";

/**
 * The pair currency's watch on a market's page (SOL-L12): when the pair token's issuer changed what it can do to
 * holders — the fee on transfers, an authority, an extension — since Ryntra first read it, the page says so first: what
 * changed and since when. Trading goes on; new launches on that pair wait. Nothing is drawn while the pair reads as it
 * did, or has not been read.
 */
export function PairWatchNote({ watch, locale }: { watch: LaunchTokenResponse["pairWatch"]; locale: WorkspaceLocale }) {
  if (!watch || watch.state !== "CHANGED") return null;
  const word = launchWords(locale);
  const changes = watch.changes.map((field) => word(`pairField_${field}` as LaunchWordKey)).join(", ");
  return (
    <div className={styles.failure} role="status" data-pair-watch={watch.state}>
      <p className={styles.failureTitle}>
        <Warning size={18} weight="fill" aria-hidden /> {word("pairWatchTitle", { pair: watch.symbol })}
      </p>
      <p className={styles.failureText}>{word("pairWatchLine", { date: watch.since ? formatDate(watch.since, locale) : "—", changes: changes || "—", pair: watch.symbol })}</p>
      <p className={styles.hint}>{word("pairWatchWhy")}</p>
    </div>
  );
}
