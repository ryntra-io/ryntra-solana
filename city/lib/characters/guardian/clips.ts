import type { ClipSpec, Wobble } from '../clip.ts';
import { DEG, smoothstep } from '../math.ts';
import { CH } from '../expression.ts';
import { nudge, nudgeBoth, overPose, type PoseSpec } from '../pose.ts';

/**
 * The vault guardian's animations, as key poses in code. A heavy machine: it settles into every pose, its feet land
 * with weight, its head turns slower than its eyes. Angles in degrees; for paired bones the left side's sense is used
 * for both (x < 0 swings a limb forward, z > 0 lifts it out to the side, y twists it) and the right is mirrored.
 * Legs are never posed: the hips go up or down and the feet are placed, and the legs reach.
 *
 *   ready     idleA (loop), idleB now and then        thinking   analyze (hologram over the left hand)
 *   acting    speak (gestures, the visor talks)       done       done (a nod, then arms crossed)
 *   walk      procedural heavy gait                   reactions  attempt, laugh, alarm, defeat, celebrate, greet
 */

/** The guard's stance: weight low, chest forward, fists half closed. */
const STANCE: PoseSpec = {
  hips: [0, -0.035, 0],
  bones: { spine: [5, 0, 0], chest: [7, 0, 0], neck: [-5, 0, 0], head: [-7, 0, 0] },
  both: {
    clavicle: [0, 0, -3],
    upperArm: [-7, 0, 9],
    foreArm: [-24, 0, 0],
    hand: [0, 12, 4],
    fingers: [0, 0, -50],
    tips: [0, 0, -65],
    thumb: [0, 0, -30],
  },
  feet: { L: [0.26, 0, 0.06, 0, 9], R: [0.25, 0, -0.03, 0, 6] },
};

/** The guardian's resting face: eyes narrowed to the visor's slit, a little stern — it is guarding something. */
const GUARD_FACE = { slant: 0.22, open: 0.36 } as const;

const FIST = { fingers: [0, 0, -95], tips: [0, 0, -100], thumb: [0, -20, -60] } as const;
const OPEN = { fingers: [0, 0, -6], tips: [0, 0, -8], thumb: [0, 0, 12] } as const;

const at = (pose: PoseSpec) => overPose(STANCE, pose);

/** Breath: the chest rises, the shoulders lift, a slow servo tremor in the neck. Scaled by `k`. */
function breathe(t: number, rig: Parameters<Wobble>[3], pose: Parameters<Wobble>[1], k = 1, rate = 3.4): void {
  const b = Math.sin((t / rate) * Math.PI * 2);
  nudge(rig, pose, 'chest', -1.4 * b * k, 0, 0);
  nudgeBoth(rig, pose, 'clavicle', 0, 0, 1.6 * b * k);
  nudge(rig, pose, 'head', 0.8 * b * k + 0.35 * Math.sin(t * 7.3) * k, 0.3 * Math.sin(t * 5.1) * k, 0);
  pose.hips[1] = pose.hips[1]! + 0.006 * b * k;
}

/** 0 → 1 → 0 between `a` and `d`, rising over a … b and falling over c … d. */
const envelope = (t: number, a: number, b: number, c: number, d: number) => smoothstep(a, b, t) * (1 - smoothstep(c, d, t));

export const IDLE_A: ClipSpec = {
  name: 'idleA',
  duration: 6.4,
  loop: true,
  fade: 0.6,
  base: STANCE,
  face: GUARD_FACE,
  keys: [
    { at: 0, pose: {} },
    { at: 3.2, pose: { hips: [0.025, -0.045, 0], bones: { pelvis: [0, 2, -2], spine: [5, 0, 1], chest: [7, 3, 2], neck: [-5, 0, 0], head: [-7, -2, -1] } } },
    { at: 6.4, pose: {} },
  ],
  wobble: (t, pose, _face, rig) => breathe(t, rig, pose),
};

export const IDLE_B: ClipSpec = {
  name: 'idleB',
  duration: 5.4,
  fade: 0.5,
  base: STANCE,
  face: GUARD_FACE,
  keys: [
    { at: 0, pose: {} },
    // A roll of the shoulders, looking up.
    { at: 0.7, pose: { bones: { spine: [3, 0, 0], chest: [2, 0, 0], head: [-14, 0, 0] }, both: { clavicle: [0, 0, 9] } } },
    { at: 1.4, pose: { bones: { chest: [10, 0, 0], head: [-4, 0, 0] }, both: { clavicle: [0, 0, -5] } }, face: { open: 0.8 } },
    // Lifts the right fist and looks at it.
    {
      at: 2.2,
      pose: { bones: { chest: [6, -10, 0], head: [12, -24, 0] }, R: { upperArm: [-38, 0, 10], foreArm: [-100, 0, 0], hand: [0, -40, 0], ...FIST } },
      face: { gazeX: -0.6, gazeY: -0.3, slant: 0.35, open: 0.85 },
    },
    // Punches it into the open left palm.
    {
      at: 2.9,
      ease: 'out',
      pose: {
        bones: { chest: [9, 0, 0], head: [8, 0, 0] },
        L: { upperArm: [-34, -25, 10], foreArm: [-82, 0, 0], hand: [0, 0, 0], ...OPEN },
        R: { upperArm: [-46, -30, 6], foreArm: [-78, 0, 0], hand: [0, -10, 0], ...FIST },
      },
      face: { gazeX: 0, gazeY: -0.4, slant: 0.5, open: 0.7 },
    },
    { at: 3.2, ease: 'out', pose: { bones: { chest: [10, 0, 0], head: [12, 0, 0] }, L: { upperArm: [-32, -25, 10], foreArm: [-80, 0, 0], ...OPEN }, R: { upperArm: [-44, -30, 6], foreArm: [-80, 0, 0], ...FIST } }, face: { arc: 0.5, smile: 0.5, open: 0.9, slant: 0.05 } },
    { at: 4.5, pose: {}, face: { ...GUARD_FACE, arc: 0, smile: 0.1, gazeX: 0, gazeY: 0 } },
    { at: 5.4, pose: {} },
  ],
  events: [{ at: 2.9, kind: 'clank' }],
  wobble: (t, pose, _face, rig) => breathe(t, rig, pose),
};

/** Walking: the feet follow stance and swing, the legs reach for them, the hips drop on every landing. */
export const WALK: ClipSpec = {
  name: 'walk',
  duration: 1.4,
  loop: true,
  fade: 0.35,
  base: overPose(STANCE, { hips: [0, -0.07, 0], bones: { spine: [6, 0, 0], chest: [9, 0, 0], head: [-10, 0, 0] } }),
  face: { ...GUARD_FACE, seams: 0.75, core: 0.9 },
  events: [
    { at: 0, kind: 'stomp.L' },
    { at: 0.7, kind: 'stomp.R' },
  ],
  procedure: (t, pose, _face, rig, { stride }) => {
    const phase = t / 1.4;
    const s = Math.max(stride, 0);
    const reach = 0.63 * s;
    const lift = 0.15 * Math.max(s, 0.55);
    for (const [o, offset, sign] of [[0, 0, 1], [5, 0.5, -1]] as const) {
      const p = (phase + offset) % 1;
      let z: number;
      let y = 0;
      let pitch: number;
      if (p < 0.6) {
        // Stance: the foot is planted and travels back under the body; the heel lands, then the sole is flat.
        const u = p / 0.6;
        z = reach / 2 - reach * u;
        pitch = 12 * (1 - smoothstep(0, 0.12, u)) * s;
      } else {
        // Swing: toes push off, the foot lifts and comes through, toes up for the next landing.
        const u = (p - 0.6) / 0.4;
        z = -reach / 2 + reach * smoothstep(0, 1, u);
        y = lift * Math.sin(Math.PI * u) ** 0.8;
        pitch = (-18 + 30 * smoothstep(0.2, 1, u)) * s;
      }
      pose.feet[o] = (0.25 + 0.01 * Math.cos(Math.PI * 2 * p)) * sign;
      pose.feet[o + 1] = y;
      pose.feet[o + 2] = z + 0.02;
      pose.feet[o + 3] = pitch * DEG;
      pose.feet[o + 4] = 6 * DEG * sign;
    }
    // Lowest just after each landing, highest over the planted foot.
    const drop = 0.5 + 0.5 * Math.cos(Math.PI * 2 * (2 * phase - 0.12));
    pose.hips[1] = -0.06 - 0.03 * drop * Math.max(s, 0.3);
    const sway = Math.cos(Math.PI * 2 * (phase - 0.3));
    pose.hips[0] = 0.035 * sway;
    nudge(rig, pose, 'pelvis', 0, 5 * sway * s, 3 * sway);
    nudge(rig, pose, 'chest', 1.5 * drop, -7 * sway * s, -2 * sway);
    nudge(rig, pose, 'head', -1.5 * drop, 2 * sway * s, 1.5 * sway);
    // Arms swing against the legs.
    const armL = Math.cos(Math.PI * 2 * (phase - 0.5));
    const armR = Math.cos(Math.PI * 2 * phase);
    nudge(rig, pose, 'upperArm.L', -14 * armL * s, 0, 0);
    nudge(rig, pose, 'upperArm.R', -14 * armR * s, 0, 0);
    nudge(rig, pose, 'foreArm.L', -10 * Math.max(0, armL) * s, 0, 0);
    nudge(rig, pose, 'foreArm.R', -10 * Math.max(0, armR) * s, 0, 0);
  },
};

/** Thinking: the left palm up with a hologram over it, the head bent to read it, the right hand working it. */
const READING: PoseSpec = at({
  bones: { spine: [4, 4, 0], chest: [5, 8, 0], neck: [6, 6, 0], head: [16, 12, 4] },
  L: { upperArm: [-36, 0, 14], foreArm: [-74, 0, 0], hand: [-8, 90, 0], ...OPEN },
  R: { upperArm: [-42, -18, 4], foreArm: [-82, 0, 0], hand: [0, -50, 0], fingers: [0, 0, -30], tips: [0, 0, -20], thumb: [0, 0, -20] },
});

export const ANALYZE: ClipSpec = {
  name: 'analyze',
  duration: 4,
  loop: true,
  fade: 0.5,
  base: READING,
  face: { hue: 'warm', glow: 1.15, open: 0.72, slant: 0.15, scan: 1, smile: 0, core: 1.1, seams: 0.9, holo: 1, look: 0.25, gazeY: -0.5 },
  keys: [
    { at: 0, pose: {} },
    { at: 1.0, pose: { bones: { head: [13, 20, 2], neck: [6, 8, 0] } } },
    // Taps the hologram.
    { at: 1.25, ease: 'out', pose: { bones: { head: [13, 20, 2], neck: [6, 8, 0] }, R: { upperArm: [-50, -18, 4], foreArm: [-66, 0, 0], hand: [-10, -50, 0], fingers: [0, 0, -12], tips: [0, 0, -6] } } },
    { at: 1.55, pose: { bones: { head: [14, 18, 2], neck: [6, 8, 0] } } },
    { at: 2.2, pose: { bones: { head: [19, 6, 6], neck: [7, 4, 0] } } },
    { at: 2.85, ease: 'out', pose: { bones: { head: [19, 6, 6], neck: [7, 4, 0] }, R: { upperArm: [-50, -18, 4], foreArm: [-66, 0, 0], hand: [-10, -50, 0], fingers: [0, 0, -12], tips: [0, 0, -6] } } },
    { at: 3.15, pose: { bones: { head: [18, 8, 5], neck: [7, 4, 0] } } },
    { at: 4, pose: {} },
  ],
  wobble: (t, pose, face, rig) => {
    breathe(t, rig, pose, 0.6);
    face[CH.gazeX] = face[CH.gazeX]! + 0.55 * Math.sin(Math.PI * 2 * t * 0.75);
    face[CH.core] = face[CH.core]! + 0.35 * Math.sin(Math.PI * 2 * t * 1.5);
  },
};

/** Acting: answering — an open hand held out, a fist brought down to make the point, the visor speaking. */
export const SPEAK: ClipSpec = {
  name: 'speak',
  duration: 3.2,
  loop: true,
  fade: 0.4,
  base: STANCE,
  face: { hue: 'amber', glow: 1.35, open: 0.95, slant: 0.35, talk: 1, mouth: 0.35, smile: 0, core: 1.5, seams: 1.2, look: 0.6 },
  keys: [
    { at: 0, pose: { bones: { chest: [6, -8, 0], head: [-4, -4, 0] }, R: { upperArm: [-62, 0, 12], foreArm: [-96, 0, 0], hand: [-35, -90, 0], ...OPEN } } },
    { at: 0.8, ease: 'out', pose: { bones: { chest: [10, -10, 0], head: [2, -6, 0] }, R: { upperArm: [-78, 0, 12], foreArm: [-62, 0, 0], hand: [-45, -90, 0], ...OPEN } } },
    {
      at: 1.5,
      pose: {
        bones: { chest: [7, 6, 0], head: [-2, 4, 0] },
        L: { upperArm: [-34, -10, 16], foreArm: [-104, 0, 0], hand: [0, 20, 0], ...FIST },
        R: { upperArm: [-20, 0, 10], foreArm: [-40, 0, 0], hand: [0, 0, 0] },
      },
    },
    {
      at: 2.15,
      ease: 'out',
      pose: { bones: { chest: [12, 8, 0], head: [8, 4, 0] }, L: { upperArm: [-30, -10, 14], foreArm: [-44, 0, 0], hand: [0, 20, 0], ...FIST }, R: { upperArm: [-20, 0, 10], foreArm: [-40, 0, 0] } },
    },
    { at: 3.2, pose: { bones: { chest: [6, -8, 0], head: [-4, -4, 0] }, R: { upperArm: [-62, 0, 12], foreArm: [-96, 0, 0], hand: [-35, -90, 0], ...OPEN } } },
  ],
  events: [{ at: 2.15, kind: 'clank' }],
  wobble: (t, pose, _face, rig) => {
    breathe(t, rig, pose, 0.5);
    nudge(rig, pose, 'head', 2.2 * Math.sin(Math.PI * 2 * t * 2.2), 0, 0);
  },
};

/** Done: a nod, then arms crossed over the chest — the vault is answered for. */
const CROSSED: PoseSpec = at({
  hips: [0, -0.02, 0],
  bones: { spine: [2, 0, 0], chest: [2, 0, 0], head: [-10, 0, 0] },
  L: { clavicle: [0, 0, 2], upperArm: [-36, -74, 4], foreArm: [-104, 0, 0], hand: [0, 0, 0], ...FIST },
  R: { clavicle: [0, 0, 2], upperArm: [-22, -66, 2], foreArm: [-100, 0, 0], hand: [0, 0, 0], ...FIST },
});

export const DONE: ClipSpec = {
  name: 'done',
  duration: 4.6,
  loop: [1.4, 4.6],
  fade: 0.35,
  base: STANCE,
  face: { hue: 'warm', glow: 1.25, arc: 0.45, smile: 0.45, core: 1.6, seams: 1, look: 0.7 },
  keys: [
    { at: 0, pose: {} },
    { at: 0.45, ease: 'out', pose: { bones: { chest: [10, 0, 0], head: [16, 0, 0] } }, face: { core: 1.8, open: 0.75 } },
    { at: 1.4, pose: CROSSED, face: { hue: 'amber', glow: 1.05, core: 0.9, seams: 0.8, open: 0.9 } },
    { at: 3.0, pose: overPose(CROSSED, { bones: { head: [-8, 9, 0], chest: [2, 3, 0] } }) },
    { at: 4.6, pose: CROSSED },
  ],
  wobble: (t, pose, _face, rig) => breathe(t, rig, pose, 0.8),
};

/** Someone tries the vault: the head snaps to it, the body drops into a guard, the eyes narrow. */
const GUARD: PoseSpec = at({
  hips: [0, -0.085, 0],
  bones: { spine: [6, 0, 0], chest: [11, 0, 0], neck: [-4, 0, 0], head: [-6, 0, 0] },
  both: { clavicle: [0, 0, 4], upperArm: [-48, -22, 16], foreArm: [-104, 0, 0], hand: [0, 10, 0], ...FIST },
  feet: { L: [0.33, 0, 0.14, 0, 12], R: [0.31, 0, -0.12, 0, 16] },
});

export const ATTEMPT: ClipSpec = {
  name: 'attempt',
  duration: 2.6,
  fade: 0.12,
  base: STANCE,
  face: GUARD_FACE,
  keys: [
    { at: 0, pose: {} },
    { at: 0.32, ease: 'out', pose: GUARD, face: { open: 1.25, glow: 1.7, core: 1.4, seams: 1.4, look: 0.3 } },
    { at: 0.62, ease: 'smooth', pose: overPose(GUARD, { hips: [0, -0.075, 0] }), face: { open: 0.55, slant: 0.6, glow: 1.35, smile: -0.2 } },
    { at: 1.7, pose: overPose(GUARD, { bones: { head: [-6, 0, 5], chest: [11, 0, 0] } }) },
    { at: 2.6, pose: {}, face: { ...GUARD_FACE, glow: 1, smile: 0.1, core: 0.8, seams: 0.6, look: 1 } },
  ],
  events: [{ at: 0.3, kind: 'stomp.L' }],
};

export const LAUGH: ClipSpec = {
  name: 'laugh',
  duration: 3.4,
  hold: [0.9, 2.3],
  fade: 0.2,
  base: STANCE,
  face: GUARD_FACE,
  keys: [
    { at: 0, pose: {} },
    {
      at: 0.35,
      ease: 'out',
      pose: {
        hips: [0, -0.05, -0.02],
        bones: { spine: [-6, 0, 0], chest: [-12, 0, 0], head: [-24, 0, 0] },
        L: { upperArm: [-72, 0, 10], foreArm: [-12, 0, 0], hand: [0, 0, 0], fingers: [0, 0, -12], tips: [0, 0, -6] },
        R: { upperArm: [-18, -42, 4], foreArm: [-96, 0, 0], hand: [0, 0, 0], ...OPEN },
      },
      face: { hue: 'warm', arc: 1, mouth: 0.85, smile: 1, talk: 0.6, glow: 1.45, core: 1.3, look: 0.1 },
    },
    { at: 0.9, pose: { hips: [0, -0.09, 0], bones: { spine: [8, 0, 0], chest: [14, 0, 0], head: [10, 0, 0] }, L: { upperArm: [-8, 0, 8], foreArm: [-30, 0, 0], ...OPEN }, R: { upperArm: [-18, -42, 4], foreArm: [-96, 0, 0], ...OPEN } } },
    { at: 1.6, pose: { hips: [0, -0.05, -0.02], bones: { spine: [-4, 0, 0], chest: [-9, 0, 0], head: [-19, 0, 0] }, L: { upperArm: [-60, 0, 10], foreArm: [-14, 0, 0] }, R: { upperArm: [-18, -42, 4], foreArm: [-96, 0, 0], ...OPEN } } },
    { at: 2.3, pose: { hips: [0, -0.08, 0], bones: { spine: [7, 0, 0], chest: [12, 0, 0], head: [6, 0, 0] }, L: { upperArm: [-8, 0, 8], foreArm: [-30, 0, 0], ...OPEN }, R: { upperArm: [-18, -42, 4], foreArm: [-96, 0, 0], ...OPEN } } },
    { at: 3.4, pose: {}, face: { hue: 'amber', arc: 0, mouth: 0, smile: 0.1, talk: 0, glow: 1, core: 0.8, look: 1 } },
  ],
  wobble: (t, pose, face, rig) => {
    // The laugh shakes the chest and shoulders; the mouth judders with it.
    const k = envelope(t, 0.25, 0.5, 2.6, 3.2);
    nudge(rig, pose, 'chest', 0, 0, 1.8 * Math.sin(Math.PI * 2 * 9 * t) * k);
    nudgeBoth(rig, pose, 'clavicle', 0, 0, 3 * Math.sin(Math.PI * 2 * 9 * t + 1.6) * k);
    nudge(rig, pose, 'head', 2.4 * Math.sin(Math.PI * 2 * 4.5 * t) * k, 0, 0);
    face[CH.mouth] = face[CH.mouth]! * (0.75 + 0.25 * Math.sin(Math.PI * 2 * 4.5 * t));
  },
};

/** Alarm: wide stance, fists high, the head sweeping left and right, the visor and the beacon in flare. */
const ALERT: PoseSpec = at({
  hips: [0, -0.09, 0],
  bones: { spine: [6, 0, 0], chest: [12, 0, 0], neck: [-4, 0, 0], head: [-6, 0, 0] },
  both: { clavicle: [0, 0, 7], upperArm: [-60, -16, 22], foreArm: [-96, 0, 0], hand: [0, 10, 0], ...FIST },
  feet: { L: [0.35, 0, 0.1, 0, 14], R: [0.35, 0, -0.1, 0, 14] },
});

export const ALARM: ClipSpec = {
  name: 'alarm',
  duration: 3.6,
  hold: [0.8, 3.2],
  fade: 0.12,
  base: STANCE,
  face: GUARD_FACE,
  keys: [
    { at: 0, pose: {} },
    { at: 0.34, ease: 'out', pose: ALERT, face: { hue: 'flare', glow: 1.7, open: 1.3, size: 0.85, slant: 0.6, mouth: 0.5, smile: -0.6, talk: 0.3, core: 1.6, seams: 1.4, beacon: 1, look: 0 } },
    { at: 0.8, pose: overPose(ALERT, { bones: { head: [-4, 36, 0], chest: [10, 14, 0] } }), face: { gazeX: 0.7 } },
    { at: 1.6, pose: overPose(ALERT, { bones: { head: [-4, -36, 0], chest: [10, -14, 0] } }), face: { gazeX: -0.7 } },
    { at: 2.4, pose: overPose(ALERT, { bones: { head: [-4, 30, 0], chest: [10, 12, 0] } }), face: { gazeX: 0.6 } },
    { at: 3.2, pose: ALERT, face: { gazeX: 0 } },
    { at: 3.6, pose: {}, face: { ...GUARD_FACE, hue: 'amber', glow: 1, size: 1, mouth: 0, smile: 0.1, talk: 0, core: 0.8, seams: 0.6, beacon: 0, look: 1 } },
  ],
  events: [
    { at: 0.32, kind: 'stomp.L' },
    { at: 0.36, kind: 'stomp.R' },
  ],
  wobble: (t, _pose, face) => {
    // A slow pulse, twice a second — an alarm without a strobe.
    face[CH.glow] = face[CH.glow]! * (0.8 + 0.2 * Math.sin(Math.PI * 2 * 2 * t));
  },
};

/** The vault is broken: hit, a stagger, down on one knee, head hung, the visor guttering to an ember. */
const KNEEL: PoseSpec = at({
  hips: [0.02, -0.46, -0.1],
  bones: { pelvis: [8, 0, 0], spine: [10, 0, 0], chest: [22, 0, 4], neck: [12, 0, 0], head: [30, 0, 6] },
  L: { upperArm: [-26, 0, 8], foreArm: [-58, 0, 0], hand: [0, 10, 0], fingers: [0, 0, -40], tips: [0, 0, -40] },
  R: { clavicle: [0, 0, -6], upperArm: [8, 0, 10], foreArm: [-14, 0, 0], hand: [0, 0, 0], fingers: [0, 0, -30], tips: [0, 0, -30] },
  feet: { L: [0.27, 0, 0.36, 0, 6], R: [0.25, 0.03, -0.66, -62, 4] },
});

export const DEFEAT: ClipSpec = {
  name: 'defeat',
  duration: 5.2,
  hold: [3.4, 5.2],
  fade: 0.1,
  exit: 1.4,
  base: STANCE,
  face: GUARD_FACE,
  keys: [
    { at: 0, pose: {} },
    {
      at: 0.3,
      ease: 'out',
      pose: {
        hips: [0, -0.03, -0.1],
        bones: { spine: [-10, 0, 0], chest: [-22, 0, -6], head: [-28, 10, 0] },
        both: { upperArm: [12, 0, 30], foreArm: [-20, 0, 0], ...OPEN },
        feet: { R: [0.27, 0, -0.26, 0, 6] },
      },
      face: { hue: 'flare', glow: 2, glitch: 1, open: 1.3, mouth: 0.6, smile: -0.5, core: 2, seams: 1.6, look: 0 },
    },
    { at: 0.9, ease: 'out', pose: { hips: [0, -0.12, 0.02], bones: { spine: [8, 0, 0], chest: [18, 0, 4], head: [22, -6, 0] }, both: { upperArm: [4, 0, 10], foreArm: [-20, 0, 0] }, feet: { R: [0.26, 0, -0.18, 0, 6] } }, face: { glitch: 0.7, open: 0.55, slant: -0.6, glow: 1.2, mouth: 0.2 } },
    { at: 1.6, ease: 'in', pose: KNEEL, face: { glow: 0.6, glitch: 0.4, cross: 0.6, core: 0.5, seams: 0.4 } },
    { at: 2.3, ease: 'out', pose: overPose(KNEEL, { hips: [0.02, -0.48, -0.1] }), face: { glow: 0.38, glitch: 0.15, cross: 1, smile: -0.8, mouth: 0.1, core: 0.15, seams: 0.12 } },
    { at: 3.4, pose: KNEEL },
    { at: 4.3, pose: overPose(KNEEL, { bones: { head: [22, -4, 2] } }) },
    { at: 5.2, pose: KNEEL },
  ],
  events: [
    { at: 0.15, kind: 'sparks' },
    { at: 1.6, kind: 'stomp.R' },
  ],
  wobble: (t, pose, _face, rig) => breathe(t, rig, pose, smoothstep(2, 3, t) * 1.6, 2.4),
};

/** The vault held: a crouch, then both fists up with a burst of light, a pump, a stomp. */
export const CELEBRATE: ClipSpec = {
  name: 'celebrate',
  duration: 3.8,
  hold: [1.4, 3.0],
  fade: 0.2,
  base: STANCE,
  face: GUARD_FACE,
  keys: [
    { at: 0, pose: {} },
    { at: 0.35, pose: { hips: [0, -0.14, 0], bones: { spine: [8, 0, 0], chest: [16, 0, 0], head: [8, 0, 0] }, both: { upperArm: [12, 0, 14], foreArm: [-30, 0, 0], ...FIST } }, face: { hue: 'warm', open: 0.6, glow: 1.3 } },
    {
      at: 0.95,
      ease: 'out',
      pose: { hips: [0, 0.03, 0], bones: { spine: [-5, 0, 0], chest: [-12, 0, 0], head: [-22, 0, 0] }, both: { clavicle: [0, 0, 15], upperArm: [-176, 0, 18], foreArm: [-10, 0, 0], hand: [0, 0, 0], ...FIST } },
      face: { arc: 1, open: 1, mouth: 0.6, smile: 1, glow: 1.9, core: 2, seams: 1.7, look: 0.1 },
    },
    { at: 1.15, pose: { hips: [0, 0.02, 0], bones: { spine: [-4, 0, 0], chest: [-10, 0, 0], head: [-20, 0, 0] }, both: { clavicle: [0, 0, 14], upperArm: [-168, 0, 22], foreArm: [-18, 0, 0], hand: [0, 0, 0], ...FIST } } },
    { at: 1.4, pose: { hips: [0, -0.05, 0], bones: { chest: [-4, 0, 0], head: [-14, 0, 0] }, both: { clavicle: [0, 0, 10], upperArm: [-150, 0, 34], foreArm: [-72, 0, 0], ...FIST } } },
    { at: 2.2, ease: 'back', pose: { hips: [0, 0.01, 0], bones: { chest: [-9, 0, 0], head: [-20, 0, 0] }, both: { clavicle: [0, 0, 14], upperArm: [-170, 0, 20], foreArm: [-14, 0, 0], ...FIST } } },
    { at: 3.0, pose: { hips: [0, -0.05, 0], bones: { chest: [-4, 0, 0], head: [-14, 0, 0] }, both: { clavicle: [0, 0, 10], upperArm: [-150, 0, 34], foreArm: [-72, 0, 0], ...FIST } } },
    { at: 3.8, pose: {}, face: { ...GUARD_FACE, hue: 'amber', arc: 0, mouth: 0, smile: 0.1, glow: 1, core: 0.8, seams: 0.6, look: 1 } },
  ],
  events: [
    { at: 0.8, kind: 'burst' },
    { at: 1.4, kind: 'stomp.L' },
    { at: 3.0, kind: 'stomp.R' },
  ],
};

/** A greeting: the right hand up and waving, a small bow, the visor smiling. */
export const GREET: ClipSpec = {
  name: 'greet',
  duration: 3.0,
  fade: 0.3,
  base: STANCE,
  face: GUARD_FACE,
  keys: [
    { at: 0, pose: {} },
    {
      at: 0.5,
      ease: 'out',
      pose: { bones: { spine: [6, -4, 0], chest: [8, -8, 0], head: [6, -6, -6] }, R: { clavicle: [0, 0, 10], upperArm: [-30, 0, 72], foreArm: [-100, 0, 0], hand: [-10, -90, 0], ...OPEN } },
      face: { hue: 'warm', arc: 0.8, smile: 0.9, glow: 1.3, core: 1.2, mouth: 0.25 },
    },
    { at: 2.1, pose: { bones: { spine: [6, -4, 0], chest: [8, -8, 0], head: [8, -6, -6] }, R: { clavicle: [0, 0, 10], upperArm: [-30, 0, 72], foreArm: [-100, 0, 0], hand: [-10, -90, 0], ...OPEN } }, face: { talk: 0 } },
    { at: 3.0, pose: {}, face: { hue: 'amber', arc: 0, smile: 0.1, glow: 1, core: 0.8, mouth: 0 } },
  ],
  wobble: (t, pose, face, rig) => {
    // The wave: the forearm rocks side to side three times.
    const k = envelope(t, 0.45, 0.65, 1.9, 2.2);
    nudge(rig, pose, 'foreArm.R', 0, 0, 22 * Math.sin(Math.PI * 2 * 1.6 * (t - 0.5)) * k);
    face[CH.talk] = envelope(t, 0.6, 0.7, 1.3, 1.5);
  },
};

export const GUARDIAN_CLIPS: readonly ClipSpec[] = [IDLE_A, IDLE_B, WALK, ANALYZE, SPEAK, DONE, ATTEMPT, LAUGH, ALARM, DEFEAT, CELEBRATE, GREET];
