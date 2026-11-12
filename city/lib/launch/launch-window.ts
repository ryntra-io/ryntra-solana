import { nextWindow, windowOpenAt, type WindowKind } from '../../../lib/core/launch/windows.ts';
import { wordsNow } from '../i18n/dict.ts';
import { TERMS_WORDS } from './words.ts';

/**
 * The launch windows' clock on the launch sheet (CITY-143, `docs/research/ryntra-launch-2026-10-29/SPEC.md` §10): the
 * engine's published schedule (`lib/core/launch/windows.ts`, the same as `GET /api/v1/launch/windows`) read on the
 * device's clock. Only a show: a launch goes out whenever its creator signs, and the clock promises no fairer start —
 * the equal start is each curve's own fee for bots.
 */

export type WindowNow = Readonly<{ open: boolean; kind: WindowKind; ms: number }>;

/** The window open now and the time it has left, or the next one and the time to it. */
export function launchWindowNow(now: number): WindowNow {
  const open = windowOpenAt(now);
  if (open) return { open: true, kind: open.kind, ms: open.closesAt - now };
  const next = nextWindow(now);
  return { open: false, kind: next.kind, ms: next.opensAt - now };
}

/** «4:12», «12:04», «1:02:09» — whole seconds, rounded up, never below zero. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** What the clock is, under it (CITY-243): a launch goes out at any time, the window or not. */
export function windowAnyTime(): string {
  return wordsNow(TERMS_WORDS).windowAnyTime;
}

/** The clock in the language on screen: «Launch window in 12:04», «Evening window open · 6:12». */
export function windowLine(now: number): string {
  const w = wordsNow(TERMS_WORDS);
  const at = launchWindowNow(now);
  const clock = clockText(at.ms);
  if (at.open) return at.kind === 'evening' ? w.windowEveningOpen(clock) : w.windowOpen(clock);
  return at.kind === 'evening' ? w.windowEveningNext(clock) : w.windowNext(clock);
}
