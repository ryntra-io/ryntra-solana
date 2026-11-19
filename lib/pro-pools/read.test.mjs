import assert from "node:assert/strict";
import test from "node:test";

/* The single pool reads the process keeps: fresh ones only, and never more than the cap, whatever addresses
   are asked for (null answers among them). */

const { keepOne, ONES_KEPT } = await import("./read.server.ts");

test("a pool's read is kept while fresh, and the map never grows past its cap", () => {
  const map = new Map();
  for (let i = 0; i < 40; i++) keepOne(`k${i}`, { at: 1_000, row: null }, 1_000, map, 10);
  assert.equal(map.size, 10, "the oldest go first");
  assert.deepEqual([...map.keys()], Array.from({ length: 10 }, (_, i) => `k${30 + i}`));
  // A read set again moves to the end: the next to go is the one after it.
  keepOne("k30", { at: 1_000, row: null }, 1_000, map, 10);
  keepOne("new", { at: 1_000, row: null }, 1_000, map, 10);
  assert.equal(map.has("k30"), true);
  assert.equal(map.has("k31"), false);
  // Past their freshness every old read lets go at the next write.
  keepOne("later", { at: 60_000, row: null }, 60_000, map, 10);
  assert.deepEqual([...map.keys()], ["later"]);
  assert.ok(ONES_KEPT >= 100 && ONES_KEPT <= 1_000);
});
