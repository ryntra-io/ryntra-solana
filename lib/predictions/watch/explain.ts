/**
 * The one thing a language model is allowed to do in a watch: say in a
 * sentence why what the engine found matters.
 *
 * The engine decides whether something happened; it never asks a model, and
 * no model can make it fire or stop it firing. What a model may add is a
 * single sentence of context beside figures that are already decided — and
 * even that is held to those figures before anybody reads it.
 *
 * What the sentence may not be, and is dropped for being:
 *
 * - **a figure nobody read.** Every number in it must be one of the figures
 *   the engine compared, give or take rounding. A model that adds «the
 *   fourth poll in a row» has invented a read.
 * - **advice, or an instruction.** A watch does not tell anybody to buy,
 *   sell, hold, exit or hurry. Not as a suggestion, not as a verb in the
 *   imperative, not as «now is the moment».
 *   A watch reports; it does not steer.
 * - **a promise about the future.** «Will resolve Yes», «is certain to» —
 *   the market prices that, and Ryntra does not.
 * - **a link, a venue's instruction or another name for the assistant.**
 *
 * Dropped, the engine's own sentence stands alone and nothing is missing: a
 * deployment with no model at all reads exactly as well, which is the point
 * of the split.
 *
 * Pure. The call to a model lives in `explain.server.ts`.
 */

import type { WatchFacts } from "./engine.ts";
import type { WatchRuleKind } from "./rules.ts";
import type { WatchLocale } from "./words.ts";

/** What a model is given: the figures, the market's two titles, and the sentence the engine already wrote. */
export type WatchExplainAsk = Readonly<{
  locale: WatchLocale;
  kind: WatchRuleKind;
  eventTitle: string;
  question: string;
  outcomeLabel: string | null;
  /** Exactly the figures the engine compared — no read of its own is added for the model. */
  facts: WatchFacts;
  /** What Ryntra states without a model; the sentence must add to this, not repeat it. */
  said: string;
}>;

/** The longest sentence that is still one sentence a person reads at a glance. */
export const EXPLANATION_LIMIT = 220;

/** Why a sentence was not kept; Ryntra's own code, for the record and the tests. */
export type ExplanationRefusal = "empty" | "too_long" | "many_sentences" | "figure_not_read" | "advice" | "command" | "promise" | "link" | "persona" | "repeats";

const NUMBER = /-?\d+(?:[.,]\d+)?/g;

/** An imperative opening, in either language: a sentence that tells somebody to do something. */
const COMMAND = /(?:^|[,;:—–]\s*)(?:buy|sell|short|long|exit|enter|hold|hedge|close|take|dump|add|trim|купи|купіть|купуй|продай|продайте|продавай|тримай|заходь|виходь|фіксуй|докупи|закрий|зменш)(?![\p{L}\p{N}_])/iu;

/** Advice anywhere in the sentence, however politely it is put. */
const ADVICE = /(?:you (?:should|must|may want to|might want to|could)|it (?:is|'s) (?:worth|a good time|the moment)|(?:good|right|best) (?:time|moment|entry|exit)|consider (?:buying|selling|hedging|closing|exiting)|take (?:some )?profits?|worth (?:buying|selling|a look|considering)|варто|слід\s+(?:купити|продати|тримати)|раджу|рекомендую|краще\s+(?:купити|продати|вийти|зайти)|є\s+сенс\s+(?:купити|продати))/iu;

/** A claim about what will happen, as opposed to what has happened. */
const PROMISE = /(?:will (?:resolve|settle|win|reach|hit|end up|go|rise|fall|close)|is (?:certain|guaranteed|bound) to|guarantee|no doubt|surely|definitely|обов['’]язково\s+(?:буде|виграє|зросте|впаде)|гарантован|напевно\s+(?:буде|виграє)|безумовно\s+(?:буде|виграє)|точно\s+(?:буде|виграє|зросте|впаде))/iu;

const LINK = /(?:https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(?:com|io|xyz|co|net|org|app|market|markets|fun)\b)/i;

/** The assistant is Ryntra to a person, and a watch names no other. */
const PERSONA = /(?<![\p{L}\p{N}])(?:ryn|gpt|chatgpt|claude|assistant\s+name|ai\s+model)(?![\p{L}\p{N}])/iu;

const normalise = (token: string): number | null => {
  const value = Number(token.replace(",", "."));
  return Number.isFinite(value) ? value : null;
};

/**
 * Every number the facts hold, in the forms a sentence may write them: the
 * figure itself, the same figure as a percentage, and its whole part. A
 * figure a sentence rounds differently is still that figure.
 */
export function readFigures(facts: WatchFacts): readonly number[] {
  const out = new Set<number>();
  const add = (value: number) => {
    if (!Number.isFinite(value)) return;
    out.add(value);
    out.add(Math.round(value));
    out.add(Number(value.toFixed(1)));
    out.add(Number(value.toFixed(2)));
  };
  for (const value of Object.values(facts)) {
    if (typeof value === "number") {
      add(value);
      add(value * 100);
      add(Math.abs(value));
      add(Math.abs(value) * 100);
      continue;
    }
    if (typeof value !== "string") continue;
    /* A figure inside a headline or a date the engine read is a figure the engine read. */
    for (const match of value.matchAll(NUMBER)) {
      const n = normalise(match[0]);
      if (n !== null) add(n);
    }
  }
  return [...out];
}

/** Whether every number in the sentence is one of the figures read, give or take the rounding a sentence does. */
function figuresRead(text: string, figures: readonly number[]): boolean {
  for (const match of text.matchAll(NUMBER)) {
    const value = normalise(match[0]);
    if (value === null) continue;
    const known = figures.some((figure) => figure === value || (figure !== 0 && Math.abs(figure - value) / Math.abs(figure) <= 0.02) || Math.abs(figure - value) <= 0.01);
    if (!known) return false;
  }
  return true;
}

const SENTENCE_END = /[.!?]\s+\p{Lu}/u;

/** Five words of the engine's own sentence repeated is the engine's sentence said twice. */
function repeats(text: string, said: string): boolean {
  const words = (value: string) => value.toLowerCase().split(/[^\p{L}\p{N}$%]+/u).filter((word) => word.length > 2);
  const mine = words(said);
  if (mine.length < 6) return false;
  const runs = new Set<string>();
  for (let i = 0; i + 5 <= mine.length; i += 1) runs.add(mine.slice(i, i + 5).join(" "));
  const theirs = words(text);
  for (let i = 0; i + 5 <= theirs.length; i += 1) if (runs.has(theirs.slice(i, i + 5).join(" "))) return true;
  return false;
}

/**
 * The sentence as it will be shown, or the reason it will not be. Trimming
 * and the trailing stop are the only edits made: a sentence is kept as the
 * model wrote it or not at all.
 */
export function keepExplanation(sentence: string, ask: WatchExplainAsk): Readonly<{ ok: true; text: string }> | Readonly<{ ok: false; refusal: ExplanationRefusal }> {
  const text = sentence.replace(/\s+/g, " ").trim();
  if (text.length === 0 || !/[\p{L}]/u.test(text)) return { ok: false, refusal: "empty" };
  if (text.length > EXPLANATION_LIMIT) return { ok: false, refusal: "too_long" };
  if (SENTENCE_END.test(text)) return { ok: false, refusal: "many_sentences" };
  if (LINK.test(text)) return { ok: false, refusal: "link" };
  if (PERSONA.test(text)) return { ok: false, refusal: "persona" };
  if (COMMAND.test(text)) return { ok: false, refusal: "command" };
  if (ADVICE.test(text)) return { ok: false, refusal: "advice" };
  if (PROMISE.test(text)) return { ok: false, refusal: "promise" };
  if (!figuresRead(text, readFigures(ask.facts))) return { ok: false, refusal: "figure_not_read" };
  if (repeats(text, ask.said)) return { ok: false, refusal: "repeats" };
  return { ok: true, text: /[.!?]$/.test(text) ? text : `${text}.` };
}

/**
 * What a watch pass may use to put a sentence beside a signal. A deployment
 * with no model, or one whose model answered nothing, hands back null — and
 * the engine's own sentence is what a person reads.
 */
export type WatchExplainer = (ask: WatchExplainAsk) => Promise<string | null>;
