import type { CitySnapshot } from '../market/types.ts';
import type { RunForm } from './course.ts';

/**
 * The world of the day. The run is played in a frozen copy of the city: the first live read of the day on this
 * device, kept until midnight UTC, so the course (and your ghost) never shifts under you while prices move.
 * G2 moves this to the server (WorldVersion) so friends share the exact same world.
 */

const WORLD_KEY = 'run.world';
const FORM_KEY = 'run.form';

export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full store: the run still works, it just is not kept.
  }
}

/** Today's frozen city: the stored one if it is from today, else this read (kept only if it is live). */
export function frozenWorld(current: CitySnapshot): CitySnapshot {
  const day = dayKey();
  const stored = read<{ day: string; snapshot: CitySnapshot }>(WORLD_KEY);
  if (stored?.day === day && stored.snapshot?.towers?.length) return stored.snapshot;
  if (current.source === 'live' && current.towers.length) write(WORLD_KEY, { day, snapshot: current });
  return current;
}

/**
 * The run form for this visitor: a `?form=` on the link wins (tests and challenges), then the one assigned
 * on the first visit, else a fair coin. The visitor never chooses, so the comparison of the two forms stays fair.
 */
export function assignedForm(): RunForm {
  try {
    const asked = new URLSearchParams(location.search).get('form');
    if (asked === 'flight' || asked === 'roofs') return asked;
  } catch {
    // no location (tests)
  }
  const kept = read<RunForm>(FORM_KEY);
  if (kept === 'flight' || kept === 'roofs') return kept;
  const form: RunForm = Math.random() < 0.5 ? 'flight' : 'roofs';
  write(FORM_KEY, form);
  return form;
}

/** A newcomer who first plays through a challenge keeps the challenger's form, so a device sees only one form. */
export function keepForm(form: RunForm) {
  const kept = read<RunForm>(FORM_KEY);
  if (kept !== 'flight' && kept !== 'roofs') write(FORM_KEY, form);
}

export type Best = { time: number; ghost: string; at: string };

export function loadBest(courseId: string): { time: number; ghost: Float32Array } | null {
  const best = read<Best>(`run.best.${courseId}`);
  if (!best) return null;
  try {
    const bytes = Uint8Array.from(atob(best.ghost), (ch) => ch.charCodeAt(0));
    return { time: best.time, ghost: new Float32Array(bytes.buffer) };
  } catch {
    return null;
  }
}

export function saveBest(courseId: string, time: number, ghost: Float32Array) {
  const bytes = new Uint8Array(ghost.buffer, ghost.byteOffset, ghost.byteLength);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  write(`run.best.${courseId}`, { time, ghost: btoa(text), at: new Date().toISOString() });
  // Keep only today's bests: yesterday's courses are gone.
  try {
    const today = dayKey();
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('run.best.') && !key.startsWith(`run.best.${today}`)) localStorage.removeItem(key);
    }
  } catch {
    // nothing to clean
  }
}

/** An anonymous id for the run log: random, kept on this device, never tied to a person. */
export function visitorId(): string {
  const kept = read<string>('run.id');
  let team = false;
  try {
    team = new URLSearchParams(location.search).has('team');
  } catch {
    // no location (tests)
  }
  if (kept && (!team || kept.startsWith('team-'))) return kept;
  const fresh = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  // Our own devices open the link once with ?team, so the run report leaves their runs out.
  const id = team ? `team-${fresh}` : fresh;
  write('run.id', id);
  return id;
}
