import type { AgentCriticKind } from "@/lib/api/v1/contract";

/**
 * Every reader-facing word of the Brief and the Critic panel, per locale, in
 * one file. The sentences themselves come from the server already in the
 * reader's language — this is only the chrome around them: the section
 * headings, the two controls, the states.
 */

export type LensWord =
  | "brief"
  | "critic"
  | "changed"
  | "matters"
  | "supports"
  | "unknown"
  | "checks"
  | "more"
  | "less"
  | "challenge"
  | "challenging"
  | "againBrief"
  | "reading"
  | "insufficient"
  | "criticInsufficient"
  | "gaps"
  | "sources"
  | "notChallenged"
  | "connect"
  | "askRyn"
  | "chat"
  | "failed"
  | "busy"
  | "composedDeterministic"
  | "composedModel"
  | "boundary"
  | "observed"
  | "stateCurrent"
  | "stateStale"
  | "stateUnavailable"
  | "stateUnknown";

const EN: Readonly<Record<LensWord, string>> = {
  brief: "Brief",
  critic: "Critic",
  changed: "What changed",
  matters: "What matters here",
  supports: "What the data says",
  unknown: "What is unknown",
  checks: "What to check next",
  more: "The data, the gaps and what to check",
  less: "Hide",
  challenge: "Challenge this",
  challenging: "Reading against it…",
  againBrief: "Back to the brief",
  reading: "Reading…",
  insufficient: "Insufficient data — nothing here could be read, so nothing is claimed.",
  criticInsufficient: "Insufficient data — there is nothing to argue against yet.",
  gaps: "What could not be challenged",
  sources: "Sources",
  notChallenged: "Silence here is not agreement.",
  connect: "Connect your wallet and confirm it once — the brief reads your own plans, holdings and record.",
  askRyn: "Ask Ryntra",
  chat: "Chat with Ryntra",
  failed: "This could not be read right now.",
  busy: "One question of this wallet is already being answered.",
  composedDeterministic: "Composed from the reads",
  composedModel: "Worded by the model, verified against the reads",
  boundary: "Ryntra researches and challenges. It never buys, sells or signs — the Review, your confirmation and your signature do.",
  observed: "Read",
  stateCurrent: "current",
  stateStale: "stale",
  stateUnavailable: "unavailable",
  stateUnknown: "unknown",
};

const UK: Readonly<Record<LensWord, string>> = {
  brief: "Стисло",
  critic: "Критик",
  changed: "Що змінилося",
  matters: "Що тут важливо",
  supports: "Що кажуть дані",
  unknown: "Що невідомо",
  checks: "Що перевірити далі",
  more: "Дані, прогалини і що перевірити",
  less: "Сховати",
  challenge: "Оскаржити це",
  challenging: "Читаю проти…",
  againBrief: "Назад до стислого",
  reading: "Читаю…",
  insufficient: "Даних недостатньо — тут нічого не вдалося прочитати, тож нічого й не стверджується.",
  criticInsufficient: "Даних недостатньо — поки що нема з чим сперечатися.",
  gaps: "Що не вдалося оскаржити",
  sources: "Джерела",
  notChallenged: "Мовчання тут не є згодою.",
  connect: "Підключи гаманець і підтверди його один раз — стислий огляд читає твої власні плани, активи й запис.",
  askRyn: "Спитати Ryntra",
  chat: "Розмова з Ryntra",
  failed: "Це зараз не вдалося прочитати.",
  busy: "На одне питання цього гаманця вже відповідають.",
  composedDeterministic: "Складено з читань",
  composedModel: "Слова моделі, звірені з читаннями",
  boundary: "Ryntra досліджує й оскаржує. Вона ніколи не купує, не продає і не підписує — це роблять Перевірка, твоє підтвердження і твій підпис.",
  observed: "Прочитано",
  stateCurrent: "актуально",
  stateStale: "застаріло",
  stateUnavailable: "недоступно",
  stateUnknown: "невідомо",
};

export function lensWordsFor(locale: "en" | "uk"): (word: LensWord) => string {
  const table = locale === "uk" ? UK : EN;
  return (word) => table[word];
}

/** The short label a finding wears, so a reader learns the seven kinds once. */
export function criticKindLabel(kind: AgentCriticKind, locale: "en" | "uk"): string {
  const table: Readonly<Record<AgentCriticKind, readonly [string, string]>> = {
    "assumption-conflict": ["Assumption", "Припущення"],
    "risk-not-established": ["Risk not established", "Ризик не встановлено"],
    "plan-condition-unmet": ["Plan condition", "Умова плану"],
    "previous-result": ["Your own record", "Твій власний запис"],
    "evidence-missing": ["Evidence", "Докази"],
    "asset-structure": ["Asset structure", "Структура активу"],
    "thesis-weakness": ["Thesis", "Теза"],
  };
  return table[kind][locale === "uk" ? 1 : 0];
}
