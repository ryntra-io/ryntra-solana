// Run from repo root: node --test city/lib/quarter/store.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { createMockWorld } = await import("./mock.ts");
const { createQuarterStore } = await import("./store.ts");
const { WorldError } = await import("./types.ts");

/**
 * The flow of my quarter: a newcomer claims a spot without a wallet and the camera's flight starts; in build mode
 * a tap on a plot opens the picker on Home; Home lands the moment it is picked and is saved behind it; a refusal
 * puts the picker back with one line; a write that met no answer is retried once with the same key.
 */

function setup({ fail = {} } = {}) {
  const mock = createMockWorld({ storage: null });
  const calls = { claim: [], build: [], me: 0 };
  const client = {
    ...mock,
    async me() {
      calls.me += 1;
      if (fail.me) throw fail.me;
      return mock.me();
    },
    async claim(key) {
      calls.claim.push(key);
      const f = fail.claim?.shift?.();
      if (f) throw f;
      return mock.claim(key);
    },
    async build(input, key) {
      calls.build.push({ input, key });
      const f = fail.build?.shift?.();
      if (f) throw f;
      return mock.build(input, key);
    },
  };
  let keys = 0;
  let clock = 1000;
  const store = createQuarterStore({ client: () => client, now: () => (clock += 16), newKey: () => `key-${++keys}`, retryMs: 0 });
  return { store, calls, mock };
}

async function inBuild(store) {
  await store.getState().load();
  assert.equal(await store.getState().claim(), true);
  store.getState().arrived();
  assert.equal(store.getState().mode, "build");
}

test("a newcomer reads as none, and the city stays on the hot tower when the world is out of reach", async () => {
  const { store } = setup();
  assert.equal(store.getState().status, "unknown");
  await store.getState().load();
  assert.equal(store.getState().status, "none");
  const offline = setup({ fail: { me: new WorldError(0, "OFFLINE") } });
  await offline.store.getState().load();
  assert.equal(offline.store.getState().status, "offline");
});

test("claiming makes me a resident with the full picture, and starts the flight to my lot", async () => {
  const { store, calls } = setup();
  await store.getState().load();
  const claimed = store.getState().claim();
  assert.equal(store.getState().busy, true, "the button says it is working");
  assert.equal(await claimed, true);
  const st = store.getState();
  assert.equal(st.status, "resident");
  assert.equal(st.mode, "arrive");
  assert.equal(st.me.quarter.district, "arrivals");
  assert.equal(st.me.tasks.length, 3, "today's tasks came with the read after the claim");
  assert.equal(calls.me, 2);
  st.arrived();
  assert.equal(store.getState().mode, "build");
});

test("a claim that met no answer is tried once more with the same key; a refusal is shown in one line", async () => {
  const retry = setup({ fail: { claim: [new WorldError(0, "OFFLINE")] } });
  await retry.store.getState().load();
  assert.equal(await retry.store.getState().claim(), true);
  assert.deepEqual(retry.calls.claim, ["key-1", "key-1"]);

  const refused = setup({ fail: { claim: [new WorldError(429, "RATE_LIMITED")] } });
  await refused.store.getState().load();
  assert.equal(await refused.store.getState().claim(), false);
  const st = refused.store.getState();
  assert.equal(st.status, "none");
  assert.equal(st.mode, "city");
  assert.equal(st.busy, false);
  assert.equal(st.error, "Too many taps at once. Try again in a moment.");
  assert.equal(refused.calls.claim.length, 1, "a refusal is not retried");
});

test("plots open only in build mode: an open plot opens on Home, a closed one says nothing can go there yet", async () => {
  const { store } = setup();
  await store.getState().load();
  await store.getState().claim();
  store.getState().pick(1);
  assert.equal(store.getState().slot, null, "no picker during the flight");
  store.getState().arrived();
  store.getState().pick(1);
  assert.deepEqual([store.getState().slot, store.getState().choice], [1, "home"]);
  store.getState().pick(7);
  assert.deepEqual([store.getState().slot, store.getState().choice], [7, null]);
  store.getState().pick(null);
  assert.equal(store.getState().slot, null);
});

test("Home lands at once and is saved behind it; the lamp lights the street and pays the day's points", async () => {
  const { store, calls } = setup();
  await inBuild(store);
  store.getState().pick(1);
  const placing = store.getState().place();
  let st = store.getState();
  assert.equal(st.landing?.slot, 1, "the building is down before the world answers");
  assert.equal(st.landing?.kind, "home");
  assert.equal(st.slot, null, "the picker closes");
  assert.equal(await placing, true);
  st = store.getState();
  assert.equal(st.landing, null);
  assert.equal(st.landed?.slot, 1);
  assert.equal(st.me.quarter.version, 2);
  assert.deepEqual(st.me.buildings.map((b) => [b.slot, b.kind]), [[1, "home"]]);
  assert.deepEqual(calls.build[0].input, { quarterId: st.me.quarter.id, slot: 1, kind: "home", modules: ["base.stone", "roof.flat"], version: 1 });

  store.getState().pick(0);
  assert.equal(store.getState().choice, "lamp", "after the home, the picker opens on the lamp");
  assert.equal(await store.getState().place(), true);
  st = store.getState();
  assert.deepEqual(st.me.buildings.map((b) => [b.slot, b.kind]), [[0, "decor"], [1, "home"]]);
  assert.equal(st.me.points.total, 10);
  assert.ok(st.me.tasks.find((t) => t.kind === "light_street").doneAt);
});

test("one tap builds once: a second place while the first is saving does nothing", async () => {
  const { store, calls } = setup();
  await inBuild(store);
  store.getState().pick(1);
  const first = store.getState().place();
  store.getState().pick(0);
  assert.equal(await store.getState().place(), false);
  await first;
  assert.equal(calls.build.length, 1);
});

test("a stale version puts the picker back with a line and takes the quarter the world sent", async () => {
  const { store, calls, mock } = setup();
  await inBuild(store);
  // Another screen builds first.
  const { quarter } = await mock.claim();
  await mock.build({ quarterId: quarter.id, slot: 0, kind: "decor", modules: ["base.stone", "light.amber"], version: 1 });
  store.getState().pick(1);
  const reads = calls.me;
  assert.equal(await store.getState().place(), false);
  const st = store.getState();
  assert.equal(st.landing, null, "the building lifts away");
  assert.equal(st.slot, 1, "the picker is back on the same plot");
  assert.equal(st.error, "Your quarter changed on another screen. Try again.");
  assert.equal(calls.me, reads, "no extra read: the conflict carried the quarter");
  assert.equal(st.me.quarter.version, 2);
  assert.deepEqual(st.me.buildings.map((b) => b.kind), ["decor"]);
  assert.equal(await store.getState().place(), true, "the next try sends the version the quarter has now");
});

test("a build that met no answer is retried once with the same key and applied once", async () => {
  const { store, calls } = setup({ fail: { build: [new WorldError(503, "UNAVAILABLE")] } });
  await inBuild(store);
  store.getState().pick(1);
  assert.equal(await store.getState().place(), true);
  assert.equal(calls.build.length, 2);
  assert.equal(calls.build[0].key, calls.build[1].key);
  assert.equal(store.getState().me.buildings.length, 1);
});

test("what the device already knows is closed is said without asking the world", async () => {
  const { store, calls } = setup();
  await inBuild(store);
  store.getState().pick(1);
  await store.getState().place();
  store.getState().pick(1);
  assert.equal(store.getState().choice, "home", "an occupied plot shows what stands on it");
  assert.equal(await store.getState().place(), false);
  assert.equal(store.getState().error, "Floors come with the kit.");
  store.getState().pick(2);
  store.getState().choose("harbor");
  assert.equal(await store.getState().place(), false);
  assert.equal(store.getState().error, "Opens at level 2.");
  assert.equal(calls.build.length, 1);
});

test("a device whose guest key is gone goes back to the claim", async () => {
  const { store } = setup({ fail: { build: [new WorldError(401, "NO_RESIDENT")] } });
  await inBuild(store);
  store.getState().pick(1);
  assert.equal(await store.getState().place(), false);
  const st = store.getState();
  assert.deepEqual([st.status, st.mode, st.me], ["none", "city", null]);
  assert.equal(st.error, "This device lost its place. Claim your spot again.");
});

test("leaving returns to the city and closes the picker; later puts the card off for the visit", async () => {
  const { store } = setup();
  await inBuild(store);
  store.getState().pick(2);
  store.getState().leave();
  assert.equal(store.getState().mode, "city");
  assert.equal(store.getState().slot, null);
  store.getState().enter();
  assert.equal(store.getState().mode, "arrive");
  store.getState().dismiss();
  assert.equal(store.getState().later, true);
});

test("the card asked for from the dock shows for the visit; its close puts it away again", () => {
  const { store } = setup();
  assert.equal(store.getState().asked, false);
  store.setState({ later: false, asked: true });
  store.getState().dismiss();
  assert.equal(store.getState().asked, false);
  assert.equal(store.getState().later, true);
});
