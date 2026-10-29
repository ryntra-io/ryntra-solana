/**
 * What a person asks Ryntra about a prediction market: five questions the
 * panel and the ticket offer as buttons, and the plain reading of a typed
 * question into one of them. The server decides the reads from the topic —
 * never the words, never a model.
 *
 * Pure: the panel and the server read the same list.
 */

export const ASK_TOPICS = ["yes", "basis", "news", "risks", "plan", "overview"] as const;
export type AskTopic = (typeof ASK_TOPICS)[number];

/** The buttons, in the order the panel shows them. */
export const ASK_BUTTONS: readonly Exclude<AskTopic, "overview">[] = ["yes", "basis", "news", "risks", "plan"];

type Locale = "en" | "uk";

/** The outcome as the question names it: «Так» / “Yes” for a yes-no market, the venue's own word otherwise. */
function outcomeWord(label: string | null, locale: Locale): string {
  const raw = (label ?? "").trim();
  if (!raw || /^yes$/i.test(raw)) return locale === "uk" ? "«Так»" : "“Yes”";
  if (/^no$/i.test(raw)) return locale === "uk" ? "«Ні»" : "“No”";
  return locale === "uk" ? `«${raw.slice(0, 40)}»` : `“${raw.slice(0, 40)}”`;
}

/** The question a button asks, as the person reads it in the conversation. */
export function topicQuestion(topic: AskTopic, locale: Locale, outcomeLabel: string | null = null): string {
  const uk = locale === "uk";
  switch (topic) {
    case "yes":
      return uk ? `Що потрібно, щоб виграло ${outcomeWord(outcomeLabel, locale)}?` : `What has to happen for ${outcomeWord(outcomeLabel, locale)} to win?`;
    case "basis":
      return uk ? "Де підстава: чим правила різняться на майданчиках?" : "Where is the catch: how do the venues' rules differ?";
    case "news":
      return uk ? "Що змінилось за 24 години і які новини?" : "What changed in 24 hours, and what is the news?";
    case "risks":
      return uk ? "Які тут ризики?" : "What are the risks here?";
    case "plan":
      return uk ? "Склади чернетку плану: вхід, максимум втрат, вихід" : "Draft a plan: entry, most I can lose, exit";
    default:
      return uk ? "Що тут важливо знати?" : "What matters here?";
  }
}

/** The short label on a button. */
export function topicLabel(topic: AskTopic, locale: Locale, outcomeLabel: string | null = null): string {
  const uk = locale === "uk";
  switch (topic) {
    case "yes":
      return uk ? `Щоб виграло ${outcomeWord(outcomeLabel, locale)}` : `For ${outcomeWord(outcomeLabel, locale)} to win`;
    case "basis":
      return uk ? "Де підстава" : "Where's the catch";
    case "news":
      return uk ? "Новини й 24 год" : "News and 24h";
    case "risks":
      return uk ? "Ризики" : "Risks";
    case "plan":
      return uk ? "Чернетка плану" : "Plan draft";
    default:
      return uk ? "Огляд" : "Overview";
  }
}

const RULES: readonly (readonly [Exclude<AskTopic, "overview">, RegExp])[] = [
  ["plan", /план|чернетк|\bplan\b|\bdraft\b|вход|вихід|\bentry\b|\bexit\b|максимум втрат|stop|стоп/iu],
  ["basis", /підстав|\bcatch\b|різн|відмінн|\bdiffer|майданчик|\bvenue/iu],
  ["news", /новин|\bnews\b|24\s?(?:год|h|hours?)|за добу|змінил|\bchanged?\b|\bmov(?:e|ed|ing)\b|чому|\bwhy\b|рух/iu],
  ["risks", /ризик|\brisks?\b|ліквідн|\bliquid|небезпе|\bdanger|втрат|\blose\b|\bloss/iu],
  ["yes", /виграл|виграє|\bwins?\b|умов|\bresol|розрах|\bcondition|що потрібно|що треба|\bwhat has to\b|\bneeds? to happen/iu],
];

/** A typed question read into a topic by its words; what none of them names is the overview. */
export function topicOf(text: string): AskTopic {
  const words = text.trim();
  if (!words) return "overview";
  for (const [topic, rule] of RULES) if (rule.test(words)) return topic;
  return "overview";
}
