"use client";

import Link from "next/link";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { relativeTime } from "@/lib/monitoring/copy";
import type { InboxRecord } from "@/lib/monitoring/store";

import styles from "./bell.module.css";

/**
 * The latest notes as the bell and Home's column draw them: an unread dot, the
 * title, the reason under it, how long ago. A note opens through the
 * ownership-safe link (`/app/alerts/open`), which rereads the owned record —
 * a note is never permission to trade — and is marked read on the way.
 */
export function NoteList({
  notes,
  locale,
  onOpen,
}: {
  notes: readonly InboxRecord[];
  locale: WorkspaceLocale;
  /** A note was pressed: mark it read, close what it sits in. */
  onOpen: (note: InboxRecord) => void;
}) {
  const now = Date.now();
  return (
    <ul className={styles.list}>
      {notes.map((row) => (
        <li key={row.id}>
          <Link
            className={styles.note}
            href={`/app/alerts/open?n=${encodeURIComponent(row.id)}`}
            prefetch={false}
            data-unread={row.unread ? "true" : "false"}
            onClick={() => onOpen(row)}
          >
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.body}>
              <span className={styles.noteTitle}>{row.title}</span>
              {row.reason ? <span className={styles.reason}>{row.reason}</span> : null}
            </span>
            <time className={styles.time} dateTime={row.createdAt}>
              {relativeTime(row.createdAt, now, locale === "uk" ? "uk" : "en")}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  );
}
