import { KINDS } from '../../../lib/world/catalog.ts';
import { planBuild } from '../../../lib/world/rules.ts';
import { wordsNow } from '../i18n/dict.ts';
import type { Building, BuildingKind, ClientErrorCode, LinkRefusal, LockReason, PublicBuilding, Quarter } from './types.ts';
import { BUILD_WORDS } from './words.ts';

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

/**
 * One building the city offers. Its name, its line and what it waits for are read in the language on screen each time
 * they are read (`./words.ts`), so every caller — the picker, the hover label — says them in it.
 */
function offer(id: string, kind: BuildingKind, modules: readonly string[], later = false): ModuleDef {
  return {
    id,
    kind,
    get name() {
      return wordsNow(BUILD_WORDS).moduleName(id);
    },
    get line() {
      return wordsNow(BUILD_WORDS).moduleLine(id);
    },
    modules,
    get later() {
      return later ? wordsNow(BUILD_WORDS).comesLater : null;
    },
  };
}

export const MODULES: readonly ModuleDef[] = [
  offer('home', 'home', ['base.stone', 'roof.flat']),
  offer('lamp', 'decor', ['base.stone', 'light.amber']),
  offer('coin_tower', 'coin_tower', ['base.stone', 'floor.glass', 'roof.flat']),
  offer('harbor', 'harbor', ['base.stone', 'roof.flat']),
  offer('workshop', 'workshop', ['base.stone', 'roof.flat']),
  offer('oracle', 'oracle', ['base.stone', 'sign.plain']),
  offer('crew_hq', 'crew_hq', ['base.stone', 'roof.flat']),
  offer('garage', 'garage', ['base.stone', 'roof.flat']),
  offer('showcase', 'showcase', ['base.stone', 'sign.plain'], true),
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
  const w = wordsNow(BUILD_WORDS);
  if (v.ok) return w.build(def.name);
  switch (v.why) {
    case 'later':
      return def.later ?? w.comesLater;
    case 'slot':
      return w.plotOpensAt(v.need ?? 2);
    case 'kind':
    case 'module':
    case 'level':
      return w.opensAt(v.need ?? 2);
    case 'limit':
      return w.haveOne;
    case 'taken':
      return w.taken;
    case 'same':
      return w.floors;
    case 'linked':
      return w.linked;
    default:
      return w.notHere;
  }
}

/** One plain sentence for a refused write. */
export function refusalLine(code: ClientErrorCode, reason: LockReason | LinkRefusal | null = null, need: number | null = null): string {
  const w = wordsNow(BUILD_WORDS);
  switch (code) {
    case 'LOCKED':
      if (reason === 'limit') return w.hasOne;
      if (reason === 'linked') return w.showsObject;
      return w.opensAtQuarter(need ?? 2);
    case 'VERSION_CONFLICT':
      return w.conflict;
    case 'RATE_LIMITED':
      return w.tooMany;
    case 'NO_RESIDENT':
      return w.lostPlace;
    case 'OFFLINE':
    case 'UNAVAILABLE':
      return w.outOfReach;
    default:
      return w.notSaved;
  }
}
