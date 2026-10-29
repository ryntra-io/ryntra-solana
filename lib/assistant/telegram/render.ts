/**
 * An answer as Telegram carries it (AI-07): short — the headline, what is
 * known now, what it means, one risk — with the sources and their time under
 * it, the questions it offers as buttons, the handoffs as links to ryntra.io
 * and the price of the next question. The whole answer, with every section
 * and card, stays on ryntra.io behind «Відкрити в Ryntra». Pure: no store, no
 * clock, no network.
 */

import type { AgentBudgetState, AgentTurn } from "../../api/v1/contract.ts";
import { escapeHtml } from "../../telegram/api.ts";
import { wordsFor, type TgLocale } from "./words.ts";

/** A button: a link, or a press the bot answers. */
export type TgButton = Readonly<{ text: string; url?: string; callback_data?: string }>;
export type TgKeyboard = readonly (readonly TgButton[])[];
export type TgReply = Readonly<{ text: string; keyboard?: TgKeyboard }>;

/** Telegram's ceiling for one message is 4096 characters; an answer is cut well before it. */
export const TG_TEXT_MAX = 3_500;
/** Telegram's ceiling for a button's `callback_data`. */
export const TG_CALLBACK_MAX = 64;

const MAX_OBSERVATION = 3;
const MAX_MEANING = 2;
const MAX_ASKS = 3;
const MAX_HANDOFFS = 2;

/** A talk (AI-06c) reads as a person's reply; its questions are the buttons. */
function isTalk(turn: AgentTurn): boolean {
  return turn.class === "help" && turn.cards.length === 0 && turn.citations.length === 0 && turn.answer !== null;
}

/** The questions the answer offers, as the buttons ask them. */
export function asksOf(turn: AgentTurn): string[] {
  if (!turn.answer || !isTalk(turn)) return [];
  return turn.answer.actions.map((sentence) => sentence.text.trim()).filter((text) => text.endsWith("?") && text.length <= 400).slice(0, MAX_ASKS);
}

function timeOf(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")} UTC`;
}

function sourcesLine(turn: AgentTurn, locale: TgLocale): string | null {
  const seen = new Map<string, string | null>();
  for (const citation of turn.citations) {
    if (!seen.has(citation.source)) seen.set(citation.source, timeOf(citation.observedAt));
    if (seen.size >= 3) break;
  }
  if (seen.size === 0) return null;
  const parts = [...seen].map(([source, time]) => (time ? `${source} · ${time}` : source));
  return `${locale === "uk" ? "Джерела" : "Sources"}: ${parts.join("; ")}`;
}

/** What the next question costs, read from the answer's own budget — never a price the person was not shown. */
export function priceLine(budget: AgentBudgetState | null | undefined, locale: TgLocale): string | null {
  const credits = budget?.credits;
  if (!credits) return null;
  const words = wordsFor(locale);
  const price = credits.prices.question;
  if (credits.free.left >= price) return words.footerFree(price, credits.free.left, credits.free.daily);
  if (credits.balance >= price) return words.footerBalance(price, credits.balance);
  return words.footerEmpty;
}

/** The answer's text in Telegram's HTML: every word escaped, the headline bold. */
export function answerText(turn: AgentTurn, locale: TgLocale, budget: AgentBudgetState | null | undefined): string {
  const answer = turn.answer;
  const blocks: string[] = [];
  if (isTalk(turn) && answer) {
    const lines = [...answer.observation, ...answer.meaning, ...answer.actions.filter((sentence) => !sentence.text.trim().endsWith("?"))];
    for (const sentence of lines.slice(0, MAX_OBSERVATION + MAX_MEANING)) blocks.push(escapeHtml(sentence.text));
  } else {
    blocks.push(`<b>${escapeHtml(turn.text)}</b>`);
    if (turn.refusal) blocks.push(escapeHtml(turn.refusal.reason));
    if (answer) {
      if (answer.insufficient) blocks.push(escapeHtml(locale === "uk" ? "Даних замало, щоб судити впевнено." : "There is too little data to judge with confidence."));
      for (const sentence of answer.observation.slice(0, MAX_OBSERVATION)) blocks.push(escapeHtml(sentence.text));
      for (const sentence of answer.meaning.slice(0, MAX_MEANING)) blocks.push(escapeHtml(sentence.text));
      const risk = answer.risks[0] ?? answer.counter[0];
      if (risk) blocks.push(`⚠️ ${escapeHtml(risk.text)}`);
    }
    const sources = sourcesLine(turn, locale);
    if (sources) blocks.push(`<i>${escapeHtml(sources)}</i>`);
  }
  const price = priceLine(budget, locale);
  if (price) blocks.push(`<i>${escapeHtml(price)}</i>`);
  return clip(blocks.join("\n\n"));
}

/** Cut at a paragraph so the tags stay closed; the rest is on ryntra.io. */
export function clip(text: string): string {
  if (text.length <= TG_TEXT_MAX) return text;
  const paragraphs = text.split("\n\n");
  let out = "";
  for (const paragraph of paragraphs) {
    if (out.length + paragraph.length + 3 > TG_TEXT_MAX) break;
    out = out ? `${out}\n\n${paragraph}` : paragraph;
  }
  return `${out}\n\n…`;
}

/** An app path as a link from Telegram: always on ryntra.io, never anywhere else. */
export function appLink(origin: string, href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  return `${origin}${href}`;
}

/** At most `max` characters, never half of one (an emoji is two UTF-16 units: a split one makes Telegram refuse the message). */
export function chars(text: string, max: number): string {
  const all = Array.from(text);
  return all.length <= max ? text : `${all.slice(0, max - 1).join("")}…`;
}

/** The buttons under an answer: its questions (pressed by their place), up to two handoffs and the whole answer in Ryntra. */
export function answerKeyboard(turn: AgentTurn, input: Readonly<{ locale: TgLocale; origin: string; asks?: boolean }>): TgKeyboard {
  const rows: TgButton[][] = [];
  /* `asks: false` — an answer for another wallet of the account: its questions are not the chat's to press. */
  if (input.asks !== false) asksOf(turn).forEach((question, index) => rows.push([{ text: chars(question, 60), callback_data: `a:q:${index}` }]));
  const links: TgButton[] = [];
  for (const handoff of turn.handoffs.slice(0, MAX_HANDOFFS)) {
    const url = appLink(input.origin, handoff.href);
    if (url) links.push({ text: chars(handoff.label, 40), url });
  }
  if (links.length > 0) rows.push(links);
  if (!isTalk(turn)) {
    const url = appLink(input.origin, "/app/ryn");
    if (url) rows.push([{ text: wordsFor(input.locale).openRyntra, url }]);
  }
  return rows;
}
