import "server-only";

import OpenAI from "openai";

import { providerClient } from "../agent/providers.ts";
import { assistantProviderOf, modelFor, PROVIDER_KEY_ENV } from "../assistant/models.ts";
import { parserOver, SENTENCE_MODEL_MS, type SentenceClient, type SentenceParser } from "./model.ts";

/**
 * The sentence's model on this deployment. Off unless the operator turns it on: `RYNTRA_SENTENCE=on`, and the
 * assistant's provider keyed (`RYNTRA_ASSISTANT_PROVIDER` with its key — OpenAI by default, `OPENAI_API_KEY`). The model
 * is the provider's everyday one (`modelFor("intent")`, the L1 class) unless `RYNTRA_SENTENCE_MODEL` names another.
 * Without the switch or the key there is no parser and the agent's line reads every sentence by its own rules, as before.
 *
 * Keys come only from the environment, by name, and are never read out, logged or returned.
 */

export const SENTENCE_SWITCH_ENV = "RYNTRA_SENTENCE";
export const SENTENCE_MODEL_ENV = "RYNTRA_SENTENCE_MODEL";

const MODEL_NAME = /^[a-z0-9][a-z0-9._-]{1,63}(\/[a-z0-9][a-z0-9._:-]{1,63})?$/i;

/** Whether the switch is on: `on`, `1` or `true`. */
export const sentenceOn = (env: Readonly<Record<string, string | undefined>>): boolean => ["on", "1", "true"].includes(env[SENTENCE_SWITCH_ENV]?.trim().toLowerCase() ?? "");

/** The parser of this deployment, or null — switched off, or no key for the provider. */
export function sentenceParserOf(env: Readonly<Record<string, string | undefined>>): SentenceParser | null {
  if (!sentenceOn(env)) return null;
  const provider = assistantProviderOf(env);
  const named = env[SENTENCE_MODEL_ENV]?.trim();
  const model = named && MODEL_NAME.test(named) ? named : modelFor("intent", env, provider).name;
  if (provider === "openai") {
    const apiKey = env[PROVIDER_KEY_ENV.openai]?.trim();
    if (!apiKey) return null;
    return parserOver(new OpenAI({ apiKey, maxRetries: 0, timeout: SENTENCE_MODEL_MS }) as unknown as SentenceClient, model);
  }
  const client = providerClient(provider, env);
  return client ? parserOver(client as unknown as SentenceClient, model) : null;
}
