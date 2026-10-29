/**
 * A token watch's note in words (AI-05): the fact and its number in the
 * title, then where it was read, when (UTC) and the person's own threshold —
 * one short block, both languages, so the inbox, Telegram and the phone say
 * the same thing. A note is never advice: it says what was measured against
 * what the person set, and nothing about what to do.
 */

import type { WatchFigure } from "./evaluate.ts";
import { pctSigned, ruleWords, usd, usdShort, windowWords, type WatchLocale, type WatchRule } from "./rules.ts";

export type NoteWords = Readonly<{ title: string; reason: string }>;

/** «14:05 UTC» — a note's time is always UTC (PLAN §4), the reader's own clock is the page's. */
export function utcTime(at: string): string {
  return `${at.slice(11, 16)} UTC`;
}

export function noteWords(rule: WatchRule, symbol: string, figure: WatchFigure, locale: WatchLocale): NoteWords {
  const uk = locale === "uk";
  const where = `${figure.source}, ${utcTime(figure.observedAt)}`;
  const threshold = uk ? `Твій поріг — ${ruleWords(rule, locale).toLowerCase()}.` : `Your threshold: ${ruleWords(rule, locale).toLowerCase()}.`;
  switch (rule.kind) {
    case "price":
      return {
        title: rule.direction === "below" ? (uk ? `${symbol} нижче ${usd(rule.level, locale)}` : `${symbol} below ${usd(rule.level, locale)}`) : uk ? `${symbol} вище ${usd(rule.level, locale)}` : `${symbol} above ${usd(rule.level, locale)}`,
        reason: uk ? `Ціна ${usd(figure.value, locale)} (${where}). ${threshold}` : `Price ${usd(figure.value, locale)} (${where}). ${threshold}`,
      };
    case "move": {
      const span = windowWords(rule.window, locale);
      const price = figure.beside !== null ? (uk ? ` Ціна ${usd(figure.beside, locale)}.` : ` Price ${usd(figure.beside, locale)}.`) : "";
      return {
        title: uk ? `${symbol} ${pctSigned(figure.value, locale)} за ${span}` : `${symbol} ${pctSigned(figure.value, locale)} in ${span}`,
        reason: `${uk ? "За даними" : "Per"} ${where}.${price} ${threshold}`,
      };
    }
    case "volume": {
      const ratio = figure.value.toLocaleString(uk ? "uk-UA" : "en-US", { maximumFractionDigits: 1 });
      const hour = figure.beside ?? 0;
      const usual = figure.value > 0 ? hour / figure.value : 0;
      return {
        title: uk ? `${symbol}: обсяг за годину ×${ratio}` : `${symbol}: hourly volume ×${ratio}`,
        reason: uk ? `${usdShort(hour, locale)} за годину проти звичних ${usdShort(usual, locale)} (${where}). ${threshold}` : `${usdShort(hour, locale)} in the hour against the usual ${usdShort(usual, locale)} (${where}). ${threshold}`,
      };
    }
    case "liquidity": {
      const span = windowWords(rule.window, locale);
      const what = rule.pool ? (uk ? "ліквідність пулу" : "pool liquidity") : uk ? "ліквідність" : "liquidity";
      const now = figure.beside !== null ? usdShort(figure.beside, locale) : "—";
      return {
        title: uk ? `${symbol}: ${what} ${pctSigned(figure.value, locale)} за ${span}` : `${symbol}: ${what} ${pctSigned(figure.value, locale)} in ${span}`,
        reason: uk ? `Зараз ${now} (${where}). ${threshold}` : `Now ${now} (${where}). ${threshold}`,
      };
    }
  }
}

/** The note's one action: the watch on the assistant's page, where «Пауза», «Змінити», «Вимкнути» and «Чому?» are. */
export const WATCH_CTA: Readonly<Record<WatchLocale, string>> = { en: "Manage the watch", uk: "Керувати стеженням" };

export function watchHref(id: string): string {
  return /^wch_[0-9a-f]{24}$/.test(id) ? `/app/ryn?watch=${id}` : "/app/ryn?watch=all";
}

/** The question «Чому?» puts to the assistant — asked only when the person presses it, at the price shown. */
export function explainQuestion(words: NoteWords, locale: WatchLocale): string {
  return locale === "uk" ? `Поясни сповіщення: ${words.title}. Що відомо з джерел — без вигадок?` : `Explain this alert: ${words.title}. What do the sources say — nothing made up?`;
}
