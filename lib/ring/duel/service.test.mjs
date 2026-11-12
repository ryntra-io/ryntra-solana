// Run from repo root: node --test lib/ring/duel/service.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const d = await import("./index.ts");
const { createDuelService, createMemoryDuelStore, viewOf, DUELS_PER_AGENT_DAY, RIVAL, utcDay, stalledAfter } = await import("./service.ts");
const { createDuelApi, duelIdOf } = await import("./api.ts");
const { duelsReady, dailyCapMicroUsd } = await import("./ready.ts");
const { stubBrain } = await import("./stub-brain.ts");
const { createMemoryRingStore } = await import("../store.ts");
const { applyResult, emptyRating } = await import("../rating.ts");
const { T0, clock, keys, say } = await import("./testing/kit.mjs");

const HOUR = 3_600_000;
const candles = Array.from({ length: 80 }, (_, i) => ({ t: T0 + i * HOUR, o: 150 + Math.sin(i / 4) * 6, h: 158 + Math.sin(i / 4) * 6, l: 142 + Math.sin(i / 4) * 6, c: 150 + Math.sin((i + 1) / 4) * 6 }));

const brain = (weight = "light") => ({ id: "vendor/m-1", name: "M", provider: "vendor", providerName: "Vendor", weight, matchMicroUsd: 20_000 });

async function seed(ring, id, owner, extra = {}) {
  const record = { id, owner, quarterId: `q-${id.slice(0, 4)}`, slot: 0, archetype: "fighter", brain: brain(), formats: ["duo-crack", "market-replay"], scenario: "", status: "active", key: { state: "live", hash: `h-${id}`, limitUsd: 1 }, version: 1, createdAt: "", updatedAt: "", ...extra };
  const made = await ring.create(record, extra.quiet ? null : { hash: `h-${id}`, sealed: "x", limitUsd: 1 }, T0);
  assert.equal(made.ok, true);
  if (extra.status === "off") await ring.off({ id, owner, version: 1 }, T0);
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function setup({ ring = createMemoryRingStore(), ...over } = {}) {
  const store = createMemoryDuelStore();
  const tasks = [];
  const { stamp, verifyStamp } = keys();
  let n = 0;
  let r = 0;
  const service = createDuelService({
    store,
    agents: { agent: (id) => ring.agent(id), ratings: (id, b) => ring.ratings(id, b), rate: (input, now) => ring.rate(input, now), rivals: (input) => ring.rivals(input) },
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
  return { ring, store, service, tasks, settle: () => Promise.all(tasks) };
}

describe("the duel service", () => {
  test("your agent against another owner's: played in the background, judged, rated", async () => {
    const { ring, service, settle } = setup();
    await seed(ring, A, "a:me");
    await seed(ring, B, "a:them");
    const started = await service.start("me", { format: "duo-crack", agent: A, opponent: RIVAL });
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
    // An agent named as the opponent never plays (review 8.11): the rival is the server's pick, which already keeps to
    // another owner and the same weight.
    assert.equal((await start(A, B)).code, "NOT_YOURS");
    assert.equal((await start(A, C)).code, "NOT_YOURS");
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
    const started = await service.start("me", { format: "duo-crack", agent: A, opponent: RIVAL });
    await settle();
    const done = (await service.get(started.value.id)).value;
    assert.equal(done.status, "void");
    assert.deepEqual(done.verdicts.map((v) => v.reason), ["UNDECIDED", "UNDECIDED"]);
    assert.deepEqual(await ring.ratings(A, brain()), []);
  });
});

describe("the Arena's duels (CITY-217)", () => {
  test("a rival is drawn from other owners of your class; the duel is rated and the board moves", async () => {
    const { ring, service, settle } = setup({ brain: async (record) => stubBrain(record) });
    await seed(ring, A, "a:me");
    await seed(ring, B, "a:them");
    await seed(ring, C, "a:far", { brain: brain("heavy") });
    const started = await service.start("me", { format: "duo-crack", agent: A, opponent: RIVAL });
    assert.equal(started.ok, true);
    assert.equal(started.value.practice, false);
    assert.equal(started.value.seats[1].id, B, "the one rival of the class");
    await settle();
    const done = (await service.get(started.value.id)).value;
    assert.equal(done.status, "done");
    const [ra] = await ring.ratings(A, brain());
    const [rb] = await ring.ratings(B, brain());
    assert.equal(ra.games + rb.games, 2);
    assert.equal((await ring.board("duo-crack", 10)).length, 2);
  });

  test("a rating write that missed is read again for that agent only, against the rival's rating from before the duel (review 8.11)", async () => {
    const ring = createMemoryRingStore();
    const moved = { format: "duo-crack", rating: 1_310, games: 3, wins: 2, draws: 0, losses: 1, info: 0.00002 };
    let missed = 0;
    const rate = async (input, now) => {
      // B's first write misses: another duel of B's finished a moment before and moved its row.
      if (input.agentId === B && missed++ === 0) {
        ring.seedRating(B, brain(), moved);
        return false;
      }
      return ring.rate(input, now);
    };
    const { service, settle } = setup({ ring, agents: { agent: (id) => ring.agent(id), ratings: (id, b) => ring.ratings(id, b), rate, rivals: (input) => ring.rivals(input) } });
    await seed(ring, A, "a:me");
    await seed(ring, B, "a:them");
    const started = await service.start("me", { format: "duo-crack", agent: A, opponent: RIVAL });
    await settle();
    assert.equal((await service.get(started.value.id)).value.verdicts[0].verdict, "PASS", "A won");
    const [ra] = await ring.ratings(A, brain());
    const [rb] = await ring.ratings(B, brain());
    assert.deepEqual(ra, applyResult(emptyRating("duo-crack"), 1_200, 1), "A rated once, against B as it was before the duel");
    assert.deepEqual(rb, applyResult(moved, 1_200, 0), "B's own row read again; A's rating is the one before the duel, not A's new one");
    assert.notEqual(ra.rating, 1_200);
  });

  test("no rival of your class, or the rival without a key: NO_RIVAL — and a house agent has no rival to ask for", async () => {
    const { ring, service } = setup({ background: () => {} });
    await seed(ring, A, "a:me");
    await seed(ring, C, "a:far", { brain: brain("heavy") });
    assert.equal((await service.start("me", { format: "duo-crack", agent: A, opponent: RIVAL })).code, "NO_RIVAL");
    await seed(ring, B, "a:them", { quiet: true });
    assert.equal((await service.start("me", { format: "duo-crack", agent: A, opponent: RIVAL })).code, "NO_RIVAL", "a quiet agent cannot answer");
    assert.equal((await service.start("me", { format: "duo-crack", agent: "wall", opponent: RIVAL })).code, "NOT_YOURS");
  });

  test("the day's ceiling: a live duel holds its most, a finished one counts what it spent; the house spars for nothing", async () => {
    // Two light seats hold $0.08; a $0.10 ceiling lets one rated duel start, not a second while it is live.
    const { ring, service, store, tasks } = setup({ capMicroUsd: () => 100_000, background: () => {} });
    await seed(ring, A, "a:me");
    await seed(ring, B, "a:them");
    const first = await service.start("me", { format: "duo-crack", agent: A, opponent: RIVAL });
    assert.equal(first.ok, true);
    assert.equal((await service.start("me", { format: "duo-crack", agent: A, opponent: RIVAL })).code, "DAILY_CAP");
    assert.equal((await service.start("me", { format: "duo-crack", agent: A, opponent: "wall" })).code, "DAILY_CAP", "$0.08 held + $0.04 more is over $0.10");
    assert.equal(tasks.length, 0);
    assert.equal((await service.start("me", { format: "duo-crack", agent: "wall", opponent: "chatty" })).ok, true, "house against house costs nothing");
    assert.equal(await store.spent(utcDay(Date.now() + 365 * 86_400_000)), 0, "another day starts at zero");
  });

  test("a duel whose harness went quiet is void once read: nothing rated, nothing waits on it, a late harness writes nothing", async () => {
    let t = Date.parse("2026-11-08T12:00:00Z");
    const now = () => t;
    let release;
    const late = { act: () => new Promise((resolve) => (release = () => resolve({ kind: "move", move: { say: "late", guess: null }, costMicroUsd: 0 }))) };
    const { ring, service, settle } = setup({ now, brain: async (record) => (record.id === A ? late : d.houseAgent("wall")), moveMs: 1_000_000 });
    await seed(ring, A, "a:me");
    await seed(ring, B, "a:them");
    const started = await service.start("me", { format: "duo-crack", agent: A, opponent: RIVAL });
    t += stalledAfter(1_000_000) - 1;
    assert.equal((await service.get(started.value.id)).value.status, "live");
    t += 2;
    const read = (await service.get(started.value.id)).value;
    assert.equal(read.status, "void");
    release();
    await settle();
    assert.equal((await service.get(started.value.id)).value.status, "void", "the late harness did not overwrite it");
    assert.deepEqual(await ring.ratings(A, brain()), []);
  });

  test("the ceiling reads as dollars: a number up to $500, anything else $5", () => {
    assert.equal(dailyCapMicroUsd(undefined), 5_000_000);
    assert.equal(dailyCapMicroUsd("2"), 2_000_000);
    assert.equal(dailyCapMicroUsd("0.5"), 500_000);
    assert.equal(dailyCapMicroUsd("0"), 0);
    assert.equal(dailyCapMicroUsd("9999"), 500_000_000);
    for (const bad of ["", "-1", "five", "1e3", "2.345"]) assert.equal(dailyCapMicroUsd(bad), 5_000_000, bad);
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
    const list = await (await routes.duels(new Request(`${SITE}/api/ring/duels`))).json();
    assert.equal(list.duels.length, 1);
    assert.deepEqual(list.formats, ["duo-crack", "market-replay"]);
    const { api: noCandles } = api({ formats: () => ["duo-crack"] });
    assert.deepEqual((await (await noCandles.duels(new Request(`${SITE}/api/ring/duels`))).json()).formats, ["duo-crack"], "no gateway, no Market Replay on offer");
  });

  test("an answer that could not be kept: the start is still 202, and a retry with the key gets the same duel, never a second (review 8.11)", async () => {
    const { service, ring, settle, store } = setup();
    const kept = [];
    const flaky = { answer: (key, now) => ring.answer(key, now), keepAnswer: async (key) => { kept.push(key); throw new Error("store went away"); } };
    const routes = createDuelApi({ service: () => service, open: () => true, account: async () => ({ status: "ok", accountId: "me" }), store: flaky });
    const body = { format: "duo-crack", agent: "wall", opponent: "chatty" };
    const first = await routes.fight(post(body));
    assert.equal(first.status, 202);
    const { duel } = await first.json();
    assert.equal(duel.id, duelIdOf("a:me:fight:key-0001-abc"));
    const again = await routes.fight(post(body));
    assert.equal(again.status, 202);
    assert.equal((await again.json()).duel.id, duel.id);
    assert.equal((await store.recent(10)).length, 1, "one duel played");
    const other = await routes.fight(post({ format: "duo-crack", agent: "chatty", opponent: "wall" }));
    assert.equal(other.status, 422, "the same key for another start");
    assert.equal((await other.json()).error.code, "IDEMPOTENCY_KEY_REUSED");
    assert.equal(kept.length, 2, "a refusal over a reused key is not kept over the duel's answer");
    const elsewhere = await routes.fight(post(body, "key-0002-abc"));
    assert.notEqual((await elsewhere.json()).duel.id, duel.id, "a new key, a new duel");
    await settle();
  });

  test("the store refuses a second duel under one id; the service answers with the first", async () => {
    const { service, store } = setup({ background: () => {} });
    const one = await service.start("me", { format: "duo-crack", agent: "wall", opponent: "chatty" }, { id: "duel-k-0123456789abcdef" });
    const two = await service.start("me", { format: "duo-crack", agent: "wall", opponent: "chatty" }, { id: "duel-k-0123456789abcdef" });
    assert.deepEqual([one.ok, two.ok, two.value.id], [true, true, one.value.id]);
    assert.equal((await service.start("you", { format: "duo-crack", agent: "wall", opponent: "chatty" }, { id: "duel-k-0123456789abcdef" })).code, "KEY_REUSED", "another account's id is not its duel");
    const record = await store.get(one.value.id);
    assert.deepEqual(await store.open({ ...record }, { agents: [], since: 0, day: 0, perOwner: 99, perAgent: 99, cap: 0 }), { ok: false, reason: "EXISTS" });
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

test("one account's part of the day's ceiling: its first duel always, then up to a quarter", async () => {
  const { ownerOverShare } = await import("./service.ts");
  const cap = 5_000_000;
  assert.equal(ownerOverShare(0, 2_000_000, cap), false, "the first duel plays whatever it holds");
  assert.equal(ownerOverShare(2_000_000, 40_000, cap), true, "a heavy first duel leaves no room for a second");
  assert.equal(ownerOverShare(1_000_000, 240_000, cap), false, "$1.00 + $0.24 fits a quarter of $5");
  assert.equal(ownerOverShare(1_100_000, 240_000, cap), true, "$1.10 + $0.24 does not");
});
