// Run from repo root: node --test lib/agent-control/adapters/agentverse.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

const {
  AGENTVERSE_BASE_URL,
  AGENTVERSE_MAX_MANIFESTS,
  AGENTVERSE_MAX_RESPONSE_BYTES,
  AgentverseAdapterError,
  fetchAgentverseAgentPassport,
} = await import("./agentverse.ts");
const { verifyAgentPassport } = await import("../agent-passport.ts");
const { createAgentPassportGetHandler } = await import(
  "../../../app/api/agents/passport/handler.ts"
);

const ADDRESS = "agent1q2d0n5tp563wr0ugj9cmcqms9jfv5ks63xy5vg3evy5gy0z52e66xmeyyw9";
const CHECKSUM_INVALID_ADDRESS = `${ADDRESS.slice(0, -1)}q`;
const DIGEST_A = "aa".repeat(32);
const DIGEST_B = "bb".repeat(32);
const NOW = new Date("2026-08-14T10:00:00.000Z");
const DECLARED_ENDPOINT = "https://declared-agent.invalid/submit";

function registryPayload(overrides = {}) {
  return {
    status: "offline",
    type: "mailbox",
    address: ADDRESS,
    endpoints: [{ url: DECLARED_ENDPOINT, weight: 1 }],
    protocols: [DIGEST_A],
    expiry: "2026-08-13T00:00:00.000Z",
    domain_name: null,
    metadata: { source: "provider" },
    ...overrides,
  };
}

function searchPayload(overrides = {}) {
  return {
    status: "inactive",
    type: "mailbox",
    address: ADDRESS,
    protocols: [{ name: "chat", version: "1.0.0", digest: DIGEST_A }],
    metadata: { visibility: "public" },
    prefix: "agent",
    name: "Gift example",
    description: "Provider-supplied description.",
    readme: "Provider-supplied readme.",
    avatar_href: "https://agentverse.ai/avatar/example.png",
    banner_href: null,
    total_interactions: 12,
    recent_interactions: 2,
    rating: 4.5,
    unresponsive: true,
    featured: false,
    category: "utility",
    system_wide_tags: ["example"],
    geo_location: null,
    handle: "gift",
    domain: "example.agent",
    last_updated: "2026-08-13T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    recent_success_rate: 0.5,
    recent_eval_success_rate: 0.4,
    owner: "provider-owner",
    starter_prompts: null,
    recent_verified_interactions: 1,
    recent_success_verified_interactions: 1,
    ...overrides,
  };
}

function manifestPayload(digest = DIGEST_A, overrides = {}) {
  return {
    version: "1",
    metadata: {
      name: "chat",
      version: "1.0.0",
      digest,
      description: "Provider protocol description.",
    },
    models: [{ digest: "model-request-v1" }],
    interactions: [],
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function json(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

function cancellationSpyResponse({
  status = 200,
  headers = {},
  chunk = new TextEncoder().encode("{}"),
} = {}) {
  let cancellations = 0;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(chunk);
    },
    cancel() {
      cancellations += 1;
    },
  });
  return {
    response: new Response(body, { status, headers }),
    cancellations: () => cancellations,
  };
}

function source(passport, kind) {
  return passport.sources.find((entry) => entry.kind === kind);
}

function completeFetch({ registry = registryPayload(), search = searchPayload(), manifests = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const path = new URL(url).pathname;
    if (path.startsWith("/v2/almanac/resolve/")) return json(registry);
    if (path.startsWith("/v1/search/agents/")) return json(search);
    const digest = path.slice("/v2/almanac/manifest/".length);
    return json(manifests[digest] ?? manifestPayload(digest));
  };
  return { calls, fetchImpl };
}

test("fixed-origin public GETs preserve provider claims without fetching declared endpoints", async () => {
  const harness = completeFetch();
  const passport = await fetchAgentverseAgentPassport(
    { address: ADDRESS },
    { fetchImpl: harness.fetchImpl, now: () => NOW },
  );

  assert.equal(verifyAgentPassport(passport).valid, true);
  assert.deepEqual(passport.sources.map(({ kind, availability }) => [kind, availability]), [
    ["REGISTRY", "AVAILABLE"],
    ["SEARCH", "AVAILABLE"],
    ["MANIFESTS", "AVAILABLE"],
  ]);
  assert.deepEqual(harness.calls.map(({ url }) => new URL(url).pathname), [
    `/v2/almanac/resolve/${ADDRESS}`,
    `/v1/search/agents/${ADDRESS}`,
    `/v2/almanac/manifest/${DIGEST_A}`,
  ]);
  assert.equal(harness.calls.some(({ url }) => url === DECLARED_ENDPOINT), false);
  assert.equal(harness.calls.some(({ url }) => /\/v1\/almanac\/agents\//.test(url)), false);

  for (const { url, init } of harness.calls) {
    assert.equal(new URL(url).origin, AGENTVERSE_BASE_URL);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    const headers = new Headers(init.headers);
    assert.deepEqual([...headers.keys()], ["accept"]);
    assert.equal(headers.get("accept"), "application/json");
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("cookie"), false);
  }

  const endpointFact = passport.providerClaims.find(({ field }) => field === "endpoints");
  assert.ok(endpointFact.value.some((value) => value.includes(DECLARED_ENDPOINT)));
  const rating = passport.providerClaims.find(({ field }) => field === "rating");
  assert.equal(rating.declaration, "PROVIDER_REPORTED_METRIC");
  assert.match(rating.limitation, /not a Ryntra score.*recommendation/i);
  assert.equal(
    passport.ryntraObservations.find(({ kind }) => kind === "LIVENESS").value,
    "NOT_TESTED",
  );
});

test("strict exact-address input fails before any public read", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return json({});
  };
  for (const input of [
    { address: "not-an-agent-address" },
    { address: `${ADDRESS}/escape` },
    { address: ADDRESS, network: "mainnet" },
    { identifier: ADDRESS },
  ]) {
    await assert.rejects(
      fetchAgentverseAgentPassport(input, { fetchImpl }),
      (error) => error instanceof AgentverseAdapterError && error.code === "INVALID_ADDRESS",
    );
  }
  assert.equal(calls, 0);
});

test("checksum-invalid exact-shape input is rejected before any adapter fetch", async () => {
  let calls = 0;
  await assert.rejects(
    fetchAgentverseAgentPassport(
      { address: CHECKSUM_INVALID_ADDRESS },
      {
        fetchImpl: async () => {
          calls += 1;
          return json({});
        },
      },
    ),
    (error) => error instanceof AgentverseAdapterError && error.code === "INVALID_ADDRESS",
  );
  assert.equal(calls, 0);
});

test("declared or streamed oversize responses become source-labelled partial evidence", async () => {
  for (const oversizedSearch of [
    new Response("{}", {
      status: 200,
      headers: { "Content-Length": String(AGENTVERSE_MAX_RESPONSE_BYTES + 1) },
    }),
    new Response("x".repeat(AGENTVERSE_MAX_RESPONSE_BYTES + 1), { status: 200 }),
  ]) {
    const passport = await fetchAgentverseAgentPassport(
      { address: ADDRESS },
      {
        now: () => NOW,
        fetchImpl: async (url) => {
          const path = new URL(url).pathname;
          if (path.startsWith("/v2/almanac/resolve/")) {
            return json(registryPayload({ protocols: [] }));
          }
          return oversizedSearch;
        },
      },
    );
    const search = source(passport, "SEARCH");
    assert.equal(search.availability, "UNAVAILABLE");
    assert.equal(search.reasonCode, "RESPONSE_TOO_LARGE");
    assert.ok(passport.unknowns.some(({ sourceIds }) => sourceIds.includes("agentverse-search")));
    assert.equal(verifyAgentPassport(passport).valid, true);
  }
});

test("every unconsumed failure response body is cancelled", async () => {
  const cases = [
    {
      label: "non-200",
      expectedReason: "HTTP_ERROR",
      create: () => cancellationSpyResponse({ status: 503 }),
    },
    {
      label: "invalid content-length",
      expectedReason: "INVALID_JSON",
      create: () => cancellationSpyResponse({ headers: { "Content-Length": "invalid" } }),
    },
    {
      label: "oversize content-length",
      expectedReason: "RESPONSE_TOO_LARGE",
      create: () => cancellationSpyResponse({
        headers: { "Content-Length": String(AGENTVERSE_MAX_RESPONSE_BYTES + 1) },
      }),
    },
    {
      label: "invalid UTF-8",
      expectedReason: "INVALID_JSON",
      create: () => cancellationSpyResponse({ chunk: new Uint8Array([0xff]) }),
    },
    {
      label: "streamed oversize",
      expectedReason: "RESPONSE_TOO_LARGE",
      create: () => cancellationSpyResponse({
        chunk: new Uint8Array(AGENTVERSE_MAX_RESPONSE_BYTES + 1),
      }),
    },
  ];

  for (const current of cases) {
    const spy = current.create();
    const passport = await fetchAgentverseAgentPassport(
      { address: ADDRESS },
      {
        now: () => NOW,
        fetchImpl: async (url) => {
          const path = new URL(url).pathname;
          if (path.startsWith("/v2/almanac/resolve/")) {
            return json(registryPayload({ protocols: [] }));
          }
          return spy.response;
        },
      },
    );

    assert.equal(source(passport, "SEARCH").reasonCode, current.expectedReason, current.label);
    assert.equal(spy.cancellations(), 1, `${current.label} body must be cancelled exactly once`);
    assert.equal(verifyAgentPassport(passport).valid, true, current.label);
  }
});

test("internal timeout is partial evidence while caller abort is a typed terminal error", async () => {
  const hangingFetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  const timedOut = await fetchAgentverseAgentPassport(
    { address: ADDRESS },
    { fetchImpl: hangingFetch, timeoutMs: 5, now: () => NOW },
  );
  assert.equal(source(timedOut, "REGISTRY").reasonCode, "TIMEOUT");
  assert.equal(source(timedOut, "SEARCH").reasonCode, "TIMEOUT");
  assert.equal(source(timedOut, "MANIFESTS").availability, "NOT_REQUESTED");
  assert.equal(verifyAgentPassport(timedOut).valid, true);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchAgentverseAgentPassport(
      { address: ADDRESS },
      { fetchImpl: hangingFetch, signal: controller.signal },
    ),
    (error) => error instanceof AgentverseAdapterError && error.code === "ABORTED",
  );

  const inFlightController = new AbortController();
  const inFlight = fetchAgentverseAgentPassport(
    { address: ADDRESS },
    { fetchImpl: hangingFetch, signal: inFlightController.signal },
  );
  inFlightController.abort();
  await assert.rejects(
    inFlight,
    (error) => error instanceof AgentverseAdapterError && error.code === "ABORTED",
  );
});

test("independent source failures preserve available facts and manifest partial state", async () => {
  const harness = completeFetch({
    registry: registryPayload({ protocols: [DIGEST_B, DIGEST_A] }),
  });
  harness.fetchImpl = async (url, init) => {
    harness.calls.push({ url: String(url), init });
    const path = new URL(url).pathname;
    if (path.startsWith("/v2/almanac/resolve/")) {
      return json(registryPayload({ protocols: [DIGEST_B, DIGEST_A] }));
    }
    if (path.startsWith("/v1/search/agents/")) return new Response(null, { status: 404 });
    if (path.endsWith(DIGEST_B)) return new Response(null, { status: 503 });
    return json(manifestPayload(DIGEST_A));
  };

  const passport = await fetchAgentverseAgentPassport(
    { address: ADDRESS },
    { fetchImpl: harness.fetchImpl, now: () => NOW },
  );
  assert.equal(source(passport, "REGISTRY").availability, "AVAILABLE");
  assert.equal(source(passport, "SEARCH").availability, "NOT_FOUND");
  assert.equal(source(passport, "MANIFESTS").availability, "PARTIAL");
  assert.equal(
    passport.providerClaims.filter(({ field }) => field === "protocol_manifest_digest").length,
    1,
  );
  assert.ok(passport.unknowns.some(({ field }) => field === "search_source"));
  assert.ok(passport.unknowns.some(({ field }) => field === "manifests_source"));
  assert.equal(verifyAgentPassport(passport).valid, true);
});

test("unknown enums, outer fields and excessive JSON depth fail closed per source", async () => {
  const cases = [
    {
      registry: registryPayload({ status: "retired", protocols: [] }),
      search: searchPayload(),
      kind: "REGISTRY",
    },
    {
      registry: registryPayload({ protocols: [] }),
      search: searchPayload({ undocumented_score: 99 }),
      kind: "SEARCH",
    },
  ];
  let nested = { leaf: true };
  for (let index = 0; index < 40; index += 1) nested = { nested };
  cases.push({
    registry: registryPayload({ protocols: [] }),
    search: searchPayload({ metadata: nested }),
    kind: "SEARCH",
  });

  for (const current of cases) {
    const harness = completeFetch(current);
    const passport = await fetchAgentverseAgentPassport(
      { address: ADDRESS },
      { fetchImpl: harness.fetchImpl, now: () => NOW },
    );
    assert.equal(source(passport, current.kind).availability, "SCHEMA_DRIFT");
    assert.ok(source(passport, current.kind).schemaDrift.length > 0);
    assert.equal(verifyAgentPassport(passport).valid, true);
  }
});

test("checksum-invalid returned registry and search addresses fail closed per source", async () => {
  for (const current of [
    {
      kind: "REGISTRY",
      registry: registryPayload({ address: CHECKSUM_INVALID_ADDRESS, protocols: [] }),
      search: searchPayload(),
    },
    {
      kind: "SEARCH",
      registry: registryPayload({ protocols: [] }),
      search: searchPayload({ address: CHECKSUM_INVALID_ADDRESS }),
    },
  ]) {
    const harness = completeFetch(current);
    const passport = await fetchAgentverseAgentPassport(
      { address: ADDRESS },
      { fetchImpl: harness.fetchImpl, now: () => NOW },
    );
    const returnedSource = source(passport, current.kind);

    assert.equal(returnedSource.availability, "SCHEMA_DRIFT", current.kind);
    assert.ok(returnedSource.schemaDrift.some((issue) => /INVALID_ADDRESS/.test(issue)));
    assert.equal(verifyAgentPassport(passport).valid, true);
  }
});

test("large schema drift stays deterministic, bounded and HTTP 200 through the API", async () => {
  const unknownFields = Object.fromEntries(
    Array.from({ length: 120 }, (_, index) => [
      `unknown_${String(index).padStart(3, "0")}_${"x".repeat(80)}`,
      index,
    ]),
  );
  const harness = completeFetch({
    registry: registryPayload({ protocols: [] }),
    search: searchPayload(unknownFields),
  });
  const passport = await fetchAgentverseAgentPassport(
    { address: ADDRESS },
    { fetchImpl: harness.fetchImpl, now: () => NOW },
  );
  const issue = source(passport, "SEARCH").schemaDrift[0];

  assert.equal(source(passport, "SEARCH").availability, "SCHEMA_DRIFT");
  assert.ok(issue.length <= 512);
  assert.match(issue, /\.\.\.\[sha256:[0-9a-f]{64}\]$/);
  assert.equal(verifyAgentPassport(passport).valid, true);

  const get = createAgentPassportGetHandler({
    fetchPassport: (input, dependencies) => fetchAgentverseAgentPassport(input, {
      ...dependencies,
      fetchImpl: harness.fetchImpl,
      now: () => NOW,
    }),
    consumeRequest: () => ({
      allowed: true,
      limit: 90,
      remaining: 89,
      resetAfterSeconds: 60,
      retryAfterSeconds: 60,
    }),
  });
  const response = await get(
    new Request(`https://ryntra.test/api/agents/passport?address=${ADDRESS}`),
  );
  const body = await response.json();
  const apiIssue = source(body.data, "SEARCH").schemaDrift[0];

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(apiIssue, issue, "the bounded issue must be deterministic across adapter/API calls");
  assert.ok(apiIssue.length <= 512);
});

test("manifest model schema is optional and manifest drift remains member-local", async () => {
  const registry = registryPayload({ protocols: [DIGEST_A, DIGEST_B] });
  const harness = completeFetch({
    registry,
    manifests: {
      [DIGEST_A]: manifestPayload(DIGEST_A, { models: [{ digest: "model-without-schema" }] }),
      [DIGEST_B]: manifestPayload(DIGEST_B, { undocumented: true }),
    },
  });
  const passport = await fetchAgentverseAgentPassport(
    { address: ADDRESS },
    { fetchImpl: harness.fetchImpl, now: () => NOW },
  );
  const manifests = source(passport, "MANIFESTS");
  assert.equal(manifests.availability, "PARTIAL");
  assert.equal(manifests.members.find(({ id }) => id.includes(DIGEST_A.slice(0, 16))).availability, "AVAILABLE");
  assert.equal(manifests.members.find(({ id }) => id.includes(DIGEST_B.slice(0, 16))).availability, "SCHEMA_DRIFT");
});

test("current search starter prompts and proto-prefixed manifest digests normalize without drift", async () => {
  const harness = completeFetch({
    search: searchPayload({
      protocols: [{ name: "chat", version: "1.0.0", digest: `proto:${DIGEST_A}` }],
      starter_prompts: ["Explain this agent"],
    }),
    manifests: {
      [DIGEST_A]: manifestPayload(`proto:${DIGEST_A}`),
    },
  });
  const passport = await fetchAgentverseAgentPassport(
    { address: ADDRESS },
    { fetchImpl: harness.fetchImpl, now: () => NOW },
  );
  assert.equal(source(passport, "SEARCH").availability, "AVAILABLE");
  assert.equal(source(passport, "MANIFESTS").availability, "AVAILABLE");
  assert.ok(passport.providerClaims.some(
    ({ field, value }) => field === "starter_prompts" && value === '["Explain this agent"]',
  ));
  assert.ok(passport.providerClaims.some(
    ({ field, value }) => field === "protocol_manifest_digest" && value === DIGEST_A,
  ));
  assert.ok(passport.providerClaims.some(
    ({ field, value }) => field === "protocols"
      && Array.isArray(value)
      && value.some((entry) => entry.includes(`\"digest\":\"${DIGEST_A}\"`)),
  ));
  assert.equal(passport.conflicts.some(({ field }) => field === "protocol_manifest_digest"), false);
});

test("provider disagreements remain claims plus conflicts and unknowns", async () => {
  const harness = completeFetch({
    manifests: { [DIGEST_A]: manifestPayload(DIGEST_B) },
  });
  const passport = await fetchAgentverseAgentPassport(
    { address: ADDRESS },
    { fetchImpl: harness.fetchImpl, now: () => NOW },
  );
  assert.ok(passport.providerClaims.some(({ field, value }) => field === "status" && value === "offline"));
  assert.ok(passport.providerClaims.some(({ field, value }) => field === "status" && value === "inactive"));
  assert.ok(passport.conflicts.some(({ field }) => field === "status"));
  assert.ok(passport.conflicts.some(({ field }) => field === "protocol_manifest_digest"));
  assert.ok(passport.unknowns.some(({ field, reasonCode }) => field === "status" && reasonCode === "CONFLICTING_CLAIMS"));
  assert.equal(verifyAgentPassport(passport).valid, true);
});

test("manifest reads are capped to six canonical unique registry digests", async () => {
  const digests = ["ff", "11", "dd", "22", "cc", "33", "bb", "44"].map((pair) => pair.repeat(32));
  const harness = completeFetch({
    registry: registryPayload({ protocols: [...digests, digests[0]] }),
  });
  const passport = await fetchAgentverseAgentPassport(
    { address: ADDRESS },
    { fetchImpl: harness.fetchImpl, now: () => NOW },
  );
  const manifestPaths = harness.calls
    .map(({ url }) => new URL(url).pathname)
    .filter((path) => path.startsWith("/v2/almanac/manifest/"));
  assert.equal(manifestPaths.length, AGENTVERSE_MAX_MANIFESTS);
  assert.deepEqual(
    manifestPaths,
    [...new Set(digests)].sort().slice(0, AGENTVERSE_MAX_MANIFESTS).map(
      (digest) => `/v2/almanac/manifest/${digest}`,
    ),
  );
  assert.ok(passport.unknowns.some(({ id }) => id === "unknown_manifest_bound"));
});
