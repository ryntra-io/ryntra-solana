"use client";

import Link from "next/link";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { ruleSentence, type WatchLocale } from "@/lib/predictions/watch/words";
import type { WatchSignalView, WatchSweep } from "@/lib/predictions/watch/run";

import { timeShort } from "./format";
import styles from "./predictions.module.css";
import { wordsFor, type PredictionWord } from "./words";

const STATE_WORD: Readonly<Record<WatchSignalView["state"], PredictionWord>> = {
  detected: "watchStateDetected",
  confirmed: "watchStateConfirmed",
  stale: "watchStateStale",
  unavailable: "watchStateUnavailable",
  read: "watchStateRead",
};

/**
 * Ryntra Watch as the person reads it: what their rules found, and what is
 * being watched.
 *
 * Nothing in this card acts on a market. A signal is a record of something
 * that happened, with the state it is in — just detected, confirmed by a
 * later read, gone stale, or unreadable — and the only buttons are about the
 * watch itself: pause one, remove one, stop them all, or ask for a pass now.
 */
export function WatchCard({ watch, busy, checking, locale, controls }: { watch: WatchSweep | null; busy: boolean; checking: boolean; locale: WorkspaceLocale; controls: Readonly<{ pause: (id: string, on: boolean) => void; remove: (id: string) => void; stopAll: () => void; markRead: (ids: readonly string[] | true) => void; checkNow: () => void }> }) {
  const word = wordsFor(locale);
  const say: WatchLocale = locale === "uk" ? "uk" : "en";
  if (!watch) return null;
  const unread = watch.signals.filter((signal) => signal.readAt === null).length;
  const anyOn = watch.rules.some((rule) => rule.on);

  return (
    <section className={styles.card} aria-labelledby="pred-watch">
      <div className={`${styles.cardHead} ${styles.cardHeadWrap}`}>
        <h2 id="pred-watch" className={styles.cardTitle}>
          {word("watchTitle")}
        </h2>
        <div className={styles.actions}>
          <button type="button" className="rw-btn" disabled={checking} onClick={() => controls.checkNow()}>
            {checking ? word("watchChecking") : word("watchCheckNow")}
          </button>
          {anyOn ? (
            <button type="button" className="rw-btn" disabled={busy} onClick={() => controls.stopAll()}>
              {busy ? word("watchSaving") : word("watchStopAll")}
            </button>
          ) : null}
        </div>
      </div>
      <div className={styles.cardBody}>
        <p className={styles.note}>{word("watchIntro")}</p>
        <p className={styles.hint}>{word("watchBuysNothing")}</p>
        {watch.providerFailure ? <p className={styles.notice}>{word("watchUnreadable")}</p> : null}
      </div>

      <div className={`${styles.cardHead} ${styles.cardHeadWrap}`} style={{ borderTop: "1px solid var(--ry-border)" }}>
        <h3 className={styles.sectionTitle}>{word("watchSignals")}</h3>
        {unread > 0 ? (
          <button type="button" className="rw-btn" disabled={busy} onClick={() => controls.markRead(true)}>
            {word("watchReadAll")}
          </button>
        ) : null}
      </div>
      {watch.signals.length === 0 ? (
        <p className={styles.muted} style={{ padding: "var(--ry-s3) var(--ry-s4)" }}>
          {word("watchNoSignals")}
        </p>
      ) : (
        <div>
          {watch.signals.slice(0, 20).map((signal) => (
            <div key={signal.id} className={styles.positionRow}>
              <p className={styles.positionTitle}>
                <Link href={signal.href} prefetch={false}>
                  {signal.said}
                </Link>
              </p>
              {signal.explanation ? <p className={styles.muted}>{signal.explanation}</p> : null}
              <div className={styles.positionFigures}>
                <span className={styles.stateChip}>{word(STATE_WORD[signal.state])}</span>
                <span>{timeShort(signal.updatedAt, locale)}</span>
                {signal.count > 1 ? <span>{`×${signal.count}`}</span> : null}
                {signal.paper ? <span className={styles.paperBadge}>{word("paperBadge")}</span> : null}
              </div>
              {signal.state === "stale" ? <p className={styles.hint}>{word("watchStaleNote")}</p> : null}
              {signal.aged && signal.state !== "stale" ? <p className={styles.hint}>{word("watchAgedNote")}</p> : null}
            </div>
          ))}
        </div>
      )}

      <div className={`${styles.cardHead} ${styles.cardHeadWrap}`} style={{ borderTop: "1px solid var(--ry-border)" }}>
        <h3 className={styles.sectionTitle}>{word("watchRules")}</h3>
      </div>
      {watch.rules.length === 0 ? (
        <p className={styles.muted} style={{ padding: "var(--ry-s3) var(--ry-s4)" }}>
          {word("watchNoRules")}
        </p>
      ) : (
        <div>
          {watch.rules.map((row) => (
            <div key={row.id} className={styles.positionRow}>
              <p className={styles.positionTitle}>
                <Link href={`/app/predictions/${encodeURIComponent(row.rule.subject.eventId)}`} prefetch={false}>
                  {row.rule.subject.question}
                </Link>
              </p>
              <p className={styles.muted}>{ruleSentence(row.rule.kind, row.rule.direction, row.rule.threshold, row.rule.windowMinutes, say)}</p>
              {row.rule.note ? <p className={styles.hint}>{row.rule.note}</p> : null}
              <div className={styles.positionFigures}>
                <span className={styles.stateChip}>{row.on ? word("watchWatching") : word("watchPaused")}</span>
                <span>{row.lastCheckedAt ? `${word("watchLastChecked")}: ${timeShort(row.lastCheckedAt, locale)}` : word("watchNeverChecked")}</span>
                {row.rule.subject.outcomeLabel ? <span>{row.rule.subject.outcomeLabel}</span> : null}
              </div>
              {row.on && row.lastOutcome === "rebased" ? <p className={styles.hint}>{word("watchBaselined")}</p> : null}
              {row.on && row.lastOutcome === "unavailable" ? <p className={styles.hint}>{word("watchUnreadable")}</p> : null}
              <div className={styles.actions}>
                <button type="button" className="rw-btn" disabled={busy} onClick={() => controls.pause(row.id, !row.on)}>
                  {row.on ? word("watchOff") : word("watchResume")}
                </button>
                <button type="button" className="rw-btn" disabled={busy} onClick={() => controls.remove(row.id)}>
                  {word("watchRemove")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
