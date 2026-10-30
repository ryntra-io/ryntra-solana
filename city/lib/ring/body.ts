import type { Archetype } from '../../../lib/ring/contract.ts';
import { wordsNow } from '../i18n/dict.ts';
import { RING } from './words.ts';

/**
 * An agent's body (CITY-50) — the interface the characters line fills (CITY-57): six archetypes, a light visor for a
 * face, four states. Until the characters come, the body is a stand-in drawn from the numbers below
 * (`city/components/ring/AgentBody.tsx`): one silhouette per archetype on a 120 × 160 grid, the feet on y = 156, so the
 * six read apart at a glance. CITY-57 keeps `AgentBodyProps` and swaps the drawing for the real character.
 *
 *   ready    — the visor glows steady; the body breathes
 *   thinking — a scan runs across the visor: a model is reading
 *   acting   — the visor flares and an arm comes up: a move is out
 *   done     — warm visor, a small nod
 *
 * Red only for danger that is true and mint never (it means value): a body has neither.
 */

export type BodyState = 'ready' | 'thinking' | 'acting' | 'done';

export type AgentBodyProps = {
  archetype: Archetype;
  state?: BodyState;
  /** Height on screen in px; the width follows (3 : 4). */
  size?: number;
  /** Lit in the owner's colour, or dim when the agent is switched off. */
  dim?: boolean;
};

export type Visor = 'bar' | 'slit' | 'split' | 'round' | 'wide' | 'ring';
export type Extra = 'shield' | 'fists' | 'cape' | 'antenna' | 'pack' | 'collar';

/** A silhouette on the 120 × 160 grid: x is the centre line at 60, feet on y = 156. */
export type Silhouette = {
  head: { w: number; h: number; y: number; r: number };
  visor: Visor;
  shoulders: { w: number; y: number };
  waist: { w: number; y: number };
  arm: { w: number; len: number; spread: number };
  leg: { w: number; gap: number };
  extra: Extra;
};

export type Body = { name: string; line: string; shape: Silhouette };

export const GROUND = 156;

/** A body: its shape, and its name and line read in the language on screen each time they are shown. */
const body = (archetype: Archetype, shape: Silhouette): Body => ({
  shape,
  get name() {
    return wordsNow(RING)[`${archetype}Name`];
  },
  get line() {
    return wordsNow(RING)[`${archetype}Line`];
  },
});

export const BODIES: Readonly<Record<Archetype, Body>> = {
  guardian: body('guardian', { head: { w: 30, h: 24, y: 18, r: 6 }, visor: 'bar', shoulders: { w: 78, y: 48 }, waist: { w: 46, y: 96 }, arm: { w: 15, len: 52, spread: 6 }, leg: { w: 17, gap: 10 }, extra: 'shield' }),
  fighter: body('fighter', { head: { w: 24, h: 22, y: 20, r: 5 }, visor: 'slit', shoulders: { w: 70, y: 48 }, waist: { w: 32, y: 94 }, arm: { w: 13, len: 50, spread: 10 }, leg: { w: 14, gap: 16 }, extra: 'fists' }),
  tactician: body('tactician', { head: { w: 24, h: 28, y: 12, r: 8 }, visor: 'split', shoulders: { w: 56, y: 46 }, waist: { w: 38, y: 100 }, arm: { w: 10, len: 54, spread: 2 }, leg: { w: 12, gap: 8 }, extra: 'cape' }),
  scout: body('scout', { head: { w: 26, h: 26, y: 24, r: 13 }, visor: 'round', shoulders: { w: 48, y: 56 }, waist: { w: 30, y: 98 }, arm: { w: 9, len: 44, spread: 4 }, leg: { w: 10, gap: 12 }, extra: 'antenna' }),
  engineer: body('engineer', { head: { w: 30, h: 22, y: 22, r: 4 }, visor: 'wide', shoulders: { w: 62, y: 50 }, waist: { w: 44, y: 98 }, arm: { w: 12, len: 50, spread: 6 }, leg: { w: 15, gap: 10 }, extra: 'pack' }),
  host: body('host', { head: { w: 28, h: 30, y: 12, r: 14 }, visor: 'ring', shoulders: { w: 54, y: 50 }, waist: { w: 36, y: 104 }, arm: { w: 10, len: 50, spread: 3 }, leg: { w: 12, gap: 6 }, extra: 'collar' }),
};
