/**
 * The scene's budget by frame rate (CITY-6a): one ladder of rungs from the richest picture to the cheapest. Each rung
 * is a quality tier and a pixel ratio; a device starts on the rung its hints allow, and the measured frame rate moves
 * it one rung at a time (two when the frame rate collapses). The tier sets what the scene spends: bloom, particles,
 * traffic and the cheap-but-not-free full-screen touches (grain, colour fringe, shockwave). The city has no shadow
 * maps: its light is emissive, so there are none to cut. It also sets what the Blender skyline spends (CITY-56):
 * levels of detail, the reflection cube, the rooms behind the windows and the life on the streets. In the graphics
 * pass's words the tiers are High (high), Balanced (mid) and Lite (low).
 */

export type Quality = 'high' | 'mid' | 'low';

export type Budget = {
  /** Bloom mip levels and the bloom's own resolution, a share of the composer's. */
  bloomLevels: number;
  bloomScale: number;
  bloomIntensity: number;
  /** Grain, colour fringe and the impact shockwave: off on the cheapest tier. */
  touches: boolean;
  /** SMAA on the composed frame: thin fins, masts and rails without stair steps (CITY-56). */
  smaa: boolean;
  embers: number;
  drones: number;
  /** People on the pavements: impostors once the skyline kit is on the screen, light capsules until then. */
  walkers: number;
  /**
   * The skyline's levels of detail: a tower moves to a nearer level once one of its storeys is this many pixels tall
   * on the screen (0 close: fins and slabs are geometry; 1 street; 2 district; below the last it is one block).
   * Infinity: the close level is never drawn.
   */
  lod: readonly [number, number, number];
  /** The size of the captured reflection cube; 0 and the glass reflects the analytic sky only. */
  reflections: number;
  /** Rooms behind the windows (interior mapping); off, a window shows the average of its room. */
  rooms: boolean;
  cars: number;
  /** Every how many street lights stand (1: every one). */
  lampStep: number;
};

export const BUDGET: Readonly<Record<Quality, Budget>> = Object.freeze({
  high: {
    bloomLevels: 8, bloomScale: 0.5, bloomIntensity: 1.05, touches: true, smaa: true, embers: 900, drones: 220, walkers: 900,
    lod: [9, 2, 0.7], reflections: 256, rooms: true, cars: 360, lampStep: 1,
  },
  mid: {
    bloomLevels: 6, bloomScale: 0.35, bloomIntensity: 1, touches: true, smaa: true, embers: 600, drones: 160, walkers: 600,
    lod: [13, 2.8, 1], reflections: 128, rooms: true, cars: 220, lampStep: 1,
  },
  low: {
    bloomLevels: 4, bloomScale: 0.25, bloomIntensity: 0.85, touches: false, smaa: false, embers: 300, drones: 90, walkers: 300,
    lod: [Infinity, 4, 1.4], reflections: 0, rooms: false, cars: 110, lampStep: 2,
  },
});

export type Rung = { quality: Quality; dpr: number };

/** Richest first. The pixel ratio is also the composer's resolution: every pass renders at the canvas's size. */
export const LADDER: readonly Rung[] = Object.freeze([
  { quality: 'high', dpr: 1.75 },
  { quality: 'high', dpr: 1.5 },
  { quality: 'mid', dpr: 1.25 },
  { quality: 'mid', dpr: 1 },
  { quality: 'low', dpr: 1 },
  { quality: 'low', dpr: 0.85 },
  { quality: 'low', dpr: 0.75 },
]);

export type Device = {
  /** A touch screen as the main pointer: a phone or a tablet. */
  coarse: boolean;
  /** navigator.hardwareConcurrency and navigator.deviceMemory (GB), when the browser tells. */
  cores?: number;
  memory?: number;
  /** The screen's own pixel ratio: the scene never renders above it. */
  dpr: number;
  /** The visitor asked the browser to save data. */
  saveData?: boolean;
};

/** Where a device may climb to and where it starts: the rung's index on the ladder. */
export type Range = { top: number; start: number };

const index = (quality: Quality, dpr: number) => LADDER.findIndex((r) => r.quality === quality && r.dpr === dpr);

/**
 * The device's range from its hints. A desk may climb to the top and starts there. A touch screen tops out at
 * high × 1.5 and starts at mid × 1.25; a weak one (≤ 4 cores or ≤ 3 GB) or one saving data starts at low × 1.
 * `asked` (`?quality=high|mid|low`) pins the start for a test and keeps the top.
 */
export function rangeFor(device: Device, asked?: string | null): Range {
  const top = device.coarse ? index('high', 1.5) : 0;
  const weak = (device.cores != null && device.cores <= 4) || (device.memory != null && device.memory <= 3) || !!device.saveData;
  let start = device.coarse ? (weak ? index('low', 1) : index('mid', 1.25)) : weak ? index('mid', 1.25) : 0;
  if (asked === 'high' || asked === 'mid' || asked === 'low') start = Math.max(top, LADDER.findIndex((r) => r.quality === asked));
  return { top, start: Math.max(top, start) };
}

/** The pixel ratio the canvas renders at on this rung: never above the screen's own. */
export function dprAt(rung: number, screenDpr: number): number {
  const r = LADDER[clamp(rung, 0, LADDER.length - 1)]!;
  return Math.min(r.dpr, Math.max(0.5, screenDpr || 1));
}

/** Two rungs that draw the same picture on this screen: the same tier at the same pixel ratio after the cap. */
const same = (a: number, b: number, screenDpr: number) => LADDER[a]!.quality === LADDER[b]!.quality && dprAt(a, screenDpr) === dprAt(b, screenDpr);

/**
 * A step down: one rung, or two when the frame rate has collapsed below `collapse`. A rung that draws the same picture
 * on this screen (a pixel ratio the screen does not have) is passed over. Never past the bottom.
 */
export function stepDown(rung: number, screenDpr: number, fps?: number, collapse = 20): number {
  let next = rung;
  for (let steps = fps != null && fps < collapse ? 2 : 1; steps > 0; steps--) {
    const from = next;
    do next = Math.min(LADDER.length - 1, next + 1);
    while (next < LADDER.length - 1 && same(next, from, screenDpr));
  }
  return next;
}

/** A step up: one rung that draws a different picture, never above the device's top. */
export function stepUp(rung: number, top: number, screenDpr: number): number {
  let next = rung;
  do next = Math.max(top, next - 1);
  while (next > top && same(next, rung, screenDpr));
  return same(next, rung, screenDpr) ? rung : next;
}

/** The mean of the frame-rate samples behind a verdict: one slow sample (a tab coming back) is not a collapse. */
export function meanFps(samples: readonly number[]): number | undefined {
  return samples.length ? samples.reduce((sum, fps) => sum + fps, 0) / samples.length : undefined;
}

/** How often the rung may change direction before it settles: down, up, down, up — then it stays on the cheaper one. */
export const ROCKING_TURNS = 3;

/** The rung's story in this visit: where it is, the cheapest it has been, the last direction and the turns so far. */
export type Moves = { rung: number; worst: number; last: -1 | 0 | 1; turns: number; settled: boolean };

export const startMoves = (rung: number): Moves => ({ rung, worst: rung, last: 0, turns: 0, settled: false });

/**
 * The rung after the monitor asks for `next`. A step that changes nothing (a climb at the top) is no move, so a
 * device that keeps up stays where it is for the whole visit. A move back the other way is a turn; after
 * `ROCKING_TURNS` the city settles on the cheapest rung it has visited, and from then on it only steps down.
 */
export function move(m: Moves, next: number): Moves {
  if (next === m.rung) return m;
  const dir = next > m.rung ? 1 : -1;
  if (m.settled && dir < 0) return m;
  const turns = m.last !== 0 && dir !== m.last ? m.turns + 1 : m.turns;
  const worst = Math.max(m.worst, next);
  if (!m.settled && turns >= ROCKING_TURNS) return { rung: worst, worst, last: 1, turns, settled: true };
  return { rung: next, worst, last: dir, turns, settled: m.settled };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
