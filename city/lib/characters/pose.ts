import { DEG, quatFromEulerDeg, quatMultiply, quatNormalize, quatSlerp, type Vec3 } from './math.ts';
import type { Rig } from './rig.ts';

/**
 * A pose: a rotation for every posed bone, how far the hips move from rest, and where each foot stands. Legs are not
 * posed bone by bone — they reach for their feet (`reachLeg`), so a crouch, a stride or a kneel keeps the soles on
 * the ground and two poses blend without the feet sliding through the floor.
 *
 * Feet are in the character's space: x out to the side, y lift above the ground, z forward; then pitch (toes up) and
 * yaw (toes out), both radians. Left first, then right.
 */
export type Pose = { rot: Float32Array; hips: Float32Array; feet: Float32Array };

/** Rest stance: feet a little wider than the hips, toes turned out a touch. */
export const FOOT_REST: FootSpec = [0.25, 0, 0.02, 0, 7];
/** Height of the ankle joint above the sole. */
export const ANKLE = 0.1;

/** A foot as authored: [out to its side, lift, forward, pitch° toes up, yaw° toes out]. */
export type FootSpec = readonly [number, number, number, number?, number?];
export type Angles = Vec3;

/**
 * A pose as authored, in degrees.
 *  - `bones`: centre bones by full name (`chest`, `head`) in three.js 'XYZ' Euler: x pitches forward, y turns toward
 *    the character's left, z leans toward its right.
 *  - `both`, `L`, `R`: paired bones by base name (`upperArm`). Both sides are written as the left side would be — on
 *    either arm z lifts it out sideways and x < 0 swings it forward — and the right side is mirrored.
 *  - `hips`: the root's offset from rest; `feet`: as `FOOT_REST`, the right foot mirrored.
 */
export type PoseSpec = Readonly<{
  hips?: Vec3;
  bones?: Readonly<Record<string, Angles>>;
  both?: Readonly<Record<string, Angles>>;
  L?: Readonly<Record<string, Angles>>;
  R?: Readonly<Record<string, Angles>>;
  feet?: Readonly<{ L?: FootSpec; R?: FootSpec }>;
}>;

export function emptyPose(rig: Rig): Pose {
  const rot = new Float32Array(rig.count * 4);
  for (let i = 0; i < rig.count; i += 1) rot[i * 4 + 3] = 1;
  const feet = new Float32Array(10);
  writeFoot(feet, 0, FOOT_REST, 1);
  writeFoot(feet, 5, FOOT_REST, -1);
  return { rot, hips: new Float32Array(3), feet };
}

function writeFoot(feet: Float32Array, o: number, f: FootSpec, sign: 1 | -1) {
  feet[o] = f[0] * sign;
  feet[o + 1] = f[1];
  feet[o + 2] = f[2];
  feet[o + 3] = (f[3] ?? 0) * DEG;
  feet[o + 4] = (f[4] ?? FOOT_REST[4]!) * DEG * sign;
}

/** Turns an authored pose into numbers. Unknown bone names throw, so a typo cannot silently freeze a limb. */
export function compilePose(rig: Rig, spec: PoseSpec): Pose {
  const pose = emptyPose(rig);
  const set = (name: string, [x, y, z]: Angles) => {
    const i = rig.index[name];
    if (i === undefined || i >= rig.count) throw new Error(`pose: no posed bone ${name}`);
    quatFromEulerDeg(x, y, z, pose.rot, i * 4);
  };
  for (const [name, a] of Object.entries(spec.bones ?? {})) set(name, a);
  for (const [name, a] of Object.entries(spec.both ?? {})) {
    set(`${name}.L`, a);
    set(`${name}.R`, [a[0], -a[1], -a[2]]);
  }
  for (const [name, a] of Object.entries(spec.L ?? {})) set(`${name}.L`, a);
  for (const [name, a] of Object.entries(spec.R ?? {})) set(`${name}.R`, [a[0], -a[1], -a[2]]);
  if (spec.hips) pose.hips.set(spec.hips);
  if (spec.feet?.L) writeFoot(pose.feet, 0, spec.feet.L, 1);
  if (spec.feet?.R) writeFoot(pose.feet, 5, spec.feet.R, -1);
  return pose;
}

/** Lays one authored pose over another: the second's bones, hips and feet win where it names them. */
export function overPose(base: PoseSpec, top: PoseSpec): PoseSpec {
  // A pair named in the top's `both` replaces the base's one-sided values for it too.
  const without = (side: Readonly<Record<string, Angles>> | undefined) =>
    Object.fromEntries(Object.entries(side ?? {}).filter(([name]) => !(top.both && name in top.both)));
  return {
    hips: top.hips ?? base.hips,
    bones: { ...base.bones, ...top.bones },
    both: { ...base.both, ...top.both },
    L: { ...without(base.L), ...top.L },
    R: { ...without(base.R), ...top.R },
    feet: { ...base.feet, ...top.feet },
  };
}

export function copyPose(from: Pose, to: Pose): Pose {
  to.rot.set(from.rot);
  to.hips.set(from.hips);
  to.feet.set(from.feet);
  return to;
}

/** to = a → b at t (slerp per bone). `to` may alias a. */
export function mixPose(a: Pose, b: Pose, t: number, to: Pose): Pose {
  const n = a.rot.length / 4;
  for (let i = 0; i < n; i += 1) quatSlerp(a.rot, i * 4, b.rot, i * 4, t, to.rot, i * 4);
  for (let i = 0; i < 3; i += 1) to.hips[i] = a.hips[i]! + (b.hips[i]! - a.hips[i]!) * t;
  for (let i = 0; i < 10; i += 1) to.feet[i] = a.feet[i]! + (b.feet[i]! - a.feet[i]!) * t;
  return to;
}

const turn = new Float32Array(4);

/** Adds a small rotation (degrees) on top of a bone's current one, in the bone's own frame. */
export function nudge(rig: Rig, pose: Pose, name: string, x: number, y: number, z: number): void {
  const i = rig.index[name];
  if (i === undefined || i >= rig.count) throw new Error(`nudge: no posed bone ${name}`);
  quatFromEulerDeg(x, y, z, turn, 0);
  quatMultiply(pose.rot, i * 4, turn, 0, pose.rot, i * 4);
  quatNormalize(pose.rot, i * 4);
}

/** `nudge` for a pair, written for the left side and mirrored. */
export function nudgeBoth(rig: Rig, pose: Pose, name: string, x: number, y: number, z: number, left = 1, right = 1): void {
  if (left) nudge(rig, pose, `${name}.L`, x * left, y * left, z * left);
  if (right) nudge(rig, pose, `${name}.R`, x * right, -y * right, -z * right);
}
