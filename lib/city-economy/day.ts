import type { DailyTask, DailyTaskKind } from "../world/contract.ts";
import { DAILY_TASKS, MODULES } from "../world/catalog.ts";
import { STEP_RULES, type Award } from "./points.ts";

/**
 * The day's tasks: three a person, new at 00:00 UTC, done by what the person does in the world — never by money.
 *
 * Five tasks exist (`DAY_TASKS`). The world's own list (`DAILY_TASKS`, `lib/world/catalog.ts`) says which are live and
 * their goals — read from there, never kept twice, so the city's rules and the server cannot drift apart; the panel
 * draws the server's `tasks` of `GET /api/world/me` (`dayTasks`). A task joins the day only when the server can
 * check it from a world event: a floor and a light from a build, visits from the visit itself. A run joins when a
 * finished run reaches the server as a
 * checked fact, a shared build when crews build together (CITY-20); until then nobody could finish them, so nobody is
 * given them. While three are live, everyone has those three; when more are, each person's three are drawn for the day
 * from the person and the day alone, so the same person sees the same three all day on every device.
 *
 * Each task done pays {@link STEP_RULES}.task_done once, under the key `task_done:<day>:<task>` — the same key the
 * world writes (`lib/world/rules.ts`, `taskKey`), so a task reported twice pays once.
 *
 * Pure and client-safe: the clock is always passed in.
 */

export const TASKS_PER_DAY = 3;

export type DayTaskRule = Readonly<{
  kind: DailyTaskKind;
  /** How many steps finish it. */
  goal: number;
  /** The task as a person reads it. */
  line: string;
  /** The world event that moves it. */
  markedBy: "build_floor" | "build_light" | "visit" | "run" | "coop_build";
  /** The server can check it today. */
  live: boolean;
}>;

/** Each task as a person reads it and the world event that moves it; the goal here is used only while it is not live. */
const TASK_WORDS: Readonly<Record<DailyTaskKind, Readonly<{ line: string; markedBy: DayTaskRule["markedBy"]; goal: number }>>> = {
  add_floor: { line: "Add a floor", markedBy: "build_floor", goal: 1 },
  light_street: { line: "Light your street", markedBy: "build_light", goal: 1 },
  visit_quarters: { line: "Visit 3 quarters", markedBy: "visit", goal: 3 },
  run: { line: "Run the skyline", markedBy: "run", goal: 1 },
  coop_build: { line: "Build with your crew", markedBy: "coop_build", goal: 1 },
};

/** The world's live tasks first, in its order and with its goals; then the ones waiting for a server check. */
export const DAY_TASKS: readonly DayTaskRule[] = [
  ...DAILY_TASKS.map((task) => ({ kind: task.kind, goal: task.goal, line: TASK_WORDS[task.kind].line, markedBy: TASK_WORDS[task.kind].markedBy, live: true })),
  ...(Object.keys(TASK_WORDS) as DailyTaskKind[])
    .filter((kind) => !DAILY_TASKS.some((task) => task.kind === kind))
    .map((kind) => ({ kind, ...TASK_WORDS[kind], live: false })),
];

/** A task as a person reads it. */
export function taskLine(kind: DailyTaskKind): string {
  return TASK_WORDS[kind].line;
}

const DAY_MS = 86_400_000;

/** The UTC day of a moment, YYYY-MM-DD. */
export function dayOf(at: Date | string | number): string {
  return new Date(typeof at === "string" ? Date.parse(at) : at instanceof Date ? at.getTime() : at).toISOString().slice(0, 10);
}

/** When the day's tasks are next new: the coming 00:00 UTC. */
export function resetAt(at: Date | string | number): string {
  const day = dayOf(at);
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + DAY_MS).toISOString();
}

/** A 32-bit FNV-1a hash: the same text gives the same number on every device. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * A person's tasks of a day: the live tasks when there are no more than three, else three of them drawn from the
 * person and the day. Always in the order of {@link DAY_TASKS}.
 */
export function tasksForDay(residentId: string, day: string, rules: readonly DayTaskRule[] = DAY_TASKS): DayTaskRule[] {
  const live = rules.filter((r) => r.live);
  if (live.length <= TASKS_PER_DAY) return live;
  const drawn = new Set(
    [...live]
      .sort((a, b) => hash(`${residentId}|${day}|${a.kind}`) - hash(`${residentId}|${day}|${b.kind}`) || (a.kind < b.kind ? -1 : 1))
      .slice(0, TASKS_PER_DAY)
      .map((r) => r.kind),
  );
  return live.filter((r) => drawn.has(r.kind));
}

export type ShownTask = DailyTask & Readonly<{ line: string; done: boolean }>;

/**
 * The day's tasks as the panel draws them: the server's own list (`me.tasks` of `GET /api/world/me`), as it hands it
 * out. Before the server has answered for today (just claimed, or the day turned while the page was open) the list is
 * the server's rule for a new day — every task of `DAILY_TASKS` at zero, as `tasksOfDay` (`lib/world/rules.ts`) gives
 * it — so the panel never makes up a task the server would not hand out.
 */
export function dayTasks(served: readonly DailyTask[], residentId: string, day: string): ShownTask[] {
  const today = served.filter((task) => task.day === day);
  const list: readonly DailyTask[] = today.length ? today : DAILY_TASKS.map((task) => ({ residentId, day, kind: task.kind, progress: 0, goal: task.goal, doneAt: null }));
  return list.map((task) => {
    const progress = Math.min(task.goal, Math.max(0, task.progress));
    return { ...task, progress, line: taskLine(task.kind), done: progress >= task.goal || task.doneAt !== null };
  });
}

/** A world event, as far as the day's tasks need to know it. */
export type DayEvent =
  | Readonly<{ kind: "build"; before: Readonly<{ kind: string; modules: readonly string[] }> | null; after: Readonly<{ kind: string; modules: readonly string[] }> }>
  | Readonly<{ kind: "visit"; counted: boolean }>
  | Readonly<{ kind: "run"; checked: boolean }>
  | Readonly<{ kind: "coop_build"; counted: boolean }>;

export type Mark = Readonly<{ kind: DailyTaskKind; delta: number }>;

function partsOf(modules: readonly string[]): { floors: number; light: string | null } {
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
 * What an event does to the day's tasks. A build adds floors when it has more than the same building had, and lights
 * the street when its light is new; a building put in place of another starts from nothing. A visit counts when the
 * world counted it (not one's own quarter, not twice a day). A run and a shared build count once checked.
 */
export function marksOf(event: DayEvent): Mark[] {
  switch (event.kind) {
    case "build": {
      const after = partsOf(event.after.modules);
      const before = event.before && event.before.kind === event.after.kind ? partsOf(event.before.modules) : { floors: 0, light: null };
      const marks: Mark[] = [];
      if (after.floors > before.floors) marks.push({ kind: "add_floor", delta: after.floors - before.floors });
      if (after.light && after.light !== before.light) marks.push({ kind: "light_street", delta: 1 });
      return marks;
    }
    case "visit":
      return event.counted ? [{ kind: "visit_quarters", delta: 1 }] : [];
    case "run":
      return event.checked ? [{ kind: "run", delta: 1 }] : [];
    case "coop_build":
      return event.counted ? [{ kind: "coop_build", delta: 1 }] : [];
  }
}

/** The award for a task done: the world's key, so it pays once. */
export function taskAward(day: string, kind: DailyTaskKind): Award {
  return { reason: "task_done", points: STEP_RULES.task_done.points, sourceRef: kind, key: `task_done:${day}:${kind}` };
}

/**
 * A person's day from the world's events: the day's tasks with their progress and the moment each was done, and the
 * points the done ones pay. Events of another day, and marks of tasks the person was not given today, move nothing.
 */
export function foldDay(
  residentId: string,
  day: string,
  events: readonly Readonly<{ at: string; event: DayEvent }>[],
  rules: readonly DayTaskRule[] = DAY_TASKS,
): { tasks: DailyTask[]; awards: Award[] } {
  const tasks: DailyTask[] = tasksForDay(residentId, day, rules).map((r) => ({ residentId, day, kind: r.kind, progress: 0, goal: r.goal, doneAt: null }));
  const ordered = events
    .filter((e) => Number.isFinite(Date.parse(e.at)) && dayOf(e.at) === day)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const awards: Award[] = [];
  for (const { at, event } of ordered) {
    for (const mark of marksOf(event)) {
      const task = tasks.find((t) => t.kind === mark.kind);
      if (!task || mark.delta <= 0) continue;
      task.progress = Math.min(task.goal, task.progress + mark.delta);
      if (task.progress >= task.goal && task.doneAt === null) {
        task.doneAt = new Date(Date.parse(at)).toISOString();
        awards.push(taskAward(day, task.kind));
      }
    }
  }
  return { tasks, awards };
}
