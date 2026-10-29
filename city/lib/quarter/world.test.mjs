// Run from repo root: node --test city/lib/quarter/world.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { MOCK_KEY, createMockWorld } = await import("./mock.ts");
const { moduleById } = await import("./modules.ts");
const { WorldError } = await import("./types.ts");

/**
 * The world kept on this device (its answers match the server's: contract.test.mjs): it survives a reload, a
 * private window that refuses storage still builds for the visit, a damaged record reads as a newcomer, answers
 * are copies, and nothing about wallets or other people's quarters is pretended.
 */

function memoryStorage() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k) };
}

let clock = Date.parse("2026-10-27T10:00:00.000Z");
const world = (storage = memoryStorage()) => ({ mock: createMockWorld({ storage, now: () => new Date((clock += 1000)) }), storage });
const HOME = moduleById("home");
const home = (quarter) => ({ quarterId: quarter.id, slot: 1, kind: HOME.kind, modules: [...HOME.modules], version: quarter.version });

test("a claim is kept on the device and survives a reload", async () => {
  const storage = memoryStorage();
  const { mock } = world(storage);
  const { quarter, resident } = await mock.claim();
  assert.equal(resident.accountId, null, "a guest, no wallet");
  assert.ok(storage.map.has(MOCK_KEY));
  await mock.build(home(quarter));
  const me = await createMockWorld({ storage }).me();
  assert.equal(me.quarter.version, 2);
  assert.deepEqual(me.buildings.map((b) => b.kind), ["home"]);
  assert.equal(me.quarter.cell.z, 0);
  assert.ok([0, 2].includes(me.quarter.cell.x), "by the bridge, north of the first street");
});

test("a browser that refuses storage still builds for the visit", async () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => {} };
  const { mock } = world(storage);
  const { quarter } = await mock.claim();
  const built = await mock.build(home(quarter));
  assert.equal(built.building.kind, "home");
  assert.equal((await mock.me()).quarter.version, 2);
});

test("a damaged record reads as a newcomer instead of breaking the city", async () => {
  const storage = memoryStorage();
  const { mock } = world(storage);
  storage.setItem(MOCK_KEY, "{not json");
  assert.equal(await mock.me(), null);
  storage.setItem(MOCK_KEY, JSON.stringify({ v: 2, resident: { id: "r" } }));
  assert.equal(await mock.me(), null);
  assert.equal((await mock.claim()).quarter.version, 1);
});

test("answers are copies: changing one never changes the kept world", async () => {
  const { mock } = world();
  const claimed = await mock.claim();
  claimed.quarter.version = 99;
  const me = await mock.me();
  me.buildings.push({ slot: 5 });
  const again = await mock.me();
  assert.equal(again.quarter.version, 1);
  assert.deepEqual(again.buildings, []);
});

test("while you were away: this device's own claim and builds, newest first, each with its source time", async () => {
  const { mock } = world();
  const { quarter } = await mock.claim();
  await mock.build(home(quarter));
  const away = await mock.away("2026-10-01T00:00:00.000Z");
  assert.deepEqual(away.events.map((e) => e.kind), ["build", "claim"]);
  assert.ok(away.events.every((e) => e.source === "world" && e.sourceAt));
  assert.ok(away.since >= new Date(clock - 7 * 86_400_000 - 10_000).toISOString(), "never further back than a week");
});

test("no invented neighbours, no wallet, no frozen cities on the device", async () => {
  const { mock } = world();
  assert.deepEqual((await mock.district("arrivals")).quarters, []);
  const { quarter } = await mock.claim();
  assert.equal((await mock.district("arrivals")).quarters.length, 1);
  assert.deepEqual((await mock.district("downtown")).quarters, []);
  assert.deepEqual(await mock.visit(quarter.id), { visit: null, counted: false, reason: "own_quarter" });
  await assert.rejects(mock.link({ quarterId: quarter.id, slot: 1, link: null, version: 1 }), (e) => e instanceof WorldError && e.code === "WALLET_REQUIRED");
  await assert.rejects(mock.version("v"), (e) => e.code === "NOT_FOUND");
  await assert.rejects(mock.quarter("someone-else"), (e) => e.code === "NOT_FOUND");
});
