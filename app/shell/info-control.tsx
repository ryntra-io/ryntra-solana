"use client";

import { Info } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import styles from "./info-control.module.css";

/**
 * The workspace's one explanation control.
 *
 * This is where a surface's prose goes. A workspace page that prints its
 * explanation permanently is documentation with controls attached: the sentence
 * is written for the first visit and then charged to every visit forever, taking
 * the top of the screen each time to answer a question the operator stopped
 * having. One hub measured that cost — 8,110 characters of permanent prose across 22
 * routes — and moving it behind this control brought it to 2,861 without
 * deleting a word.
 *
 * **Nothing is hidden.** A native `<details>` keeps the text in the DOM, so it
 * is still found by in-page search and still read by assistive technology, and
 * it is keyboard-operable with no script. On a phone the panel becomes a bottom
 * sheet with a 44px target, because a popover anchored to a 32px button at the
 * right edge of a 375px viewport opens off-screen.
 *
 * What must never move in here: a blocked state, a review requirement, stale or
 * conflicting evidence, a fee, an unknown, or a recovery path. Depth hides
 * detail, never consequence.
 *
 * It lives in the shell rather than in a workspace because the second workspace
 * needed exactly this control, and the alternative was two copies drifting apart.
 * The first workspace re-exports it under its original name, so its rendered
 * output is unchanged.
 */
export function InfoControl({
  label,
  children,
  align = "end",
}: {
  label: string;
  children: ReactNode;
  /** Which edge the panel is anchored to. `end` is the original behaviour. */
  align?: "start" | "end";
}) {
  return (
    <details className={styles.root}>
      <summary aria-label={label} title={label}>
        <Info size={16} weight="bold" aria-hidden />
        <span>{label}</span>
      </summary>
      <div className={`${styles.panel} ${align === "start" ? styles.alignStart : ""}`}>
        {children}
      </div>
    </details>
  );
}
