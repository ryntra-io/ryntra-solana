/**
 * `POST /api/sentence`: one sentence in, the model's draft of the agent's plan out — only the schema's own
 * fields (`./model.ts` `draftOf`); the page checks it against the person's words and its book (`./plan.ts` `readDraft`)
 * and fills the card of the right shelf. Nothing is signed, sent or prepared here.
 *
 * - **Off by default.** Without the switch and a key there is no parser: the answer is `off`, and the agent's line reads
 *   the sentence by its own rules — the person never waits on a route that cannot answer.
 * - **From the terminal's own page only**, a small body: `{ sentence, lang }`, the sentence at most 140 characters.
 * - **A day's ceiling.** A burst limit a caller (in memory), a day's count a caller and a day's count for everyone
 *   together (`SENTENCE_LIMITS`), in a store every instance shares; where no such store answers, the model is not asked.
 * - **One call, its own time.** Past it the line reads by its own rules; a call that never reached the model gives its
 *   turns back.
 * - **Nothing kept.** The sentence is not logged, stored or echoed; the counters keep a hashed caller for a day.
 *
 * Pure but for what it is handed (`SentenceDeps`). Relative imports only: `node --test` imports this module directly.
 */

import { draftOf, SENTENCE_MODEL_MS, type SentenceParser } from "./model.ts";
import { sentenceOf } from "./plan.ts";

export const SENTENCE_LIMITS = {
  /** One caller, a day: a person says many sentences, never this many to a model. */
  callerDay: 40,
  /** Everyone together, a day: the ceiling on what the model may cost. The deployment may set it lower, never higher. */
  allDay: 3_000,
  bodyBytes: 1_024,
} as const;

/** The day's counters, shared by every instance: each taken at once or none; `give` returns them. */
export interface SentenceMeter {
  take(caller: string, nowMs: number): Promise<Readonly<{ ok: true; give: () => Promise<void> }> | Readonly<{ ok: false; reason: "limit" | "down" }>>;
}

export type SentenceDeps = Readonly<{
  parser: SentenceParser | null;
  /** The day's counters; null — no store every instance shares: the model is not asked. */
  meter: SentenceMeter | null;
  /** The caller's hashed key, or null when there is none to tell (no secret on the deployment). */
  callerOf(request: Request): string | null;
  /** The caller's burst in memory: false — too many in a minute. */
  burst(caller: string): boolean;
  now(): number;
  /** The model's own time (`SENTENCE_MODEL_MS`), for the tests. */
  modelMs?: number;
}>;

export type SentenceCode = "bad" | "off" | "limit" | "model";
export type SentenceAnswer = Readonly<{ draft: Record<string, unknown> | null }> | Readonly<{ code: SentenceCode }>;

const HEADERS: Readonly<Record<string, string>> = { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow", "Content-Type": "application/json; charset=utf-8" };
const json = (status: number, body: SentenceAnswer) => new Response(JSON.stringify(body), { status, headers: HEADERS });

function fromPage(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  return request.headers.get("origin") === new URL(request.url).origin;
}

/** The sentence a body carries, and the page's language; null when the body is not one. */
export function bodyOf(body: unknown): Readonly<{ sentence: string; lang: "en" | "uk" }> | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { sentence, lang } = body as Record<string, unknown>;
  const text = sentenceOf(sentence);
  return text === null ? null : { sentence: text, lang: lang === "uk" ? "uk" : "en" };
}

class Late extends Error {}

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Late()), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

export async function serveSentence(deps: SentenceDeps, request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...HEADERS, Allow: "POST" } });
  if (!fromPage(request)) return json(403, { code: "bad" });
  if (Number(request.headers.get("content-length") ?? "0") > SENTENCE_LIMITS.bodyBytes) return json(413, { code: "bad" });
  let asked: ReturnType<typeof bodyOf> = null;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length <= SENTENCE_LIMITS.bodyBytes) asked = bodyOf(JSON.parse(text));
  } catch {
    asked = null;
  }
  if (!asked) return json(400, { code: "bad" });
  /* Without the model, a store every instance shares or a caller to count, nothing is asked and nothing is counted. */
  const caller = deps.callerOf(request);
  if (!deps.parser || !deps.meter || !caller) return json(503, { code: "off" });
  if (!deps.burst(caller)) return json(429, { code: "limit" });
  const now = deps.now();
  const taken = await deps.meter.take(caller, now).catch(() => ({ ok: false, reason: "down" }) as const);
  if (!taken.ok) return taken.reason === "limit" ? json(429, { code: "limit" }) : json(503, { code: "off" });
  try {
    const raw = await within(deps.parser.parse(asked.sentence, asked.lang), (deps.modelMs ?? SENTENCE_MODEL_MS) + 500);
    return json(200, { draft: draftOf(raw) });
  } catch (error) {
    /* The model never answered with an error status: nothing was made — the turn goes back. Late or cut: it stays counted. */
    const status = (error as { status?: unknown } | null)?.status;
    if (!(error instanceof Late) && typeof status === "number") await taken.give().catch(() => undefined);
    return json(502, { code: "model" });
  }
}
