import {
  BUILDING_KINDS, DAILY_TASK_KINDS, POINTS_REASONS,
  type Building, type BuildingKind, type ChainLink, type DailyTaskKind, type LinkKind, type LinkRefusal,
  type LockReason, type PointsReason, type PublicBuilding, type Quarter,
} from "./contract";
import {
  DAILY_TASKS, KINDS, MAX_FLOORS, MAX_MODULES, MODULES, MODULE_PARTS, POINTS, QUARTER_SLOTS,
  maxBuildingLevel, openSlots, quarterLevelForBuilding, quarterLevelForSlot, type ModulePart,
} from "./catalog";

/**
 * The world's checks, pure: given the quarter as the server read it and what
 * the person asked for, say what to write or why not. Nothing here touches a
 * store, a clock or money.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Engine team ids are 24 lowercase hex characters. */
const TEAM_ID = /^[0-9a-f]{24}$/;

export function isId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isBuildingKind(value: unknown): value is BuildingKind {
  return typeof value === "string" && (BUILDING_KINDS as readonly string[]).includes(value);
}

export function isPointsReason(value: unknown): value is PointsReason {
  return typeof value === "string" && (POINTS_REASONS as readonly string[]).includes(value);
}

export function isTaskKind(value: unknown): value is DailyTaskKind {
  return typeof value === "string" && (DAILY_TASK_KINDS as readonly string[]).includes(value);
}

/** A day in UTC, as the contract writes it. */
export function dayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** A link from a request, checked field by field; anything else is null. */
export function parseLink(value: unknown): ChainLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const only = (keys: string[]) => Object.keys(v).every((k) => k === "kind" || keys.includes(k));
  switch (v.kind) {
    case "mint":
      return only(["mint"]) && typeof v.mint === "string" && BASE58.test(v.mint) ? { kind: "mint", mint: v.mint } : null;
    case "lp_position":
      return only(["position"]) && typeof v.position === "string" && BASE58.test(v.position) ? { kind: "lp_position", position: v.position } : null;
    case "strategy":
      return only(["strategyId"]) && isId(v.strategyId) ? { kind: "strategy", strategyId: v.strategyId.toLowerCase() } : null;
    case "team":
      return only(["teamId"]) && typeof v.teamId === "string" && TEAM_ID.test(v.teamId) ? { kind: "team", teamId: v.teamId } : null;
    case "agent":
      return only(["agentId"]) && isId(v.agentId) ? { kind: "agent", agentId: v.agentId.toLowerCase() } : null;
    case "prediction_book":
      return only(["accountId"]) && isId(v.accountId) ? { kind: "prediction_book", accountId: v.accountId.toLowerCase() } : null;
    default:
      return null;
  }
}

/**
 * The link as it is kept: everything but the account id of a prediction
 * book, which is the owner's own account and is filled back in only for the
 * owner (`ownerLink`).
 */
export function storedLink(link: ChainLink | null): Record<string, string> | null {
  if (!link) return null;
  if (link.kind === "prediction_book") return { kind: "prediction_book" };
  return { ...link };
}

/** The full link for the owner: the prediction book gets its account back. */
export function ownerBuilding(building: PublicBuilding, accountId: string | null): Building {
  const link = building.link;
  if (link?.kind === "prediction_book") {
    return { ...building, link: accountId ? { kind: "prediction_book", accountId } : null };
  }
  return building as Building;
}

export type Refusal =
  | Readonly<{ status: 400; code: "BAD_REQUEST" | "UNKNOWN_MODULE"; message: string; module?: string }>
  | Readonly<{ status: 422; code: "LOCKED"; reason: LockReason; message: string; need?: { quarterLevel?: number }; module?: string }>;

export type ModuleCount = Readonly<{ floors: number; light: string | null }>;

/** Floors and the light of a module list that already passed `normalizeModules`. */
export function countModules(modules: readonly string[]): ModuleCount {
  let floors = 0;
  let light: string | null = null;
  for (const id of modules) {
    const part = MODULES[id]?.part;
    if (part === "floor") floors += 1;
    if (part === "light") light = id;
  }
  return { floors, light };
}

/**
 * Put a module list in the one order the world keeps — base, floors from the
 * bottom, roof, light, sign — or say why it is not a building: an unknown
 * module, no base, two bases, a second roof, light or sign, too many floors.
 */
export function normalizeModules(modules: unknown): { ok: true; modules: string[] } | { ok: false; refusal: Refusal } {
  if (!Array.isArray(modules) || modules.length === 0 || modules.length > MAX_MODULES) {
    return { ok: false, refusal: { status: 400, code: "BAD_REQUEST", message: `A building has 1 to ${MAX_MODULES} modules.` } };
  }
  const byPart = new Map<ModulePart, string[]>();
  for (const id of modules) {
    if (typeof id !== "string" || !MODULES[id]) {
      return { ok: false, refusal: { status: 400, code: "UNKNOWN_MODULE", message: "This module is not in the kit.", module: typeof id === "string" ? id.slice(0, 40) : undefined } };
    }
    const part = MODULES[id].part;
    byPart.set(part, [...(byPart.get(part) ?? []), id]);
  }
  if ((byPart.get("base") ?? []).length !== 1) {
    return { ok: false, refusal: { status: 400, code: "BAD_REQUEST", message: "A building stands on exactly one base." } };
  }
  if ((byPart.get("floor") ?? []).length > MAX_FLOORS) {
    return { ok: false, refusal: { status: 400, code: "BAD_REQUEST", message: `A building has at most ${MAX_FLOORS} floors.` } };
  }
  for (const part of ["roof", "light", "sign"] as const) {
    if ((byPart.get(part) ?? []).length > 1) {
      return { ok: false, refusal: { status: 400, code: "BAD_REQUEST", message: `A building has at most one ${part}.` } };
    }
  }
  return { ok: true, modules: MODULE_PARTS.flatMap((part) => byPart.get(part) ?? []) };
}

export type BuildPlan = Readonly<{
  slot: number;
  kind: BuildingKind;
  level: number;
  modules: string[];
  /** The day's tasks this build moves forward. */
  progress: readonly Readonly<{ kind: DailyTaskKind; delta: number }>[];
}>;

/**
 * Check a build against the quarter as read, at the version the person saw.
 *
 * A slot, a kind, a module and a building level open with the quarter level;
 * a closed one is a 422 that names what is missing. The building's level is
 * the server's: one plus its floors. A building that shows an engine object
 * keeps its kind; it can be improved but not turned into another kind.
 */
export function planBuild(input: Readonly<{
  quarter: Quarter;
  buildings: readonly Building[] | readonly PublicBuilding[];
  slot: unknown;
  kind: unknown;
  modules: unknown;
}>): { ok: true; plan: BuildPlan } | { ok: false; refusal: Refusal } {
  const { quarter } = input;
  if (typeof input.slot !== "number" || !Number.isInteger(input.slot) || input.slot < 0 || input.slot >= QUARTER_SLOTS) {
    return { ok: false, refusal: { status: 400, code: "BAD_REQUEST", message: `A slot is a whole number from 0 to ${QUARTER_SLOTS - 1}.` } };
  }
  if (!isBuildingKind(input.kind)) return { ok: false, refusal: { status: 400, code: "BAD_REQUEST", message: "Unknown building kind." } };
  const slot = input.slot;
  const kind = input.kind;
  const normalized = normalizeModules(input.modules);
  if (!normalized.ok) return normalized;
  const modules = normalized.modules;

  if (slot >= openSlots(quarter.level)) {
    return { ok: false, refusal: { status: 422, code: "LOCKED", reason: "slot", message: "This slot opens at a higher quarter level.", need: { quarterLevel: quarterLevelForSlot(slot) } } };
  }
  const rule = KINDS[kind];
  if (quarter.level < rule.from) {
    return { ok: false, refusal: { status: 422, code: "LOCKED", reason: "kind", message: "This building opens at a higher quarter level.", need: { quarterLevel: rule.from } } };
  }
  const existing = input.buildings.find((b) => b.slot === slot) ?? null;
  if (existing && existing.kind !== kind && existing.link) {
    return { ok: false, refusal: { status: 422, code: "LOCKED", reason: "linked", message: "A building that shows an engine object keeps its kind." } };
  }
  if (rule.perQuarter !== null) {
    const others = input.buildings.filter((b) => b.kind === kind && b.slot !== slot).length;
    if (others >= rule.perQuarter) {
      return { ok: false, refusal: { status: 422, code: "LOCKED", reason: "limit", message: `A quarter holds at most ${rule.perQuarter} of this building.` } };
    }
  }
  for (const id of modules) {
    if (quarter.level < MODULES[id].from) {
      return { ok: false, refusal: { status: 422, code: "LOCKED", reason: "module", message: "This module opens at a higher quarter level.", module: id, need: { quarterLevel: MODULES[id].from } } };
    }
  }
  const { floors, light } = countModules(modules);
  const level = 1 + floors;
  if (level > maxBuildingLevel(quarter.level)) {
    return { ok: false, refusal: { status: 422, code: "LOCKED", reason: "level", message: "This building level opens at a higher quarter level.", need: { quarterLevel: quarterLevelForBuilding(level) } } };
  }

  const before = existing && existing.kind === kind ? countModules(existing.modules) : { floors: 0, light: null };
  const progress: { kind: DailyTaskKind; delta: number }[] = [];
  if (floors > before.floors) progress.push({ kind: "add_floor", delta: floors - before.floors });
  if (light && light !== before.light) progress.push({ kind: "light_street", delta: 1 });
  return { ok: true, plan: { slot, kind, level, modules, progress } };
}

/** Whether a building of this kind may show this kind of engine object. */
export function linkFits(kind: BuildingKind, link: LinkKind): boolean {
  return KINDS[kind].links.includes(link);
}

export type LinkCheck = { ok: true } | { ok: false; reason: LinkRefusal };

/** The checks of a link that need no engine read. */
export function checkLinkShape(input: Readonly<{ kind: BuildingKind; link: ChainLink; accountId: string | null }>): LinkCheck {
  if (!linkFits(input.kind, input.link.kind)) return { ok: false, reason: "kind_mismatch" };
  const byAccount = input.link.kind === "strategy" || input.link.kind === "prediction_book";
  if (byAccount && !input.accountId) return { ok: false, reason: "account_required" };
  if (input.link.kind === "prediction_book" && input.link.accountId !== input.accountId) return { ok: false, reason: "not_yours" };
  return { ok: true };
}

/** The day's task list a resident sees: what is stored, and the rest at zero. */
export function tasksOfDay<T extends { kind: DailyTaskKind }>(stored: readonly T[], residentId: string, day: string) {
  return DAILY_TASKS.map((task) => stored.find((s) => s.kind === task.kind) ?? {
    residentId, day, kind: task.kind, progress: 0, goal: task.goal, doneAt: null,
  });
}

/** The goal of a task of the day, or null when the day does not bring it. */
export function goalOf(kind: DailyTaskKind): number | null {
  return DAILY_TASKS.find((t) => t.kind === kind)?.goal ?? null;
}

/** Points for a reason. A reason outside the list has no value and is refused by the caller. */
export function pointsFor(reason: PointsReason): number {
  return POINTS[reason];
}

/** The key that makes a day's task pay once, however often it is reported. */
export function taskKey(day: string, kind: DailyTaskKind): string {
  return `task_done:${day}:${kind}`;
}
