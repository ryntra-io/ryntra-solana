// The Lens (CITY-86): which towers each chip looks at, the three rings of «New», the kept chip, the engine's listed
// companies and the frame the camera takes.
//   node --test city/lib/lens/lens.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { EMPTY_CONTEXT, inLens, keepLens, LENS_KEY, LENS_WORDS, LENSES, lensLevels, lensTowers, newRings, newStage, readLens } from "./lens.ts";
import { lensShot } from "./shot.ts";
import { readStockMints, stockMints, STOCKS_URL } from "./stocks.ts";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const DAY = 24 * 60 * 60_000;
const placed = (id, district, { launchedAt = null, x = 10, z = 10, height = 20, width = 3 } = {}) => ({
  tower: { id, symbol: id, name: id, icon: null, district, verified: true, launchedAt },
  x,
  z,
  height,
  width,
  kind: 0,
  seed: 1,
});

const towers = [
  placed("SOL", "core"),
  placed("JUP", "heights"),
  placed("BONK", "strip"),
  placed("FRESHMEME", "strip", { launchedAt: new Date(NOW - 2 * DAY).toISOString() }),
  placed("TSLAx", "avenue"),
  placed("DOCK1", "docks", { x: 60, z: 0 }),
  placed("DOCK2", "docks", { x: 0, z: 64 }),
  placed("RYN", "strip", { launchedAt: new Date(NOW - 30 * DAY).toISOString(), x: 30, z: 0 }),
];
const ctx = {
  ...EMPTY_CONTEXT,
  now: NOW,
  stocks: new Set(["SOL-STOCK-NOWHERE", "BONK"]),
  owned: new Set(["JUP", "BONK"]),
  launches: new Map([
    ["DOCK2", { progress: 82, migrated: false }],
    ["RYN", { progress: 100, migrated: true }],
  ]),
};
const names = (id) => lensTowers(id, towers, ctx).map((t) => t.tower.id);

test("each chip looks at its own towers", () => {
  assert.deepEqual(names("all"), towers.map((t) => t.tower.id));
  assert.deepEqual(names("crypto"), ["SOL", "JUP"]);
  assert.deepEqual(names("memes"), ["BONK", "FRESHMEME", "RYN"]);
  // The avenue, and any tower of a company the engine lists.
  assert.deepEqual(names("stocks"), ["BONK", "TSLAx"]);
  assert.deepEqual(names("new"), ["FRESHMEME", "DOCK1", "DOCK2", "RYN"]);
  assert.deepEqual(names("mine"), ["JUP", "BONK"]);
});

test("«New» has three stages: fresh in the docks, near graduation, graduated into the skyline", () => {
  const stage = (id) => newStage(towers.find((t) => t.tower.id === id), ctx);
  assert.equal(stage("DOCK1"), "fresh");
  assert.equal(stage("DOCK2"), "near");
  assert.equal(stage("RYN"), "graduated");
  assert.equal(stage("FRESHMEME"), "graduated");
  assert.equal(stage("BONK"), null);
  const rings = newRings(towers, ctx);
  assert.equal(rings.fresh.count, 1);
  assert.equal(rings.near.count, 1);
  assert.equal(rings.graduated.count, 2);
  assert.ok(rings.fresh.radius > rings.near.radius && rings.near.radius > rings.graduated.radius, "outside in");
});

test("a tower with no launch time and no launch is never new", () => {
  assert.equal(inLens("new", placed("OLD", "heights"), ctx), false);
  assert.equal(inLens("new", placed("FUTURE", "heights", { launchedAt: new Date(NOW + DAY).toISOString() }), ctx), false);
});

test("levels: looked at, sunk, or untouched — and an empty lens sinks nothing", () => {
  assert.deepEqual([...lensLevels("all", towers, ctx)], towers.map(() => 0));
  assert.deepEqual([...lensLevels("crypto", towers, ctx)], [1, 1, -1, -1, -1, -1, -1, -1]);
  assert.deepEqual([...lensLevels("mine", towers, { ...ctx, owned: new Set() })], towers.map(() => 0));
});

test("the chip is kept per browser; storage that refuses starts on All", () => {
  const box = new Map();
  const storage = { getItem: (k) => box.get(k) ?? null, setItem: (k, v) => void box.set(k, v) };
  assert.equal(readLens(storage), "all");
  keepLens(storage, "memes");
  assert.equal(box.get(LENS_KEY), "memes");
  assert.equal(readLens(storage), "memes");
  box.set(LENS_KEY, "casino");
  assert.equal(readLens(storage), "all", "an unknown chip is All");
  const refusing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.equal(readLens(refusing), "all");
  assert.doesNotThrow(() => keepLens(refusing, "new"));
  assert.equal(readLens(null), "all");
});

test("every chip has its words in both languages, with no placeholder", () => {
  for (const lang of Object.values(LENS_WORDS)) {
    for (const id of LENSES) assert.ok(lang[id] && !/soon/i.test(lang[id]), id);
  }
});

test("the engine's listed companies: mints in shape only, a failed read is an empty list", async () => {
  const mint = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
  assert.deepEqual(stockMints({ companies: [{ mint }, { mint: "not a mint" }, { mint }, null], order: "volume-24h" }), [mint]);
  assert.deepEqual(stockMints(null), []);
  assert.deepEqual(stockMints({ error: { code: "UNAVAILABLE" } }), []);
  let asked = "";
  assert.deepEqual(await readStockMints(async (url) => ((asked = url), { ok: true, json: async () => ({ companies: [{ mint }] }) })), [mint]);
  assert.equal(asked, STOCKS_URL);
  assert.deepEqual(await readStockMints(async () => ({ ok: false, json: async () => ({}) })), []);
  assert.deepEqual(await readStockMints(async () => { throw new Error("offline"); }), []);
});

test("the camera frames the whole set from its own side, further back on an upright phone", () => {
  assert.equal(lensShot([], [0, 30, 170], false), null);
  const set = [placed("A", "strip", { x: 20, z: -10, height: 30 }), placed("B", "strip", { x: 40, z: 10, height: 18 })];
  const desk = lensShot(set, [0, 38, 172], false);
  const phone = lensShot(set, [0, 38, 172], true);
  assert.deepEqual(desk.slice(3), [30, 13.5, 0]);
  assert.ok(desk[2] > 0, "from the camera's side");
  const dist = (s) => Math.hypot(s[0] - s[3], s[2] - s[5]);
  assert.ok(dist(phone) > dist(desk));
  // Short towers are framed from higher up, over the sunk skyline.
  const docks = lensShot([placed("D", "docks", { x: 50, z: 30, height: 8 }), placed("E", "docks", { x: 56, z: 22, height: 10 })], [0, 38, 172], false);
  assert.ok((docks[1] - docks[4]) / dist(docks) > (desk[1] - desk[4]) / dist(desk));
});
