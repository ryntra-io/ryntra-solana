/**
 * The model gateway's call (CITY-45, decision 72): one OpenRouter chat
 * completion with a pinned model and its budget.
 *
 * - Pinned: `model` is one exact id, `provider.only` its providers,
 *   `allow_fallbacks: false`, `require_parameters: true` (a provider that would
 *   drop the schema or the thinking cap is not used), no `models` list, no
 *   prompt compression (`transforms: []`). An alias never leaves the server.
 * - Checked against the catalog first (cached ten minutes): a model missing
 *   from it, not pinnable or without a price is refused before it costs.
 * - Budgeted: `max_tokens` and `reasoning.max_tokens` from the call's budget,
 *   and one `AbortSignal` for the time — sending and reading the body both. A
 *   thinking budget of 0 turns thinking off (`reasoning.effort: "none"`) where
 *   the model takes it; a model that always thinks is refused a 0, and an
 *   Anthropic model a budget of 1–1023 (OpenRouter would raise it to 1024,
 *   past what the call allowed).
 * - Priced: the cost is OpenRouter's own `usage.cost` for this call, in
 *   micro-dollars rounded up so a sum never understates — the assistant's
 *   unit (`lib/assistant/models.ts`). No cost in the response is `null`.
 * - Journaled: every call, answered or not, writes one record.
 *
 * No attribution headers (`HTTP-Referer`, `X-Title`): they list the app in
 * OpenRouter's public rankings, a publication that is the operator's to make.
 */

import { createModelCatalog, estimateCostMicroUsd, highestPrices, type CatalogEndpoint, type CatalogModel, type ModelCatalog } from "./catalog.ts";
import { MODELS_ENV, keyShaped, missingKey, readKey, type ModelsEnv } from "./env.ts";
import { ModelGatewayError, classifyHttpFailure, classifyThrown, readErrorBody } from "./errors.ts";
import { consoleJournal } from "./journal.ts";
import { MAX_PROVIDERS, checkPin, providerMatches, slugReaches, type PinnedModel } from "./pin.ts";
import type {
  AnsweredBy,
  ModelBudget,
  ModelCall,
  ModelCallRecord,
  ModelFailure,
  ModelGateway,
  ModelJournal,
  ModelMessage,
  ModelNeeds,
  ModelResult,
  ModelToolCall,
  ModelUsage,
  PreflightResult,
} from "./types.ts";

export const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export const BUDGET_LIMITS = {
  maxTokens: { min: 1, max: 64_000 },
  timeoutMs: { min: 1_000, max: 300_000 },
  messages: { max: 200 },
  /** Characters across all messages — a long attempt is refused before it costs anything. */
  promptChars: { max: 400_000 },
  tools: { max: 32 },
} as const;

/** OpenRouter's floor for an Anthropic model's thinking budget: a smaller `reasoning.max_tokens` is raised to it. */
export const ANTHROPIC_MIN_THINKING_TOKENS = 1_024;

export type GatewayDeps = Readonly<{
  env?: ModelsEnv;
  fetch?: typeof fetch;
  now?: () => number;
  /** The time budget's signal; `AbortSignal.timeout` unless a test holds the clock. */
  timeout?: (ms: number) => AbortSignal;
  journal?: ModelJournal;
  /** The catalog every call and `preflight` check the model against (cached); without one the gateway keeps its own, read with the same `fetch`. */
  catalog?: ModelCatalog;
  url?: string;
}>;

const SUBJECT_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

const whole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

function checkBudget(budget: unknown): ModelGatewayError | null {
  const b = (budget && typeof budget === "object" ? budget : {}) as Partial<ModelBudget>;
  const { maxTokens, timeoutMs } = BUDGET_LIMITS;
  if (!whole(b.maxTokens) || b.maxTokens < maxTokens.min || b.maxTokens > maxTokens.max) return new ModelGatewayError("invalid_request", `budget.maxTokens is a whole number from ${maxTokens.min} to ${maxTokens.max}.`);
  if (!whole(b.reasoningTokens) || b.reasoningTokens < 0 || (b.reasoningTokens > 0 && b.reasoningTokens >= b.maxTokens)) return new ModelGatewayError("invalid_request", "budget.reasoningTokens is 0 or a whole number below budget.maxTokens.");
  if (!whole(b.timeoutMs) || b.timeoutMs < timeoutMs.min || b.timeoutMs > timeoutMs.max) return new ModelGatewayError("invalid_request", `budget.timeoutMs is a whole number from ${timeoutMs.min} to ${timeoutMs.max}.`);
  return null;
}

function checkRequest(request: ModelCall): ModelGatewayError | null {
  const subject = request.subject as { kind?: unknown; id?: unknown } | undefined;
  if (!subject || (subject.kind !== "vault-guard" && subject.kind !== "ring-agent") || typeof subject.id !== "string" || !SUBJECT_ID.test(subject.id)) {
    return new ModelGatewayError("invalid_request", "subject is { kind: \"vault-guard\" | \"ring-agent\", id } with an id of 1–64 safe characters.");
  }
  const pin = checkPin(request.model);
  if (pin) return pin;
  if ("models" in (request as object)) return new ModelGatewayError("invalid_request", "A list of fallback models is never sent: one pinned model per call.");
  const budget = checkBudget(request.budget);
  if (budget) return budget;
  if (!Array.isArray(request.messages) || request.messages.length === 0 || request.messages.length > BUDGET_LIMITS.messages.max) return new ModelGatewayError("invalid_request", `messages holds 1 to ${BUDGET_LIMITS.messages.max} messages.`);
  let chars = 0;
  for (const message of request.messages) {
    const { role, content, toolCallId } = (message ?? {}) as { role?: unknown; content?: unknown; toolCallId?: unknown };
    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") return new ModelGatewayError("invalid_request", "A message's role is system, user, assistant or tool.");
    if (typeof content !== "string" && !(role === "assistant" && content === null)) return new ModelGatewayError("invalid_request", "A message's content is text.");
    if (role === "tool" && (typeof toolCallId !== "string" || toolCallId.length === 0)) return new ModelGatewayError("invalid_request", "A tool message names the call it answers.");
    chars += typeof content === "string" ? content.length : 0;
  }
  if (chars > BUDGET_LIMITS.promptChars.max) return new ModelGatewayError("invalid_request", `The messages hold more than ${BUDGET_LIMITS.promptChars.max} characters.`);
  if (request.tools !== undefined) {
    if (!Array.isArray(request.tools) || request.tools.length > BUDGET_LIMITS.tools.max) return new ModelGatewayError("invalid_request", `tools holds at most ${BUDGET_LIMITS.tools.max} functions.`);
    for (const tool of request.tools) {
      if (!tool || !TOOL_NAME.test(tool.name) || !tool.parameters || typeof tool.parameters !== "object") return new ModelGatewayError("invalid_request", "A tool has a name of 1–64 safe characters and a JSON schema for its parameters.");
    }
  }
  if (request.responseFormat !== undefined && (!TOOL_NAME.test(request.responseFormat.name) || !request.responseFormat.schema || typeof request.responseFormat.schema !== "object")) {
    return new ModelGatewayError("invalid_request", "responseFormat has a name of 1–64 safe characters and a JSON schema.");
  }
  if (request.apiKey !== undefined && !keyShaped(request.apiKey)) return new ModelGatewayError("no_key", "The subject's own key handed in is empty or not a key's shape.");
  return null;
}

function wireMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })) } : {}),
    };
  }
  return { role: message.role, content: message.content };
}

type ThinkingControl = Pick<CatalogModel, "reasoningMandatory" | "reasoningEfforts">;

/** Whether a budget of 0 can turn the model's thinking off: it takes `effort: "none"` and does not always think. */
export function thinkingCanBeOff(model: ThinkingControl): boolean {
  return !model.reasoningMandatory && model.reasoningEfforts.includes("none");
}

const isAnthropic = (id: string): boolean => /^anthropic\//i.test(id);

/** The thinking budget against what the catalog says of the model; `null` when they fit. */
export function checkThinking(model: Pick<CatalogModel, "id" | "reasoning" | "reasoningMandatory">, reasoningTokens: number): ModelGatewayError | null {
  if (reasoningTokens > 0 && !model.reasoning) return new ModelGatewayError("invalid_request", `${model.id} takes no thinking budget: set budget.reasoningTokens to 0.`);
  if (reasoningTokens === 0 && model.reasoningMandatory) return new ModelGatewayError("invalid_request", `${model.id} always thinks: a thinking budget of 0 cannot turn it off — give it one below budget.maxTokens.`);
  if (reasoningTokens > 0 && reasoningTokens < ANTHROPIC_MIN_THINKING_TOKENS && isAnthropic(model.id)) {
    return new ModelGatewayError("invalid_request", `OpenRouter raises an Anthropic thinking budget to at least ${ANTHROPIC_MIN_THINKING_TOKENS} tokens: set budget.reasoningTokens to 0 or from ${ANTHROPIC_MIN_THINKING_TOKENS}.`);
  }
  return null;
}

/** The model as the catalog has it, fit to be called: listed, pinnable, priced. */
function checkModel(entry: CatalogModel | null, id: string): ModelGatewayError | null {
  if (!entry) return new ModelGatewayError("not_found", `${id} is not in OpenRouter's catalog.`);
  if (!entry.pinnable) return new ModelGatewayError("invalid_request", `«${id}» is an alias or a router (OpenRouter lists it with a target or a price below zero), not a pinned model.`);
  if (estimateCostMicroUsd(entry, { input: 1, output: 1 }) === null) return new ModelGatewayError("invalid_request", `${id} has no known price: a model is offered only with its price shown.`);
  return null;
}

/**
 * The request body OpenRouter receives — the whole pin, the whole budget, and
 * nothing that lets it route elsewhere. With the catalog's word on the model,
 * a thinking budget of 0 is sent as `effort: "none"` where the model takes it.
 */
export function requestBody(request: ModelCall, model: ThinkingControl | null = null): Record<string, unknown> {
  const { budget } = request;
  const thinking = budget.reasoningTokens > 0 ? { max_tokens: budget.reasoningTokens, exclude: false } : model && thinkingCanBeOff(model) ? { effort: "none" } : null;
  return {
    model: request.model.id,
    messages: request.messages.map(wireMessage),
    max_tokens: budget.maxTokens,
    ...(thinking ? { reasoning: thinking } : {}),
    ...(request.tools?.length
      ? { tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, ...(tool.description ? { description: tool.description } : {}), parameters: tool.parameters } })) }
      : {}),
    ...(request.responseFormat ? { response_format: { type: "json_schema", json_schema: { name: request.responseFormat.name, strict: true, schema: request.responseFormat.schema } } } : {}),
    provider: {
      only: [...request.model.providers],
      allow_fallbacks: false,
      require_parameters: true,
      ...(request.denyDataCollection ? { data_collection: "deny" } : {}),
    },
    transforms: [],
    stream: false,
  };
}

const tokens = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** OpenRouter's `usage` in the five figures the journal keeps. */
export function usageOf(raw: unknown): ModelUsage {
  const usage = (raw && typeof raw === "object" ? raw : {}) as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown } | null;
    completion_tokens_details?: { reasoning_tokens?: unknown } | null;
  };
  const input = tokens(usage.prompt_tokens);
  const output = tokens(usage.completion_tokens);
  return {
    input,
    cached: Math.min(input, tokens(usage.prompt_tokens_details?.cached_tokens)),
    output,
    reasoning: Math.min(output, tokens(usage.completion_tokens_details?.reasoning_tokens)),
    total: tokens(usage.total_tokens) || input + output,
  };
}

const dollars = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
};

/**
 * Micro-dollars OpenRouter billed for the call, from `usage.cost`, rounded up.
 * With a provider key of our own (BYOK) `cost` is only OpenRouter's fee and the
 * provider's bill is `cost_details.upstream_inference_cost`: both, or unknown.
 */
export function costMicroUsdOf(raw: unknown): number | null {
  const usage = (raw && typeof raw === "object" ? raw : {}) as { cost?: unknown; is_byok?: unknown; cost_details?: { upstream_inference_cost?: unknown } | null };
  const cost = dollars(usage.cost);
  if (cost === null) return null;
  let total = cost;
  if (usage.is_byok === true) {
    const upstream = dollars(usage.cost_details?.upstream_inference_cost);
    if (upstream === null) return null;
    total += upstream;
  }
  return Math.max(0, Math.ceil(total * 1_000_000 - 1e-9));
}

function answeredBy(body: { model?: unknown; provider?: unknown }, pin: PinnedModel, entry: CatalogModel | null, slugByName: ReadonlyMap<string, string> | null): AnsweredBy {
  const model = typeof body.model === "string" && body.model.length > 0 ? body.model.slice(0, 160) : null;
  const provider = typeof body.provider === "string" && body.provider.length > 0 ? body.provider.slice(0, 80) : null;
  /* The response may name the dated slug; without the catalog's word a different name is unknown, not a mismatch. */
  const modelMatch = model === null ? null : model === pin.id || model === entry?.canonicalSlug ? true : entry ? false : null;
  /* The provider is named by its display name; only OpenRouter's list of providers turns it into a slug. */
  const providerMatch = provider === null ? null : providerMatches(provider, pin.providers, slugByName);
  const pinned = modelMatch === false || providerMatch === false ? false : modelMatch === true && providerMatch === true ? true : null;
  return { model, provider, pinned };
}

function toolCallsOf(raw: unknown): ModelToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: ModelToolCall[] = [];
  for (const item of raw) {
    const call = (item && typeof item === "object" ? item : {}) as { id?: unknown; function?: { name?: unknown; arguments?: unknown } | null };
    if (typeof call.id !== "string" || typeof call.function?.name !== "string") continue;
    calls.push({ id: call.id, name: call.function.name, arguments: typeof call.function.arguments === "string" ? call.function.arguments : "" });
  }
  return calls;
}

function failure(error: ModelGatewayError, latencyMs: number, billed: Partial<Pick<ModelFailure, "usage" | "costMicroUsd" | "answered" | "generationId">> = {}): ModelFailure {
  return { ok: false, error, usage: billed.usage ?? null, costMicroUsd: billed.costMicroUsd ?? null, answered: billed.answered ?? null, generationId: billed.generationId ?? null, latencyMs };
}

const generationIdOf = (body: unknown): string | null => {
  const id = body && typeof body === "object" ? (body as { id?: unknown }).id : undefined;
  return typeof id === "string" && id.length > 0 ? id.slice(0, 128) : null;
};

const lowest = (values: readonly (number | null)[]): number | null => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? Math.min(...known) : null;
};

const asGatewayError = (error: unknown, what: string): ModelGatewayError => (error instanceof ModelGatewayError ? error : new ModelGatewayError("provider_unavailable", `${what} could not be read.`));

type Ability = Readonly<{ flag: "tools" | "structuredOutputs" | "reasoning"; label: string }>;

export function createModelGateway(deps: GatewayDeps = {}): ModelGateway {
  const env = deps.env ?? {};
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;
  const timeout = deps.timeout ?? ((ms: number) => AbortSignal.timeout(ms));
  const journal = deps.journal ?? consoleJournal;
  const url = deps.url ?? CHAT_URL;
  const catalog = deps.catalog ?? createModelCatalog({ fetch: fetchImpl, now });

  async function record(request: ModelCall, result: ModelResult, ownKey: boolean, startedAt: number): Promise<void> {
    /* A request refused for its shape is still recorded, with what of it can be told. */
    const subject = request.subject;
    const budget = request.budget;
    const entry: ModelCallRecord = {
      schema: "ryntra.model-call",
      version: 1,
      at: new Date(startedAt).toISOString(),
      subject: subject && (subject.kind === "vault-guard" || subject.kind === "ring-agent") && typeof subject.id === "string" && SUBJECT_ID.test(subject.id) ? { kind: subject.kind, id: subject.id } : null,
      requested: { model: String(request.model?.id ?? "").slice(0, 160), providers: Array.isArray(request.model?.providers) ? request.model.providers.slice(0, MAX_PROVIDERS).map((p) => String(p).slice(0, 64)) : [] },
      answered: result.answered,
      generationId: result.generationId,
      key: ownKey ? "own" : "shared",
      budget: budget && whole(budget.maxTokens) && whole(budget.reasoningTokens) && whole(budget.timeoutMs) ? { maxTokens: budget.maxTokens, reasoningTokens: budget.reasoningTokens, timeoutMs: budget.timeoutMs } : null,
      usage: result.usage,
      costMicroUsd: result.costMicroUsd,
      latencyMs: result.latencyMs,
      outcome: result.ok ? "ok" : result.error.kind,
      finishReason: result.ok ? result.finishReason : null,
    };
    try {
      await journal(entry);
    } catch (error: unknown) {
      /* A journal that fails never fails the call it records; it is said aloud instead. */
      console.error(`[models.journal] could not record a call: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function send(request: ModelCall, apiKey: string, startedAt: number): Promise<ModelResult> {
    const elapsed = () => Math.max(0, now() - startedAt);
    /* The catalog's word on the model before anything is spent; the providers' names only to tell who answered. */
    const [entry, slugByName] = await Promise.all([
      catalog.get(request.model.id).catch((error: unknown) => asGatewayError(error, "The catalog")),
      catalog.providers().then(
        (snapshot) => snapshot.slugByName,
        () => null,
      ),
    ]);
    if (entry instanceof ModelGatewayError) return failure(entry, elapsed());
    const refused = checkModel(entry, request.model.id) ?? (entry ? checkThinking(entry, request.budget.reasoningTokens) : null);
    if (refused || !entry) return failure(refused ?? new ModelGatewayError("not_found", `${request.model.id} is not in OpenRouter's catalog.`), elapsed());
    const timer = timeout(request.budget.timeoutMs);
    const signal = request.signal ? AbortSignal.any([timer, request.signal]) : timer;
    let response: Response | null = null;
    let body: unknown;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(requestBody(request, entry)),
        signal,
      });
      body = await response.json();
    } catch (error: unknown) {
      const timedOut = timer.aborted;
      const stopped = request.signal?.aborted === true;
      /*
       * A body that is not JSON is read by its status below; a stop while the body was still coming is the stop.
       * A stopped call may still be billed for what the provider generated, but no `usage.cost` and no
       * generation id come back with it: its cost is unknown here (`null`).
       */
      if (!response || timedOut || stopped) return failure(classifyThrown(error, timedOut, stopped), elapsed());
      body = undefined;
    }
    if (!response.ok) return failure(classifyHttpFailure(response.status, body, response.headers.get("retry-after")), elapsed(), { generationId: generationIdOf(body) });
    if (!body || typeof body !== "object") return failure(new ModelGatewayError("invalid_response", "OpenRouter's answer was not JSON.", response.status), elapsed());

    const reply = body as { id?: unknown; model?: unknown; provider?: unknown; usage?: unknown; choices?: unknown; error?: unknown };
    const answered = answeredBy(reply, request.model, entry, slugByName);
    const generationId = generationIdOf(reply);
    const billed = { usage: reply.usage ? usageOf(reply.usage) : null, costMicroUsd: costMicroUsdOf(reply.usage), answered, generationId };
    if (reply.error) {
      /* An error inside a 200: OpenRouter's code is the status it would have sent. */
      const code = (reply.error as { code?: unknown }).code;
      const status = typeof code === "number" && code >= 400 && code < 600 ? code : 502;
      return failure(classifyHttpFailure(status, reply, response.headers.get("retry-after")), elapsed(), billed);
    }
    const choice = Array.isArray(reply.choices) ? (reply.choices[0] as { finish_reason?: unknown; message?: unknown; error?: unknown } | undefined) : undefined;
    if (choice?.error) {
      const { message } = readErrorBody({ error: choice.error });
      return failure(new ModelGatewayError("provider_unavailable", `The provider failed mid-answer${message ? `: ${message}` : ""}`, response.status), elapsed(), billed);
    }
    const message = (choice?.message && typeof choice.message === "object" ? choice.message : null) as { content?: unknown; reasoning?: unknown; tool_calls?: unknown } | null;
    if (!message) return failure(new ModelGatewayError("invalid_response", "OpenRouter's answer holds no message.", response.status), elapsed(), billed);

    const text = typeof message.content === "string" ? message.content : null;
    const toolCalls = toolCallsOf(message.tool_calls);
    /* All of `maxTokens` spent on thinking leaves `""`: billed, but no reply to a guard's or an agent's turn. */
    if ((text === null || text.trim() === "") && toolCalls.length === 0) return failure(new ModelGatewayError("invalid_response", "The message holds neither text nor a tool call.", response.status), elapsed(), billed);
    let json: unknown = null;
    if (request.responseFormat && text !== null) {
      try {
        json = JSON.parse(text);
      } catch {
        return failure(new ModelGatewayError("invalid_response", "The structured reply is not JSON.", response.status), elapsed(), billed);
      }
    }
    return {
      ok: true,
      text,
      json,
      toolCalls,
      reasoning: typeof message.reasoning === "string" && message.reasoning.length > 0 ? message.reasoning : null,
      finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
      usage: billed.usage ?? usageOf(null),
      costMicroUsd: billed.costMicroUsd,
      answered,
      generationId,
      latencyMs: elapsed(),
    };
  }

  async function call(request: ModelCall): Promise<ModelResult> {
    const startedAt = now();
    const ownKey = request?.apiKey !== undefined;
    let result: ModelResult;
    const invalid = request && typeof request === "object" ? checkRequest(request) : new ModelGatewayError("invalid_request", "The call is empty.");
    if (invalid) result = failure(invalid, 0);
    else {
      const apiKey = request.apiKey ?? readKey(env, MODELS_ENV.apiKey);
      result = apiKey ? await send(request, apiKey, startedAt) : failure(missingKey(MODELS_ENV.apiKey), 0);
    }
    if (request && typeof request === "object") await record(request, result, ownKey, startedAt);
    return result;
  }

  /**
   * The pinned model as it will be served: the catalog's entry checked, then
   * each pinned slug matched against the model's endpoints (`tag`), and the
   * prices, limits and abilities read from the endpoints that can do what the
   * game needs — what a call pinned this way may be routed to.
   */
  async function preflight(model: PinnedModel, needs: ModelNeeds = {}): Promise<PreflightResult> {
    const refuse = (error: ModelGatewayError): PreflightResult => ({ ok: false, error });
    const pin = checkPin(model);
    if (pin) return refuse(pin);
    const thinkingBudget = needs.reasoningTokens;
    if (thinkingBudget !== undefined && (!whole(thinkingBudget) || thinkingBudget < 0)) return refuse(new ModelGatewayError("invalid_request", "needs.reasoningTokens is a whole number from 0."));
    let snapshot;
    try {
      snapshot = await catalog.list();
    } catch (error: unknown) {
      return refuse(asGatewayError(error, "The catalog"));
    }
    const entry = snapshot.models.find((item) => item.id === model.id) ?? null;
    const unfit = checkModel(entry, model.id);
    if (unfit || !entry) return refuse(unfit ?? new ModelGatewayError("not_found", `${model.id} is not in OpenRouter's catalog.`));
    if (thinkingBudget !== undefined) {
      const thinking = checkThinking(entry, thinkingBudget);
      if (thinking) return refuse(thinking);
    }

    let served;
    try {
      served = await catalog.endpoints(model.id);
    } catch (error: unknown) {
      return refuse(asGatewayError(error, "The model's endpoints"));
    }
    const reached = new Set<CatalogEndpoint>();
    for (const slug of model.providers) {
      const hits = served.endpoints.filter((endpoint) => slugReaches(slug, endpoint));
      if (hits.length === 0) {
        const tags = served.endpoints.map((endpoint) => endpoint.tag).slice(0, 12).join(", ") || "none";
        return refuse(new ModelGatewayError("not_found", `«${slug}» serves no endpoint of ${model.id} (its endpoints: ${tags}).`));
      }
      for (const hit of hits) reached.add(hit);
    }

    /* With `require_parameters`, a call goes only to an endpoint that takes every parameter it sends. */
    const sendsThinking = needs.reasoning === true || (thinkingBudget ?? 0) > 0 || (thinkingBudget === 0 && thinkingCanBeOff(entry));
    const wanted: Ability[] = [
      ...(needs.tools ? [{ flag: "tools", label: "tools" } as const] : []),
      ...(needs.structuredOutputs ? [{ flag: "structuredOutputs", label: "structured outputs" } as const] : []),
      ...(sendsThinking ? [{ flag: "reasoning", label: thinkingBudget === 0 ? "turning thinking off" : "a thinking budget" } as const] : []),
    ];
    const candidates = [...reached];
    const able = candidates.filter((endpoint) => wanted.every((ability) => endpoint[ability.flag]));
    const on = `${model.id} on ${model.providers.join(", ")}`;
    if (able.length === 0) {
      const missing = wanted.filter((ability) => !candidates.some((endpoint) => endpoint[ability.flag])).map((ability) => ability.label);
      return refuse(
        new ModelGatewayError("invalid_request", missing.length ? `${on} does not support ${missing.join(", ")}.` : `No one endpoint of ${on} supports ${wanted.map((ability) => ability.label).join(" and ")} together.`),
      );
    }
    const pinned: CatalogModel = {
      ...entry,
      contextLength: lowest(able.map((endpoint) => endpoint.contextLength)) ?? entry.contextLength,
      maxOutputTokens: lowest(able.map((endpoint) => endpoint.maxOutputTokens)) ?? entry.maxOutputTokens,
      prices: highestPrices(able),
      tools: able.some((endpoint) => endpoint.tools),
      structuredOutputs: able.some((endpoint) => endpoint.structuredOutputs),
      reasoning: entry.reasoning && able.some((endpoint) => endpoint.reasoning),
    };
    if (estimateCostMicroUsd(pinned, { input: 1, output: 1 }) === null) return refuse(new ModelGatewayError("invalid_request", `${on} has no known price: a model is offered only with its price shown.`));
    return { ok: true, model: pinned, endpoints: able, stale: snapshot.stale || served.stale };
  }

  return { call, preflight };
}
