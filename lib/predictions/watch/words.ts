/**
 * What a watch says, in both languages.
 *
 * A signal holds figures, never sentences — so the same signal reads in the
 * person's own language in the app, in a chat and in a browser's
 * notification, and a language added later rewrites nothing that was stored.
 * The sentences are made from the figures the engine compared and from
 * nothing else: there is no room here for a figure the engine did not read.
 *
 * Every line is about what happened, never about what to do. A watch does not
 * advise, and no sentence here may read as a recommendation to buy, sell or
 * hold — that is a rule of the product, not a matter of tone.
 *
 * Pure.
 */

import type { Note, NoteWords } from "../notify/notes.ts";
import type { WatchRuleKind } from "./rules.ts";

export type WatchLocale = "en" | "uk";

/** The notes a watch sends. One kind per rule kind, so a person can tell at a glance which of their watches rang. */
export const WATCH_NOTE_KINDS = Object.freeze([
  "watch_price",
  "watch_probability_move",
  "watch_volume_spike",
  "watch_liquidity",
  "watch_news",
  "watch_resolution",
  "watch_position_value",
  "watch_venue_spread",
  "watch_related_move",
] as const);
export type WatchNoteKind = (typeof WATCH_NOTE_KINDS)[number];

export const watchNoteKind = (kind: WatchRuleKind): WatchNoteKind => `watch_${kind}` as WatchNoteKind;
export const isWatchNoteKind = (kind: string): kind is WatchNoteKind => (WATCH_NOTE_KINDS as readonly string[]).includes(kind);

const HEAD: Readonly<Record<WatchNoteKind, Readonly<Record<WatchLocale, Readonly<{ title: string; cta: string }>>>>> = {
  watch_price: { en: { title: "Price crossed your level", cta: "Open the market" }, uk: { title: "Ціна перетнула вашу межу", cta: "Відкрити ринок" } },
  watch_probability_move: { en: { title: "The probability moved", cta: "Open the market" }, uk: { title: "Ймовірність зрушила", cta: "Відкрити ринок" } },
  watch_volume_spike: { en: { title: "Trading picked up", cta: "Open the market" }, uk: { title: "Торгівля пожвавилась", cta: "Відкрити ринок" } },
  watch_liquidity: { en: { title: "The book got harder to trade", cta: "Open the book" }, uk: { title: "Стакан став важчим", cta: "Відкрити стакан" } },
  watch_news: { en: { title: "News on your market", cta: "Open the market" }, uk: { title: "Новина на вашому ринку", cta: "Відкрити ринок" } },
  watch_resolution: { en: { title: "The terms moved", cta: "Open the rules" }, uk: { title: "Умови змінились", cta: "Відкрити правила" } },
  watch_position_value: { en: { title: "Your position crossed your level", cta: "Open the portfolio" }, uk: { title: "Ваша позиція перетнула межу", cta: "Відкрити портфель" } },
  watch_venue_spread: { en: { title: "The venues disagree", cta: "Compare the venues" }, uk: { title: "Майданчики розійшлись", cta: "Порівняти майданчики" } },
  watch_related_move: { en: { title: "A linked market moved", cta: "Open the linked market" }, uk: { title: "Пов'язаний ринок зрушив", cta: "Відкрити пов'язаний ринок" } },
};

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

const pct = (value: unknown): string => {
  const n = num(value);
  return n === null ? "—" : `${(n * 100).toFixed(n * 100 < 10 ? 1 : 0)}%`;
};
const points = (value: unknown): string => {
  const n = num(value);
  return n === null ? "—" : `${Math.abs(n * 100).toFixed(Math.abs(n * 100) < 10 ? 1 : 0)}`;
};
const money = (value: unknown): string => {
  const n = num(value);
  return n === null ? "—" : `$${n.toFixed(2)}`;
};
const times = (value: unknown): string => {
  const n = num(value);
  return n === null ? "—" : `${n.toFixed(1)}×`;
};

/** The period in the words people use for it, rather than in minutes. */
export function periodWords(minutes: unknown, locale: WatchLocale): string {
  const n = num(minutes);
  if (n === null) return locale === "uk" ? "за період" : "over the period";
  if (n < 90) return locale === "uk" ? `за ${Math.round(n)} хв` : `in ${Math.round(n)} min`;
  if (n < 1_440) return locale === "uk" ? `за ${Math.round(n / 60)} год` : `in ${Math.round(n / 60)} h`;
  const days = Math.round(n / 1_440);
  if (days === 1) return locale === "uk" ? "за добу" : "in a day";
  if (days === 7) return locale === "uk" ? "за тиждень" : "in a week";
  return locale === "uk" ? `за ${days} дн.` : `in ${days} days`;
}

const clip = (text: string, limit = 140) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/**
 * The sentence a signal's own figures make. This is the whole of what Ryntra
 * is prepared to state without a model: the figure that moved, the level it
 * crossed, the period it took. A model's sentence is added beside it, never
 * in place of it.
 */
export function watchSentence(kind: string, facts: Note["facts"], locale: WatchLocale): string {
  const uk = locale === "uk";
  const subject = clip(str(facts.question) || str(facts.eventTitle));
  const side = str(facts.outcomeLabel);
  const named = side ? (uk ? `«${side}» на «${subject}»` : `${side} on ${subject}`) : uk ? `«${subject}»` : subject;
  switch (kind as WatchNoteKind) {
    case "watch_price":
      return uk
        ? `${named}: ${pct(facts.now)} — ${str(facts.way) === "below" ? "нижче" : "вище"} вашої межі ${pct(facts.level)} (було ${pct(facts.was)}).`
        : `${named} is ${pct(facts.now)} — ${str(facts.way) === "below" ? "below" : "above"} your level of ${pct(facts.level)} (it was ${pct(facts.was)}).`;
    case "watch_probability_move":
      return uk
        ? `${named}: ${str(facts.way) === "below" ? "−" : "+"}${points(facts.change)} п. п. ${periodWords(facts.windowMinutes, "uk")} — з ${pct(facts.was)} до ${pct(facts.now)}.`
        : `${named} moved ${str(facts.way) === "below" ? "−" : "+"}${points(facts.change)} points ${periodWords(facts.windowMinutes, "en")} — from ${pct(facts.was)} to ${pct(facts.now)}.`;
    case "watch_volume_spike":
      return uk
        ? `${named}: остання година торгувала ${times(facts.pace)} від звичного ${periodWords(facts.windowMinutes, "uk")} (${money(facts.volume)} проти ${money(facts.average)}).`
        : `${named}: the last hour traded ${times(facts.pace)} its usual pace ${periodWords(facts.windowMinutes, "en")} (${money(facts.volume)} against ${money(facts.average)}).`;
    case "watch_liquidity": {
      const which = str(facts.which);
      const what =
        which === "wide" ? (uk ? `спред ${points(facts.spread)} п. п.` : `the spread is ${points(facts.spread)} points`)
        : which === "thin" ? (uk ? `у стакані ${money(facts.depthUsd)} поблизу ціни` : `the book holds ${money(facts.depthUsd)} near the price`)
        : uk ? `спред ${points(facts.spread)} п. п., у стакані ${money(facts.depthUsd)}`
        : `the spread is ${points(facts.spread)} points and the book holds ${money(facts.depthUsd)}`;
      return uk ? `${named}: ${what} — вийти чи зайти зараз дорожче.` : `${named}: ${what} — getting in or out costs more now.`;
    }
    case "watch_news": {
      const more = num(facts.more) ?? 0;
      const tail = more > 0 ? (uk ? ` І ще ${more}.` : ` And ${more} more.`) : "";
      return uk ? `${named}. ${clip(str(facts.headline), 180)} — ${str(facts.source)}.${tail}` : `${named}. ${clip(str(facts.headline), 180)} — ${str(facts.source)}.${tail}`;
    }
    case "watch_resolution": {
      const which = str(facts.which);
      const moved = str(facts.moved);
      const what =
        which === "late" ? (uk ? `результат прострочено на ${Math.round((num(facts.lateMinutes) ?? 0) / 60)} год` : `the result is ${Math.round((num(facts.lateMinutes) ?? 0) / 60)} h overdue`)
        : moved.includes("closes") || moved.includes("resolves") ? (uk ? "майданчик зрушив дату" : "the venue moved a date")
        : uk ? "майданчик переписав правила" : "the venue rewrote the rules";
      return uk ? `${named}: ${what}. Що саме змінилось — у «Правилах».` : `${named}: ${what}. What exactly changed is in the rules.`;
    }
    case "watch_position_value":
      return uk
        ? `${named}: ваша позиція ${money(facts.now)} — ${str(facts.way) === "below" ? "нижче" : "вище"} межі ${money(facts.level)} (було ${money(facts.was)}).`
        : `${named}: your position is ${money(facts.now)} — ${str(facts.way) === "below" ? "below" : "above"} your level of ${money(facts.level)} (it was ${money(facts.was)}).`;
    case "watch_venue_spread":
      return uk
        ? `${named}: ${str(facts.high)} ${pct(facts.highPrice)}, ${str(facts.low)} ${pct(facts.lowPrice)} — розбіжність ${points(facts.gap)} п. п. Це лише спостереження; до угоди — нове котирування.`
        : `${named}: ${str(facts.high)} is at ${pct(facts.highPrice)}, ${str(facts.low)} at ${pct(facts.lowPrice)} — ${points(facts.gap)} points apart. This is an observation only; a trade needs a fresh quote.`;
    case "watch_related_move": {
      const more = num(facts.more) ?? 0;
      const tail = more > 0 ? (uk ? ` Рухалось і ще ${more}.` : ` ${more} more moved too.`) : "";
      return uk
        ? `${named}: пов'язаний ринок «${clip(str(facts.linkedQuestion))}» ${str(facts.way) === "below" ? "−" : "+"}${points(facts.change)} п. п. ${periodWords(facts.windowMinutes, "uk")}. Це тематичний зв'язок, а не доведена причина.${tail}`
        : `${named}: the linked market ${clip(str(facts.linkedQuestion))} moved ${str(facts.way) === "below" ? "−" : "+"}${points(facts.change)} points ${periodWords(facts.windowMinutes, "en")}. The link is thematic, not a proven cause.${tail}`;
    }
    default:
      return named;
  }
}

/**
 * One watch note's words. The explanation a model wrote — held to these same
 * figures before it was kept — follows the engine's own sentence; without one,
 * the engine's sentence stands alone and nothing is missing.
 */
export function watchNoteWords(note: Note, locale: WatchLocale): NoteWords {
  const head = HEAD[note.kind as WatchNoteKind]?.[locale] ?? { title: note.kind, cta: locale === "uk" ? "Відкрити" : "Open" };
  const times = note.count > 1 ? (locale === "uk" ? ` · ${note.count} рази` : ` · ${note.count}×`) : "";
  const said = watchSentence(note.kind, note.facts, locale);
  const explained = typeof note.facts.explanation === "string" && note.facts.explanation.length > 0 ? ` ${note.facts.explanation}` : "";
  const paper = note.paper ? (locale === "uk" ? " Симуляція — без реальних коштів." : " Simulation — no real funds.") : "";
  return { title: `${head.title}${times}`, body: `${said}${explained}${paper}`, cta: head.cta };
}

/** What a rule watches, said back to the person who set it. */
export function ruleSentence(kind: WatchRuleKind, direction: string, threshold: number | null, windowMinutes: number | null, locale: WatchLocale): string {
  const uk = locale === "uk";
  const way = direction === "below" ? (uk ? "нижче" : "below") : direction === "above" ? (uk ? "вище" : "above") : uk ? "на" : "by";
  switch (kind) {
    case "price":
      return uk ? `ціна ${way} ${pct(threshold)}` : `the price goes ${way} ${pct(threshold)}`;
    case "probability_move":
      return uk ? `ймовірність рухнула ${direction === "any" ? "на" : way} ${points(threshold)} п. п. ${periodWords(windowMinutes, "uk")}` : `the probability moves ${direction === "any" ? "by" : way} ${points(threshold)} points ${periodWords(windowMinutes, "en")}`;
    case "volume_spike":
      return uk ? `обсяг за годину ${times(threshold)} від звичного ${periodWords(windowMinutes, "uk")}` : `an hour trades ${times(threshold)} the usual pace ${periodWords(windowMinutes, "en")}`;
    case "liquidity":
      return direction === "above"
        ? uk ? `спред ширший за ${points(threshold)} п. п.` : `the spread is wider than ${points(threshold)} points`
        : direction === "below"
          ? uk ? `у стакані менше ${money(threshold)} поблизу ціни` : `the book holds less than ${money(threshold)} near the price`
          : uk ? "стакан тонкий або спред широкий — за мірою Ryntra" : "the book is thin or the spread is wide, by Ryntra's own measure";
    case "news":
      return uk ? "вийшла новина про цей ринок" : "news comes out about this market";
    case "resolution":
      return uk ? "змінились правила, зрушила дата або прострочено результат" : "the rules change, a date moves or the result is overdue";
    case "position_value":
      return uk ? `моя позиція ${way} ${money(threshold)}` : `my position goes ${way} ${money(threshold)}`;
    case "venue_spread":
      return uk ? `майданчики розійшлись на ${points(threshold)} п. п.` : `the venues are ${points(threshold)} points apart`;
    case "related_move":
      return uk ? `пов'язаний ринок рухнув на ${points(threshold)} п. п. ${periodWords(windowMinutes, "uk")}` : `a linked market moves ${points(threshold)} points ${periodWords(windowMinutes, "en")}`;
    default:
      return kind;
  }
}
