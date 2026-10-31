// The island plan stands every tower it is given (CITY-86): a full district grows a second ring, no tower is dropped in
// silence. A tower's plot comes from its mint, and a plan grown from the one on screen moves no tower that stands in both
// (CITY-148).
//   node --test city/lib/city/layout.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { ISLAND_RADIUS, layoutCity, rng, secondRing } from "./layout.ts";
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

// A live read after the bundled one, as Jupiter answers it a few days later: every cap and pool moves, six trending coins
// leave the strip and nine others take their place, the docks turn over, an avenue coin goes, the list comes in another order.
function nextRead(towers, seed = 29) {
  const random = rng(seed);
  const strip = towers.filter((t) => t.district === "strip");
  const leaving = new Set([...strip.slice(-6), ...towers.filter((t) => t.district === "docks"), towers.find((t) => t.district === "avenue")].map((t) => t.id));
  const moved = towers.filter((t) => !leaving.has(t.id)).map((t) => ({ ...t, mcap: t.mcap * (0.6 + random()), liquidity: t.liquidity * (0.7 + random() * 0.7) }));
  const fresh = (district, n, cap, liq) =>
    Array.from({ length: n }, (_, i) => tower(`Fresh${seed}${district}${i}`.padEnd(44, "x"), district, cap * (1 + random() * 20), liq * (1 + random() * 8)));
  const next = [...moved, ...fresh("strip", 9, 4e6, 2e5), ...fresh("docks", 12, 2e4, 6e3)];
  return shuffle(next, random);
}

function shuffle(list, random = rng(5)) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The towers of `before` that also stand in `after` but on another spot. */
function moved(before, after) {
  const was = new Map(before.towers.map((t) => [t.tower.id, t]));
  return after.towers.filter((t) => {
    const p = was.get(t.tower.id);
    return p && (p.x !== t.x || p.z !== t.z);
  });
}

const stands = (layout, towers) => {
  assert.equal(layout.towers.length, towers.length, "every tower stands");
  assert.deepEqual(ids(layout), new Set(towers.map((t) => t.id)));
};

test("the bundled city replaced by the live read: no tower that stands in both moves (CITY-148)", () => {
  const bundled = layoutCity(snapshot.towers);
  const next = nextRead(snapshot.towers);
  const live = layoutCity(next, bundled);
  stands(live, next);
  const both = live.towers.filter((t) => bundled.towers.some((b) => b.tower.id === t.tower.id));
  assert.ok(both.length > 60, `${both.length} towers stand in both`);
  assert.deepEqual(moved(bundled, live).map((t) => t.tower.id), []);
  // And the next minute's read, grown from that one.
  const later = nextRead(next, 31);
  assert.deepEqual(moved(live, layoutCity(later, live)).map((t) => t.tower.id), []);
});

test("one tower more moves none of the others, in any district, wherever it lands", () => {
  const towers = city({ core: 8, heights: 12, strip: 37, avenue: 21, docks: 6 });
  const base = layoutCity(towers);
  for (const district of ["core", "heights", "strip", "avenue", "docks"]) {
    for (let i = 0; i < 12; i += 1) {
      const extra = tower(`Extra${district}${i}`, district, 10 ** (5 + i * 0.4), 10 ** (4.5 + (i % 5) * 0.5));
      const grown = layoutCity([...towers, extra], base);
      stands(grown, [...towers, extra]);
      assert.deepEqual(moved(base, grown).map((t) => t.tower.id), [], `${extra.id} moved others`);
      const it = grown.towers.find((t) => t.tower.id === extra.id);
      for (const o of grown.towers) if (o !== it) assert.ok(Math.hypot(o.x - it.x, o.z - it.z) > (o.width + it.width) * 0.6, `${extra.id} stands clear of ${o.tower.id}`);
    }
  }
});

test("a tower that leaves, or a district that empties, moves none of the rest", () => {
  const towers = city({ core: 8, heights: 12, strip: 37, avenue: 21, docks: 6 });
  const base = layoutCity(towers);
  for (const gone of [towers[3], towers[20], towers[50], towers.at(-1)]) {
    assert.deepEqual(moved(base, layoutCity(towers.filter((t) => t !== gone), base)), []);
  }
  assert.deepEqual(moved(base, layoutCity(towers.filter((t) => t.district !== "strip"), base)), []);
});

test("a tower's plot comes from its mint, not from the list's order or anyone's height", () => {
  const towers = city({ core: 10, heights: 30, strip: 60, avenue: 40, docks: 20 });
  const at = (layout) => new Map(layout.towers.map((t) => [t.tower.id, [t.x, t.z]]));
  const base = at(layoutCity(towers));
  assert.deepEqual(at(layoutCity(shuffle(towers))), base, "another order, the same city");
  const regrown = towers.map((t, i) => ({ ...t, mcap: t.mcap * (i % 2 ? 40 : 0.02), liquidity: t.liquidity * (i % 3 ? 9 : 0.1) }));
  assert.deepEqual(at(layoutCity(regrown)), base, "every height and width changed, the same plots");
});

test("a grown plan keeps no ground from the old one: a coin in another district walks its new district", () => {
  const towers = city({ core: 8, heights: 12, strip: 37, avenue: 21, docks: 6 });
  const base = layoutCity(towers);
  const docked = towers.find((t) => t.district === "docks");
  const next = towers.map((t) => (t === docked ? { ...t, district: "strip" } : t));
  const grown = layoutCity(next, base);
  stands(grown, next);
  const it = grown.towers.find((t) => t.tower.id === docked.id);
  assert.equal(it.kind, 1, "drawn as a strip tower");
  assert.deepEqual(moved(base, grown).map((t) => t.tower.id), [docked.id]);
});

test("a tower that arrives changes only the low buildings on its own ground", () => {
  const towers = city({ core: 8, heights: 12, strip: 37, avenue: 21, docks: 6 });
  const base = layoutCity(towers);
  const extra = tower("ExtraStrip", "strip", 3e6, 4e5);
  const grown = layoutCity([...towers, extra], base);
  const it = grown.towers.find((t) => t.tower.id === extra.id);
  const key = (f) => `${f.x},${f.z},${f.width},${f.depth},${f.height},${f.seed}`;
  const kept = new Set(grown.fillers.map(key));
  for (const f of base.fillers) if (!kept.has(key(f))) assert.ok(Math.hypot(f.x - it.x, f.z - it.z) < it.room + 2.2, "a low building away from the new tower stays");
  const old = new Set(base.fillers.map(key));
  assert.ok(grown.fillers.every((f) => old.has(key(f))), "no low building appears or changes");
});

test("the second ring lies outside the band, or inside it where the band meets the island's edge", () => {
  const strip = secondRing({ from: 24, to: 132, rMin: 19, rMax: 50, kind: 1 });
  assert.ok(strip.rMin > 50 && strip.rMax <= ISLAND_RADIUS - 4);
  const docks = secondRing({ from: 138, to: 214, rMin: 46, rMax: 66, kind: 3 });
  assert.ok(docks.rMax < 46 && docks.rMin < docks.rMax);
});
