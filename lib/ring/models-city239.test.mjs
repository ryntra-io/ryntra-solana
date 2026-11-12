// Run from repo root: node --test lib/ring/models-city239.test.mjs
/*
 * CITY-239: the list a brain is picked from. OpenRouter's catalog also holds models that do not talk — their answer is
 * a picture, a sound or a clip — and a `:batch` twin of many models, answered through a queue hours later. Both could
 * be picked as an agent's brain. The list no longer offers them. Only the list: a model's quote, the gateway, the
 * classes and the prices are as they were, so an agent made with such a model before keeps its brain, shows and can be
 * changed. The catalog is the fixture one with a few entries added; the network is never reached.
 */
import "../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.fetch = async () => {
  throw new Error("a test reached the real network");
};

const { createRingEngine } = await import("./engine.ts");
const { createMemoryRingStore } = await import("./store.ts");
const { createRingModels, offeredAsBrain } = await import("./models.ts");
const { quietKeys } = await import("./keys.ts");
const { stubCatalogFetch, STUB_MODEL_IDS } = await import("./stub-catalog.ts");
const { createModelCatalog, parseCatalogModel } = await import("../models/catalog.ts");
const { createModelGateway } = await import("../models/call.ts");

const ME = "acc-me-0001";
const Q = "7d3f8a52-0c8e-4f43-9f5e-6a1b2c3d4e5f";

const perToken = (perMillion) => (perMillion / 1_000_000).toString();
const PARAMETERS = ["max_tokens", "temperature", "tools", "tool_choice", "response_format", "structured_outputs"];
const entry = (id, name, output, input = 0.3, out = 2.5) => ({
  id,
  canonical_slug: id.replace(/:.*$/, ""),
  name,
  context_length: 200_000,
  architecture: output ? { modality: `text->${output.join("+")}`, input_modalities: ["text"], output_modalities: output } : undefined,
  pricing: { prompt: perToken(input), completion: perToken(out) },
  top_provider: { context_length: 200_000, max_completion_tokens: 32_000 },
  supported_parameters: PARAMETERS,
});

/** What the live catalog has beside the brains: a picture model, two sound models, a clip model, and batch twins. */
const EXTRA = [
  entry("acme/talker-1", "Acme: Talker 1", ["text"]),
  entry("acme/talker-1:batch", "Acme: Talker 1 (batch)", ["text"], 0.15, 1.25),
  entry("acme/talker-1:free", "Acme: Talker 1 (free)", ["text"], 0, 0),
  entry("acme/painter-2", "Acme: Painter 2 (Talker 1 Image)", ["image", "text"]),
  entry("acme/voice-3", "Acme: Voice 3", ["text", "audio"]),
  entry("acme/song-4", "Acme: Song 4", ["audio"], 0, 0),
  entry("acme/clip-5", "Acme: Clip 5", ["text", "video"]),
  entry("acme/quiet-6", "Acme: Quiet 6", null),
  // CITY-240: the catalog names the field and leaves it empty, or fills it with what is not a word.
  entry("acme/blank-7", "Acme: Blank 7", []),
  entry("acme/blank-8", "Acme: Blank 8", [7, null]),
];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The fixture catalog with the extra entries: listed with the rest, each served by one provider at its own price. */
const fetchWithExtra = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const path = url.pathname.replace(/^\/api\/v1/, "");
  if (path === "/models") {
    const body = await (await stubCatalogFetch(input, init)).json();
    return json({ data: [...body.data, ...EXTRA] });
  }
  const match = /^\/models\/(.+)\/endpoints$/.exec(path);
  const extra = match ? EXTRA.find((item) => item.id === decodeURIComponent(match[1])) : undefined;
  if (extra) return json({ data: { id: extra.id, endpoints: [{ tag: "deepinfra", provider_name: "DeepInfra", context_length: 200_000, max_completion_tokens: 32_000, pricing: extra.pricing, supported_parameters: PARAMETERS }] } });
  return stubCatalogFetch(input, init);
};

function brains() {
  const catalog = createModelCatalog({ fetch: fetchWithExtra });
  return createRingModels({ catalog, gateway: createModelGateway({ env: {}, catalog }) });
}

test("the catalog reads what a model answers with; an entry that does not say is unknown, never «text»", () => {
  assert.deepEqual(parseCatalogModel(EXTRA[3]).outputModalities, ["image", "text"]);
  assert.deepEqual(parseCatalogModel(EXTRA[0]).outputModalities, ["text"]);
  assert.equal(parseCatalogModel(EXTRA[7]).outputModalities, null);
  assert.equal(parseCatalogModel({ id: "acme/x-1", architecture: { output_modalities: "text" } }).outputModalities, null, "not a list: unknown");
  assert.deepEqual(parseCatalogModel({ id: "acme/x-1", architecture: { output_modalities: ["Text", 7, "IMAGE"] } }).outputModalities, ["text", "image"]);
  // CITY-240: a list with no word in it reads as an empty one — and an empty one is unknown to the list of brains.
  assert.deepEqual(parseCatalogModel(EXTRA[8]).outputModalities, []);
  assert.deepEqual(parseCatalogModel(EXTRA[9]).outputModalities, []);
});

test("a brain is a model that answers with text alone and at once", () => {
  const of = (id, outputModalities) => offeredAsBrain({ id, outputModalities });
  assert.equal(of("acme/talker-1", ["text"]), true);
  assert.equal(of("acme/talker-1:free", ["text"]), true, "a free variant is a brain like any other");
  assert.equal(of("acme/quiet-6", null), true, "a catalog entry that does not say is not refused");
  assert.equal(of("acme/painter-2", ["image", "text"]), false, "a picture model also writes a caption: still not a brain");
  assert.equal(of("acme/voice-3", ["text", "audio"]), false);
  assert.equal(of("acme/song-4", ["audio"]), false);
  assert.equal(of("acme/clip-5", ["text", "video"]), false);
  // CITY-240: an empty list is the catalog saying nothing — unknown, as a missing one; not «answers with nothing».
  assert.equal(of("acme/quiet-6", []), true, "an empty list of answers is unknown, not refused");
  assert.equal(of("acme/talker-1:batch", ["text"]), false, "a batch twin is answered through a queue, not in a match");
  assert.equal(of("acme/talker-1:BATCH", ["text"]), false);
  assert.equal(of("acme/batch-talker-9", ["text"]), true, "only the variant, never a name that happens to hold the word");
});

test("the list to pick from: no picture, sound or clip model, no batch twin; every brain it had stays", async () => {
  const { models } = await brains().list();
  const ids = models.map((model) => model.id);
  for (const gone of ["acme/talker-1:batch", "acme/painter-2", "acme/voice-3", "acme/song-4", "acme/clip-5"]) assert.equal(ids.includes(gone), false, `${gone} is not offered`);
  for (const kept of ["acme/talker-1", "acme/talker-1:free", "acme/quiet-6", "acme/blank-7", "acme/blank-8"]) assert.equal(ids.includes(kept), true, `${kept} is offered`);
  // The fixture catalog's own brains, the ones the Ring's classes hold, are all still there.
  const before = (await createRingModels({ catalog: createModelCatalog({ fetch: stubCatalogFetch }), gateway: createModelGateway({ env: {}, catalog: createModelCatalog({ fetch: stubCatalogFetch }) }) }).list()).models.map((model) => model.id);
  assert.ok(before.length > 0 && before.length < STUB_MODEL_IDS.length, "the classes already leave out what costs too much");
  for (const id of before) assert.equal(ids.includes(id), true, `${id} stays`);
  // Sorted as before: by the match's cost, then by name.
  assert.deepEqual(models, [...models].sort((a, b) => a.matchMicroUsd - b.matchMicroUsd || a.name.localeCompare(b.name)));
});

test("only the list: a quote of such a model is as it was, with its own class, price and provider", async () => {
  const ring = brains();
  for (const id of ["acme/painter-2", "acme/talker-1:batch", "acme/voice-3"]) {
    const quoted = await ring.quote(id);
    assert.equal(quoted.ok, true, `${id} is still quoted`);
    assert.equal(quoted.quote.id, id);
    assert.equal(quoted.quote.provider, "deepinfra");
    assert.equal(typeof quoted.quote.matchMicroUsd, "number");
  }
});

test("an agent made with a model the list no longer offers keeps its brain, shows and can be changed", async () => {
  const store = createMemoryRingStore();
  const engine = createRingEngine({ store, models: brains(), keys: quietKeys, garage: async () => "ok" });
  const draft = { archetype: "guardian", scenario: "Keep your phrase. Listen for theirs." };
  for (const [slot, model] of [[0, "acme/painter-2"], [1, "acme/talker-1:batch"]]) {
    const made = await engine.create(ME, { ...draft, model, quarterId: Q, slot });
    assert.equal(made.ok, true, `${model}: ${JSON.stringify(made)}`);
    assert.equal(made.value.brain.id, model);
    assert.equal(made.value.status, "active");
    // «My agent» shows it with its brain's own name, class and price.
    const mine = await engine.mine(ME);
    const shown = mine.agents.find((agent) => agent.id === made.value.id);
    assert.ok(shown, "the agent is among mine");
    assert.equal(shown.brain.id, model);
    assert.ok(shown.brain.name.length > 0 && shown.brain.matchMicroUsd >= 0);
    assert.ok(shown.formats.length > 0, "it still has a format to play");
    // Its owner changes the script and keeps the brain: the brain is quoted again, not looked up in the list.
    const changed = await engine.change(ME, { ...draft, scenario: "A new script.", model, id: made.value.id, version: made.value.version });
    assert.equal(changed.ok, true, `${model}: ${JSON.stringify(changed)}`);
    assert.equal(changed.value.brain.id, model);
  }
  // And none of them is in the list a new brain is picked from.
  const offered = (await engine.models()).models.map((model) => model.id);
  assert.equal(offered.includes("acme/painter-2") || offered.includes("acme/talker-1:batch"), false);
});
