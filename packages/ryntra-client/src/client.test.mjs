// Run from repo root: node --test packages/ryntra-client/src/client.test.mjs
//
// The client against a fetch it is handed, so every assertion is about the
// client's own behaviour rather than about a server being up. What is proven
// here is the part a caller relies on and cannot see:
//
//   the address it builds, and that it refuses to guess a parameter
//   the answer checked against the contract before it is returned
//   which error class each kind of failure becomes, and whether it retries
//   the cursor walked to its end, and stopped when the server repeats itself
//   the idempotency key on anything that is not a GET
//   the read-only surface: no operation in it is a write
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { needsDevelopmentRepository } from "../../../lib/development-repository.mjs";

import {
  API_HEADER,
  CONTRACT_MAJOR,
  CONTRACT_VERSION,
  ERRORS,
  IDEMPOTENCY_HEADER,
  OPERATIONS,
  RyntraApiError,
  RyntraProtocolError,
  RyntraRouteError,
  RyntraSchemaError,
  RyntraTransportError,
  SCHEMAS,
  createRyntraClient,
  check,
  createTransport,
  describe,
  newIdempotencyKey,
} from "./index.ts";

const BASE = "https://ryntra.io";

/** A fetch that answers from a script and records every call it was handed. */
function stub(script) {
  const calls = [];
  const answers = Array.isArray(script) ? [...script] : [script];
  const fetch = async (url, init) => {
    calls.push({ url, ...init });
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    const headers = new Map(Object.entries(answer.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
    return {
      status: answer.status ?? 200,
      headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
      text: async () => (answer.text !== undefined ? answer.text : JSON.stringify(answer.body ?? null)),
    };
  };
  return { fetch, calls };
}

const client = (script, options = {}) => {
  const { fetch, calls } = stub(script);
  return { calls, ryntra: createRyntraClient({ baseUrl: BASE, fetch, wait: async () => {}, ...options }) };
};

/* A real answer, not an invented one: `docs/api/examples/v1` is generated from
   the same contract and every file in it is parsed with its own zod schema by
   `lib/api/v1/contract.test.mjs`. Writing a fixture by hand here would mean
   maintaining a third description of the same shape, and the test would start
   being about the fixture.

   Those answers live in the development repository, which the closed code
   snapshot does not carry, so the cases that need a *valid* body say so and
   skip there. Everything else in this file stands on bodies of its own. */
const needsExamples = needsDevelopmentRepository("the generated answers under docs/api/examples/v1");
const EXAMPLES = fileURLToPath(new URL("../../../docs/api/examples/v1/", import.meta.url));
const example = (name) => JSON.parse(readFileSync(join(EXAMPLES, name), "utf8"));
const capabilities = () => example("capabilities.response.json");

test("a read names its contract major, builds the address and returns the answer", { skip: needsExamples }, async function () {
  const { ryntra, calls } = client({ body: capabilities(), headers: { "X-Ryntra-API-Version": CONTRACT_VERSION } });
  const answer = await ryntra.read("getCapabilities");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE}/api/v1/capabilities`);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers[API_HEADER], String(CONTRACT_MAJOR));
  assert.equal(calls[0].headers.accept, "application/json");
  assert.equal(calls[0].headers[IDEMPOTENCY_HEADER], undefined, "a GET is idempotent by being a GET");
  assert.equal(answer.contractVersion, capabilities().contractVersion);
});

test("a path parameter goes into the address, a query parameter into the query", async function () {
  const mint = "So11111111111111111111111111111111111111112";
  const { ryntra, calls } = client({ body: {} }, { validate: "off" });
  await ryntra.read("getLaunch", { mint });
  assert.equal(calls[0].url, `${BASE}/api/v1/launch/${mint}`);

  await ryntra.read("discoverPredictions", { q: "election day", limit: 5 });
  const asked = new URL(calls[1].url);
  assert.equal(asked.pathname, "/api/predictions/discover");
  assert.equal(asked.searchParams.get("q"), "election day");
  assert.equal(asked.searchParams.get("limit"), "5");
});

test("a parameter the document does not describe is refused rather than dropped", async function () {
  const { ryntra, calls } = client({ body: {} }, { validate: "off" });
  await assert.rejects(() => ryntra.read("discoverPredictions", { catgeory: "sports" }), /takes no catgeory/);
  await assert.rejects(() => ryntra.read("getLaunch", {}), /needs mint: it is part of the address/);
  assert.equal(calls.length, 0, "neither mistake reaches the network");
});

test("an answer that is not the shape the contract states fails the read", async function () {
  const { ryntra } = client({ body: { contractVersion: 180, modules: "all" } });
  await assert.rejects(
    () => ryntra.read("getCapabilities"),
    (failure) => {
      assert.ok(failure instanceof RyntraSchemaError);
      assert.equal(failure.schema, "Capabilities");
      assert.equal(failure.operationId, "getCapabilities");
      assert.equal(failure.retryable, false, "the server meant it; asking again changes nothing");
      assert.ok(failure.failures.length > 0);
      assert.match(failure.message, /not a Capabilities the contract would recognise/);
      return true;
    },
  );
});

test("an additive field in an answer is not a failure", { skip: needsExamples }, async function () {
  const { ryntra } = client({ body: { ...capabilities(), somethingAddedLater: { deep: true } } });
  const answer = await ryntra.read("getCapabilities");
  assert.equal(answer.contractVersion, capabilities().contractVersion);
});

test("validate: off skips the check, for a caller who has already done it", async function () {
  const { ryntra } = client({ body: { nonsense: true } }, { validate: "off" });
  assert.deepEqual(await ryntra.read("getCapabilities"), { nonsense: true });
});

test("a v1 refusal becomes RyntraApiError with the contract's own code and retryability", async function () {
  const { ryntra } = client({
    status: 429,
    headers: { "X-Ryntra-API-Version": CONTRACT_VERSION, "Retry-After": "2" },
    body: { error: { code: "RATE_LIMITED", message: "The public read budget for this address is spent." } },
  }, { retries: 0 });

  await assert.rejects(
    () => ryntra.read("getCapabilities"),
    (failure) => {
      assert.ok(failure instanceof RyntraApiError);
      assert.equal(failure.code, "RATE_LIMITED");
      assert.equal(failure.status, 429);
      assert.equal(failure.retryable, true);
      assert.equal(failure.known, true);
      assert.equal(failure.retryAfterSeconds, 2);
      assert.equal(failure.contractVersion, CONTRACT_VERSION);
      return true;
    },
  );
});

test("a refusal the contract calls final is not retryable, whatever its status", async function () {
  const { ryntra, calls } = client({ status: 409, body: { error: { code: "PLAN_VERSION_CONFLICT", message: "The plan is on version 3." } } });
  await assert.rejects(
    () => ryntra.read("getLaunch", { mint: "So11111111111111111111111111111111111111112" }),
    (failure) => {
      assert.equal(failure.retryable, false);
      assert.equal(failure.retryable, ERRORS.PLAN_VERSION_CONFLICT.retryable, "read from the table, not from the status");
      return true;
    },
  );
  assert.equal(calls.length, 1, "a decision is not asked again");
});

test("a code this build has not heard of is still an error, and says it is unknown", async function () {
  const { ryntra } = client({ status: 418, body: { error: { code: "SOMETHING_NEWER", message: "later" } } });
  await assert.rejects(
    () => ryntra.read("getCapabilities"),
    (failure) => {
      assert.ok(failure instanceof RyntraApiError);
      assert.equal(failure.code, "SOMETHING_NEWER");
      assert.equal(failure.known, false);
      assert.equal(failure.retryable, false);
      return true;
    },
  );
});

test("a route outside /api/v1 refuses with its own code, in its own class", async function () {
  const { ryntra } = client({ status: 404, body: { error: { code: "UNKNOWN_ASSET", message: "Not on the venue's list.", mint: "x" } } });
  await assert.rejects(
    () => ryntra.read("getSpotMarket", { mint: "So11111111111111111111111111111111111111112" }),
    (failure) => {
      assert.ok(failure instanceof RyntraRouteError);
      assert.ok(!(failure instanceof RyntraApiError), "its codes are not the v1 union, so it is not that class");
      assert.equal(failure.code, "UNKNOWN_ASSET");
      assert.equal(failure.details.mint, "x");
      assert.equal(failure.contractVersion, undefined, "a consumed route sends no version header");
      return true;
    },
  );
});

test("an older route's bare-string refusal keeps its words", async function () {
  const { ryntra } = client({ status: 403, body: { error: "proof required" } });
  await assert.rejects(
    () => ryntra.read("readReferral", { address: "So11111111111111111111111111111111111111112" }),
    (failure) => {
      assert.ok(failure instanceof RyntraRouteError);
      assert.equal(failure.code, "HTTP_403");
      assert.equal(failure.message, "proof required");
      return true;
    },
  );
});

test("a body that is not JSON, and a refusal without the error shape, are protocol failures", async function () {
  const { ryntra } = client({ status: 200, text: "<html>maintenance</html>" });
  await assert.rejects(
    () => ryntra.read("getCapabilities"),
    (failure) => {
      assert.ok(failure instanceof RyntraProtocolError);
      assert.match(failure.message, /not JSON/);
      assert.match(failure.body, /maintenance/);
      return true;
    },
  );

  const bare = client({ status: 500, body: { oops: true } }, { retries: 0 });
  await assert.rejects(
    () => bare.ryntra.read("getCapabilities"),
    (failure) => {
      assert.ok(failure instanceof RyntraProtocolError);
      assert.equal(failure.retryable, true, "a 500 without a shape is still the server having a bad moment");
      return true;
    },
  );
});

test("a request that never got an answer is a transport failure, and is retried", async function () {
  let attempts = 0;
  const ryntra = createRyntraClient({
    baseUrl: BASE,
    wait: async () => {},
    fetch: async () => {
      attempts += 1;
      throw new Error("socket hang up");
    },
  });
  await assert.rejects(
    () => ryntra.read("getCapabilities"),
    (failure) => {
      assert.ok(failure instanceof RyntraTransportError);
      assert.equal(failure.retryable, true);
      assert.equal(failure.status, 0);
      return true;
    },
  );
  assert.equal(attempts, 3, "the default is two retries after the first attempt");
});

test("a retryable refusal is asked again and the second answer is returned", { skip: needsExamples }, async function () {
  const { ryntra, calls } = client([
    { status: 503, body: { error: { code: "UNAVAILABLE", message: "Not now." } } },
    { status: 200, body: capabilities(), headers: { "X-Ryntra-API-Version": CONTRACT_VERSION } },
  ]);
  const answer = await ryntra.read("getCapabilities");
  assert.equal(calls.length, 2);
  assert.equal(answer.contractVersion, capabilities().contractVersion);
});

test("retries: 0 turns retrying off", async function () {
  const { ryntra, calls } = client({ status: 503, body: { error: { code: "UNAVAILABLE", message: "Not now." } } }, { retries: 0 });
  await assert.rejects(() => ryntra.read("getCapabilities"), RyntraApiError);
  assert.equal(calls.length, 1);
});

test("the cursor is walked with the server's own cursors and stops when there is no next", async function () {
  const page = (events, nextCursor) => ({ status: 200, body: { events, nextCursor, readAt: "2026-10-26T09:00:00.000Z" } });
  const { ryntra, calls } = client(
    [page([{ id: "a" }], "c1"), page([{ id: "b" }], "c2"), page([{ id: "c" }], null)],
    { validate: "off" },
  );

  const seen = [];
  for await (const answer of ryntra.pages("discoverPredictions", { category: "sports" })) seen.push(...answer.events);

  assert.deepEqual(seen.map((event) => event.id), ["a", "b", "c"]);
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[0].url).searchParams.get("cursor"), null, "the first page asks for no cursor");
  assert.equal(new URL(calls[1].url).searchParams.get("cursor"), "c1");
  assert.equal(new URL(calls[2].url).searchParams.get("cursor"), "c2");
  assert.equal(new URL(calls[2].url).searchParams.get("category"), "sports", "the other parameters ride along");
});

test("a server that repeats a cursor does not spin the walk for ever", async function () {
  const { ryntra, calls } = client({ status: 200, body: { events: [{ id: "a" }], nextCursor: "same", readAt: "2026-10-26T09:00:00.000Z" } }, { validate: "off" });
  const pages = [];
  for await (const page of ryntra.pages("discoverPredictions")) pages.push(page);
  assert.equal(pages.length, 2, "the first page, then the one its cursor pointed at, then stop");
  assert.equal(calls.length, 2);
});

test("collect flattens with the caller's selector and stops at its page limit", async function () {
  /* A cursor that never repeats itself, so the page limit is the only thing
     that can end the walk — which is exactly what is being tested. */
  let n = 0;
  const ryntra = createRyntraClient({
    baseUrl: BASE,
    validate: "off",
    wait: async () => {},
    fetch: async () => ({
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ events: [{ id: `e${(n += 1)}` }], nextCursor: `c${n}`, readAt: "2026-10-26T09:00:00.000Z" }),
    }),
  });
  const rows = await ryntra.collect("discoverPredictions", (page) => page.events, undefined, 3);
  assert.deepEqual(rows.map((row) => row.id), ["e1", "e2", "e3"]);
  assert.equal(n, 3, "the limit bounds pages asked for, not rows returned");
});

test("anything that is not a GET carries an idempotency key, and the caller may fix it", async function () {
  const { fetch, calls } = stub({ status: 200, body: { ok: true } });
  const transport = createTransport({ baseUrl: BASE, fetch, wait: async () => {} });

  await transport.request({ method: "POST", path: "/api/v1/example", body: { a: 1 } });
  const minted = calls[0].headers[IDEMPOTENCY_HEADER];
  assert.ok(minted && minted.length >= 16, `a key should be minted, got ${JSON.stringify(minted)}`);
  assert.equal(calls[0].headers["content-type"], "application/json");

  const mine = newIdempotencyKey();
  await transport.request({ method: "POST", path: "/api/v1/example", body: { a: 1 }, idempotencyKey: mine });
  assert.equal(calls[1].headers[IDEMPOTENCY_HEADER], mine, "the caller's key is the one that matters: a retry must repeat it");
  assert.notEqual(mine, newIdempotencyKey(), "a fresh key per intent");
});

test("a write is never retried, because no route remembers the key yet", async function () {
  const { fetch, calls } = stub({ status: 503, body: { error: { code: "UNAVAILABLE", message: "Not now." } } });
  const transport = createTransport({ baseUrl: BASE, fetch, wait: async () => {}, retries: 5 });
  await assert.rejects(() => transport.request({ method: "POST", path: "/api/v1/example", body: {} }), RyntraApiError);
  assert.equal(calls.length, 1, "retrying a write the server does not deduplicate is writing twice");
});

test("the surface is reads only, and every read has a schema to check against", function () {
  const operations = Object.values(OPERATIONS);
  assert.ok(operations.length >= 40, `the public read surface should be the document's whole GET list, got ${operations.length}`);
  for (const spec of operations) {
    assert.ok(SCHEMAS[spec.response], `${spec.operationId} answers with ${spec.response}, which this build does not carry`);
    assert.ok(spec.path.startsWith("/api/"), `${spec.operationId} points outside the API: ${spec.path}`);
    for (const parameter of spec.parameters) assert.ok(parameter.in === "path" || parameter.in === "query", `${spec.operationId}: ${parameter.in}`);
  }
  const client = createRyntraClient({ baseUrl: BASE, fetch: async () => assert.fail("no request should be made") });
  assert.deepEqual(
    Object.keys(client).filter((name) => typeof client[name] === "function"),
    ["read", "pages", "collect"],
    "three methods, all of them reads",
  );
  assert.equal(client.contractVersion, CONTRACT_VERSION);
});

test("every paged operation really does take a cursor and answer with one", function () {
  const paged = Object.values(OPERATIONS).filter((spec) => spec.paged);
  assert.ok(paged.length > 0, "the document says at least one read pages");
  for (const spec of paged) {
    assert.ok(spec.parameters.some((parameter) => parameter.name === "cursor"), `${spec.operationId} takes no cursor`);
    assert.ok(SCHEMAS[spec.response].properties?.nextCursor, `${spec.response} carries no nextCursor`);
  }
});

test("every generated example validates against the schema the client carries", { skip: needsExamples }, function () {
  /* The strongest check in this file, and the reason the engine is worth
     having: `docs/api/examples/v1` is built from the zod schemas and parsed
     back with them, while the schemas here came the long way round — zod to
     JSON Schema to the OpenAPI document to this package. Two independent
     descriptions of the same contract, agreeing on real bodies. A disagreement
     is a defect in the generator chain, not in the example. */
  const schemaOf = new Map();
  for (const spec of Object.values(OPERATIONS)) schemaOf.set(spec.response, SCHEMAS[spec.response]);

  /* The file names the generator writes do not carry their schema's name, so
     the pairing is made the only way that cannot go stale: try every schema
     the client carries and require exactly the ones that are a known pair. */
  const pairs = [
    ["capabilities.response.json", "Capabilities"],
    ["events.response.json", "MarketEventsResponse"],
    ["spot-markets.response.json", "SpotMarketsResponse"],
    ["spot-market.response.json", "SpotMarketResponse"],
    ["spot-candles.response.json", "SpotCandlesResponse"],
    ["launch-markets.response.json", "LaunchMarketsResponse"],
    ["launch-market.response.json", "LaunchMarketCardResponse"],
    ["launch-health.response.json", "LaunchMarketHealthResponse"],
    ["launch-health-curve.response.json", "LaunchMarketHealthResponse"],
    ["launch-health-budget.response.json", "LaunchMarketHealthResponse"],
    ["launch-journal.response.json", "LaunchJournalResponse"],
    ["pay-link.response.json", "PayLinkResponse"],
    ["money-recipient.response.json", "RecipientCheckResponse"],
    ["research-evidence.response.json", "MarketEvidenceRead"],
    ["plan-asset.response.json", "PlanAssetRead"],
    ["stocks-popular.response.json", "PopularCompaniesResponse"],
  ];

  const files = new Set(readdirSync(EXAMPLES));
  const broken = [];
  let checked = 0;
  for (const [file, schema] of pairs) {
    if (!files.has(file)) continue; /* the generator's own list may move; a missing file is not this package's defect */
    assert.ok(schemaOf.has(schema), `${schema} is not a response of any read the client serves`);
    const failures = check(example(file), SCHEMAS[schema]);
    checked += 1;
    if (failures.length > 0) broken.push(`${file} against ${schema}: ${describe(failures)}`);
  }
  assert.ok(checked >= 12, `too few examples were paired to prove anything, got ${checked}`);
  assert.deepEqual(broken, [], `The generator chain disagrees with the contract:\n  ${broken.join("\n  ")}`);
});
