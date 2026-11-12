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

test("the sign never stands under the Deck, and on an upright phone never off the screen (CITY-243)", async () => {
  const { signOnScreen, SIGN_HALF } = await import("./place.ts");
  const phone = { width: 390, height: 844, deck: { left: 16, right: 374, top: 755 }, edge: true };
  // The eye pass of 11.11: the first frame put the sign at x 838, a drag at 45 × 797 — under the Deck.
  const first = signOnScreen({ x: 838, y: 677 }, phone);
  assert.deepEqual(first, { x: 390 - SIGN_HALF.x, y: 677, side: 1 });
  const dragged = signOnScreen({ x: 45, y: 797 }, phone);
  assert.equal(dragged.side, -1);
  assert.equal(dragged.x, SIGN_HALF.x);
  assert.ok(dragged.y <= 755 - SIGN_HALF.y, `${dragged.y} stands over the Deck`);
  assert.deepEqual(signOnScreen({ x: 200, y: 430 }, phone), { x: 200, y: 430, side: 0 });
  // A desk: the sign stays where its tower is, off the screen too; only over the Deck's own span is it lifted.
  const desk = { width: 1440, height: 900, deck: { left: 390, right: 1050, top: 808 }, edge: false };
  assert.deepEqual(signOnScreen({ x: 1320, y: 611 }, desk), { x: 1320, y: 611, side: 0 });
  assert.deepEqual(signOnScreen({ x: 1600, y: 611 }, desk), { x: 1600, y: 611, side: 0 });
  assert.equal(signOnScreen({ x: 700, y: 860 }, desk).y, 808 - SIGN_HALF.y);
  assert.equal(signOnScreen({ x: 1300, y: 860 }, desk).y, 860);
  assert.deepEqual(signOnScreen({ x: 200, y: 900 }, { ...phone, deck: null }), { x: 200, y: 844 - SIGN_HALF.y, side: 0 });
});
