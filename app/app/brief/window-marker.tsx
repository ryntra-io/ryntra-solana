"use client";

import { useEffect, useState } from "react";

import { DEFAULT_BRIEF_WINDOW_SECONDS, briefWindow, type BriefWindow } from "@/lib/home/brief/window";
import { StateChip } from "@/app/app/portfolio/tiles";
import { useHomeI18n } from "@/app/app/i18n/provider";
import type { WorkspaceLocale } from "@/app/shell/locale";
import styles from "@/app/app/home-surface.module.css";

const MARKER_KEY = "ryntra.home.brief.lastSeenAt.v1";

/**
 * The marker's own words, per locale, in this file. English is byte-identical
 * to what shipped; `uk` is its twin. The window's `reason` sentence arrives
 * from `lib/home/brief/window` and is rendered as received.
 */
type MarkerCopy = Readonly<{
  windowWord: string;
  sinceLastVisit: string;
  lastDay: string;
  reading: string;
  coveringFrom: (from: string) => string;
}>;

const COPY = {
  en: {
    windowWord: "Window",
    sinceLastVisit: "Since your last visit",
    lastDay: "Last 24 hours",
    reading: "Reading",
    coveringFrom: (from: string) => " Covering from " + from + " UTC.",
  },
  uk: {
    windowWord: "Вікно",
    sinceLastVisit: "Від вашого останнього візиту",
    lastDay: "Останні 24 години",
    reading: "Зчитування",
    coveringFrom: (from: string) => " Охоплює від " + from + " UTC.",
  },
} as const satisfies Record<WorkspaceLocale, MarkerCopy>;

/**
 * When the reader last opened Home, read where it actually lives.
 *
 * This is a fact about one browser on one device. The server genuinely cannot
 * see it, so the page renders `NOT_SERVER_READABLE` and this island replaces it
 * with the real window once the browser reports one — the same shape the
 * InvestorContext binding takes on the decision surface, and for the same
 * reason: a window the server guessed would look like a measurement.
 *
 * The marker is written **after** it is read, so a reader who opens the brief
 * twice in a minute does not lose the window they were shown.
 *
 * It moves no line. The brief's ordering and contents are compiled on the
 * server; this component states which window that compilation covers and
 * nothing else. Filtering lines here would mean two different briefs depending
 * on whether JavaScript ran.
 */
export function BriefWindowMarker({ window: serverWindow }: { window: BriefWindow }) {
  const { locale } = useHomeI18n();
  const c = COPY[locale] ?? COPY.en;
  const [resolved, setResolved] = useState<BriefWindow | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(MARKER_KEY);
    } catch {
      stored = null;
    }

    const now = new Date().toISOString();
    setResolved(briefWindow({
      lastSeenAt: stored,
      asOf: now,
      defaultWindowSeconds: DEFAULT_BRIEF_WINDOW_SECONDS,
    }));

    try {
      localStorage.setItem(MARKER_KEY, now);
    } catch {
      /* A browser that refuses storage still gets the default window. */
    }
  }, []);

  const shown = resolved ?? serverWindow;
  const bound = shown.state === "SINCE_LAST_VISIT";

  return (
    <div className={styles.fact} data-window-state={shown.state}>
      <span className={styles.factKey}>
        {c.windowWord}{" "}
        <StateChip
          tone={bound ? "good" : "unknown"}
          label={bound ? c.sinceLastVisit : shown.state === "DEFAULT_WINDOW" ? c.lastDay : c.reading}
        />
      </span>
      <span className={styles.rowReason}>
        {shown.reason}
        {shown.from === null ? null : c.coveringFrom(shown.from.slice(0, 16).replace("T", " "))}
      </span>
    </div>
  );
}
