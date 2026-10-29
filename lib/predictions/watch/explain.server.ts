/**
 * The model behind a watch's one sentence.
 *
 * It is called after the fact, for a signal a deterministic engine already
 * raised, and it is given only what that engine compared: the figures, the
 * market's two titles and the sentence Ryntra already wrote. It cannot read a
 * market, call a tool, see a wallet or decide whether anything happened — a
 * model that answers nothing, times out or is not configured changes nothing
 * a person sees, because the engine's own sentence is what carries the signal.
 *
 * What comes back is held to those same figures before it is kept
 * (`explain.ts`): a number nobody read, a line of advice, an instruction, a
 * promise about the future, a link or another name for the assistant and the
 * sentence is dropped.
 *
 * The call is the deployment's own — paid by `system_watch`, counted against
 * the deployment's daily and monthly ceilings like any other, and leaving a
 * priced receipt. It runs only where the deployment switched the model on
 * (`RYNTRA_AGENT_MODEL_ENABLED=1` beside the key); otherwise there is no
 * model and nothing is spent.
 *
 * Server only.
 */

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { reserveScheduledCall, resolveAgentBudgetConfig, writeReceipt } from "../../agent/budget.ts";
import { parseCall, promptVersionOf, safetyIdentifier, type ResponsesParseClient } from "../../agent/model.ts";
import { modelFor } from "../../assistant/models.ts";
import type { GuardStore } from "../../guard/store.ts";
import { EXPLANATION_LIMIT, keepExplanation, type WatchExplainAsk, type WatchExplainer } from "./explain.ts";

/** The deployment pays for a watch's sentences; no wallet and no guest is charged for one. */
const PAYER = "system_watch";

const TIMEOUT_MS = 12_000;

export const WatchExplanationSchema = z.object({ sentence: z.string() }).strict();

/*
 * The instruction is the static prefix — the same bytes for every signal, so
 * the provider's cache serves it. It says what the sentence is for and, at
 * greater length, what it must not be: the sentence is dropped on the way
 * back for any of it, and a model told plainly wastes fewer calls.
 */
const INSTRUCTIONS = [
  "You write one sentence for Ryntra, a platform for markets on outcomes.",
  "A deterministic engine has already decided that something happened on a market a person is watching, and has already written a sentence stating the figures. Your sentence is added beside that one.",
  "Say what the change means for somebody holding or considering this market: which part of the market's own terms it touches, what it does not tell us, or what would make it matter more or less.",
  "Rules, all of them enforced after you answer — a sentence that breaks any one of them is thrown away:",
  "1. Use only the figures given to you. Never state a number that is not among them, not even an approximation or a count.",
  "2. Never advise. No buying, selling, holding, hedging, entering, exiting, waiting or hurrying — not as a suggestion, not in the imperative, not as 'now is a good time'.",
  "3. Never predict or promise. The market prices the outcome; you do not.",
  "4. Never repeat the sentence you were given. Add something to it.",
  "5. No links, no venue instructions, no name for yourself other than Ryntra.",
  `6. One sentence, at most ${EXPLANATION_LIMIT} characters, in the language asked for (en or uk).`,
  "If you have nothing to add that obeys all of this, answer with an empty sentence.",
].join("\n");

/** What the model is shown: the figures as they are, and the titles marked as the venue's own text. */
function input(ask: WatchExplainAsk): string {
  return JSON.stringify({
    locale: ask.locale,
    watching: ask.kind,
    untrusted_event_title: ask.eventTitle.slice(0, 300),
    untrusted_question: ask.question.slice(0, 300),
    outcome: ask.outcomeLabel,
    figures: ask.facts,
    already_said: ask.said.slice(0, 400),
  });
}

export type WatchExplainerDeps = Readonly<{
  store: GuardStore;
  env?: Readonly<Record<string, string | undefined>>;
  /** The Responses client; the tests give their own and nothing leaves the machine. */
  client?: ResponsesParseClient;
  /** The run this pass belongs to, for the receipts. */
  runId?: string;
  now?: () => number;
}>;

/**
 * The explainer this deployment can use, or null when it has no model
 * switched on. Null is not a lesser product: the engine's sentence is the
 * signal, and this only ever adds a line beside it.
 */
export function watchExplainer(deps: WatchExplainerDeps): WatchExplainer | null {
  const env = deps.env ?? process.env;
  const budget = resolveAgentBudgetConfig(env);
  if (!budget.modelEnabled) return null;
  const apiKey = env.OPENAI_API_KEY?.trim();
  const client = deps.client ?? (apiKey ? (new OpenAI({ apiKey, maxRetries: 0, timeout: TIMEOUT_MS }) as unknown as ResponsesParseClient) : null);
  if (!client) return null;
  const name = modelFor("watch_explain", env).name;
  const runId = deps.runId ?? `wex_${Date.now().toString(16)}`;
  const clock = deps.now ?? Date.now;

  return async (ask: WatchExplainAsk): Promise<string | null> => {
    const nowMs = clock();
    /* The deployment's own ceilings, as for any call it makes on a schedule; a day that is spent leaves the engine's words, which is no loss. */
    const reserved = await reserveScheduledCall(deps.store, budget, nowMs).catch(() => null);
    if (!reserved || !reserved.ok) return null;
    {
      const call = await parseCall(client, TIMEOUT_MS, {
        model: name,
        task: "watch_explain",
        safetyKey: safetyIdentifier(PAYER),
        /* Reasoning is billed inside the output: room for it and for one sentence. */
        maxOutputTokens: 400,
        instructions: INSTRUCTIONS,
        input: input(ask),
        format: zodTextFormat(WatchExplanationSchema, "ryntra_watch_explain_v1"),
      });
      await writeReceipt(deps.store, {
        owner: PAYER,
        sessionId: "predictions:watch",
        turnId: runId,
        model: call.model,
        promptVersion: promptVersionOf("watch_explain"),
        task: "watch_explain",
        tokens: call.usage,
        latencyMs: call.latencyMs,
        outcome: call.ok ? "ok" : call.outcome,
        at: new Date(nowMs).toISOString(),
      }).catch(() => null);
      /* The provider was reached, so the call is kept on the counters; only a call that never left is given back. */
      if (!call.ok) {
        if (!call.reached) await reserved.refund().catch(() => undefined);
        return null;
      }
      const parsed = WatchExplanationSchema.safeParse(call.parsed);
      if (!parsed.success) return null;
      const kept = keepExplanation(parsed.data.sentence, ask);
      return kept.ok ? kept.text : null;
    }
  };
}
