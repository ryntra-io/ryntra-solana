"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { NOTES_PER_HOUR_MAX, NOTES_PER_HOUR_MIN, type Note, type NoteChannel, type NoteWords, type NotifyPrefs } from "@/lib/predictions/notify/notes";

import { timeShort } from "./format";
import styles from "./predictions.module.css";
import { wordsFor } from "./words";

type NoteRow = Note & Readonly<{ words: NoteWords }>;
type Answer = Readonly<{ wallet: string; prefs: NotifyPrefs; notes: readonly NoteRow[] }>;

/** The browser's own timezone, so a quiet hour the person sets means their own evening. */
function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * How the person is told, and what they were told.
 *
 * Everything here is about the channels, never about money: a note is a
 * record of something that happened, and nothing in this card places,
 * collects or cancels anything. The list stays the record whatever the
 * channels do — switched off, held back by the quiet hour or over the hour's
 * limit, a note is still written and still read here.
 */
export function NotificationsCard({ wallet, locale, after }: { wallet: string | null; locale: WorkspaceLocale; /** Re-read when settlement last ran, so a note it wrote shows without a reload. */ after?: string | null }) {
  const word = wordsFor(locale);
  const [data, setData] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    if (!wallet) {
      setData(null);
      return;
    }
    try {
      const response = await fetch("/api/predictions/notifications", { headers: { accept: "application/json" }, cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as Answer;
      if (body.wallet === wallet) setData(body);
    } catch {
      /* Nothing invented on a failed read. */
    }
  }, [wallet]);

  const change = useCallback(
    async (body: Record<string, unknown>) => {
      if (!wallet) return;
      setBusy(true);
      try {
        const response = await fetch("/api/predictions/notifications", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
        if (!response.ok) return;
        const answer = (await response.json()) as Answer;
        if (answer.wallet === wallet) setData(answer);
      } catch {
        /* The server keeps what it has; the card re-reads on the next load. */
      } finally {
        setBusy(false);
      }
    },
    [wallet],
  );

  useEffect(() => {
    void read();
  }, [read, after]);

  if (!wallet || !data) return null;
  const prefs = data.prefs;
  const quiet = prefs.quietHours;
  const unread = data.notes.filter((note) => note.readAt === null).length;

  const setChannel = (channel: NoteChannel, on: boolean) => void change({ channels: on ? [...new Set([...prefs.channels, channel])] : prefs.channels.filter((c) => c !== channel) });
  const setQuiet = (start: string, end: string) => void change({ quietHours: { start, end, timezone: quiet?.timezone || localZone() } });

  return (
    <section className={styles.card} aria-labelledby="pred-notify">
      <div className={`${styles.cardHead} ${styles.cardHeadWrap}`}>
        <h2 id="pred-notify" className={styles.cardTitle}>
          {word("notifyTitle")}
        </h2>
        <button type="button" className="rw-btn" disabled={busy} onClick={() => void change({ on: !prefs.on })}>
          {busy ? word("notifySaving") : prefs.on ? word("notifyStop") : word("notifyStart")}
        </button>
      </div>
      <div className={styles.cardBody}>
        <p className={styles.note}>{word("notifyIntro")}</p>
        {!prefs.on ? <p className={styles.notice}>{word("notifyOffNote")}</p> : null}
        {prefs.on && prefs.channels.length === 0 ? <p className={styles.notice}>{word("notifyNoChannel")}</p> : null}
      </div>

      <div className={styles.cardBody}>
        <h3 className={styles.sectionTitle}>{word("notifyChannels")}</h3>
        <div className={styles.chipRow}>
          {(["webpush", "telegram"] as const).map((channel) => (
            <button key={channel} type="button" className={styles.chip} aria-pressed={prefs.channels.includes(channel)} disabled={busy} onClick={() => setChannel(channel, !prefs.channels.includes(channel))}>
              {channel === "webpush" ? word("notifyWeb") : word("notifyTelegram")}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.cardBody}>
        <h3 className={styles.sectionTitle}>{word("notifyQuiet")}</h3>
        <p className={styles.hint}>{word("notifyQuietNote")}</p>
        <div className={styles.chipRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{word("quietFrom")}</span>
            <input className={styles.input} type="time" value={quiet?.start ?? "22:00"} disabled={busy} onChange={(event) => setQuiet(event.target.value, quiet?.end ?? "08:00")} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{word("quietTo")}</span>
            <input className={styles.input} type="time" value={quiet?.end ?? "08:00"} disabled={busy} onChange={(event) => setQuiet(quiet?.start ?? "22:00", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{word("notifyPerHour")}</span>
            <input className={styles.input} type="number" min={NOTES_PER_HOUR_MIN} max={NOTES_PER_HOUR_MAX} value={prefs.perHour} disabled={busy} onChange={(event) => void change({ perHour: Number(event.target.value) })} />
          </label>
        </div>
        {quiet ? (
          <button type="button" className="rw-btn" disabled={busy} onClick={() => void change({ quietHours: null })}>
            {word("quietClear")}
          </button>
        ) : (
          <p className={styles.hint}>{word("quietNotSet")}</p>
        )}
      </div>

      <div className={`${styles.cardHead} ${styles.cardHeadWrap}`} style={{ borderTop: "1px solid var(--ry-border)" }}>
        <h3 className={styles.sectionTitle}>{word("notifyList")}</h3>
        {unread > 0 ? (
          <button type="button" className="rw-btn" disabled={busy} onClick={() => void change({ read: true })}>
            {word("notifyRead")}
          </button>
        ) : null}
      </div>
      {data.notes.length === 0 ? (
        <p className={styles.muted} style={{ padding: "var(--ry-s3) var(--ry-s4)" }}>
          {word("notifyNone")}
        </p>
      ) : (
        <div>
          {data.notes.slice(0, 20).map((note) => (
            <div key={note.id} className={styles.positionRow}>
              <p className={styles.positionTitle}>
                <Link href={note.href} prefetch={false}>
                  {note.words.title}
                </Link>
              </p>
              <p className={styles.muted}>{note.words.body}</p>
              <div className={styles.positionFigures}>
                <span>{timeShort(note.updatedAt, locale)}</span>
                {note.delivery === "quiet" ? <span>{word("notifyHeldQuiet")}</span> : null}
                {note.delivery === "capped" ? <span>{word("notifyCapped")}</span> : null}
                {note.delivery === "failed" ? <span>{word("notifyFailed")}</span> : null}
                {note.paper ? <span className={styles.paperBadge}>{word("paperBadge")}</span> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
