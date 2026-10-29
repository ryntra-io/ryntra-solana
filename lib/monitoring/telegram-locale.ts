/**
 * A note in Telegram in the language the person reads Telegram in (SOL-C15): the audit found «Time for your
 * purchase» in English among Ukrainian messages. A reminder is written in the language of the screen its rule was
 * made on, a plan's note in the language of the tick that found it (English, from the cron), while the person talks
 * to Ryntra's bot in the chat's own language (`ChatRecord.locale`: Telegram's own at the binding, then the chat's
 * «Мова»). The delivery now says the note in the chat's language wherever the note can be said there whole — its
 * title, its reason and its button together — and otherwise keeps the note whole in its own language: never a message
 * half in one language and half in the other.
 *
 * Pure: the chat's language is read by the delivery (`deliver.ts`), this only says the note in it. Nothing here
 * trades, signs or pays; a note is never permission to trade.
 */

import { usdWord } from "../autoinvest/words.ts";
import { MONITORING_WORDS } from "./copy.ts";
import type { InboxRecord } from "./store.ts";

export type NoteLocale = "en" | "uk";

/** «$1,234.50» · «$1 234,50» — a figure `usdWord` wrote, back to the number; null for anything else. */
export function usdFromWord(text: string, locale: NoteLocale): number | null {
  const match = /^\$([0-9][0-9\s  .,]*)$/u.exec(text.trim());
  if (!match) return null;
  const spaced = match[1].replace(/[\s  ]/gu, "");
  const plain = locale === "uk" ? spaced.replace(/\./g, "").replace(",", ".") : spaced.replace(/,/g, "");
  if (!/^[0-9]+(\.[0-9]{1,2})?$/u.test(plain)) return null;
  const value = Number(plain);
  return Number.isFinite(value) ? value : null;
}

/** A recurring buy's button, as `reminderWords` and its siblings write it: «Buy $10» · «Купити $10». */
const BUY: Readonly<Record<NoteLocale, RegExp>> = { en: /^Buy (\$.+)$/u, uk: /^Купити (\$.+)$/u };

/** The note's button in `locale`: Нагляд's own word or a reminder's «Купити $N» said there; null when it cannot be. */
export function buttonIn(note: Pick<InboxRecord, "cta" | "locale">, locale: NoteLocale): string | null {
  if (note.locale === locale) return note.cta;
  for (const word of Object.values(MONITORING_WORDS)) {
    if (word[note.locale] === note.cta) return word[locale];
  }
  const buy = BUY[note.locale].exec(note.cta);
  const usd = buy ? usdFromWord(buy[1], note.locale) : null;
  if (usd !== null) return locale === "uk" ? `Купити ${usdWord(usd, "uk")}` : `Buy ${usdWord(usd, "en")}`;
  return null;
}

/**
 * The note as Telegram says it in `locale`: its words in that language where the note holds them (`text`) and its
 * button can be said there too — the record then names `locale` as its own, so the message, the assistant's buttons
 * under it and the brief all follow; otherwise the note as it was written.
 */
export function noteForChat(note: InboxRecord, locale: NoteLocale | null): InboxRecord {
  if (locale === null || note.locale === locale) return note;
  const words = note.text?.[locale];
  const cta = buttonIn(note, locale);
  if (!words || cta === null) return note;
  return { ...note, title: words.title, reason: words.reason, cta, locale };
}
