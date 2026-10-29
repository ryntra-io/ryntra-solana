import { TUBE_H, groundAt, laneSpacing, swayOf, widthAt, type ChannelName, type Course, type Fork, type Obstacle } from './course.ts';

/**
 * The run itself, at a fixed 60 ticks a second, so the same inputs always give the same run: the ghost is a
 * replay of positions, and a server can replay the inputs to check a run.
 *
 * Flight: the craft flies forward on its own; the thumb sets where it should be across and up the corridor.
 * Rooftops: the runner runs forward on its own; swipes change lane, jump and dash (a dash slides under beams
 * and smashes glass).
 *
 * A hit costs a shield, not the run: you flicker through, slow down for a moment, and a shield comes
 * back after a stretch without hits. The run ends when you are hit with no shield left.
 */

export const TICK = 1 / 60;

export const ACT_LEFT = 1;
export const ACT_RIGHT = 2;
export const ACT_JUMP = 4;
export const ACT_DASH = 8;

export type RunInput = {
  /** Flight: target across (−1 left … 1 right) and up (−1 … 1). */
  tx: number;
  ty: number;
  /** Rooftops: actions pressed since the last tick (ACT_* flags). */
  actions: number;
};

export type RunEventKind = 'boost' | 'break' | 'save' | 'shatter' | 'hit' | 'shield' | 'crash' | 'finish' | 'fork' | 'near' | 'jump' | 'land' | 'dash';
/** `id` names the obstacle taken (a ring collected, glass smashed), so the scene can hide it. */
export type RunEvent = { kind: RunEventKind; s: number; u: number; h: number; tag?: string; id?: number };

export type RunStatus = 'running' | 'crashed' | 'finished';

export type RunState = {
  tick: number;
  t: number;
  s: number;
  u: number;
  /** Flight: height off the centreline. Rooftops: feet above the running line. */
  h: number;
  vu: number;
  vh: number;
  speed: number;
  /** Seconds of boost left. */
  boost: number;
  lane: number;
  grounded: boolean;
  coyote: number;
  dash: number;
  dashCooldown: number;
  status: RunStatus;
  /** Hits taken so far, and the shields left. */
  hits: number;
  shields: number;
  /** Seconds left of flickering through after a hit, and of the slowdown it costs. */
  guard: number;
  stagger: number;
  /** Seconds since the last hit; a shield comes back after REGEN. */
  calm: number;
  /** What ended the run, e.g. "a beam". */
  reason: string;
  routes: ChannelName[];
  node: 'break' | 'save' | 'none';
  taken: Set<number>;
  events: RunEvent[];
  nearCooldown: number;
  cursor: number;
};

/** Flight craft half-extents across and up; rooftops runner half-width and heights. */
const CRAFT_U = 0.55;
const CRAFT_H = 0.36;
const RUNNER_U = 0.32;
export const RUNNER_TALL = 1.7;
export const RUNNER_LOW = 0.85;
const GRAVITY = 40;
const JUMP_V = 12.5;
export const SHIELDS = 3;
const GUARD = 0.9;
const STAGGER = 0.8;
export const REGEN = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function newRun(): RunState {
  return {
    tick: 0,
    t: 0,
    s: 0,
    u: 0,
    h: 0,
    vu: 0,
    vh: 0,
    speed: 0,
    boost: 0,
    lane: 0,
    grounded: true,
    coyote: 0,
    dash: 0,
    dashCooldown: 0,
    status: 'running',
    hits: 0,
    shields: SHIELDS,
    guard: 0,
    stagger: 0,
    calm: 0,
    reason: '',
    routes: [],
    node: 'none',
    taken: new Set(),
    events: [],
    nearCooldown: 0,
    cursor: 0,
  };
}

const sorted = new WeakMap<Course, Obstacle[]>();
function byStart(c: Course): Obstacle[] {
  let list = sorted.get(c);
  if (!list) {
    list = [...c.obstacles].sort((a, b) => a.s0 - b.s0);
    sorted.set(c, list);
  }
  return list;
}

/** The fork channel at (s, u), if s is inside a fork. */
export function channelAt(c: Course, s: number, u: number): { fork: Fork; name: ChannelName; speed: number } | null {
  for (const fork of c.forks) {
    if (s < fork.s0 || s > fork.s1) continue;
    const frac = u / widthAt(c, s);
    const ch = fork.channels.find((k) => frac >= k.u0 && frac <= k.u1) ?? (frac < 0 ? fork.channels[0] : fork.channels[2]);
    return { fork, name: ch.name, speed: ch.speed };
  }
  return null;
}

export function step(c: Course, st: RunState, input: RunInput): void {
  st.events.length = 0;
  if (st.status !== 'running') return;
  const dt = TICK;
  st.tick += 1;
  st.t += dt;
  st.guard = Math.max(0, st.guard - dt);
  st.stagger = Math.max(0, st.stagger - dt);
  st.calm += dt;
  if (st.shields < SHIELDS && st.calm >= REGEN) {
    st.shields += 1;
    st.calm = 0;
    st.events.push({ kind: 'shield', s: st.s, u: st.u, h: st.h });
  }
  // Gentle at the start, quicker towards the crown.
  const base = 15 + 8 * Math.min(1, st.s / c.length);
  const channel = channelAt(c, st.s, st.u);
  let speed = base * (channel?.speed ?? 1);
  if (st.boost > 0) {
    speed *= 1.25;
    st.boost = Math.max(0, st.boost - dt);
  }
  if (c.form === 'roofs' && st.dash > 0) speed *= 1.3;
  if (st.stagger > 0) speed *= 1 - 0.45 * (st.stagger / STAGGER);
  st.speed = speed;
  const prevS = st.s;
  st.s += speed * dt;
  if (c.form === 'flight') moveFlight(c, st, input, dt);
  else moveRoofs(c, st, input, dt);
  if (st.status !== 'running') return;
  for (const fork of c.forks) {
    if (prevS < fork.s1 && st.s >= fork.s1) {
      const at = channelAt(c, fork.s1 - 0.01, st.u);
      if (at) {
        st.routes.push(at.name);
        st.events.push({ kind: 'fork', s: st.s, u: st.u, h: st.h, tag: at.name });
      }
    }
  }
  collide(c, st, prevS);
  if (st.status === 'running' && st.s >= c.finishS) {
    st.status = 'finished';
    st.events.push({ kind: 'finish', s: st.s, u: st.u, h: st.h });
  }
}

function moveFlight(c: Course, st: RunState, input: RunInput, dt: number) {
  const w = widthAt(c, st.s) - CRAFT_U;
  const hMax = TUBE_H - CRAFT_H;
  const tu = clamp(input.tx, -1, 1) * w;
  const th = clamp(input.ty, -1, 1) * hMax;
  const k = 1 - Math.exp(-dt * 10);
  const limit = 26 * dt;
  const du = clamp((tu - st.u) * k, -limit, limit);
  const dh = clamp((th - st.h) * k, -limit, limit);
  st.vu = du / dt;
  st.vh = dh / dt;
  st.u = clamp(st.u + du, -w, w);
  st.h = clamp(st.h + dh, -hMax, hMax);
}

function moveRoofs(c: Course, st: RunState, input: RunInput, dt: number) {
  // Lanes lock a little before a fork, so a late swipe never ends in the divider.
  const inFork = c.forks.some((f) => st.s > f.s0 - 6 && st.s < f.s1);
  if (!inFork) {
    if (input.actions & ACT_LEFT) st.lane = Math.max(-1, st.lane - 1);
    if (input.actions & ACT_RIGHT) st.lane = Math.min(1, st.lane + 1);
  }
  if (input.actions & ACT_JUMP && (st.grounded || st.coyote > 0)) {
    st.vh = JUMP_V;
    st.grounded = false;
    st.coyote = 0;
    st.events.push({ kind: 'jump', s: st.s, u: st.u, h: st.h });
  }
  if (input.actions & ACT_DASH && st.dashCooldown <= 0) {
    st.dash = 0.5;
    st.dashCooldown = 0.9;
    st.events.push({ kind: 'dash', s: st.s, u: st.u, h: st.h });
  }
  st.dash = Math.max(0, st.dash - dt);
  st.dashCooldown = Math.max(0, st.dashCooldown - dt);
  const target = st.lane * laneSpacing(c, st.s);
  const before = st.u;
  st.u += (target - st.u) * (1 - Math.exp(-dt * 16));
  st.vu = (st.u - before) / dt;

  st.vh -= GRAVITY * dt;
  st.h += st.vh * dt;
  const g = groundAt(c, st.s, st.u);
  if (g !== null && st.h <= g && st.vh <= 0 && st.h > g - 0.6) {
    if (!st.grounded) st.events.push({ kind: 'land', s: st.s, u: st.u, h: g });
    st.h = g;
    st.vh = 0;
    st.grounded = true;
    st.coyote = 0.1;
  } else if (st.grounded) {
    st.grounded = false;
  } else {
    st.coyote = Math.max(0, st.coyote - dt);
  }
  const ahead = groundAt(c, st.s + 0.35, st.u);
  if (ahead !== null && ahead > st.h + 0.45) {
    // Running into a step: bumped up onto it.
    if (!hurt(st, 'a ledge')) return;
    st.h = ahead;
    st.vh = 0;
    st.grounded = true;
  } else if (st.h < -2.5) {
    // A fall: caught and set down on the next deck.
    if (!hurt(st, 'the drop')) return;
    rescue(c, st);
  }
}

/** Puts a fallen runner on the first deck ahead, in this lane or the nearest one that has one. */
function rescue(c: Course, st: RunState) {
  for (let s = st.s; s < st.s + 40; s += 0.5) {
    for (const lane of [st.lane, 0, -1, 1]) {
      const g = groundAt(c, s, lane * laneSpacing(c, s));
      if (g === null || groundAt(c, s + 2, lane * laneSpacing(c, s + 2)) === null) continue;
      st.s = s + 1;
      st.lane = lane;
      st.u = lane * laneSpacing(c, st.s);
      st.h = g;
      st.vh = 0;
      st.grounded = true;
      return;
    }
  }
  crash(st, 'the drop');
}

/** A hit costs a shield and a moment of speed; with no shield left it ends the run. False when it ended. */
function hurt(st: RunState, reason: string, id?: number): boolean {
  if (st.guard > 0) return true;
  if (st.shields <= 0) {
    crash(st, reason);
    return false;
  }
  st.shields -= 1;
  st.hits += 1;
  st.guard = GUARD;
  st.stagger = STAGGER;
  st.calm = 0;
  if (id !== undefined) st.taken.add(id);
  st.events.push({ kind: 'hit', s: st.s, u: st.u, h: st.h, tag: reason, id });
  return true;
}

function crash(st: RunState, reason: string) {
  if (st.status !== 'running') return;
  st.status = 'crashed';
  st.reason = reason;
  st.events.push({ kind: 'crash', s: st.s, u: st.u, h: st.h, tag: reason });
}

function collide(c: Course, st: RunState, prevS: number) {
  const list = byStart(c);
  const flight = c.form === 'flight';
  const du = flight ? CRAFT_U : RUNNER_U;
  const ds = flight ? 0.6 : 0.3;
  const pu0 = st.u - du;
  const pu1 = st.u + du;
  const ph0 = flight ? st.h - CRAFT_H : st.h;
  const ph1 = flight ? st.h + CRAFT_H : st.h + (st.dash > 0 ? RUNNER_LOW : RUNNER_TALL);
  // Skip obstacles that are already behind.
  while (st.cursor < list.length && list[st.cursor]!.s1 + 4 < prevS) st.cursor += 1;
  st.nearCooldown = Math.max(0, st.nearCooldown - TICK);
  for (let k = st.cursor; k < list.length; k += 1) {
    const o = list[k]!;
    if (o.s0 > st.s + ds) break;
    if (o.s1 < prevS - ds || o.kind === 'mark' || st.taken.has(o.id)) continue;
    const sway = swayOf(o, st.t);
    const u0 = o.u0 + (o.move?.axis === 'u' ? sway : 0);
    const u1 = o.u1 + (o.move?.axis === 'u' ? sway : 0);
    const h0 = o.h0 + (o.move?.axis === 'h' ? sway : 0);
    const h1 = o.h1 + (o.move?.axis === 'h' ? sway : 0);
    const hit = pu1 > u0 && pu0 < u1 && ph1 > h0 && ph0 < h1;
    const deadly = o.kind === 'block' || o.kind === 'divider';
    if (!hit) {
      const m = 0.7;
      if (deadly && st.nearCooldown <= 0 && pu1 + m > u0 && pu0 - m < u1 && ph1 + m > h0 && ph0 - m < h1) {
        st.nearCooldown = 0.8;
        st.events.push({ kind: 'near', s: st.s, u: st.u, h: st.h, tag: o.tag });
      }
      continue;
    }
    if (deadly) {
      if (!hurt(st, o.tag, o.id)) return;
      continue;
    }
    if (o.kind === 'ring') {
      st.taken.add(o.id);
      st.boost = 1.3;
      st.events.push({ kind: 'boost', s: st.s, u: st.u, h: st.h, id: o.id });
    } else if (o.kind === 'glass') {
      if (st.dash > 0) {
        st.taken.add(o.id);
        st.events.push({ kind: 'shatter', s: st.s, u: st.u, h: st.h, id: o.id });
      } else if (!hurt(st, o.tag, o.id)) {
        return;
      }
    } else if (o.kind === 'break') {
      // Without a dash the rooftops runner still breaks through, but it costs a shield.
      if (!flight && st.dash <= 0 && !hurt(st, 'the glass')) return;
      st.taken.add(o.id);
      st.node = 'break';
      st.boost = Math.max(st.boost, 0.8);
      st.events.push({ kind: 'break', s: st.s, u: st.u, h: st.h, id: o.id });
    } else if (o.kind === 'save') {
      st.taken.add(o.id);
      st.node = 'save';
      st.events.push({ kind: 'save', s: st.s, u: st.u, h: st.h, id: o.id });
    }
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Ghosts: one row of (s, u, h, flags) per tick                                                      */
/* ------------------------------------------------------------------------------------------------ */

export const GHOST_STRIDE = 4;
const MAX_TICKS = 60 * 120;

export class GhostRecorder {
  data = new Float32Array(MAX_TICKS * GHOST_STRIDE);
  ticks = 0;
  record(st: RunState) {
    if (this.ticks >= MAX_TICKS) return;
    const i = this.ticks * GHOST_STRIDE;
    this.data[i] = st.s;
    this.data[i + 1] = st.u;
    this.data[i + 2] = st.h;
    this.data[i + 3] = st.dash > 0 ? 1 : 0;
    this.ticks += 1;
  }
  take(): Float32Array {
    return this.data.slice(0, this.ticks * GHOST_STRIDE);
  }
}

/** The ghost's row at a tick (clamped to its last row). */
export function ghostRow(ghost: Float32Array, tick: number): [number, number, number, number] {
  const rows = ghost.length / GHOST_STRIDE;
  const i = Math.max(0, Math.min(rows - 1, Math.floor(tick))) * GHOST_STRIDE;
  return [ghost[i]!, ghost[i + 1]!, ghost[i + 2]!, ghost[i + 3]!];
}

/** When the ghost reached distance s, in seconds; null if it never did. */
export function ghostTimeAt(ghost: Float32Array, s: number): number | null {
  const rows = ghost.length / GHOST_STRIDE;
  if (!rows || ghost[(rows - 1) * GHOST_STRIDE]! < s) return null;
  let lo = 0;
  let hi = rows - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ghost[mid * GHOST_STRIDE]! < s) lo = mid + 1;
    else hi = mid;
  }
  return lo * TICK;
}
