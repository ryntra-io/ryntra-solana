import type { PoolFacts, PoolSession } from '../../lib/stocks/pool-facts.ts';
import type { StepKind } from '../../city/lib/earn/stock-pier-hours.ts';

/**
 * What the stock's facts on a pool page show, decided apart from the markup: the chip of the exchange's
 * state with the time it next changes, the guard's line, and whether anything is shown at all. Pure.
 */

export type ChipKey = Exclude<PoolSession, 'unknown'>;

export type ChipView = Readonly<{ key: ChipKey; tone: 'ok' | 'plain'; at: number | null }>;

export type GuardView = Readonly<{ step: StepKind; now: boolean; at: number }>;

/** Whether the detail shows at all: only for a stock. A coin that is no stock, or facts not read yet, show nothing. */
export function factsShown(facts: PoolFacts | null | undefined): facts is PoolFacts {
  return facts?.isStock === true;
}

/** The exchange's chip: its state and the time it next changes; none when no source said the state. */
export function chipOf(facts: PoolFacts | null | undefined, nowMs: number): ChipView | null {
  if (!factsShown(facts) || facts.session === 'unknown') return null;
  const next = facts.nextChangeAt === null ? Number.NaN : Date.parse(facts.nextChangeAt);
  return { key: facts.session, tone: facts.session === 'open' ? 'ok' : 'plain', at: Number.isFinite(next) && next > nowMs ? next : null };
}

/** The guard's line: from when new deposits wait (still ahead), or until when they wait (on now); none once it is past. */
export function guardOf(facts: PoolFacts | null | undefined, nowMs: number): GuardView | null {
  const guard = factsShown(facts) ? facts.dividendGuard : null;
  if (!guard) return null;
  const from = Date.parse(guard.from);
  const to = Date.parse(guard.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || nowMs > to) return null;
  const now = nowMs >= from;
  return { step: guard.step, now, at: now ? to : from };
}

/** The words' keys for a guard's line. */
export function guardKey(view: GuardView): `${'dividend' | 'split' | 'step'}${'From' | 'Until'}` {
  const step = view.step === 'dividend' ? 'dividend' : view.step === 'split' ? 'split' : 'step';
  return `${step}${view.now ? 'Until' : 'From'}`;
}

/** The words' key for the chip: the state alone, or the state with its time. */
export function chipKey(view: ChipView): ChipKey | `${ChipKey}Until` {
  return view.at === null ? view.key : `${view.key}Until`;
}

const DATE_LOCALE = { en: 'en-GB', uk: 'uk-UA' } as const;

/** A time in the person's own clock: «22:00» today, «Mon 15:30» on another day. `timeZone` is for the tests. */
export function timeText(atMs: number, nowMs: number, lang: 'en' | 'uk', timeZone?: string): string {
  const locale = DATE_LOCALE[lang];
  const day = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(atMs);
  if (day(atMs) === day(nowMs)) return time;
  return `${new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short' }).format(atMs)} ${time}`;
}
