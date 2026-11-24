/**
 * A sentence in a link: `https://ryntra.io/?say=trade%201%20SOL%20a%20day` opens the terminal and hands the
 * sentence to the agent's line, as if the person had typed it there — the line reads it by its own rules and opens the
 * screen that does it, filled. The person reads that screen and signs in their own wallet; the link signs nothing.
 *
 * The rule both sides keep — Ryntra's MCP, which writes such links for another AI, and the terminal's frame, which takes
 * them — lives here, so a link can only ever open what this file lets it open:
 *
 * - **Only screens that end in the person's own signature over their own money.** A buy or a sale, a limit, a ladder, the
 *   agent's budget, a launch, a pool, the money autopilot, an agent's card. A transfer to an address — the one kind of
 *   filled screen a stranger's link could use against the person — never opens from a link: the sentence stands in the
 *   line instead, for the person to read and say themselves.
 * - **No model from a link.** Only the line's own rules read a link's sentence; a sentence they cannot place is left in
 *   the line, never sent to the model on the link's word.
 * - **A sentence, not a document.** Control, bidi and zero-width characters are taken out and the sentence is capped at
 *   the line's own length.
 *
 * Pure: no React, no network. Relative imports only.
 */

/** The address's part that carries the sentence. */
export const SAY_PARAM = "say";

/** The longest sentence a link carries: the agent's line's own (`COMMAND_MAX` of `city/lib/command/parse.ts`). */
export const SAY_MAX = 140;

/**
 * The readings a link may open filled. Each ends on a screen where the person reads the figures and signs with their own
 * wallet, and none of them sends money to anyone but the person. `money` (send, pay link, bridge, top-up) and `ask` (a
 * question for the model) are not here: a link with either leaves the sentence in the line.
 */
export const LINK_KINDS: ReadonlySet<string> = new Set([
  "buy",
  "sell",
  "order",
  "ladder",
  "coin",
  "chart",
  "mint",
  "earn",
  "launch",
  "autopilot",
  "pilot",
  "dollar",
  "hire",
  "instruct",
  "instructions",
  "learn",
]);

/** Whether a reading of the line may open its screen straight from a link. */
export function opensFromLink(kind: string): boolean {
  return LINK_KINDS.has(kind);
}

const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

/** The sentence as a link may carry it, or null: a string, cleaned, one line, not empty and not longer than the line's. */
export function cleanSentence(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > SAY_MAX) return null;
  return text;
}

/** The link that hands `sentence` to the agent's line at `origin`; null for a sentence a link may not carry. */
export function sayUrl(origin: string, sentence: string): string | null {
  const said = cleanSentence(sentence);
  if (!said) return null;
  const url = new URL("/", origin);
  url.searchParams.set(SAY_PARAM, said);
  return url.toString();
}

/** The sentence an address's query carries (`?say=…`), cleaned, or null. */
export function sentenceOfQuery(search: string): string | null {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return cleanSentence(new URLSearchParams(query).get(SAY_PARAM));
}
