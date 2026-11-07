// Run from repo root: node --test lib/ring/duel/service.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const d = await import("./index.ts");
const { createDuelService, createMemoryDuelStore, viewOf, DUELS_PER_AGENT_DAY } = await import("./service.ts");
const { createDuelApi } = await import("./api.ts");
const { duelsReady } = await import("./ready.ts");
const { createMemoryRingStore } = await import("../store.ts");
const { T0, clock, keys, say } = await import("./testing/kit.mjs");

const HOUR = 3_600_000;
const candles = Array.from({ length: 80 }, (_, i) => ({ t: T0 + i * HOUR, o: 150 + Math.sin(i / 4) * 6, h: 158 + Math.sin(i / 4) * 6, l: 142 + Math.sin(i / 4) * 6, c: 150 + Math.sin((i + 1) / 4) * 6 }));

const brain = (weight = "light") => ({ id: "vendor/m-1", name: "M", provider: "vendor", providerName: "Vendor", weight, matchMicroUsd: 20_000 });

async function seed(ring, id, owner, extra = {}) {
  const record = { id, owner, quarterId: `q-${id.slice(0, 4)}`, slot: 0, archetype: "fighter", brain: brain(), formats: ["duo-crack", "market-replay"], scenario: "", status: "active", key: { state: "live", hash: `h-${id}`, limitUsd: 1 }, version: 1, createdAt: "", updatedAt: "", ...extra };
  const made = await ring.create(record, { hash: `h-${id}`, sealed: "x", limitUsd: 1 }, T0);
  assert.equal(made.ok, true);
  if (extra.status === "off") await ring.off({ id, owner, version: 1 }, T0);
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function setup(over = {}) {
  const ring = createMemoryRingStore();
  const store = createMemoryDuelStore();
  const tasks = [];
  const { stamp, verifyStamp } = keys();
  let n = 0;
  let r = 0;
  const service = createDuelService({
    store,
    agents: { agent: (id) => ring.agent(id), ratings: (id, b) => ring.ratings(id, b), keepRating: async (id, b, row) => ring.seedRating(id, b, row) },
    brain: async (record) => (record.id === A ? d.houseAgent("wall") : record.id === B ? d.houseAgent("chatty") : null),
    candles: async () => ({ instrument: "solana:pool:test", candles }),
    stamp,
    verifyStamp,
    now: clock(),
    randomInt: (k) => (r = (r * 7 + 3) % 1_000_003) % k,
    newId: () => `duel-test-${++n}`,
    background: (task) => tasks.push(task),
    moveMs: 200,
    ...over,
  });
  return { ring, store, service, settle: () => Promise.all(tasks) };
}

describe("the duel service", () => {
  test("your agent against another owner's: played in the background, judged, rated", async () => {
    const { ring, service, settle } = setup();
    await seed(ring, A, "a:me");
    await seed(ring, B, "a:them");
    const started = await service.start("me", { format: "duo-crack", agent: A, opponent: B });
    assert.equal(started.ok, true);
    assert.equal(started.value.status, "live");
    await settle();
    const done = (await service.get(started.value.id)).value;
    assert.equal(done.status, "done");
       assert.deepEqual(done.verdicts.map((v) => v.verdict), ["PASS", "FAIL"]);
    assert.equal(done.duel.phrases.length, 2);
    const [ra] = await ring.ratings(A, brain());
    const [rb] = await ring.ratings(B, brain());
    assert.deepEqual([ra.format, ra.wins, rb.losses], ["duo-crack", 1, 1]);
  });

  test("a live duel never shows the phrases", async () => {
    const { ring, service, store } = setup({ background: () => {} });
    await seed(ring, A, "a:me");
    const started = await service.start("me", { format: "duo-crack", agent: A, opponent: "wall" });
    const record = await store.get(started.value.id);
    const shown = JSON.stringify(viewOf(record));
    for (const phrase of record.secrets) for (const word of phrase.split(" ")) assert.ok(!shown.includes(`"${word}`) && !shown.includes(` ${word} `), word);
    assert.equal(viewOf(record).duel.phrases, undefined);
  });

  test("against the house is practice: nothing is rated", async () => {
    const { ring, service, settle } = setup();
    await seed(ring, A, "a:me");
    const started = await service.start("me", { format: "duo-crack", agent: A, opponent: "chatty" });
    assert.equal(started.value.practice, true);
    await settle();
    assert.deepEqual(await ring.ratings(A, brain()), []);
  });

  test("two house agents make an exhibition; Market Replay plays real bars from the gateway, the stretch shown after", async () => {
    const { service, settle } = setup();
    const started = await service.start("me", { format: "market-replay", agent: "trend", opponent: "holder" });
    assert.equal(started.ok, true);
    assert.equal(started.value.source, null);
    await settle();
    const done = (await service.get(started.value.id)).value;
    assert.equal(done.status, "done");
    assert.equal(done.source.instrument, "solana:pool:test");
    assert.equal(done.duel.bars.length, 32);
  });

  test("the rules of pairing and the day's limits", async () => {
    const { ring, service } = setup({ background: () => {} });
    await seed(ring, A, "a:me");
    await seed(ring, B, "a:me");
    await seed(ring, C, "a:them", { brain: brain("heavy") });
    const start = (agent, opponent, format = "duo-crack") => service.start("me", { format, agent, opponent });
    assert.equal((await start(A, B)).code, "SAME_OWNER");
    assert.equal((await start(A, C)).code, "WEIGHT");
    assert.equal((await start(C, A)).code, "NOT_YOURS");
    assert.equal((await start("wall", A)).code, "NOT_YOURS");
    assert.equal((await start(A, "trend")).code, "FORMAT");
    assert.equal((await start(A, "nobody-here")).code, "NOT_FOUND");
    for (let i = 0; i < DUELS_PER_AGENT_DAY; i++) assert.equal((await start(A, "wall")).ok, true);
    assert.equal((await start(A, "wall")).code, "RATE_LIMITED");
  });

  test("an agent without a key cannot play; no market history, no Market Replay", async () => {
    const { ring, service } = setup({ background: () => {}, candles: async () => null });
    await seed(ring, C, "a:me");
    assert.equal((await service.start("me", { format: "duo-crack", agent: C, opponent: "wall" })).code, "NO_KEY");
    assert.equal((await service.start("me", { format: "market-replay", agent: "trend", opponent: "holder" })).code, "MARKET_UNAVAILABLE");
  });

  test("a duel the network broke is void and moves no rating", async () => {
    const flaky = { act: async (view) => (view.round === 2 ? { kind: "void", reason: "network", costMicroUsd: 0 } : { kind: "move", move: { say: "hi", guess: null }, costMicroUsd: 0 }) };
    const { ring, service, settle } = setup({ brain: async (record) => (record.id === A ? flaky : say("hello")) });
    await seed(ring, A, "a:me");
    await seed(ring, B, "a:them");
    const started = await service.start("me", { format: "duo-crack", agent: A, opponent: B });
    await settle();
    const done = (await service.get(started.value.id)).value;
    assert.equal(done.status, "void");
    assert.deepEqual(done.verdicts.map((v) => v.reason), ["UNDECIDED", "UNDECIDED"]);
    assert.deepEqual(await ring.ratings(A, brain()), []);
  });
});

describe("the duel routes", () => {
  const SITE = "https://ryntra.test";
  const api = (over = {}) => {
    const { service, ring, settle } = setup();
    return {
      settle,
      api: createDuelApi({ service: () => service, open: () => true, account: async () => ({ status: "ok", accountId: "me" }), store: ring, ...over }),
    };
  };
  const post = (body, key = "key-0001-abc", headers = {}) =>
    new Request(`${SITE}/api/ring/fight`, { method: "POST", body: JSON.stringify(body), headers: { origin: SITE, "sec-fetch-site": "same-origin", "idempotency-key": key, ...headers } });

  test("closed until both switches are open; production only on a shared store", async () => {
    const { api: closed } = api({ open: () => false });
    assert.equal((await closed.duels(new Request(`${SITE}/api/ring/duels`))).status, 404);
    assert.equal(duelsReady({ durable: false }, "open", "development"), true);
    assert.equal(duelsReady({ durable: false }, "open", "production"), false);
    assert.equal(duelsReady({ durable: true }, undefined, "production"), false);
  });

  test("a start is 202 with the duel; a retry with the same key gets the same duel", async () => {
    const { api: routes, settle } = api();
    const first = await routes.fight(post({ format: "duo-crack", agent: "wall", opponent: "chatty" }));
    assert.equal(first.status, 202);
    const { duel } = await first.json();
    const again = await routes.fight(post({ format: "duo-crack", agent: "wall", opponent: "chatty" }));
    assert.equal((await again.json()).duel.id, duel.id);
    const reused = await routes.fight(post({ format: "market-replay", agent: "trend", opponent: "holder" }));
    assert.equal(reused.status, 422);
    await settle();
    const read = await routes.duel(new Request(`${SITE}/api/ring/duel?id=${duel.id}`));
    assert.equal((await read.json()).duel.status, "done");
    const list = await routes.duels(new Request(`${SITE}/api/ring/duels`));
    assert.equal((await list.json()).duels.length, 1);
  });

  test("a start needs this site, a key, a sound body and a signed-in wallet", async () => {
    const { api: routes } = api();
    assert.equal((await routes.fight(post({ format: "duo-crack", agent: "wall", opponent: "chatty" }, "key-1", {}))).status, 400);
    assert.equal((await routes.fight(post({ format: "duo-crack", agent: "wall", opponent: "chatty" }, "key-0001-abc", { origin: "https://evil.test", "sec-fetch-site": "cross-site" }))).status, 403);
    assert.equal((await routes.fight(post({ format: "poker", agent: "wall", opponent: "chatty" }))).status, 400);
    const { api: anon } = api({ account: async () => ({ status: "absent" }) });
    assert.equal((await anon.fight(post({ format: "duo-crack", agent: "wall", opponent: "chatty" }))).status, 401);
    assert.equal((await routes.duel(new Request(`${SITE}/api/ring/duel?id=nope`))).status, 404);
  });
});
