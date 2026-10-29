import { KINDS } from '../../../lib/world/catalog.ts';
import { planBuild } from '../../../lib/world/rules.ts';
import type { Building, BuildingKind, ClientErrorCode, LinkRefusal, LockReason, PublicBuilding, Quarter } from './types.ts';

/**
 * What a person can put on a plot of their quarter, until the premium kit draws it: a building kind and the kit
 * modules it is made of, all from the world's catalog. The world's own rules (lib/world/rules.ts) say what is
 * open; the city only adds which buildings it offers yet. Home and a street lamp are open from the first minute;
 * the buildings that stand on the engine open at their quarter level and show the object they are linked to
 * (`objects.ts`); the showcase comes with its own step.
 */
export type ModuleDef = {
  id: string;
  kind: BuildingKind;
  name: string;
  /** One line about what it is. */
  line: string;
  /** The kit modules it is made of. */
  modules: readonly string[];
  /** Null when the city offers it; otherwise one line on what it waits for. */
  later: string | null;
};

export const MODULES: readonly ModuleDef[] = [
  { id: 'home', kind: 'home', name: 'Home', line: 'Your place in the city', modules: ['base.stone', 'roof.flat'], later: null },
  { id: 'lamp', kind: 'decor', name: 'Lamp', line: 'Light for your street', modules: ['base.stone', 'light.amber'], later: null },
  { id: 'coin_tower', kind: 'coin_tower', name: 'Coin tower', line: 'Shows a coin you launched', modules: ['base.stone', 'floor.glass', 'roof.flat'], later: null },
  { id: 'harbor', kind: 'harbor', name: 'Harbor', line: 'Your pool, lit by its fees', modules: ['base.stone', 'roof.flat'], later: null },
  { id: 'workshop', kind: 'workshop', name: 'Workshop', line: 'A strategy, on paper first', modules: ['base.stone', 'roof.flat'], later: null },
  { id: 'oracle', kind: 'oracle', name: 'Oracle', line: 'Your calls, on paper', modules: ['base.stone', 'sign.plain'], later: null },
  { id: 'crew_hq', kind: 'crew_hq', name: 'Crew HQ', line: 'Your team and its treasury', modules: ['base.stone', 'roof.flat'], later: null },
  { id: 'garage', kind: 'garage', name: 'Garage', line: 'Where your agent will live', modules: ['base.stone', 'roof.flat'], later: null },
  { id: 'showcase', kind: 'showcase', name: 'Showcase', line: 'Where visitors buy in', modules: ['base.stone', 'sign.plain'], later: 'Comes later' },
];

export const moduleById = (id: string): ModuleDef | null => MODULES.find((m) => m.id === id) ?? null;

export const moduleForKind = (kind: BuildingKind): ModuleDef | null => MODULES.find((m) => m.kind === kind) ?? null;

/** The quarter level that opens a building kind. */
export const levelFor = (kind: BuildingKind): number => KINDS[kind].from;

/** Why a build cannot happen, in the world's words: its lock reason, or one of the city's own. */
export type Verdict =
  | { ok: true }
  | { ok: false; why: LockReason | 'later' | 'taken' | 'same' | 'bad'; need: number | null };

/**
 * Whether `def` can go on `slot` of this quarter now. The world's rules first, then the city's: a building that
 * waits for its engine step, a plot that already has a different building (the city never knocks one down), and
 * the same building again (nothing to change until the kit brings floors).
 */
export function verdict(def: ModuleDef, quarter: Quarter, buildings: readonly (Building | PublicBuilding)[], slot: number): Verdict {
  const plan = planBuild({ quarter, buildings, slot, kind: def.kind, modules: [...def.modules] });
  if (!plan.ok) {
    const r = plan.refusal;
    return r.code === 'LOCKED' ? { ok: false, why: r.reason, need: r.need?.quarterLevel ?? null } : { ok: false, why: 'bad', need: null };
  }
  if (def.later) return { ok: false, why: 'later', need: null };
  const here = buildings.find((b) => b.slot === slot);
  if (here) return { ok: false, why: here.kind === def.kind ? 'same' : 'taken', need: null };
  return { ok: true };
}

/** The first building the city offers on an empty plot, so the picker opens with an answer already chosen. */
export function firstBuildable(quarter: Quarter, buildings: readonly (Building | PublicBuilding)[], slot: number): ModuleDef | null {
  return MODULES.find((m) => verdict(m, quarter, buildings, slot).ok) ?? null;
}

/** One line for a verdict, for the picker's button. */
export function verdictLine(def: ModuleDef, v: Verdict): string {
  if (v.ok) return `Build ${def.name}`;
  switch (v.why) {
    case 'later':
      return def.later ?? 'Comes later';
    case 'slot':
      return `Plot opens at level ${v.need ?? 2}`;
    case 'kind':
    case 'module':
    case 'level':
      return `Opens at level ${v.need ?? 2}`;
    case 'limit':
      return 'You have one already';
    case 'taken':
      return 'This plot is taken';
    case 'same':
      return 'Floors come with the kit';
    case 'linked':
      return 'It shows an engine object';
    default:
      return 'Not here';
  }
}

/** One plain sentence for a refused write. */
export function refusalLine(code: ClientErrorCode, reason: LockReason | LinkRefusal | null = null, need: number | null = null): string {
  switch (code) {
    case 'LOCKED':
      if (reason === 'limit') return 'Your quarter has one already.';
      if (reason === 'linked') return 'This building shows an engine object.';
      return `That opens at quarter level ${need ?? 2}.`;
    case 'VERSION_CONFLICT':
      return 'Your quarter changed on another screen. Try again.';
    case 'RATE_LIMITED':
      return 'Too many taps at once. Try again in a moment.';
    case 'NO_RESIDENT':
      return 'This device lost its place. Claim your spot again.';
    case 'OFFLINE':
    case 'UNAVAILABLE':
      return 'The city is out of reach. Try again.';
    default:
      return 'That did not save. Try again.';
  }
}
