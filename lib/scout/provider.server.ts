import "server-only";

import OpenAI from "openai";

import { providerClient } from "../agent/providers.ts";
import { assistantProviderOf, modelFor, PROVIDER_KEY_ENV, providerPrices, TEXT_PRICES } from "../assistant/models.ts";
import { namedScoutModel, scoutModeOf, type TokenPrice } from "./flag.ts";
import { SCOUT_THESIS } from "./rules.ts";
import { writerOver, type ThesisClient, type ThesisWriter } from "./thesis.ts";

/**
 * The thesis's model on this deployment: the assistant's provider and key, the model the deployment names for the Scout
 * (`RYNTRA_SCOUT_MODEL`) or the provider's everyday one. Null while the Scout is off or no key is set. Keys come only from
 * the environment, by name, and are never read out, logged or returned.
 */

type Env = Readonly<Record<string, string | undefined>>;

export function scoutWriterOf(env: Env): ThesisWriter | null {
  if (scoutModeOf(env) === "off") return null;
  const provider = assistantProviderOf(env);
  const model = namedScoutModel(env) ?? modelFor("brief", env, provider).name;
  if (provider === "openai") {
    const apiKey = env[PROVIDER_KEY_ENV.openai]?.trim();
    if (!apiKey) return null;
    return writerOver(new OpenAI({ apiKey, maxRetries: 0, timeout: SCOUT_THESIS.timeoutMs }) as unknown as ThesisClient, model);
  }
  const client = providerClient(provider, env);
  return client ? writerOver(client as unknown as ThesisClient, model) : null;
}

/** The model's price per million tokens: the book's, the deployment's for another provider, else the dearest the book knows. */
export function scoutPriceOf(model: string, env: Env): TokenPrice {
  const known = TEXT_PRICES[model] ?? providerPrices(env)[model];
  if (known) return { input: known.input, output: known.output };
  const dearest = Object.values(TEXT_PRICES).reduce((top, price) => (price.input + price.output > top.input + top.output ? price : top));
  return { input: dearest.input, output: dearest.output };
}
