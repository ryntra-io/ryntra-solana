/**
 * «Доручення» for one wallet (AI-19): create, change, pause, resume, remove, and
 * the surface the tab and the phone read — each task with what it asks, how
 * often, where it goes, when it runs next, what it said last, and the price:
 * one run costs one question with the model, and a day of runs is shown before
 * the task is turned on.
 */

import type { AssistantCredits, AssistantTask, AssistantTaskCreate, AssistantTaskUpdate, AssistantTasksResponse } from "../../api/v1/contract.ts";
import type { GuardStore } from "../../guard/store.ts";
import { nextRunAt, runsPerDay, TASK_EVERY } from "./schedule.ts";
import { TASKS_MAX, type TaskRecord, deleteTask, listAllTasks, listTasks, newTaskId, readTask, writeTask } from "./store.ts";

/**
 * All of a wallet's active tasks together run at most this many times a day: two tasks every 10 minutes (288), or one
 * and a few hourly ones — so tasks never spend the day's model calls a person's own questions need.
 */
export const TASK_RUNS_PER_DAY_MAX = 300;

/** Of a wallet's daily model calls, the person's own questions always keep at least this many — or half, when that is more. */
export const TASK_PERSON_KEEPS = 50;

/**
 * The cap for a wallet: what is left of its daily model calls once the person's own share is kept — at least half of
 * them, at most 300 — and never more than half of every wallet's tasks together a day (`tasksPool`), so one person
 * never takes the others' runs. With the defaults (200 a day, a pool of 300) one task every 10 minutes (144) fits.
 */
export function taskRunsCap(dailyCalls: number, tasksPool = Number.POSITIVE_INFINITY): number {
  return Math.max(0, Math.min(TASK_RUNS_PER_DAY_MAX, Math.floor(tasksPool / 2), Math.max(Math.floor(dailyCalls / 2), dailyCalls - TASK_PERSON_KEEPS)));
}

function runsOf(tasks: readonly Pick<TaskRecord, "every" | "status" | "id">[], except: string | null = null): number {
  return tasks.filter((task) => task.status === "active" && task.id !== except).reduce((sum, task) => sum + runsPerDay(task.every), 0);
}
import { everyWords, taskName } from "./words.ts";
import { taskHref } from "./run.ts";

export type TaskFailure = Readonly<{ ok: false; code: "VALIDATION_ERROR" | "TASK_LIMIT_REACHED" | "TASK_RUNS_CAP" | "TASK_NOT_FOUND" | "TASK_VERSION_CONFLICT" | "TASK_PRICE_NOT_SHOWN"; reason: string }>;

export function taskView(task: TaskRecord): AssistantTask {
  return {
    id: task.id,
    ask: task.ask,
    name: taskName(task.ask, task.locale),
    every: task.every,
    time: task.time,
    zone: task.zone,
    rhythm: everyWords(task.every, task.time, task.locale),
    onlyWhenNew: task.onlyWhenNew,
    channels: task.channels,
    status: task.status,
    pausedBy: task.pausedBy,
    priceCredits: task.priceCredits,
    perDayCredits: task.priceCredits * runsPerDay(task.every),
    nextRunAt: task.status === "active" ? task.nextRunAt : null,
    skippedAt: task.status === "active" ? task.skippedAt : null,
    last: task.last ? { at: task.last.at, headline: task.last.headline, delivered: task.last.delivered } : null,
    runs: task.runs,
    href: taskHref(task.id),
    sessionId: task.sessionId,
    version: task.version,
  };
}

/**
 * What a wallet may still take a day: its own cap, and what every wallet's active tasks leave of the shared pool — so a
 * rhythm that would overrun the pool is off before it is turned on, not skipped later in the day.
 */
async function roomOf(store: GuardStore, owner: string, cap: number, pool: number, except: string | null = null): Promise<Readonly<{ used: number; cap: number }>> {
  const mine = runsOf(await listTasks(store, owner), except);
  if (!Number.isFinite(pool)) return { used: mine, cap };
  const everyone = runsOf(await listAllTasks(store), except);
  return { used: mine, cap: Math.max(0, Math.min(cap, mine + pool - everyone)) };
}

export async function readTaskSurface(store: GuardStore, owner: string, credits: AssistantCredits | null, cap = TASK_RUNS_PER_DAY_MAX, pool = Number.POSITIVE_INFINITY): Promise<AssistantTasksResponse> {
  const tasks = await listTasks(store, owner);
  const price = credits?.prices.question ?? 0;
  const room = await roomOf(store, owner, cap, pool);
  const used = room.used;
  cap = room.cap;
  return {
    tasks: tasks.map(taskView),
    limit: TASKS_MAX,
    pricePerRun: price,
    rhythms: TASK_EVERY.map((every) => ({ every, runsPerDay: runsPerDay(every), perDayCredits: price * runsPerDay(every), fits: used + runsPerDay(every) <= cap })),
    runs: { used, cap },
  };
}

/** A new task: the price must be the one shown — the price of one question now — or nothing is turned on. */
export async function createTask(store: GuardStore, owner: string, body: AssistantTaskCreate, price: number, nowMs: number, cap = TASK_RUNS_PER_DAY_MAX, pool = Number.POSITIVE_INFINITY): Promise<Readonly<{ ok: true; task: TaskRecord }> | TaskFailure> {
  if (body.acceptCredits !== price) return { ok: false, code: "TASK_PRICE_NOT_SHOWN", reason: "The price of a run changed; read it again before turning the task on." };
  if (body.every === "1d" && !body.time) return { ok: false, code: "VALIDATION_ERROR", reason: "A daily task needs its time." };
  const existing = await listTasks(store, owner);
  if (existing.length >= TASKS_MAX) return { ok: false, code: "TASK_LIMIT_REACHED", reason: `A wallet keeps up to ${TASKS_MAX} tasks; remove one first.` };
  const room = await roomOf(store, owner, cap, pool);
  if (room.used + runsPerDay(body.every) > room.cap) return { ok: false, code: "TASK_RUNS_CAP", reason: `The tasks together run at most ${room.cap} times a day now; pick a slower rhythm or pause one.` };
  const at = new Date(nowMs).toISOString();
  const task: TaskRecord = {
    schema: "ryntra.assistant.task",
    version: 1,
    id: newTaskId(),
    owner,
    ask: body.ask,
    every: body.every,
    time: body.every === "1d" ? (body.time ?? "09:00") : null,
    zone: body.zone,
    locale: body.locale,
    onlyWhenNew: body.onlyWhenNew,
    channels: body.channels,
    status: "active",
    pausedBy: null,
    priceCredits: price,
    sessionId: null,
    /* The first run: soon for a rhythm (a person who turned it on wants to see it work), at its time for a daily one. */
    nextRunAt: new Date(body.every === "1d" ? nextRunAt("1d", body.time ?? "09:00", body.zone, nowMs) : nowMs + 60_000).toISOString(),
    leaseUntil: null,
    skippedAt: null,
    last: null,
    runs: 0,
    createdAt: at,
    updatedAt: at,
  };
  if (!(await writeTask(store, task, null))) return { ok: false, code: "TASK_VERSION_CONFLICT", reason: "The task could not be written now; try again." };
  return { ok: true, task };
}

/** A change over the version the person read: pause, resume (at today's price, shown), the rhythm, the channels. */
export async function updateTask(store: GuardStore, owner: string, id: string, body: AssistantTaskUpdate, price: number, nowMs: number, cap = TASK_RUNS_PER_DAY_MAX, pool = Number.POSITIVE_INFINITY): Promise<Readonly<{ ok: true; task: TaskRecord }> | TaskFailure> {
  const task = await readTask(store, owner, id);
  if (!task) return { ok: false, code: "TASK_NOT_FOUND", reason: "No task of this wallet has that id." };
  if (task.version !== body.ifVersion) return { ok: false, code: "TASK_VERSION_CONFLICT", reason: "The task changed meanwhile; read it again." };
  const resuming = body.status === "active" && task.status !== "active";
  if (resuming && body.acceptCredits !== price) return { ok: false, code: "TASK_PRICE_NOT_SHOWN", reason: "The price of a run changed; read it again before resuming." };
  const every = body.every ?? task.every;
  /* A faster rhythm costs more a day: it is changed only at the price shown, and within the wallet's runs a day. */
  if (runsPerDay(every) > runsPerDay(task.every) && body.acceptCredits !== price) return { ok: false, code: "TASK_PRICE_NOT_SHOWN", reason: "A faster rhythm costs more a day; read the price again before changing it." };
  const active = (body.status ?? task.status) === "active";
  if (active && (resuming || every !== task.every)) {
    const room = await roomOf(store, owner, cap, pool, task.id);
    if (room.used + runsPerDay(every) > room.cap) return { ok: false, code: "TASK_RUNS_CAP", reason: `The tasks together run at most ${room.cap} times a day now; pick a slower rhythm or pause one.` };
  }
  const time = every === "1d" ? (body.time ?? task.time ?? "09:00") : null;
  const status = body.status ?? task.status;
  const rescheduled = resuming || every !== task.every || time !== task.time;
  const at = new Date(nowMs).toISOString();
  const next: TaskRecord = {
    ...task,
    version: task.version + 1,
    every,
    time,
    channels: body.channels ?? task.channels,
    onlyWhenNew: body.onlyWhenNew ?? task.onlyWhenNew,
    status,
    pausedBy: status === "paused" ? (body.status === "paused" ? "person" : task.pausedBy) : null,
    skippedAt: resuming ? null : task.skippedAt,
    priceCredits: resuming || runsPerDay(every) > runsPerDay(task.every) ? price : task.priceCredits,
    nextRunAt: rescheduled ? new Date(every === "1d" ? nextRunAt("1d", time, task.zone, nowMs) : nowMs + 60_000).toISOString() : task.nextRunAt,
    updatedAt: at,
  };
  if (!(await writeTask(store, next, task.version))) return { ok: false, code: "TASK_VERSION_CONFLICT", reason: "The task changed meanwhile; read it again." };
  return { ok: true, task: next };
}

export async function removeTask(store: GuardStore, owner: string, id: string): Promise<boolean> {
  const task = await readTask(store, owner, id);
  if (!task) return false;
  await deleteTask(store, owner, id);
  return true;
}
