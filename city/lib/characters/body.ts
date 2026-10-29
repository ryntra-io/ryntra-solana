import { DEG, type Vec3 } from './math.ts';
import type { Rig } from './rig.ts';

/**
 * A body is a list of hard parts, each a simple shape fixed to one bone — plates, joints, lights — so the character is
 * a machine of separate armoured pieces: nothing stretches, there is no skin. Plain numbers only; the renderer builds
 * the meshes (`city/components/characters/geometry.ts`) and merges every part of one detail level into one draw call.
 */

/** Surfaces the body shader knows (`city/components/characters/bodyMaterial.ts`). The number is what it switches on. */
export const MATS = {
  /** Painted gunmetal armour with worn edges. */
  armor: 0,
  /** Carbon-fibre weave under a clear coat. */
  carbon: 1,
  /** Bright machined steel: joints, piston rods, fingertips. */
  steel: 2,
  /** Dark rubber and the inner workings between plates. */
  rubber: 3,
  /** Old bronze trim — the vault's gold, never a light. */
  bronze: 4,
  /** Light seams on the armour (state-driven). */
  seam: 5,
  /** The chest core (state-driven). */
  core: 6,
  /** The visor: dark glass the face is drawn on. */
  visor: 7,
  /** The alarm beacon: dark red glass until an alarm. */
  beacon: 8,
  /** Exhaust vents: a warm glow inside. */
  vent: 9,
  /** White ceramic shell, glossy (the sleek guardian's plates). */
  shell: 10,
  /** Black glass: the sleek guardian's helmet and the body between its plates. */
  gloss: 11,
} as const;
export type Mat = keyof typeof MATS;

/** Detail levels a part is drawn at: hero (close up), standard (the street), crowd (far). The impostor is a picture. */
export const HERO = 1;
export const STANDARD = 2;
export const CROWD = 4;

export type Shape =
  /** A box with rounded edges, `size` at its bottom; `top` gives width and depth at the top (a taper), `lean` moves the top forward. */
  | Readonly<{ kind: 'box'; size: Vec3; radius?: number; top?: readonly [number, number]; lean?: number }>
  /** A cylinder along y (or x / z); `r2` is the bottom radius when it differs from the top; `sides` fixes its facets. */
  | Readonly<{ kind: 'cyl'; r: number; r2?: number; h: number; axis?: 'x' | 'y' | 'z'; sides?: number }>
  /** A sphere, or with `cap` (degrees from the top) a dome closed by a flat floor; `sides` and `rings` fix its facets. */
  | Readonly<{ kind: 'ball'; r: number; cap?: number; sides?: number; rings?: number }>
  /** A ring flat in the xz plane: radius and tube; `sides` fixes how many straight pieces go round. */
  | Readonly<{ kind: 'ring'; r: number; tube: number; sides?: number }>
  /** A curved panel facing +z (the visor): radius of the curve, height and the arc in degrees. */
  | Readonly<{ kind: 'panel'; r: number; h: number; arc: number }>;

export type PartSpec = Readonly<{
  bone: string;
  shape: Shape;
  /** Where the shape's centre sits in the bone's space. */
  at: Vec3;
  /** Rotation in degrees, three.js 'XYZ'. */
  turn?: Vec3;
  /** An offset along the part's own turned axes, after the turn (a cap on top of a tilted stack). */
  local?: Vec3;
  /** A rotation (degrees) of the shape itself before `local` and `turn`: a crest segment tilted along a curved shell. */
  pre?: Vec3;
  /** A stretch of the shape (an oval dome). */
  scale?: Vec3;
  mat: Mat;
  /** Mask of HERO, STANDARD and CROWD; by default hero and standard. */
  lods?: number;
  /** Also draw the mirror image on the other side (always for parts on a `.L` bone). */
  mirror?: boolean;
  /** Faceted: each face lit flat, for hard angular armour. */
  flat?: boolean;
}>;

/** A part placed: its mirror twin expanded, its bone resolved. */
export type Part = PartSpec & Readonly<{ boneIndex: number; mirrored: boolean }>;

/** Expands mirrored parts. Parts on `.L` bones get a `.R` twin; centre parts with `mirror: true` get one at −x. */
export function placeParts(rig: Rig, specs: readonly PartSpec[]): Part[] {
  const out: Part[] = [];
  for (const spec of specs) {
    const boneIndex = rig.index[spec.bone];
    if (boneIndex === undefined) throw new Error(`part on unknown bone ${spec.bone}`);
    out.push({ ...spec, boneIndex, mirrored: false });
    const sided = spec.bone.endsWith('.L');
    if (sided || spec.mirror) {
      const bone = sided ? spec.bone.replace(/\.L$/, '.R') : spec.bone;
      const twin = rig.index[bone];
      if (twin === undefined) throw new Error(`no mirror bone ${bone}`);
      out.push({ ...spec, bone, boneIndex: twin, mirrored: true });
    }
  }
  return out;
}

/** The parts drawn at a detail level. */
export const partsAt = (parts: readonly Part[], lod: number) => parts.filter((p) => ((p.lods ?? HERO | STANDARD) & lod) !== 0);

/** The shape's own extent before any turn: half-sizes along x, y, z. */
export function halfExtent(shape: Shape): Vec3 {
  switch (shape.kind) {
    case 'box': {
      const [w, h, d] = shape.size;
      const [tw, td] = shape.top ?? [w, d];
      return [Math.max(w, tw) / 2, h / 2, Math.max(d, td) / 2 + Math.abs(shape.lean ?? 0) / 2];
    }
    case 'cyl': {
      const r = Math.max(shape.r, shape.r2 ?? shape.r);
      const axis = shape.axis ?? 'y';
      return axis === 'x' ? [shape.h / 2, r, r] : axis === 'z' ? [r, r, shape.h / 2] : [r, shape.h / 2, r];
    }
    case 'ball':
      return [shape.r, shape.r, shape.r];
    case 'ring':
      return [shape.r + shape.tube, shape.tube, shape.r + shape.tube];
    case 'panel': {
      const half = (shape.arc * DEG) / 2;
      return [shape.r * Math.sin(half), shape.h / 2, (shape.r * (1 - Math.cos(half))) / 2];
    }
  }
}

/**
 * Rough bounds of a body at rest in the character's space, from each part's box through its turn (rest bones are
 * not rotated, so a bone's place is the sum of its offsets). For checks and framing, not for drawing.
 */
export function restBounds(rig: Rig, parts: readonly Part[]): { min: [number, number, number]; max: [number, number, number] } {
  const place = new Float64Array(rig.total * 3);
  for (let i = 0; i < rig.count; i += 1) {
    const p = rig.parent[i]!;
    for (let k = 0; k < 3; k += 1) place[i * 3 + k] = rig.rest[i * 3 + k]! + (p >= 0 ? place[p * 3 + k]! : 0);
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    if (part.boneIndex >= rig.count) continue;
    const [hx, hy, hz] = halfExtent(part.shape);
    const [sx, sy, sz] = part.scale ?? [1, 1, 1];
    const m = turnMatrix(part.turn ?? [0, 0, 0]);
    const pre = turnMatrix(part.pre ?? [0, 0, 0]);
    const [lx, ly, lz] = part.local ?? [0, 0, 0];
    for (let c = 0; c < 8; c += 1) {
      const x0 = (c & 1 ? hx : -hx) * sx;
      const y0 = (c & 2 ? hy : -hy) * sy;
      const z0 = (c & 4 ? hz : -hz) * sz;
      const x = pre[0]! * x0 + pre[1]! * y0 + pre[2]! * z0 + lx;
      const y = pre[3]! * x0 + pre[4]! * y0 + pre[5]! * z0 + ly;
      const z = pre[6]! * x0 + pre[7]! * y0 + pre[8]! * z0 + lz;
      let px = m[0]! * x + m[1]! * y + m[2]! * z + part.at[0];
      const py = m[3]! * x + m[4]! * y + m[5]! * z + part.at[1];
      const pz = m[6]! * x + m[7]! * y + m[8]! * z + part.at[2];
      if (part.mirrored) px = -px;
      const b = part.boneIndex * 3;
      const q = [px + place[b]!, py + place[b + 1]!, pz + place[b + 2]!];
      for (let k = 0; k < 3; k += 1) {
        min[k] = Math.min(min[k]!, q[k]!);
        max[k] = Math.max(max[k]!, q[k]!);
      }
    }
  }
  return { min, max };
}

/** Row-major 3×3 rotation for three.js 'XYZ' Euler angles in degrees (R = Rx · Ry · Rz). */
export function turnMatrix([x, y, z]: Vec3): number[] {
  const a = Math.cos(x * DEG), b = Math.sin(x * DEG);
  const c = Math.cos(y * DEG), d = Math.sin(y * DEG);
  const e = Math.cos(z * DEG), f = Math.sin(z * DEG);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return [c * e, -c * f, d, af + be * d, ae - bf * d, -b * c, bf - ae * d, be + af * d, a * c];
}
