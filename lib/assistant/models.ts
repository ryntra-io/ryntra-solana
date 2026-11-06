/**
 * The assistant's models — one provider, models by class of task, one
 * interface (PLAN §8, decision 54).
 *
 * L0 is no model at all: a price, a balance, a crossed level, a notification
 * is read and compared by the server. L1 is the everyday model — the intent
 * of a question the parser could not place, the words of an answer, the
 * Brief, the labels of a batch of news (AI-09). L2 is the strong model — the Critic, the trade plan and its
 * critic (AI-11), and later the deep analysis. The deployment may name another model per class
 * (`OPENAI_ASSISTANT_MODEL_L1`, `OPENAI_ASSISTANT_MODEL_L2`); the legacy
 * `OPENAI_AGENT_MODEL` is not read for any class, so a deployment that named
 * the old single model moves to the classes without a change of its
 * environment.
 *
 * Every call is priced from the usage the provider returned — uncached
 * input, cached input, output (reasoning tokens are billed as output and are
 * inside `output_tokens`) — in micro-dollars, an integer, so a sum of
 * receipts is exact. A model with no price is priced `null`, never zero.
 * Prices are OpenAI's list read on 17.10.2026 (Standard tier); the same
 * table AI-01 measured with (`scripts/assistant/quality/pricing.mjs`).
 *
 * Pure: no store, no clock, no network.
 */

export const MODEL_CLASSES = ["L0", "L1", "L2"] as const;
export type ModelClass = (typeof MODEL_CLASSES)[number];

/** What a call is for; the class follows from it, never from the question's words. */
export const MODEL_TASKS = ["intent", "answer", "brief", "critic", "news_tag", "morning_brief", "talk", "talk_check", "plan", "plan_critic", "plan_check", "watch_explain"] as const;
export type ModelTask = (typeof MODEL_TASKS)[number];

export const TASK_CLASS: Readonly<Record<ModelTask, Exclude<ModelClass, "L0">>> = {
  intent: "L1",
  answer: "L1",
  brief: "L1",
  critic: "L2",
  /* AI-09: news labelled in batches — the tokens an item is about and its topic, enums only. */
  news_tag: "L1",
  /* AI-10: the words of «Ранковий огляд» — the market's summary once for everyone, a person's changes for each; on Flex. */
  morning_brief: "L1",
  /* AI-06c: a greeting, a thanks, «who are you» or a general question — a short reply in Ryntra's voice over no reads. */
  talk: "L1",
  /* AI-06c: the everyday model's yes/no on each sentence of a talk against a fixed rubric — advice, a forecast, custody, a secret, a deed. */
  talk_check: "L1",
  /* AI-11: the trade plan's structure from the person's idea and figures over the reads — the strong model. */
  plan: "L2",
  /* AI-11: the critic of that plan — the same strong model under its own instruction, looking for the holes. */
  plan_critic: "L2",
  /* AI-11: the everyday model's verdict on each sentence the plan's two calls wrote — advice, a forecast, a valuation, a deed. */
  plan_check: "L1",
  /* One sentence of context beside a market signal a deterministic engine already raised — over the engine's own figures, never a figure or a verdict of its own. */
  watch_explain: "L1",
};

export const MODEL_CLASS_ENV: Readonly<Record<Exclude<ModelClass, "L0">, string>> = {
  L1: "OPENAI_ASSISTANT_MODEL_L1",
  L2: "OPENAI_ASSISTANT_MODEL_L2",
};

export const MODEL_CLASS_DEFAULT: Readonly<Record<Exclude<ModelClass, "L0">, string>> = {
  L1: "gpt-6-luna",
  L2: "gpt-6.1-sol",
};

/**
 * CITY-205: the provider the assistant's words come from. OpenAI stays the default; `RYNTRA_ASSISTANT_PROVIDER` names
 * `anthropic` (Anthropic's own API) or `openrouter` (any model through OpenRouter) — and is taken only when that
 * provider's key and both its model variables are on the deployment, so a name without them keeps answering on OpenAI.
 * Another provider's models are never written in the code: the deployment names them (and their prices), so the operator
 * picks the model without a release. Rules decide money, never a model: whichever answers only writes words.
 */
export const ASSISTANT_PROVIDERS = ["openai", "anthropic", "openrouter"] as const;
export type AssistantProvider = (typeof ASSISTANT_PROVIDERS)[number];

export const ASSISTANT_PROVIDER_ENV = "RYNTRA_ASSISTANT_PROVIDER";

/** The key each provider is called with — set on the deployment by the operator, never in the code. */
export const PROVIDER_KEY_ENV: Readonly<Record<AssistantProvider, string>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/** Each provider's variables that name a model per class. */
export const PROVIDER_CLASS_ENV: Readonly<Record<AssistantProvider, Readonly<Record<Exclude<ModelClass, "L0">, string>>>> = {
  openai: MODEL_CLASS_ENV,
  anthropic: { L1: "ANTHROPIC_ASSISTANT_MODEL_L1", L2: "ANTHROPIC_ASSISTANT_MODEL_L2" },
  openrouter: { L1: "OPENROUTER_ASSISTANT_MODEL_L1", L2: "OPENROUTER_ASSISTANT_MODEL_L2" },
};

/**
 * Each provider's price per class, USD per 1M tokens as «input/cached/output» («0.1/0.01/0.5»): the price book knows
 * OpenAI's models; another provider's model is priced from here, or its calls stay unpriced — never free.
 */
export const PROVIDER_PRICE_ENV: Readonly<Record<Exclude<AssistantProvider, "openai">, Readonly<Record<Exclude<ModelClass, "L0">, string>>>> = {
  anthropic: { L1: "ANTHROPIC_ASSISTANT_PRICE_L1", L2: "ANTHROPIC_ASSISTANT_PRICE_L2" },
  openrouter: { L1: "OPENROUTER_ASSISTANT_PRICE_L1", L2: "OPENROUTER_ASSISTANT_PRICE_L2" },
};

const hasKey = (value: string | undefined): boolean => Boolean(value?.trim());

/** A model's id as the deployment names it: OpenAI's and Anthropic's plain names, OpenRouter's `vendor/model`. */
const MODEL_NAME = /^[a-z0-9][a-z0-9._-]{1,63}(\/[a-z0-9][a-z0-9._:-]{1,63})?$/i;

/** The model a provider's variable names for a class, or null when it names none a call could send. */
function namedModel(provider: AssistantProvider, klass: Exclude<ModelClass, "L0">, env: Readonly<Record<string, string | undefined>>): string | null {
  const named = env[PROVIDER_CLASS_ENV[provider][klass]]?.trim();
  return named && MODEL_NAME.test(named) ? named : null;
}

/** Whether this provider's key is on the deployment (set, never read out). */
export function providerKeyed(provider: AssistantProvider, env: Readonly<Record<string, string | undefined>>): boolean {
  return hasKey(env[PROVIDER_KEY_ENV[provider]]);
}

/** The provider the assistant answers with on this deployment: the one named, with its key and both models; else OpenAI. */
export function assistantProviderOf(env: Readonly<Record<string, string | undefined>> = {}): AssistantProvider {
  const asked = env[ASSISTANT_PROVIDER_ENV]?.trim().toLowerCase();
  if ((asked === "anthropic" || asked === "openrouter") && providerKeyed(asked, env) && namedModel(asked, "L1", env) && namedModel(asked, "L2", env)) return asked;
  return "openai";
}

type Price = Readonly<{ input: number; cached: number; output: number }>;

/** «0.1/0.01/0.5» → a price; anything else (a missing figure, a negative one) → null. */
export function priceOf(value: string | undefined): Price | null {
  const parts = value?.trim().split("/").map((part) => Number(part.trim())) ?? [];
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return { input: parts[0]!, cached: parts[1]!, output: parts[2]! };
}

/** Another provider's models with the prices the deployment gives them: the book its calls are priced from. */
export function providerPrices(env: Readonly<Record<string, string | undefined>>): Readonly<Record<string, Price>> {
  const provider = assistantProviderOf(env);
  if (provider === "openai") return {};
  const out: Record<string, Price> = {};
  for (const klass of ["L1", "L2"] as const) {
    const name = namedModel(provider, klass, env);
    const price = priceOf(env[PROVIDER_PRICE_ENV[provider][klass]]);
    if (name && price) out[name] = price;
  }
  return out;
}

/** The prices the running deployment's provider was given (`lib/agent/providers.ts` sets them as the model is made). */
let providerBook: Readonly<Record<string, Price>> = {};

/** Sets the book another provider's calls are priced from; OpenAI's own table is never overwritten. */
export function setProviderPrices(book: Readonly<Record<string, Price>>): void {
  providerBook = Object.fromEntries(Object.entries(book).filter(([name]) => !(name in TEXT_PRICES)));
}

export const PRICES_READ_AT = "2026-10-17";

/** USD per 1M tokens. */
export const TEXT_PRICES: Readonly<Record<string, Readonly<{ input: number; cached: number; output: number }>>> = {
  "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
  "gpt-6.1-sol": { input: 2, cached: 0.1, output: 10 },
  "gpt-6-sol": { input: 2, cached: 0.2, output: 10 },
  "gpt-5.6-sol": { input: 4, cached: 0.4, output: 20 },
};

/**
 * AI-10: USD per 1M tokens on OpenAI's Flex tier (`service_tier: "flex"`) —
 * the Batch rates, half the Standard ones, read on the pricing page on
 * 18.10.2026. A call is priced by the tier the provider says it served,
 * never by the one asked for.
 */
export const FLEX_PRICES: Readonly<Record<string, Readonly<{ input: number; cached: number; output: number }>>> = {
  "gpt-6-luna": { input: 0.05, cached: 0.005, output: 0.25 },
  "gpt-6.1-sol": { input: 1, cached: 0.05, output: 5 },
};
export const FLEX_PRICES_READ_AT = "2026-10-18";

export type ServiceTier = "default" | "flex";

/** The tier a response states it was served on: `flex` only when it says so, anything else is priced as Standard. */
export function servedTier(raw: unknown): ServiceTier {
  return raw === "flex" ? "flex" : "default";
}

export type ModelChoice = Readonly<{ task: ModelTask; class: Exclude<ModelClass, "L0">; name: string }>;

/**
 * The model a task calls on this deployment: the class's variable of the provider when it names a model, else OpenAI's
 * default for the class (another provider is chosen only with both its models named). Without a provider given, the
 * deployment's own (`assistantProviderOf`).
 */
export function modelFor(task: ModelTask, env: Readonly<Record<string, string | undefined>> = {}, provider: AssistantProvider = assistantProviderOf(env)): ModelChoice {
  const klass = TASK_CLASS[task];
  return { task, class: klass, name: namedModel(provider, klass, env) ?? MODEL_CLASS_DEFAULT[klass] };
}

/** The usage a Responses call returned, in the four figures a price needs. */
export type CallUsage = Readonly<{ input: number; cached: number; output: number; reasoning: number; total: number }>;

export const NO_CALL_USAGE: CallUsage = { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 };

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

export function usageFromResponse(raw: unknown): CallUsage {
  const usage = (raw && typeof raw === "object" ? raw : {}) as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
    input_tokens_details?: { cached_tokens?: unknown } | null;
    output_tokens_details?: { reasoning_tokens?: unknown } | null;
  };
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  const cached = Math.min(input, count(usage.input_tokens_details?.cached_tokens));
  const reasoning = Math.min(output, count(usage.output_tokens_details?.reasoning_tokens));
  return { input, cached, output, reasoning, total: count(usage.total_tokens) || input + output };
}

/** Micro-dollars (1e-6 USD) for one call, rounded up so a sum never understates; `null` for a model the table does not price. */
export function costMicroUsd(model: string, usage: CallUsage, tier: ServiceTier = "default"): number | null {
  const price = tier === "flex" ? FLEX_PRICES[model] : (TEXT_PRICES[model] ?? providerBook[model]);
  if (!price) return null;
  const uncached = Math.max(0, usage.input - usage.cached);
  /* Price per 1M tokens × tokens = micro-dollars exactly. */
  const micro = uncached * price.input + usage.cached * price.cached + usage.output * price.output;
  return Math.max(0, Math.ceil(micro - 1e-9));
}

export function microToUsd(micro: number): number {
  return micro / 1_000_000;
}
