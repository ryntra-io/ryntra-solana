"use client";

import Link from "next/link";
import { Bell } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import { ShellMenu } from "@/app/shell/menu";
import type { WorkspaceLocale } from "@/app/shell/locale";

import { bellWords } from "./bell-words";
import styles from "./bell.module.css";
import { NoteList } from "./note-list";
import { useNotes } from "./use-notes";

/**
 * The notifications bell — in the top bar on every page of the product, on a
 * desk and on a phone.
 *
 * It reads the one monitoring surface Нагляд reads (`/api/monitoring`), behind
 * the same proof of the wallet, through the page's one read (`useNotes`) that
 * Home's column shares: the count is the surface's unread count, the list its
 * latest notes in the reader's language, and «Усі сповіщення» opens Нагляд
 * itself.
 *
 * Without a wallet, or before its proof, the panel says what to do in one
 * line; it never shows a zero it did not read.
 */

const SHOWN = 6;
const REFRESH_MS = 120_000;
/** An open panel older than this asks again. */
const FRESH_MS = 30_000;

export function NotificationsBell({ locale }: { locale: WorkspaceLocale }) {
  const word = bellWords(locale);
  const notes = useNotes(locale);
  const { phase, reload } = notes;

  useEffect(() => {
    if (phase !== "ready" && phase !== "loading") return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [phase, reload]);

  const unread = notes.unread;
  const count = unread > 99 ? "99+" : String(unread);

  return (
    <ShellMenu
      boxClass="rs-bellbox"
      triggerClass="rs-bell"
      caret={false}
      panelTitle={word("title")}
      ariaLabel={unread > 0 ? `${word("title")}, ${unread} ${word("unread")}` : word("title")}
      icon={<Bell size={19} weight="bold" />}
      label={unread > 0 ? <span className="rs-bell-count">{count}</span> : null}
    >
      {(close) => (
        <div className={styles.panel} data-bell-panel>
          <OnOpen onOpen={() => reload(FRESH_MS)} />
          <p className={styles.title}>{word("title")}</p>
          {phase === "guest" ? (
            <p className={styles.line}>{word("guest")}</p>
          ) : phase === "unproven" ? (
            <div className={styles.gate}>
              <p className={styles.line}>{word("unproven")}</p>
              <button type="button" className="rs-menu-action" onClick={notes.prove} disabled={notes.signing}>
                {notes.signing ? word("confirming") : word("confirm")}
              </button>
            </div>
          ) : phase === "failed" ? (
            <div className={styles.gate}>
              <p className={styles.line}>{word("failed")}</p>
              <button type="button" className="rs-menu-action" onClick={() => reload()}>
                {word("tryAgain")}
              </button>
            </div>
          ) : !notes.surface ? (
            <p className={styles.line} aria-busy="true">{word("loading")}</p>
          ) : notes.surface.recent.length === 0 ? (
            <p className={styles.line}>{word("empty")}</p>
          ) : (
            <NoteList
              notes={notes.surface.recent.slice(0, SHOWN)}
              locale={locale}
              onOpen={(note) => {
                if (note.unread) notes.markRead(note.id);
                close();
              }}
            />
          )}
          <Link className={styles.all} href="/app/alerts" prefetch={false} onClick={close}>
            {word("all")}
          </Link>
        </div>
      )}
    </ShellMenu>
  );
}

/** Runs once each time the panel opens — the panel's body mounts with it. */
function OnOpen({ onOpen }: { onOpen: () => void }) {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    onOpen();
  }, [onOpen]);
  return null;
}
