import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CROWD, HERO, MATS, partsAt, type Part, type Shape } from '@/city/lib/characters/body';
import { DEG } from '@/city/lib/characters/math';

/**
 * Builds a body's parts into one geometry per detail level: every vertex carries its bone and its surface (`aPart`),
 * and the body shader places it with its bone's matrix — one draw call for the whole character, every piece rigid.
 * Geometry is built once per body and level and shared by every character of that kind.
 */

type Level = typeof HERO | typeof CROWD | number;

/** Rounded corners, curve segments and ring sides by detail level. */
function detail(level: Level) {
  if (level === HERO) return { bevel: 2, radial: 22, sphere: [26, 16] as const, tube: [8, 40] as const };
  if (level === CROWD) return { bevel: 0, radial: 8, sphere: [8, 5] as const, tube: [4, 10] as const };
  return { bevel: 1, radial: 12, sphere: [14, 9] as const, tube: [5, 20] as const };
}

function shapeGeometry(shape: Shape, level: Level): THREE.BufferGeometry {
  const d = detail(level);
  switch (shape.kind) {
    case 'box': {
      const [w, h, depth] = shape.size;
      const r = shape.radius ?? 0;
      // Small rounds lose their bevel a level earlier; the crowd has none.
      const segs = r <= 0 ? 0 : level === HERO ? (r >= 0.035 ? 2 : 1) : level === CROWD ? 0 : r >= 0.02 ? 1 : 0;
      const g = segs > 0 ? new RoundedBoxGeometry(w, h, depth, segs, r) : new THREE.BoxGeometry(w, h, depth);
      if (shape.top || shape.lean) taper(g, w, h, depth, shape.top ?? [w, depth], shape.lean ?? 0);
      return g;
    }
    case 'cyl': {
      const g = new THREE.CylinderGeometry(shape.r, shape.r2 ?? shape.r, shape.h, shape.sides ?? d.radial, 1, false);
      if (shape.axis === 'x') g.rotateZ(Math.PI / 2);
      if (shape.axis === 'z') g.rotateX(Math.PI / 2);
      return g;
    }
    case 'ball': {
      const sides = shape.sides ?? d.sphere[0];
      if (shape.cap === undefined) return new THREE.SphereGeometry(shape.r, sides, shape.rings ?? d.sphere[1]);
      const theta = shape.cap * DEG;
      const dome = new THREE.SphereGeometry(shape.r, sides, shape.rings ?? Math.max(3, Math.round((d.sphere[1] * shape.cap) / 180)), 0, Math.PI * 2, 0, theta);
      // A floor under the dome, so it reads solid from below.
      const floor = new THREE.CircleGeometry(shape.r * Math.sin(theta), sides);
      floor.rotateX(Math.PI / 2);
      floor.translate(0, shape.r * Math.cos(theta), 0);
      return mergeGeometries([dome, floor])!;
    }
    case 'ring': {
      const g = new THREE.TorusGeometry(shape.r, shape.tube, d.tube[0], shape.sides ?? d.tube[1]);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case 'panel':
      return new THREE.CylinderGeometry(shape.r, shape.r, shape.h, level === CROWD ? 6 : 24, 1, true, (-shape.arc / 2) * DEG, shape.arc * DEG);
  }
}

/**
 * Narrows (or widens) a box toward its top and leans the top forward, fixing the normals with the inverse
 * transpose of the stretch so light still falls right on the slanted sides.
 */
function taper(g: THREE.BufferGeometry, w: number, h: number, depth: number, [tw, td]: readonly [number, number], lean: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const ax = (tw / w - 1) / h; // d(scale x)/dy
  const az = (td / depth - 1) / h;
  const c = lean / h;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = y + h / 2;
    const sx = 1 + ax * k;
    const sz = 1 + az * k;
    pos.setXYZ(i, x * sx, y, z * sz + c * k);
    // n' solves Jᵀ n' = n for J = ∂(x·sx, y, z·sz + c·k)/∂(x, y, z).
    const nx = nor.getX(i) / sx;
    const nz = nor.getZ(i) / sz;
    const ny = nor.getY(i) - x * ax * nx - (z * az + c) * nz;
    const len = Math.hypot(nx, ny, nz) || 1;
    nor.setXYZ(i, nx / len, ny / len, nz / len);
  }
}

const turn = new THREE.Euler();
const m = new THREE.Matrix4();
const mirror = new THREE.Matrix4().makeScale(-1, 1, 1);

function partGeometry(part: Part, level: Level): THREE.BufferGeometry {
  let g = shapeGeometry(part.shape, level);
  if (part.flat) {
    // One normal per face: crisp facets.
    g = g.index ? g.toNonIndexed() : g;
    g.computeVertexNormals();
  }
  // Rounded boxes come unindexed; give them a plain index so every part merges alike.
  if (!g.index) g.setIndex(Array.from({ length: g.attributes.position!.count }, (_, i) => i));
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  if (part.scale) g.scale(...part.scale);
  if (part.pre) g.applyMatrix4(m.makeRotationFromEuler(turn.set(part.pre[0] * DEG, part.pre[1] * DEG, part.pre[2] * DEG, 'XYZ')));
  if (part.local) g.translate(...part.local);
  if (part.turn) g.applyMatrix4(m.makeRotationFromEuler(turn.set(part.turn[0] * DEG, part.turn[1] * DEG, part.turn[2] * DEG, 'XYZ')));
  g.translate(...part.at);
  if (part.mirrored) {
    g.applyMatrix4(mirror);
    // A mirror turns every triangle inside out: swap two corners of each.
    const index = g.index!.array as Uint16Array | Uint32Array;
    for (let t = 0; t < index.length; t += 3) {
      const tmp = index[t + 1]!;
      index[t + 1] = index[t + 2]!;
      index[t + 2] = tmp;
    }
  }
  const tag = new Float32Array(g.attributes.position!.count * 2);
  for (let i = 0; i < tag.length; i += 2) {
    tag[i] = part.boneIndex;
    tag[i + 1] = MATS[part.mat];
  }
  g.setAttribute('aPart', new THREE.BufferAttribute(tag, 2));
  return g;
}

/** Every part of a level as one geometry, with bounds wide enough for any pose. */
export function buildBody(parts: readonly Part[], level: Level, bounds: THREE.Sphere): THREE.BufferGeometry {
  const pieces = partsAt(parts, level).map((p) => partGeometry(p, level));
  const merged = mergeGeometries(pieces)!;
  for (const p of pieces) p.dispose();
  merged.boundingSphere = bounds.clone();
  merged.boundingBox = new THREE.Box3().setFromCenterAndSize(bounds.center, new THREE.Vector3().setScalar(bounds.radius * 2));
  return merged;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** The shared geometry of `key`'s body at a level (built on first use). */
export function bodyGeometry(key: string, parts: readonly Part[], level: Level, bounds: THREE.Sphere): THREE.BufferGeometry {
  const id = `${key}:${level}`;
  let g = cache.get(id);
  if (!g) {
    g = buildBody(parts, level, bounds);
    cache.set(id, g);
  }
  return g;
}
