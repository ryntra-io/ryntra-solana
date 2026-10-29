// Run from repo root: node --test city/lib/quarter/district.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { MAX_STREETS, arrivalStreets, createArrivalsStore } = await import("./district.ts");
const { ARRIVALS, LOT_D, LOT_W, STREET_PITCH, lotAt, lotOf, streetLamps, streetCells } = await import("./plot.ts");

/**
 * The terrace shows only what lives: the streets with a claimed quarter and one free street after the last of them.
 * The district is read a page at a time and kept for a while; a neighbour's lot is found again under the mouse, and
 * the lamp posts stand on the pavements, never on a lot.
 */

const sketch = (id, x, z) => ({ id, ownerId: `o-${id}`, street: `arrivals-${z + 1}`, cell: { x, z }, level: 1, buildings: [] });

test("an empty district shows the first street, free, for the first newcomer", () => {
  assert.deepEqual(arrivalStreets([]), { occupied: [], free: 0, count: 1 });
});

test("the occupied streets and exactly one free street after the last of them", () => {
  assert.deepEqual(arrivalStreets([{ x: 0, z: 0 }]), { occupied: [0], free: 1, count: 2 });
  assert.deepEqual(arrivalStreets([{ x: 3, z: 0 }, { x: 0, z: 1 }, { x: 5, z: 1 }]), { occupied: [0, 1], free: 2, count: 3 });
  // A street nobody lives on between two lived-in ones is not counted as occupied; the terrace still reaches past it.
  assert.deepEqual(arrivalStreets([{ x: 0, z: 0 }, { x: 0, z: 2 }]), { occupied: [0, 2], free: 3, count: 4 });
});

test("cells that are not streets of the terrace never stretch it", () => {
  const r = arrivalStreets([{ x: 0, z: -3 }, { x: 0, z: Number.NaN }, { x: 0, z: MAX_STREETS + 5 }, { x: 1, z: 1.7 }]);
  assert.deepEqual(r, { occupied: [1], free: 2, count: 3 });
});

test("the district is read page by page, once per id, and kept while fresh", async () => {
  const pages = { "": { quarters: [sketch("a", 0, 0), sketch("b", 1, 0)], nextCursor: "b" }, b: { quarters: [sketch("b", 1, 0), sketch("c", 0, 1)], nextCursor: null } };
  let calls = 0;
  let clock = 1000;
  const client = { district: async (id, cursor) => (calls++, assert.equal(id, "arrivals"), { district: id, ...pages[cursor ?? ""] }) };
  const store = createArrivalsStore({ client: () => client, now: () => clock, ttlMs: 60_000 });
  await store.getState().read();
  assert.deepEqual(store.getState().quarters.map((q) => q.id).sort(), ["a", "b", "c"]);
  assert.equal(store.getState().status, "read");
  assert.equal(calls, 2);
  clock += 30_000;
  await store.getState().read();
  assert.equal(calls, 2, "a fresh read is kept");
  clock += 31_000;
  await store.getState().read();
  assert.equal(calls, 4, "a stale read is read again");
});

test("a district that cannot be read keeps what the terrace already shows", async () => {
  let fail = false;
  const client = { district: async (id) => { if (fail) throw new Error("offline"); return { district: id, quarters: [sketch("a", 0, 0)], nextCursor: null }; } };
  const store = createArrivalsStore({ client: () => client, ttlMs: 0 });
  await store.getState().read();
  fail = true;
  await store.getState().read(true);
  assert.equal(store.getState().quarters.length, 1);
  assert.equal(store.getState().status, "read");
  const empty = createArrivalsStore({ client: () => client });
  await empty.getState().read();
  assert.equal(empty.getState().status, "offline");
});

test("a page that names itself as the next never loops", async () => {
  let calls = 0;
  const client = { district: async (id) => (calls++, { district: id, quarters: [sketch("a", 0, 0)], nextCursor: "same" }) };
  const store = createArrivalsStore({ client: () => client, maxPages: 10 });
  await store.getState().read();
  assert.ok(calls <= 2);
});

test("a lot is found again under any point of it, and nowhere else", () => {
  for (const z of [0, 1, 3]) {
    for (const cell of streetCells(z)) {
      const lot = lotOf(cell);
      for (const [dx, dz] of [[0, 0], [LOT_W / 2 - 0.05, LOT_D / 2 - 0.05], [-(LOT_W / 2 - 0.05), -(LOT_D / 2 - 0.05)]]) assert.deepEqual(lotAt(lot.x + dx, lot.z + dz, 4), cell);
    }
  }
  assert.equal(lotAt(0, ARRIVALS.streetZ + 10, 4), null, "the avenue");
  assert.equal(lotAt(20, ARRIVALS.streetZ, 4), null, "the street");
  assert.equal(lotAt(lotOf({ x: 0, z: 2 }).x, lotOf({ x: 0, z: 2 }).z, 2), null, "past the streets shown");
});

test("lamp posts stand on the pavements, clear of every lot", () => {
  const lamps = streetLamps(1);
  assert.equal(lamps.length, ARRIVALS.perSide * 2 * 2);
  for (const l of lamps) {
    assert.equal(lotAt(l.x, l.z, 3), null);
    assert.ok(Math.abs(Math.abs(l.z - (ARRIVALS.streetZ + STREET_PITCH)) - (ARRIVALS.street + ARRIVALS.walk / 2)) < 1e-9);
  }
});
