/**
 * The one interface every model call in Ryntra City goes through (CITY-45,
 * decision 72): a Vault's guard (CITY-47) and a Ring's agent (CITY-50) both
 * hold a `ModelGateway` and call it the same way. The names here are the
 * contract `lib/models/README.md` describes; a stub of the gateway keeps them.
 *
 * Types only.
 */

import type { CatalogEndpoint, CatalogModel } from "./catalog.ts";
import type { ModelGatewayError } from "./errors.ts";
import type { PinnedModel } from "./pin.ts";

export type { CatalogEndpoint, CatalogModel } from "./catalog.ts";
export type { ModelErrorKind, ModelGatewayError } from "./errors.ts";
export type { PinnedModel } from "./pin.ts";

/** Who a call is for — written in the journal and in a key's name; never a wallet, never words. */
export type ModelSubject = Readonly<{
  kind: "vault-guard" | "ring-agent";
  /** The guard's or the agent's own id: 1–64 of `A–Z a–z 0–9 . _ : -`. */
  id: string;
}>;

/** The budget of one call: tokens and time. Every call names all three. */
export type ModelBudget = Readonly<{
  /** `max_tokens`: everything the model writes, thinking included — 1 to 64 000. */
  maxTokens: number;
  /**
   * `reasoning.max_tokens`, below `maxTokens`. 0 turns thinking off (`reasoning.effort: "none"` where the
   * model takes it); a model that always thinks is refused a 0, an Anthropic model a budget of 1–1023.
   */
  reasoningTokens: number;
  /** The whole call, from sending to the last byte read — 1 000 to 300 000 ms. */
  timeoutMs: number;
}>;

export type ModelToolCall = Readonly<{ id: string; name: string; arguments: string }>;

export type ModelMessage =
  | Readonly<{ role: "system" | "user"; content: string }>
  | Readonly<{ role: "assistant"; content: string | null; toolCalls?: readonly ModelToolCall[] }>
  | Readonly<{ role: "tool"; toolCallId: string; content: string }>;

/** A function the model may ask for; the caller runs it, the gateway never does. A guard has none. */
export type ModelTool = Readonly<{ name: string; description?: string; parameters: Readonly<Record<string, unknown>> }>;

/** A strict JSON schema for the reply (`response_format: json_schema`, `strict: true`). */
export type ModelResponseFormat = Readonly<{ name: string; schema: Readonly<Record<string, unknown>> }>;

export type ModelCall = Readonly<{
  subject: ModelSubject;
  model: PinnedModel;
  messages: readonly ModelMessage[];
  budget: ModelBudget;
  tools?: readonly ModelTool[];
  responseFormat?: ModelResponseFormat;
  /** The subject's own key from the server's secret store (`ModelKeyManager.create`); without it the shared `OPENROUTER_API_KEY`. */
  apiKey?: string;
  /** Only providers that keep no prompts (`provider.data_collection: "deny"`) — for a guard whose prompt holds the phrase. */
  denyDataCollection?: boolean;
  /** The caller's own stop, on top of the budget's time. */
  signal?: AbortSignal;
}>;

/** Tokens as OpenRouter counted them; reasoning is inside `output`, cached inside `input`. */
export type ModelUsage = Readonly<{ input: number; cached: number; output: number; reasoning: number; total: number }>;

/** Who answered, by OpenRouter's own word. */
export type AnsweredBy = Readonly<{
  /** The model the response names (`model`), or `null` when it names none. */
  model: string | null;
  /** The provider the response names (`provider`), or `null`. */
  provider: string | null;
  /** True when both are the pinned ones; false when either is known to differ; `null` when it cannot be told. */
  pinned: boolean | null;
}>;

export type ModelReply = Readonly<{
  ok: true;
  /** The reply's text; with `responseFormat`, the JSON as text. `null` when the model only asked for tools. */
  text: string | null;
  /** With `responseFormat`: the parsed reply. */
  json: unknown;
  toolCalls: readonly ModelToolCall[];
  /** The model's thinking, when it returned any. It can hold anything the prompt held — never shown unfiltered. */
  reasoning: string | null;
  /** `stop`, `length` (ran into `maxTokens`), `tool_calls`, … as OpenRouter says; `null` when it does not. */
  finishReason: string | null;
  usage: ModelUsage;
  /** What OpenRouter billed for this call (`usage.cost`), micro-dollars rounded up; `null` when it did not say — never 0 for unknown. */
  costMicroUsd: number | null;
  answered: AnsweredBy;
  /** OpenRouter's generation id (`gen-…`) for a later look-up of the bill. */
  generationId: string | null;
  latencyMs: number;
}>;

export type ModelFailure = Readonly<{
  ok: false;
  error: ModelGatewayError;
  /** Usage and cost when the call was answered and billed but the answer is unusable (`invalid_response`); otherwise `null`. */
  usage: ModelUsage | null;
  costMicroUsd: number | null;
  answered: AnsweredBy | null;
  /** OpenRouter's generation id when the failed answer carried one — to look the bill up later; `null` when none came back. */
  generationId: string | null;
  latencyMs: number;
}>;

export type ModelResult = ModelReply | ModelFailure;

/** What a game needs from a model before it lets anyone pick it. */
export type ModelNeeds = Readonly<{
  tools?: boolean;
  structuredOutputs?: boolean;
  reasoning?: boolean;
  /** The thinking budget the game will call with: 0 refuses a model that always thinks, 1–1023 an Anthropic model. */
  reasoningTokens?: number;
}>;

export type PreflightResult =
  | Readonly<{
      ok: true;
      /** The catalog's model as pinned: prices, limits and abilities from the pinned providers' endpoints that can do what was asked — not the model-wide figures. */
      model: CatalogModel;
      /** Those endpoints: what the call may be routed to. */
      endpoints: readonly CatalogEndpoint[];
      stale: boolean;
    }>
  | Readonly<{ ok: false; error: ModelGatewayError }>;

export type ModelGateway = Readonly<{
  /** One call with a pinned model and its budget. Never throws: every failure comes back as `{ ok: false, error }`. */
  call(request: ModelCall): Promise<ModelResult>;
  /** Before a game opens: the model is pinned, in the catalog, priced, and can do what the game needs. Never throws. */
  preflight(model: PinnedModel, needs?: ModelNeeds): Promise<PreflightResult>;
}>;

/** One line of the journal per call — the figures, never the prompt, the reply or a key. */
export type ModelCallRecord = Readonly<{
  schema: "ryntra.model-call";
  version: 1;
  at: string;
  /** `null` only for a call refused because its subject was malformed. */
  subject: ModelSubject | null;
  requested: Readonly<{ model: string; providers: readonly string[] }>;
  answered: AnsweredBy | null;
  generationId: string | null;
  /** Whose key paid: the subject's own or the shared one. */
  key: "own" | "shared";
  /** `null` only for a call refused because its budget was malformed. */
  budget: ModelBudget | null;
  usage: ModelUsage | null;
  costMicroUsd: number | null;
  latencyMs: number;
  outcome: "ok" | ModelGatewayError["kind"];
  finishReason: string | null;
}>;

export type ModelJournal = (record: ModelCallRecord) => void | Promise<void>;
