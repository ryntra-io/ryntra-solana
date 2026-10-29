// Run from repo root: node --test lib/ring/api.test.mjs
/*
 * CITY-50 «Ринг · агенти»: the routes of /api/ring on plain requests — the switch, the site, the account, the request
 * key, the answers' shapes and statuses, and what never leaves the server.
 */
import "../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.fetch = async () => {
  throw new Error("a test reached the real network");
};

const { createRingApi } = await import("./api.ts");
const { createRingEngine } = await import("./engine.ts");
const { createMemoryRingStore, RingStoreUnavailable } = await import("./store.ts");
const { createRingModels } = await import("./models.ts");
const { quietKeys } = await import("./keys.ts");
const { stubCatalogFetch } = await import("./stub-catalog.ts");
const { createModelCatalog } = await import("../models/catalog.ts");
const { createModelGateway } = await import("../models/call.ts");

const BASE = "https://ryntra.io/api/ring";
const ME = "acc-me-0001";
const Q = "7d3f8a52-0c8e-4f43-9f5e-6a1b2c3d4e5f";

function setup({ open = true, account = ME, store = createMemoryRingStore(), catalogFetch = stubCatalogFetch } = {}) {
  const catalog = createModelCatalog({ fetch: catalogFetch });
  const engine = createRingEngine({
    store,
    models: createRingModels({ catalog, gateway: createModelGateway({ env: {}, catalog }) }),
    keys: quietKeys,
    garage: async ({ accountId, quarterId }) => (accountId === ME && quarterId === Q ? "ok" : "not_yours"),
  });
  const reads = { account: 0 };
  const api = createRingApi({
    engine: () => engine,
    open: () => open,
    account: async () => {
      reads.account += 1;
      return account === "down" ? { status: "unavailable" } : account ? { status: "ok", accountId: account } : { status: "absent" };
    },
    store,
  });
  return { api, store, reads };
}

let keys = 0;
function post(route, body, { key = `ring-key-${++keys}-abc`, origin = "https://ryntra.io" } = {}) {
  const headers = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  if (key) headers["idempotency-key"] = key;
  return new Request(`${BASE}/${route}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}
const get = (path) => new Request(`${BASE}/${path}`);
const create = (extra = {}) => ({ quarter: Q, slot: 2, archetype: "engineer", model: "anthropic/claude-sonnet-5.5", scenario: "Ship the smallest patch that passes.", ...extra });

test("closed until the switch says open: every route is a 404, no catalog is read and no one is asked who they are", async () => {
  let reads = 0;
  const { api, reads: asked } = setup({
    open: false,
    catalogFetch: async (...args) => {
      reads += 1;
      return stubCatalogFetch(...args);
    },
  });
  const responses = [
    await api.models(get("models")),
    await api.model(get("model?id=anthropic/claude-sonnet-5.5")),
    await api.garage(get(`garage?quarter=${Q}&slot=2`)),
    await api.create(post("create", create())),
    await api.change(post("change", {})),
    await api.off(post("off", {})),
  ];
  for (const res of responses) {
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, "CLOSED");
    assert.match(res.headers.get("cache-control"), /no-store/);
  }
  assert.equal(reads, 0);
  assert.equal(asked.account, 0);
});

test("the models: every brain on offer with its class and match price; one brain as it would be pinned", async () => {
  const { api } = setup({ account: null });
  const res = await api.models(get("models"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.models.length >= 10);
  assert.ok(body.models.every((m) => ["light", "middle", "heavy"].includes(m.weight) && Number.isInteger(m.matchMicroUsd)));
  assert.equal(typeof body.readAt, "string");

  const quote = await api.model(get(`model?id=${encodeURIComponent("anthropic/claude-haiku-5.5")}`));
  assert.equal(quote.status, 200);
  assert.deepEqual(Object.keys((await quote.json()).quote).sort(), ["formats", "id", "inputPerMillionUsd", "matchMicroUsd", "name", "outputPerMillionUsd", "provider", "providerName", "stale", "weight"]);
  assert.equal((await api.model(get("model?id=openai/o9-pro"))).status, 422);
  assert.equal((await api.model(get("model?id="))).status, 400);
});

test("OpenRouter's catalog out of reach is a 503 that says to try again", async () => {
  const { api } = setup({ catalogFetch: async () => new Response("down", { status: 502 }) });
  const res = await api.models(get("models"));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, "MODELS_UNAVAILABLE");
});

test("a write comes from this site, with a key, as a small JSON object", async () => {
  const { api } = setup();
  const cross = await api.create(post("create", create(), { origin: "https://evil.example" }));
  assert.equal(cross.status, 403);
  assert.equal((await api.create(post("create", create(), { key: null }))).status, 400);
  assert.equal((await api.create(post("create", create(), { key: "short" }))).status, 400);
  assert.equal((await api.create(post("create", "not json"))).status, 400);
  assert.equal((await api.create(post("create", "[1,2]"))).status, 400);
  assert.equal((await api.create(post("create", { ...create(), pad: "x".repeat(13_000) }))).status, 413);
  const long = await api.create(post("create", create({ scenario: "x".repeat(2001) })));
  assert.equal(long.status, 422);
  assert.equal((await long.json()).error.code, "TOO_LONG");
  assert.equal((await api.create(post("create", create({ archetype: "wizard" })))).status, 400);
});

test("making an agent needs the account signed in with a wallet", async () => {
  const absent = setup({ account: null });
  const res = await absent.api.create(post("create", create()));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, "SIGN_IN");
  const down = setup({ account: "down" });
  assert.equal((await down.api.create(post("create", create()))).status, 503);
});

test("create → 201 with the agent; a retry with the same key gets the same answer once; another body under it is refused", async () => {
  const { api } = setup();
  const first = await api.create(post("create", create(), { key: "same-key-0001" }));
  assert.equal(first.status, 201);
  const { agent } = await first.json();
  assert.equal(agent.archetype, "engineer");
  assert.equal(agent.brain.weight, "middle");
  const again = await api.create(post("create", create(), { key: "same-key-0001" }));
  assert.equal(again.status, 201);
  assert.equal(again.headers.get("idempotent-replayed"), "true");
  assert.equal((await again.json()).agent.id, agent.id);
  const other = await api.create(post("create", create({ archetype: "host" }), { key: "same-key-0001" }));
  assert.equal(other.status, 422);
  assert.equal((await other.json()).error.code, "IDEMPOTENCY_KEY_REUSED");
  const taken = await api.create(post("create", create({ archetype: "host" })));
  assert.equal(taken.status, 409);
  assert.equal((await taken.json()).error.code, "SLOT_TAKEN");
  const notMine = await api.create(post("create", create({ quarter: "another-quarter" })));
  assert.equal(notMine.status, 403);
});

test("the garage: anyone sees the agent; the owner also sees its script and key", async () => {
  const owner = setup();
  await owner.api.create(post("create", create()));
  const mine = await (await owner.api.garage(get(`garage?quarter=${Q}&slot=2`))).json();
  assert.equal(mine.mine, true);
  assert.equal(mine.agent.scenario, "Ship the smallest patch that passes.");
  assert.equal(mine.agent.key.state, "quiet");

  const visitor = setup({ account: null, store: owner.store });
  const seen = await (await visitor.api.garage(get(`garage?quarter=${Q}&slot=2`))).json();
  assert.equal(seen.mine, false);
  assert.equal(seen.agent.scenario, undefined);
  assert.equal(seen.agent.key, undefined);
  assert.deepEqual(await (await visitor.api.garage(get(`garage?quarter=${Q}&slot=3`))).json(), { agent: null, mine: false });
  for (const bad of ["garage?quarter=&slot=2", `garage?quarter=${Q}&slot=-1`, `garage?quarter=${Q}&slot=64`, `garage?quarter=${Q}&slot=x`]) {
    assert.equal((await visitor.api.garage(get(bad))).status, 400, bad);
  }
});

test("change and off: at the version seen; a stale version is a 409 with the agent as it is now", async () => {
  const { api } = setup();
  const { agent } = await (await api.create(post("create", create()))).json();
  const stale = await api.change(post("change", { agent: agent.id, version: 9, archetype: "host", model: agent.brain.id, scenario: "" }));
  assert.equal(stale.status, 409);
  const staleBody = await stale.json();
  assert.equal(staleBody.error.code, "VERSION");
  assert.equal(staleBody.error.current.version, 1);
  const changed = await api.change(post("change", { agent: agent.id, version: 1, archetype: "host", model: agent.brain.id, scenario: "" }));
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).agent.archetype, "host");
  const off = await api.off(post("off", { agent: agent.id, version: 2 }));
  assert.equal(off.status, 200);
  assert.equal((await off.json()).agent.status, "off");
  const again = await api.off(post("off", { agent: agent.id, version: 3 }));
  assert.equal(again.status, 409);
  assert.equal((await again.json()).error.code, "OFF");
});

test("a store that cannot be reached is a 503 that names nothing inside, and the answer is not kept", async () => {
  const store = createMemoryRingStore();
  const broken = Object.assign(Object.create(null), store, {
    async agentAt() {
      throw new RingStoreUnavailable("connection refused at 10.0.0.7");
    },
  });
  const { api } = setup({ store: broken });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const res = await api.create(post("create", create(), { key: "retry-me-0001" }));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, "UNAVAILABLE");
    assert.ok(!JSON.stringify(body).includes("10.0.0.7"));
    assert.equal(await store.answer("a:acc-me-0001:create:retry-me-0001", Date.now()), null);
    const garage = await api.garage(get(`garage?quarter=${Q}&slot=2`));
    assert.equal(garage.status, 503);
  } finally {
    console.error = original;
  }
  assert.ok(errors.length >= 1);
});
