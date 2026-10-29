import { CHANNEL_COUNT, expression, mixExpression, type ExpressionSpec } from './expression.ts';
import { compilePose, copyPose, mixPose, overPose, type Pose, type PoseSpec } from './pose.ts';
import type { Rig } from './rig.ts';

/**
 * An animation as code: key poses in time, each with its face, eased into one another — plus, where a body needs
 * it, a little procedural life on top (breath, a shake, servo tremor). A clip can loop whole, loop a section after an
 * intro, or play once; a reaction played and held loops its `hold` section until something else plays.
 */

export type Ease = 'smooth' | 'linear' | 'in' | 'out' | 'back' | 'snap' | 'hold';

export type KeySpec = Readonly<{
  at: number;
  /** Laid over the clip's `base`. Omitted: the previous key's pose holds. */
  pose?: PoseSpec;
  /** Laid over the previous key's face. */
  face?: ExpressionSpec;
  /** How the move into this key runs. */
  ease?: Ease;
}>;

export type ClipEvent = Readonly<{ at: number; kind: ClipEventKind }>;
/** Things that happen at a moment of a clip, for sound and dust: a foot lands, sparks fly, a burst of light. */
export type ClipEventKind = 'stomp.L' | 'stomp.R' | 'sparks' | 'burst' | 'clank';

/** Procedural layer: `t` is the clip's own time; it may add to the pose and the face. */
export type Wobble = (t: number, pose: Pose, face: Float32Array, rig: Rig) => void;
/** A clip computed from scratch each frame (locomotion): `stride` 0 … 1 is how long the steps are. */
export type Procedure = (t: number, pose: Pose, face: Float32Array, rig: Rig, ctx: { stride: number }) => void;

export type ClipSpec = Readonly<{
  name: string;
  duration: number;
  /** true: the whole clip repeats; [from, to]: plays the intro once, then repeats this section. */
  loop?: boolean | readonly [number, number];
  /** The section a held reaction repeats (defeat stays down, alarm keeps scanning). */
  hold?: readonly [number, number];
  base?: PoseSpec;
  face?: ExpressionSpec;
  keys?: readonly KeySpec[];
  wobble?: Wobble;
  procedure?: Procedure;
  events?: readonly ClipEvent[];
  /** Seconds to blend into this clip. */
  fade?: number;
  /** Seconds the next clip takes to blend in after this one (getting up from a fall is slow). */
  exit?: number;
}>;

export type Clip = Readonly<{
  name: string;
  duration: number;
  loop: readonly [number, number] | null;
  hold: readonly [number, number] | null;
  times: Float32Array;
  poses: readonly Pose[];
  faces: readonly Float32Array[];
  eases: readonly Ease[];
  /** The clip's `base` pose and starting face: where a procedural clip starts each frame. */
  basePose: Pose;
  baseFace: Float32Array;
  wobble?: Wobble;
  procedure?: Procedure;
  events: readonly ClipEvent[];
  fade: number;
  exit: number;
}>;

export function compileClip(rig: Rig, spec: ClipSpec): Clip {
  const keys = spec.keys ?? [];
  if (!spec.procedure && keys.length === 0) throw new Error(`clip ${spec.name}: no keys`);
  const base = spec.base ?? {};
  const poses: Pose[] = [];
  const faces: Float32Array[] = [];
  const basePose = compilePose(rig, base);
  const baseFace = expression(spec.face ?? {});
  let pose = basePose;
  let face = baseFace;
  let last = -Infinity;
  for (const key of keys) {
    if (key.at < last || key.at > spec.duration + 1e-6) throw new Error(`clip ${spec.name}: key at ${key.at} out of order`);
    last = key.at;
    if (key.pose) pose = compilePose(rig, overPose(base, key.pose));
    if (key.face) face = expression(key.face, face);
    poses.push(pose);
    faces.push(face);
  }
  const loop = spec.loop === true ? ([0, spec.duration] as const) : spec.loop ? spec.loop : null;
  return {
    name: spec.name,
    duration: spec.duration,
    loop,
    hold: spec.hold ?? null,
    times: Float32Array.from(keys.map((k) => k.at)),
    poses,
    faces,
    eases: keys.map((k) => k.ease ?? 'smooth'),
    basePose,
    baseFace,
    wobble: spec.wobble,
    procedure: spec.procedure,
    events: spec.events ?? [],
    fade: spec.fade ?? 0.4,
    exit: spec.exit ?? 0,
  };
}

export function ease(kind: Ease, u: number): number {
  switch (kind) {
    case 'linear':
      return u;
    case 'in':
      return u * u * u;
    case 'out':
      return 1 - (1 - u) ** 3;
    case 'snap':
      return 1 - (1 - u) ** 5;
    case 'back': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2;
    }
    case 'hold':
      return u < 1 ? 0 : 1;
    default:
      return u * u * (3 - 2 * u);
  }
}

/** Where a clip's own time stands after `t` seconds of playing: looping, held in a section, or stopped at the end. */
export function clipTime(clip: Clip, t: number, held = false): number {
  const section = clip.loop ?? (held ? clip.hold : null);
  if (section) {
    const [from, to] = section;
    if (t < to || to - from <= 0) return Math.min(t, to);
    return from + ((t - from) % (to - from));
  }
  return Math.min(t, clip.duration);
}

/** Whether a clip played for `t` seconds has finished (never, for a looping or held one). */
export function clipDone(clip: Clip, t: number, held = false): boolean {
  if (clip.loop || (held && clip.hold)) return false;
  return t >= clip.duration;
}

/** The clip's pose and face at its own time `tau` (from `clipTime`). */
export function sampleClip(rig: Rig, clip: Clip, tau: number, pose: Pose, face: Float32Array, ctx = { stride: 1 }): void {
  const n = clip.times.length;
  if (n > 0) {
    const times = clip.times;
    if (tau <= times[0]!) {
      copyPose(clip.poses[0]!, pose);
      face.set(clip.faces[0]!);
    } else if (tau >= times[n - 1]!) {
      // Past the last key: a whole-clip loop eases back into its first key; anything else holds the last.
      const wrap = clip.loop && clip.loop[0] === 0 && clip.loop[1] === clip.duration && clip.duration > times[n - 1]!;
      if (wrap) {
        const u = ease(clip.eases[0]!, (tau - times[n - 1]!) / (clip.duration - times[n - 1]!));
        mixPose(clip.poses[n - 1]!, clip.poses[0]!, u, pose);
        mixExpression(clip.faces[n - 1]!, clip.faces[0]!, u, face);
      } else {
        copyPose(clip.poses[n - 1]!, pose);
        face.set(clip.faces[n - 1]!);
      }
    } else {
      let i = 0;
      while (i < n - 2 && tau >= times[i + 1]!) i += 1;
      const span = times[i + 1]! - times[i]!;
      const u = ease(clip.eases[i + 1]!, span > 0 ? (tau - times[i]!) / span : 1);
      mixPose(clip.poses[i]!, clip.poses[i + 1]!, u, pose);
      mixExpression(clip.faces[i]!, clip.faces[i + 1]!, u, face);
    }
  } else {
    copyPose(clip.basePose, pose);
    face.set(clip.baseFace);
  }
  clip.procedure?.(tau, pose, face, rig, ctx);
  clip.wobble?.(tau, pose, face, rig);
}

/** Events whose moment falls in (from, to] of a clip's own time, wrapping once for loops. */
export function eventsBetween(clip: Clip, from: number, to: number): ClipEventKind[] {
  if (clip.events.length === 0 || to === from) return [];
  const out: ClipEventKind[] = [];
  const hit = (a: number, b: number) => {
    for (const e of clip.events) if (e.at > a && e.at <= b) out.push(e.kind);
  };
  if (to > from) hit(from, to);
  else {
    // Wrapped around the loop's end.
    const section = clip.loop ?? clip.hold;
    hit(from, section ? section[1] : clip.duration);
    hit(section ? section[0] - 1e-6 : -1e-6, to);
  }
  return out;
}

export const blankFace = () => new Float32Array(CHANNEL_COUNT);
