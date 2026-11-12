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
    await api.mine(get("mine")),
    await api.board(get("board?format=duo-crack")),
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

test("the Arena (CITY-217): «my agent» from the account's own garage in the Arena, and the board of a format", async () => {
  const { bayOf, garageOf, isBay } = await import("./garage.ts");
  const { applyResult, emptyRating } = await import("./rating.ts");
  const store = createMemoryRingStore();
  const catalog = createModelCatalog({ fetch: stubCatalogFetch });
  const world = { resident: async () => null, quarter: async () => null };
  const engine = createRingEngine({ store, models: createRingModels({ catalog, gateway: createModelGateway({ env: {}, catalog }) }), keys: quietKeys, garage: (input) => garageOf(world, input), bay: bayOf });
  let who = ME;
  const api = createRingApi({ engine: () => engine, open: () => true, account: async () => (who ? { status: "ok", accountId: who } : { status: "absent" }), store });

  // The bay is the account's alone, and says nothing about which account it is.
  const bay = bayOf(ME);
  assert.ok(isBay(bay.quarterId) && !bay.quarterId.includes(ME));
  assert.equal(bayOf(ME).quarterId, bay.quarterId);
  assert.notEqual(bayOf("acc-other-0002").quarterId, bay.quarterId);

  const empty = await (await api.mine(get("mine"))).json();
  assert.deepEqual(empty, { signedIn: true, agents: [], bay: { quarter: bay.quarterId, slot: 0 } });

  const made = await api.create(post("create", { ...create(), quarter: bay.quarterId, slot: bay.slot }));
  assert.equal(made.status, 201, "no quarter, no level: the Arena's garage takes a first agent");
  const { agent } = await made.json();
  const mine = await (await api.mine(get("mine"))).json();
  assert.deepEqual(mine.agents.map((a) => a.id), [agent.id]);
  assert.equal(typeof mine.agents[0].scenario, "string", "the owner sees the script");
  assert.equal((await api.create(post("create", { ...create(), quarter: bay.quarterId, slot: bay.slot }))).status, 409, "one agent to the bay");

  who = "acc-other-0002";
  const theirs = await api.create(post("create", { ...create(), quarter: bay.quarterId, slot: bay.slot }));
  assert.equal(theirs.status, 403, "another account's bay is not yours");
  who = null;
  assert.deepEqual(await (await api.mine(get("mine"))).json(), { signedIn: false, agents: [], bay: null });

  const record = await store.agent(agent.id);
  store.seedRating(agent.id, record.brain, applyResult(emptyRating("duo-crack"), 1200, 1));
  who = ME;
  const board = await (await api.board(get("board?format=duo-crack"))).json();
  assert.equal(board.format, "duo-crack");
  assert.equal(board.rows.length, 1);
  const [row] = board.rows;
  assert.deepEqual([row.rank, row.id, row.mine, row.rating.games, row.rating.wins], [1, agent.id, true, 1, 1]);
  assert.equal("scenario" in row || "owner" in row || "key" in row, false, "nobody's script, owner or key on the board");
  assert.deepEqual((await (await api.board(get("board?format=market-replay"))).json()).rows, []);
  assert.equal((await api.board(get("board?format=poker"))).status, 400);
});

test("a stand pass plays as its cookie's account on a developer's machine only, never in production", async () => {
  const { standAccount } = await import("./ready.ts");
  assert.equal(standAccount({ NODE_ENV: "development", RYNTRA_RING_STAND: "1" }, "stand-alice"), "stand-alice");
  assert.equal(standAccount({ NODE_ENV: "production", RYNTRA_RING_STAND: "1" }, "stand-alice"), null);
  assert.equal(standAccount({ NODE_ENV: "development" }, "stand-alice"), null);
  for (const bad of [undefined, "", "alice", "stand-", "stand-ALICE", "stand-a/b"]) assert.equal(standAccount({ NODE_ENV: "development", RYNTRA_RING_STAND: "1" }, bad), null, String(bad));
});
