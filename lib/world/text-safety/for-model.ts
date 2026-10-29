import { cleanText, type TextKind, type TextReason } from "./clean.ts";

/**
 * Somebody else's text on its way to a model — the assistant (CITY-10, `lib/agent`), a guard of the Vault or an agent
 * of the Ring through the model gateway (CITY-45, `lib/models`). The model is told the block is untrusted data; this
 * makes sure the block carries no hidden characters, no direction overrides, no disguised words, and that a field that
 * reads as an order is not handed on at all — the model sees that something was withheld and why, never the order.
 *
 * Pure. Relative imports with their extension only.
 */

/** What a model reads in place of a field that was held back. */
export const WITHHELD = "[withheld: not shown to the model]";

export type ModelField = Readonly<{ text: string; withheld: TextReason | null }>;

/**
 * One field for a model. A name, ticker or sign is checked as such; free text (`prose`) keeps its words unless they
 * read as an order to a model, which a model must never be handed as text it could follow.
 */
export function modelField(raw: unknown, kind: TextKind = "prose", max?: number): ModelField {
  const cleaned = cleanText(raw, kind, max);
  if (!cleaned.ok) return { text: WITHHELD, withheld: cleaned.reason };
  if (kind === "prose") {
    const asName = cleanText(cleaned.text, "name", Number.MAX_SAFE_INTEGER);
    if (!asName.ok && asName.reason === "instruction") return { text: WITHHELD, withheld: "instruction" };
  }
  return { text: cleaned.text, withheld: null };
}

/**
 * A block of untrusted fields for a model's input: each key prefixed `untrusted_`, each value cleaned or withheld.
 * `kinds` names the fields that are tickers, names or signs; the rest are free text.
 */
export function forModel(
  fields: Readonly<Record<string, unknown>>,
  kinds: Readonly<Record<string, TextKind>> = {},
  max = 400,
): Record<string, string> {
  const block: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    block[`untrusted_${key}`] = modelField(value, kinds[key] ?? "prose", kinds[key] ? undefined : max).text;
  }
  return block;
}
