import * as THREE from 'three';
import type { PlacedTower } from '@/city/lib/city/layout';
import { moduleGeometry, releaseModule, restoreModule, type Kit } from './kit';
import { KIT_FLOOR, modulesOf, planTower, type Lod, type TowerPlan } from './plan';
import { createSkylineMaterial } from './skylineMaterial';
import type { Budget } from '@/city/lib/city/quality';
import { lodFor } from './lod';

/** Floats per instance besides the matrix: aTower 1, aFloor 3. */
type Entry = { tower: number; lod: Lod; matrix: Float32Array; floor: [number, number, number] };
type Pool = { name: string; mesh: THREE.InstancedMesh; entries: Entry[]; tower: THREE.InstancedBufferAttribute; floor: THREE.InstancedBufferAttribute };

export type SkylineStats = { towers: number; instances: number; drawn: number; meshes: number; lods: [number, number, number, number]; bytes: number };

export type Skyline = {
  group: THREE.Group;
  material: THREE.ShaderMaterial;
  plans: TowerPlan[];
  /** Picks every tower's level of detail for this camera and rewrites only the pools whose towers changed. */
  update: (camera: THREE.PerspectiveCamera, heightPx: number, budget: Budget) => void;
  /** Every tower at one level (the reflection capture draws the far ones), or back to the camera's choice (null). */
  force: (lod: Lod | null) => void;
  stats: () => SkylineStats;
  /** Frees the GPU side; restore takes it back (React may run an effect's cleanup and then the effect again). */
  dispose: () => void;
  restore: () => void;
};

const NO_FINS = (name: string) => name.startsWith('section.') || name.startsWith('block.') || name.endsWith('.1') || name === 'floor.scaffold.0';

/**
 * The skyline from the kit: one instanced mesh per module, every module of every tower an instance of it, all with
 * one material. The geometry stays the kit's (shared attributes, nothing copied); per instance there is a matrix,
 * the tower's index (its state, `state.ts`) and the floors it covers.
 */
export function buildSkyline(kit: Kit, towers: readonly PlacedTower[]): Skyline {
  const plans = towers.map((t) => planTower(t, kit.floors));
  const material = createSkylineMaterial();
  const group = new THREE.Group();
  group.name = 'skyline';
  const missing = modulesOf(plans).filter((n) => !kit.geometries.has(n));
  if (missing.length) console.warn('city kit: modules missing', missing);

  // Every placement of every level, as its instance data.
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const byModule = new Map<string, Entry[]>();
  plans.forEach((plan, i) => {
    const t = towers[i]!;
    // Fronts face out from the Sol Spire, the way the streets run.
    q.setFromAxisAngle(up, t.x === 0 && t.z === 0 ? 0 : Math.atan2(t.x, t.z));
    plan.lods.forEach((list, lod) => {
      for (const pl of list) {
        if (!kit.geometries.has(pl.mesh)) continue;
        const floors = kit.floors[pl.mesh] ?? 1;
        m.compose(p.set(t.x, pl.y, t.z), q, s.set(pl.scale, pl.h / (floors * KIT_FLOOR), pl.scale));
        const entry: Entry = { tower: i, lod: lod as Lod, matrix: new Float32Array(m.elements), floor: [pl.floor0, pl.floors, NO_FINS(pl.mesh) ? 1 : 0] };
        const list2 = byModule.get(pl.mesh) ?? [];
        list2.push(entry);
        byModule.set(pl.mesh, list2);
      }
    });
  });

  const pools: Pool[] = [];
  const poolsOfTower: Set<Pool>[] = towers.map(() => new Set());
  for (const [name, entries] of byModule) {
    const source = kit.geometries.get(name)!;
    const geometry = moduleGeometry(source);
    // The most instances this pool can hold at once: every tower at its fullest level for this module.
    const perTower = new Map<number, number[]>();
    for (const e of entries) {
      const counts = perTower.get(e.tower) ?? [0, 0, 0, 0];
      counts[e.lod]! += 1;
      perTower.set(e.tower, counts);
    }
    let capacity = 0;
    for (const counts of perTower.values()) capacity += Math.max(...counts);
    const tower = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    const floor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aTower', tower);
    geometry.setAttribute('aFloor', floor);
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.name = name;
    group.add(mesh);
    const pool: Pool = { name, mesh, entries, tower, floor };
    pools.push(pool);
    for (const e of entries) poolsOfTower[e.tower]!.add(pool);
  }

  const lodOf = new Int8Array(towers.length).fill(-1);
  let forced: Lod | null = null;
  const dirty = new Set<Pool>(pools);

  const rewrite = (pool: Pool) => {
    let n = 0;
    const mats = pool.mesh.instanceMatrix.array as Float32Array;
    const tw = pool.tower.array as Float32Array;
    const fl = pool.floor.array as Float32Array;
    for (const e of pool.entries) {
      const lod = forced ?? lodOf[e.tower]!;
      if (e.lod !== lod) continue;
      mats.set(e.matrix, n * 16);
      tw[n] = e.tower;
      fl[n * 3] = e.floor[0];
      fl[n * 3 + 1] = e.floor[1];
      fl[n * 3 + 2] = e.floor[2];
      n += 1;
    }
    pool.mesh.count = n;
    pool.mesh.visible = n > 0;
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.tower.needsUpdate = true;
    pool.floor.needsUpdate = true;
  };

  const centre = new THREE.Vector3();
  const update: Skyline['update'] = (camera, heightPx, budget) => {
    const focal = heightPx / (2 * Math.tan((camera.fov * Math.PI) / 360));
    towers.forEach((t, i) => {
      // The nearest point of the tower's axis to the eye: a storey there is the biggest the tower shows.
      centre.set(t.x, Math.min(Math.max(camera.position.y, 0), t.height), t.z);
      const d = Math.max(camera.position.distanceTo(centre) - t.width, 1);
      const pixels = (plans[i]!.storey / d) * focal;
      const next = lodFor(pixels, lodOf[i]!, budget.lod);
      if (next === lodOf[i]) return;
      lodOf[i] = next;
      for (const pool of poolsOfTower[i]!) dirty.add(pool);
    });
    if (!dirty.size) return;
    for (const pool of dirty) rewrite(pool);
    dirty.clear();
  };

  const force: Skyline['force'] = (lod) => {
    forced = lod;
    for (const pool of pools) rewrite(pool);
  };

  const stats = (): SkylineStats => {
    const lods: [number, number, number, number] = [0, 0, 0, 0];
    for (const l of lodOf) if (l >= 0) lods[l]! += 1;
    let instances = 0;
    let drawn = 0;
    let bytes = 0;
    for (const pool of pools) {
      instances += pool.mesh.count;
      drawn += pool.mesh.visible ? 1 : 0;
      bytes += pool.mesh.instanceMatrix.array.byteLength + pool.tower.array.byteLength + pool.floor.array.byteLength;
    }
    return { towers: towers.length, instances, drawn, meshes: pools.length, lods, bytes };
  };

  return {
    group,
    material,
    plans,
    update,
    force,
    stats,
    restore: () => {
      for (const pool of pools) restoreModule(pool.mesh.geometry);
    },
    dispose: () => {
      for (const pool of pools) {
        pool.mesh.dispose();
        releaseModule(pool.mesh.geometry);
      }
      material.dispose();
    },
  };
}
