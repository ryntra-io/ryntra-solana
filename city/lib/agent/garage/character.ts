import type { AdviceState, Showing } from './store.ts';

/**
 * What the agent's body does in the garage (CITY-29), with the characters line's states (CITY-57) — and only what
 * really happened: it thinks while a question is with Ryntra, acts while it shows towers, nods once an answer came,
 * greets when its window opens, and otherwise stands ready. An agent that is off is not there at all.
 */

export type Body = 'ready' | 'thinking' | 'acting' | 'done';

/** The show of towers lasts about this long on screen: each tower in turn, then all of them. */
export const ACT_MS = 6_000;
/** The nod after an answer. */
export const DONE_MS = 4_000;

export function bodyOf(input: Readonly<{ on: boolean; advice: AdviceState; showing: Showing | null; now: number }>): Body | null {
  const { on, advice, showing, now } = input;
  if (!on) return null;
  if (advice.status === 'asking') return 'thinking';
  if (showing && now - showing.at < ACT_MS) return 'acting';
  if (advice.status === 'ready' && now - advice.at < DONE_MS) return 'done';
  return 'ready';
}

/** When the body next changes by itself (an act or a nod running out), so a frame can look again; null if never. */
export function nextChange(input: Readonly<{ advice: AdviceState; showing: Showing | null; now: number }>): number | null {
  const { advice, showing, now } = input;
  const ends = [showing ? showing.at + ACT_MS : null, advice.status === 'ready' ? advice.at + DONE_MS : null].filter((t): t is number => t !== null && t > now);
  return ends.length ? Math.min(...ends) : null;
}
