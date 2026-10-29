// Run from repo root: node --test city/lib/vault/place.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { clearances, GUARD_SPOT, ISLET_RADIUS, TOWER, VAULT_SPOT, roomView, flightAt, flightMs } = await import("./place.ts");

/** Where the Vault stands, against the island and the newcomers' terrace it must leave alone. */

test("the vault stands on open water: off the island, off the terrace, the guard on its plinth", () => {
  const { shore, terrace } = clearances();
  assert.ok(shore >= 4, `${shore} from the island's shore`);
  assert.ok(terrace >= 8, `${terrace} from the terrace`);
  const guard = Math.hypot(GUARD_SPOT.x - VAULT_SPOT.x, GUARD_SPOT.z - VAULT_SPOT.z);
  assert.ok(guard > TOWER.radius && guard < ISLET_RADIUS, "the guard stands between the door and the edge");
});

test("the room's camera stands back from the islet and above the water, on a laptop and on a phone", () => {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const v = roomView(w, h);
    assert.ok(Math.hypot(v.eye.x - VAULT_SPOT.x, v.eye.z - VAULT_SPOT.z) > ISLET_RADIUS + 10, "the camera stands back from the islet");
    assert.ok(v.eye.y > 2, "and above the water");
  }
});

test("the flight to the door starts and ends where it should and never jumps", () => {
  const from = { eye: { x: 0, y: 38, z: 172 }, target: { x: 0, y: 0, z: 0 } };
  const to = roomView(1440, 900);
  const near = (a, b) => ["eye", "target"].every((k) => ["x", "y", "z"].every((c) => Math.abs(a[k][c] - b[k][c]) < 1e-9));
  assert.ok(near(flightAt(from, to, 0), from), "it starts where the camera was");
  assert.ok(near(flightAt(from, to, 1), to), "and ends at the door");
  for (let t = 0.05; t <= 1; t += 0.05) {
    const a = flightAt(from, to, t - 0.05).eye;
    const b = flightAt(from, to, t).eye;
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < 20, `no jump at ${t.toFixed(2)}`);
  }
  const ms = flightMs(from, to);
  assert.ok(ms >= 1200 && ms <= 2400, `${ms} ms`);
});
