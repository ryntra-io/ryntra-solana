// Run from repo root: node --test lib/ring/engine.test.mjs
/*
 * CITY-50 «Ринг · агенти»: the agents' engine. An agent is a body, a brain and a script in a garage of its owner's
 * quarter — one to a slot; the brain is one catalog model pinned to one provider with its price and class known
 * before the pick; each agent has its own key with its class's dollar limit (none when quiet); a change happens at
 * the version its owner saw; switching off frees the garage and switches the key off. The catalog is the fixture
 * one through the gateway's real parsing and `preflight`; OpenRouter's key API is a fake; the network is never
 * reached.
 */
import "../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

globalThis.fetch = async () => {
  throw new Error("a test reached the real network");
};

const { createRingEngine, OWNER_LIMITS } = await import("./engine.ts");
const { createMemoryRingStore, RingStoreUnavailable } = await import("./store.ts");
const { createRingModels } = await import("./models.ts");
const { createRingKeys, quietKeys } = await import("./keys.ts");
const { createSealer } = await import("./seal.ts");
const { stubCatalogFetch } = await import("./stub-catalog.ts");
const { applyResult, emptyRating } = await import("./rating.ts");
const { createModelCatalog } = await import("../models/catalog.ts");
const { createModelGateway } = await import("../models/call.ts");
const { ModelGatewayError } = await import("../models/errors.ts");

const ME = "acc-me-0001";
const THEM = "acc-them-0002";
const Q = "7d3f8a52-0c8e-4f43-9f5e-6a1b2c3d4e5f";
const SEAL = "ring-test-seal-secret-0123456789abcdef";
const SONNET = "anthropic/claude-sonnet-5.5";
const OPUS = "anthropic/claude-opus-5.5";
const GROK = "x-ai/grok-4.7";
const HAIKU = "anthropic/claude-haiku-5.5";

function brains(fetchImpl = stubCatalogFetch) {
  const catalog = createModelCatalog({ fetch: fetchImpl });
  return createRingModels({ catalog, gateway: createModelGateway({ env: {}, catalog }) });
}

/** OpenRouter's key API, faked: every key it makes and switches off is kept here. */
function fakeManager({ fail = null } = {}) {
  let n = 0;
  const made = [];
  const disabled = [];
  const info = (hash, extra = {}) => ({ hash, name: "", disabled: false, limitUsd: null, limitRemainingUsd: null, limitReset: null, usageUsd: 0, createdAt: null, updatedAt: null, ...extra });
  return {
    made,
    disabled,
    async create(input) {
      if (fail) throw new ModelGatewayError(fail, "fake failure");
      n += 1;
      const hash = `hash${String(n).padStart(4, "0")}abcd`;
      const secret = `sk-or-v1-fake-secret-${n}`;
      made.push({ ...input, hash, secret });
      return { info: info(hash, { limitUsd: input.limitUsd, limitReset: input.limitReset }), secret };
    },
    async disable(hash) {
      disabled.push(hash);
      return info(hash, { disabled: true });
    },
    async read(hash) {
      return info(hash);
    },
  };
}

/** The world's word: every slot is a garage of my quarter unless the map says otherwise. */
function world(overrides = {}) {
  return async ({ accountId, quarterId, slot }) => overrides[`${accountId}:${quarterId}:${slot}`] ?? (accountId === ME && quarterId === Q ? "ok" : "not_yours");
}

let ids = 0;
const newId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

function setup({ live = false, manager = fakeManager(), store = createMemoryRingStore(), garage = world(), models = brains(), clock } = {}) {
  let t = Date.parse("2026-10-27T22:00:00.000Z");
  const now = clock ?? (() => (t += 1000));
  const keys = live ? createRingKeys({ manager, sealer: createSealer(SEAL) }) : quietKeys;
  const engine = createRingEngine({ store, models, keys, garage, now, newId });
  return { engine, store, manager };
}

const draft = (slot, extra = {}) => ({ quarterId: Q, slot, archetype: "scout", model: SONNET, scenario: "Read the board, move once, never bluff twice.", ...extra });

describe("making an agent", () => {
  test("an agent is a body, a brain and a script in a garage of your quarter", async () => {
    const { engine } = setup();
    const made = await engine.create(ME, draft(2));
    assert.equal(made.ok, true, JSON.stringify(made));
    const agent = made.value;
    assert.match(agent.name, /^Scout [0-9A-F]{4}$/);
    assert.equal(agent.archetype, "scout");
    assert.equal(agent.quarterId, Q);
    assert.equal(agent.slot, 2);
    assert.deepEqual(agent.brain, { id: SONNET, name: "Anthropic Sonnet 5.5", provider: "anthropic", providerName: "Anthropic", weight: "middle", matchMicroUsd: 168_000 });
    assert.deepEqual(agent.formats, ["duo-crack", "code", "market-replay"]);
    assert.deepEqual(agent.ratings.map((r) => [r.format, r.rating, r.low, r.high, r.games, r.provisional]), [
      ["duo-crack", 1200, 514, 1886, 0, true],
      ["code", 1200, 514, 1886, 0, true],
      ["market-replay", 1200, 514, 1886, 0, true],
    ]);
    assert.equal(agent.status, "active");
    assert.equal(agent.version, 1);
    assert.equal(agent.scenario, "Read the board, move once, never bluff twice.");
    assert.deepEqual(agent.key, { state: "quiet", limitUsd: null, reset: null });
  });

  test("the brain is pinned to one provider: the cheapest endpoint that is not a deferred tier, with its own price", async () => {
    const { engine } = setup();
    const haiku = await engine.quote(HAIKU);
    assert.equal(haiku.ok, true);
    assert.equal(haiku.quote.provider, "anthropic", "Bedrock's region is dearer");
    assert.equal(haiku.quote.weight, "light");
    const gemini = await engine.quote("google/gemini-4-argon");
    assert.equal(gemini.quote.provider, "google-vertex", "the flex tier is cheaper but deferred, so never pinned");
    const flash = await engine.quote("deepseek/deepseek-v4.1-flash");
    assert.equal(flash.quote.provider, "deepseek");
    assert.deepEqual(flash.quote.formats, ["duo-crack", "code"], "that provider has no structured outputs: no Market Replay");
    const sonnet = await engine.quote(SONNET);
    assert.deepEqual({ input: sonnet.quote.inputPerMillionUsd, output: sonnet.quote.outputPerMillionUsd, match: sonnet.quote.matchMicroUsd }, { input: 3, output: 15, match: 168_000 });
  });

  test("the price is seen before the pick: every brain priced in its class, cheapest first; what cannot be pinned or priced is left out", async () => {
    const { engine } = setup();
    const { models, stale } = await engine.models();
    assert.equal(stale, false);
    const ids = models.map((m) => m.id);
    for (const absent of ["openrouter/auto", "acme/unpriced-1", "openai/o9-pro"]) assert.ok(!ids.includes(absent), absent);
    assert.ok(ids.includes(SONNET) && ids.includes(HAIKU) && ids.includes(OPUS));
    for (let i = 1; i < models.length; i += 1) assert.ok(models[i - 1].matchMicroUsd <= models[i].matchMicroUsd);
    const byId = Object.fromEntries(models.map((m) => [m.id, m]));
    assert.equal(byId[HAIKU].weight, "light");
    assert.equal(byId[SONNET].weight, "middle");
    assert.equal(byId[OPUS].weight, "heavy");
    assert.equal(byId["anthropic/claude-fable-5.1"].weight, "heavy");
    assert.deepEqual([byId[SONNET].inputPerMillionUsd, byId[SONNET].outputPerMillionUsd], [3, 15]);
  });

  test("a model that cannot be a brain is refused and nothing is kept", async () => {
    const { engine } = setup();
    for (const model of ["openai/o9-pro", "acme/no-such-model", "openrouter/auto"]) {
      const made = await engine.create(ME, draft(1, { model }));
      assert.equal(made.ok, false, model);
      assert.equal(made.code, "MODEL_REFUSED", model);
    }
    assert.deepEqual(await engine.garage(Q, 1, ME), { agent: null, mine: false });
  });

  test("an id the catalog does not hold is refused from the cached list: no request to OpenRouter for it", async () => {
    const asked = [];
    const { engine } = setup({ models: brains(async (input, init) => (asked.push(String(input)), stubCatalogFetch(input, init))) });
    await engine.models();
    for (let i = 0; i < 20; i += 1) assert.equal((await engine.quote(`acme/made-up-${i}`)).ok, false);
    assert.equal((await engine.quote("openrouter/auto")).ok, false);
    assert.deepEqual(asked.filter((url) => url.includes("/endpoints")), [], "no endpoints read for a model not in the list");
    assert.equal(asked.filter((url) => url.endsWith("/models")).length, 1, "the list itself is read once");
  });

  test("OpenRouter's catalog out of reach is a refusal to try again, not a refused model", async () => {
    const { engine } = setup({ models: brains(async () => new Response("down", { status: 503 })) });
    const made = await engine.create(ME, draft(1));
    assert.equal(made.code, "MODELS_UNAVAILABLE");
    await assert.rejects(engine.models());
  });

  test("one agent to a garage slot; switching it off frees the slot", async () => {
    const { engine } = setup();
    const first = await engine.create(ME, draft(3));
    assert.equal(first.ok, true);
    const second = await engine.create(ME, draft(3, { archetype: "host" }));
    assert.equal(second.code, "SLOT_TAKEN");
    const off = await engine.off(ME, { id: first.value.id, version: 1 });
    assert.equal(off.ok, true);
    const again = await engine.create(ME, draft(3, { archetype: "host" }));
    assert.equal(again.ok, true);
    assert.equal((await engine.garage(Q, 3, ME)).agent.archetype, "host");
  });

  test("only a garage of your own quarter, on the world's word", async () => {
    const { engine } = setup({ garage: world({ [`${ME}:${Q}:5`]: "not_garage", [`${ME}:${Q}:6`]: "unavailable" }) });
    assert.equal((await engine.create(THEM, draft(1))).code, "NOT_YOURS");
    assert.equal((await engine.create(ME, draft(5))).code, "NOT_GARAGE");
    await assert.rejects(engine.create(ME, draft(6)), RingStoreUnavailable, "a world that does not answer is never taken as a yes");
  });
});

describe("keys", () => {
  test("live: each agent gets its own key, named for it, with its class's monthly limit — sealed, never shown", async () => {
    const { engine, store, manager } = setup({ live: true });
    const made = await engine.create(ME, draft(2));
    assert.equal(made.ok, true);
    assert.equal(manager.made.length, 1);
    assert.deepEqual({ subject: manager.made[0].subject, limitUsd: manager.made[0].limitUsd, limitReset: manager.made[0].limitReset }, { subject: { kind: "ring-agent", id: made.value.id }, limitUsd: 5, limitReset: "monthly" });
    assert.deepEqual(made.value.key, { state: "live", limitUsd: 5, reset: "monthly" });
    const [row] = store.keyRows();
    assert.equal(row.hash, manager.made[0].hash);
    assert.ok(!row.sealed.includes(manager.made[0].secret));
    assert.equal(createSealer(SEAL).open(made.value.id, row.sealed), manager.made[0].secret, "the sealed key opens for its agent");
    assert.equal(createSealer(SEAL).open(newId(), row.sealed), null, "and for no other");
    assert.ok(!JSON.stringify(made.value).includes(manager.made[0].secret));
    assert.ok(!JSON.stringify(made.value).includes(row.hash), "the routes never show the key's hash either");
  });

  test("quiet: no key is made and nothing is called", async () => {
    const { engine, manager } = setup({ live: false });
    const made = await engine.create(ME, draft(2));
    assert.equal(made.ok, true);
    assert.equal(manager.made.length, 0);
    assert.equal(made.value.key.state, "quiet");
  });

  test("a brain of another class gets a new key and the old one is switched off; the same class keeps its key", async () => {
    const { engine, store, manager } = setup({ live: true });
    let agent = (await engine.create(ME, draft(2))).value;
    const scriptOnly = await engine.change(ME, { id: agent.id, version: agent.version, archetype: "fighter", model: SONNET, scenario: "Hit first." });
    assert.equal(scriptOnly.ok, true);
    assert.equal(manager.made.length, 1, "a new body and script need no key");
    agent = scriptOnly.value;
    assert.equal(agent.archetype, "fighter");
    assert.equal(agent.scenario, "Hit first.");

    const sameClass = await engine.change(ME, { id: agent.id, version: agent.version, archetype: "fighter", model: GROK, scenario: "Hit first." });
    assert.equal(sameClass.ok, true);
    assert.equal(sameClass.value.brain.id, GROK);
    assert.equal(sameClass.value.brain.weight, "middle");
    assert.equal(manager.made.length, 1, "another middleweight keeps the key");
    agent = sameClass.value;

    const heavier = await engine.change(ME, { id: agent.id, version: agent.version, archetype: "fighter", model: OPUS, scenario: "Hit first." });
    assert.equal(heavier.ok, true);
    assert.equal(heavier.value.brain.weight, "heavy");
    assert.equal(manager.made.length, 2);
    assert.equal(manager.made[1].limitUsd, 20);
    assert.deepEqual(manager.disabled, [manager.made[0].hash], "the middleweight's key is off");
    const rows = Object.fromEntries(store.keyRows().map((row) => [row.hash, row]));
    assert.ok(rows[manager.made[0].hash].retiredAt !== null && rows[manager.made[0].hash].disabledAt !== null);
    assert.equal(rows[manager.made[1].hash].retiredAt, null);
    assert.deepEqual(heavier.value.key, { state: "live", limitUsd: 20, reset: "monthly" });
  });

  test("a quiet agent gets its first key on its next change once the server can make keys", async () => {
    const store = createMemoryRingStore();
    const quiet = setup({ store });
    const agent = (await quiet.engine.create(ME, draft(2))).value;
    const live = setup({ store, live: true });
    const changed = await live.engine.change(ME, { id: agent.id, version: 1, archetype: "scout", model: SONNET, scenario: "" });
    assert.equal(changed.ok, true);
    assert.equal(live.manager.made.length, 1);
    assert.equal(changed.value.key.state, "live");
    assert.equal(changed.value.scenario, "");
  });

  test("switching off switches the key off with the agent", async () => {
    const { engine, store, manager } = setup({ live: true });
    const agent = (await engine.create(ME, draft(4))).value;
    const off = await engine.off(ME, { id: agent.id, version: 1 });
    assert.equal(off.ok, true);
    assert.equal(off.value.status, "off");
    assert.equal(off.value.key.state, "off");
    assert.deepEqual(manager.disabled, [manager.made[0].hash]);
    assert.ok(store.keyRows()[0].disabledAt !== null);
    assert.deepEqual(await engine.garage(Q, 4, ME), { agent: null, mine: false });
    assert.equal((await engine.off(ME, { id: agent.id, version: 2 })).code, "OFF");
  });

  test("when OpenRouter makes no key, nothing is saved", async () => {
    const { engine } = setup({ live: true, manager: fakeManager({ fail: "out_of_credits" }) });
    const made = await engine.create(ME, draft(2));
    assert.equal(made.code, "KEY_FAILED");
    assert.deepEqual(await engine.garage(Q, 2, ME), { agent: null, mine: false });
  });

  test("a key made for a create that lost the slot is switched off at once", async () => {
    const inner = createMemoryRingStore();
    const manager = fakeManager();
    // Another create lands in the slot between the check and the write.
    const store = Object.assign(Object.create(null), inner, {
      async create(agent, key, now) {
        await inner.create({ ...agent, id: newId(), owner: `a:${THEM}` }, null, now);
        return inner.create(agent, key, now);
      },
    });
    const { engine } = setup({ live: true, manager, store });
    const made = await engine.create(ME, draft(2));
    assert.equal(made.code, "SLOT_TAKEN");
    assert.equal(manager.made.length, 1);
    assert.deepEqual(manager.disabled, [manager.made[0].hash]);
  });

  test("a store that fails the write switches the new key off and says so", async () => {
    const inner = createMemoryRingStore();
    const manager = fakeManager();
    const store = Object.assign(Object.create(null), inner, {
      async create() {
        throw new RingStoreUnavailable("down");
      },
    });
    const { engine } = setup({ live: true, manager, store });
    await assert.rejects(engine.create(ME, draft(2)), RingStoreUnavailable);
    assert.deepEqual(manager.disabled, [manager.made[0].hash]);
  });

  test("a write that landed but whose answer was lost keeps its key: the agent is read back", async () => {
    const inner = createMemoryRingStore();
    const manager = fakeManager();
    const store = Object.assign(Object.create(null), inner, {
      async create(...args) {
        await inner.create(...args);
        throw new RingStoreUnavailable("answer lost");
      },
    });
    const { engine } = setup({ live: true, manager, store });
    const made = await engine.create(ME, draft(2));
    assert.equal(made.ok, true, JSON.stringify(made));
    assert.equal(made.value.key.state, "live");
    assert.deepEqual(manager.disabled, [], "a key the agent holds is never switched off");
  });

  test("a store that does not answer at all leaves the key alone: nothing is switched off blind", async () => {
    const inner = createMemoryRingStore();
    const manager = fakeManager();
    const store = Object.assign(Object.create(null), inner, {
      async create() {
        throw new RingStoreUnavailable("down");
      },
      async agent() {
        throw new RingStoreUnavailable("down");
      },
    });
    const { engine } = setup({ live: true, manager, store });
    await assert.rejects(engine.create(ME, draft(2)), RingStoreUnavailable);
    assert.deepEqual(manager.disabled, []);
  });

  test("a change that landed but whose answer was lost: the new key stays, the old one is switched off", async () => {
    const inner = createMemoryRingStore();
    const manager = fakeManager();
    let lose = false;
    const store = Object.assign(Object.create(null), inner, {
      async change(...args) {
        const result = await inner.change(...args);
        if (lose) throw new RingStoreUnavailable("answer lost");
        return result;
      },
    });
    const { engine } = setup({ live: true, manager, store });
    const agent = (await engine.create(ME, draft(2))).value;
    lose = true;
    const changed = await engine.change(ME, { id: agent.id, version: agent.version, archetype: "host", model: OPUS, scenario: "" });
    assert.equal(changed.ok, true, JSON.stringify(changed));
    assert.equal(changed.value.brain.weight, "heavy");
    assert.deepEqual(manager.disabled, [manager.made[0].hash], "only the replaced key goes off");
  });

  test("keys made for writes that did not hold count toward the day's limit", async () => {
    const inner = createMemoryRingStore();
    const manager = fakeManager();
    const store = Object.assign(Object.create(null), inner, {
      async create() {
        return { ok: false, error: "slot_taken" };
      },
    });
    const { engine } = setup({ live: true, manager, store });
    for (let i = 0; i < OWNER_LIMITS.keysPerDay; i += 1) assert.equal((await engine.create(ME, draft(2))).code, "SLOT_TAKEN");
    assert.equal((await engine.create(ME, draft(2))).code, "RATE_LIMITED");
    assert.equal(manager.made.length, OWNER_LIMITS.keysPerDay, "no call to OpenRouter's key API past the limit");
  });
});

describe("changes and who sees what", () => {
  test("a change happens at the version its owner saw; another's agent is not theirs to change", async () => {
    const { engine } = setup();
    const agent = (await engine.create(ME, draft(2))).value;
    const stale = await engine.change(ME, { id: agent.id, version: 7, archetype: "host", model: SONNET, scenario: "" });
    assert.equal(stale.code, "VERSION");
    assert.equal(stale.current.version, 1, "the agent as it is now comes back");
    assert.equal(stale.current.scenario, agent.scenario);
    assert.equal((await engine.change(THEM, { id: agent.id, version: 1, archetype: "host", model: SONNET, scenario: "" })).code, "NOT_YOURS");
    assert.equal((await engine.off(THEM, { id: agent.id, version: 1 })).code, "NOT_YOURS");
    assert.equal((await engine.change(ME, { id: newId(), version: 1, archetype: "host", model: SONNET, scenario: "" })).code, "NOT_FOUND");
    const changed = await engine.change(ME, { id: agent.id, version: 1, archetype: "host", model: SONNET, scenario: "" });
    assert.equal(changed.value.version, 2);
  });

  test("a change in a garage that is no longer a garage is refused", async () => {
    const answers = { [`${ME}:${Q}:2`]: "ok" };
    const { engine } = setup({ garage: async ({ accountId, quarterId, slot }) => answers[`${accountId}:${quarterId}:${slot}`] ?? "not_yours" });
    const agent = (await engine.create(ME, draft(2))).value;
    answers[`${ME}:${Q}:2`] = "not_garage";
    assert.equal((await engine.change(ME, { id: agent.id, version: 1, archetype: "host", model: SONNET, scenario: "" })).code, "NOT_GARAGE");
    assert.equal((await engine.off(ME, { id: agent.id, version: 1 })).ok, true, "but its owner can always switch it off");
  });

  test("anyone sees the body, brain, class and ratings; only the owner sees the script and the key", async () => {
    const { engine } = setup();
    await engine.create(ME, draft(2));
    const mine = await engine.garage(Q, 2, ME);
    assert.equal(mine.mine, true);
    assert.equal(typeof mine.agent.scenario, "string");
    assert.ok(mine.agent.key);
    for (const viewer of [THEM, null]) {
      const seen = await engine.garage(Q, 2, viewer);
      assert.equal(seen.mine, false);
      assert.equal(seen.agent.scenario, undefined);
      assert.equal(seen.agent.key, undefined);
      assert.equal(seen.agent.brain.id, SONNET);
      assert.equal(seen.agent.ratings.length, 3);
    }
  });

  test("ratings: one per format the brain can play, from its own rows; a new brain starts from the start, the old rows stay", async () => {
    const { engine, store } = setup();
    let agent = (await engine.create(ME, draft(2))).value;
    let row = emptyRating("code");
    for (let i = 0; i < 3; i += 1) row = applyResult(row, 1200, 1);
    store.seedRating(agent.id, { id: SONNET, provider: "anthropic" }, row);
    const rated = (await engine.garage(Q, 2, ME)).agent.ratings.find((r) => r.format === "code");
    assert.equal(rated.games, 3);
    assert.equal(rated.wins, 3);
    assert.ok(rated.rating > 1200 && rated.high - rated.low < 1886 - 514);

    agent = (await engine.change(ME, { id: agent.id, version: 1, archetype: "scout", model: "deepseek/deepseek-v4.1-flash", scenario: "" })).value;
    assert.deepEqual(agent.formats, ["duo-crack", "code"]);
    assert.deepEqual(agent.ratings.map((r) => [r.format, r.rating, r.games]), [["duo-crack", 1200, 0], ["code", 1200, 0]]);

    agent = (await engine.change(ME, { id: agent.id, version: 2, archetype: "scout", model: SONNET, scenario: "" })).value;
    assert.equal(agent.ratings.find((r) => r.format === "code").games, 3, "back on the old brain, its rows are there");
  });
});

describe("daily limits", () => {
  test(`at most ${OWNER_LIMITS.agentsPerDay} agents a day`, async () => {
    const { engine } = setup();
    for (let slot = 0; slot < OWNER_LIMITS.agentsPerDay; slot += 1) assert.equal((await engine.create(ME, draft(slot))).ok, true, `slot ${slot}`);
    const over = await engine.create(ME, draft(OWNER_LIMITS.agentsPerDay));
    assert.equal(over.code, "RATE_LIMITED");
  });

  test(`at most ${OWNER_LIMITS.keysPerDay} keys a day, counting the keys a change makes`, async () => {
    const { engine, manager } = setup({ live: true });
    let agent = (await engine.create(ME, draft(0))).value;
    const models = [SONNET, OPUS];
    for (let i = 1; i < OWNER_LIMITS.keysPerDay; i += 1) {
      const changed = await engine.change(ME, { id: agent.id, version: agent.version, archetype: "scout", model: models[i % 2], scenario: "" });
      assert.equal(changed.ok, true, `change ${i}`);
      agent = changed.value;
    }
    assert.equal(manager.made.length, OWNER_LIMITS.keysPerDay);
    const over = await engine.change(ME, { id: agent.id, version: agent.version, archetype: "scout", model: models[OWNER_LIMITS.keysPerDay % 2], scenario: "" });
    assert.equal(over.code, "RATE_LIMITED");
    assert.equal(manager.made.length, OWNER_LIMITS.keysPerDay, "no key past the limit");
    const scriptOnly = await engine.change(ME, { id: agent.id, version: agent.version, archetype: "host", model: agent.brain.id, scenario: "still fine" });
    assert.equal(scriptOnly.ok, true, "a change without a key is never limited");
  });
});
