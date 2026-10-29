import {
  affineCompose,
  affineDir,
  affineMultiply,
  affinePoint,
  quatFromColumns,
  quatIdentity,
  quatInvert,
  quatMultiply,
  type Vec3,
} from './math.ts';

/**
 * A skeleton of rigid bones. Every bone's rest rotation is the identity, so a bone's local space at rest is the
 * character's own: +y up, +z the way the character faces, +x its left hand. A bone sits at `at` from its parent.
 * Parts of the body are hard pieces fixed to one bone each (`body.ts`); nothing deforms.
 *
 * Bones whose name ends in `.L` or `.R` come in mirrored pairs (the character is symmetric across x = 0). A few
 * bones are not moved by a pose but placed by a constraint after it — a hydraulic piston from one bone aiming at a
 * point on another — so they stretch across a joint without bending anything.
 */

export type BoneDef = Readonly<{ name: string; parent: string | null; at: Vec3 }>;

/** A piston: a bone at `fromAt` in `from`'s space whose +y aims at `toAt` in `to`'s space. */
export type AimDef = Readonly<{ name: string; from: string; fromAt: Vec3; to: string; toAt: Vec3 }>;

export type Rig = Readonly<{
  names: readonly string[];
  /** Bones a pose moves (the first `count`); aimed bones follow. */
  count: number;
  /** Every bone, aimed ones included: the number of matrices the shader reads. */
  total: number;
  parent: Int16Array;
  rest: Float32Array;
  index: Readonly<Record<string, number>>;
  aims: readonly Readonly<{ bone: number; from: number; fromAt: Vec3; to: number; toAt: Vec3 }>[];
}>;

/** Doubles every definition whose name or parent ends in `.L` into its `.R` mirror. */
export function mirrored(defs: readonly BoneDef[]): BoneDef[] {
  const out: BoneDef[] = [];
  for (const d of defs) {
    out.push(d);
    if (d.name.endsWith('.L')) {
      out.push({ name: d.name.replace(/\.L$/, '.R'), parent: d.parent?.replace(/\.L$/, '.R') ?? null, at: [-d.at[0], d.at[1], d.at[2]] });
    }
  }
  return out;
}

export function mirroredAims(defs: readonly AimDef[]): AimDef[] {
  const flip = (s: string) => s.replace(/\.L$/, '.R');
  const out: AimDef[] = [];
  for (const d of defs) {
    out.push(d);
    if (d.name.endsWith('.L')) {
      out.push({ name: flip(d.name), from: flip(d.from), fromAt: [-d.fromAt[0], d.fromAt[1], d.fromAt[2]], to: flip(d.to), toAt: [-d.toAt[0], d.toAt[1], d.toAt[2]] });
    }
  }
  return out;
}

/** Builds a rig. Parents must come before their children; the first bone is the root. */
export function defineRig(bones: readonly BoneDef[], aims: readonly AimDef[] = []): Rig {
  const names = [...bones.map((b) => b.name), ...aims.map((a) => a.name)];
  const index: Record<string, number> = {};
  names.forEach((n, i) => {
    if (n in index) throw new Error(`bone ${n} twice`);
    index[n] = i;
  });
  const count = bones.length;
  const parent = new Int16Array(names.length).fill(-1);
  const rest = new Float32Array(names.length * 3);
  bones.forEach((b, i) => {
    if (b.parent !== null) {
      const p = index[b.parent];
      if (p === undefined || p >= i) throw new Error(`bone ${b.name}: parent ${b.parent} must come first`);
      parent[i] = p;
    } else if (i !== 0) {
      throw new Error(`bone ${b.name}: only the first bone has no parent`);
    }
    rest.set(b.at, i * 3);
  });
  const resolved = aims.map((a) => {
    const bone = index[a.name]!;
    const from = index[a.from];
    const to = index[a.to];
    if (from === undefined || to === undefined || from >= count || to >= count) throw new Error(`piston ${a.name}: unknown bone`);
    return { bone, from, fromAt: a.fromAt, to, toAt: a.toAt };
  });
  return { names, count, total: names.length, parent, rest, index, aims: resolved };
}

const tmp = new Float64Array(16);
const local = new Float64Array(12);

/**
 * Places every bone: `rot` holds one local rotation per posed bone, `hips` moves the root from its rest place.
 * Writes 12 numbers per bone into `out` (the character-space affine matrix), aimed bones included.
 */
export function solveBones(rig: Rig, rot: Float32Array, hips: ArrayLike<number>, out: Float32Array): void {
  const { count, parent, rest } = rig;
  for (let i = 0; i < count; i += 1) {
    const p = parent[i]!;
    let x = rest[i * 3]!;
    let y = rest[i * 3 + 1]!;
    let z = rest[i * 3 + 2]!;
    if (p < 0) {
      x += hips[0]!;
      y += hips[1]!;
      z += hips[2]!;
      affineCompose(rot, i * 4, x, y, z, out, i * 12);
    } else {
      affineCompose(rot, i * 4, x, y, z, local, 0);
      affineMultiply(out, p * 12, local, 0, tmp, 0);
      for (let k = 0; k < 12; k += 1) out[i * 12 + k] = tmp[k]!;
    }
  }
}

const a = new Float64Array(3);
const b = new Float64Array(3);
const side = new Float64Array(3);

/** Places the aimed bones (pistons) once the posed bones are placed. */
export function solveAims(rig: Rig, out: Float32Array): void {
  for (const aim of rig.aims) {
    affinePoint(out, aim.from * 12, aim.fromAt[0], aim.fromAt[1], aim.fromAt[2], a);
    affinePoint(out, aim.to * 12, aim.toAt[0], aim.toAt[1], aim.toAt[2], b);
    // +y from the anchor to the target; roll fixed by the anchor bone's x axis, so a piston never spins about itself.
    let yx = b[0]! - a[0]!, yy = b[1]! - a[1]!, yz = b[2]! - a[2]!;
    const len = Math.hypot(yx, yy, yz) || 1;
    yx /= len;
    yy /= len;
    yz /= len;
    affineDir(out, aim.from * 12, 1, 0, 0, side);
    // z = side × y, x = y × z.
    let zx = side[1]! * yz - side[2]! * yy;
    let zy = side[2]! * yx - side[0]! * yz;
    let zz = side[0]! * yy - side[1]! * yx;
    const zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl;
    zy /= zl;
    zz /= zl;
    const xx = yy * zz - yz * zy;
    const xy = yz * zx - yx * zz;
    const xz = yx * zy - yy * zx;
    const o = aim.bone * 12;
    out[o] = xx;
    out[o + 1] = yx;
    out[o + 2] = zx;
    out[o + 3] = a[0]!;
    out[o + 4] = xy;
    out[o + 5] = yy;
    out[o + 6] = zy;
    out[o + 7] = a[1]!;
    out[o + 8] = xz;
    out[o + 9] = yz;
    out[o + 10] = zz;
    out[o + 11] = a[2]!;
  }
}

const hip = new Float64Array(3);
const fwd = new Float64Array(3);
const q = new Float64Array(4);
const qi = new Float64Array(4);
const qw = new Float64Array(4);

/**
 * Two-bone leg reach: turns `thigh` and `shin` so the ankle (the start of `foot`) lands on `target`, the knee bending
 * toward the root's forward, and sets the foot level with the ground turned by `pitch` (toes up) and `yaw` (toes out)
 * in radians. Reads the parent's placement from `mats` (already solved) and writes the three local rotations into
 * `rot`. A target out of reach is approached along the same line.
 */
export function reachLeg(
  rig: Rig,
  mats: Float32Array,
  rot: Float32Array,
  thigh: number,
  shin: number,
  foot: number,
  target: ArrayLike<number>,
  pitch: number,
  yaw: number,
): void {
  const p = rig.parent[thigh]!;
  const l1 = Math.hypot(rig.rest[shin * 3]!, rig.rest[shin * 3 + 1]!, rig.rest[shin * 3 + 2]!);
  const l2 = Math.hypot(rig.rest[foot * 3]!, rig.rest[foot * 3 + 1]!, rig.rest[foot * 3 + 2]!);
  affinePoint(mats, p * 12, rig.rest[thigh * 3]!, rig.rest[thigh * 3 + 1]!, rig.rest[thigh * 3 + 2]!, hip);
  // The knee bends toward where the root faces, flattened onto the ground.
  affineDir(mats, 0, 0, 0, 1, fwd);
  let fx = fwd[0]!, fz = fwd[2]!;
  const fl = Math.hypot(fx, fz) || 1;
  fx /= fl;
  fz /= fl;

  let dx = target[0]! - hip[0]!, dy = target[1]! - hip[1]!, dz = target[2]! - hip[2]!;
  let d = Math.hypot(dx, dy, dz) || 1e-6;
  dx /= d;
  dy /= d;
  dz /= d;
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
  // The bend direction: forward with its part along the leg removed.
  const along = fx * dx + fz * dz;
  let bx = fx - along * dx, by = -along * dy, bz = fz - along * dz;
  let bl = Math.hypot(bx, by, bz);
  if (bl < 1e-4) {
    // Forward lies along the leg (a foot straight ahead at hip height): bend down instead.
    bx = 0;
    by = -1;
    bz = 0;
    bl = 1;
  }
  bx /= bl;
  by /= bl;
  bz /= bl;
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const kx = hip[0]! + dx * cosA * l1 + bx * sinA * l1;
  const ky = hip[1]! + dy * cosA * l1 + by * sinA * l1;
  const kz = hip[2]! + dz * cosA * l1 + bz * sinA * l1;
  const ax = hip[0]! + dx * d, ay = hip[1]! + dy * d, az = hip[2]! + dz * d;

  // Thigh: +y from the knee up to the hip, z toward the bend.
  segmentRotation(hip[0]! - kx, hip[1]! - ky, hip[2]! - kz, bx, by, bz, qw);
  toLocal(mats, p, qw, rot, thigh);
  // Shin: +y from the ankle up to the knee.
  segmentRotation(kx - ax, ky - ay, kz - az, bx, by, bz, q);
  // Its parent (the thigh) now has rotation qw in character space.
  quatInvert(qw, 0, qi, 0);
  quatMultiply(qi, 0, q, 0, rot, shin * 4);
  // Foot: level, turned out by yaw about the root's up, toes lifted by pitch.
  const heading = Math.atan2(fx, fz) + yaw;
  const cy = Math.cos(heading / 2), sy = Math.sin(heading / 2);
  const cp = Math.cos(-pitch / 2), sp = Math.sin(-pitch / 2);
  // q(foot) = yaw about y · pitch about x.
  const fq = [cy * sp, sy * cp, -sy * sp, cy * cp];
  quatInvert(q, 0, qi, 0);
  quatMultiply(qi, 0, fq, 0, rot, foot * 4);
}

/** The rotation whose +y points along (yx, yy, yz) and whose +z leans toward (bx, by, bz). */
function segmentRotation(yx: number, yy: number, yz: number, bx: number, by: number, bz: number, out: Float64Array): void {
  const yl = Math.hypot(yx, yy, yz) || 1;
  yx /= yl;
  yy /= yl;
  yz /= yl;
  const dot = bx * yx + by * yy + bz * yz;
  let zx = bx - dot * yx, zy = by - dot * yy, zz = bz - dot * yz;
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl;
  zy /= zl;
  zz /= zl;
  const xx = yy * zz - yz * zy;
  const xy = yz * zx - yx * zz;
  const xz = yx * zy - yy * zx;
  quatFromColumns(xx, xy, xz, yx, yy, yz, zx, zy, zz, out, 0);
}

const pq = new Float64Array(4);

/** Writes `world` (a character-space rotation) as bone `bone`'s rotation relative to its parent `p`. */
function toLocal(mats: Float32Array, p: number, world: Float64Array, rot: Float32Array, bone: number): void {
  if (p < 0) {
    rot.set(world, bone * 4);
    return;
  }
  // The parent's rotation from its matrix.
  const o = p * 12;
  quatFromColumns(mats[o]!, mats[o + 4]!, mats[o + 8]!, mats[o + 1]!, mats[o + 5]!, mats[o + 9]!, mats[o + 2]!, mats[o + 6]!, mats[o + 10]!, pq, 0);
  quatInvert(pq, 0, qi, 0);
  quatMultiply(qi, 0, world, 0, rot, bone * 4);
}

/** Every bone at rest. */
export function restRotations(rig: Rig): Float32Array {
  const rot = new Float32Array(rig.count * 4);
  for (let i = 0; i < rig.count; i += 1) quatIdentity(rot, i * 4);
  return rot;
}
