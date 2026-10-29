import { MAX_BUILDING_LEVEL, MAX_FLOORS, MODULES as WORLD_MODULES, quarterLevelForBuilding } from '../../../../lib/world/catalog.ts';

/**
 * The quarter's building kit as data: ten kinds of building, five levels each, and the modules a building is made of —
 * one base, up to four floors (bottom to top), a roof, a light and a sign. Which modules exist and the quarter level
 * that opens each are the world server's (`lib/world/catalog.ts`); this file adds what the city needs to draw and
 * name them. A building's level is one plus its floors, as the server counts it. Nothing here draws: safe anywhere.
 */

export const BUILDING_KINDS = ['home', 'coin_tower', 'harbor', 'workshop', 'crew_hq', 'garage', 'oracle', 'showcase', 'billboard', 'decor'] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

export type Level = 1 | 2 | 3 | 4 | 5;
export const LEVELS: readonly Level[] = [1, 2, 3, 4, 5];

export const MODULE_SLOTS = ['base', 'floor', 'roof', 'light', 'sign'] as const;
export type ModuleSlot = (typeof MODULE_SLOTS)[number];
export type ModuleId = `${ModuleSlot}.${string}`;

export type ModuleDef = {
  id: ModuleId;
  slot: ModuleSlot;
  /** The name on the build sheet. */
  name: string;
  /** The quarter level that opens it (the server's rule). */
  from: number;
};

/** What people call each kind in the city. */
export const KIND_NAMES: Record<BuildingKind, string> = {
  home: 'Home',
  coin_tower: 'Coin tower',
  harbor: 'Harbor',
  workshop: 'Workshop',
  crew_hq: 'Crew HQ',
  garage: 'Garage',
  oracle: 'Oracle board',
  showcase: 'Showcase',
  billboard: 'Billboard',
  decor: 'Decor & light',
};

/** The name of every module the server knows. A module the server adds later shows its id until it is named here. */
const NAMES: Record<string, string> = {
  'base.stone': 'Stone plinth',
  'base.timber': 'Timber deck',
  'base.brick': 'Brick plinth',
  'base.steel': 'Steel deck',
  'base.basalt': 'Basalt plaza',
  'floor.concrete': 'Concrete',
  'floor.glass': 'Glass',
  'floor.brick': 'Brick',
  'floor.terrace': 'Terraces',
  'floor.garden': 'Garden floor',
  'roof.flat': 'Flat roof',
  'roof.garden': 'Roof garden',
  'roof.antenna': 'Antennas',
  'roof.dome': 'Glass dome',
  'roof.spire': 'Spire',
  'light.amber': 'Amber',
  'light.lantern': 'Lanterns',
  'light.violet': 'Violet neon',
  'light.beacon': 'Beacon',
  'sign.plain': 'Name plate',
  'sign.neon': 'Neon blade',
};

export const MODULES: readonly ModuleDef[] = Object.entries(WORLD_MODULES).map(([id, m]) => ({ id: id as ModuleId, slot: m.part, name: NAMES[id] ?? id, from: m.from }));

const BY_ID = new Map<string, ModuleDef>(MODULES.map((m) => [m.id, m]));

export function moduleDef(id: string): ModuleDef | undefined {
  return BY_ID.get(id);
}

/** The modules a build sheet offers for one slot. */
export function modulesFor(slot: ModuleSlot): ModuleDef[] {
  return MODULES.filter((m) => m.slot === slot);
}

/** The quarter level a building of this level needs at the least (the server's rule). */
export const quarterLevelFor = (level: Level): number => quarterLevelForBuilding(level);

/** Floors a building of this level carries: the server counts a building's level as one plus its floors. */
export const floorsFor = (level: Level): number => Math.min(MAX_FLOORS, level - 1);

export { MAX_BUILDING_LEVEL, MAX_FLOORS };

type Defaults = { base: ModuleId; floors: ModuleId[]; roof?: ModuleId; light: ModuleId; sign?: ModuleId };

/** n floors from bottom to top, the styles in order, each taking an even share. */
const floors = (n: number, ...styles: ModuleId[]): ModuleId[] => Array.from({ length: n }, (_, i) => styles[Math.min(styles.length - 1, Math.floor((i / n) * styles.length))]!);

/**
 * What a fresh building of each kind looks like at each level: only modules the quarter level that allows the building
 * level has opened. A kind left without a roof shows its own (a house's gable, a factory's sawtooth, a coin's crown).
 */
const DEFAULTS: Record<BuildingKind, (level: Level) => Defaults> = {
  home: (l) =>
    [
      { base: 'base.stone', floors: [], light: 'light.amber' },
      { base: 'base.timber', floors: ['floor.concrete'], light: 'light.amber' },
      { base: 'base.brick', floors: ['floor.brick', 'floor.glass'], roof: 'roof.flat', light: 'light.lantern', sign: 'sign.plain' },
      { base: 'base.brick', floors: ['floor.brick', 'floor.glass', 'floor.terrace'], roof: 'roof.flat', light: 'light.lantern', sign: 'sign.neon' },
      { base: 'base.basalt', floors: ['floor.brick', 'floor.glass', 'floor.terrace', 'floor.garden'], roof: 'roof.garden', light: 'light.amber', sign: 'sign.neon' },
    ][l - 1] as Defaults,
  coin_tower: (l) => ({
    base: l >= 5 ? 'base.basalt' : l >= 4 ? 'base.steel' : 'base.stone',
    floors: floors(floorsFor(l), 'floor.concrete', 'floor.glass'),
    light: l === 4 ? 'light.violet' : 'light.amber',
  }),
  harbor: (l) => ({
    base: l >= 4 ? 'base.steel' : 'base.timber',
    floors: floors(floorsFor(l), 'floor.concrete'),
    light: l >= 3 ? 'light.lantern' : 'light.amber',
    sign: l >= 4 ? 'sign.neon' : l >= 3 ? 'sign.plain' : undefined,
  }),
  workshop: (l) => ({
    base: l >= 4 ? 'base.steel' : l >= 3 ? 'base.brick' : 'base.stone',
    floors: l >= 3 ? floors(floorsFor(l), 'floor.brick', 'floor.concrete') : floors(floorsFor(l), 'floor.concrete'),
    light: l >= 3 ? 'light.lantern' : 'light.amber',
    sign: l >= 2 ? 'sign.plain' : undefined,
  }),
  crew_hq: (l) => ({
    base: l >= 5 ? 'base.basalt' : 'base.stone',
    floors: floors(floorsFor(l), 'floor.concrete', 'floor.glass'),
    roof: l === 1 ? undefined : l === 5 ? 'roof.garden' : 'roof.flat',
    light: l >= 4 ? 'light.violet' : 'light.amber',
    sign: l >= 2 ? 'sign.plain' : undefined,
  }),
  garage: (l) => ({
    base: l >= 4 ? 'base.steel' : 'base.stone',
    floors: floors(floorsFor(l), 'floor.concrete'),
    roof: l >= 3 ? 'roof.antenna' : undefined,
    light: l >= 5 ? 'light.beacon' : 'light.amber',
    sign: l >= 4 ? 'sign.neon' : undefined,
  }),
  oracle: (l) => ({
    base: l >= 5 ? 'base.basalt' : 'base.stone',
    floors: floors(floorsFor(l), 'floor.glass'),
    roof: l === 4 ? 'roof.dome' : undefined,
    light: l >= 4 ? 'light.violet' : 'light.amber',
  }),
  showcase: (l) => ({
    base: l >= 5 ? 'base.basalt' : l >= 3 ? 'base.brick' : 'base.stone',
    floors: floors(floorsFor(l), 'floor.glass'),
    roof: l === 5 ? 'roof.dome' : 'roof.flat',
    light: 'light.amber',
    sign: l >= 4 ? 'sign.neon' : 'sign.plain',
  }),
  billboard: (l) => ({ base: l >= 4 ? 'base.steel' : 'base.stone', floors: floors(floorsFor(l), 'floor.concrete'), light: 'light.amber' }),
  decor: (l) => ({ base: l >= 5 ? 'base.basalt' : l >= 3 ? 'base.brick' : 'base.stone', floors: floors(floorsFor(l), 'floor.concrete'), light: l >= 3 ? 'light.lantern' : 'light.amber' }),
};

/** The modules of a fresh building, in the order the server keeps them: base, floors bottom to top, roof, light, sign. */
export function defaultModules(kind: BuildingKind, level: Level): ModuleId[] {
  return moduleList(defaultSet(kind, level));
}

function defaultSet(kind: BuildingKind, level: Level): ModuleSet {
  const d = DEFAULTS[kind](level);
  return { base: d.base, floors: d.floors, roof: d.roof ?? null, light: d.light, sign: d.sign ?? null };
}

export function isLevel(value: unknown): value is Level {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function isKind(value: unknown): value is BuildingKind {
  return (BUILDING_KINDS as readonly unknown[]).includes(value);
}

/** A building's modules, sorted out by slot. */
export type ModuleSet = { base: ModuleId; floors: ModuleId[]; roof: ModuleId | null; light: ModuleId; sign: ModuleId | null };

/**
 * What the city draws for any list of ids, whatever a record holds: unknown ids are dropped, the first module of a
 * slot wins, floors keep their order up to four, and a missing base or light takes the default. A building with no
 * floors listed is drawn with its level's default floors. The server refuses such lists (`lib/world/rules.ts`); the
 * city still draws whatever reaches it, so one bad record never breaks a street.
 */
export function normalizeModules(kind: BuildingKind, level: Level, ids: readonly string[]): ModuleSet {
  const d = defaultSet(kind, level);
  const set: ModuleSet = { base: d.base, floors: [], roof: null, light: d.light, sign: null };
  const taken = new Set<ModuleSlot>();
  for (const id of ids) {
    const def = BY_ID.get(id);
    if (!def) continue;
    if (def.slot === 'floor') {
      if (set.floors.length < MAX_FLOORS) set.floors.push(def.id);
      continue;
    }
    if (taken.has(def.slot)) continue;
    taken.add(def.slot);
    if (def.slot === 'base') set.base = def.id;
    else if (def.slot === 'roof') set.roof = def.id;
    else if (def.slot === 'light') set.light = def.id;
    else set.sign = def.id;
  }
  // An empty list is a fresh building: it takes the whole default, roof and sign included.
  if (!ids.some((id) => BY_ID.has(id))) return d;
  if (!set.floors.length) set.floors = d.floors;
  return set;
}

/** The same set as a flat list, in the order the server keeps it. */
export function moduleList(set: ModuleSet): ModuleId[] {
  return [set.base, ...set.floors, ...(set.roof ? [set.roof] : []), set.light, ...(set.sign ? [set.sign] : [])];
}
