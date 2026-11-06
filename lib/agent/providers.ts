/**
 * CITY-205 — the assistant's provider layer. Ryntra's consultant reads the market and writes words; it never decides
 * money (the engine's rules do). Which model writes those words is a switch of the deployment:
 *
 *   RYNTRA_ASSISTANT_PROVIDER=openai      (default)  OPENAI_API_KEY      OPENAI_ASSISTANT_MODEL_L1 / _L2
 *   RYNTRA_ASSISTANT_PROVIDER=anthropic              ANTHROPIC_API_KEY   ANTHROPIC_ASSISTANT_MODEL_L1 / _L2   ANTHROPIC_ASSISTANT_PRICE_L1 / _L2
 *   RYNTRA_ASSISTANT_PROVIDER=openrouter             OPENROUTER_API_KEY  OPENROUTER_ASSISTANT_MODEL_L1 / _L2  OPENROUTER_ASSISTANT_PRICE_L1 / _L2
 *
 * Another provider's models and their prices («input/cached/output» per 1M tokens) are the deployment's to name, never
 * the code's. A provider named without its key or either model keeps answering on OpenAI (`assistantProviderOf`).
 * Without a price its calls stay unpriced in the receipts — never free. Every provider is handed to the
 * assistant through the one shape it already calls (`ResponsesParseClient`: instructions, input, a JSON schema, a
 * ceiling on output, usage back in OpenAI's figures), so the instructions, the schemas, the verifier and the price
 * book stay one: a switch of provider changes nothing a person reads except the words themselves.
 *
 * - Anthropic: the official SDK, `messages.create` with `output_config.format` (JSON schema) and `effort: "low"` —
 *   the same depth the OpenAI calls ask for. The schema is sent without the constraints the structured output does not
 *   take (lengths, bounds); the assistant validates the parsed answer against the full schema after, as it always has.
 * - OpenRouter: one chat completion with `response_format: json_schema` (strict), `require_parameters` so a provider
 *   that would drop the schema is not used, no fallbacks, no data collection, no attribution headers (a listing in its
 *   public rankings is a publication, the operator's to make).
 *
 * Keys come only from the environment, by name, and are never read out.
 */

import Anthropic from "@anthropic-ai/sdk";

import { assistantProviderOf, PROVIDER_KEY_ENV, providerPrices, setProviderPrices, type AssistantProvider } from "../assistant/models.ts";
import { createOpenAiAgentModel, type AgentModel, type ModelEnv, type ResponsesParseClient } from "./model.ts";

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

type Body = Record<string, unknown>;
type CallOptions = { timeout?: number; maxRetries?: number };
type Parsed = { id?: string; output_parsed: unknown; output?: unknown; usage?: unknown; service_tier?: unknown };

/** The JSON schema of a Responses `text.format` (`zodTextFormat`): its name and schema, or null when the call has none. */
export function formatOf(text: unknown): Readonly<{ name: string; schema: Record<string, unknown> }> | null {
  const format = (text && typeof text === "object" ? (text as { format?: unknown }).format : null) as { type?: unknown; name?: unknown; schema?: unknown } | null;
  if (!format || format.type !== "json_schema" || !format.schema || typeof format.schema !== "object") return null;
  return { name: typeof format.name === "string" ? format.name : "answer", schema: format.schema as Record<string, unknown> };
}

/** Keywords Anthropic's structured output does not take; the parsed answer is still checked against them afterwards. */
const UNSUPPORTED = new Set(["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "uniqueItems", "pattern", "format", "$schema"]);

/** The schema as Anthropic's structured output takes it: the same shape, without the constraints it cannot hold. */
export function anthropicSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(anthropicSchema);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (UNSUPPORTED.has(key)) continue;
    // `properties` is a map of names: a property called «format» or «pattern» is kept.
    out[key] = key === "properties" && inner && typeof inner === "object" ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).map(([name, prop]) => [name, anthropicSchema(prop)])) : anthropicSchema(inner);
  }
  return out;
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const whole = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** The slice of Anthropic's client the adapter calls — so the tests hand in their own. */
export type AnthropicMessages = { messages: { create(body: Record<string, unknown>, options?: CallOptions): Promise<unknown> } };

/** Anthropic's models through its own API, in the Responses shape the assistant calls. */
export function anthropicResponsesClient(input: Readonly<{ apiKey?: string; client?: AnthropicMessages }>): ResponsesParseClient {
  const sdk: AnthropicMessages = input.client ?? (new Anthropic({ apiKey: input.apiKey, maxRetries: 0 }) as unknown as AnthropicMessages);
  return {
    responses: {
      async parse(body: Body, options?: CallOptions): Promise<Parsed> {
        const format = formatOf(body.text);
        const identifier = typeof body.safety_identifier === "string" ? body.safety_identifier : null;
        const message = (await sdk.messages.create(
          {
            model: String(body.model),
            max_tokens: whole(body.max_output_tokens) || 1_000,
            system: String(body.instructions ?? ""),
            messages: [{ role: "user", content: String(body.input ?? "") }],
            output_config: { effort: "low", ...(format ? { format: { type: "json_schema", schema: anthropicSchema(format.schema) } } : {}) },
            // The assistant's own hashed identifier of the person: Anthropic's abuse signal, never a name or a wallet.
            ...(identifier ? { metadata: { user_id: identifier } } : {}),
          },
          { ...(options?.timeout ? { timeout: options.timeout } : {}), maxRetries: 0 },
        )) as { id?: string; content?: { type?: string; text?: string }[]; stop_reason?: string; usage?: Record<string, unknown> };
        const text = (message.content ?? []).filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
        const refused = message.stop_reason === "refusal";
        // An answer cut at the ceiling is not an answer: it is billed and read as invalid, never half-shown.
        const parsed = refused || message.stop_reason === "max_tokens" || !format ? null : parseJson(text);
        const usage = message.usage ?? {};
        const read = whole(usage.cache_read_input_tokens);
        const written = whole(usage.cache_creation_input_tokens);
        const input = whole(usage.input_tokens) + read + written;
        const output = whole(usage.output_tokens);
        return {
          id: message.id,
          output_parsed: parsed,
          output: refused ? [{ type: "message", content: [{ type: "refusal", refusal: "declined" }] }] : [],
          usage: { input_tokens: input, output_tokens: output, total_tokens: input + output, input_tokens_details: { cached_tokens: read }, output_tokens_details: { reasoning_tokens: 0 } },
        };
      },
    },
  };
}

/** One failed call as the assistant's classifier reads it: the HTTP status, the provider's code. */
class ProviderError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  constructor(status: number | undefined, code: string | undefined, name: string) {
    super(`${name}${status ? ` ${status}` : ""}`);
    this.name = name;
    this.status = status;
    this.code = code;
  }
}

/** Any model through OpenRouter, in the Responses shape the assistant calls. */
export function openRouterResponsesClient(input: Readonly<{ apiKey: string; fetch?: typeof fetch; url?: string }>): ResponsesParseClient {
  const send = input.fetch ?? fetch;
  return {
    responses: {
      async parse(body: Body, options?: CallOptions): Promise<Parsed> {
        const format = formatOf(body.text);
        const identifier = typeof body.safety_identifier === "string" ? body.safety_identifier : null;
        let response: Response;
        try {
          response = await send(input.url ?? OPENROUTER_CHAT_URL, {
            method: "POST",
            headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
            signal: AbortSignal.timeout(options?.timeout ?? 30_000),
            body: JSON.stringify({
              model: String(body.model),
              messages: [
                { role: "system", content: String(body.instructions ?? "") },
                { role: "user", content: String(body.input ?? "") },
              ],
              max_tokens: whole(body.max_output_tokens) || 1_000,
              reasoning: { effort: "low" },
              ...(format ? { response_format: { type: "json_schema", json_schema: { name: format.name, strict: true, schema: format.schema } } } : {}),
              provider: { allow_fallbacks: false, require_parameters: true, data_collection: "deny" },
              transforms: [],
              ...(identifier ? { user: identifier } : {}),
              stream: false,
            }),
          });
        } catch (error) {
          const name = (error as { name?: unknown })?.name;
          throw new ProviderError(undefined, undefined, name === "TimeoutError" || name === "AbortError" ? "APIConnectionTimeoutError" : "APIConnectionError");
        }
        const raw = (await response.json().catch(() => null)) as {
          id?: string;
          choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[];
          usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } | null; completion_tokens_details?: { reasoning_tokens?: unknown } | null };
          error?: { code?: unknown; message?: unknown };
        } | null;
        if (!response.ok || !raw || raw.error) {
          const code = raw?.error?.code;
          throw new ProviderError(response.ok ? (typeof code === "number" ? code : 502) : response.status, response.status === 402 ? "insufficient_quota" : typeof code === "string" ? code : undefined, "OpenRouterError");
        }
        const choice = raw.choices?.[0];
        const refusal = typeof choice?.message?.refusal === "string" && choice.message.refusal.length > 0;
        const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
        const parsed = refusal || choice?.finish_reason === "length" || !format ? null : parseJson(content);
        const usage = raw.usage ?? {};
        const prompt = whole(usage.prompt_tokens);
        const completion = whole(usage.completion_tokens);
        return {
          id: raw.id,
          output_parsed: parsed,
          output: refusal ? [{ type: "message", content: [{ type: "refusal", refusal: "declined" }] }] : [],
          usage: {
            input_tokens: prompt,
            output_tokens: completion,
            total_tokens: whole(usage.total_tokens) || prompt + completion,
            input_tokens_details: { cached_tokens: whole(usage.prompt_tokens_details?.cached_tokens) },
            output_tokens_details: { reasoning_tokens: whole(usage.completion_tokens_details?.reasoning_tokens) },
          },
        };
      },
    },
  };
}

/** The client of a provider with its key from the environment; null when the key is not set. */
export function providerClient(provider: AssistantProvider, env: ModelEnv): ResponsesParseClient | null {
  const key = env[PROVIDER_KEY_ENV[provider]]?.trim();
  if (!key) return null;
  if (provider === "anthropic") return anthropicResponsesClient({ apiKey: key });
  if (provider === "openrouter") return openRouterResponsesClient({ apiKey: key });
  return null;
}

/**
 * The assistant's model on this deployment: OpenAI unless another provider is named and keyed. One model class per
 * task, as before; a provider's own model per class from its variables.
 */
export function createProviderAgentModel(input: Readonly<{ env: ModelEnv; timeoutMs?: number; client?: ResponsesParseClient }>): AgentModel | null {
  // The environment is handed in by the runtime: this module reads none of its own.
  const env = input.env;
  const provider = assistantProviderOf(env);
  if (provider === "openai") return createOpenAiAgentModel({ env, ...(input.client ? { client: input.client } : {}), ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}) });
  const client = input.client ?? providerClient(provider, env);
  if (!client) return null;
  // Its calls are priced from the deployment's own figures for its models (`*_ASSISTANT_PRICE_L1 / _L2`).
  setProviderPrices(providerPrices(env));
  return createOpenAiAgentModel({ env, client, provider, ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}) });
}
