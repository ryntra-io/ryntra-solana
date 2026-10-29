import { create } from 'zustand';
import { layoutCity } from '../city/layout.ts';
import { useCity } from '../city/store.ts';
import type { CitySnapshot } from '../market/types.ts';
import { buildCourse, type ChannelName, type Course, type RunForm } from './course.ts';
import { runLive } from './bus.ts';
import { SHIELDS, type RunState } from './sim.ts';
import { track } from './track.ts';
import { assignedForm, dayKey, frozenWorld, keepForm, loadBest, saveBest } from './world.ts';

/**
 * Skyline Run's state as the screens see it: which phase we are in, the course, your best and the last result.
 * The simulation itself runs in the scene at 60 Hz and reports here only when something changes.
 */

export type RunPhase = 'off' | 'countdown' | 'running' | 'ending' | 'result';

export type RunResult = {
  status: 'finish' | 'crash';
  time: number;
  progress: number;
  reason: string;
  node: 'break' | 'save' | 'none';
  routes: ChannelName[];
  /** Shields lost on the way. */
  hits: number;
  newBest: boolean;
  /** Seconds behind your best (positive) or ahead of it (negative); null without a best. */
  toBest: number | null;
  /** Seconds behind the challenge's time (positive) or ahead of it (negative); null without a challenge. */
  toBeat: number | null;
};

/** A challenge link: the time to beat and its form; a full link also carries the course's day, the world and the run. */
export type RunChallenge = { beat: number; form: RunForm; day?: string; world?: CitySnapshot | null; ghost?: Float32Array | null };

type Ghost = { time: number; ghost: Float32Array };

type Store = {
  phase: RunPhase;
  form: RunForm;
  course: Course | null;
  world: CitySnapshot | null;
  attempt: number;
  /** When the countdown started (performance.now) and how long it lasts, in seconds. */
  countdownAt: number;
  countdownLen: number;
  /** The ghost to chase: your best on this course, or the challenger's run while it is faster. */
  best: Ghost | null;
  /** Your own best on this course. */
  own: Ghost | null;
  /** The last finished run, for a challenge link. */
  last: Ghost | null;
  showGhost: boolean;
  result: RunResult | null;
  /** From a challenge link: the time to beat and the form it was set in. */
  challenge: RunChallenge | null;
  /** Build today's course ahead of time (idle time after the first live read), so PLAY starts at once. */
  prepare: () => void;
  start: (from: 'home' | 'city' | 'result') => void;
  go: () => void;
  complete: (state: RunState, ghost: Float32Array) => void;
  showResult: () => void;
  exit: () => void;
  toggleGhost: () => void;
};

const courses = new Map<string, Course>();

function courseFor(world: CitySnapshot, form: RunForm, day = dayKey()): Course {
  const layout = layoutCity(world.towers);
  const probe = `${day}:${form}:${world.fetchedAt}`;
  const cached = courses.get(probe);
  if (cached) return cached;
  const course = buildCourse(layout, form, day);
  courses.set(probe, course);
  return course;
}

/** Where the next run is: a challenge with its world runs in that world on the challenger's day, else today's frozen city. */
function plan(challenge: RunChallenge | null, current: CitySnapshot | null): { form: RunForm; world: CitySnapshot; day: string } {
  const form = challenge?.form ?? assignedForm();
  if (challenge?.world && challenge.day) return { form, world: challenge.world, day: challenge.day };
  return { form, world: frozenWorld(current ?? useCity.getState().snapshot), day: dayKey() };
}

/** The challenger's run, as a ghost, belongs to the challenger's world. */
const rivalOf = (c: RunChallenge | null): Ghost | null => (c?.world && c.ghost ? { time: c.beat, ghost: c.ghost } : null);
const faster = (a: Ghost | null, b: Ghost | null) => (a && b ? (b.time < a.time ? b : a) : (a ?? b));

function readChallenge(): Store['challenge'] {
  try {
    const q = new URLSearchParams(location.search);
    const beat = Number(q.get('beat'));
    const form = q.get('form');
    if (beat > 0 && beat < 600 && (form === 'flight' || form === 'roofs')) return { beat, form };
  } catch {
    // no location on the server
  }
  return null;
}

export const useRun = create<Store>((set, get) => ({
  phase: 'off',
  form: 'flight',
  course: null,
  world: null,
  attempt: 0,
  countdownAt: 0,
  countdownLen: 2.4,
  best: null,
  own: null,
  last: null,
  showGhost: true,
  result: null,
  challenge: typeof window === 'undefined' ? null : readChallenge(),

  prepare: () => {
    if (get().phase !== 'off') return;
    const { form, world, day } = plan(get().challenge, get().world);
    courseFor(world, form, day);
  },

  start: (from) => {
    const challenge = get().challenge;
    if (challenge) keepForm(challenge.form);
    const { form, world, day } = plan(challenge, get().world);
    const course = courseFor(world, form, day);
    // A best on a past day's course lives only in memory: the store keeps today's bests.
    const own = loadBest(course.id) ?? (get().course?.id === course.id ? get().own : null);
    const again = from === 'result';
    const attempt = get().attempt + 1;
    // The first countdown lets the camera fly in and shows how to play; a retry is quick, so RUN AGAIN feels instant.
    const countdownLen = attempt === 1 ? 3 : from !== 'result' ? 2.4 : 1.2;
    runLive.shields = SHIELDS;
    set({ phase: 'countdown', form, world, course, attempt, countdownAt: performance.now(), countdownLen, own, best: faster(own, rivalOf(challenge)), result: null });
    track({ ev: 'run_start', form, course: course.id, attempt, again });
  },

  go: () => {
    if (get().phase === 'countdown') set({ phase: 'running' });
  },

  complete: (state, ghost) => {
    const { course, own, form, attempt, challenge } = get();
    if (!course) return;
    const finished = state.status === 'finished';
    const time = Math.round(state.t * 100) / 100;
    const progress = Math.min(1, state.s / course.finishS);
    const newBest = finished && (!own || time < own.time);
    if (newBest) saveBest(course.id, time, ghost);
    const nextOwn = newBest ? { time, ghost } : own;
    const result: RunResult = {
      status: finished ? 'finish' : 'crash',
      time,
      progress,
      reason: state.reason,
      node: state.node,
      routes: [...state.routes],
      hits: state.hits,
      newBest,
      toBest: finished && own ? Math.round((time - own.time) * 100) / 100 : null,
      toBeat: finished && challenge ? Math.round((time - challenge.beat) * 100) / 100 : null,
    };
    set({ phase: 'ending', result, own: nextOwn, best: faster(nextOwn, rivalOf(challenge)), last: finished ? { time, ghost } : get().last });
    track({
      ev: 'run_end',
      form,
      course: course.id,
      attempt,
      result: result.status,
      time,
      progress: Math.round(progress * 1000) / 1000,
      reason: state.reason || undefined,
      routes: state.routes.join(',') || undefined,
      node: state.node,
      hits: state.hits,
      best: newBest,
    });
  },

  showResult: () => {
    if (get().phase === 'ending') set({ phase: 'result' });
  },

  exit: () => {
    const { phase, course, form, attempt } = get();
    if (course && (phase === 'running' || phase === 'countdown')) {
      track({ ev: 'run_end', form, course: course.id, attempt, result: 'quit', time: 0, progress: 0 });
    }
    set({ phase: 'off', result: null });
  },

  toggleGhost: () => set((s) => ({ showGhost: !s.showGhost })),
}));

// Development hook: lets the screenshot scripts start runs and read state.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __run: useRun });
