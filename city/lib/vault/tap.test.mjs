import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { placeVault, vaultUnder } from "./tap.ts";
import { GUARD_SPOT, ISLET_RADIUS, TOWER, VAULT_SPOT } from "./place.ts";

/*
 * CITY-241: the Vault's tower opens its room from the city. The city's tap meets the tower's own body — a finger's
 * slack around its armour — never the whole islet, and only while the tower stands in the scene.
 */

const EYE = new THREE.Vector3(0, 44, 182);
const toward = (x, y, z) => new THREE.Ray(EYE.clone(), new THREE.Vector3(x, y, z).sub(EYE).normalize());

test("no tower in the scene: no tap on it", () => {
  placeVault(false);
  assert.equal(vaultUnder(toward(VAULT_SPOT.x, 10, VAULT_SPOT.z)), null);
});

test("the tower's body takes the tap, with how far it stands across the ground", () => {
  placeVault(true);
  const met = vaultUnder(toward(VAULT_SPOT.x, 10, VAULT_SPOT.z));
  assert.ok(met, "the tower's middle");
  const ground = Math.hypot(VAULT_SPOT.x - EYE.x, VAULT_SPOT.z - EYE.z);
  assert.ok(met.distance < ground && met.distance > ground - TOWER.radius * 2, `${met.distance} vs ${ground}`);
  placeVault(false);
});

test("the guard beside the door takes the tap too", () => {
  placeVault(true);
  assert.ok(vaultUnder(toward(GUARD_SPOT.x, GUARD_SPOT.y + 2, GUARD_SPOT.z)));
  placeVault(false);
});

test("the islet's water edge and the city behind it are not the tower", () => {
  placeVault(true);
  // A point on the plinth's edge toward the city, outside the tower's reach: the ray passes beside the tower. The old
  // tap took the whole islet's box, and this point with it.
  assert.equal(vaultUnder(toward(VAULT_SPOT.x - ISLET_RADIUS + 0.3, 0.3, VAULT_SPOT.z)), null);
  assert.equal(vaultUnder(toward(0, 20, 0)), null);
  placeVault(false);
});
