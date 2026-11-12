/**
 * The model catalog and its prices (CITY-45, decision 72) — OpenRouter's
 * public reads, without a key, kept for a while:
 *
 * - `GET /api/v1/models` — every model, model-wide: its id, dated slug,
 *   whether its thinking can be turned off, whether it is pinnable;
 * - `GET /api/v1/models/{id}/endpoints` — the endpoints serving one model,
 *   each under the `tag` that `provider.only` takes, with that endpoint's own
 *   prices and parameters. What a pinned call costs and can do is read here,
 *   from the pinned providers' endpoints, never from the model-wide figures;
 * - `GET /api/v1/providers` — each provider's display name and slug, so the
 *   provider a response names can be told against the pinned slugs.
 *
 * OpenRouter prices a model in dollars per token, as a decimal string
 * (`"0.000003"`). Dollars per 1M tokens and micro-dollars per token are the
 * same number, so a price is read by moving the decimal point six places in
 * the string — no float multiplication, `"0.0000025"` is exactly `2.5`. A
 * price that is missing, not a number or negative (OpenRouter's routers say
 * `"-1"`) is `null`: unknown, never zero. A free model's `"0"` is a known zero.
 * Above a prompt size some endpoints charge more (`pricing.overrides`, each
 * with its `min_prompt_tokens`); an estimate takes the tier the prompt is in.
 *
 * The cache: a fresh copy for `ttlMs`; after that the next read refetches,
 * and if OpenRouter is down a copy younger than `maxStaleMs` is served marked
 * `stale` rather than nothing. Readers at the same moment share one request.
 */

import { ModelGatewayError, classifyHttpFailure, classifyThrown } from "./errors.ts";
import { isAliasId, modelIdShaped } from "./pin.ts";

export const CATALOG_URL = "https://openrouter.ai/api/v1/models";
export const PROVIDERS_URL = "https://openrouter.ai/api/v1/providers";
export const CATALOG_TTL_MS = 10 * 60_000;
export const CATALOG_MAX_STALE_MS = 24 * 60 * 60_000;
export const CATALOG_TIMEOUT_MS = 10_000;
/** Models whose endpoints are kept at once; the oldest read is dropped past it. */
export const ENDPOINTS_CACHE_MAX = 256;

/** One price tier, dollars per 1M tokens — equal to micro-dollars per token. */
export type PriceTier = Readonly<{
  /** The tier holds from this many prompt tokens up (`min_prompt_tokens`). */
  minPromptTokens: number;
  inputPerMillionUsd: number | null;
  outputPerMillionUsd: number | null;
  /** Reasoning tokens, when OpenRouter prices them apart from output; `null` when it does not say. */
  reasoningPerMillionUsd: number | null;
  cacheReadPerMillionUsd: number | null;
}>;

/** Dollars per 1M tokens — equal to micro-dollars per token. */
export type CatalogPrices = Readonly<{
  inputPerMillionUsd: number | null;
  outputPerMillionUsd: number | null;
  /** Reasoning tokens, when OpenRouter prices them apart from output; `null` when it does not say. */
  reasoningPerMillionUsd: number | null;
  cacheReadPerMillionUsd: number | null;
  /** Other prices from a prompt size up (`pricing.overrides`), lowest threshold first; a price an override leaves out stays the base one. */
  overrides: readonly PriceTier[];
}>;

/** Anything that carries prices: a catalog model, an endpoint, a pinned model from `preflight`. */
export type Priced = Readonly<{ prices: CatalogPrices }>;

export type CatalogModel = Readonly<{
  id: string;
  /** The dated slug OpenRouter may answer with (`anthropic/claude-4-sonnet-20250522` for `anthropic/claude-sonnet-4`). */
  canonicalSlug: string | null;
  name: string;
  contextLength: number | null;
  maxOutputTokens: number | null;
  prices: CatalogPrices;
  /** `tools` among the model's supported parameters. */
  tools: boolean;
  /** `structured_outputs` among them: a strict JSON schema is honoured, not only JSON mode. */
  structuredOutputs: boolean;
  /** `reasoning` among them: a thinking budget can be set. */
  reasoning: boolean;
  /** `reasoning.mandatory`: the model always thinks — a budget of 0 cannot turn it off. */
  reasoningMandatory: boolean;
  /** `reasoning.supported_efforts`; with `"none"` thinking can be turned off. */
  reasoningEfforts: readonly string[];
  /** False for an alias, a router (`isAliasId`, `alias_target`) or anything priced below zero: listed, but never callable by the gateway. */
  pinnable: boolean;
  /**
   * What the model answers with, as OpenRouter lists it (`architecture.output_modalities`, lower-cased): `["text"]` for
   * a model that talks, `["image", "text"]` for one that draws. `null` when the entry does not say — unknown, never
   * «text». Only those who choose what to offer read it (the Ring's list of brains, CITY-239); the gateway calls a
   * model whatever this says.
   */
  outputModalities: readonly string[] | null;
}>;

/** One endpoint serving a model: one provider (or its region, variant or service tier) with its own prices and parameters. */
export type CatalogEndpoint = Readonly<{
  /** The slug `provider.only` takes for exactly this endpoint (`amazon-bedrock/us-east-1`, `anthropic`); OpenRouter's `tag`. */
  tag: string;
  /** The name a response gives this provider (`Amazon Bedrock`). */
  providerName: string;
  /** A service tier (`flex`): only the full tag reaches it, never the base slug. */
  serviceTier: string | null;
  contextLength: number | null;
  maxOutputTokens: number | null;
  prices: CatalogPrices;
  tools: boolean;
  structuredOutputs: boolean;
  reasoning: boolean;
}>;

export type CatalogSnapshot = Readonly<{
  models: readonly CatalogModel[];
  /** When this copy was read from OpenRouter, ISO. */
  readAt: string;
  /** True when OpenRouter could not be read and an older copy is served. */
  stale: boolean;
}>;

export type EndpointsSnapshot = Readonly<{ modelId: string; endpoints: readonly CatalogEndpoint[]; readAt: string; stale: boolean }>;

export type ProvidersSnapshot = Readonly<{
  /** Display name → slug, exactly as OpenRouter lists them (`Google` → `google-vertex`). */
  slugByName: ReadonlyMap<string, string>;
  readAt: string;
  stale: boolean;
}>;

export type ModelCatalog = Readonly<{
  /** The whole catalog, from the cache while it is fresh. */
  list(): Promise<CatalogSnapshot>;
  /** One model by its exact id, or `null` when the catalog has no such model. */
  get(id: string): Promise<CatalogModel | null>;
  /** One model from what is already cached — no request; `null` when nothing is cached or the id is not there. */
  peek(id: string): CatalogModel | null;
  /** The endpoints serving one model, cached per model like the list; a model OpenRouter does not know is `not_found`. */
  endpoints(id: string): Promise<EndpointsSnapshot>;
  /** OpenRouter's providers, name → slug, cached like the list. */
  providers(): Promise<ProvidersSnapshot>;
}>;

export type CatalogDeps = Readonly<{
  fetch?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
  maxStaleMs?: number;
  timeoutMs?: number;
  /** The models list; a model's endpoints are read under it (`{url}/{id}/endpoints`). */
  url?: string;
  providersUrl?: string;
}>;

/** A decimal string or number of dollars per token as dollars per 1M tokens; `null` for anything that is not a known price. */
export function perMillion(raw: unknown): number | null {
  const text = typeof raw === "number" ? (Number.isFinite(raw) ? raw.toString() : "") : typeof raw === "string" ? raw.trim() : "";
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0") + 6;
  /* Shift the decimal point right by six (plus any exponent) inside the digits themselves. */
  const digits = whole + fraction;
  const point = whole.length + exponent;
  let shifted: string;
  if (point <= 0) shifted = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) shifted = digits + "0".repeat(point - digits.length);
  else shifted = `${digits.slice(0, point)}.${digits.slice(point)}`;
  const value = Number(shifted);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

const count = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null);

type RawPricing = Record<string, unknown>;

/** Base prices and their overrides from OpenRouter's `pricing`; an override's missing price stays the base one. */
export function parsePrices(raw: unknown): CatalogPrices {
  const pricing = (raw && typeof raw === "object" ? raw : {}) as RawPricing;
  const base = {
    inputPerMillionUsd: perMillion(pricing.prompt),
    outputPerMillionUsd: perMillion(pricing.completion),
    reasoningPerMillionUsd: perMillion(pricing.internal_reasoning),
    cacheReadPerMillionUsd: perMillion(pricing.input_cache_read),
  };
  const overrides: PriceTier[] = [];
  for (const item of Array.isArray(pricing.overrides) ? pricing.overrides : []) {
    const override = (item && typeof item === "object" ? item : {}) as RawPricing;
    const minPromptTokens = count(override.min_prompt_tokens);
    if (minPromptTokens === null) continue;
    const price = (key: string, fallback: number | null) => (key in override ? perMillion(override[key]) : fallback);
    overrides.push({
      minPromptTokens,
      inputPerMillionUsd: price("prompt", base.inputPerMillionUsd),
      outputPerMillionUsd: price("completion", base.outputPerMillionUsd),
      reasoningPerMillionUsd: price("internal_reasoning", base.reasoningPerMillionUsd),
      cacheReadPerMillionUsd: price("input_cache_read", base.cacheReadPerMillionUsd),
    });
  }
  overrides.sort((a, b) => a.minPromptTokens - b.minPromptTokens);
  return { ...base, overrides };
}

/** A price below zero anywhere in `pricing` — OpenRouter's mark of a router that picks the model (`"-1"`). */
function pricedBelowZero(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  return Object.values(raw as RawPricing).some((value) => (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number(value) < 0);
}

const parameterSet = (raw: unknown): ReadonlySet<string> => new Set(Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : []);

/** One catalog entry, or `null` when it has no usable id. Unknown fields are ignored; missing ones read as unknown. */
export function parseCatalogModel(raw: unknown): CatalogModel | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as {
    id?: unknown;
    canonical_slug?: unknown;
    name?: unknown;
    context_length?: unknown;
    pricing?: unknown;
    top_provider?: { context_length?: unknown; max_completion_tokens?: unknown } | null;
    supported_parameters?: unknown;
    reasoning?: { mandatory?: unknown; supported_efforts?: unknown } | null;
    alias_target?: unknown;
    architecture?: { output_modalities?: unknown } | null;
  };
  if (typeof entry.id !== "string" || entry.id.length === 0 || entry.id.length > 160) return null;
  const parameters = parameterSet(entry.supported_parameters);
  const reasoning = entry.reasoning && typeof entry.reasoning === "object" ? entry.reasoning : {};
  const outputs = entry.architecture && typeof entry.architecture === "object" ? entry.architecture.output_modalities : undefined;
  return {
    id: entry.id,
    canonicalSlug: typeof entry.canonical_slug === "string" && entry.canonical_slug.length > 0 ? entry.canonical_slug : null,
    name: typeof entry.name === "string" ? entry.name.slice(0, 160) : entry.id,
    contextLength: count(entry.context_length) ?? count(entry.top_provider?.context_length),
    maxOutputTokens: count(entry.top_provider?.max_completion_tokens),
    prices: parsePrices(entry.pricing),
    tools: parameters.has("tools"),
    structuredOutputs: parameters.has("structured_outputs"),
    reasoning: parameters.has("reasoning"),
    reasoningMandatory: reasoning.mandatory === true,
    reasoningEfforts: Array.isArray(reasoning.supported_efforts) ? reasoning.supported_efforts.filter((item): item is string => typeof item === "string" && item.length <= 16).slice(0, 16) : [],
    pinnable: !isAliasId(entry.id) && !pricedBelowZero(entry.pricing) && (entry.alias_target === undefined || entry.alias_target === null),
    outputModalities: Array.isArray(outputs) ? outputs.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 24).slice(0, 8).map((item) => item.toLowerCase()) : null,
  };
}

/** The catalog body `{ data: [...] }`; a body without the list is an invalid response, never an empty catalog. */
export function parseCatalog(raw: unknown): readonly CatalogModel[] {
  const data = raw && typeof raw === "object" ? (raw as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) throw new ModelGatewayError("invalid_response", "The catalog came back without its list of models.");
  const seen = new Map<string, CatalogModel>();
  for (const item of data) {
    const model = parseCatalogModel(item);
    if (model && !seen.has(model.id)) seen.set(model.id, model);
  }
  return [...seen.values()];
}

/** One endpoint of `GET /api/v1/models/{id}/endpoints`, or `null` without a usable `tag`. */
export function parseEndpoint(raw: unknown): CatalogEndpoint | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as { tag?: unknown; provider_name?: unknown; service_tier?: unknown; context_length?: unknown; max_completion_tokens?: unknown; pricing?: unknown; supported_parameters?: unknown };
  if (typeof entry.tag !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,31})?$/i.test(entry.tag)) return null;
  const parameters = parameterSet(entry.supported_parameters);
  return {
    tag: entry.tag,
    providerName: typeof entry.provider_name === "string" ? entry.provider_name.slice(0, 80) : "",
    serviceTier: typeof entry.service_tier === "string" && entry.service_tier.length > 0 ? entry.service_tier.slice(0, 32) : null,
    contextLength: count(entry.context_length),
    maxOutputTokens: count(entry.max_completion_tokens),
    prices: parsePrices(entry.pricing),
    tools: parameters.has("tools"),
    structuredOutputs: parameters.has("structured_outputs"),
    reasoning: parameters.has("reasoning"),
  };
}

/** The endpoints body `{ data: { id, endpoints: [...] } }`; a body without the list is an invalid response. */
export function parseEndpoints(raw: unknown): readonly CatalogEndpoint[] {
  const data = raw && typeof raw === "object" ? (raw as { data?: { endpoints?: unknown } | null }).data : undefined;
  const list = data && typeof data === "object" ? data.endpoints : undefined;
  if (!Array.isArray(list)) throw new ModelGatewayError("invalid_response", "The model's endpoints came back without their list.");
  return list.map(parseEndpoint).filter((endpoint): endpoint is CatalogEndpoint => endpoint !== null);
}

/** The providers body `{ data: [{ name, slug }] }` as name → slug; a body without the list is an invalid response. */
export function parseProviders(raw: unknown): ReadonlyMap<string, string> {
  const data = raw && typeof raw === "object" ? (raw as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) throw new ModelGatewayError("invalid_response", "The providers came back without their list.");
  const slugByName = new Map<string, string>();
  for (const item of data) {
    const { name, slug } = (item && typeof item === "object" ? item : {}) as { name?: unknown; slug?: unknown };
    if (typeof name === "string" && name.length > 0 && typeof slug === "string" && slug.length > 0 && !slugByName.has(name)) slugByName.set(name, slug.slice(0, 64));
  }
  return slugByName;
}

/** The base prices or the override the prompt's size falls in (the highest `minPromptTokens` it reaches). */
export function priceTierAt(prices: CatalogPrices, promptTokens: number): Omit<PriceTier, "minPromptTokens"> {
  let tier: Omit<PriceTier, "minPromptTokens"> = prices;
  for (const override of prices.overrides) if (promptTokens >= override.minPromptTokens) tier = override;
  return { inputPerMillionUsd: tier.inputPerMillionUsd, outputPerMillionUsd: tier.outputPerMillionUsd, reasoningPerMillionUsd: tier.reasoningPerMillionUsd, cacheReadPerMillionUsd: tier.cacheReadPerMillionUsd };
}

const highest = (values: readonly (number | null)[]): number | null => (values.length === 0 || values.some((value) => value === null) ? null : Math.max(...(values as number[])));

/**
 * The prices of several endpoints as one: at every prompt size the highest of
 * them, unknown if any is unknown. A call pinned to several endpoints may be
 * served by any of them, so an estimate from these never understates.
 */
export function highestPrices(list: readonly Priced[]): CatalogPrices {
  const at = (promptTokens: number) => {
    const tiers = list.map((item) => priceTierAt(item.prices, promptTokens));
    return {
      inputPerMillionUsd: highest(tiers.map((tier) => tier.inputPerMillionUsd)),
      outputPerMillionUsd: highest(tiers.map((tier) => tier.outputPerMillionUsd)),
      reasoningPerMillionUsd: highest(tiers.map((tier) => tier.reasoningPerMillionUsd)),
      cacheReadPerMillionUsd: highest(tiers.map((tier) => tier.cacheReadPerMillionUsd)),
    };
  };
  const thresholds = [...new Set(list.flatMap((item) => item.prices.overrides.map((override) => override.minPromptTokens)))].sort((a, b) => a - b);
  return { ...at(0), overrides: thresholds.map((minPromptTokens) => ({ minPromptTokens, ...at(minPromptTokens) })) };
}

/**
 * Micro-dollars for a number of tokens at these prices, rounded up — the
 * estimate shown before a call, never its bill (the bill is the call's own
 * `usage.cost`). The tier is the prompt size's (`pricing.overrides`). Give it
 * `preflight`'s model — the pinned providers' prices — rather than the
 * catalog's model-wide entry. `null` when either price is unknown.
 */
export function estimateCostMicroUsd(priced: Priced, tokens: Readonly<{ input: number; output: number }>): number | null {
  const inputTokens = Math.max(0, Math.floor(tokens.input));
  const outputTokens = Math.max(0, Math.floor(tokens.output));
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  const { inputPerMillionUsd: input, outputPerMillionUsd: output } = priceTierAt(priced.prices, inputTokens);
  if (input === null || output === null) return null;
  return Math.max(0, Math.ceil(inputTokens * input + outputTokens * output - 1e-9));
}

type Clock = Readonly<{ now: () => number; ttlMs: number; maxStaleMs: number }>;

type CachedRead<T, S> = Readonly<{ get(): Promise<S>; peek(): T | null }>;

/**
 * One read kept for its time: fresh for `ttlMs`, then refetched; while
 * OpenRouter is down an older copy within `maxStaleMs` is served stale. A
 * `not_found` is OpenRouter's answer, not an outage: the copy is dropped.
 */
function cachedRead<T, S>(read: () => Promise<T>, snapshot: (value: T, readAtMs: number, stale: boolean) => S, clock: Clock): CachedRead<T, S> {
  let cached: { value: T; readAtMs: number } | null = null;
  let inflight: Promise<S> | null = null;

  async function refresh(): Promise<S> {
    try {
      const value = await read();
      const readAtMs = clock.now();
      cached = { value, readAtMs };
      return snapshot(value, readAtMs, false);
    } catch (error: unknown) {
      if (error instanceof ModelGatewayError && error.kind === "not_found") cached = null;
      else if (cached && clock.now() - cached.readAtMs <= clock.maxStaleMs) return snapshot(cached.value, cached.readAtMs, true);
      throw error;
    }
  }

  return {
    get(): Promise<S> {
      if (cached && clock.now() - cached.readAtMs < clock.ttlMs) return Promise.resolve(snapshot(cached.value, cached.readAtMs, false));
      if (!inflight) inflight = refresh().finally(() => (inflight = null));
      return inflight;
    },
    peek(): T | null {
      return cached?.value ?? null;
    },
  };
}

export function createModelCatalog(deps: CatalogDeps = {}): ModelCatalog {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const clock: Clock = { now: deps.now ?? Date.now, ttlMs: deps.ttlMs ?? CATALOG_TTL_MS, maxStaleMs: deps.maxStaleMs ?? CATALOG_MAX_STALE_MS };
  const timeoutMs = deps.timeoutMs ?? CATALOG_TIMEOUT_MS;
  const url = deps.url ?? CATALOG_URL;
  const providersUrl = deps.providersUrl ?? PROVIDERS_URL;
  const iso = (ms: number) => new Date(ms).toISOString();

  async function readJson(target: string, what: string): Promise<unknown> {
    const timer = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      /* A public read: no key, no cookie, nothing about who asks. */
      response = await fetchImpl(target, { method: "GET", headers: { accept: "application/json" }, signal: timer });
    } catch (error: unknown) {
      throw classifyThrown(error, timer.aborted, false);
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      if (response.ok) throw new ModelGatewayError("invalid_response", `${what} was not JSON.`, response.status);
    }
    if (!response.ok) throw classifyHttpFailure(response.status, body, response.headers.get("retry-after"));
    return body;
  }

  const models = cachedRead(
    async () => {
      const list = parseCatalog(await readJson(url, "The catalog"));
      return { models: list, byId: new Map(list.map((model) => [model.id, model])) as ReadonlyMap<string, CatalogModel> };
    },
    (value, readAtMs, stale): CatalogSnapshot => ({ models: value.models, readAt: iso(readAtMs), stale }),
    clock,
  );

  const providers = cachedRead(
    async () => parseProviders(await readJson(providersUrl, "The providers")),
    (slugByName, readAtMs, stale): ProvidersSnapshot => ({ slugByName, readAt: iso(readAtMs), stale }),
    clock,
  );

  const endpointsById = new Map<string, CachedRead<readonly CatalogEndpoint[], EndpointsSnapshot>>();
  function endpointsOf(id: string): CachedRead<readonly CatalogEndpoint[], EndpointsSnapshot> {
    let entry = endpointsById.get(id);
    if (!entry) {
      const path = id.split("/").map(encodeURIComponent).join("/");
      entry = cachedRead(
        async () => parseEndpoints(await readJson(`${url}/${path}/endpoints`, "The model's endpoints")),
        (endpoints, readAtMs, stale): EndpointsSnapshot => ({ modelId: id, endpoints, readAt: iso(readAtMs), stale }),
        clock,
      );
      if (endpointsById.size >= ENDPOINTS_CACHE_MAX) endpointsById.delete(endpointsById.keys().next().value as string);
      endpointsById.set(id, entry);
    }
    return entry;
  }

  return {
    list: () => models.get(),
    async get(id) {
      await models.get();
      return models.peek()?.byId.get(id) ?? null;
    },
    peek(id) {
      return models.peek()?.byId.get(id) ?? null;
    },
    async endpoints(id) {
      if (!modelIdShaped(id)) throw new ModelGatewayError("invalid_request", "A model's endpoints are read by its exact OpenRouter id.");
      return endpointsOf(id).get();
    },
    providers: () => providers.get(),
  };
}
