"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AssistantBrief, AssistantBriefLine, AssistantBriefResponse } from "@/lib/api/v1/contract";

import styles from "./ryn.module.css";
import type { RynWord } from "./ryn-words";

/**
 * «Ранковий огляд» on the assistant's page (AI-10): since AI-06b a tab of the
 * page, not a fold — on or off and its time on top (and beside the tab's
 * name), where the brief goes and when the next one comes, then the latest
 * brief itself: the market's part for everyone, then the person's own
 * changes, each part the model's blocks over the server's marked lines. How
 * it works and what it costs sit one press deep.
 */

const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;

/** Mornings in half hours, and the person's own time where it is another. */
const TIMES = ["05:00", "05:30", "06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"];

const MARK_WORD = { fact: "markFact", unverified: "markUnverified" } as const;

/** «сьогодні о 09:00» on the brief's own clock, never the reader's browser's. */
function nextWords(at: string, zone: string, word: (w: RynWord) => string, locale: WorkspaceLocale): string {
  const tag = locale === "uk" ? "uk-UA" : "en-GB";
  const dayOf = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const when = Date.parse(at);
  const time = new Intl.DateTimeFormat(tag, { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(when));
  const today = dayOf(Date.now());
  const tomorrow = dayOf(Date.now() + 86_400_000);
  const day = dayOf(when) === today ? word("briefToday") : dayOf(when) === tomorrow ? word("briefTomorrow") : new Intl.DateTimeFormat(tag, { timeZone: zone, day: "numeric", month: "long" }).format(new Date(when));
  return `${day} ${word("briefAt")} ${time}`;
}

/** A line's time on the brief's own clock — «18 жовт., 09:46». */
function lineTime(at: string | null, zone: string, locale: WorkspaceLocale): string | null {
  if (!at) return null;
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-GB", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
}

function Lines({ lines, word, zone, locale }: { lines: readonly AssistantBriefLine[]; word: (w: RynWord) => string; zone: string; locale: WorkspaceLocale }) {
  if (lines.length === 0) return null;
  return (
    <ul className={styles.briefLines}>
      {lines.map((line, index) => {
        const when = lineTime(line.observedAt, zone, locale);
        return (
          <li key={`${line.kind}-${index}`} className={styles.briefLine}>
            <span className={styles.mark} data-mark={line.mark}>
              {word(MARK_WORD[line.mark])}
            </span>
            <span className={styles.briefClaim}>
              {line.href && line.kind.endsWith("news") ? (
                <a href={line.href} target="_blank" rel="noopener noreferrer nofollow">
                  {line.text}
                </a>
              ) : line.href ? (
                <Link href={line.href} prefetch={false}>
                  {line.text}
                </Link>
              ) : (
                line.text
              )}
              <span className={styles.briefSource}>{when ? `${line.source} · ${when}` : line.source}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Brief({ brief, word, zone, locale }: { brief: AssistantBrief; word: (w: RynWord) => string; zone: string; locale: WorkspaceLocale }) {
  return (
    <article className={styles.briefCard} data-kind="brief">
      <h3 className={styles.briefHead}>{brief.title}</h3>
      {[brief.market, brief.personal].map((part, index) => (
        <section key={index} className={styles.section}>
          <h4 className={styles.briefPart}>{part.title}</h4>
          {part.words.length > 0 ? (
            <ul className={styles.sentences}>
              {part.words.map((block) => (
                <li key={block}>{block}</li>
              ))}
            </ul>
          ) : null}
          <Lines lines={part.lines} word={word} zone={zone} locale={locale} />
          {part.note ? <p className={styles.muted}>{part.note}</p> : null}
        </section>
      ))}
    </article>
  );
}

export function BriefPanel({ locale, word, day, onStatus }: { locale: WorkspaceLocale; word: (w: RynWord) => string; day: string | null; onStatus?: (status: string | null) => void }) {
  const dayQuery = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `&day=${day}` : "";
  const [read, setRead] = useState<AssistantBriefResponse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lang = locale === "uk" ? "uk" : "en";

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => fetch(`/api/v1/assistant/brief?locale=${lang}${dayQuery}`, { headers: HEADERS, credentials: "same-origin" }).then((response) => (response.ok ? (response.json() as Promise<AssistantBriefResponse>) : Promise.reject(new Error(String(response.status)))));
    /* One more try after a moment: a read that failed once (a store busy with the page's other reads) usually answers the second time. */
    void load()
      .catch(() => new Promise<AssistantBriefResponse>((settle, refuse) => (timer = setTimeout(() => void load().then(settle, refuse), 1_500))))
      .then((body) => {
        if (live) setRead(body);
      })
      .catch(() => {
        if (live) setFailed(word("briefLoadFailed"));
      });
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [lang, word, dayQuery]);

  const save = useCallback(
    async (change: Readonly<{ enabled?: boolean; time?: string }>) => {
      if (!read || saving) return;
      setSaving(true);
      setFailed(null);
      try {
        const body = { enabled: change.enabled ?? read.settings.enabled, time: change.time ?? read.settings.time, zone: read.settings.zone, locale: lang };
        const response = await fetch(`/api/v1/assistant/brief?locale=${lang}`, { method: "PUT", headers: HEADERS, credentials: "same-origin", body: JSON.stringify(body) });
        if (!response.ok) throw new Error(String(response.status));
        setRead((await response.json()) as AssistantBriefResponse);
      } catch {
        setFailed(word("briefFailed"));
      } finally {
        setSaving(false);
      }
    },
    [read, saving, lang, word],
  );

  const settings = read?.settings ?? null;
  const zoneWord = settings ? (settings.zone === "Europe/Kyiv" ? word("briefKyiv") : settings.zone) : "";
  const times = settings && !TIMES.includes(settings.time) ? [...TIMES, settings.time].sort() : TIMES;
  const where = read ? [word("briefInbox"), ...(read.channels.telegram ? ["Telegram"] : []), ...(read.channels.push ? ["Push"] : [])].join(" · ") : "";
  /* The tab's name carries the state: «09:00» while on, «вимкнено» while off. */
  useEffect(() => {
    onStatus?.(settings === null ? null : settings.enabled ? settings.time : word("briefOff"));
  }, [onStatus, settings, word]);

  return (
    <div className={styles.panelBody} data-enabled={settings?.enabled ? "on" : "off"}>
      <p className={styles.panelLead}>{word("briefHow1")}</p>
      <div className={styles.briefBody}>
        {read === null && failed === null ? (
          <p className={styles.muted} aria-busy="true">
            {word("loadingList")}
          </p>
        ) : null}
        {settings ? (
          <div className={styles.briefControls}>
            <label className={styles.briefSwitch}>
              <input type="checkbox" checked={settings.enabled} disabled={saving} onChange={(event) => void save({ enabled: event.target.checked })} />
              <span>{word("briefSend")}</span>
            </label>
            <label className={styles.briefTimeField}>
              <span>{word("briefTime")}</span>
              <select value={settings.time} disabled={saving} onChange={(event) => void save({ time: event.target.value })}>
                {times.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
              <span className={styles.muted}>{zoneWord}</span>
            </label>
          </div>
        ) : null}
        {read && settings?.enabled && read.next.at ? (
          <p className={styles.briefMeta}>
            {word("briefNext")}: {nextWords(read.next.at, settings.zone, word, locale)} · {word("briefWhere")}: {where} ·{" "}
            <Link href="/app/alerts" prefetch={false}>
              {word("briefChannels")}
            </Link>
          </p>
        ) : null}
        {read?.next.quiet ? <p className={styles.briefMeta}>{word("briefQuiet")}</p> : null}
        <div aria-live="polite">
          {saving ? (
            <p className={styles.muted} aria-busy="true">
              {word("briefSaving")}
            </p>
          ) : null}
        </div>
        {failed ? (
          <p className={styles.error} role="alert">
            {failed}
          </p>
        ) : null}
        {read ? read.latest ? <Brief brief={read.latest} word={word} zone={read.settings.zone} locale={locale} /> : <p className={styles.muted}>{word("briefNone")}</p> : null}
        <details className={styles.marksLegend}>
          <summary>{word("briefHow")}</summary>
          <p>{word("briefHow2")}</p>
          <p>{word("briefHow3")}</p>
        </details>
      </div>
    </div>
  );
}
