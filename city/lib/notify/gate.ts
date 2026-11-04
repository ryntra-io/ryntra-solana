import { CAP_WINDOW_MS, kindOf, type NoteKind, type Place } from './kinds.ts';
import { inQuiet, type NotifyPrefs } from './prefs.ts';

/**
 * One note at the centre's gate (CITY-87): whether it stands as a banner in the city, goes to the computer's own
 * notifications, or nowhere — and why. Pure, so the rules read in tests:
 *
 * - the liquidation risk always stands in the city, and on the computer too where the person chose so: «Mute all», the
 *   quiet hours and a cap never hold it, and «off» does not exist for it (decision 88);
 * - otherwise «off», «Mute all», the quiet hours and the kind's cap hold it, in that order;
 * - «on the computer» without the browser's permission falls back to a banner, so a note is never lost by a choice the
 *   browser refused;
 * - a market kind «in the city» is the live feed itself (CITY-66): no banner on top of it;
 * - a note the city already shows on screen (the trade window with its own result) needs no banner over itself.
 */

export type Note = Readonly<{
  kind: NoteKind;
  /** One short line: «Stop reached · BONK». */
  title: string;
  /** A second, quieter line; absent for most. */
  line?: string | null;
  /** The tower it is about: a tap flies there. */
  tower?: string | null;
  /** The city already shows it where the person looks. */
  onScreen?: boolean;
}>;

export type Why = 'locked' | 'off' | 'muted' | 'quiet' | 'capped' | 'feed' | 'onScreen' | 'city' | 'desk' | 'deskRefused';

export type Decision = Readonly<{ banner: boolean; desk: boolean; why: Why }>;

export type GateContext = Readonly<{
  /** Milliseconds now. */
  now: number;
  /** The device's clock for the quiet hours; `now` by default. */
  clock?: Date;
  /** When this kind last spoke, or null. */
  last: number | null;
  /** The browser lets the page show notifications on the computer. */
  desk: boolean;
}>;

const NONE = (why: Why): Decision => ({ banner: false, desk: false, why });

export function decide(note: Note, route: Place, prefs: NotifyPrefs, ctx: GateContext): Decision {
  const spec = kindOf(note.kind);
  if (spec.locked) return { banner: true, desk: route === 'desk' && ctx.desk, why: 'locked' };
  if (route === 'off') return NONE('off');
  if (prefs.muted) return NONE('muted');
  if (inQuiet(prefs.quiet, ctx.clock ?? new Date(ctx.now))) return NONE('quiet');
  const cap = CAP_WINDOW_MS[prefs.caps[note.kind]];
  if (cap > 0 && ctx.last !== null && ctx.now - ctx.last < cap) return NONE('capped');
  if (route === 'desk') {
    if (ctx.desk) return { banner: false, desk: true, why: 'desk' };
    return spec.feed || note.onScreen ? NONE('deskRefused') : { banner: true, desk: false, why: 'deskRefused' };
  }
  if (spec.feed) return NONE('feed');
  if (note.onScreen) return NONE('onScreen');
  return { banner: true, desk: false, why: 'city' };
}

/** Whether the decision spoke at all, so the cap counts it. */
export function spoke(decision: Decision): boolean {
  return decision.banner || decision.desk;
}
