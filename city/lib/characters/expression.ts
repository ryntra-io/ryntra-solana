import { PALETTE } from '../palette.ts';

/**
 * What the light says: the face drawn on the visor and the lights on the body. Emotion lives here, not in text — eyes
 * that narrow, arc or cross, a mouth that talks or laughs, a scan bar while thinking, the chest core and the seams
 * brightening while acting, a hologram over the hand, a beacon in alarm. Every channel is a number, so two expressions
 * blend by mixing numbers, the same way two poses blend.
 */

/** Visor colours, from the city's palette (`city/lib/palette.ts`, AFTERGLOW). Flare is danger only; mint is never worn. */
export const HUES = {
  /** Stored sun: calm, ready. */
  amber: PALETTE.amber,
  /** The hot edge of amber: thinking, pleased. */
  warm: PALETTE.warmWhite,
  /** Danger, and only when it is true: an alarm, a broken vault (dimmed by `glow`, it is the ember after a defeat). */
  flare: PALETTE.flare,
} as const;
export type Hue = keyof typeof HUES;

export const CHANNELS = [
  // Visor colour, linear RGB.
  'r',
  'g',
  'b',
  /** Visor brightness (1 normal; above 1 it blooms harder). */
  'glow',
  /** Eye openness: 0 shut, 1 normal, 1.3 wide. */
  'open',
  /** 0 flat bars, 1 happy arcs (^ ^). */
  'arc',
  /** −1 worried (outer ends down), +1 stern (inner ends down). */
  'slant',
  /** Eye width (1 normal). */
  'size',
  /** Where the eyes look on the visor, −1 … 1. */
  'gazeX',
  'gazeY',
  /** Mouth openness 0 … 1. */
  'mouth',
  /** −1 frown, +1 smile. */
  'smile',
  /** Mouth width (1 normal). */
  'wide',
  /** Speech: a wave runs along the mouth, 0 … 1. */
  'talk',
  /** A scan bar sweeps the eyes (thinking), 0 … 1. */
  'scan',
  /** A broken visor: flicker and torn lines, 0 … 1. */
  'glitch',
  /** Crossed-out eyes (x x), 0 … 1. */
  'cross',
  /** The chest core's light, 0 dark … 1 normal … 2 blazing. */
  'core',
  /** The light seams on the armour. */
  'seams',
  /** The hologram over the left hand, 0 … 1. */
  'holo',
  /** The alarm beacon, 0 … 1. */
  'beacon',
  /** How much the head follows a look target, 0 … 1. */
  'look',
] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_COUNT = CHANNELS.length;
export const CH = Object.fromEntries(CHANNELS.map((c, i) => [c, i])) as { readonly [K in Channel]: number };

/** An expression as authored: a hue by name and any channels to change. */
export type ExpressionSpec = Partial<Omit<Record<Channel, number>, 'r' | 'g' | 'b'>> & { hue?: Hue };

/** sRGB hex → linear, as three.js reads the palette. */
export function linearHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}

/** Calm and ready: amber visor, open eyes, a closed mouth, the core and seams at rest. */
export const CALM: Readonly<Record<Channel, number>> = (() => {
  const [r, g, b] = linearHex(HUES.amber);
  return {
    r, g, b,
    glow: 1, open: 1, arc: 0, slant: 0, size: 1, gazeX: 0, gazeY: 0,
    mouth: 0, smile: 0.1, wide: 1, talk: 0, scan: 0, glitch: 0, cross: 0,
    core: 0.8, seams: 0.6, holo: 0, beacon: 0, look: 1,
  };
})();

/** A full expression from a spec laid over `base`. */
export function expression(spec: ExpressionSpec, base: ArrayLike<number> = toArray(CALM)): Float32Array {
  const out = new Float32Array(CHANNEL_COUNT);
  for (let i = 0; i < CHANNEL_COUNT; i += 1) out[i] = base[i]!;
  for (const [key, value] of Object.entries(spec)) {
    if (key === 'hue') {
      const [r, g, b] = linearHex(HUES[value as Hue]);
      out[CH.r] = r;
      out[CH.g] = g;
      out[CH.b] = b;
    } else if (key in CH) {
      out[CH[key as Channel]] = value as number;
    } else {
      throw new Error(`unknown expression channel ${key}`);
    }
  }
  return out;
}

export function toArray(e: Readonly<Record<Channel, number>>): Float32Array {
  return Float32Array.from(CHANNELS.map((c) => e[c]));
}

/** out = a + (b − a)·t, channel by channel. `out` may alias a. */
export function mixExpression(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: Float32Array): Float32Array {
  for (let i = 0; i < CHANNEL_COUNT; i += 1) out[i] = a[i]! + (b[i]! - a[i]!) * t;
  return out;
}
