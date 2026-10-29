/**
 * «Доручення» in the Guard store (AI-19) — in the collection `assistantWatches`
 * beside the token watches, under their own key, no DDL:
 *
 * - `task:solana:mainnet:<wallet>:<id>` — what to ask, how often, where the
 *   answer goes, whether to stay quiet when nothing is new, when it runs next
 *   and what it said last; versioned by compare-and-set, so the pass that runs
 *   it and the person pausing it from the phone cannot both win.
 *
 * A task asks the assistant a question on a schedule — the same question a
 * person could type — and reads nothing the person could not read; it signs,
 * sends and trades nothing.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { GuardStore } from "../../guard/store.ts";
import { TASK_EVERY } from "./schedule.ts";

export const TASKS_COLLECTION = "assistantWatches" as const;
export const TASKS_MAX = 5;
export const TASK_TEXT_MAX = 300;
const PREFIX = "task:solana:mainnet:";

const Wallet = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Mint = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Iso = z.string().datetime({ offset: true });

export const TASK_KINDS = ["question", "news", "move", "portfolio"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TaskAskSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("question"), text: z.string().min(3).max(TASK_TEXT_MAX) }).strict(),
  z.object({ kind: z.literal("news"), mint: Mint, symbol: z.string().min(1).max(16) }).strict(),
  z.object({ kind: z.literal("move"), mint: Mint, symbol: z.string().min(1).max(16) }).strict(),
  z.object({ kind: z.literal("portfolio") }).strict(),
]);
export type TaskAsk = z.infer<typeof TaskAskSchema>;

export const TaskRecordSchema = z
  .object({
    schema: z.literal("ryntra.assistant.task"),
    version: z.number().int().min(1),
    id: z.string().regex(/^t_[0-9a-f]{12}$/),
    owner: Wallet,
    ask: TaskAskSchema,
    every: z.enum(TASK_EVERY),
    /** For `1d`: the time on the person's clock. */
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    zone: z.string().min(1).max(64),
    locale: z.enum(["en", "uk"]),
    /** Stay quiet when the answer says what the last one said. */
    onlyWhenNew: z.boolean(),
    channels: z.object({ telegram: z.boolean(), push: z.boolean() }).strict(),
    status: z.enum(["active", "paused"]),
    /** Why it stopped: the person paused it, or the credits ran out (it waits; «Продовжити» starts it again). */
    pausedBy: z.enum(["person", "credits", "price"]).nullable(),
    /** The price of one run in credits, as shown when it was turned on — a run never takes more. */
    priceCredits: z.number().int().min(0).max(1_000),
    /** The conversation the runs are written into — the person opens it from the note. */
    sessionId: z.string().min(1).max(80).nullable(),
    nextRunAt: Iso,
    /** While a pass runs it: no second pass takes it before this moment. */
    leaseUntil: Iso.nullable(),
    /** The last slot that passed because every wallet's tasks spent their share of the day; cleared by the next run. */
    skippedAt: Iso.nullable().default(null),
    last: z.object({ at: Iso, digest: z.string().max(64), headline: z.string().max(200), inboxId: z.string().max(120).nullable(), delivered: z.boolean() }).strict().nullable(),
    runs: z.number().int().min(0),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export const taskKey = (owner: string, id: string) => `${PREFIX}${owner}:${id}`;
export const newTaskId = () => `t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

type Versioned = { version: number };
const rows = (store: GuardStore) => store.versioned<Versioned & Record<string, unknown>>(TASKS_COLLECTION);

function parse(row: unknown): TaskRecord | null {
  const parsed = TaskRecordSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

export async function readTask(store: GuardStore, owner: string, id: string): Promise<TaskRecord | null> {
  const task = parse(await rows(store).get(taskKey(owner, id)));
  return task && task.owner === owner && task.id === id ? task : null;
}

/** A wallet's tasks, oldest first — never another wallet's: the prefix carries the address. */
export async function listTasks(store: GuardStore, owner: string): Promise<readonly TaskRecord[]> {
  const found = (await rows(store).valuesWithPrefix(`${PREFIX}${owner}:`)).flatMap((row) => {
    const task = parse(row);
    return task && task.owner === owner ? [task] : [];
  });
  return found.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Every active task whose slot has come — the pass's one scan. */
/** Every wallet's tasks — for the share of the day all of them take together. */
export async function listAllTasks(store: GuardStore): Promise<readonly TaskRecord[]> {
  return (await rows(store).valuesWithPrefix(PREFIX)).flatMap((row) => {
    const task = parse(row);
    return task ? [task] : [];
  });
}

export async function listDueTasks(store: GuardStore, nowMs: number): Promise<readonly TaskRecord[]> {
  return (await rows(store).valuesWithPrefix(PREFIX)).flatMap((row) => {
    const task = parse(row);
    if (!task || task.status !== "active") return [];
    if (Date.parse(task.nextRunAt) > nowMs) return [];
    if (task.leaseUntil && Date.parse(task.leaseUntil) > nowMs) return [];
    return [task];
  });
}

/** Write over the version read (`null` — a new task); false when someone else wrote first. */
export async function writeTask(store: GuardStore, next: TaskRecord, expected: number | null): Promise<boolean> {
  return rows(store).compareAndSet(taskKey(next.owner, next.id), expected, TaskRecordSchema.parse(next));
}

export async function deleteTask(store: GuardStore, owner: string, id: string): Promise<void> {
  await rows(store).delete(taskKey(owner, id));
}
