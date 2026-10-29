import { CROWD, HERO, STANDARD, type PartSpec } from '../body.ts';

/**
 * The vault guardian's body in code: the stand-in while its Blender model (`assets-source/characters/guardian/`) is
 * loading or cannot be read, in each bone's own space (y up, z forward, x its left; parts on `.L` bones are mirrored
 * onto the right). The model's figure in simple shapes: white ceramic plates — breastplate, deltoids, belt, the fronts
 * of the limbs — over black glass, a black glass helmet with a visor for a face, silver ear plates, a small amber core.
 * HERO parts are close-up detail, STANDARD the street, CROWD the few shapes seen far.
 */

const H = HERO;
const HS = HERO | STANDARD;
const C = CROWD;

/** Four fingers across the hand's width (z), for the hero detail. */
const FINGERS = [-0.026, -0.009, 0.009, 0.026];

/** A pair of abdominal pads of black glass. */
const abs = (bone: string, y: number, z: number): PartSpec[] =>
  [-1, 1].map((side) => ({ bone, shape: { kind: 'box', size: [0.056, 0.05, 0.02], radius: 0.009 }, at: [side * 0.031, y, z], turn: [-4, 0, 0], mat: 'gloss', lods: H }));

export const GUARDIAN_PARTS: readonly PartSpec[] = [
  // ——— Pelvis and waist: a white belt and a white plate down the front, black glass under ———
  { bone: 'pelvis', shape: { kind: 'box', size: [0.27, 0.16, 0.18], top: [0.22, 0.15], radius: 0.05 }, at: [0, -0.03, 0], mat: 'gloss', lods: HS },
  { bone: 'pelvis', shape: { kind: 'box', size: [0.25, 0.065, 0.19], top: [0.2, 0.15], radius: 0.03 }, at: [0, 0.07, 0], mat: 'shell', lods: HS },
  { bone: 'pelvis', shape: { kind: 'box', size: [0.05, 0.13, 0.04], top: [0.17, 0.06], radius: 0.012 }, at: [0, -0.03, 0.072], mat: 'shell', lods: HS },
  { bone: 'pelvis', shape: { kind: 'box', size: [0.24, 0.006, 0.17], radius: 0.003 }, at: [0, 0.035, 0], mat: 'seam', lods: H },
  { bone: 'pelvis', shape: { kind: 'ball', r: 0.05 }, at: [0.11, -0.06, 0], mat: 'rubber', lods: H, mirror: true },
  { bone: 'spine', shape: { kind: 'cyl', r: 0.1, r2: 0.095, h: 0.24 }, at: [0, 0.08, 0], mat: 'gloss', lods: HS },
  ...abs('spine', 0.152, 0.072),
  ...abs('spine', 0.094, 0.07),

  // ——— Chest: pectoral plates under a collar plate, black glass below; the core in the sternum ———
  { bone: 'chest', shape: { kind: 'box', size: [0.27, 0.196, 0.2], top: [0.35, 0.235], radius: 0.06 }, at: [0, 0.128, 0.01], mat: 'shell', lods: HS },
  { bone: 'chest', shape: { kind: 'box', size: [0.35, 0.085, 0.21], top: [0.16, 0.12], radius: 0.035 }, at: [0, 0.268, -0.01], mat: 'shell', lods: HS },
  { bone: 'chest', shape: { kind: 'cyl', r: 0.118, r2: 0.108, h: 0.1 }, at: [0, 0, -0.005], mat: 'gloss', lods: HS },
  { bone: 'chest', shape: { kind: 'box', size: [0.26, 0.006, 0.2], radius: 0.003 }, at: [0, 0.03, 0.005], mat: 'seam', lods: H },
  ...abs('chest', -0.006, 0.075),
  { bone: 'chest', shape: { kind: 'cyl', r: 0.03, h: 0.012, axis: 'z' }, at: [0, 0.17, 0.122], turn: [-8, 0, 0], mat: 'bronze', lods: H },
  { bone: 'chest', shape: { kind: 'cyl', r: 0.022, h: 0.012, axis: 'z' }, at: [0, 0.17, 0.126], turn: [-8, 0, 0], mat: 'core', lods: HS },

  // ——— Neck and head: a black glass helmet, the visor the face is drawn on, pale ear plates with rings ———
  { bone: 'neck', shape: { kind: 'cyl', r: 0.044, h: 0.14 }, at: [0, 0.04, 0], mat: 'rubber', lods: HS },
  { bone: 'neck', shape: { kind: 'ring', r: 0.052, tube: 0.005 }, at: [0, -0.012, 0], mat: 'seam', lods: H },
  { bone: 'head', shape: { kind: 'ball', r: 0.11, sides: 32, rings: 20 }, at: [0, 0.1, -0.005], scale: [0.95, 1.1, 1.1], mat: 'gloss', lods: HS },
  { bone: 'head', shape: { kind: 'ball', r: 0.06, sides: 24, rings: 12 }, at: [0, -0.02, 0.03], scale: [1.0, 0.9, 1.0], mat: 'gloss', lods: HS },
  { bone: 'head', shape: { kind: 'panel', r: 0.125, h: 0.1, arc: 130 }, at: [0, 0.085, -0.006], mat: 'visor', lods: HS },
  { bone: 'head', shape: { kind: 'box', size: [0.014, 0.12, 0.034], radius: 0.006 }, at: [0.098, 0.075, -0.017], mat: 'steel', lods: HS, mirror: true },
  { bone: 'head', shape: { kind: 'cyl', r: 0.033, h: 0.014, axis: 'x' }, at: [0.104, 0.088, -0.017], mat: 'steel', lods: H, mirror: true },
  { bone: 'head', shape: { kind: 'cyl', r: 0.022, h: 0.016, axis: 'x' }, at: [0.106, 0.088, -0.017], mat: 'gloss', lods: H, mirror: true },
  { bone: 'head', shape: { kind: 'ring', r: 0.027, tube: 0.0022 }, at: [0.111, 0.088, -0.017], turn: [0, 0, 90], mat: 'seam', lods: H, mirror: true },
  { bone: 'head', shape: { kind: 'ball', r: 0.016, cap: 90 }, at: [0, 0.205, -0.075], turn: [-35, 0, 0], mat: 'beacon', lods: HS },

  // ——— Shoulder: a broad deltoid ———
  { bone: 'clavicle.L', shape: { kind: 'ball', r: 0.09, cap: 100 }, at: [0.174, -0.018, 0], turn: [0, 0, -15], scale: [1.0, 0.87, 1.07], mat: 'shell', lods: HS },
  { bone: 'clavicle.L', shape: { kind: 'cyl', r: 0.026, h: 0.14, axis: 'x' }, at: [0.07, -0.025, 0], mat: 'rubber', lods: H },

  // ——— Arm: white outside, black glass inside ———
  { bone: 'upperArm.L', shape: { kind: 'ball', r: 0.05 }, at: [0, 0, 0], mat: 'gloss', lods: H },
  { bone: 'upperArm.L', shape: { kind: 'cyl', r: 0.071, r2: 0.055, h: 0.25 }, at: [0, -0.13, 0], mat: 'shell', lods: HS },
  { bone: 'upperArm.L', shape: { kind: 'box', size: [0.022, 0.22, 0.07], radius: 0.008 }, at: [-0.054, -0.13, 0], mat: 'gloss', lods: HS },
  { bone: 'foreArm.L', shape: { kind: 'cyl', r: 0.034, h: 0.08, axis: 'x' }, at: [0, 0, 0], mat: 'gloss', lods: H },
  { bone: 'foreArm.L', shape: { kind: 'cyl', r: 0.056, r2: 0.04, h: 0.24 }, at: [0, -0.13, 0], mat: 'shell', lods: HS },
  { bone: 'foreArm.L', shape: { kind: 'box', size: [0.02, 0.2, 0.06], radius: 0.008 }, at: [-0.045, -0.13, 0], mat: 'gloss', lods: HS },
  { bone: 'foreArm.L', shape: { kind: 'ring', r: 0.033, tube: 0.006 }, at: [0, -0.262, 0], mat: 'steel', lods: H },
  // The hand, black glass.
  { bone: 'hand.L', shape: { kind: 'box', size: [0.03, 0.09, 0.074], radius: 0.012 }, at: [-0.002, -0.05, 0], mat: 'gloss', lods: HS },
  { bone: 'hand.L', shape: { kind: 'box', size: [0.012, 0.08, 0.07], radius: 0.005 }, at: [0.015, -0.048, 0], mat: 'rubber', lods: H },
  ...FINGERS.map((z): PartSpec => ({ bone: 'fingers.L', shape: { kind: 'box', size: [0.017, 0.05, 0.016], radius: 0.006 }, at: [0, -0.024, z], mat: 'gloss', lods: H })),
  ...FINGERS.map((z): PartSpec => ({ bone: 'tips.L', shape: { kind: 'box', size: [0.016, 0.044, 0.015], radius: 0.006 }, at: [0, -0.021, z], mat: 'gloss', lods: H })),
  { bone: 'fingers.L', shape: { kind: 'box', size: [0.018, 0.05, 0.07], radius: 0.007 }, at: [0, -0.024, 0], mat: 'gloss', lods: STANDARD },
  { bone: 'tips.L', shape: { kind: 'box', size: [0.017, 0.044, 0.068], radius: 0.007 }, at: [0, -0.021, 0], mat: 'gloss', lods: STANDARD },
  { bone: 'thumb.L', shape: { kind: 'box', size: [0.017, 0.05, 0.017], radius: 0.006 }, at: [0, -0.022, 0.004], turn: [20, 0, 0], mat: 'gloss', lods: HS },
  // Tendons behind the elbow.
  { bone: 'armPiston.L', shape: { kind: 'cyl', r: 0.011, h: 0.14 }, at: [0, 0.07, 0], mat: 'rubber', lods: H },
  { bone: 'armRod.L', shape: { kind: 'cyl', r: 0.006, h: 0.15 }, at: [0, 0.075, 0], mat: 'steel', lods: H },

  // ——— Leg: white over the front and outside, black glass inside and behind ———
  { bone: 'thigh.L', shape: { kind: 'cyl', r: 0.108, r2: 0.07, h: 0.42 }, at: [0, -0.2, 0], mat: 'shell', lods: HS },
  { bone: 'thigh.L', shape: { kind: 'box', size: [0.03, 0.36, 0.1], radius: 0.01 }, at: [-0.082, -0.19, 0], mat: 'gloss', lods: HS },
  { bone: 'shin.L', shape: { kind: 'cyl', r: 0.038, h: 0.1, axis: 'x' }, at: [0, 0, 0], mat: 'gloss', lods: H },
  { bone: 'shin.L', shape: { kind: 'box', size: [0.074, 0.076, 0.04], radius: 0.018 }, at: [0, 0.004, 0.052], turn: [-6, 0, 0], mat: 'shell', lods: HS },
  { bone: 'shin.L', shape: { kind: 'cyl', r: 0.07, r2: 0.045, h: 0.4 }, at: [0, -0.2, 0], mat: 'shell', lods: HS },
  { bone: 'shin.L', shape: { kind: 'box', size: [0.07, 0.3, 0.025], radius: 0.01 }, at: [0, -0.17, -0.056], mat: 'gloss', lods: HS },
  { bone: 'foot.L', shape: { kind: 'ball', r: 0.04 }, at: [0, 0, 0], mat: 'rubber', lods: H },
  { bone: 'foot.L', shape: { kind: 'box', size: [0.1, 0.08, 0.25], top: [0.085, 0.175], radius: 0.03 }, at: [0, -0.055, 0.045], mat: 'shell', lods: HS },
  { bone: 'foot.L', shape: { kind: 'box', size: [0.1, 0.012, 0.25], radius: 0.004 }, at: [0, -0.094, 0.045], mat: 'rubber', lods: HS },
  { bone: 'legPiston.L', shape: { kind: 'cyl', r: 0.013, h: 0.22 }, at: [0, 0.11, 0], mat: 'rubber', lods: H },
  { bone: 'legRod.L', shape: { kind: 'cyl', r: 0.007, h: 0.23 }, at: [0, 0.115, 0], mat: 'steel', lods: H },

  // ——— Crowd: the same figure in a few shapes ———
  { bone: 'pelvis', shape: { kind: 'box', size: [0.27, 0.18, 0.18] }, at: [0, -0.02, 0], mat: 'shell', lods: C },
  { bone: 'spine', shape: { kind: 'box', size: [0.2, 0.24, 0.15] }, at: [0, 0.08, 0], mat: 'gloss', lods: C },
  { bone: 'chest', shape: { kind: 'box', size: [0.27, 0.28, 0.21], top: [0.3, 0.17] }, at: [0, 0.17, 0], mat: 'shell', lods: C },
  { bone: 'chest', shape: { kind: 'box', size: [0.22, 0.08, 0.18] }, at: [0, -0.01, 0], mat: 'gloss', lods: C },
  { bone: 'chest', shape: { kind: 'box', size: [0.04, 0.04, 0.02] }, at: [0, 0.17, 0.12], mat: 'core', lods: C },
  { bone: 'neck', shape: { kind: 'box', size: [0.08, 0.14, 0.08] }, at: [0, 0.04, 0], mat: 'rubber', lods: C },
  { bone: 'head', shape: { kind: 'ball', r: 0.11, sides: 8, rings: 6 }, at: [0, 0.1, -0.005], scale: [0.95, 1.1, 1.1], mat: 'gloss', lods: C },
  { bone: 'head', shape: { kind: 'box', size: [0.17, 0.08, 0.02] }, at: [0, 0.085, 0.112], mat: 'visor', lods: C },
  { bone: 'clavicle.L', shape: { kind: 'ball', r: 0.09, cap: 100, sides: 8, rings: 3 }, at: [0.174, -0.018, 0], turn: [0, 0, -15], mat: 'shell', lods: C },
  { bone: 'upperArm.L', shape: { kind: 'box', size: [0.12, 0.27, 0.12] }, at: [0, -0.13, 0], mat: 'shell', lods: C },
  { bone: 'foreArm.L', shape: { kind: 'box', size: [0.1, 0.26, 0.1] }, at: [0, -0.13, 0], mat: 'shell', lods: C },
  { bone: 'hand.L', shape: { kind: 'box', size: [0.03, 0.15, 0.07] }, at: [0, -0.07, 0], mat: 'gloss', lods: C },
  { bone: 'thigh.L', shape: { kind: 'box', size: [0.17, 0.42, 0.18] }, at: [0, -0.2, 0], mat: 'shell', lods: C },
  { bone: 'shin.L', shape: { kind: 'box', size: [0.12, 0.42, 0.12] }, at: [0, -0.2, 0], mat: 'shell', lods: C },
  { bone: 'foot.L', shape: { kind: 'box', size: [0.1, 0.09, 0.25] }, at: [0, -0.05, 0.045], mat: 'shell', lods: C },
];
