// The skyline's plans keep the market's rules (CITY-56): every tower ends exactly at its height, stays inside its width
// and is the same building on every device.
//   node --test city/components/city/skyline/plan.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { layoutCity } from "../../../lib/city/layout.ts";
import { KIT_FLOOR, LODS, modulesOf, planTop, planTower, PODIUM } from "./plan.ts";

/** Crown heights in floors as public/city/models/city-kit.glb has them (mast and beacon included). */
const KIT = {
  "crane.0": 11.46,
  "crown.band.round.0": 4.7,
  "crown.band.rrect.0": 4.7,
  "crown.deco.square.0": 11.17,
  "crown.flat.chamfer.0": 3.17,
  "crown.flat.notch.0": 3.17,
  "crown.flat.round.0": 3.17,
  "crown.flat.rrect.0": 3.17,
  "crown.flat.square.0": 3.17,
  "crown.lantern.round.0": 16.57,
  "crown.pergola.round.0": 3.23,
  "crown.pergola.rrect.0": 3.23,
  "crown.slant.chamfer.0": 15.01,
  "crown.slant.notch.0": 15.01,
  "crown.taper.chamfer.0": 20.2,
  "crown.taper.notch.0": 20.2,
  "crown.taper.round.0": 20.2,
};

const tower = (id, district, mcap, liquidity) => ({
  id,
  symbol: id,
  name: id,
  icon: null,
  district,
  price: 1,
  mcap,
  liquidity,
  change1h: 0,
  change24h: 0,
  volume24h: 0,
  traders1h: 40,
  verified: true,
});

const SOL = "So11111111111111111111111111111111111111112";
const towers = [
  tower(SOL, "core", 9e10, 9e8),
  ...Array.from({ length: 8 }, (_, i) => tower(`C${i}`, "core", 10 ** (7 + i * 0.3), 10 ** (6 + i * 0.2))),
  ...Array.from({ length: 12 }, (_, i) => tower(`H${i}`, "heights", 10 ** (6 + i * 0.25), 10 ** (5.5 + i * 0.15))),
  ...Array.from({ length: 12 }, (_, i) => tower(`S${i}`, "strip", 10 ** (5.5 + i * 0.3), 10 ** (5 + i * 0.2))),
  ...Array.from({ length: 10 }, (_, i) => tower(`A${i}`, "avenue", 10 ** (6 + i * 0.3), 10 ** (5.5 + i * 0.2))),
  ...Array.from({ length: 8 }, (_, i) => tower(`D${i}`, "docks", 10 ** (3.5 + i * 0.4), 10 ** (3 + i * 0.3))),
];
const layout = layoutCity(towers);

test("every level of every tower ends at the market's height", () => {
  for (const t of layout.towers) {
    const plan = planTower(t, KIT);
    for (const lod of LODS) assert.ok(Math.abs(planTop(plan, lod) - t.height) < 1e-6, `${t.tower.id} level ${lod}: ${planTop(plan, lod)} ≠ ${t.height}`);
  }
});

test("no module is wider than the tower's own width, but a crane's jib", () => {
  for (const t of layout.towers) {
    const plan = planTower(t, KIT);
    for (const p of plan.lods.flat()) if (!p.mesh.startsWith("crane")) assert.ok(p.scale <= t.width + 1e-9, `${t.tower.id} ${p.mesh} ${p.scale} > ${t.width}`);
  }
});

test("the shaft runs without gaps from the podium to the roof", () => {
  for (const t of layout.towers) {
    const plan = planTower(t, KIT);
    const floors = plan.lods[0].filter((p) => p.mesh.startsWith("floor.")).sort((a, b) => a.y - b.y);
    assert.ok(Math.abs(floors[0].y - PODIUM * plan.storey) < 1e-9, t.tower.id);
    for (let i = 1; i < floors.length; i += 1) assert.ok(Math.abs(floors[i].y - floors[i - 1].y - plan.storey) < 1e-9, `${t.tower.id} floor ${i}`);
    assert.ok(Math.abs(floors.at(-1).y + plan.storey - plan.roof) < 1e-9, t.tower.id);
    // Street level covers the same floors with fewer, taller pieces.
    const runs = plan.lods[1].filter((p) => p.mesh.startsWith("section.") || p.mesh.startsWith("floor."));
    const covered = runs.reduce((sum, p) => sum + p.h, 0);
    assert.ok(Math.abs(covered - (plan.roof - PODIUM * plan.storey)) < 1e-6, t.tower.id);
  }
});

test("a storey stays near 0.44, and the same tower is the same building every time", () => {
  for (const t of layout.towers) {
    const a = planTower(t, KIT);
    const b = planTower(t, KIT);
    assert.deepEqual(a, b);
    assert.ok(a.storey > 0.36 && a.storey < 0.54, `${t.tower.id} storey ${a.storey}`);
  }
});

test("styles follow the districts, and the Sol Spire is the round tower with the tall mast", () => {
  const plans = layout.towers.map((t) => [t, planTower(t, KIT)]);
  for (const [t, plan] of plans) {
    const want = { core: "spire", heights: "spire", strip: "strip", avenue: "avenue", docks: "docks" }[t.tower.district];
    assert.equal(plan.style, want, t.tower.id);
  }
  const sol = plans.find(([t]) => t.tower.id === SOL)[1];
  assert.equal(sol.shape, "round");
  assert.equal(sol.crown, "crown.taper.round");
  // Several kinds of tower, not one shape repeated.
  assert.ok(new Set(plans.map(([, p]) => p.shape)).size >= 4);
  assert.ok(new Set(plans.map(([, p]) => p.crown)).size >= 5);
  assert.ok(modulesOf(plans.map(([, p]) => p)).length > 20);
  assert.ok(KIT_FLOOR > 0);
});
