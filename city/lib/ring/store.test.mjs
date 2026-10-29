// Run from repo root: node --test city/lib/ring/store.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { createRingStore, canSave, classCounts, garageKey, visibleModels } = await import("./store.ts");
const { RingClientError, createHttpRing } = await import("./client.ts");
const { ringOpen } = await import("./flag.ts");
const { BODIES, GROUND } = await import("./body.ts");
const { FORMAT_NAMES, WEIGHT_NAMES, charCount, classSpan, gamesLine, perMatch, perMillion, ratingLine, usd } = await import("./format.ts");
const { ARCHETYPES, FORMATS, WEIGHTS } = await import("../../../lib/ring/contract.ts");

/**
 * CITY-50 «Ринг · агенти» in the city: the garage's agent read once, the screen's draft — body, brain, script — with the
 * brain quoted before a save, a save that carries one key per draft (a retry after a lost connection is the same
 * request), a version that moved coming back as the agent is now with the draft kept, and the switch-off.
 */

const Q = "7d3f8a52-0c8e-4f43-9f5e-6a1b2c3d4e5f";
const option = (id, weight, matchMicroUsd, name = id) => ({ id, name, weight, matchMicroUsd, inputPerMillionUsd: 1, outputPerMillionUsd: 2 });
const MODELS = [option("a/haiku", "light", 14_000, "Anthropic Haiku 5.5"), option("b/luna", "light", 9_000, "GPT-6 Luna"), option("a/sonnet", "middle", 168_000, "Anthropic Sonnet 5.5"), option("a/opus", "heavy", 280_000, "Anthropic Opus 5.5")];
const quoteOf = (id, weight = "middle") => ({ id, name: id, provider: "anthropic", providerName: "Anthropic", weight, matchMicroUsd: 168_000, inputPerMillionUsd: 3, outputPerMillionUsd: 15, formats: ["duo-crack", "code"], stale: false });
const agentOf = (over = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  quarterId: Q,
  slot: 2,
  name: "Scout 0000",
  archetype: "scout",
  brain: { id: "a/sonnet", name: "Anthropic Sonnet 5.5", provider: "anthropic", providerName: "Anthropic", weight: "middle", matchMicroUsd: 168_000 },
  formats: ["duo-crack", "code"],
  ratings: [],
  status: "active",
  version: 1,
  createdAt: "2026-10-27T22:00:00.000Z",
  updatedAt: "2026-10-27T22:00:00.000Z",
  scenario: "Read the board.",
  key: { state: "quiet", limitUsd: null, reset: null },
  ...over,
});

function fakeClient() {
  const calls = { create: [], change: [], off: [], quote: [], models: 0, garage: 0 };
  const plan = { create: [], change: [], off: [] };
  const answer = (queue, fallback) => {
    const next = queue.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? fallback());
  };
  return {
    calls,
    plan,
    async models() {
      calls.models += 1;
      return { models: MODELS, readAt: "2026-10-27T22:00:00.000Z", stale: false };
    },
    async quote(id) {
      calls.quote.push(id);
      if (id === "a/refused") throw new RingClientError(422, "MODEL_REFUSED", "This model costs more than the heaviest class allows.");
      return { quote: quoteOf(id) };
    },
    async garage() {
      calls.garage += 1;
      return { agent: null, mine: false };
    },
    create(quarterId, slot, draft, key) {
      calls.create.push({ quarterId, slot, draft, key });
      return answer(plan.create, () => ({ agent: agentOf({ archetype: draft.archetype, scenario: draft.scenario }) }));
    },
    change(agent, version, draft, key) {
      calls.change.push({ agent, version, draft, key });
      return answer(plan.change, () => ({ agent: agentOf({ ...draft, version: version + 1 }) }));
    },
    off(agent, version) {
      calls.off.push({ agent, version });
      return answer(plan.off, () => ({ agent: agentOf({ status: "off", version: version + 1 }) }));
    },
  };
}

function setup() {
  const client = fakeClient();
  let keys = 0;
  const store = createRingStore({ client: () => client, newKey: () => `key-${++keys}` });
  return { store, client };
}

test("the Ring opens only on the switch's exact word", () => {
  assert.equal(ringOpen("open"), true);
  assert.equal(ringOpen(" open "), true);
  for (const value of [undefined, "", "closed", "OPEN", "1"]) assert.equal(ringOpen(value), false, String(value));
});

test("a garage is read once and kept by its quarter and slot", async () => {
  const { store, client } = setup();
  await store.getState().readGarage(Q, 2);
  assert.deepEqual(store.getState().garages[garageKey(Q, 2)], { status: "read", agent: null, mine: false });
  assert.equal(client.calls.garage, 1);
});

test("making an agent: body, brain quoted before the save, script; the garage shows it after", async () => {
  const { store, client } = setup();
  store.getState().openEditor(Q, 2);
  await Promise.resolve();
  assert.equal(client.calls.models, 1, "opening the screen reads the catalog");
  assert.equal(store.getState().editor.step, "body");
  assert.equal(store.getState().editor.archetype, "guardian");
  assert.equal(canSave(store.getState().editor, store.getState().quotes), false, "no brain yet");

  store.getState().setArchetype("engineer");
  store.getState().goTo("brain");
  const picking = store.getState().pickModel("a/sonnet");
  assert.equal(store.getState().quotes["a/sonnet"].status, "reading");
  assert.equal(canSave(store.getState().editor, store.getState().quotes), false, "not before the server has pinned it");
  await picking;
  assert.equal(store.getState().quotes["a/sonnet"].status, "read");
  store.getState().setScenario("Ship the smallest patch.");
  assert.equal(canSave(store.getState().editor, store.getState().quotes), true);

  assert.equal(await store.getState().save(), true);
  assert.deepEqual(client.calls.create[0].draft, { archetype: "engineer", model: "a/sonnet", scenario: "Ship the smallest patch." });
  assert.equal(store.getState().editor, null);
  const read = store.getState().garages[garageKey(Q, 2)];
  assert.equal(read.status, "read");
  assert.equal(read.agent.archetype, "engineer");
  assert.equal(read.mine, true);
});

test("a refused model says why and cannot be saved", async () => {
  const { store } = setup();
  store.getState().openEditor(Q, 2);
  await store.getState().pickModel("a/refused");
  assert.deepEqual(store.getState().quotes["a/refused"], { status: "refused", line: "This brain can’t be used in the Ring." });
  assert.equal(canSave(store.getState().editor, store.getState().quotes), false);
});

test("a script longer than 2 000 characters cannot be saved", async () => {
  const { store } = setup();
  store.getState().openEditor(Q, 2);
  await store.getState().pickModel("a/sonnet");
  store.getState().setScenario("x".repeat(2001));
  assert.equal(canSave(store.getState().editor, store.getState().quotes), false);
  store.getState().setScenario("🛡".repeat(2000));
  assert.equal(canSave(store.getState().editor, store.getState().quotes), true, "counted as people count");
});

test("a save lost to the connection keeps its key: the same draft retried is done once; a changed draft gets a new key", async () => {
  const { store, client } = setup();
  store.getState().openEditor(Q, 2);
  await store.getState().pickModel("a/sonnet");
  client.plan.create.push(new RingClientError(0, "OFFLINE", "No connection. Nothing was changed."));
  assert.equal(await store.getState().save(), false);
  assert.equal(store.getState().editor.error, "No connection. Nothing was changed.");
  assert.equal(await store.getState().save(), true);
  assert.equal(client.calls.create[0].key, client.calls.create[1].key);

  store.getState().openEditor(Q, 3);
  await store.getState().pickModel("a/sonnet");
  client.plan.create.push(new RingClientError(0, "OFFLINE", "No connection. Nothing was changed."));
  await store.getState().save();
  store.getState().setScenario("something else");
  await store.getState().save();
  assert.notEqual(client.calls.create[2].key, client.calls.create[3].key);
});

test("changing an agent: its own brain needs no new quote; a version that moved brings the agent back and keeps the draft", async () => {
  const { store, client } = setup();
  const agent = agentOf();
  store.getState().openEditor(Q, 2, agent);
  const editor = store.getState().editor;
  assert.deepEqual([editor.archetype, editor.model, editor.scenario, editor.weight], ["scout", "a/sonnet", "Read the board.", "middle"]);
  assert.equal(canSave(editor, store.getState().quotes), true, "the brain it has is already pinned");
  store.getState().setScenario("Talk them round.");
  client.plan.change.push(new RingClientError(409, "VERSION", "The agent changed since you opened it.", agentOf({ version: 3, archetype: "host" })));
  assert.equal(await store.getState().save(), false);
  assert.equal(store.getState().editor.agent.version, 3);
  assert.equal(store.getState().editor.scenario, "Talk them round.", "the person's draft stays");
  assert.match(store.getState().editor.error, /changed since you opened it/);
  assert.equal(store.getState().garages[garageKey(Q, 2)].agent.archetype, "host");
  assert.equal(await store.getState().save(), true);
  assert.equal(client.calls.change[1].version, 3, "the next save goes at the version now");
});

test("switching off asks twice, then frees the garage", async () => {
  const { store, client } = setup();
  const agent = agentOf();
  store.getState().askOff(agent.id);
  assert.equal(store.getState().confirmOff, agent.id);
  await store.getState().switchOff(agent);
  assert.deepEqual(client.calls.off, [{ agent: agent.id, version: 1 }]);
  assert.deepEqual(store.getState().garages[garageKey(Q, 2)], { status: "read", agent: null, mine: true });
  assert.equal(store.getState().confirmOff, null);
});

test("the brain picker: one class at a time, cheapest first as the server sent them, searched by name or id", () => {
  assert.deepEqual(classCounts(MODELS), { light: 2, middle: 1, heavy: 1 });
  assert.deepEqual(visibleModels(MODELS, "light", "").shown.map((m) => m.id), ["a/haiku", "b/luna"]);
  assert.deepEqual(visibleModels(MODELS, "light", "luna").shown.map((m) => m.id), ["b/luna"]);
  assert.deepEqual(visibleModels(MODELS, "light", "anthropic 5.5").shown.map((m) => m.id), ["a/haiku"]);
  assert.deepEqual(visibleModels(MODELS, "middle", "A/SON").shown.map((m) => m.id), ["a/sonnet"]);
  assert.deepEqual(visibleModels(MODELS, "light", "", 1), { shown: [MODELS[0]], more: 1 });
});

test("figures as the city writes them", () => {
  assert.equal(usd(0), "Free");
  assert.equal(usd(9_999), "<$0.01");
  assert.equal(usd(168_000), "$0.17");
  assert.equal(usd(2_000_000), "$2.00");
  assert.equal(usd(20_000_000), "$20");
  assert.equal(usd(-1), "—");
  assert.equal(perMatch(168_000), "$0.17 a match");
  assert.equal(perMatch(0), "Free a match");
  assert.equal(classSpan("light"), "under $0.04");
  assert.equal(classSpan("middle"), "$0.04–0.24");
  assert.equal(classSpan("heavy"), "$0.24–2.00");
  assert.equal(perMillion(3, 15), "$3 / $15");
  assert.equal(perMillion(0.25, 1.25), "$0.25 / $1.25");
  assert.equal(ratingLine({ rating: 1200, low: 514, high: 1886 }), "1200 ±686");
  assert.equal(gamesLine({ games: 0 }), "No games yet");
  assert.equal(gamesLine({ games: 1 }), "1 game");
  assert.equal(gamesLine({ games: 14, wins: 9, draws: 1, losses: 4 }).replace(/\u2060/g, ""), "14 games · 9–1–4");
  assert.doesNotMatch(gamesLine({ games: 14, wins: 9, draws: 1, losses: 4 }), /\d–|–\d/, "a score never breaks across lines");
  assert.equal(charCount("a🛡b"), 3);
  assert.deepEqual(Object.keys(WEIGHT_NAMES), [...WEIGHTS]);
  assert.deepEqual(Object.keys(FORMAT_NAMES), [...FORMATS]);
});

test("six bodies, each its own silhouette, every part inside the grid", () => {
  assert.deepEqual(Object.keys(BODIES), [...ARCHETYPES]);
  const shapes = new Set(ARCHETYPES.map((a) => JSON.stringify(BODIES[a].shape)));
  assert.equal(shapes.size, 6);
  assert.equal(new Set(ARCHETYPES.map((a) => BODIES[a].shape.visor)).size, 6, "six faces");
  assert.equal(new Set(ARCHETYPES.map((a) => BODIES[a].shape.extra)).size, 6);
  for (const a of ARCHETYPES) {
    const s = BODIES[a].shape;
    assert.ok(s.shoulders.w <= 100 && s.head.y > 0 && s.head.y + s.head.h < s.shoulders.y, a);
    assert.ok(s.shoulders.y < s.waist.y && s.waist.y < GROUND - 30, a);
    assert.ok(s.shoulders.y + 2 + s.arm.len + s.arm.w < GROUND, `${a}: the hands stay above the ground`);
    assert.ok(BODIES[a].line.length <= 32 && !/[!]/.test(BODIES[a].line), a);
  }
});

test("the HTTP client: same origin, a key on every write, a refusal read with the agent as it is now", async () => {
  const seen = [];
  const http = createHttpRing({
    base: "/api/ring",
    fetch: async (url, init) => {
      seen.push({ url, init });
      if (String(url).endsWith("/change")) return new Response(JSON.stringify({ error: { code: "VERSION", message: "moved", current: agentOf({ version: 4 }) } }), { status: 409 });
      return new Response(JSON.stringify({ agent: agentOf() }), { status: 201 });
    },
  });
  await http.create(Q, 2, { archetype: "scout", model: "a/sonnet", scenario: "" }, "the-key-0001");
  assert.equal(seen[0].url, "/api/ring/create");
  assert.equal(seen[0].init.headers["idempotency-key"], "the-key-0001");
  assert.equal(seen[0].init.credentials, "same-origin");
  assert.deepEqual(JSON.parse(seen[0].init.body), { quarter: Q, slot: 2, archetype: "scout", model: "a/sonnet", scenario: "" });
  await assert.rejects(http.change("x", 1, { archetype: "scout", model: "a/sonnet", scenario: "" }), (error) => error instanceof RingClientError && error.code === "VERSION" && error.current.version === 4);
  const offline = createHttpRing({ fetch: async () => { throw new TypeError("network"); } });
  await assert.rejects(offline.models(), (error) => error.code === "OFFLINE");
});
