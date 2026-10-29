/**
 * The words of «Ранковий огляд» as the note, Telegram and push carry them
 * (AI-10). Pure. The brief is the model's blocks over the server's lines;
 * a part without words is its lines alone — never a sentence of the
 * server's written in the model's place. What could not be read is said as
 * not read, never as «nothing changed».
 */

import { lineSentence, type BriefLine, type BriefLocale } from "./lines.ts";
import type { BriefRecord } from "./store.ts";

export const BRIEF_CTA: Readonly<Record<BriefLocale, string>> = { uk: "Відкрити огляд", en: "Open the brief" };

const PART: Readonly<Record<BriefLocale, Readonly<{ market: string; personal: string; quiet: string; unread: string; marketUnread: string }>>> = {
  uk: {
    market: "Сьогодні на ринку",
    personal: "Твої токени, позиції й плани",
    quiet: "У твоїх токенах, позиціях і планах за добу нічого не змінилось.",
    unread: "Твої токени й плани зараз не прочитались — змін тут не показано.",
    marketUnread: "Ринок зараз не прочитався — цифр тут немає.",
  },
  en: {
    market: "Today in the market",
    personal: "Your tokens, positions and plans",
    quiet: "Nothing changed in your tokens, positions and plans over the day.",
    unread: "Your tokens and plans could not be read just now — no changes are shown here.",
    marketUnread: "The market could not be read just now — no figures here.",
  },
};

export function partTitle(part: "market" | "personal", locale: BriefLocale): string {
  return PART[locale][part];
}

/** The person's part without lines: nothing changed — or, when a read did not answer, that it was not read. */
export function quietLine(locale: BriefLocale, state: "unchanged" | "unread" = "unchanged"): string {
  return state === "unread" ? PART[locale].unread : PART[locale].quiet;
}

export function marketUnreadLine(locale: BriefLocale): string {
  return PART[locale].marketUnread;
}

/** What of the person's own was not read, in one block — or null when everything answered. */
export function gapLine(gap: BriefRecord["personalGap"], locale: BriefLocale): string | null {
  if (!gap) return null;
  const parts: string[] = [];
  if (gap.wallet === "unread") parts.push(locale === "uk" ? "гаманець" : "wallet");
  if (gap.wallet === "partial") parts.push(locale === "uk" ? "частина гаманця" : "part of wallet");
  if (gap.tokens > 0) parts.push(locale === "uk" ? `${gap.tokens}/${gap.of} токенів` : `${gap.tokens}/${gap.of} tokens`);
  if (gap.list) parts.push(locale === "uk" ? "список" : "watchlist");
  if (gap.notes) parts.push(locale === "uk" ? "нотатки Нагляду" : "Monitoring notes");
  const more = gap.more > 0 ? (locale === "uk" ? `Ще змін: ${gap.more}, не показано.` : `${gap.more} more changes not shown.`) : null;
  const hidden = gap.hidden > 0 ? (locale === "uk" ? `Неперевірені токени змінились за добу: ${gap.hidden} — їх тут не названо.` : `Unverified tokens moved over the day: ${gap.hidden} — not named here.`) : null;
  const unread = parts.length > 0 ? (locale === "uk" ? `Не прочитано: ${parts.join(", ")}.` : `Not read: ${parts.join(", ")}.`) : null;
  const said = [unread, hidden, more].filter(Boolean).join(" ");
  return said || null;
}

/**
 * What the person's part says beside its lines, or instead of them: what was
 * not read or not named when there is any of it; «nothing changed» only when
 * every read answered and nothing changed.
 */
export function personalNote(record: Pick<BriefRecord, "personal" | "personalState" | "personalGap">, locale: BriefLocale): string | null {
  const gap = gapLine(record.personalGap, locale);
  /* A note is one block of two lines on a phone: the first clauses stand, the rest is cut at a word. */
  const fit = (text: string | null) => (text && text.length > 200 ? `${text.slice(0, 199).replace(/\s+\S*$/u, "")}…` : text);
  if (record.personal) return fit(gap);
  if (record.personalState === "unread") return fit(gap ? `${quietLine(locale, "unread")} ${gap}` : quietLine(locale, "unread"));
  if (record.personalState === "changed") return fit(gap);
  return quietLine(locale, "unchanged");
}

/** «18 жовтня» / «18 October» — the person's day, never a time zone's guess. */
export function dayLabel(day: string, locale: BriefLocale): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(locale === "uk" ? "uk-UA" : "en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

export function briefTitle(day: string, locale: BriefLocale): string {
  return locale === "uk" ? `Ранковий огляд · ${dayLabel(day, locale)}` : `Morning brief · ${dayLabel(day, locale)}`;
}

type Parts = Pick<BriefRecord, "market" | "personal" | "personalState" | "personalGap"> & Partial<Pick<BriefRecord, "zone">>;

/** The brief's whole text — what Telegram sends: each part, its words, then its lines with their sources and times. */
export function briefNoteText(record: Parts, locale: BriefLocale, max = 3_600): string {
  const bullet = (line: BriefLine) => `• ${lineSentence(line, locale, record.zone ?? "UTC")}`;
  const out: string[] = [partTitle("market", locale)];
  out.push(...(record.market.words?.[locale] ?? []));
  if (record.market.lines.length === 0) out.push(marketUnreadLine(locale));
  out.push(...record.market.lines.map(bullet));
  out.push("", partTitle("personal", locale));
  if (record.personal) {
    out.push(...(record.personal.words ?? []));
    out.push(...record.personal.lines.map(bullet));
  }
  const note = personalNote(record, locale);
  if (note) out.push(note);
  const text = out.join("\n");
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/u, "")}…`;
}

/**
 * The note's own words in the inbox — one block a person reads in two lines:
 * the person's own words when something of theirs changed, else the
 * market's, else what is known plainly. The whole brief is one tap away.
 */
export function briefReason(record: Parts, locale: BriefLocale): string {
  const own = record.personal?.words?.[0];
  if (own) return own;
  const market = record.market.words?.[locale]?.[0];
  if (record.personal) return locale === "uk" ? `Змін у твоїх токенах і планах за добу: ${record.personal.lines.length} — подробиці в огляді.` : `Changes in your tokens and plans over the day: ${record.personal.lines.length} — the details are in the brief.`;
  if (market) return market;
  return record.market.lines.length > 0 ? lineSentence(record.market.lines[0], locale, record.zone ?? "UTC") : marketUnreadLine(locale);
}
