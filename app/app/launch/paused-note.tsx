"use client";

import { ArrowRight, PauseCircle } from "@phosphor-icons/react";
import Link from "next/link";

import type { WorkspaceLocale } from "@/app/shell/locale";

import { launchWords } from "./launch-words";
import styles from "./launch.module.css";

/**
 * Launch's operator stop, said where a person meets it first — under the
 * form's title, in place of a trade's action, above «Забрати» — in the page's
 * own tone, not an error's: nothing went wrong on the person's side, and no
 * time is promised. `scope`: the whole of Launch, or only new launches — then
 * trades and claims go on, and the way to them is named.
 */
export function PausedNote({ locale, scope = "all" }: { locale: WorkspaceLocale; scope?: "all" | "launching" }) {
  const word = launchWords(locale);
  return (
    <div className={styles.pausedNote} role="status">
      <PauseCircle size={18} aria-hidden />
      <p className={styles.pausedText}>
        {scope === "all" ? word("pausedNotice") : word("pausedLaunching")}
        {scope === "launching" ? (
          <>
            {" "}
            <Link className={styles.pausedLink} href="/app/launch/mine">
              {word("pausedToMine")} <ArrowRight size={14} aria-hidden />
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}

/** The same stop as a chip beside a page's title: seen at a glance, read in full under it. */
export function PausedChip({ locale }: { locale: WorkspaceLocale }) {
  return (
    <span className={styles.pausedChip}>
      <PauseCircle size={14} weight="fill" aria-hidden />
      {launchWords(locale)("pausedChip")}
    </span>
  );
}
