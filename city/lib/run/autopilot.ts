import type { Course } from './course.ts';
import { ACT_DASH, ACT_JUMP, ACT_LEFT, ACT_RIGHT, step, type RunState } from './sim.ts';

/**
 * A pilot that looks ahead by simulating: the tests use it to prove every course can be finished, and the
 * screenshot scripts use it (dev only) to fly real runs. It sees nothing a player cannot see on screen.
 */

function clone(st: RunState): RunState {
  return { ...st, routes: [...st.routes], taken: new Set(st.taken), events: [] };
}

const GRID: { tx: number; ty: number }[] = [];
for (let ix = -3; ix <= 3; ix += 1) for (let iy = -2; iy <= 2; iy += 1) GRID.push({ tx: ix / 3, ty: iy / 2 });

/** Flight: every 0.1 s, the target (of a 7 × 5 grid) that stays clear of hits longest over the next 0.8 s. */
export function flightPilot(prefer: { tx: number; ty: number } = { tx: 0, ty: 0 }) {
  let target = { ...prefer };
  return (c: Course, st: RunState): { tx: number; ty: number } => {
    if (st.tick % 6 !== 0) return target;
    let best = target;
    let bestScore = -Infinity;
    for (const cand of GRID) {
      const alive = clearFor(c, st, 50, () => ({ ...cand, actions: 0 }));
      const score = alive * 10 - Math.hypot(cand.tx - target.tx, cand.ty - target.ty) - Math.hypot(cand.tx - prefer.tx, cand.ty - prefer.ty) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    target = best;
    return target;
  };
}

/* A newcomer, for the tests: reacts late, sees only a little ahead, aims coarsely and sometimes does nothing.
   If this pilot finishes most runs, a first-time player can too. Seeded, so every run repeats. */

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ticks until the next hit or crash, trying `input` from `st` for at most `horizon` ticks. */
function clearFor(c: Course, st: RunState, horizon: number, input: (k: number) => { tx: number; ty: number; actions: number }): number {
  const sim = clone(st);
  const hits = st.hits;
  let k = 0;
  for (; k < horizon; k += 1) {
    step(c, sim, input(k));
    if (sim.status !== 'running' || sim.hits !== hits) break;
  }
  return k;
}

/**
 * Flight: looks 0.6 s ahead every 0.25 s, misses one decision in five, and the finger lands a little off where
 * it meant to (±0.12 of the corridor's half-width and height).
 */
export function newcomerFlight(seed: number) {
  const random = seeded(seed);
  let target = { tx: 0, ty: 0 };
  return (c: Course, st: RunState): { tx: number; ty: number } => {
    if (st.tick % 15 !== 0 || random() < 0.2) return target;
    let best = target;
    let bestScore = -Infinity;
    for (const cand of GRID) {
      const clear = clearFor(c, st, 36, () => ({ ...cand, actions: 0 }));
      const score = clear * 10 - Math.hypot(cand.tx - target.tx, cand.ty - target.ty) * 4 + random() * 6;
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    const off = () => (random() * 2 - 1) * 0.12;
    target = { tx: Math.max(-1, Math.min(1, best.tx + off())), ty: Math.max(-1, Math.min(1, best.ty + off())) };
    return target;
  };
}

/** Rooftops: looks 0.5 s ahead every 0.2 s and makes one move at a time; one decision in five is missed. */
export function newcomerRoofs(seed: number) {
  const random = seeded(seed);
  const moves = [0, ACT_LEFT, ACT_RIGHT, ACT_JUMP, ACT_DASH];
  return (c: Course, st: RunState): number => {
    if (st.tick % 12 !== 0 || random() < 0.2) return 0;
    let action = 0;
    let bestScore = -Infinity;
    for (const move of moves) {
      const clear = clearFor(c, st, 30, (k) => ({ tx: 0, ty: 0, actions: k === 0 ? move : 0 }));
      const score = clear * 10 - (move ? 4 : 0) + random() * 6;
      if (score > bestScore) {
        bestScore = score;
        action = move;
      }
    }
    return action;
  };
}

/** Single moves, combined moves, and (×16) a lane change made twice. */
const MOVES = [0, ACT_LEFT, ACT_RIGHT, ACT_JUMP, ACT_DASH, ACT_LEFT | ACT_JUMP, ACT_RIGHT | ACT_JUMP, ACT_LEFT | ACT_DASH, ACT_RIGHT | ACT_DASH, ACT_LEFT * 16, ACT_RIGHT * 16];

/** Rooftops: every 3 ticks, the action that stays clear of hits longest over the next second (doing nothing wins ties). */
export function roofsPilot() {
  return (c: Course, st: RunState): number => {
    if (st.tick % 3 !== 0) return 0;
    let action = 0;
    let bestScore = -Infinity;
    for (const move of MOVES) {
      // A lane change may be doubled 8 ticks later: two lanes over in one swipe-swipe.
      const twice = move === ACT_LEFT * 16 || move === ACT_RIGHT * 16;
      const first = twice ? move / 16 : move;
      const alive = clearFor(c, st, 60, (k) => ({ tx: 0, ty: 0, actions: k === 0 || (twice && k === 8) ? first : 0 }));
      const score = alive * 10 - (move ? 1 : 0) - (twice ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        // Only the first swipe goes out now; the next look (3 ticks on) makes the second if it still helps.
        action = first;
      }
    }
    return action;
  };
}
