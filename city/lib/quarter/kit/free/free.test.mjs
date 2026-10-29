// Free building on my quarter (CITY-55): the grid and its snapping, pieces fitted to their neighbours, the device's
// layout with the server's rules, and the flow of the store — place, turn, erase, step back, save, conflicts.
//   node --test city/lib/quarter/kit/free/
import '../../../../../lib/world/testing/hooks.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

const { CELL, STOREY_H, cellAt, cellCentre, pieceCentre, plotOrigin, snap, nextStorey, toLocal, toWorld, dirToLocal } = await import('./grid.ts');
const { planLayout, signFace } = await import('./fit.ts');
const { createDeviceLayout, LayoutError } = await import('./client.ts');
const { createFreeStore } = await import('./store.ts');
const { createQuarterStore } = await import('../../store.ts');
const { createMockWorld } = await import('../../mock.ts');
const { slotCentre, lotOf } = await import('../../plot.ts');
const { GRID_W, GRID_D, pieceCap } = await import('../../../../../lib/world/layout.ts');

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const p = (gx, gz, kind = 'block', y = 0, rot = 0) => ({ gx, gz, y, kind, rot });
const down = (x, z, from = 20) => ({ origin: { x, y: from, z }, dir: { x: 0, y: -1, z: 0 } });

test('cells sit inside their plots, a third of a plot each, and the middle cell is the plot centre', () => {
  for (let slot = 0; slot < 12; slot += 1) {
    const o = plotOrigin(slot);
    const gx = (slot % 3) * 3 + 1;
    const gz = Math.floor(slot / 3) * 3 + 1;
    const c = cellCentre(gx, gz);
    assert.ok(close(c.x, o.x) && close(c.z, o.z), `slot ${slot}`);
  }
  assert.ok(close(cellCentre(1, 0).z - cellCentre(1, 1).z, CELL), 'inward is −z');
  assert.ok(close(cellCentre(1, 0).x - cellCentre(0, 0).x, CELL), 'to the right is +x');
  // The plot origins agree with where the quarter draws its plots.
  const lot = { x: 10, z: 20, facing: -1 };
  for (const slot of [0, 4, 11]) {
    const o = plotOrigin(slot);
    const w = toWorld(lot, { x: o.x, y: 0, z: o.z }, 0);
    const c = slotCentre(lot, slot);
    assert.ok(close(w.x, c.x) && close(w.z, c.z), `slot ${slot} facing north`);
  }
});

test('a point on the ground snaps to its cell; a touch a little into the path still counts, the middle of the path does not', () => {
  for (let gx = 0; gx < GRID_W; gx += 1) {
    for (let gz = 0; gz < GRID_D; gz += 1) {
      const c = cellCentre(gx, gz);
      assert.deepEqual(cellAt(c.x + 0.3, c.z - 0.3), { gx, gz });
    }
  }
  const edge = cellCentre(2, 0);
  assert.deepEqual(cellAt(edge.x + 0.55, edge.z), { gx: 2, gz: 0 });
  assert.equal(cellAt(edge.x + 0.8, edge.z), null, 'the middle of the path between plots');
  assert.equal(cellAt(100, 0), null);
});

test('snapping as in Townscaper: the ground, the top of a block, the side of a block, and nothing on a tree', () => {
  const c = cellCentre(1, 1);
  assert.deepEqual(snap([], down(c.x, c.z).origin, down(c.x, c.z).dir).place, { gx: 1, gz: 1, y: 0 });
  const one = [p(1, 1)];
  assert.deepEqual(snap(one, down(c.x, c.z).origin, down(c.x, c.z).dir).place, { gx: 1, gz: 1, y: 1 }, 'the top stacks');
  // A ray from the right, level with the block, meets its right face: the new piece goes on the cell to the right.
  const side = snap(one, { x: c.x + 5, y: STOREY_H / 2, z: c.z }, { x: -1, y: 0, z: 0 });
  assert.deepEqual(side.place, { gx: 2, gz: 1, y: 0 });
  assert.equal(side.hit, one[0]);
  // From the street side (+z), the face toward the street: the cell nearer the street.
  assert.deepEqual(snap(one, { x: c.x, y: 0.4, z: c.z + 5 }, { x: 0, y: 0, z: -1 }).place, { gx: 1, gz: 0, y: 0 });
  // Across the path into another plot: nothing.
  const corner = [p(2, 1)];
  const k = cellCentre(2, 1);
  assert.equal(snap(corner, { x: k.x - 5, y: 0.4, z: k.z }, { x: 1, y: 0, z: 0 }).place?.gx, 1, 'the left face, inside the plot');
  assert.equal(snap(corner, { x: k.x + 5, y: 0.4, z: k.z }, { x: -1, y: 0, z: 0 }).place, null, 'the right face looks onto the path');
  const tree = [p(1, 1, 'tree')];
  const t = snap(tree, down(c.x, c.z).origin, down(c.x, c.z).dir);
  assert.equal(t.place, null);
  assert.equal(t.hit, tree[0]);
  assert.equal(nextStorey([p(0, 0), p(0, 0, 'block', 1), p(0, 0, 'block', 2)], 0, 0), null, 'a full column');
});

test('a game building snaps to the corner of its two by two inside the plot', () => {
  const c = cellCentre(2, 2);
  assert.deepEqual(snap([], down(c.x, c.z).origin, down(c.x, c.z).dir, 2).place, { gx: 1, gz: 1, y: 0 });
  assert.equal(snap([p(1, 2, 'tree')], down(c.x, c.z).origin, down(c.x, c.z).dir, 2).place, null);
  const centre = pieceCentre({ gx: 0, gz: 0, kind: 'arcade' });
  const a = cellCentre(0, 0);
  const b = cellCentre(1, 1);
  assert.ok(close(centre.x, (a.x + b.x) / 2) && close(centre.z, (a.z + b.z) / 2));
});

test('the lot frame turns with the lot: a ray in the world finds the same cell whichever way the lot faces', () => {
  for (const facing of [1, -1]) {
    const lot = { x: -30, z: 118, facing };
    const c = cellCentre(4, 7);
    const w = toWorld(lot, { x: c.x, y: 0, z: c.z }, 0.12);
    const o = toLocal(lot, { x: w.x, y: 10, z: w.z }, 0.12);
    const d = dirToLocal(lot, { x: 0, y: -1, z: 0 });
    assert.deepEqual(snap([], o, d).place, { gx: 4, gz: 7, y: 0 }, `facing ${facing}`);
  }
});

const boxes = (plan) => plan.parts.filter((x) => x.shape === 'box' && (x.style === 'graphite' || x.style === 'glass'));
const roofs = (plan) => plan.parts.filter((x) => x.style === 'roof');

test('blocks side by side become one house: walls meet, the roof runs along the row', () => {
  const lone = planLayout([p(1, 1)]);
  assert.ok(boxes(lone)[0].size[0] < CELL, 'a lone block stands in from its edges');
  assert.equal(roofs(lone).length, 1);
  assert.equal(roofs(lone)[0].shape, 'gable');

  const row = planLayout([p(0, 1), p(1, 1), p(2, 1)]);
  const middle = boxes(row)[1];
  assert.ok(close(middle.size[0], CELL), 'the middle block reaches both neighbours');
  for (const r of roofs(row)) {
    assert.equal(r.shape, 'gable');
    assert.ok(close(r.turn[1], Math.PI / 2), 'a row along x turns its ridge along x');
  }
  const column = planLayout([p(1, 0), p(1, 1)]);
  for (const r of roofs(column)) assert.equal(r.turn[1], 0, 'a row inward keeps the ridge along z');

  const square = planLayout([p(0, 0), p(1, 0), p(0, 1), p(1, 1)]);
  assert.ok(roofs(square).every((r) => r.shape === 'box'), 'a house open both ways gets a flat roof');

  const across = planLayout([p(2, 1), p(3, 1)]);
  assert.ok(boxes(across).every((b) => b.size[0] < CELL), 'across the path two plots never join');
});

test('a stack reads as storeys: a ledge between them, one roof on top, a flat top under what stands on it', () => {
  const stack = planLayout([p(1, 1), p(1, 1, 'block', 1)]);
  assert.equal(roofs(stack).length, 1);
  assert.ok(close(roofs(stack)[0].at[1], 2 * STOREY_H));
  assert.ok(stack.parts.some((x) => x.style === 'stone' && close(x.at[1], STOREY_H - 0.025)), 'a ledge');
  const crowned = planLayout([p(1, 1), p(1, 1, 'turret', 1)], {});
  const flat = roofs(crowned).find((r) => r.shape === 'box');
  assert.ok(flat, 'a flat top under the turret');
  assert.ok(crowned.parts.some((x) => x.shape === 'cone'), 'the turret has its cone');
});

test('a door opens on the front only when nothing stands against it; hedges join, a lone one is a bush; paths reach each other', () => {
  const doors = (plan) => plan.parts.filter((x) => x.style === 'light' && close(x.size[1], 0.38));
  assert.equal(doors(planLayout([p(1, 1)])).length, 1);
  assert.equal(doors(planLayout([p(1, 1), p(1, 0)])).length, 1, 'the street block keeps its door, the one behind it loses its own');
  assert.equal(doors(planLayout([p(1, 1, 'block', 0, 2), p(1, 2)])).length, 0, 'two blocks facing each other share a wall, no door');
  assert.equal(planLayout([p(1, 1, 'hedge')]).parts[0].shape, 'sphere');
  const line = planLayout([p(0, 1, 'hedge'), p(1, 1, 'hedge')]);
  assert.ok(line.parts.every((x) => x.shape === 'box'));
  assert.equal(line.parts.length, 4, 'two posts and an arm toward each other');
  assert.equal(planLayout([p(0, 1, 'path'), p(1, 1, 'path')]).parts.length, 4);
});

test('a plan about a plot centre moves every part by that origin, and every piece kind draws', () => {
  const o = plotOrigin(4);
  const a = planLayout([p(4, 4)]);
  const b = planLayout([p(4, 4)], { origin: o });
  a.parts.forEach((x, i) => assert.ok(close(x.at[0] - o.x, b.parts[i].at[0]) && close(x.at[2] - o.z, b.parts[i].at[2])));
  for (const kind of ['block', 'glass', 'arch', 'turret', 'path', 'hedge', 'tree', 'lamp', 'fountain', 'sign', 'arcade', 'vault_house', 'mini_ring']) {
    const plan = planLayout([p(0, 0, kind)]);
    assert.ok(plan.parts.length > 0, kind);
    for (const part of plan.parts) assert.ok(part.size.every(Number.isFinite) && part.at.every(Number.isFinite), kind);
    assert.ok(plan.radius < 2.5, `${kind} stays on its plot`);
  }
  const face = signFace(p(1, 1, 'sign', 0, 1));
  assert.ok(face.x > cellCentre(1, 1).x, 'a sign turned right shows its words to the right');
});

test('a full quarter of pieces is a modest plan for a phone', () => {
  const pieces = [];
  for (let gz = 0; gz < 3; gz += 1) for (let gx = 0; gx < 9; gx += 1) pieces.push(p(gx, gz, 'block'), p(gx, gz, 'block', 1));
  const plan = planLayout(pieces.slice(0, pieceCap(1)));
  assert.ok(plan.parts.length < 400, `${plan.parts.length} parts`);
});

/* ------------------------------------------------------------------ the store -- */

async function setup({ level = 1, saveFail = [] } = {}) {
  const mock = createMockWorld({ storage: null });
  const quarter = createQuarterStore({ client: () => mock, retryMs: 0 });
  await quarter.getState().setOwner('acct');
  await quarter.getState().claim();
  quarter.getState().arrived();
  if (level > 1) quarter.setState({ me: { ...quarter.getState().me, quarter: { ...quarter.getState().me.quarter, level } } });
  const device = createDeviceLayout({ world: mock, storage: null });
  const calls = { save: [] };
  const layout = {
    mine: (id) => device.mine(id),
    async save(input, key) {
      calls.save.push({ input, key });
      const f = saveFail.shift();
      if (f) throw f;
      return device.save(input, key);
    },
  };
  let keys = 0;
  const free = createFreeStore({ client: () => layout, quarter, saveMs: 0, retryMs: 0, newKey: () => `free-key-${++keys}`, now: () => 1000 });
  free.setState({ quarterId: quarter.getState().me.quarter.id });
  await free.getState().open();
  const lot = lotOf(quarter.getState().me.quarter.cell);
  /** A tap from straight above a cell of my lot, as the camera sends it. */
  const tapCell = (gx, gz) => {
    const c = cellCentre(gx, gz);
    const w = toWorld(lot, { x: c.x, y: 0, z: c.z }, 0.12);
    free.getState().tap(free.getState().aim({ x: w.x, y: 30, z: w.z }, { x: 0, y: -1, z: 0 }, 0.12));
  };
  const settle = () => new Promise((r) => setTimeout(r, 5)).then(() => free.getState().flush());
  return { quarter, free, device, calls, tapCell, settle };
}

test('opening free building reads the layout; a tap puts the piece in hand down at once and saves it behind', async () => {
  const { free, quarter, tapCell, settle, calls, device } = await setup();
  assert.equal(free.getState().on, true);
  assert.equal(free.getState().status, 'ready');
  tapCell(1, 1);
  tapCell(1, 1);
  assert.deepEqual(free.getState().pieces.map((x) => [x.gx, x.gz, x.y, x.kind]), [[1, 1, 0, 'block'], [1, 1, 1, 'block']]);
  assert.deepEqual(free.getState().fresh.at, { gx: 1, gz: 1, y: 1 });
  await settle();
  assert.equal(calls.save.length >= 1, true);
  const kept = await device.mine(quarter.getState().me.quarter.id);
  assert.equal(kept.pieces.length, 2);
  assert.equal(free.getState().version, kept.version);
  // Points and the day's tasks stay as they were: free building pays nothing.
  assert.equal(quarter.getState().me.points.total, 0);
});

test('a closed plot, a game building above its level and a full quarter are refused on the spot with a reason', async () => {
  const { free, tapCell } = await setup();
  tapCell(1, 5);
  assert.equal(free.getState().pieces.length, 0);
  assert.equal(free.getState().note.kind, 'refused');
  assert.equal(free.getState().note.reason, 'closed');
  free.getState().choose('mini_ring');
  tapCell(1, 1);
  assert.equal(free.getState().note.reason, 'kind');
  free.getState().choose('tree');
  free.setState({ pieces: Array.from({ length: pieceCap(1) }, (_, i) => p(i % 9, Math.floor(i / 9) % 3, 'block', Math.floor(i / 27))) });
  tapCell(0, 0);
  assert.equal(free.getState().note.kind, 'full');
});

test('turn, erase and step back', async () => {
  const { free, tapCell } = await setup();
  free.getState().choose('arch');
  tapCell(4, 1);
  free.getState().turn();
  assert.equal(free.getState().pieces[0].rot, 1, 'the turn applies to the piece just placed');
  assert.equal(free.getState().rot, 1, 'and to the next one');
  free.getState().choose('block');
  tapCell(4, 1);
  assert.equal(free.getState().pieces.length, 2);
  free.getState().choose('erase');
  tapCell(4, 1);
  assert.deepEqual(free.getState().pieces.map((x) => x.kind), ['arch'], 'the eraser takes the top-most piece it meets');
  free.getState().undo();
  assert.equal(free.getState().pieces.length, 2);
  free.getState().undo();
  free.getState().undo();
  assert.equal(free.getState().pieces.length, 1);
});

test('a sign takes its words through the city rules; the field never holds what would be refused', async () => {
  const { free, tapCell, settle, device, quarter } = await setup();
  free.getState().choose('sign');
  tapCell(0, 0);
  free.getState().setText('Open late');
  assert.equal(free.getState().pieces[0].text, 'Open late');
  free.getState().setText('<b>nope</b>');
  assert.equal(free.getState().pieces[0].text, 'Open late');
  free.getState().setText('');
  assert.equal(free.getState().pieces[0].text, undefined);
  free.getState().setText('Café');
  await settle();
  assert.equal((await device.mine(quarter.getState().me.quarter.id)).pieces[0].text, 'Café');
});

test('a save that lost to another device takes that device\'s layout; a refused one goes back to what is kept', async () => {
  const theirs = { quarterId: 'q', pieces: [p(7, 0, 'tree')], version: 5, updatedAt: null };
  const { free, tapCell, settle } = await setup({ saveFail: [new LayoutError(409, 'VERSION_CONFLICT', { current: theirs })] });
  free.setState({ quarterId: free.getState().quarterId });
  theirs.quarterId = free.getState().quarterId;
  tapCell(1, 1);
  await settle();
  assert.deepEqual(free.getState().pieces, [p(7, 0, 'tree')]);
  assert.equal(free.getState().version, 5);
  assert.equal(free.getState().note.kind, 'synced');

  const second = await setup({ saveFail: [new LayoutError(422, 'LOCKED', { reason: 'support' })] });
  second.tapCell(1, 1);
  await second.settle();
  assert.deepEqual(second.free.getState().pieces, []);
  assert.equal(second.free.getState().note.reason, 'support');
});

test('a save that met no answer is tried once more with the same key', async () => {
  const { free, tapCell, settle, calls } = await setup({ saveFail: [new LayoutError(0, 'OFFLINE')] });
  tapCell(1, 1);
  await settle();
  assert.equal(calls.save.length, 2);
  assert.equal(calls.save[0].key, calls.save[1].key);
  assert.equal(free.getState().version, 1);
});

test('a building put on a plot takes its pieces back; leaving build mode ends free building', async () => {
  const { free, quarter, tapCell, settle } = await setup();
  tapCell(4, 1);
  tapCell(1, 1);
  await settle();
  quarter.getState().pick(1);
  quarter.getState().choose('home');
  free.setState({ on: false });
  await quarter.getState().place();
  assert.deepEqual(free.getState().pieces.map((x) => x.gx), [1], 'the middle plot went to the home');
  free.setState({ on: true });
  quarter.getState().leave();
  assert.equal(free.getState().on, false);
});

test('a layout the world could not read still builds; the save\'s version settles it when the world answers', async () => {
  const { free, tapCell, settle } = await setup();
  free.setState({ status: 'offline' });
  tapCell(1, 1);
  assert.equal(free.getState().pieces.length, 1);
  await settle();
  assert.equal(free.getState().version, 1);
});
