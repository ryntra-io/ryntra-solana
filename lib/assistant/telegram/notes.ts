/**
 * A notification's buttons in Telegram (AI-07): «Чому?», «Мій план», «Пауза»
 * — added by the monitoring delivery (lib/monitoring/deliver.ts) under the
 * link the note always had, when the production delivery passes them
 * (`TelegramDelivery.buttons`); a delivery without them sends the link alone.
 *
 * - A watch that rang (`token-watch`): «Чому? · N кредитів» asks the watch's
 *   own question at the price the button shows, «Мій план» shows the plans on
 *   that token, «Пауза» pauses the watch.
 * - «Ранковий огляд» (`assistant-brief`): «Пауза» turns the brief off.
 * - A plan's note (`trading-plan`, `prediction-plan`) and a position's
 *   warning: «Чому?» asks «why did I get this?» in the note's own context, as
 *   «Спитати Ryntra» does on the web; the note's own link already opens the
 *   plan («Мій план»). A plan is watched while it is active — its pause is
 *   the plan's own, on ryntra.io, never a button here.
 * - Every other note keeps the one link it had.
 *
 * The buttons only ask, show or pause; none of them trades, signs or pays.
 * The price on «Чому?» is the question's price from the credits' settings —
 * the bot asks at it only when it is still the price (`a:wy:<id>:<price>`).
 */

import { creditsOn } from "../credits/runtime.server.ts";
import { priceOf, resolveCreditsConfig } from "../credits/prices.ts";
import type { TgKeyboard } from "./render.ts";
import { credits, type TgLocale } from "./words.ts";

export type NoteForButtons = Readonly<{ id: string; owner?: string; subject?: Readonly<{ kind: string; id: string }> | null; locale: string }>;

const WATCH_ID = /^wch_[0-9a-f]{24}$/;
const INBOX_ID = /^inb_[0-9a-z_]{4,40}$/;

const WORD = {
  uk: { why: "Чому?", plan: "Мій план", pause: "Пауза" },
  en: { why: "Why?", plan: "My plan", pause: "Pause" },
} as const;

/** The buttons under a note: the link it always had, first, then the assistant's below it. */
export function noteKeyboard(note: NoteForButtons, link: Readonly<{ text: string; url: string }>, questionPrice: number | null): TgKeyboard {
  const locale: TgLocale = note.locale === "uk" ? "uk" : "en";
  const word = WORD[locale];
  const why = (data: string) => ({ text: questionPrice !== null && questionPrice > 0 ? `${word.why} · ${credits(locale, questionPrice)}` : word.why, callback_data: `${data}:${questionPrice ?? 0}` });
  const kind = note.subject?.kind ?? null;
  if (kind === "token-watch" && note.subject && WATCH_ID.test(note.subject.id)) {
    const id = note.subject.id;
    return [[link], [why(`a:wy:${id}`)], [{ text: word.plan, callback_data: `a:pl:${id}` }, { text: word.pause, callback_data: `a:wp:${id}` }]];
  }
  /* The brief's pause names its wallet by the first characters of the address — the account may prove more than one. */
  if (kind === "assistant-brief") return [[link], [{ text: word.pause, callback_data: note.owner ? `a:b0:${note.owner.slice(0, 12)}` : "a:b0" }]];
  if ((kind === "trading-plan" || kind === "prediction-plan" || kind === "position") && INBOX_ID.test(note.id)) return [[link], [why(`a:ny:${note.id}`)]];
  return [[link]];
}

/** The production buttons: the question's price from the credits' settings, none when the credits are off. */
export function assistantNoteButtons(note: NoteForButtons, link: Readonly<{ text: string; url: string }>, env: Readonly<Record<string, string | undefined>> = process.env): TgKeyboard {
  return noteKeyboard(note, link, creditsOn(env) ? priceOf(resolveCreditsConfig(env), "question") : null);
}
