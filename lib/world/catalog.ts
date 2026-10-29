import type { BuildingKind, DailyTaskKind, District, LinkKind, PointsReason } from "./contract";

/**
 * The world's rules as data: what a quarter can hold, what opens at which
 * level, how many points each real step is worth and which tasks a day brings.
 * The checks in `rules.ts` read only this file, so changing the pace of the
 * game is a change here and nowhere else.
 *
 * Points never come from trading volume or from the number of launches:
 * there is no such reason in the list, and the server awards only reasons
 * from the list.
 */

/** Where a new resident gets a place: the newcomers' street, streets of 24 quarters. */
export const ARRIVALS: Readonly<{ district: District; streetLength: number }> = { district: "arrivals", streetLength: 24 };

/** A quarter's grid holds this many slots; the quarter's level opens them. */
export const QUARTER_SLOTS = 12;

/** Points a resident needs for each quarter level, from 1 to 10. */
export const LEVEL_POINTS: readonly number[] = [0, 30, 80, 150, 250, 400, 600, 850, 1150, 1500];

export const MAX_QUARTER_LEVEL = LEVEL_POINTS.length;
export const MAX_BUILDING_LEVEL = 5;

/** How many points each reason is worth. Only the server awards them. */
export const POINTS: Readonly<Record<PointsReason, number>> = {
  task_done: 10,
  survival_7: 50,
  survival_30: 150,
  survival_90: 400,
  holders_kept: 25,
  lp_in_range_days: 10,
  visitors_verified: 5,
  coop_contribution: 10,
  war_participation: 20,
  /* A free vault pays by the vault, at the price the Vault shows (`lib/vault/levels.ts`, read by `CRACK_POINTS` in
     `lib/city-economy/points.ts`). This is the daily vault's, the one that repeats; a test holds it equal to the Vault's. */
  vault_crack: 15,
};

/**
 * The day's tasks. Each is checked by the server from what the person did:
 * a floor through `build`, a light through `build`, visits through `visit`.
 * A run joins the list once a finished run reaches the server as a checked
 * fact; until then nobody could complete it.
 */
export const DAILY_TASKS: readonly Readonly<{ kind: DailyTaskKind; goal: number }>[] = [
  { kind: "add_floor", goal: 1 },
  { kind: "light_street", goal: 1 },
  { kind: "visit_quarters", goal: 3 },
];

export type KindRule = Readonly<{
  /** The quarter level from which this kind may be placed. */
  from: number;
  /** How many of this kind one quarter may hold; null means as many as there are slots. */
  perQuarter: number | null;
  /** The engine objects this kind may show. Empty: the building has no link. */
  links: readonly LinkKind[];
}>;

export const KINDS: Readonly<Record<BuildingKind, KindRule>> = {
  home: { from: 1, perQuarter: 1, links: [] },
  decor: { from: 1, perQuarter: null, links: [] },
  coin_tower: { from: 1, perQuarter: null, links: ["mint"] },
  workshop: { from: 2, perQuarter: null, links: ["strategy"] },
  harbor: { from: 2, perQuarter: null, links: ["lp_position"] },
  oracle: { from: 2, perQuarter: 1, links: ["prediction_book"] },
  garage: { from: 3, perQuarter: null, links: ["agent"] },
  crew_hq: { from: 3, perQuarter: 1, links: ["team"] },
  showcase: { from: 4, perQuarter: 1, links: ["mint", "team"] },
  billboard: { from: 5, perQuarter: 1, links: [] },
};

export const MODULE_PARTS = ["base", "floor", "roof", "light", "sign"] as const;
export type ModulePart = (typeof MODULE_PARTS)[number];

/** Every module of the kit and the quarter level that opens it. */
export const MODULES: Readonly<Record<string, Readonly<{ part: ModulePart; from: number }>>> = {
  "base.stone": { part: "base", from: 1 },
  "base.timber": { part: "base", from: 1 },
  "base.brick": { part: "base", from: 2 },
  "base.steel": { part: "base", from: 4 },
  "base.basalt": { part: "base", from: 6 },
  "floor.concrete": { part: "floor", from: 1 },
  "floor.glass": { part: "floor", from: 1 },
  "floor.brick": { part: "floor", from: 2 },
  "floor.terrace": { part: "floor", from: 4 },
  "floor.garden": { part: "floor", from: 6 },
  "roof.flat": { part: "roof", from: 1 },
  "roof.garden": { part: "roof", from: 2 },
  "roof.antenna": { part: "roof", from: 2 },
  "roof.dome": { part: "roof", from: 4 },
  "roof.spire": { part: "roof", from: 6 },
  "light.amber": { part: "light", from: 1 },
  "light.lantern": { part: "light", from: 2 },
  "light.violet": { part: "light", from: 4 },
  "light.beacon": { part: "light", from: 6 },
  "sign.plain": { part: "sign", from: 1 },
  "sign.neon": { part: "sign", from: 4 },
};

/** A building has one base, up to four floors and at most one roof, light and sign. */
export const MAX_FLOORS = MAX_BUILDING_LEVEL - 1;
export const MAX_MODULES = 1 + MAX_FLOORS + 3;

/** The quarter level a resident's points reach. */
export function quarterLevelFor(points: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_POINTS.length; i += 1) if (points >= LEVEL_POINTS[i]) level = i + 1;
  return level;
}

/** Slots open at a quarter level: three at the start, one more per level. */
export function openSlots(quarterLevel: number): number {
  return Math.min(QUARTER_SLOTS, quarterLevel + 2);
}

/** The highest building level a quarter level allows: 2 at the start, 5 from level 7. */
export function maxBuildingLevel(quarterLevel: number): number {
  return Math.min(MAX_BUILDING_LEVEL, 1 + Math.ceil(quarterLevel / 2));
}

/** The lowest quarter level that allows a building level. */
export function quarterLevelForBuilding(buildingLevel: number): number {
  for (let q = 1; q <= MAX_QUARTER_LEVEL; q += 1) if (maxBuildingLevel(q) >= buildingLevel) return q;
  return MAX_QUARTER_LEVEL;
}

/** The lowest quarter level that opens a slot. */
export function quarterLevelForSlot(slot: number): number {
  return Math.max(1, slot - 1);
}
