/**
 * The issuer's own notice on a PreStocks product page, read again every day
 * by the IPO and conversion watch (`issuer-notices.server.ts`) and held
 * against the registry of events (`lifecycle-events.ts`).
 *
 * PreStocks publishes an event in one place only — a banner on the
 * company's product page: «SpaceX has gone public! SpaceX PreStocks tokens
 * must be swapped into $SPCXx or any other token before 11:59pm UTC on 12
 * March 2027, or they will expire worthless.» Its API says nothing about a
 * window. So the daily read looks for that sentence and its cut-off, and the
 * comparison says whether the registry still tells the truth: the same
 * notice and the same minute, a notice the registry does not carry, a
 * different cut-off, a notice that is gone, or a page that could not be read.
 *
 * A finding is for a person to verify and write into the registry; a parser
 * never writes an event a holder is told about. Pure: the page's HTML is
 * handed in.
 */

import type { LifecycleEvent } from "./instrument.ts";

export type IssuerNotice = Readonly<{
  /** Why the window opened, as the notice words it. */
  cause: "ipo" | "acquisition" | "unstated";
  /** The notice's sentence up to «worthless», as plain text. */
  text: string;
  /** The cut-off the notice states, ISO; null when its wording could not be read as a moment. */
  deadline: string | null;
}>;

const MONTHS: Readonly<Record<string, number>> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** A page's HTML as the words a person reads: no scripts, styles or tags; entities a notice uses decoded. */
export function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** «11:59pm UTC on 12 March 2027» → the ISO moment; null for any other wording. */
export function cutOffOf(sentence: string): string | null {
  const found = /before\s+(\d{1,2}):(\d{2})\s*([ap]m)\s*UTC\s+on\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(sentence);
  if (!found) return null;
  const [, hourText, minuteText, half, dayText, monthText, yearText] = found;
  const month = MONTHS[monthText.toLowerCase()];
  const hour12 = Number(hourText);
  const minute = Number(minuteText);
  const day = Number(dayText);
  const year = Number(yearText);
  if (month === undefined || hour12 < 1 || hour12 > 12 || minute > 59 || day < 1 || day > 31) return null;
  const hour = (hour12 % 12) + (half.toLowerCase() === "pm" ? 12 : 0);
  const at = new Date(Date.UTC(year, month, day, hour, minute));
  /* A day the month does not have rolls over in Date.UTC — not a cut-off the issuer wrote. */
  if (at.getUTCDate() !== day || at.getUTCMonth() !== month) return null;
  return at.toISOString();
}

/** The notice on a product page, or null when the page carries none. */
export function noticeOnPage(html: string): IssuerNotice | null {
  const text = pageText(html);
  const swap = /must be swapped[\s\S]{0,320}?worthless/i.exec(text);
  if (!swap) return null;
  /* The notice begins with its cause, a short way before the ask: «SpaceX has gone public!» · «xAI was acquired by SpaceX.» */
  const before = text.slice(Math.max(0, swap.index - 220), swap.index);
  const causeAt = before.search(/\S+\s+(has gone public|was acquired)/i);
  const start = causeAt >= 0 ? swap.index - before.length + causeAt : Math.max(0, swap.index - 120);
  const sentence = text.slice(start, swap.index + swap[0].length).replace(/^[^A-Za-z0-9$]+/, "").trim();
  const cause = /has gone public/i.test(sentence) ? "ipo" : /was acquired/i.test(sentence) ? "acquisition" : "unstated";
  return { cause, text: sentence, deadline: cutOffOf(sentence) };
}

export type NoticeFinding =
  /** The page and the registry say the same: no notice and no event, or the same cut-off to the minute. */
  | "agrees"
  /** The page carries a notice the registry does not: an event to verify and write. */
  | "new-notice"
  /** Both carry the event, with different cut-offs. */
  | "deadline-differs"
  /** The registry carries an event whose notice the page no longer shows. */
  | "notice-gone"
  /** The page could not be read today. */
  | "unreadable";

/** One page's notice held against the registry's event for the same mint. */
export function noticeFinding(notice: IssuerNotice | null | "unreadable", event: LifecycleEvent | null): NoticeFinding {
  if (notice === "unreadable") return "unreadable";
  if (notice === null) return event ? "notice-gone" : "agrees";
  if (!event) return "new-notice";
  if (notice.deadline === null || event.deadline === null) return notice.deadline === event.deadline ? "agrees" : "deadline-differs";
  return Date.parse(notice.deadline) === Date.parse(event.deadline) ? "agrees" : "deadline-differs";
}
