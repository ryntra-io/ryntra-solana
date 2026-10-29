// The quarter's building kit: catalog rules, every kind at every level, and the level-of-detail switch.
//   node --test city/lib/quarter/kit/
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILDING_KINDS,
  LEVELS,
  MAX_FLOORS,
  MODULES,
  defaultModules,
  floorsFor,
  moduleDef,
  moduleList,
  modulesFor,
  normalizeModules,
  quarterLevelFor,
} from './catalog.ts';
import { MODULES as WORLD_MODULES } from '../../../../lib/world/catalog.ts';
import { BUILDING_KINDS as WORLD_KINDS } from '../../../../lib/world/contract.ts';
import { LOT, planBuilding } from './blueprint.ts';
import { chooseLod, projectedPixels, LOD_PIXELS } from './lod.ts';
import { C, FAR, MID, NEAR, SHAPES, STYLES, MOTIONS, partBounds, rotate } from './parts.ts';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const same = (a, b) => a.every((v, i) => close(v, b[i], 1e-6));

test('the kit knows exactly the modules the world server keeps, and names each', () => {
  assert.deepEqual(MODULES.map((m) => m.id).sort(), Object.keys(WORLD_MODULES).sort());
  for (const m of MODULES) {
    assert.match(m.id, /^(base|floor|roof|light|sign)\.[a-z]+$/);
    assert.equal(m.slot, WORLD_MODULES[m.id].part);
    assert.notEqual(m.name, m.id, `${m.id} has no name on the build sheet`);
  }
  assert.ok(modulesFor('roof').every((m) => m.slot === 'roof'));
});

test('the kit draws every kind the world server keeps', () => {
  assert.deepEqual([...BUILDING_KINDS].sort(), [...WORLD_KINDS].sort());
});

test('a fresh building of every kind and level is one the server accepts', () => {
  for (const kind of BUILDING_KINDS) {
    for (const level of LEVELS) {
      const ids = defaultModules(kind, level);
      const tag = `${kind} L${level}`;
      const slots = ids.map((id) => moduleDef(id)?.slot);
      assert.ok(slots.every(Boolean), `${tag} has a module the server does not know`);
      assert.equal(slots.filter((x) => x === 'base').length, 1, `${tag} base`);
      // The server counts a building's level as one plus its floors.
      assert.equal(slots.filter((x) => x === 'floor').length, floorsFor(level), `${tag} floors`);
      for (const slot of ['roof', 'light', 'sign']) assert.ok(slots.filter((x) => x === slot).length <= 1, `${tag} ${slot}`);
      // In the server's order: base, floors, roof, light, sign.
      const order = ['base', 'floor', 'roof', 'light', 'sign'];
      assert.deepEqual([...slots].sort((a, b) => order.indexOf(a) - order.indexOf(b)), slots, `${tag} order`);
      // Every module is open at the quarter level that first allows a building of this level.
      for (const id of ids) assert.ok(WORLD_MODULES[id].from <= quarterLevelFor(level), `${tag}: ${id} opens at quarter ${WORLD_MODULES[id].from}`);
      assert.deepEqual(moduleList(normalizeModules(kind, level, ids)), ids, `${tag} is its own normal form`);
    }
  }
});

test('normalizeModules draws whatever a record holds', () => {
  const set = normalizeModules('home', 5, ['base.basalt', 'floor.glass', 'roof.dome', 'base.stone', 'floor.brick', 'floor.terrace', 'floor.garden', 'floor.glass', 'nope.x', 'light.beacon', 'light.amber', 'sign.neon']);
  assert.equal(set.base, 'base.basalt');
  assert.deepEqual(set.floors, ['floor.glass', 'floor.brick', 'floor.terrace', 'floor.garden']);
  assert.equal(set.floors.length, MAX_FLOORS);
  assert.equal(set.roof, 'roof.dome');
  assert.equal(set.light, 'light.beacon');
  assert.equal(set.sign, 'sign.neon');
  // Without a base or a light, the default fills in; without a roof or sign, the building has none.
  const bare = normalizeModules('home', 3, ['floor.glass']);
  assert.equal(bare.base, normalizeModules('home', 3, []).base);
  assert.equal(bare.roof, null);
  assert.equal(bare.sign, null);
  // An empty list is a fresh building.
  assert.deepEqual(moduleList(normalizeModules('garage', 4, [])), defaultModules('garage', 4));
});

const plans = [];
for (const kind of BUILDING_KINDS) for (const level of LEVELS) plans.push({ kind, level, plan: planBuilding(kind, level) });

test('every kind at every level stands on its lot with finite, known parts', () => {
  for (const { kind, level, plan } of plans) {
    const tag = `${kind} L${level}`;
    assert.ok(plan.parts.length > 0, tag);
    for (const part of plan.parts) {
      assert.ok(SHAPES.includes(part.shape), `${tag} shape ${part.shape}`);
      assert.ok(part.style in STYLES && part.motion in MOTIONS, tag);
      for (const v of [...part.at, ...part.size, ...part.turn, ...part.tint, ...part.glow, ...part.accent, part.power, part.speed, part.phase]) assert.ok(Number.isFinite(v), tag);
      assert.ok(part.size.every((v) => v > 0), `${tag} size ${part.size}`);
      assert.ok(part.lods > 0 && part.lods <= (NEAR | MID | FAR), tag);
    }
    assert.ok(plan.min[1] >= -0.01, `${tag} below ground: ${plan.min[1]}`);
    // Solid parts stay on the lot; light pooled on the ground may spill a little into the street.
    for (const part of plan.parts) {
      const [lo, hi] = partBounds(part);
      const reach = Math.max(Math.abs(lo[0]), Math.abs(hi[0]), Math.abs(lo[2]), Math.abs(hi[2]));
      assert.ok(reach <= LOT / 2 + (part.style === 'pool' ? 1 : 0.02), `${tag} ${part.shape}/${part.style} at ${part.at} leaves its lot (${reach.toFixed(2)})`);
    }
  }
});

test('each level draws something at every distance, and less far away', () => {
  for (const { kind, level, plan } of plans) {
    const count = (bit) => plan.parts.filter((p) => p.lods & bit).length;
    const near = count(NEAR);
    const mid = count(MID);
    const far = count(FAR);
    assert.ok(far > 0, `${kind} L${level} has nothing far away`);
    assert.ok(near >= mid && mid >= Math.min(far, mid), `${kind} L${level} ${near}/${mid}/${far}`);
    assert.ok(far <= 16, `${kind} L${level} far view has ${far} parts`);
    assert.ok(near <= 110, `${kind} L${level} has ${near} parts up close`);
  }
});

test('a building grows with its level', () => {
  for (const kind of BUILDING_KINDS) {
    const sizes = LEVELS.map((level) => {
      const { plan } = plans.find((p) => p.kind === kind && p.level === level);
      return (plan.max[0] - plan.min[0]) * (plan.max[1] - plan.min[1]) * (plan.max[2] - plan.min[2]);
    });
    for (let i = 1; i < sizes.length; i += 1) assert.ok(sizes[i] > sizes[i - 1] * 0.98, `${kind} L${i + 1} is not bigger than L${i}: ${sizes.map((v) => v.toFixed(1))}`);
    const heights = LEVELS.map((level) => plans.find((p) => p.kind === kind && p.level === level).plan.max[1]);
    assert.ok(heights[4] > heights[0] * 1.3, `${kind} heights ${heights.map((v) => v.toFixed(2))}`);
  }
});

test('the same building is drawn the same on every device; the seed only varies details', () => {
  const a = planBuilding('home', 4, ['base.plaza', 'floor.ceramic', 'floor.glass'], { seed: 7 });
  const b = planBuilding('home', 4, ['base.plaza', 'floor.ceramic', 'floor.glass'], { seed: 7 });
  assert.deepEqual(a, b);
  const c = planBuilding('home', 4, ['base.plaza', 'floor.ceramic', 'floor.glass'], { seed: 8 });
  assert.equal(c.parts.length, a.parts.length);
});

test('floor modules restyle the storeys; the level keeps the form', () => {
  const concrete = planBuilding('home', 5, ['base.basalt', 'floor.concrete', 'floor.concrete', 'floor.concrete', 'floor.concrete']);
  const glass = planBuilding('home', 5, ['base.basalt', 'floor.glass', 'floor.glass', 'floor.glass', 'floor.glass']);
  const storeys = (plan) => plan.parts.filter((p) => p.shape === 'chamfer' && p.size[1] > 0.8 && p.lods !== FAR);
  assert.equal(storeys(concrete).length, storeys(glass).length);
  assert.ok(storeys(concrete).every((p) => p.style === 'graphite'));
  assert.ok(storeys(glass).every((p) => p.style === 'glass'));
  assert.ok(close(concrete.max[1], glass.max[1], 0.5));
  // Terraces and garden floors bring their balconies and planters.
  const garden = planBuilding('home', 5, ['base.basalt', 'floor.garden', 'floor.garden', 'floor.garden', 'floor.garden']);
  assert.ok(garden.parts.filter((p) => p.style === 'foliage').length > glass.parts.filter((p) => p.style === 'foliage').length);
});

test('mint lights only launches and value, red only danger', () => {
  const isMint = (rgb) => rgb[1] > rgb[0] * 4 && rgb[1] > rgb[2] * 1.3;
  const isRed = (rgb) => rgb[0] > rgb[1] * 3 && rgb[0] > rgb[2] * 3;
  for (const { kind, level, plan } of plans) {
    const lights = plan.parts.filter((p) => p.style === 'light' || p.style === 'pool' || p.style === 'screen');
    if (!(kind === 'coin_tower' && level <= 2)) assert.ok(!lights.some((p) => isMint(p.glow)), `${kind} L${level} uses mint without value`);
    assert.ok(!plan.parts.some((p) => isRed(p.glow) || isRed(p.accent)), `${kind} L${level} uses red without danger`);
  }
  const value = planBuilding('harbor', 5, [], { signal: 'value' });
  assert.ok(value.parts.some((p) => p.motion === 'flow' && isMint(p.glow)), 'fees flow mint on a harbor that earns');
  const danger = planBuilding('harbor', 5, [], { signal: 'danger' });
  assert.ok(danger.parts.some((p) => p.style === 'pool' && isRed(p.glow)), 'a red haze over a harbor out of range');
});

test('every module the catalog offers changes or keeps a building without breaking it', () => {
  for (const kind of BUILDING_KINDS) {
    for (const m of MODULES) {
      const plan = planBuilding(kind, 5, [m.id]);
      assert.ok(plan.parts.length > 0 && Number.isFinite(plan.radius), `${kind} + ${m.id}`);
    }
  }
});

test('bounds follow rotations the way three.js turns things', () => {
  // Euler XYZ turns a vector around z first, then y, then x.
  assert.ok(same(rotate([1, 0, 0], [0, Math.PI / 2, 0]), [0, 0, -1]));
  assert.ok(same(rotate([0, 1, 0], [Math.PI / 2, 0, 0]), [0, 0, 1]));
  assert.ok(same(rotate([1, 0, 0], [Math.PI / 2, 0, Math.PI / 2]), [0, 0, 1]));
  const [lo, hi] = partBounds({ shape: 'box', at: [1, 0, 0], size: [2, 1, 4], turn: [0, Math.PI / 2, 0] });
  assert.ok(same(lo, [-1, 0, -1]) && same(hi, [3, 1, 1]));
  assert.ok(C.amber.every((v) => v >= 0 && v <= 1));
});

test('level of detail follows screen size and does not flicker at a threshold', () => {
  const [near, mid] = LOD_PIXELS;
  assert.equal(chooseLod(near + 1, null), 0);
  assert.equal(chooseLod(near - 1, null), 1);
  assert.equal(chooseLod(mid - 1, null), 2);
  // Just past a threshold keeps the previous choice; clearly past it switches.
  assert.equal(chooseLod(near * 1.05, 1), 1);
  assert.equal(chooseLod(near * 1.2, 1), 0);
  assert.equal(chooseLod(near * 0.95, 0), 0);
  assert.equal(chooseLod(near * 0.8, 0), 1);
  assert.equal(chooseLod(mid * 0.5, 0), 2);
  assert.equal(chooseLod(near * 1.05, 2), 1);
  const px = projectedPixels(5, 50, 40, 1000);
  assert.ok(close(px, (10 / 50) * (1000 / (2 * Math.tan((20 * Math.PI) / 180)))));
});
