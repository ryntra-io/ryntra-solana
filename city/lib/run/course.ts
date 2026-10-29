import { hashString, rng, type CityLayout } from '../city/layout.ts';

/**
 * Skyline Run's course of the day. One path for both forms, so flight and rooftops are tested on the same
 * length, turns and climbs; only the obstacles differ, and they follow the same beat schedule.
 *
 * The path is planned through the frozen city of the day: it starts over the southern sea, spirals twice
 * through the skyline and climbs over the Sol Spire toward the Eclipse. An elastic band pushes it away from
 * every tower (with its crown and sign) and every rail, so the corridor is always open air: towers are the
 * near misses, our own structures are the obstacles. Market data never moves anything once the day is frozen.
 */

export type RunForm = 'flight' | 'roofs';
export const RUN_FORMS: readonly RunForm[] = ['flight', 'roofs'];

/** Sample spacing along the course. */
export const DS = 0.5;
/** Widest lateral half-width of the corridor; it narrows only where towers press in. */
export const TUBE_W = 4.5;
/** Vertical half-height of the flight corridor. */
export const TUBE_H = 3;
/** The corridor never squeezes below this half-width. */
export const MIN_W = 2.6;
/** Rooftops: distance between lane centres. */
export const LANE_W = 2.4;
/** Rooftops: the deck below the running line. */
export const DECK = 0.7;

export type Tone = 'amber' | 'violet' | 'flare' | 'ice' | 'warm';
/** `mark` is drawn but never touched (the risky lane's red deck). */
export type ObstacleKind = 'block' | 'divider' | 'glass' | 'ring' | 'break' | 'save' | 'finish' | 'mark';
export type Motion = { axis: 'u' | 'h'; amp: number; period: number; phase: number };

/** A box in course space: along (s), across (u, right is +) and up (h, from the centreline or the deck). */
export type Obstacle = {
  id: number;
  kind: ObstacleKind;
  s0: number;
  s1: number;
  u0: number;
  u1: number;
  h0: number;
  h1: number;
  move?: Motion;
  tone: Tone;
  /** What the player hit, for the result line and the run log. */
  tag: string;
};

export type ChannelName = 'safe' | 'fast' | 'risky';
export type Channel = { name: ChannelName; u0: number; u1: number; speed: number };
export type Fork = { s0: number; s1: number; channels: [Channel, Channel, Channel] };

export type Course = {
  id: string;
  day: string;
  form: RunForm;
  worldKey: string;
  length: number;
  count: number;
  pos: Float32Array;
  tan: Float32Array;
  nor: Float32Array;
  up: Float32Array;
  /** Allowed lateral half-width at each sample. */
  width: Float32Array;
  /** Rooftops only: deck height per lane (3 × count), NaN where there is a gap. */
  ground: Float32Array | null;
  obstacles: Obstacle[];
  forks: Fork[];
  nodeS: number;
  finishS: number;
  /** City rails that cross the corridor; the scene hides them during a run. */
  hiddenRails: number[];
  /** The first obstacle of each kind, with the one line that teaches it (shown on the first runs). */
  cues: { s: number; text: string }[];
};

type P = { x: number; y: number; z: number };

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A short fingerprint of the frozen city, so a course and its ghost always belong to the same world. */
export function worldKey(layout: CityLayout): string {
  let text = '';
  for (const t of layout.towers) text += `${t.tower.id.slice(0, 6)}${t.x.toFixed(1)}${t.z.toFixed(1)}${t.height.toFixed(1)}|`;
  return hashString(text).toString(36);
}

export function buildCourse(layout: CityLayout, form: RunForm, day: string): Course {
  const seed = hashString(`${day}:skyline-run`);
  const key = worldKey(layout);
  const route = relax(baseRoute(seed), obstaclesOf(layout));
  const path = resample(route);
  const count = path.length;
  const pos = new Float32Array(count * 3);
  path.forEach((p, i) => pos.set([p.x, p.y, p.z], i * 3));
  const { tan, nor, up } = frames(pos, count);
  const width = corridorWidth(pos, count, layout);
  const length = (count - 1) * DS;
  const plan = schedule(length, seed);
  const course: Course = {
    id: `${day}:${form}:${key}`,
    day,
    form,
    worldKey: key,
    length,
    count,
    pos,
    tan,
    nor,
    up,
    width,
    ground: null,
    obstacles: [],
    forks: plan.forks,
    nodeS: plan.nodeS,
    finishS: plan.finishS,
    hiddenRails: railsInCorridor(layout, pos, count),
    cues: [],
  };
  if (form === 'flight') placeFlight(course, plan, seed);
  else placeRoofs(course, plan, seed);
  return course;
}

/* ------------------------------------------------------------------------------------------------ */
/* The path                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

/** Over the sea, two tightening turns through the skyline with a rolling altitude, then the climb to the crown. */
function baseRoute(seed: number): P[] {
  const random = rng(seed);
  const dir = random() < 0.5 ? 1 : -1;
  const phase = random() * Math.PI * 2;
  const pts: P[] = [];
  for (let i = 0; i <= 30; i += 1) {
    const t = i / 30;
    pts.push({ x: -dir * 7 * Math.sin(t * Math.PI), y: 56 - 22 * smooth(t), z: 132 - 66 * t });
  }
  const steps = 560;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const a = Math.PI + dir * 4 * Math.PI * t;
    const r = 66 - 38 * t;
    let y = 33 + 8 * Math.sin(phase + 6 * Math.PI * t);
    if (t > 0.8) y += smooth((t - 0.8) / 0.2) * 34;
    pts.push({ x: Math.sin(a) * r, y, z: -Math.cos(a) * r });
  }
  const last = pts[pts.length - 1]!;
  for (let i = 1; i <= 64; i += 1) {
    const t = i / 64;
    pts.push({ x: last.x * (1 - t), y: last.y + (98 - last.y) * smooth(Math.min(1, t * 2)), z: last.z + (-40 - last.z) * t });
  }
  return pts;
}

type Cylinder = { x: number; z: number; r: number; top: number };
type Obstacles = { towers: Cylinder[]; rails: P[] };

/** Every tower as a cylinder up to the top of its sign, and every rail as a string of points. */
function obstaclesOf(layout: CityLayout): Obstacles {
  const towers = layout.towers.map((t) => {
    const sol = Math.abs(t.x) < 1e-6 && Math.abs(t.z) < 1e-6;
    const sign = Math.max(3.4, t.width * 1.3) * (sol ? 1.5 : 1);
    const lift = t.kind === 3 ? 2.2 : t.width * 1.2 + 2.6;
    const halo = t.kind === 0 && t.height > 36;
    return { x: t.x, z: t.z, r: Math.max(t.width * (halo ? 1.5 : 1.12), sign * 0.5) + 0.3, top: t.height + lift + sign * 0.62 };
  });
  const rails: P[] = [];
  for (const rail of layout.rails) {
    const [ax, ay, az] = rail.a;
    const [bx, by, bz] = rail.b;
    const span = Math.hypot(bx - ax, by - ay, bz - az);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2 + rail.arch + span * 0.06;
    const mz = (az + bz) / 2;
    const n = Math.max(6, Math.ceil(span / 2.5));
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const k0 = (1 - t) * (1 - t);
      const k1 = 2 * (1 - t) * t;
      const k2 = t * t;
      rails.push({ x: k0 * ax + k1 * mx + k2 * bx, y: k0 * ay + k1 * my + k2 * by, z: k0 * az + k1 * mz + k2 * bz });
    }
  }
  return { towers, rails };
}

/**
 * The elastic band: push each point out of every tower and rail it is too close to, then smooth, ninety times.
 * In the final climb the band prefers to rise over a tower rather than swing around it.
 */
function relax(input: P[], obstacles: Obstacles): P[] {
  const pts = input.map((p) => ({ ...p }));
  const n = pts.length;
  const head = 4;
  const tail = 2;
  // Only obstacles near the base route can matter; the band moves a few units at most.
  const near = pts.map((p) => ({
    towers: obstacles.towers.filter((o) => Math.hypot(o.x - p.x, o.z - p.z) < o.r + TUBE_W + 26),
    rails: obstacles.rails.filter((q) => Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < TUBE_W + 22),
  }));
  const copy = pts.map((p) => ({ ...p }));
  const pushOut = (factor: number) => {
    for (let i = head; i < n - tail; i += 1) {
      const p = pts[i]!;
      const late = i / n > 0.9;
      for (const o of near[i]!.towers) {
        const over = o.top - (p.y - TUBE_H - 0.6);
        if (over <= 0) continue;
        const dx = p.x - o.x;
        const dz = p.z - o.z;
        const d = Math.hypot(dx, dz);
        const need = o.r + TUBE_W + 0.5;
        if (d >= need) continue;
        // A tower that barely reaches the corridor is cleared by rising over it; a tall one by stepping around.
        if (over < (late ? 30 : 22)) {
          p.y += (over + 0.4) * factor;
          continue;
        }
        const push = (need - d) * factor;
        if (d < 1e-3) {
          const q = pts[i + 1]!;
          const tx = q.x - p.x;
          const tz = q.z - p.z;
          const l = Math.hypot(tx, tz) || 1;
          p.x += (-tz / l) * push;
          p.z += (tx / l) * push;
        } else {
          p.x += (dx / d) * push;
          p.z += (dz / d) * push;
        }
      }
      if (p.y < 24) p.y = 24;
    }
  };
  const smoothOnce = () => {
    for (let i = 0; i < n; i += 1) Object.assign(copy[i]!, pts[i]!);
    for (let i = head; i < n - tail; i += 1) {
      const a = copy[i - 1]!;
      const b = copy[i]!;
      const c = copy[i + 1]!;
      pts[i]!.x = (a.x + 2 * b.x + c.x) / 4;
      pts[i]!.y = (a.y + 2 * b.y + c.y) / 4;
      pts[i]!.z = (a.z + 2 * b.z + c.z) / 4;
    }
  };
  for (let it = 0; it < 120; it += 1) {
    pushOut(0.5);
    smoothOnce();
  }
  // The last word belongs to the constraints: push until clear, with only a light smoothing in between.
  for (let it = 0; it < 40; it += 1) {
    pushOut(0.6);
    if (it % 4 === 3) smoothOnce();
  }
  pushOut(1);
  return pts;
}

/** Catmull-Rom through the band, then even steps of DS along the arc. */
function resample(pts: P[]): P[] {
  const dense: P[] = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    for (let k = 0; k < 8; k += 1) {
      const t = k / 8;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  dense.push({ ...pts[pts.length - 1]! });
  const out: P[] = [{ ...dense[0]! }];
  let carry = 0;
  for (let i = 1; i < dense.length; i += 1) {
    const a = dense[i - 1]!;
    const b = dense[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    let along = DS - carry;
    while (along <= seg) {
      const t = along / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
      along += DS;
    }
    carry = seg - (along - DS);
  }
  return out;
}

/** Tangent, right and up at every sample. Right stays horizontal, so the horizon never rolls by itself. */
function frames(pos: Float32Array, count: number) {
  const tan = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const up = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const a = Math.max(0, i - 2);
    const b = Math.min(count - 1, i + 2);
    let tx = pos[b * 3]! - pos[a * 3]!;
    let ty = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
    let tz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    // right = T × worldUp
    let nx = -tz;
    let nz = tx;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    // up = right × T
    const ux = -nz * ty;
    const uy = nz * tx - nx * tz;
    const uz = nx * ty;
    tan.set([tx, ty, tz], i * 3);
    nor.set([nx, 0, nz], i * 3);
    up.set([ux, uy, uz], i * 3);
  }
  return { tan, nor, up };
}

/** Rails are thin light lines; the ones that cross the corridor step aside for the run instead of bending it. */
function railsInCorridor(layout: CityLayout, pos: Float32Array, count: number): number[] {
  const hidden: number[] = [];
  layout.rails.forEach((rail, index) => {
    const [ax, ay, az] = rail.a;
    const [bx, by, bz] = rail.b;
    const span = Math.hypot(bx - ax, by - ay, bz - az);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2 + rail.arch + span * 0.06;
    const mz = (az + bz) / 2;
    for (let k = 0; k <= 16; k += 1) {
      const t = k / 16;
      const x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx;
      const y = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * my + t * t * by;
      const z = (1 - t) * (1 - t) * az + 2 * (1 - t) * t * mz + t * t * bz;
      let near = false;
      for (let i = 0; i < count && !near; i += 2) {
        if (Math.abs(pos[i * 3 + 1]! - y) < TUBE_H + 2 && Math.hypot(pos[i * 3]! - x, pos[i * 3 + 2]! - z) < TUBE_W + 2) near = true;
      }
      if (near) {
        hidden.push(index);
        break;
      }
    }
  });
  return hidden;
}

/** Open air around a point: the distance to the nearest tower (with its sign) or rail at that height. */
export function openAir(layout: CityLayout, withRails = false): (x: number, y: number, z: number) => number {
  const { towers, rails: all } = obstaclesOf(layout);
  const rails = withRails ? all : [];
  return (x, y, z) => {
    let w = Number.POSITIVE_INFINITY;
    for (const o of towers) if (y - TUBE_H - 0.6 <= o.top) w = Math.min(w, Math.hypot(x - o.x, z - o.z) - o.r);
    for (const q of rails) if (Math.abs(q.y - y) <= TUBE_H + 0.6) w = Math.min(w, Math.hypot(x - q.x, z - q.z) - 0.3);
    return w;
  };
}

/** How wide the corridor may be at each sample: the open air left by towers and rails, smoothed. */
function corridorWidth(pos: Float32Array, count: number, layout: CityLayout): Float32Array {
  const { towers, rails } = obstaclesOf(layout);
  const raw = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const x = pos[i * 3]!;
    const y = pos[i * 3 + 1]!;
    const z = pos[i * 3 + 2]!;
    let w = TUBE_W;
    for (const o of towers) {
      if (y - TUBE_H - 0.6 > o.top) continue;
      const d = Math.hypot(x - o.x, z - o.z) - o.r - 0.3;
      if (d < w) w = d;
    }
    for (const q of rails) {
      if (Math.abs(q.y - y) > TUBE_H + 0.6) continue;
      const d = Math.hypot(x - q.x, z - q.z) - 0.6;
      if (d < w) w = d;
    }
    raw[i] = clamp(w, MIN_W, TUBE_W);
  }
  // Widen and narrow gradually: a running minimum over ±8 m, then a soft average.
  const span = Math.round(8 / DS);
  const lowest = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    let m = TUBE_W;
    for (let k = Math.max(0, i - span); k <= Math.min(count - 1, i + span); k += 1) m = Math.min(m, raw[k]!);
    lowest[i] = m;
  }
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - span); k <= Math.min(count - 1, i + span); k += 1) {
      sum += lowest[k]!;
      n += 1;
    }
    out[i] = Math.min(sum / n, raw[i]! + 0.4);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* Sampling                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export type Vec = { x: number; y: number; z: number };

/** The corridor's half-width at s. */
export function widthAt(c: Course, s: number): number {
  const i = clamp(Math.round(s / DS), 0, c.count - 1);
  return c.width[i]!;
}

/** World position of the course point (s, u, h): centreline + right·u + up·h, interpolated between samples. */
export function pointAt(c: Course, s: number, u: number, h: number, out: Vec): Vec {
  const f = clamp(s / DS, 0, c.count - 1.001);
  const i = Math.floor(f);
  const t = f - i;
  const j = Math.min(c.count - 1, i + 1);
  const mix = (arr: Float32Array, k: number) => arr[i * 3 + k]! + (arr[j * 3 + k]! - arr[i * 3 + k]!) * t;
  out.x = mix(c.pos, 0) + mix(c.nor, 0) * u + mix(c.up, 0) * h;
  out.y = mix(c.pos, 1) + mix(c.nor, 1) * u + mix(c.up, 1) * h;
  out.z = mix(c.pos, 2) + mix(c.nor, 2) * u + mix(c.up, 2) * h;
  return out;
}

/** The local frame at s (tangent, right, up), interpolated. */
export function frameAt(c: Course, s: number, tan: Vec, nor: Vec, up: Vec) {
  const f = clamp(s / DS, 0, c.count - 1.001);
  const i = Math.floor(f);
  const t = f - i;
  const j = Math.min(c.count - 1, i + 1);
  const read = (arr: Float32Array, out: Vec) => {
    out.x = arr[i * 3]! + (arr[j * 3]! - arr[i * 3]!) * t;
    out.y = arr[i * 3 + 1]! + (arr[j * 3 + 1]! - arr[i * 3 + 1]!) * t;
    out.z = arr[i * 3 + 2]! + (arr[j * 3 + 2]! - arr[i * 3 + 2]!) * t;
    const l = Math.hypot(out.x, out.y, out.z) || 1;
    out.x /= l;
    out.y /= l;
    out.z /= l;
  };
  read(c.tan, tan);
  read(c.nor, nor);
  read(c.up, up);
}

/** Rooftops: the deck height under lane position u at s, or null over a gap. */
export function groundAt(c: Course, s: number, u: number): number | null {
  if (!c.ground) return 0;
  if (s < 0 || s > c.length) return 0;
  const lane = clamp(Math.round(u / laneSpacing(c, s)), -1, 1) + 1;
  const i = clamp(Math.round(s / DS), 0, c.count - 1);
  const g = c.ground[lane * c.count + i]!;
  return Number.isNaN(g) ? null : g;
}

/** Rooftops: lanes close in where the corridor narrows, so the deck never clips a tower. */
export function laneSpacing(c: Course, s: number): number {
  return Math.min(LANE_W, (widthAt(c, s) - 1.1) / 1.0);
}

/** An obstacle's sway at time t (seconds since the run started). */
export function swayOf(o: Obstacle, t: number): number {
  return o.move ? o.move.amp * Math.sin((t / o.move.period) * Math.PI * 2 + o.move.phase) : 0;
}

/* ------------------------------------------------------------------------------------------------ */
/* The beat schedule (shared by both forms)                                                          */
/* ------------------------------------------------------------------------------------------------ */

type Plan = { beats: number[]; forks: Fork[]; nodeS: number; finishS: number; rings: number[] };

function channels(speedSafe = 0.88, speedRisky = 1.14): [Channel, Channel, Channel] {
  return [
    { name: 'safe', u0: -1, u1: -1 / 3, speed: speedSafe },
    { name: 'fast', u0: -1 / 3, u1: 1 / 3, speed: 1 },
    { name: 'risky', u0: 1 / 3, u1: 1, speed: speedRisky },
  ];
}

/** The first beats teach one move each, in this order; after them the day's seed picks. */
const FIRST_FLIGHT = ['pylons', 'beams', 'window'];
const FIRST_ROOFS = ['barrier', 'gap', 'beam'];

const CUES: Record<string, string> = {
  pylons: 'Weave between the pylons',
  beams: 'Over or under the beam',
  window: 'Fly through the gap',
  shutter: 'Time the moving gap',
  debris: 'Dodge the debris',
  cross: 'Pick a corner',
  barrier: '← → Take the open lane',
  gap: '↑ Jump the gap',
  laneGap: '← → Stay on the deck',
  beam: '↓ Slide under',
  step: '↑ Jump up',
  glass: '↓ Smash the glass',
};

/** One cue per kind: the first time it appears on the course. */
function cue(c: Course, s: number, kind: string) {
  const text = CUES[kind];
  if (text && !c.cues.some((k) => k.text === text)) c.cues.push({ s, text });
}

/**
 * Forks at about three tenths and three fifths of the way, the BREAK / SAVE node between them, beats every
 * ~30 m. The first beat waits for a runway of open air (about 8 s), and the first fork leaves room for the
 * three teaching beats, so a newcomer learns the controls before anything can hit them.
 */
function schedule(length: number, seed: number): Plan {
  const random = rng(seed ^ 0x51ed);
  const forkLen = 72;
  const forks: Fork[] = [0.3, 0.62].map((f) => {
    const s0 = Math.round(length * f);
    return { s0, s1: s0 + forkLen, channels: channels() };
  });
  const nodeS = Math.round(length * 0.46);
  const finishS = length - 34;
  const busy = (s: number) => forks.some((f) => s > f.s0 - 16 && s < f.s1 + 10) || (s > nodeS - 18 && s < nodeS + 12) || s > finishS - 40;
  const beats: number[] = [];
  const rings: number[] = [];
  for (let s = 128; s < length - 60; s += 26 + random() * 8) {
    if (busy(s)) continue;
    beats.push(Math.round(s));
  }
  // A reward between every few beats.
  for (let k = 2; k < beats.length; k += 3) rings.push(Math.round((beats[k - 1]! + beats[k]!) / 2));
  return { beats, forks, nodeS, finishS, rings };
}

/* ------------------------------------------------------------------------------------------------ */
/* Flight obstacles                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

type Draft = Omit<Obstacle, 'id'>;

function push(c: Course, d: Draft) {
  c.obstacles.push({ ...d, id: c.obstacles.length });
}

function placeFlight(c: Course, plan: Plan, seed: number) {
  const random = rng(seed ^ 0xf11e);
  const H = TUBE_H;
  // Opening rings teach the drag: follow the light.
  for (const [s, u, h] of [
    [40, 0, 0],
    [56, -0.5, 0.35],
    [70, 0.5, -0.3],
  ] as const) {
    const w = widthAt(c, s);
    push(c, { kind: 'ring', s0: s - 0.3, s1: s + 0.3, u0: u * w - 1.3, u1: u * w + 1.3, h0: h * H - 1.3, h1: h * H + 1.3, tone: 'ice', tag: 'ring' });
  }
  plan.beats.forEach((s, k) => {
    const d = s / c.length;
    const w = widthAt(c, s);
    const pick = random();
    const kinds = ['pylons', 'window', 'beams', 'debris', ...(d > 0.3 ? ['shutter', 'window'] : []), ...(d > 0.55 ? ['cross', 'shutter'] : [])];
    const kind = FIRST_FLIGHT[k] ?? kinds[Math.floor(pick * kinds.length)]!;
    cue(c, s, kind);
    const amber: Tone = 'amber';
    if (kind === 'pylons') {
      const side = random() < 0.5 ? -1 : 1;
      for (let i = 0; i < 3; i += 1) {
        const at = s + i * (8.5 - d * 2);
        const u = (i % 2 === 0 ? side : -side) * w * 0.42;
        push(c, { kind: 'block', s0: at - 0.6, s1: at + 0.6, u0: u - (0.7 + d * 0.5), u1: u + (0.7 + d * 0.5), h0: -H - 0.5, h1: H + 0.5, tone: amber, tag: 'a pylon' });
      }
    } else if (kind === 'window' || kind === 'shutter') {
      const size = 3.8 - d * 0.9;
      const wu = (random() * 2 - 1) * (w - size / 2 - 0.4);
      const wh = (random() * 2 - 1) * (H - size / 2 - 0.3);
      const move = kind === 'shutter' ? { axis: 'u' as const, amp: Math.max(0.8, w - size / 2 - 0.6), period: 2.6 - d * 0.6, phase: random() * Math.PI * 2 } : undefined;
      const base = kind === 'shutter' ? 0 : wu;
      wall(c, s, w, H, base, wh, size, move, amber);
    } else if (kind === 'beams') {
      const high = random() < 0.5;
      push(c, { kind: 'block', s0: s - 0.5, s1: s + 0.5, u0: -w - 0.5, u1: w + 0.5, h0: high ? -0.4 : -H - 0.5, h1: high ? H + 0.5 : 0.4, tone: amber, tag: 'a beam' });
      const at = s + 10;
      const side = random() < 0.5 ? -1 : 1;
      push(c, { kind: 'block', s0: at - 0.5, s1: at + 0.5, u0: side < 0 ? -w - 0.5 : 0.2, u1: side < 0 ? -0.2 : w + 0.5, h0: -H - 0.5, h1: H + 0.5, tone: amber, tag: 'a beam' });
    } else if (kind === 'cross') {
      push(c, { kind: 'block', s0: s - 0.5, s1: s + 0.5, u0: -w - 0.5, u1: w + 0.5, h0: -0.5, h1: 0.5, tone: amber, tag: 'a beam' });
      push(c, { kind: 'block', s0: s - 0.5, s1: s + 0.5, u0: -0.5, u1: 0.5, h0: -H - 0.5, h1: H + 0.5, tone: amber, tag: 'a beam' });
    } else {
      const n = 5 + Math.floor(d * 4);
      for (let i = 0; i < n; i += 1) {
        const at = s + random() * 16;
        const size = 0.9 + random() * 0.9;
        const u = (random() * 2 - 1) * (w - 0.8);
        const h = (random() * 2 - 1) * (H - 0.6);
        push(c, { kind: 'block', s0: at - size / 2, s1: at + size / 2, u0: u - size / 2, u1: u + size / 2, h0: h - size / 2, h1: h + size / 2, tone: 'amber', tag: 'debris' });
      }
    }
  });
  for (const s of plan.rings) {
    const w = widthAt(c, s);
    const u = (random() * 2 - 1) * (w - 1.6);
    const h = (random() * 2 - 1) * (H - 1.4);
    push(c, { kind: 'ring', s0: s - 0.3, s1: s + 0.3, u0: u - 1.2, u1: u + 1.2, h0: h - 1.2, h1: h + 1.2, tone: 'ice', tag: 'ring' });
  }
  for (const f of c.forks) flightFork(c, f, random);
  flightNode(c, c.nodeS);
  const w = widthAt(c, c.finishS);
  push(c, { kind: 'finish', s0: c.finishS - 0.4, s1: c.finishS + 0.4, u0: -w, u1: w, h0: -H, h1: H, tone: 'amber', tag: 'finish' });
}

/** A wall across the corridor with one square window. */
function wall(c: Course, s: number, w: number, H: number, wu: number, wh: number, size: number, move: Motion | undefined, tone: Tone) {
  const half = size / 2;
  const edges: [number, number, number, number][] = [
    [-w - 0.5, wu - half, -H - 0.5, H + 0.5],
    [wu + half, w + 0.5, -H - 0.5, H + 0.5],
    [wu - half, wu + half, wh + half, H + 0.5],
    [wu - half, wu + half, -H - 0.5, wh - half],
  ];
  for (const [u0, u1, h0, h1] of edges) {
    if (u1 - u0 < 0.05 || h1 - h0 < 0.05) continue;
    // A sliding wall is drawn wide enough to cover the corridor at both ends of its sweep.
    const extra = move ? move.amp : 0;
    push(c, { kind: 'block', s0: s - 0.45, s1: s + 0.45, u0: u0 - (u0 < wu ? extra : 0), u1: u1 + (u1 > wu ? extra : 0), h0, h1, move, tone, tag: 'a wall' });
  }
}

/** Three channels split by light walls: safe is wide and easy, fast is a needle with a boost, risky sways. */
function flightFork(c: Course, f: Fork, random: () => number) {
  const H = TUBE_H;
  const mid = (f.s0 + f.s1) / 2;
  const w = widthAt(c, mid);
  // Light walls in short pieces, so they follow the corridor as it widens and narrows.
  for (let at = f.s0; at < f.s1; at += 6) {
    const local = widthAt(c, at + 3);
    for (const side of [-1, 1]) {
      const u = (side * local) / 3;
      push(c, { kind: 'divider', s0: at, s1: Math.min(f.s1, at + 6.05), u0: u - 0.18, u1: u + 0.18, h0: -H - 0.6, h1: H + 0.6, tone: 'violet', tag: 'a divider' });
    }
  }
  const third = w / 3;
  // Safe (left): one slow pylon.
  push(c, { kind: 'block', s0: mid - 0.7, s1: mid + 0.7, u0: -w * 0.72 - 0.5, u1: -w * 0.72 + 0.5, h0: -H - 0.5, h1: 0, tone: 'warm', tag: 'a pylon' });
  // Fast (centre): a tight window and a boost ring.
  const at = f.s0 + 22;
  push(c, { kind: 'block', s0: at - 0.45, s1: at + 0.45, u0: -third, u1: third, h0: 0.7, h1: H + 0.5, tone: 'amber', tag: 'a wall' });
  push(c, { kind: 'block', s0: at + 14 - 0.45, s1: at + 14 + 0.45, u0: -third, u1: third, h0: -H - 0.5, h1: -0.7, tone: 'amber', tag: 'a wall' });
  push(c, { kind: 'ring', s0: f.s1 - 18, s1: f.s1 - 17.4, u0: -1.1, u1: 1.1, h0: -1.1, h1: 1.1, tone: 'ice', tag: 'ring' });
  // Risky (right): falling debris that sways up and down.
  for (let i = 0; i < 5; i += 1) {
    const s = f.s0 + 12 + i * 11;
    const u = third + 0.6 + random() * (w - third - 1.2);
    push(c, {
      kind: 'block',
      s0: s - 0.8,
      s1: s + 0.8,
      u0: u - 0.8,
      u1: u + 0.8,
      h0: -0.8,
      h1: 0.8,
      move: { axis: 'h', amp: H - 0.9, period: 1.4 + random() * 0.6, phase: random() * Math.PI * 2 },
      tone: 'flare',
      tag: 'falling debris',
    });
  }
}

/** The cracked bridge: smash through the left span (BREAK) or thread the ring on the right (SAVE). */
function flightNode(c: Course, s: number) {
  const H = TUBE_H;
  const w = widthAt(c, s);
  const t0 = s - 0.6;
  const t1 = s + 0.6;
  push(c, { kind: 'block', s0: t0, s1: t1, u0: -w - 0.5, u1: w + 0.5, h0: 1.7, h1: H + 0.5, tone: 'amber', tag: 'the bridge' });
  push(c, { kind: 'block', s0: t0, s1: t1, u0: -w - 0.5, u1: w + 0.5, h0: -H - 0.5, h1: -1.7, tone: 'amber', tag: 'the bridge' });
  push(c, { kind: 'block', s0: t0, s1: t1, u0: -0.55, u1: 0.55, h0: -1.7, h1: 1.7, tone: 'amber', tag: 'the bridge' });
  push(c, { kind: 'break', s0: t0, s1: t1, u0: -w - 0.5, u1: -0.55, h0: -1.7, h1: 1.7, tone: 'flare', tag: 'break' });
  push(c, { kind: 'save', s0: t0, s1: t1, u0: 0.55, u1: w + 0.5, h0: -1.7, h1: 1.7, tone: 'ice', tag: 'save' });
}

/* ------------------------------------------------------------------------------------------------ */
/* Rooftops obstacles                                                                                */
/* ------------------------------------------------------------------------------------------------ */

function placeRoofs(c: Course, plan: Plan, seed: number) {
  const random = rng(seed ^ 0x2007);
  const ground = new Float32Array(3 * c.count).fill(0);
  c.ground = ground;
  const setGround = (lanes: number[], s0: number, s1: number, y: number) => {
    const i0 = clamp(Math.round(s0 / DS), 0, c.count - 1);
    const i1 = clamp(Math.round(s1 / DS), 0, c.count - 1);
    for (const lane of lanes) for (let i = i0; i <= i1; i += 1) ground[(lane + 1) * c.count + i] = y;
  };
  const laneBox = (lane: number, s: number, at: number, len: number, h0: number, h1: number, kind: ObstacleKind, tone: Tone, tag: string) => {
    const spacing = laneSpacing(c, s);
    const u = lane * spacing;
    push(c, { kind, s0: at, s1: at + len, u0: u - spacing / 2 + 0.08, u1: u + spacing / 2 - 0.08, h0, h1, tone, tag });
  };
  // Opening pads teach the swipe.
  for (const [s, lane] of [
    [42, 0],
    [58, -1],
    [72, 1],
  ] as const) laneBox(lane, s, s, 1.6, 0.02, 0.12, 'ring', 'ice', 'pad');

  plan.beats.forEach((s, k) => {
    const d = s / c.length;
    const kinds = ['gap', 'barrier', 'beam', 'laneGap', ...(d > 0.25 ? ['step', 'glass'] : []), ...(d > 0.55 ? ['gap', 'beam'] : [])];
    const pick = random();
    const kind = FIRST_ROOFS[k] ?? kinds[Math.floor(pick * kinds.length)]!;
    cue(c, s, kind);
    const amber: Tone = 'amber';
    if (kind === 'gap') {
      setGround([-1, 0, 1], s, s + 3.6 + d * 3.2, Number.NaN);
    } else if (kind === 'laneGap') {
      const keep = Math.floor(random() * 3) - 1;
      setGround([-1, 0, 1].filter((l) => l !== keep), s, s + 9, Number.NaN);
    } else if (kind === 'barrier') {
      const open = Math.floor(random() * 3) - 1;
      for (const lane of [-1, 0, 1]) if (lane !== open) laneBox(lane, s, s, 0.6, 0, 1.05, 'block', amber, 'a barrier');
    } else if (kind === 'beam') {
      const spacing = laneSpacing(c, s);
      push(c, { kind: 'block', s0: s, s1: s + 0.7, u0: -spacing * 1.5, u1: spacing * 1.5, h0: 1.05, h1: 2.6, tone: amber, tag: 'a beam' });
    } else if (kind === 'step') {
      setGround([-1, 0, 1], s, s + 12, 1.3);
    } else {
      const open = random() < 0.5 ? Math.floor(random() * 3) - 1 : 99;
      for (const lane of [-1, 0, 1]) if (lane !== open) laneBox(lane, s, s, 0.3, 0, 2.2, 'glass', 'ice', 'the glass');
    }
  });
  for (const s of plan.rings) laneBox(Math.floor(random() * 3) - 1, s, s, 1.6, 0.02, 0.12, 'ring', 'ice', 'pad');

  for (const f of c.forks) {
    for (let at = f.s0; at < f.s1; at += 4) {
      const spacing = laneSpacing(c, at + 2);
      for (const side of [-1, 1]) {
        const u = (side * spacing) / 2;
        push(c, { kind: 'divider', s0: at, s1: Math.min(f.s1, at + 4.05), u0: u - 0.12, u1: u + 0.12, h0: 0, h1: 2.4, tone: 'violet', tag: 'a divider' });
      }
    }
    // Safe (left lane): one barrier. Fast (centre): a gap with a pad before it. Risky (right): a crumbling deck.
    laneBox(-1, f.s0 + 30, f.s0 + 30, 0.6, 0, 1.05, 'block', 'warm', 'a barrier');
    setGround([0], f.s0 + 26, f.s0 + 31, Number.NaN);
    laneBox(0, f.s0 + 14, f.s0 + 14, 1.6, 0.02, 0.12, 'ring', 'ice', 'pad');
    for (let i = 0; i < 4; i += 1) {
      const at = f.s0 + 12 + i * 13;
      setGround([1], at, at + 2.4 + random() * 1.4, Number.NaN);
    }
    laneBox(1, f.s0 + 2, f.s0 + 2, f.s1 - f.s0 - 4, 0.01, 0.05, 'mark', 'flare', 'risky');
  }
  // The node: glass to dash through on the left (BREAK), a wall in the middle, the gate of light on the right (SAVE).
  const spacing = laneSpacing(c, c.nodeS);
  push(c, { kind: 'break', s0: c.nodeS, s1: c.nodeS + 0.5, u0: -spacing * 1.5, u1: -spacing / 2, h0: 0, h1: 2.4, tone: 'flare', tag: 'break' });
  push(c, { kind: 'block', s0: c.nodeS, s1: c.nodeS + 0.5, u0: -spacing / 2, u1: spacing / 2, h0: 0, h1: 2.6, tone: 'amber', tag: 'the bridge' });
  push(c, { kind: 'save', s0: c.nodeS, s1: c.nodeS + 0.5, u0: spacing / 2, u1: spacing * 1.5, h0: 0, h1: 2.4, tone: 'ice', tag: 'save' });
  push(c, { kind: 'finish', s0: c.finishS - 0.4, s1: c.finishS + 0.4, u0: -spacing * 1.5, u1: spacing * 1.5, h0: 0, h1: 3, tone: 'amber', tag: 'finish' });
  // No gaps right before or after the node and the finish, so the choice is about the gate, not a jump.
  setGround([-1, 0, 1], c.nodeS - 10, c.nodeS + 6, 0);
  setGround([-1, 0, 1], c.finishS - 20, c.length, 0);
  setGround([-1, 0, 1], 0, 36, 0);
}
