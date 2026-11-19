/**
 * The page's side of the sentence's model: the draft from `POST /api/sentence`, or null — the model off,
 * the day's ceiling reached, an error, or no answer within `SENTENCE_WAIT_MS`. A null is never an error to the person:
 * the agent's line reads the sentence by its own rules, as before.
 *
 * Pure but for the fetch it is handed. Relative imports only.
 */

import { SENTENCE_MODEL_MS } from "./model.ts";

export const SENTENCE_ROUTE = "/api/sentence";

/** The page waits no longer than this, the model's own time with a little room. */
export const SENTENCE_WAIT_MS = SENTENCE_MODEL_MS + 1_500;

export async function askSentence(sentence: string, lang: "en" | "uk", deps: Readonly<{ fetch?: typeof fetch; waitMs?: number }> = {}): Promise<Record<string, unknown> | null> {
  const send = deps.fetch ?? fetch;
  try {
    const response = await send(SENTENCE_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(deps.waitMs ?? SENTENCE_WAIT_MS),
      body: JSON.stringify({ sentence, lang }),
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as { draft?: unknown } | null;
    const draft = body?.draft;
    return typeof draft === "object" && draft !== null && !Array.isArray(draft) ? (draft as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
