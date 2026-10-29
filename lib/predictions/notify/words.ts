/**
 * What a prediction note says, in both languages — settlement's notes
 * and the limit orders', through the one channel.
 *
 * The note itself holds figures, never sentences: the words are made here, so
 * the same note reads in the person's own language in the app, in Telegram
 * and in a browser's notification, and a language added later needs no
 * rewriting of what was stored. The provider is not named in a note — a
 * person reads *the market was decided*, not the venue's status string.
 *
 * Pure.
 */

import { isWatchNoteKind, watchNoteWords } from "../watch/words.ts";
import type { Note, NoteWords } from "./notes.ts";

/** The two languages the product speaks, named here so the channel needs nothing of the pages. */
export type NoteLocale = "en" | "uk";

/** The notes settlement sends. A kind added later needs a line in both languages below. */
export const SETTLE_NOTE_KINDS = Object.freeze(["settle_due", "market_resolved", "win_credited", "win_unknown", "settle_late", "settle_disputed"] as const);
export type SettleNoteKind = (typeof SETTLE_NOTE_KINDS)[number];

const EN = {
  settle_due: { title: "Settles soon", cta: "Open the market" },
  market_resolved: { title: "Market decided", cta: "Open the market" },
  win_credited: { title: "Winnings credited", cta: "Open the portfolio" },
  win_unknown: { title: "Payout state unknown", cta: "Open the portfolio" },
  settle_late: { title: "Settlement delayed", cta: "Open the market" },
  settle_disputed: { title: "Settlement disputed", cta: "Open the market" },
} as const;

const UK = {
  settle_due: { title: "Скоро розрахунок", cta: "Відкрити ринок" },
  market_resolved: { title: "Ринок розрахувано", cta: "Відкрити ринок" },
  win_credited: { title: "Виграш зараховано", cta: "Відкрити портфель" },
  win_unknown: { title: "Стан виплати невідомий", cta: "Відкрити портфель" },
  settle_late: { title: "Розрахунок відкладено", cta: "Відкрити ринок" },
  settle_disputed: { title: "Спірний розрахунок", cta: "Відкрити ринок" },
} as const;

function money(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";
}

function question(facts: Note["facts"]): string {
  const text = typeof facts.question === "string" ? facts.question : "";
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

function bodyEn(note: Note): string {
  const q = question(note.facts);
  const paper = note.paper ? " Simulation — no real funds." : "";
  switch (note.kind as SettleNoteKind) {
    case "settle_due":
      return `${q} is decided within a day. Nothing to do: the result comes on its own.${paper}`;
    case "market_resolved":
      return note.facts.won === 1 ? `${q} — your side won. The payout comes on its own.${paper}` : `${q} — decided, and not your side.${paper}`;
    case "win_credited":
      return `${money(note.facts.amountUsd)} from ${q} is on your balance. The receipt is in the portfolio.${paper}`;
    case "win_unknown":
      return `The payout for ${q} was asked for and is not confirmed yet. Nothing is asked for twice — we check the same request.${paper}`;
    case "settle_late":
      return `${q} has not been decided when it was due. Nothing of yours is lost; we keep watching.${paper}`;
    case "settle_disputed":
      return `The result of ${q} is being disputed at the venue. No payout is due until it is settled.${paper}`;
    default:
      return q;
  }
}

function bodyUk(note: Note): string {
  const q = question(note.facts);
  const paper = note.paper ? " Симуляція — без реальних коштів." : "";
  switch (note.kind as SettleNoteKind) {
    case "settle_due":
      return `«${q}» розраховується протягом доби. Робити нічого не треба: результат прийде сам.${paper}`;
    case "market_resolved":
      return note.facts.won === 1 ? `«${q}» — ваша сторона виграла. Виплата прийде сама.${paper}` : `«${q}» — розраховано, і не на вашу сторону.${paper}`;
    case "win_credited":
      return `${money(note.facts.amountUsd)} з «${q}» на вашому балансі. Квитанція — у портфелі.${paper}`;
    case "win_unknown":
      return `Виплату за «${q}» попросили, і вона ще не підтверджена. Другого запиту немає — перевіряємо той самий.${paper}`;
    case "settle_late":
      return `«${q}» не розрахували у свій строк. Нічого вашого не втрачено; стежимо далі.${paper}`;
    case "settle_disputed":
      return `Результат «${q}» оспорюють на майданчику. До вирішення виплати немає.${paper}`;
    default:
      return q;
  }
}

/** One note's words. A count above one says how many times it happened, so a grouped note never hides the rest. */
export function settleNoteWords(note: Note, locale: NoteLocale): NoteWords {
  const table = locale === "uk" ? UK : EN;
  const head = table[note.kind as SettleNoteKind] ?? { title: note.kind, cta: locale === "uk" ? "Відкрити" : "Open" };
  return { title: `${head.title}${times(note, locale)}`, body: locale === "uk" ? bodyUk(note) : bodyEn(note), cta: head.cta };
}

function times(note: Note, locale: NoteLocale): string {
  return note.count > 1 ? (locale === "uk" ? ` · ${note.count} рази` : ` · ${note.count}×`) : "";
}

/* ------------------------------------------------------------------ limit orders */

/** The notes a limit order sends. A kind added later needs a line in both languages below. */
export const LIMIT_NOTE_KINDS = Object.freeze(["limit_filled", "limit_partial", "limit_cancelled", "limit_expired"] as const);
export type LimitNoteKind = (typeof LIMIT_NOTE_KINDS)[number];

const LIMIT_EN = {
  limit_filled: { title: "Limit order filled", cta: "Open the market" },
  limit_partial: { title: "Limit order partly filled", cta: "Open the market" },
  limit_cancelled: { title: "Limit order cancelled", cta: "Open the market" },
  limit_expired: { title: "Limit order lapsed", cta: "Open the market" },
} as const;

const LIMIT_UK = {
  limit_filled: { title: "Лімітний ордер виконано", cta: "Відкрити ринок" },
  limit_partial: { title: "Лімітний ордер виконано частково", cta: "Відкрити ринок" },
  limit_cancelled: { title: "Лімітний ордер скасовано", cta: "Відкрити ринок" },
  limit_expired: { title: "Строк лімітного ордера минув", cta: "Відкрити ринок" },
} as const;

function count(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

function price(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function limitBodyEn(note: Note): string {
  const q = question(note.facts);
  const paper = note.paper ? " Simulation — no real funds." : "";
  const at = price(note.facts.price);
  switch (note.kind as LimitNoteKind) {
    case "limit_filled":
      return `${count(note.facts.filledShares)} shares of ${q} at ${at} — ${money(note.facts.filledUsd)} in all. It is a position now.${paper}`;
    case "limit_partial":
      return `${count(note.facts.filledShares)} of ${count(note.facts.shares)} shares of ${q} filled at ${at}. The rest is still on the venue; you can cancel it in one act.${paper}`;
    case "limit_cancelled":
      return `Your order on ${q} at ${at} is cancelled. What had filled stays yours.${paper}`;
    case "limit_expired":
      return `Your order on ${q} at ${at} stood out its time and lapsed. Nothing unfilled was spent.${paper}`;
    default:
      return q;
  }
}

function limitBodyUk(note: Note): string {
  const q = question(note.facts);
  const paper = note.paper ? " Симуляція — без реальних коштів." : "";
  const at = price(note.facts.price);
  switch (note.kind as LimitNoteKind) {
    case "limit_filled":
      return `${count(note.facts.filledShares)} акцій «${q}» за ${at} — усього ${money(note.facts.filledUsd)}. Тепер це позиція.${paper}`;
    case "limit_partial":
      return `Виконано ${count(note.facts.filledShares)} з ${count(note.facts.shares)} акцій «${q}» за ${at}. Решта стоїть на майданчику; її можна скасувати однією дією.${paper}`;
    case "limit_cancelled":
      return `Ваш ордер на «${q}» за ${at} скасовано. Те, що вже виконалось, лишається вашим.${paper}`;
    case "limit_expired":
      return `Ваш ордер на «${q}» за ${at} відстояв свій строк і погас. Нічого невиконаного не витрачено.${paper}`;
    default:
      return q;
  }
}

/** One limit-order note's words. */
export function limitNoteWords(note: Note, locale: NoteLocale): NoteWords {
  const table = locale === "uk" ? LIMIT_UK : LIMIT_EN;
  const head = table[note.kind as LimitNoteKind] ?? { title: note.kind, cta: locale === "uk" ? "Відкрити" : "Open" };
  return { title: `${head.title}${times(note, locale)}`, body: locale === "uk" ? limitBodyUk(note) : limitBodyEn(note), cta: head.cta };
}

/** The words of any prediction note, whichever caller wrote it.
 *
 * Three callers write into the one channel — settlement, a limit order and a
 * market watch — and a pass that delivers what is due finds all three kinds
 * waiting. Each kind's words belong to whoever wrote it, so this does nothing
 * but send a note to its own vocabulary; a kind nobody claims still reads as
 * something rather than as a code. */
export function predictionNoteWords(note: Note, locale: NoteLocale): NoteWords {
  if (isWatchNoteKind(note.kind)) return watchNoteWords(note, locale);
  return (LIMIT_NOTE_KINDS as readonly string[]).includes(note.kind) ? limitNoteWords(note, locale) : settleNoteWords(note, locale);
}
