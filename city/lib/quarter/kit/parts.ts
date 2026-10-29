import { PALETTE } from '../../palette.ts';

/**
 * A building is drawn as a list of parts: a unit shape, where it stands, how big it is, how its surface looks and how
 * its light moves. Parts of the same shape across every building on screen share one instanced draw call, so a whole
 * district of quarters costs a couple of dozen draw calls. Plain numbers only: the renderer turns them into matrices.
 */

export type Vec3 = readonly [number, number, number];
/** Linear RGB, the colour space the city's shaders light in; above 1 it blooms. */
export type Rgb = readonly [number, number, number];

/**
 * Unit shapes. All stand on y = 0 and fill x and z from -0.5 to 0.5, so `size` is width, height and depth —
 * except the torus (a flat ring centred on y = 0, `size.y` scales the tube) and the disc (a flat circle on the ground).
 */
export const SHAPES = ['box', 'chamfer', 'prism', 'cyl', 'cone', 'pyramid', 'dome', 'gable', 'wedge', 'torus', 'sphere', 'quad', 'disc'] as const;
export type Shape = (typeof SHAPES)[number];

/** Surfaces the kit material knows. The number is what the shader switches on. */
export const STYLES = {
  plain: 0,
  graphite: 1,
  glass: 2,
  ceramic: 3,
  steel: 4,
  shop: 5,
  light: 6,
  screen: 7,
  water: 8,
  foliage: 9,
  cloth: 10,
  stone: 11,
  roof: 12,
  metal: 13,
  pool: 14,
} as const;
export type Style = keyof typeof STYLES;

/** How a part moves or how its light changes over time, all in the shader. */
export const MOTIONS = {
  none: 0,
  blink: 1,
  pulse: 2,
  flicker: 3,
  flow: 4,
  chase: 5,
  spin: 6,
  hover: 7,
  wave: 8,
  ticker: 9,
  board: 10,
  ad: 11,
} as const;
export type Motion = keyof typeof MOTIONS;

/** Which levels of detail draw a part: near (close up, build mode), mid (the street), far (the district). */
export const NEAR = 1;
export const MID = 2;
export const FAR = 4;
export const ALL = NEAR | MID | FAR;

export type Part = {
  shape: Shape;
  style: Style;
  /** Where the bottom centre of the shape stands, in building space (y up, the front faces +z). */
  at: Vec3;
  /** Width, height, depth. */
  size: Vec3;
  /** Rotation in radians around x, y, z (applied in that order). */
  turn: Vec3;
  /** Surface colour. */
  tint: Rgb;
  /** Window light, or the light itself for light, screen and pool parts. */
  glow: Rgb;
  /** Light seams, kerb lines and stripes. */
  accent: Rgb;
  /** Share of windows lit (0–1), or how bright a light burns. */
  power: number;
  /** Window size: 1 for storeys a person reads as rooms, 0.5 for tower facades like the skyline's. */
  grain: number;
  motion: Motion;
  speed: number;
  phase: number;
  /** A lit door in the middle of the front face. */
  door: boolean;
  /** A thin light line along the top edge of the side faces. */
  kerb: boolean;
  /** Mask of NEAR, MID and FAR. */
  lods: number;
};

export type BuildingPlan = {
  parts: Part[];
  /** Axis-aligned bounds in building space. */
  min: Vec3;
  max: Vec3;
  /** The sphere the level of detail is measured against. */
  center: Vec3;
  radius: number;
};

/** sRGB hex → linear RGB, the same conversion three.js applies to the city's palette uniforms. */
export function linear(hex: string, scale = 1): Rgb {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const c = (v: number) => {
    const s = v / 255;
    return (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * scale;
  };
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scaled = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];

/** The AFTERGLOW palette in linear light. Mint is kept for value and flare for danger. */
export const C = {
  ink: linear(PALETTE.ink),
  graphite: linear(PALETTE.graphite),
  pearl: linear(PALETTE.pearl),
  violet: linear(PALETTE.violet),
  haze: linear(PALETTE.violetHaze),
  amber: linear(PALETTE.amber),
  warm: linear(PALETTE.warmWhite),
  ice: linear(PALETTE.ice),
  mint: linear(PALETTE.mint),
  flare: linear(PALETTE.flare),
  water: linear('#0D0820'),
  steel: linear('#2E2C3A'),
  metal: linear('#4A4658'),
  leaf: linear('#1B2624'),
  stone: linear('#15131F'),
} as const;

/** The extent of each unit shape, for bounds. */
function unitBox(shape: Shape): [Vec3, Vec3] {
  if (shape === 'torus') return [[-0.5, -0.05, -0.5], [0.5, 0.05, 0.5]];
  if (shape === 'disc') return [[-0.5, 0, -0.5], [0.5, 0, 0.5]];
  if (shape === 'quad') return [[-0.5, 0, 0], [0.5, 1, 0]];
  return [[-0.5, 0, -0.5], [0.5, 1, 0.5]];
}

/** Rotates a point by turn (x, then y, then z), as three.js does for Euler order XYZ applied to a vector. */
export function rotate(p: Vec3, turn: Vec3): Vec3 {
  let [x, y, z] = p;
  const [ax, ay, az] = turn;
  // three.js XYZ order: the matrix is Rx · Ry · Rz, so a vector is turned around z first, then y, then x.
  if (az) [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
  if (ay) [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
  if (ax) [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
  return [x, y, z];
}

/** The axis-aligned box a part fills in building space. */
export function partBounds(part: Part): [Vec3, Vec3] {
  const [lo, hi] = unitBox(part.shape);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i += 1) {
    const corner: Vec3 = [(i & 1 ? hi[0] : lo[0]) * part.size[0], (i & 2 ? hi[1] : lo[1]) * part.size[1], (i & 4 ? hi[2] : lo[2]) * part.size[2]];
    const p = rotate(corner, part.turn);
    for (let k = 0; k < 3; k += 1) {
      const v = p[k]! + part.at[k]!;
      min[k] = Math.min(min[k]!, v);
      max[k] = Math.max(max[k]!, v);
    }
  }
  return [min as unknown as Vec3, max as unknown as Vec3];
}

export function planOf(parts: Part[]): BuildingPlan {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const [lo, hi] = partBounds(part);
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k]!, lo[k]!);
      max[k] = Math.max(max[k]!, hi[k]!);
    }
  }
  if (!parts.length) return { parts, min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 0 };
  const center: Vec3 = [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2];
  const radius = Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) / 2;
  return { parts, min: min as unknown as Vec3, max: max as unknown as Vec3, center, radius };
}
