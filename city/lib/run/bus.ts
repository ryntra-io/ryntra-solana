import type { RunEvent } from './sim.ts';

/**
 * Run events reach the 3D effects, the sound and the HUD through this one channel, outside React, so a
 * 60 Hz simulation never re-renders components.
 */
type Listener = (event: RunEvent) => void;
const listeners = new Set<Listener>();

export function onRunEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitRunEvent(event: RunEvent) {
  for (const listener of listeners) listener(event);
}

/** The live numbers the HUD paints every frame without React: time, progress, ghost delta, speed. */
export const runLive = {
  t: 0,
  progress: 0,
  ghostProgress: -1,
  delta: Number.NaN,
  speed: 0,
  hint: '' as '' | 'steer' | 'swipe' | 'fork' | 'node' | 'cue',
  /** The line for the 'cue' hint: how to pass the obstacle ahead. */
  cue: '',
  shields: 3,
  /** Where the player is in the world, for effects that start there. */
  x: 0,
  y: 0,
  z: 0,
};

// Development hook: the screenshot scripts wait on the live numbers (hint, progress).
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __runLive: runLive });
