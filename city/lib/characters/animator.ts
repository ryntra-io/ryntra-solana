import { clipDone, clipTime, eventsBetween, sampleClip, type Clip, type ClipEventKind } from './clip.ts';
import { CH, CHANNEL_COUNT } from './expression.ts';
import { DEG, affineDirInverse, affinePoint, clamp, hash, quatNormalize } from './math.ts';
import { ANKLE, emptyPose, nudge, type Pose } from './pose.ts';
import { reachLeg, solveAims, solveBones, type Rig } from './rig.ts';

/**
 * Plays a character: the clip of its state, the reactions it is given, its walk, and its head following a target —
 * blended into one pose a frame, with the legs reaching for their feet. It knows nothing of three.js: it writes one
 * affine matrix per bone and one expression (`expression.ts`), and the renderer copies both into the shader.
 *
 * States are what the character is doing — ready, thinking, acting, done — shown by body and light, never text.
 * Reactions are moments laid over a state — an attempt on the vault, a laugh, an alarm, a defeat, a celebration, a
 * greeting — that play once and hand back to the state, or with `hold` stay in their last section.
 */

export const STATES = ['ready', 'thinking', 'acting', 'done'] as const;
export type CharacterState = (typeof STATES)[number];

export const REACTIONS = ['attempt', 'laugh', 'alarm', 'defeat', 'celebrate', 'greet'] as const;
export type Reaction = (typeof REACTIONS)[number];

export type Archetype = Readonly<{
  name: string;
  rig: Rig;
  clips: Readonly<Record<string, Clip>>;
  /** The clip each state loops. */
  states: Readonly<Record<CharacterState, string>>;
  reactions: Readonly<Record<Reaction, string>>;
  /** In `ready`, a variation that plays once every so often (seconds). */
  idle: Readonly<{ clip: string; every: readonly [number, number] }>;
  /** Walking: the clip, its speed at full stride (units a second) and how fast the body turns (radians a second). */
  walk: Readonly<{ clip: string; speed: number; turnRate: number }>;
  legs: Readonly<Record<'L' | 'R', readonly [string, string, string]>>;
  /** Which bones turn toward a look target, and how far: yaw and pitch limits in degrees. */
  look: Readonly<{ neck: string; head: string; yaw: number; up: number; down: number }>;
}>;

type Track = { clip: Clip; time: number; weight: number; target: number; rate: number; held: boolean; kind: 'state' | 'reaction' | 'idle' | 'walk' };

/** What the scene tells the animator each frame. */
export type Drive = {
  /** Forward speed of the body, units a second (0 standing). */
  speed?: number;
  /** The body is turning on the spot. */
  turning?: boolean;
  /** A point in the character's own space to look at, or null. */
  look?: ArrayLike<number> | null;
};

export class Animator {
  readonly kind: Archetype;
  readonly mats: Float32Array;
  readonly face = new Float32Array(CHANNEL_COUNT);
  /** Events since the last update: feet landing, sparks, a burst. */
  events: ClipEventKind[] = [];
  /** The clip with the most weight. */
  top = '';

  private state: CharacterState = 'ready';
  private tracks: Track[] = [];
  private reaction: Track | null = null;
  private readonly pose: Pose;
  private readonly scratch: Pose;
  private readonly faceScratch = new Float32Array(CHANNEL_COUNT);
  private readonly seed: number;
  private clock = 0;
  private nextIdle: number;
  private nextBlink: number;
  private nextGlance: number;
  private glance = [0, 0];
  private yaw = 0;
  private pitch = 0;
  private yawV = 0;
  private pitchV = 0;
  private lookOn = 0;
  private stride = 1;

  constructor(kind: Archetype, seed = 1) {
    this.kind = kind;
    this.seed = seed;
    this.mats = new Float32Array(kind.rig.total * 12);
    this.pose = emptyPose(kind.rig);
    this.scratch = emptyPose(kind.rig);
    this.nextIdle = this.between(kind.idle.every, 1);
    this.nextBlink = 1.5 + 2 * hash(seed * 7.1);
    this.nextGlance = 2 + 3 * hash(seed * 3.3);
    this.push(this.clip(kind.states.ready), 'state', 0);
    this.tracks[0]!.weight = 1;
    this.evaluate(0, null);
  }

  /** Sets what the character is doing. The new state's clip blends in; a reaction playing finishes first. */
  setState(state: CharacterState): void {
    if (state === this.state) return;
    this.state = state;
    this.nextIdle = this.clock + this.between(this.kind.idle.every, 2);
    if (!this.reaction) this.push(this.clip(this.kind.states[state]), 'state');
  }

  getState(): CharacterState {
    return this.state;
  }

  /** Plays a reaction now, over whatever is playing. With `hold` it stays in its last section until the next one. */
  react(reaction: Reaction, hold = false): void {
    const track = this.push(this.clip(this.kind.reactions[reaction]), 'reaction');
    track.held = hold;
    this.reaction = track;
  }

  /** Lets a held reaction go: the state's clip blends back in. */
  release(): void {
    if (!this.reaction) return;
    this.reaction.held = false;
    this.finishReaction();
  }

  /** A reaction is playing: the body should stand still for it. */
  get busy(): boolean {
    return this.reaction !== null;
  }

  /** Advances by `dt` seconds. */
  update(dt: number, drive: Drive = {}): void {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.clock += dt;
    this.events = [];
    const walk = this.kind.walk;
    const speed = drive.speed ?? 0;
    const moving = !this.reaction && (speed > 0.02 || drive.turning === true);
    // Step length for a speed: the cadence slows a little with shorter steps, as a heavy body does.
    const wanted = clamp(stepFor(speed / walk.speed), drive.turning ? 0.12 : 0, 1);
    this.stride += (wanted - this.stride) * Math.min(1, dt * 6);

    // What should be on top.
    if (this.reaction && clipDone(this.reaction.clip, this.reaction.time, this.reaction.held)) this.finishReaction();
    const top = this.tracks[this.tracks.length - 1]!;
    if (!this.reaction) {
      if (moving) {
        if (top.kind !== 'walk') this.push(this.clip(walk.clip), 'walk');
      } else if (top.kind === 'walk' || (top.kind === 'idle' && clipDone(top.clip, top.time))) {
        this.push(this.clip(this.kind.states[this.state]), 'state');
      } else if (this.state === 'ready' && top.kind === 'state' && this.clock >= this.nextIdle) {
        this.push(this.clip(this.kind.idle.clip), 'idle');
        this.nextIdle = this.clock + this.between(this.kind.idle.every, this.clock);
      }
    }

    // Time and weight.
    for (const track of this.tracks) {
      const rate = track.kind === 'walk' ? 0.75 + 0.25 * this.stride : 1;
      const before = clipTime(track.clip, track.time, track.held);
      track.time += dt * rate;
      const after = clipTime(track.clip, track.time, track.held);
      if (track.weight > 0.5 || track === this.tracks[this.tracks.length - 1]) this.events.push(...eventsBetween(track.clip, before, after));
      track.weight = track.target > track.weight ? Math.min(track.target, track.weight + dt * track.rate) : Math.max(track.target, track.weight - dt * track.rate);
    }
    this.tracks = this.tracks.filter((t) => t.weight > 0 || t.target > 0);
    this.evaluate(dt, drive.look ?? null);
  }

  /** Development: shows one clip at its own time `t`, unblended, looking at `look` (character space) if given. */
  seek(name: string, t: number, look: ArrayLike<number> | null = null, stride = 1): void {
    const clip = this.clip(name);
    this.stride = stride;
    this.tracks = [{ clip, time: t, weight: 1, target: 1, rate: 1, held: false, kind: 'state' }];
    this.reaction = null;
    this.yawV = 0;
    this.pitchV = 0;
    this.lookOn = look ? 1 : 0;
    if (look) {
      // No easing in a still: the head is where the target is.
      const [yaw, pitch] = this.aim(look);
      this.yaw = yaw;
      this.pitch = pitch;
    } else {
      this.yaw = 0;
      this.pitch = 0;
    }
    this.evaluate(0, look, true);
  }

  /** Development: shows the face (visor and lights) another clip has at its time `t`, keeping the pose. */
  faceOf(name: string, t: number): void {
    const clip = this.clip(name);
    sampleClip(this.kind.rig, clip, clipTime(clip, t), this.scratch, this.faceScratch, { stride: 1 });
    this.face.set(this.faceScratch);
  }

  private clip(name: string): Clip {
    const clip = this.kind.clips[name];
    if (!clip) throw new Error(`${this.kind.name}: no clip ${name}`);
    return clip;
  }

  private between([lo, hi]: readonly [number, number], salt: number): number {
    return lo + (hi - lo) * hash(this.seed * 13.7 + salt * 1.31);
  }

  private push(clip: Clip, kind: Track['kind'], time = 0): Track {
    const leaving = this.tracks[this.tracks.length - 1];
    // Out of a long fall (a defeat), the body takes its time getting up.
    const fade = Math.max(clip.fade, leaving?.clip.exit ?? 0, 0.05);
    for (const t of this.tracks) {
      t.target = 0;
      t.rate = 1 / fade;
    }
    const track: Track = { clip, time, weight: 0, target: 1, rate: 1 / fade, held: false, kind };
    this.tracks.push(track);
    return track;
  }

  private finishReaction(): void {
    this.reaction = null;
    this.nextIdle = this.clock + this.between(this.kind.idle.every, this.clock + 5);
    this.push(this.clip(this.kind.states[this.state]), 'state');
  }

  /** Yaw and pitch (degrees) from the chest toward a point in the character's space, within the neck's reach. */
  private aim(look: ArrayLike<number>): [number, number] {
    const { look: limits, rig } = this.kind;
    const neck = rig.parent[rig.index[limits.neck]!]!;
    affinePoint(this.mats, rig.index[limits.neck]! * 12, 0, 0.1, 0, at);
    affineDirInverse(this.mats, neck * 12, look[0]! - at[0]!, look[1]! - at[1]!, look[2]! - at[2]!, toward);
    const yaw = Math.atan2(toward[0]!, toward[2]!) / DEG;
    const pitch = Math.atan2(toward[1]!, Math.hypot(toward[0]!, toward[2]!)) / DEG;
    return [clamp(yaw, -limits.yaw, limits.yaw), clamp(pitch, -limits.down, limits.up)];
  }

  private evaluate(dt: number, look: ArrayLike<number> | null, still = false): void {
    const { rig } = this.kind;
    const pose = this.pose;
    const face = this.face;
    // Blend every track by weight.
    let total = 0;
    for (const t of this.tracks) total += t.weight;
    if (total <= 0) total = 1;
    let first = true;
    let best = -1;
    for (const track of this.tracks) {
      if (track.weight <= 0) continue;
      if (track.weight > best) {
        best = track.weight;
        this.top = track.clip.name;
      }
      sampleClip(rig, track.clip, clipTime(track.clip, track.time, track.held), this.scratch, this.faceScratch, { stride: this.stride });
      const w = track.weight / total;
      if (first) {
        scale(this.scratch, w, pose);
        for (let i = 0; i < CHANNEL_COUNT; i += 1) face[i] = this.faceScratch[i]! * w;
        first = false;
      } else {
        accumulate(this.scratch, w, pose);
        for (let i = 0; i < CHANNEL_COUNT; i += 1) face[i] += this.faceScratch[i]! * w;
      }
    }
    for (let i = 0; i < rig.count; i += 1) quatNormalize(pose.rot, i * 4);

    // Place the body once to know where the neck is, then turn the head toward the target.
    solveBones(rig, pose.rot, pose.hips, this.mats);
    this.lookAt(dt, look, still);
    // The legs reach for their feet (only the hips' placement is read, and the look did not move them).
    for (const side of ['L', 'R'] as const) {
      const [thigh, shin, foot] = this.kind.legs[side].map((n) => rig.index[n]!) as [number, number, number];
      const o = side === 'L' ? 0 : 5;
      target[0] = pose.feet[o]!;
      target[1] = pose.feet[o + 1]! + ANKLE;
      target[2] = pose.feet[o + 2]!;
      reachLeg(rig, this.mats, pose.rot, thigh, shin, foot, target, pose.feet[o + 3]!, pose.feet[o + 4]!);
    }
    solveBones(rig, pose.rot, pose.hips, this.mats);
    solveAims(rig, this.mats);
    if (!still) this.blink();
  }

  private lookAt(dt: number, look: ArrayLike<number> | null, still: boolean): void {
    const { look: limits, rig } = this.kind;
    const weight = this.face[CH.look]!;
    let goalYaw = 0;
    let goalPitch = 0;
    let on = 0;
    if (look) {
      [goalYaw, goalPitch] = this.aim(look);
      on = 1;
    } else if (this.state === 'ready' && !still) {
      // Nothing to watch: now and then a glance around, as a guard does.
      if (this.clock >= this.nextGlance) {
        const k = this.clock * 0.37 + this.seed;
        this.glance = hash(k * 5.1) < 0.3 ? [0, 0] : [(hash(k * 9.7) * 2 - 1) * limits.yaw * 0.45, (hash(k * 2.9) * 2 - 1) * 8 - 3];
        this.nextGlance = this.clock + 2.5 + 3.5 * hash(k * 1.7);
      }
      [goalYaw, goalPitch] = this.glance as [number, number];
      on = 0.8;
    }
    if (!still) {
      this.lookOn += (on - this.lookOn) * Math.min(1, dt * 3);
      // A heavy head: a critically damped spring, slower than the eyes.
      const k = 28;
      const c = 2 * Math.sqrt(k);
      this.yawV += (k * (goalYaw - this.yaw) - c * this.yawV) * dt;
      this.pitchV += (k * (goalPitch - this.pitch) - c * this.pitchV) * dt;
      this.yaw += this.yawV * dt;
      this.pitch += this.pitchV * dt;
    }
    const w = weight * this.lookOn;
    if (w <= 0.001) return;
    const yaw = this.yaw * w;
    const pitch = this.pitch * w;
    // Pitch up is a negative turn about x; the neck takes 40 %, the head the rest.
    nudge(rig, this.pose, limits.neck, -pitch * 0.4, yaw * 0.4, 0);
    nudge(rig, this.pose, limits.head, -pitch * 0.6, yaw * 0.6, 0);
    // The eyes lead the head toward where it is going.
    this.face[CH.gazeX] = clamp(this.face[CH.gazeX]! + ((goalYaw - this.yaw) / 30 + this.yaw / 160) * w, -1, 1);
    this.face[CH.gazeY] = clamp(this.face[CH.gazeY]! + ((goalPitch - this.pitch) / 25) * w, -1, 1);
  }

  private blink(): void {
    if (this.clock >= this.nextBlink) this.nextBlink = this.clock + 2.4 + 3.2 * hash(this.clock * 3.1 + this.seed);
    // A blink is the last 0.13 s before each scheduled moment, unless the face is broken or crossed out.
    const left = this.nextBlink - this.clock;
    const shut = left < 0.13 ? Math.sin((left / 0.13) * Math.PI) : 0;
    if (this.face[CH.glitch]! < 0.5 && this.face[CH.cross]! < 0.5) this.face[CH.open] = this.face[CH.open]! * (1 - 0.92 * shut);
  }
}

const target = new Float64Array(3);
const at = new Float64Array(3);
const toward = new Float64Array(3);

/** Step length (0 … 1) for a share of full walking speed, given that cadence slows to 0.75 at short steps. */
function stepFor(share: number): number {
  if (share <= 0) return 0;
  // s · (0.75 + 0.25 s) = share
  return clamp((-0.75 + Math.sqrt(0.5625 + share)) / 0.5, 0, 1);
}

function scale(from: Pose, w: number, to: Pose): void {
  for (let i = 0; i < from.rot.length; i += 1) to.rot[i] = from.rot[i]! * w;
  for (let i = 0; i < 3; i += 1) to.hips[i] = from.hips[i]! * w;
  for (let i = 0; i < 10; i += 1) to.feet[i] = from.feet[i]! * w;
}

/** Adds a weighted pose, keeping each quaternion on the same side as the sum so far. */
function accumulate(from: Pose, w: number, to: Pose): void {
  const n = from.rot.length / 4;
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const dot = from.rot[o]! * to.rot[o]! + from.rot[o + 1]! * to.rot[o + 1]! + from.rot[o + 2]! * to.rot[o + 2]! + from.rot[o + 3]! * to.rot[o + 3]!;
    const s = dot < 0 ? -w : w;
    for (let k = 0; k < 4; k += 1) to.rot[o + k] = to.rot[o + k]! + from.rot[o + k]! * s;
  }
  for (let i = 0; i < 3; i += 1) to.hips[i] = to.hips[i]! + from.hips[i]! * w;
  for (let i = 0; i < 10; i += 1) to.feet[i] = to.feet[i]! + from.feet[i]! * w;
}
