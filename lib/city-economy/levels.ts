import type { BuildingKind } from "../world/contract.ts";
import { KINDS, LEVEL_POINTS, MODULES, maxBuildingLevel, openSlots, quarterLevelFor } from "../world/catalog.ts";
import { TASKS_PER_DAY } from "./day.ts";
import { STEP_RULES } from "./points.ts";

/**
 * The quarter's levels as points open them: how many points each level needs, how many slots it opens, how tall a
 * building may grow, and which buildings and modules come with it.
 *
 * The thresholds are the world's (`lib/world/catalog.ts`, `LEVEL_POINTS`): the server levels a quarter up from them
 * in the same step that pays the points, and never down. Here they are read, explained and checked against
 * `docs/city/ECONOMY.md` §10 — one table, no second copy.
 *
 * Pure and client-safe.
 */

/** The most points a day's tasks pay: every task done. */
export const TASK_POINTS_PER_DAY = TASKS_PER_DAY * STEP_RULES.task_done.points;

export type LevelRow = Readonly<{
  level: number;
  /** Points the resident needs. */
  points: number;
  /** Slots open at this level, and how many of them are new. */
  slots: number;
  newSlots: number;
  /** The tallest building this level allows: one plus its floors. */
  buildingLevel: number;
  /** Buildings and modules that open at this level. */
  kinds: readonly BuildingKind[];
  modules: readonly string[];
  /** Days of all three tasks done that reach it, with no other points. */
  taskDays: number;
}>;

export const QUARTER_LEVELS: readonly LevelRow[] = LEVEL_POINTS.map((points, i) => {
  const level = i + 1;
  return {
    level,
    points,
    slots: openSlots(level),
    newSlots: level === 1 ? openSlots(1) : openSlots(level) - openSlots(level - 1),
    buildingLevel: maxBuildingLevel(level),
    kinds: (Object.keys(KINDS) as BuildingKind[]).filter((k) => KINDS[k].from === level),
    modules: Object.keys(MODULES).filter((id) => MODULES[id].from === level),
    taskDays: Math.ceil(points / TASK_POINTS_PER_DAY),
  };
});

export type LevelProgress = Readonly<{
  /** The level the points reach. */
  level: number;
  /** The next level, or null at the top. */
  next: LevelRow | null;
  /** Points still missing for the next level; 0 at the top. */
  toGo: number;
  /** How far from this level to the next, 0–1; 1 at the top. */
  share: number;
}>;

/** Where a total stands between two levels. */
export function levelProgress(total: number): LevelProgress {
  const points = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const level = quarterLevelFor(points);
  const here = QUARTER_LEVELS[level - 1]!;
  const next = QUARTER_LEVELS[level] ?? null;
  if (!next) return { level, next: null, toGo: 0, share: 1 };
  return { level, next, toGo: next.points - points, share: (points - here.points) / (next.points - here.points) };
}
