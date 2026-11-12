import * as THREE from 'three';
import { useCity } from '../city/store.ts';
import { launchOpenHere, useLaunch } from './district.ts';
import { hallAction, type HallBoardId } from './hall.ts';
import { useHall } from './hall-store.ts';

/**
 * A tap on a Hall of Fame sign in the city (CITY-230). The signs stand in the scene as meshes; the city's own tap
 * (`CameraRig`) asks here first whether the ray meets one nearer than the tower it would pick, and a sign met does its
 * board's one action. A sign stands only on a board with a leader (CITY-241), so from the city that is the Hall's panel
 * on that board; `actOnBoard` is the panel's action too, where a board nobody is on opens a launch from the city.
 */

const signs = new Map<HallBoardId, THREE.Object3D>();
const box = new THREE.Box3();
const hit = new THREE.Vector3();

/** A sign tells where it stands while it is drawn; null when it is gone. */
export function placeSign(board: HallBoardId, object: THREE.Object3D | null): void {
  if (object) signs.set(board, object);
  else signs.delete(board);
}

/** The sign under a ray, and how far it stands across the ground from the ray's start; null when none is met. */
export function signUnder(ray: THREE.Ray): Readonly<{ board: HallBoardId; distance: number }> | null {
  let best: { board: HallBoardId; distance: number } | null = null;
  for (const [board, object] of signs) {
    if (!object.visible) continue;
    box.setFromObject(object);
    if (!ray.intersectBox(box, hit)) continue;
    const distance = Math.hypot(hit.x - ray.origin.x, hit.z - ray.origin.z);
    if (!best || distance < best.distance) best = { board, distance };
  }
  return best;
}

/** A board's one action, from its sign or its panel. */
export function actOnBoard(board: HallBoardId): void {
  const hall = useHall.getState();
  const view = hall.view;
  if (!view) return;
  if (hallAction(view.boards[board], launchOpenHere(useLaunch.getState())) === 'launch') {
    hall.close();
    useLaunch.getState().openSheet();
    return;
  }
  useCity.getState().select(null);
  hall.show(board);
}
