import * as THREE from 'three';
import { chooseLod, LOD_BITS, projectedPixels, type Lod } from '@/city/lib/quarter/kit/lod';
import { MOTIONS, STYLES, type BuildingPlan, type Part, type Rgb } from '@/city/lib/quarter/kit/parts';
import { tierOf, unitGeometry } from './geometry';
import { createGlowMaterial, createKitMaterial, type KitAfar } from './kitMaterial';

/** Floats per instance besides its matrix: tint 3, glow 3, accent 3, look 4, motion 4, the building's place 2. */
const STRIDE = 19;
const LEVELS: readonly Lod[] = [0, 1, 2];
/** Colours that show which level of detail draws a building (development only). */
const DEBUG_TINT: readonly Rgb[] = [
  [0.9, 0.45, 0.05],
  [0.35, 0.12, 0.9],
  [0.6, 0.7, 0.9],
];

type Chunk = { matrices: Float32Array; attrs: Float32Array; count: number };

type Entry = {
  anchor: THREE.Object3D;
  plan: BuildingPlan;
  local: THREE.Matrix4[];
  /** The anchor relative to the instancer's root, as last computed. */
  rel: THREE.Matrix4;
  center: THREE.Vector3;
  radius: number;
  lod: Lod | null;
  chunks: Map<string, Chunk>[];
};

type Pool = { key: string; mesh: THREE.InstancedMesh; capacity: number; attrs: THREE.InstancedInterleavedBuffer };

export type KitStats = { buildings: number; instances: number; pools: number; drawn: number; lods: [number, number, number] };

const scratch = { m: new THREE.Matrix4(), inv: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Vector3() };

const poolKey = (part: Part, lod: Lod) => (part.style === 'pool' ? 'glow' : `${part.shape}:${tierOf(part.shape, lod)}`);

/**
 * Draws every building handed to it with one instanced mesh per unit shape (and one for pooled light), whatever the
 * number of buildings. Each building keeps its parts ready for each level of detail; when a building's size on
 * screen crosses a threshold, only the pools it moves between are rewritten. Nothing is rewritten while the camera
 * moves and no building changes detail.
 */
export class KitInstancer {
  readonly root = new THREE.Group();
  private readonly entries = new Set<Entry>();
  private readonly pools = new Map<string, Pool>();
  private readonly dirty = new Set<string>();
  private solid: THREE.ShaderMaterial | null = null;
  private glow: THREE.ShaderMaterial | null = null;
  private forced: Lod | null = null;
  private debug = false;
  private readonly afar: KitAfar | undefined;

  /** `afar`: how the buildings are seen from far away, shared with the scene that eases it (none: always close up). */
  constructor(afar?: KitAfar) {
    this.root.name = 'kit';
    this.afar = afar;
  }

  /** Draw every building at one level of detail, or null to choose by size on screen. Tint by detail when debugging. */
  configure(forced: Lod | null, debug: boolean): void {
    if (forced === this.forced && debug === this.debug) return;
    this.forced = forced;
    this.debug = debug;
    for (const entry of this.entries) {
      this.fill(entry);
      if (forced !== null) this.setLod(entry, forced);
    }
    for (const key of this.pools.keys()) this.dirty.add(key);
  }

  add(anchor: THREE.Object3D, plan: BuildingPlan): Entry {
    const local = plan.parts.map((part) => {
      scratch.e.set(part.turn[0], part.turn[1], part.turn[2]);
      scratch.q.setFromEuler(scratch.e);
      return new THREE.Matrix4().compose(scratch.p.set(...part.at), scratch.q, scratch.s.set(...part.size));
    });
    const entry: Entry = { anchor, plan, local, rel: new THREE.Matrix4(), center: new THREE.Vector3(), radius: plan.radius, lod: null, chunks: [] };
    this.relate(entry);
    this.fill(entry);
    this.entries.add(entry);
    this.setLod(entry, this.forced ?? 1);
    return entry;
  }

  remove(entry: Entry): void {
    if (!this.entries.delete(entry)) return;
    this.markLod(entry, entry.lod);
  }

  /** Called once a frame: follows moved buildings, picks detail, rewrites the pools that changed. */
  update(camera: THREE.Camera, viewHeight: number): void {
    this.root.updateWorldMatrix(true, false);
    const cam = camera.getWorldPosition(scratch.c);
    const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera) : null;
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera ? (camera as THREE.OrthographicCamera) : null;
    for (const entry of this.entries) {
      if (this.relate(entry)) {
        this.fill(entry);
        this.markLod(entry, entry.lod);
      }
      if (this.forced !== null) continue;
      const world = scratch.p.copy(entry.center).applyMatrix4(this.root.matrixWorld);
      let pixels: number;
      if (perspective) pixels = projectedPixels(entry.radius, world.distanceTo(cam), perspective.fov, viewHeight);
      else if (ortho) pixels = (2 * entry.radius * ortho.zoom * viewHeight) / Math.max(0.001, ortho.top - ortho.bottom);
      else pixels = Infinity;
      this.setLod(entry, chooseLod(pixels, entry.lod));
    }
    if (this.dirty.size) this.rebuild();
  }

  stats(): KitStats {
    const lods: [number, number, number] = [0, 0, 0];
    for (const entry of this.entries) if (entry.lod !== null) lods[entry.lod] += 1;
    let instances = 0;
    let drawn = 0;
    for (const pool of this.pools.values()) {
      instances += pool.mesh.count;
      if (pool.mesh.visible && pool.mesh.count > 0) drawn += 1;
    }
    return { buildings: this.entries.size, instances, pools: this.pools.size, drawn, lods };
  }

  /** Frees the GPU side. The buildings stay registered and are drawn again on the next frame if still mounted. */
  dispose(): void {
    for (const pool of this.pools.values()) {
      this.root.remove(pool.mesh);
      pool.mesh.geometry.dispose();
      pool.mesh.dispose();
    }
    this.pools.clear();
    this.solid?.dispose();
    this.glow?.dispose();
    this.solid = null;
    this.glow = null;
    for (const entry of this.entries) this.markLod(entry, entry.lod);
  }

  /** Recomputes where the anchor stands relative to the root; true when it moved. */
  private relate(entry: Entry): boolean {
    entry.anchor.updateWorldMatrix(true, false);
    scratch.inv.copy(this.root.matrixWorld).invert();
    scratch.m.multiplyMatrices(scratch.inv, entry.anchor.matrixWorld);
    if (scratch.m.equals(entry.rel) && entry.chunks.length) return false;
    entry.rel.copy(scratch.m);
    entry.center.set(...entry.plan.center).applyMatrix4(entry.rel);
    entry.radius = entry.plan.radius * entry.rel.getMaxScaleOnAxis();
    return true;
  }

  /** Builds the instance data of one building for each level of detail. */
  private fill(entry: Entry): void {
    entry.chunks = LEVELS.map((lod) => {
      const bit = LOD_BITS[lod];
      const groups = new Map<string, Part[]>();
      const order = new Map<Part, number>();
      entry.plan.parts.forEach((part, i) => {
        if (!(part.lods & bit)) return;
        const key = poolKey(part, lod);
        const list = groups.get(key) ?? [];
        list.push(part);
        groups.set(key, list);
        order.set(part, i);
      });
      const chunks = new Map<string, Chunk>();
      for (const [key, parts] of groups) {
        const matrices = new Float32Array(parts.length * 16);
        const attrs = new Float32Array(parts.length * STRIDE);
        parts.forEach((part, j) => {
          scratch.m.multiplyMatrices(entry.rel, entry.local[order.get(part)!]!);
          scratch.m.toArray(matrices, j * 16);
          const tint = this.debug && part.style !== 'pool' ? DEBUG_TINT[lod]! : part.tint;
          attrs.set(tint, j * STRIDE);
          attrs.set(part.glow, j * STRIDE + 3);
          attrs.set(part.accent, j * STRIDE + 6);
          attrs.set([STYLES[part.style], part.power, part.grain, (part.phase / 6.283) % 1], j * STRIDE + 9);
          attrs.set([MOTIONS[part.motion], part.speed, part.phase, (part.door ? 1 : 0) + (part.kerb ? 2 : 0)], j * STRIDE + 13);
          // Where the building stands, so the material can grow it about its own place when seen from afar.
          attrs[j * STRIDE + 17] = entry.rel.elements[12]!;
          attrs[j * STRIDE + 18] = entry.rel.elements[14]!;
        });
        chunks.set(key, { matrices, attrs, count: parts.length });
      }
      return chunks;
    });
  }

  private setLod(entry: Entry, lod: Lod): void {
    if (entry.lod === lod) return;
    this.markLod(entry, entry.lod);
    entry.lod = lod;
    this.markLod(entry, lod);
  }

  private markLod(entry: Entry, lod: Lod | null): void {
    if (lod === null) return;
    for (const key of entry.chunks[lod]?.keys() ?? []) this.dirty.add(key);
  }

  private pool(key: string, need: number): Pool {
    let pool = this.pools.get(key);
    if (pool && pool.capacity >= need) return pool;
    const capacity = Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(need, 1))) * (pool ? 2 : 1));
    if (pool) {
      this.root.remove(pool.mesh);
      pool.mesh.geometry.dispose();
      pool.mesh.dispose();
    }
    const [shape, tier] = key === 'glow' ? (['disc', 'hi'] as const) : (key.split(':') as [Part['shape'], 'hi' | 'lo']);
    const unit = unitGeometry(shape, tier);
    const geometry = new THREE.BufferGeometry();
    // Own copies of the shape's vertices, so freeing one pool never pulls buffers from under another.
    for (const name of ['position', 'normal', 'aFace']) geometry.setAttribute(name, (unit.getAttribute(name) as THREE.BufferAttribute).clone());
    const attrs = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * STRIDE), STRIDE, 1);
    attrs.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aTint', new THREE.InterleavedBufferAttribute(attrs, 3, 0));
    geometry.setAttribute('aGlow', new THREE.InterleavedBufferAttribute(attrs, 3, 3));
    geometry.setAttribute('aAccent', new THREE.InterleavedBufferAttribute(attrs, 3, 6));
    geometry.setAttribute('aLook', new THREE.InterleavedBufferAttribute(attrs, 4, 9));
    geometry.setAttribute('aMotion', new THREE.InterleavedBufferAttribute(attrs, 4, 13));
    geometry.setAttribute('aOrigin', new THREE.InterleavedBufferAttribute(attrs, 2, 17));
    geometry.boundingSphere = unit.boundingSphere?.clone() ?? null;
    const glow = key === 'glow';
    if (glow) this.glow ??= createGlowMaterial();
    else this.solid ??= createKitMaterial(this.afar);
    const mesh = new THREE.InstancedMesh(geometry, glow ? this.glow! : this.solid!, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = `kit:${key}`;
    if (glow) mesh.renderOrder = 2;
    mesh.count = 0;
    this.root.add(mesh);
    pool = { key, mesh, capacity, attrs };
    this.pools.set(key, pool);
    return pool;
  }

  private rebuild(): void {
    for (const key of this.dirty) {
      let need = 0;
      for (const entry of this.entries) if (entry.lod !== null) need += entry.chunks[entry.lod]?.get(key)?.count ?? 0;
      if (!need && !this.pools.has(key)) continue;
      const pool = this.pool(key, need);
      const matrices = pool.mesh.instanceMatrix.array as Float32Array;
      const attrs = pool.attrs.array as Float32Array;
      let at = 0;
      for (const entry of this.entries) {
        const chunk = entry.lod === null ? undefined : entry.chunks[entry.lod]?.get(key);
        if (!chunk) continue;
        matrices.set(chunk.matrices, at * 16);
        attrs.set(chunk.attrs, at * STRIDE);
        at += chunk.count;
      }
      pool.mesh.count = at;
      pool.mesh.visible = at > 0;
      pool.mesh.instanceMatrix.clearUpdateRanges();
      pool.mesh.instanceMatrix.addUpdateRange(0, at * 16);
      pool.mesh.instanceMatrix.needsUpdate = true;
      pool.attrs.clearUpdateRanges();
      pool.attrs.addUpdateRange(0, at * STRIDE);
      pool.attrs.needsUpdate = true;
      if (at) pool.mesh.computeBoundingSphere();
    }
    this.dirty.clear();
  }
}
