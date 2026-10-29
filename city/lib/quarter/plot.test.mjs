// Run from repo root: node --test city/lib/quarter/plot.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { AZIMUTH_RANGE, DISTANCE_MAX, DISTANCE_MIN, PITCH_MAX, PITCH_MIN, aim, clampView, flightAt, flightSeconds, frontAzimuth, homeView, orbit } from "./camera.ts";
import { ARRIVALS, DEEP, FIRST_SLOT, LOT_D, LOT_W, SLOTS, STREET_PITCH, WIDE, lotNumber, lotOf, openPlots, pickCell, plotLevel, slotAt, slotCentre, slotPlace, streetCells, streetName, streetOf, terraceBounds } from "./plot.ts";

/**
 * Where quarters stand: the world's 24 lots a street sit apart, off the island and clear of the avenue; a lot has
 * as many plots as the world has slots, front row first; every plot is found again from its centre, and a tap on
 * a path still lands on a plot. The build camera looks at a lot's front and flies in without a jump.
 */

const ISLAND = 74;

test("a quarter has the world's twelve slots, three across and four deep, front row first", () => {
  assert.equal(SLOTS, 12);
  assert.equal(WIDE * DEEP, SLOTS);
  assert.deepEqual([0, 1, 2].map((s) => slotPlace(s).row), [0, 0, 0]);
  assert.deepEqual([3, 4, 5].map((s) => slotPlace(s).row), [1, 1, 1]);
  assert.deepEqual([openPlots(1), openPlots(2), openPlots(10)], [3, 4, 12]);
  assert.deepEqual([0, 1, 2, 3, 11].map(plotLevel), [1, 1, 1, 2, 10]);
  assert.equal(slotPlace(FIRST_SLOT).row, 0, "the first home goes on the front row");
  assert.ok(FIRST_SLOT < openPlots(1));
});

test("the street's 24 lots stand on the water, apart from each other and clear of the avenue", () => {
  const lots = streetCells(0).map(lotOf);
  assert.equal(lots.length, 24);
  for (const [i, a] of lots.entries()) {
    const corner = Math.hypot(Math.max(0, Math.abs(a.x) - LOT_W / 2), a.z - LOT_D / 2);
    assert.ok(corner > ISLAND + 4, `lot ${i} keeps off the island (${corner.toFixed(1)})`);
    assert.ok(Math.abs(a.x) - LOT_W / 2 >= ARRIVALS.lane - 1e-9, `lot ${i} leaves the avenue free`);
    for (const b of lots.slice(i + 1)) {
      const apartX = Math.abs(a.x - b.x) - LOT_W;
      const apartZ = Math.abs(a.z - b.z) - LOT_D;
      assert.ok(apartX >= ARRIVALS.gap - 1e-9 || apartZ > 0, `lots ${i} and another overlap`);
    }
  }
});

test("even lots face south across the street to the odd ones, nearest the bridge first", () => {
  for (const cell of streetCells(0)) {
    const lot = lotOf(cell);
    assert.equal(lot.facing, cell.x % 2 === 0 ? 1 : -1);
    assert.ok(cell.x % 2 === 0 ? lot.z < ARRIVALS.streetZ : lot.z > ARRIVALS.streetZ);
  }
  const first = lotOf({ x: 0, z: 0 });
  const across = lotOf({ x: 1, z: 0 });
  assert.equal(first.x, across.x, "lot 1 and lot 2 face each other");
  const far = streetCells(0).map(lotOf).map((l) => Math.abs(l.x));
  assert.ok(far[0] <= far[4] && far[4] <= far[23], "the numbers grow away from the bridge");
});

test("streets follow one another southward, and odd input is read safely", () => {
  assert.equal(lotOf({ x: 0, z: 1 }).z - lotOf({ x: 0, z: 0 }).z, STREET_PITCH);
  assert.equal(streetOf(0), "arrivals-1");
  assert.equal(streetOf(2), "arrivals-3");
  assert.equal(streetName("arrivals-3"), "Street 3");
  assert.equal(streetName("harbor-row"), "harbor-row");
  assert.equal(lotNumber({ x: 6, z: 0 }), 7);
  assert.deepEqual(lotOf({ x: -3, z: Number.NaN }), lotOf({ x: 0, z: 0 }));
  assert.deepEqual(lotOf({ x: 2.7, z: 0.2 }), lotOf({ x: 2, z: 0 }));
});

test("every plot is found again from its centre, on lots facing either way", () => {
  for (const cell of [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 22, z: 3 }]) {
    const lot = lotOf(cell);
    for (let slot = 0; slot < SLOTS; slot += 1) {
      const c = slotCentre(lot, slot);
      assert.equal(slotAt(lot, c.x, c.z), slot);
    }
  }
});

test("the front row is by the street, and slot 0 is on the left as seen from it", () => {
  const north = lotOf({ x: 0, z: 0 });
  const front = slotCentre(north, 1);
  const back = slotCentre(north, 10);
  assert.ok(front.z > back.z, "a north lot's street is south of it");
  assert.ok(slotCentre(north, 0).x < slotCentre(north, 2).x, "facing north from the street, left is west");
  const south = lotOf({ x: 1, z: 0 });
  assert.ok(slotCentre(south, 1).z < slotCentre(south, 10).z);
  assert.ok(slotCentre(south, 0).x > slotCentre(south, 2).x);
});

test("a tap on the path between plots lands on the nearest plot; off the lot it lands nowhere", () => {
  const lot = lotOf({ x: 2, z: 0 });
  const a = slotCentre(lot, 1);
  const b = slotCentre(lot, 2);
  assert.equal(slotAt(lot, (a.x + b.x) / 2 - 0.05, a.z), 1);
  assert.equal(slotAt(lot, lot.x + LOT_W, lot.z), null);
  assert.equal(slotAt(lot, lot.x, lot.z - LOT_D), null);
});

test("the terrace holds the first street, and reaches the visitor's street when it is further south", () => {
  const b = terraceBounds();
  for (const lot of streetCells(0).map(lotOf)) {
    assert.ok(lot.x - LOT_W / 2 > b.minX && lot.x + LOT_W / 2 < b.maxX);
    assert.ok(lot.z - LOT_D / 2 > b.minZ && lot.z + LOT_D / 2 < b.maxZ);
  }
  assert.ok(b.minZ > ISLAND, "the terrace starts on the water");
  const far = lotOf({ x: 3, z: 2 });
  assert.ok(terraceBounds(far, 2).maxZ > far.z + LOT_D / 2);
});

test("this device's lot is by the bridge, north of the first street", () => {
  for (const seed of [0, 1, 5, 6, 123456789, -7]) {
    const cell = pickCell(seed);
    assert.equal(cell.z, 0);
    assert.ok(cell.x === 0 || cell.x === 2);
    assert.equal(lotOf(cell).facing, 1);
  }
});

test("the build camera looks at the lot's front from its street, above it, at its distance", () => {
  const target = { x: 10, y: 0, z: 100 };
  const p = orbit(target, { azimuth: frontAzimuth(1), pitch: 0.9, distance: 30 });
  assert.ok(Math.abs(p.x - 10) < 1e-9);
  assert.ok(p.z > target.z, "a lot facing south is seen from the south");
  assert.ok(Math.abs(Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z) - 30) < 1e-9);
  const q = orbit(target, { azimuth: frontAzimuth(-1), pitch: 0.9, distance: 30 });
  assert.ok(q.z < target.z, "a lot facing north is seen from the north");
});

test("on a phone the lot sits high above the sheet; on a desk it sits left of the side sheet", () => {
  const phone = homeView(390, 844);
  const desk = homeView(1440, 860);
  assert.ok(phone.lead > 0 && phone.side === 0);
  assert.ok(desk.side > 0);
  const lot = { x: 0, z: 100 };
  assert.ok(aim(lot, 0, phone.lead, 0).z > lot.z, "aiming in front of the lot puts it higher on the screen");
  assert.ok(aim(lot, 0, 0, desk.side).x > lot.x, "aiming right of the lot puts it left on the screen");
});

test("views stay inside their limits", () => {
  assert.deepEqual(clampView({ azimuth: 9, pitch: 9, distance: 999 }), { azimuth: AZIMUTH_RANGE, pitch: PITCH_MAX, distance: DISTANCE_MAX });
  assert.deepEqual(clampView({ azimuth: -9, pitch: -1, distance: 0 }), { azimuth: -AZIMUTH_RANGE, pitch: PITCH_MIN, distance: DISTANCE_MIN });
});

test("the flight starts where the camera was, ends on the lot and rises in between", () => {
  const from = { position: { x: 0, y: 38, z: 172 }, target: { x: 0, y: 25, z: 0 } };
  const to = { position: { x: 20, y: 24, z: 125 }, target: { x: 20, y: 0, z: 103 } };
  assert.deepEqual(flightAt(from, to, 0, 12), from);
  const end = flightAt(from, to, 1, 12);
  for (const k of ["x", "y", "z"]) {
    assert.ok(Math.abs(end.position[k] - to.position[k]) < 1e-9);
    assert.ok(Math.abs(end.target[k] - to.target[k]) < 1e-9);
  }
  const mid = flightAt(from, to, 0.5, 12);
  assert.ok(Math.abs(mid.position.y - ((from.position.y + to.position.y) / 2 + 12)) < 1e-9);
  const s = flightSeconds(from, to);
  assert.ok(s >= 1.5 && s <= 2.6);
});
