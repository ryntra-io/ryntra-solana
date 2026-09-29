/**
 * The IPO and conversion watch — Ryntra does not let a token burn (canon
 * v5.2 В27, §7, §11; `RYN-PRESTOCKS-001`, session 2).
 *
 * When a private company goes public or is bought, its PreStocks token has a
 * deadline: it must be swapped before the issuer's cut-off, or it expires
 * worthless (`lifecycle-events.ts`). The swap is an ordinary swap at the live
 * quote — the issuer's own word: «conversion happens through normal trading»
 * — so Ryntra promises no ratio; it tells the holder the deadline, offers one
 * action and a quiet second, and reminds them.
 *
 * Decided here once, from the registry's event and a clock handed in:
 *
 * - the line a person reads — «SpaceX вийшла на біржу. Обміняй SPACEX до 12
 *   березня 2027 — після строку токен згорить.» for a holder; the same event
 *   before any figure for everyone else; and before a purchase of the token;
 * - the action «Обміняти на SpaceX (SPCXx)» and the quiet «Продати за USDC»;
 * - the reminders: the day a holder is first told, then 90, 30, 7 and 1 days
 *   before the deadline — never more than one a day for one token (§11), and
 *   never a missed one caught up: a holder first seen late is told the stage
 *   that stands now, once;
 * - the words of each reminder, in both languages, for the inbox, the bell,
 *   Home and Telegram.
 *
 * The date is the deadline's own day in UTC — 12 March for 23:59 UTC on 12
 * March — which is never later than the cut-off in any time zone a person
 * reads it in; the minute in UTC stands only under «Деталі». Pure: no fetch,
 * no clock of its own, no React.
 */

import { eventStateAt, type ConversionWatch, type LifecycleEvent } from "./instrument.ts";

type Lang = "en" | "uk";
type Bi = Readonly<{ en: string; uk: string }>;

const DAY_MS = 86_400_000;

/** The days before the deadline a holder is reminded on (canon §11 via the card: 90, 30, 7 and 1). */
export const REMINDER_DAYS_BEFORE = [90, 30, 7, 1] as const;

/** The hour, UTC, a «days before» reminder falls due — the morning in Europe, the day in Asia, the early morning in the Americas. */
export const REMINDER_HOUR_UTC = 9;

/** No two reminders about one token closer than this (canon §11: one note per position per day). */
export const MIN_REMINDER_GAP_MS = DAY_MS;

export type ConversionStage = "event" | "d90" | "d30" | "d7" | "d1";

const STAGE_DAYS: Readonly<Record<Exclude<ConversionStage, "event">, number>> = { d90: 90, d30: 30, d7: 7, d1: 1 };

/** An event the watch speaks about: a conversion window with a stated cut-off and its words. */
export type WatchedEvent = LifecycleEvent & Readonly<{ deadline: string; watch: ConversionWatch }>;

export function isWatched(event: LifecycleEvent | null | undefined): event is WatchedEvent {
  return !!event && typeof event.deadline === "string" && Number.isFinite(Date.parse(event.deadline)) && !!event.watch;
}

/** Where a watched token stands now: its window open until the cut-off, or closed. */
export function windowState(event: WatchedEvent, nowMs: number): "open" | "closed" {
  return eventStateAt(event, nowMs) === "conversion-open" ? "open" : "closed";
}

/** The moment a «days before» stage falls due: 09:00 UTC on the day that many days before the deadline's own UTC day. */
export function stageDueAt(deadlineIso: string, stage: Exclude<ConversionStage, "event">): number {
  const deadline = new Date(deadlineIso);
  return Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth(), deadline.getUTCDate() - STAGE_DAYS[stage], REMINDER_HOUR_UTC);
}

/**
 * The stage that stands at a moment while the window is open: the latest
 * «days before» already due, or `event` before the first of them; null once
 * the window has closed or where the event has no window to watch.
 */
export function stageAt(event: WatchedEvent, nowMs: number): ConversionStage | null {
  if (windowState(event, nowMs) !== "open") return null;
  let stage: ConversionStage = "event";
  for (const days of REMINDER_DAYS_BEFORE) {
    const key = `d${days}` as Exclude<ConversionStage, "event">;
    if (stageDueAt(event.deadline, key) <= nowMs) stage = key;
  }
  return stage;
}

/** What has been sent to one holder about one token: each stage once, and when. */
export type SentReminder = Readonly<{ stage: ConversionStage; atMs: number }>;

/**
 * The reminder to send now, or null: the stage that stands, if this holder
 * has not had it, and if no reminder about this token reached them within
 * the last day. A stage passed while a reminder was held back by the day's
 * gap is not sent later: the next due stage replaces it (nothing is caught
 * up). Only a holder is reminded — the caller asks only for one.
 */
export function reminderDue(event: WatchedEvent, sent: readonly SentReminder[], nowMs: number): ConversionStage | null {
  const stage = stageAt(event, nowMs);
  if (stage === null) return null;
  if (sent.some((entry) => entry.stage === stage)) return null;
  /* A later stage already sent covers this one — a clock that ran back never sends an earlier stage again. */
  if (sent.some((entry) => stageRank(entry.stage) > stageRank(stage))) return null;
  const last = sent.reduce((latest, entry) => Math.max(latest, entry.atMs), Number.NEGATIVE_INFINITY);
  if (nowMs - last < MIN_REMINDER_GAP_MS) return null;
  return stage;
}

function stageRank(stage: ConversionStage): number {
  return stage === "event" ? 0 : 1 + REMINDER_DAYS_BEFORE.indexOf(STAGE_DAYS[stage] as (typeof REMINDER_DAYS_BEFORE)[number]);
}

/**
 * Calendar days from a moment's UTC day to the deadline's own UTC day — «30»
 * on the day of the 30-day reminder, «1» the day before the last, «0» on the
 * last day itself. Never negative.
 */
export function daysLeft(event: WatchedEvent, nowMs: number): number {
  const deadline = new Date(event.deadline);
  const now = new Date(nowMs);
  const last = Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth(), deadline.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((last - today) / DAY_MS));
}

/* ------------------------------------------------------------------ words */

const UK_MONTHS = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"] as const;
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** «12 березня 2027» · «March 12, 2027» — the deadline's own day in UTC. */
export function deadlineDay(deadlineIso: string, lang: Lang): string {
  const at = new Date(deadlineIso);
  const day = at.getUTCDate();
  const month = at.getUTCMonth();
  const year = at.getUTCFullYear();
  return lang === "uk" ? `${day} ${UK_MONTHS[month]} ${year}` : `${EN_MONTHS[month]} ${day}, ${year}`;
}

/** «23:59 UTC, 12 березня 2027» — the issuer's minute, for «Деталі» only. */
export function deadlineExact(deadlineIso: string, lang: Lang): string {
  const at = new Date(deadlineIso);
  const time = `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")} UTC`;
  return lang === "uk" ? `${time}, ${deadlineDay(deadlineIso, "uk")}` : `${time}, ${deadlineDay(deadlineIso, "en")}`;
}

/** «SpaceX вийшла на біржу.» · «SpaceX купила xAI.» — why the window opened. */
export function causeLine(watch: ConversionWatch, lang: Lang): string {
  if (watch.cause.kind === "ipo") return lang === "uk" ? `${watch.company} вийшла на біржу.` : `${watch.company} has gone public.`;
  return lang === "uk" ? `${watch.cause.acquirer} купила ${watch.company}.` : `${watch.company} was acquired by ${watch.cause.acquirer}.`;
}

export type EventAudience = "holder" | "everyone" | "buyer";

/**
 * The event's one line (canon v5.2 §7, the card's words): a holder is told
 * to swap — «SpaceX вийшла на біржу. Обміняй SPACEX до 12 березня 2027 —
 * після строку токен згорить.» — everyone else reads that the token must be
 * swapped, and a buyer, before a purchase, that the token they buy must be.
 * A closed window says so: the deadline passed, the issuer no longer
 * supports the token.
 */
export function eventLine(event: WatchedEvent, audience: EventAudience, lang: Lang, nowMs: number): string {
  const { watch } = event;
  const day = deadlineDay(event.deadline, lang);
  if (windowState(event, nowMs) === "closed") {
    return lang === "uk"
      ? `${causeLine(watch, "uk")} Строк обміну ${watch.symbol} минув ${day} — емітент більше не підтримує токен.`
      : `${causeLine(watch, "en")} The swap deadline for ${watch.symbol} passed on ${day} — the issuer no longer supports the token.`;
  }
  if (lang === "uk") {
    const ask = audience === "holder" ? `Обміняй ${watch.symbol} до ${day}` : audience === "buyer" ? `Куплений ${watch.symbol} треба обміняти до ${day}` : `${watch.symbol} треба обміняти до ${day}`;
    return `${causeLine(watch, "uk")} ${ask} — після строку токен згорить.`;
  }
  const ask = audience === "holder" ? `Swap ${watch.symbol} by ${day}` : audience === "buyer" ? `${watch.symbol} you buy must be swapped by ${day}` : `${watch.symbol} must be swapped by ${day}`;
  return `${causeLine(watch, "en")} ${ask} — after the deadline the token expires worthless.`;
}

/** The event in a few words, for a row that has room for a label only: «Обміняй до 12 березня 2027» · «Строк обміну минув». */
export function shortEventLine(event: WatchedEvent, lang: Lang, nowMs: number): string {
  if (windowState(event, nowMs) === "closed") return lang === "uk" ? "Строк обміну минув" : "Swap deadline passed";
  const day = deadlineDay(event.deadline, lang);
  return lang === "uk" ? `Обміняй до ${day}` : `Swap by ${day}`;
}

/** «Обміняти на SpaceX (SPCXx)» — the one action; null when the issuer names no target Ryntra offers. */
export function swapActionWord(watch: ConversionWatch, lang: Lang): string | null {
  if (!watch.into) return null;
  return lang === "uk" ? `Обміняти на ${watch.into.company} (${watch.into.symbol})` : `Swap for ${watch.into.company} (${watch.into.symbol})`;
}

/** «Продати за USDC» — the quiet second action. */
export const SELL_FOR_USDC: Bi = { en: "Sell for USDC", uk: "Продати за USDC" };

function ukDays(days: number): string {
  const kind = new Intl.PluralRules("uk-UA").select(days);
  return `${days} ${kind === "one" ? "день" : kind === "few" ? "дні" : "днів"}`;
}

/** The words of one reminder — the note's title, its reason and its one action — in both languages. */
export type ConversionReminderWords = Readonly<Record<Lang, Readonly<{ title: string; reason: string; cta: string }>>>;

/**
 * A reminder's words. The first a holder gets — whatever stage stands when
 * Ryntra first sees them hold the token — tells what happened and what to do:
 * the event line itself, split into its two sentences. Every later one says
 * how many days are left on the day it is sent — the calendar's count, so a
 * reminder held back a day never says a stale number — then the same ask; the
 * day before the last and the last day say so. The action is always the one
 * swap; a note is never permission to trade — only the holder's signature
 * swaps.
 */
export function reminderWords(event: WatchedEvent, stage: ConversionStage, nowMs: number, first: boolean): ConversionReminderWords {
  const { watch } = event;
  const ask = (lang: Lang): string => {
    const day = deadlineDay(event.deadline, lang);
    return lang === "uk" ? `Обміняй ${watch.symbol} до ${day} — після строку токен згорить.` : `Swap ${watch.symbol} by ${day} — after the deadline the token expires worthless.`;
  };
  const cta = (lang: Lang): string => swapActionWord(watch, lang) ?? SELL_FOR_USDC[lang];
  const left = daysLeft(event, nowMs);
  const title = (lang: Lang): string => {
    if (first || stage === "event") return causeLine(watch, lang).replace(/\.$/, "");
    if (left === 0) return lang === "uk" ? `Сьогодні — останній день, щоб обміняти ${watch.symbol}` : `Today is the last day to swap ${watch.symbol}`;
    if (left === 1) return lang === "uk" ? `Завтра — останній день, щоб обміняти ${watch.symbol}` : `Tomorrow is the last day to swap ${watch.symbol}`;
    return lang === "uk" ? `Лишилося ${ukDays(left)}, щоб обміняти ${watch.symbol}` : `${left} days left to swap ${watch.symbol}`;
  };
  return {
    en: { title: title("en"), reason: ask("en"), cta: cta("en") },
    uk: { title: title("uk"), reason: ask("uk"), cta: cta("uk") },
  };
}

/** The trigger identity that makes a stage's reminder one note per holder: claimed once, never again. */
export function reminderIdentity(owner: string, mint: string, stage: ConversionStage): string {
  return `issuer-event:${mint}:${stage}@${owner}`;
}

/** Where a reminder's one action lands: the token's page, the swap's Review opening on arrival. */
export function swapHref(symbol: string): string {
  return `/app/stocks/${encodeURIComponent(symbol)}?convert=1&from=monitoring`;
}
