import { WEATHER } from '../city/events.ts';
import type { CitySnapshot } from './types.ts';

/**
 * When the page reads `/api/city` again (CITY-221). The top bar read «Delayed 01:19» for minutes: an edge whose cache
 * had gone cold answered with the city prerendered at the build (01:19), and the page then waited a whole minute to ask
 * again — longer when the regeneration behind it failed, or when the phone had slept with the tab open. Now an answer
 * that is not live and fresh is asked again within seconds (the stale answer is what starts the edge's regeneration),
 * a tab coming back asks at once, and an answer older than the city on screen never replaces it.
 */

/** A fresh live city is read again after this. */
export const EVERY_MS = 60_000;
/** A city that is not live and fresh is asked again after these, then every last one until a fresh read comes. */
export const AGAIN_MS = [3_000, 8_000, 20_000] as const;
/** After this many stale answers in a row (about two minutes) the engine is not catching up soon: back to once a minute. */
export const AGAIN_TRIES = 6;

type Read = Pick<CitySnapshot, 'fetchedAt' | 'source'>;

const at = (read: Read) => Date.parse(read.fetchedAt);

/** True when the city on screen is a live read young enough to drive it. */
export function freshCity(read: Read, now: number): boolean {
  const t = at(read);
  return read.source === 'live' && Number.isFinite(t) && now - t <= WEATHER.staleMs;
}

/** How long to wait before the next read: soon after a stale answer (`tries` of them in a row), else a minute. */
export function nextReadIn(shown: Read, now: number, tries: number): number {
  if (freshCity(shown, now) || tries >= AGAIN_TRIES) return EVERY_MS;
  return AGAIN_MS[Math.min(Math.max(tries, 0), AGAIN_MS.length - 1)] ?? EVERY_MS;
}

/**
 * True when an answer may replace the city on screen. A live read always replaces the bundled snapshot; between two
 * live reads only one at least as new does — one edge may still hold the build's city while another has today's.
 */
export function newerCity(shown: Read, next: Read): boolean {
  if (next.source !== 'live') return shown.source !== 'live';
  if (shown.source !== 'live') return true;
  const a = at(shown);
  const b = at(next);
  return !Number.isFinite(a) || (Number.isFinite(b) && b >= a);
}

/** True when a tab coming back (shown again, online again) should read at once rather than wait for its timer. */
export function readOnReturn(shown: Read, now: number): boolean {
  const t = at(shown);
  return !freshCity(shown, now) || !Number.isFinite(t) || now - t >= EVERY_MS;
}
