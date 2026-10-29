/**
 * A stand-in for OpenRouter's public catalog, for a developer's machine without the network and for tests:
 * `RYNTRA_RING_MODELS=stub` outside production (`server.ts`). It answers the same three reads the gateway's catalog
 * makes (`/models`, `/models/{id}/endpoints`, `/providers`) with fixed bodies, so everything after the fetch — parsing,
 * pinning, `preflight`, the classes — runs the real code.
 *
 * The ids follow the review's list (27.10) but **the prices here are fixtures, not OpenRouter's**. Production never
 * reads this file: there the brain picker shows only the live catalog with its price.
 */

type Endpoint = { tag: string; provider: string; input: number; output: number; tools?: boolean; structured?: boolean; tier?: string };
type Fixture = { id: string; name: string; input: number; output: number; tools?: boolean; structured?: boolean; endpoints?: Endpoint[] };

const PROVIDERS: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  "amazon-bedrock": "Amazon Bedrock",
  "google-vertex": "Google",
  "google-ai-studio": "Google AI Studio",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  deepinfra: "DeepInfra",
  xai: "xAI",
  moonshotai: "Moonshot AI",
};

/** Dollars per 1M tokens as OpenRouter writes a price: dollars per token, a decimal string. */
const perToken = (perMillion: number) => (perMillion / 1_000_000).toString();

const FIXTURES: readonly Fixture[] = [
  { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", input: 0.1, output: 0.4, tools: true, endpoints: [{ tag: "deepseek", provider: "deepseek", input: 0.1, output: 0.4, tools: true }, { tag: "deepinfra/turbo", provider: "deepinfra", input: 0.12, output: 0.5, tools: true, structured: true }] },
  { id: "openai/gpt-6-luna", name: "GPT-6 Luna", input: 0.15, output: 0.6, tools: true, structured: true },
  { id: "anthropic/claude-haiku-5.5", name: "Anthropic Haiku 5.5", input: 0.25, output: 1.25, tools: true, structured: true, endpoints: [{ tag: "anthropic", provider: "anthropic", input: 0.25, output: 1.25, tools: true, structured: true }, { tag: "amazon-bedrock/us-east-1", provider: "amazon-bedrock", input: 0.3, output: 1.5, tools: true }] },
  { id: "moonshotai/kimi-k3.1-pro", name: "Kimi K3.1 Pro", input: 1, output: 4, tools: true },
  { id: "google/gemini-4-argon", name: "Gemini 4 Argon", input: 2, output: 12, tools: true, structured: true, endpoints: [{ tag: "google-vertex", provider: "google-vertex", input: 2, output: 12, tools: true, structured: true }, { tag: "google-ai-studio/flex", provider: "google-ai-studio", input: 1, output: 6, tools: true, structured: true, tier: "flex" }] },
  { id: "openai/gpt-6.1-sol", name: "GPT-6.1 Sol", input: 2.5, output: 10, tools: true, structured: true },
  { id: "anthropic/claude-sonnet-5.5", name: "Anthropic Sonnet 5.5", input: 3, output: 15, tools: true, structured: true, endpoints: [{ tag: "anthropic", provider: "anthropic", input: 3, output: 15, tools: true, structured: true }, { tag: "amazon-bedrock/us-east-1", provider: "amazon-bedrock", input: 3.3, output: 16.5, tools: true, structured: true }] },
  { id: "x-ai/grok-4.7", name: "Grok 4.7", input: 3, output: 15, tools: true, structured: true, endpoints: [{ tag: "xai", provider: "xai", input: 3, output: 15, tools: true, structured: true }] },
  { id: "anthropic/claude-opus-5.5", name: "Anthropic Opus 5.5", input: 5, output: 25, tools: true, structured: true },
  { id: "openai/gpt-6-astra", name: "GPT-6 Astra", input: 10, output: 40, tools: true, structured: true },
  { id: "anthropic/claude-fable-5.1", name: "Anthropic Fable 5.1", input: 15, output: 75, tools: true, structured: true },
  /* Past the heavy ceiling: listed by OpenRouter, never offered by the Ring. */
  { id: "openai/o9-pro", name: "o9 Pro", input: 150, output: 600, tools: true, structured: true },
];

function modelBody(fixture: Fixture) {
  const parameters = ["max_tokens", "temperature", ...(fixture.tools ? ["tools", "tool_choice"] : []), ...(fixture.structured ? ["response_format", "structured_outputs"] : [])];
  return {
    id: fixture.id,
    canonical_slug: fixture.id,
    name: fixture.name,
    context_length: 200_000,
    pricing: { prompt: perToken(fixture.input), completion: perToken(fixture.output) },
    top_provider: { context_length: 200_000, max_completion_tokens: 32_000 },
    supported_parameters: parameters,
  };
}

function endpointsOf(fixture: Fixture): Endpoint[] {
  const base = fixture.id.split("/")[0] ?? "openai";
  const tag = base === "x-ai" ? "xai" : base;
  return fixture.endpoints ?? [{ tag, provider: tag, input: fixture.input, output: fixture.output, tools: fixture.tools, structured: fixture.structured }];
}

function endpointBody(endpoint: Endpoint) {
  return {
    tag: endpoint.tag,
    provider_name: PROVIDERS[endpoint.provider] ?? endpoint.provider,
    ...(endpoint.tier ? { service_tier: endpoint.tier } : {}),
    context_length: 200_000,
    max_completion_tokens: 32_000,
    pricing: { prompt: perToken(endpoint.input), completion: perToken(endpoint.output) },
    supported_parameters: ["max_tokens", ...(endpoint.tools ? ["tools", "tool_choice"] : []), ...(endpoint.structured ? ["response_format", "structured_outputs"] : [])],
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The catalog's three reads, answered from the fixtures; any other address is a 404. */
export const stubCatalogFetch: typeof fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const path = url.pathname.replace(/^\/api\/v1/, "");
  if (path === "/models") {
    return json({ data: [...FIXTURES.map(modelBody), { id: "openrouter/auto", name: "Auto Router", pricing: { prompt: "-1", completion: "-1" } }, { id: "acme/unpriced-1", name: "Unpriced", pricing: {} }] });
  }
  if (path === "/providers") return json({ data: Object.entries(PROVIDERS).map(([slug, name]) => ({ name, slug })) });
  const match = /^\/models\/(.+)\/endpoints$/.exec(path);
  const fixture = match ? FIXTURES.find((item) => item.id === decodeURIComponent(match[1]!)) : undefined;
  if (fixture) return json({ data: { id: fixture.id, endpoints: endpointsOf(fixture).map(endpointBody) } });
  return json({ error: { code: 404, message: "No such model." } }, 404);
};

export const STUB_MODEL_IDS: readonly string[] = FIXTURES.map((fixture) => fixture.id);
