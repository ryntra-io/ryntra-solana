import { ACTIVATION_WINDOW_MS } from '../../../lib/stocks/units.ts';
import { readAction } from './corporate.ts';

/**
 * What a Stock Pier knows about the exchange (CITY-98, spec E7 «Причали, що знають години біржі»): when the
 * reference exchange opens and closes — from the issuer's own trading period, never from a «Monday to Friday» rule
 * (`lib/stocks/session.ts`) — the person's plan for the close, and the guard around a corporate step of the token's
 * multiplier (a reinvested dividend, a split).
 *
 * The pool's fee and range are fixed when it is made, so the plan for a close is not a new fee: the whole curve
 * already holds through a gap; the person chooses to stay (the venue's volatility fee rises on the opening jump) or
 * to step out before the close and moor again after the open. Ryntra holds no key: the window says it and offers the
 * one tap; nothing moves by itself.
 *
 * The dividend guard: an xStock's dividend arrives as a step of its multiplier at a set time, while the stock's price
 * drops at the exchange's open on the ex-date — between the two the pool's price and the market's disagree, and the
 * difference is what an arbitrage takes from the pool. So new liquidity waits from a day before a scheduled step until
 * the issuer's own quarter of an hour after it, and a person already in is offered to step out. A split changes the
 * units and not the worth; only the issuer's quarter of an hour either side holds for it.
 *
 * Pure.
 */

/** The issuer's trading period, as the stocks engine reads it: is the reference exchange open, and when it next changes. */
export type StockSession = Readonly<{
  open: boolean | null;
  nextChangeAt: string | null;
}>;

/** A corporate step of the multiplier: `from` until `at`, `to` after. */
export type StockStep = Readonly<{ at: string; from: number; to: number }>;

export type HoursState = 'open' | 'closing' | 'closed' | 'unknown';
export type Hours = Readonly<{ state: HoursState; nextAt: number | null }>;

/** An open session this close to its end reads as «closing»: the plan for the close is due. */
export const CLOSING_SOON_MS = 60 * 60_000;

export function hoursOf(session: StockSession | null, nowMs: number): Hours {
  if (!session || session.open === null) return { state: 'unknown', nextAt: null };
  const next = session.nextChangeAt === null ? Number.NaN : Date.parse(session.nextChangeAt);
  const nextAt = Number.isFinite(next) && next > nowMs ? next : null;
  if (!session.open) return { state: 'closed', nextAt };
  return {
    state: nextAt !== null && nextAt - nowMs <= CLOSING_SOON_MS ? 'closing' : 'open',
    nextAt,
  };
}

/** The person's plan for the close, kept on the device for each pier they are in. */
export const CLOSE_PLANS = ['stay', 'leave'] as const;
export type ClosePlan = (typeof CLOSE_PLANS)[number];
export const DEFAULT_PLAN: ClosePlan = 'stay';

export function isClosePlan(value: unknown): value is ClosePlan {
  return typeof value === 'string' && (CLOSE_PLANS as readonly string[]).includes(value);
}

/** Whether the plan asks for the one tap now: «leave» while the exchange is closing or closed. */
export function planDue(plan: ClosePlan, hours: Hours): boolean {
  return plan === 'leave' && (hours.state === 'closing' || hours.state === 'closed');
}

/* ------------------------------------------------------------------ dividend guard */

/** New liquidity waits this long before a scheduled dividend step. */
export const GUARD_BEFORE_MS = 24 * 60 * 60_000;
/** A step further off than this is not in sight yet. */
export const GUARD_SIGHT_MS = 7 * 24 * 60 * 60_000;

export type StepKind = 'dividend' | 'split' | 'units';

export type Guard =
  | Readonly<{ kind: 'none' }>
  /** A step is scheduled and new liquidity may still go in; it will wait from `holdFrom`. */
  | Readonly<{ kind: 'ahead'; step: StepKind; at: number; holdFrom: number }>
  /** Inside the window: new liquidity waits until `until`. */
  | Readonly<{ kind: 'hold'; step: StepKind; at: number; until: number }>;

/** What a step of the multiplier is: a reinvested dividend, a split (either way), or a change of units that is neither. */
export function stepKind(step: StockStep): StepKind {
  const kind = readAction({
    mint: '',
    at: step.at,
    from: step.from,
    to: step.to,
  }).kind;
  return kind === 'dividend' ? 'dividend' : kind === 'split' || kind === 'reverse-split' ? 'split' : 'units';
}

/**
 * Where a step stands for new liquidity now. A dividend (and a change that is no clean split) holds from a day before
 * until a quarter of an hour after; a split only the quarter of an hour either side — the issuer's own advice to venues.
 */
export function dividendGuard(step: StockStep | null, nowMs: number): Guard {
  if (!step || !(step.from > 0) || !(step.to > 0) || step.from === step.to) return { kind: 'none' };
  const at = Date.parse(step.at);
  if (!Number.isFinite(at)) return { kind: 'none' };
  const kind = stepKind(step);
  const holdFrom = at - (kind === 'split' ? ACTIVATION_WINDOW_MS : GUARD_BEFORE_MS);
  const until = at + ACTIVATION_WINDOW_MS;
  if (nowMs > until) return { kind: 'none' };
  if (nowMs >= holdFrom) return { kind: 'hold', step: kind, at, until };
  if (at - nowMs > GUARD_SIGHT_MS) return { kind: 'none' };
  return { kind: 'ahead', step: kind, at, holdFrom };
}

/** The multiplier's scheduled step as the chain states it (the Scaled UI Amount extension): pending, or just taken. */
export function stepOf(
  scaled: Readonly<{
    multiplier: number;
    newMultiplier: number;
    newMultiplierEffectiveAt: string | null;
  }> | null,
): StockStep | null {
  if (!scaled || scaled.newMultiplierEffectiveAt === null || scaled.multiplier === scaled.newMultiplier) return null;
  return {
    at: scaled.newMultiplierEffectiveAt,
    from: scaled.multiplier,
    to: scaled.newMultiplier,
  };
}

/** A time of the exchange's next change in the person's own clock: «22:00» today, «Mon 15:30» on another day. */
export function whenText(atMs: number, nowMs: number, locale: string): string {
  const at = new Date(atMs);
  const time = at.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const sameDay = new Date(nowMs).toDateString() === at.toDateString();
  if (sameDay) return time;
  return `${at.toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
}

/** Hours (or minutes, under one) until a time, short: «9 h», «40 min». */
export function untilText(atMs: number, nowMs: number, words: Readonly<{ h: string; min: string; d: string }>): string {
  const ms = Math.max(0, atMs - nowMs);
  if (ms >= 48 * 60 * 60_000) return `${Math.round(ms / (24 * 60 * 60_000))} ${words.d}`;
  if (ms >= 60 * 60_000) return `${Math.round(ms / (60 * 60_000))} ${words.h}`;
  return `${Math.max(1, Math.round(ms / 60_000))} ${words.min}`;
}
