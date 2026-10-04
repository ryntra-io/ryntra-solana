/**
 * Suggested questions — the ones a person can ask without learning the
 * product's vocabulary. Deterministic, free, by the context the
 * conversation was opened from.
 */

import type { AgentContext, AgentSuggestion } from "../api/v1/contract.ts";

type Locale = "en" | "uk";

const pick = (locale: Locale, en: string, uk: string): string => (locale === "uk" ? uk : en);

export function suggestionsFor(context: AgentContext | null, locale: Locale): AgentSuggestion[] {
  const symbol = context?.kind === "asset" ? (context.symbol ?? pick(locale, "this asset", "цей актив")) : null;
  switch (context?.kind) {
    case "asset":
      return [
        { text: pick(locale, `What am I actually buying with ${symbol}?`, `Що я насправді купую з ${symbol}?`), class: "evidence" },
        { text: pick(locale, `Why is ${symbol} moving?`, `Чому ${symbol} рухається?`), class: "market" },
        { text: pick(locale, `What are the risks of ${symbol}?`, `Які ризики в ${symbol}?`), class: "evidence" },
        { text: pick(locale, `Prepare a ${symbol} plan with $50 max risk`, `Підготуй план на ${symbol} з максимальним ризиком $50`), class: "prepare_plan" },
        { text: pick(locale, `Compare ${symbol} with its other representations`, `Порівняй ${symbol} з іншими представленнями`), class: "compare" },
        /* 1.10.0: the two formats by name, so a person learns they can ask for the short read or to be argued with. */
        { text: pick(locale, `Brief me on ${symbol}`, `Стисло про ${symbol}`), class: "market" },
      ];
    case "plan":
      return [
        { text: pick(locale, "What changed in this plan?", "Що змінилось у цьому плані?"), class: "plan" },
        { text: pick(locale, "Has my invalidation happened?", "Чи сталася моя інвалідація?"), class: "plan" },
        { text: pick(locale, "Why can't this trade pass my plan?", "Чому ця угода не проходить мій план?"), class: "plan" },
        { text: pick(locale, "Does this plan need attention?", "Чи потребує цей план уваги?"), class: "plan" },
        { text: pick(locale, "Alert me when the 24h volume drops below $1M", "Сповісти мене, коли обсяг за 24 год впаде нижче $1M"), class: "prepare_monitoring" },
        { text: pick(locale, "Challenge this plan", "Оскарж цей план"), class: "plan" },
      ];
    case "portfolio":
      return [
        { text: pick(locale, "What changed in my portfolio?", "Що змінилось у моєму портфелі?"), class: "portfolio" },
        { text: pick(locale, "Which positions have a plan?", "Які позиції мають план?"), class: "portfolio" },
        { text: pick(locale, "Which plans need attention?", "Які плани потребують уваги?"), class: "plans" },
        { text: pick(locale, "What did I do recently?", "Що я робив останнім часом?"), class: "portfolio" },
        { text: pick(locale, "Brief me on my portfolio", "Стисло про мій портфель"), class: "portfolio" },
      ];
    case "note":
      return [
        { text: pick(locale, "Why did I get this alert?", "Чому мені прийшло це сповіщення?"), class: "monitoring" },
        { text: pick(locale, "Is the condition still true right now?", "Чи умова досі справджується зараз?"), class: "monitoring" },
        { text: pick(locale, "Open the plan this note is about", "Відкрий план цієї нотатки"), class: "monitoring" },
      ];
    default:
      return [
        { text: pick(locale, "What changed in my portfolio?", "Що змінилось у моєму портфелі?"), class: "portfolio" },
        { text: pick(locale, "Why is SOL moving?", "Чому SOL рухається?"), class: "market" },
        { text: pick(locale, "What am I actually buying with OPENAI?", "Що я насправді купую з OPENAI?"), class: "evidence" },
        { text: pick(locale, "Prepare a SOL plan with $50 max risk", "Підготуй план на SOL з максимальним ризиком $50"), class: "prepare_plan" },
        { text: pick(locale, "Which plans need attention?", "Які плани потребують уваги?"), class: "plans" },
      ];
  }
}
