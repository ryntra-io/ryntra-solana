// The island plan stands every tower it is given (CITY-86): a full district grows a second ring, no tower is dropped in
// silence, and a tower its band holds never moves for one it does not.
//   node --test city/lib/city/layout.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { districtSector, hashString, ISLAND_RADIUS, layoutCity, onRoad, rng, secondRing, towerHeight, towerWidth } from "./layout.ts";
import snapshot from "../market/snapshot.json" with { type: "json" };

const SOL = "So11111111111111111111111111111111111111112";
const tower = (id, district, mcap, liquidity) => ({
  id,
  symbol: id,
  name: id,
  icon: null,
  district,
  price: 1,
  mcap,
  liquidity,
  holders: 0,
  change5m: 0,
  change1h: 0,
  change24h: 0,
  volume24h: 0,
  traders1h: 40,
  organic: 90,
  verified: true,
  launchedAt: null,
});

const city = (counts) => [
  tower(SOL, "core", 9e10, 9e8),
  ...Object.entries(counts).flatMap(([district, n]) =>
    Array.from({ length: n }, (_, i) => tower(`${district}-${i}`, district, 10 ** (5.5 + (i % 9) * 0.35), 10 ** (5 + (i % 7) * 0.3))),
  ),
];

const ids = (layout) => new Set(layout.towers.map((t) => t.tower.id));

test("the bundled city stands every one of its towers", () => {
  const layout = layoutCity(snapshot.towers);
  assert.equal(layout.towers.length, snapshot.towers.length);
  assert.deepEqual(ids(layout), new Set(snapshot.towers.map((t) => t.id)));
});

test("a full district grows instead of dropping towers, and no two towers stand in each other", () => {
  const towers = city({ core: 14, heights: 40, strip: 110, avenue: 60, docks: 30 });
  const layout = layoutCity(towers);
  assert.equal(layout.towers.length, towers.length, "every tower stands");
  assert.deepEqual(ids(layout), new Set(towers.map((t) => t.id)));
  for (const t of layout.towers) assert.ok(Math.hypot(t.x, t.z) + t.width <= ISLAND_RADIUS, `${t.tower.id} stands on the island`);
  for (let i = 0; i < layout.towers.length; i += 1) {
    for (let j = i + 1; j < layout.towers.length; j += 1) {
      const a = layout.towers[i];
      const b = layout.towers[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > (a.width + b.width) * 0.6, `${a.tower.id} and ${b.tower.id} do not overlap`);
    }
  }
});

test("the same towers make the same city on every device", () => {
  const towers = city({ core: 10, heights: 30, strip: 80, avenue: 40, docks: 20 });
  const a = layoutCity(towers);
  const b = layoutCity([...towers]);
  assert.deepEqual(
    a.towers.map((t) => [t.tower.id, t.x, t.z]),
    b.towers.map((t) => [t.tower.id, t.x, t.z]),
  );
});

// The plan every tower stood on before CITY-86, frozen here: each district's band in turn, the tallest first, 400 tries.
function bandPlan(towers) {
  const blocks = [];
  const free = (x, z, r) =>
    Math.hypot(x, z) + r <= ISLAND_RADIUS - 2 && !onRoad(x, z, r * 0.9) && blocks.every((b) => Math.hypot(b.x - x, b.z - z) > b.r + r + 1.6);
  const spots = new Map();
  const sol = towers.find((t) => t.id === SOL);
  if (sol) blocks.push({ x: 0, z: 0, r: towerWidth(sol) });
  for (const district of ["core", "heights", "avenue", "strip", "docks"]) {
    const sector = districtSector(district);
    const random = rng(hashString(district));
    const members = towers
      .filter((t) => t.district === district && t.id !== SOL)
      .map((t) => ({ t, h: towerHeight(t), w: towerWidth(t) }))
      .sort((a, b) => b.h - a.h);
    for (const { t, w } of members) {
      for (let tries = 0; tries < 400; tries += 1) {
        const spread = Math.min(1, tries / 160);
        const r = sector.rMin + (sector.rMax - sector.rMin) * Math.min(1, spread * 0.85 + random() * 0.35);
        const a = ((sector.from + (sector.to - sector.from) * random()) * Math.PI) / 180;
        const x = Math.sin(a) * r;
        const z = -Math.cos(a) * r;
        if (free(x, z, w)) {
          spots.set(t.id, { x, z });
          blocks.push({ x, z, r: w });
          break;
        }
      }
    }
  }
  return spots;
}

test("a tower its band holds never moves: the second ring only adds the towers a band had no room for", () => {
  const cities = [
    snapshot.towers,
    city({ core: 8, heights: 12, strip: 37, avenue: 21, docks: 4 }),
    city({ core: 14, heights: 40, strip: 110, avenue: 60, docks: 30 }),
    ...[13, 16, 20, 30].map((n) => city({ core: 8, heights: n, strip: 37, avenue: 18, docks: 4 })),
    ...[19, 22, 30].map((n) => city({ core: 8, heights: 12, strip: 37, avenue: n, docks: 10 })),
  ];
  for (const towers of cities) {
    const before = bandPlan(towers);
    const layout = layoutCity(towers);
    assert.equal(layout.towers.length, towers.length);
    let kept = 0;
    for (const t of layout.towers) {
      const was = before.get(t.tower.id);
      if (!was) continue;
      assert.deepEqual({ x: t.x, z: t.z }, was, `${t.tower.id} stands where it stood`);
      kept += 1;
    }
    assert.equal(kept, before.size);
  }
});

test("the second ring lies outside the band, or inside it where the band meets the island's edge", () => {
  const strip = secondRing({ from: 24, to: 132, rMin: 19, rMax: 50, kind: 1 });
  assert.ok(strip.rMin > 50 && strip.rMax <= ISLAND_RADIUS - 4);
  const docks = secondRing({ from: 138, to: 214, rMin: 46, rMax: 66, kind: 3 });
  assert.ok(docks.rMax < 46 && docks.rMin < docks.rMax);
});
