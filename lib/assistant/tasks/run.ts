/**
 * The pass of «Доручення» (AI-19) — run by the server on a cron, whether or
 * not the person's computer is on.
 *
 * For each task whose slot has come:
 * - a lease, by compare-and-set, so two passes never run one task twice;
 * - the task's question, asked the way a person asks it — through the
 *   assistant's own message path, into the task's own conversation: the same
 *   reads, the same bounds, the same verification of every sentence, and the
 *   credits at the price shown when the task was turned on;
 * - one note in the inbox of Нагляд and, by the person's channels, Telegram and
 *   push — unless «лише коли є що сказати» and the answer says what the last
 *   one said;
 * - when the day's free credits and the balance cannot pay, the task pauses
 *   and one note says so with «Поповнити»; nothing is taken without the price
 *   having been shown.
 *
 * Nothing here signs, sends or trades; a task reads what the person could read.
 */

import { createHash } from "node:crypto";

import type { AgentMessageResponse } from "../../api/v1/contract.ts";
import type { GuardStore } from "../../guard/store.ts";
import { inboxKeyOf } from "../../monitoring/apply.ts";
import { inQuietHours } from "../../monitoring/quiet-hours.ts";
import { inboxOf, listInbox, outboxKey, outboxOf, readPreferences, type InboxRecord, type OutboxRecord } from "../../monitoring/store.ts";
import { nextRunAt } from "./schedule.ts";
import { listDueTasks, readTask, writeTask, type TaskRecord } from "./store.ts";
import { taskQuestion, taskTitle } from "./words.ts";

export const TASK_LEASE_MS = 5 * 60_000;
export const TASK_PASS_BUDGET_MS = 40_000;
/** Deliveries wait a moment so the inbox note is there first; the monitoring cron sends what the pass did not. */
export const TASK_DELIVERY_HOLD_MS = 30_000;

/** How the pass asks: the assistant's own path for one wallet — a conversation to write into, and a question in it. */
export type TaskAsker = Readonly<{
  openSession(owner: string, input: Readonly<{ locale: "en" | "uk"; sessionId: string | null }>): Promise<string | null>;
  ask(owner: string, input: Readonly<{ sessionId: string; text: string; locale: "en" | "uk"; acceptCredits: number }>): Promise<Readonly<{ ok: true; response: AgentMessageResponse }> | Readonly<{ ok: false; code: string }>>;
}>;

export type TaskPassDeps = Readonly<{
  store: GuardStore;
  nowMs: number;
  asker: (owner: string) => Promise<TaskAsker>;
  budgetMs?: number;
  /** The tasks' share of the deployment's day (`reserveTaskRun`); absent — not metered apart (tests). */
  pool?: () => Promise<Readonly<{ ok: true; refund: () => Promise<void> }> | Readonly<{ ok: false }>>;
  /** Send this pass's own deliveries now (the outbox rows it wrote, by id); absent — the monitoring cron sends them. */
  deliver?: (rows: ReadonlySet<string>, atMs: number) => Promise<void>;
}>;
export type TaskPassReport = Readonly<{ due: number; ran: number; delivered: number; quiet: number; paused: number; failed: number }>;

export const taskInboxId = (taskId: string, runAt: string) => `inb_${createHash("sha256").update(`assistant-task:${taskId}:${runAt}`).digest("hex").slice(0, 24)}`;
const taskMonitorId = (taskId: string) => `mon_${createHash("sha256").update(`assistant-task:${taskId}`).digest("hex").slice(0, 24)}`;
export const taskHref = (taskId: string) => `/app/ryn?task=${encodeURIComponent(taskId)}`;

/** What a person reads of an answer: its headline and its first sentences — the model's words, already verified. */
export function answerWords(response: AgentMessageResponse): Readonly<{ headline: string; body: string; digest: string; modelAnswered: boolean }> {
  const turn = response.ryn;
  const sections = turn.answer ? [...turn.answer.observation, ...turn.answer.meaning] : [];
  const lines = sections.map((sentence) => sentence.text).filter((text) => text.length > 0);
  const body = lines.slice(0, 3).join(" ").slice(0, 600);
  const digest = createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 32);
  return { headline: turn.text.slice(0, 200), body, digest, modelAnswered: turn.composedBy === "model" };
}

/** Whether the answer was composed without the model because the credits could not pay — the task waits for «Поповнити». */
export function creditsShort(response: AgentMessageResponse): boolean {
  const credits = response.budget.credits;
  if (!credits || response.ryn.composedBy === "model") return false;
  const fromBalance = Math.max(0, credits.prices.question - credits.free.left);
  return fromBalance > credits.balance || credits.dailySpend.used + fromBalance > credits.dailySpend.cap;
}

/**
 * What a run's answer means for the task — the reason the model was not reached, read from the answer's own budget:
 * `credits` (pause, «Поповнити»), `price` (a question costs more than the price shown: pause, «Продовжити» shows the new
 * one), `skip` (the model's day is spent for this wallet or the deployment: nothing is sent, the next slot asks again),
 * `say` (an answer to deliver).
 */
export function runOutcome(task: Pick<TaskRecord, "priceCredits">, response: AgentMessageResponse): "say" | "credits" | "price" | "skip" {
  if (response.ryn.composedBy === "model") return "say";
  const credits = response.budget.credits;
  if (credits && credits.prices.question > task.priceCredits) return "price";
  if (creditsShort(response)) return "credits";
  if (response.budget.exhausted || response.budget.model === "absent") return "skip";
  return "say";
}

/**
 * What the answer says, as a digest «лише коли є що нового» compares: the facts it stands on — the news items, the
 * holdings, the cards' figures — not the model's wording, which differs every run.
 */
export function factsDigest(response: AgentMessageResponse): string {
  const facts: string[] = [];
  for (const card of response.ryn.cards ?? []) {
    if (card.kind === "news") facts.push(...card.items.map((item) => `news:${item.id}`));
    else if (card.kind === "holdings") facts.push(...card.rows.map((row) => `hold:${row.mint}:${row.amount}`));
    else if (card.kind === "move") facts.push(...card.rows.map((row) => `move:${row.mark}:${row.text}`));
    else if ("figures" in card && Array.isArray(card.figures)) facts.push(...card.figures.map((figure) => `fig:${figure.label}:${figure.value}`));
  }
  const basis = facts.length > 0 ? facts.sort().join("|") : answerWords(response).body;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

async function lease(store: GuardStore, task: TaskRecord, nowMs: number): Promise<TaskRecord | null> {
  const at = new Date(nowMs).toISOString();
  const next: TaskRecord = { ...task, version: task.version + 1, leaseUntil: new Date(nowMs + TASK_LEASE_MS).toISOString(), updatedAt: at };
  return (await writeTask(store, next, task.version)) ? next : null;
}

async function queue(store: GuardStore, owner: string, identity: string, inboxId: string, channel: "telegram" | "push", nowMs: number, queued: Set<string>): Promise<void> {
  const at = new Date(nowMs).toISOString();
  const id = outboxKey(owner, identity, channel);
  const row: OutboxRecord = { id, owner, triggerId: identity, inboxId, channel, state: "pending", attempts: 0, nextAttemptAt: new Date(nowMs + TASK_DELIVERY_HOLD_MS).toISOString(), lastError: null, createdAt: at, updatedAt: at };
  if (await outboxOf(store).insertIfAbsent(id, row)) queued.add(id);
}

/** One note and its deliveries; written once per run — a retry of the same run writes nothing new. */
async function ring(store: GuardStore, task: TaskRecord, runAt: string, words: Readonly<{ title: string; reason: string }>, nowMs: number, queued: Set<string>): Promise<Readonly<{ inboxId: string; delivered: boolean }>> {
  const inboxId = taskInboxId(task.id, runAt);
  const identity = `assistant-task:${task.id}:${runAt}`;
  const note: InboxRecord = {
    id: inboxId,
    owner: task.owner,
    monitorId: taskMonitorId(task.id),
    triggerId: identity,
    title: words.title,
    reason: words.reason,
    context: "Ryntra",
    href: taskHref(task.id),
    cta: task.locale === "uk" ? "Відкрити" : "Open",
    paper: false,
    unread: true,
    createdAt: runAt,
    locale: task.locale,
    subject: { kind: "assistant-task", id: task.id },
  };
  await inboxOf(store).insertIfAbsent(inboxKeyOf(task.owner, inboxId), note);
  const prefs = await readPreferences(store, task.owner);
  if (inQuietHours(nowMs, prefs.quietHours)) return { inboxId, delivered: false };
  const telegram = prefs.telegram && task.channels.telegram;
  const push = prefs.push && task.channels.push;
  if (telegram) await queue(store, task.owner, identity, inboxId, "telegram", nowMs, queued);
  if (push) await queue(store, task.owner, identity, inboxId, "push", nowMs, queued);
  return { inboxId, delivered: telegram || push };
}

/** A task keeps its newest notes; its sent deliveries go after a day — a task every ten minutes never fills the store. */
export const TASK_NOTES_KEPT = 50;
const DELIVERY_KEPT_MS = 24 * 3_600_000;

async function prune(store: GuardStore, task: TaskRecord, nowMs: number): Promise<void> {
  const notes = (await listInbox(store, task.owner)).filter((note) => note.subject?.kind === "assistant-task" && note.subject.id === task.id);
  for (const note of notes.slice(TASK_NOTES_KEPT)) await inboxOf(store).delete(inboxKeyOf(task.owner, note.id));
  const sample = outboxKey(task.owner, `assistant-task:${task.id}:`, "push");
  const prefix = sample.slice(0, sample.lastIndexOf(":push"));
  for (const row of await outboxOf(store).valuesWithPrefix(prefix)) {
    if (row.state !== "pending" && nowMs - Date.parse(row.updatedAt) > DELIVERY_KEPT_MS) await outboxOf(store).delete(row.id);
  }
}

/** Settle a run by compare-and-set over the leased version; a person's change meanwhile wins, and the run's note stays. */
async function settle(store: GuardStore, leased: TaskRecord, change: (task: TaskRecord) => TaskRecord, nowMs: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readTask(store, leased.owner, leased.id);
    if (!current) return;
    const changed = change(current);
    /* «Пропущено» stays only on the slot the shared day refused; any other outcome is the task's word now. */
    const skippedAt = changed.skippedAt !== current.skippedAt ? changed.skippedAt : null;
    const next = { ...changed, skippedAt, version: current.version + 1, leaseUntil: null, updatedAt: new Date(nowMs).toISOString() };
    if (await writeTask(store, next, current.version)) return;
  }
}

async function runOne(deps: TaskPassDeps, task: TaskRecord, queued: Set<string>): Promise<"ran" | "delivered" | "quiet" | "paused" | "failed" | "skipped"> {
  const { store, nowMs } = deps;
  const leased = await lease(store, task, nowMs);
  if (!leased) return "skipped";
  const runAt = new Date(nowMs).toISOString();
  /* A zone the server cannot compute in (written before the schema checked it) falls back to Kyiv — never a stuck task. */
  let nextAt: string;
  try {
    nextAt = new Date(nextRunAt(task.every, task.time, task.zone, nowMs)).toISOString();
  } catch {
    nextAt = new Date(nextRunAt(task.every, task.time, "Europe/Kyiv", nowMs)).toISOString();
  }
  /* Every wallet's tasks together keep within their share of the day: past it, the slot passes quietly. */
  const share = deps.pool ? await deps.pool() : null;
  if (share && !share.ok) {
    await settle(store, leased, (current) => ({ ...current, nextRunAt: nextAt, skippedAt: runAt }), nowMs).catch(() => undefined);
    return "quiet";
  }
  let given = false;
  const giveBack = async () => {
    if (!share?.ok || given) return;
    given = true;
    await share.refund();
  };
  try {
    const asker = await deps.asker(task.owner);
    const sessionId = await asker.openSession(task.owner, { locale: task.locale, sessionId: task.sessionId });
    if (!sessionId) {
      await giveBack();
      await settle(store, leased, (current) => ({ ...current, nextRunAt: nextAt }), nowMs);
      return "failed";
    }
    const asked = await asker.ask(task.owner, { sessionId, text: taskQuestion(task.ask, task.locale), locale: task.locale, acceptCredits: task.priceCredits });
    if (!asked.ok) {
      await giveBack();
      /* Busy (the person is asking now) or a store that did not answer: the next slot asks again. */
      await settle(store, leased, (current) => ({ ...current, sessionId, nextRunAt: nextAt }), nowMs);
      return "failed";
    }
    const outcome = runOutcome(task, asked.response);
    if (outcome !== "say") await giveBack();
    else given = true; /* The model was asked: whatever fails after this, the share stays spent. */
    if (outcome === "credits" || outcome === "price") {
      const words = taskTitle(task, outcome === "credits" ? "paused-credits" : "paused-price");
      const rung = await ring(store, task, runAt, words, nowMs, queued);
      await settle(store, leased, (current) => ({ ...current, sessionId, status: "paused", pausedBy: outcome, last: { at: runAt, digest: current.last?.digest ?? "", headline: words.title, inboxId: rung.inboxId, delivered: rung.delivered } }), nowMs);
      return "paused";
    }
    if (outcome === "skip") {
      /* The model's day is spent: a template sent every ten minutes would be noise — the next slot asks again. */
      await settle(store, leased, (current) => ({ ...current, sessionId, nextRunAt: nextAt }), nowMs);
      return "quiet";
    }
    const said = { ...answerWords(asked.response), digest: factsDigest(asked.response) };
    const same = task.onlyWhenNew && task.last !== null && task.last.digest === said.digest;
    if (same) {
      await settle(store, leased, (current) => ({ ...current, sessionId, nextRunAt: nextAt, skippedAt: null, runs: current.runs + 1, last: current.last ? { ...current.last, at: runAt } : null }), nowMs);
      return "quiet";
    }
    const words = { title: `${taskTitle(task, "ran").title} · ${said.headline}`.slice(0, 200), reason: said.body.length > 0 ? said.body : said.headline };
    const rung = await ring(store, task, runAt, words, nowMs, queued);
    await settle(store, leased, (current) => ({ ...current, sessionId, nextRunAt: nextAt, skippedAt: null, runs: current.runs + 1, last: { at: runAt, digest: said.digest, headline: said.headline, inboxId: rung.inboxId, delivered: rung.delivered } }), nowMs);
    await prune(store, task, nowMs).catch(() => undefined);
    return rung.delivered ? "delivered" : "ran";
  } catch {
    await giveBack().catch(() => undefined);
    await settle(store, leased, (current) => ({ ...current, nextRunAt: nextAt }), nowMs).catch(() => undefined);
    return "failed";
  }
}

/** One pass: every due task, one at a time, within the budget; what is left runs on the next minute's pass. */
export async function runTaskPass(deps: TaskPassDeps): Promise<TaskPassReport> {
  const started = Date.now();
  const budget = deps.budgetMs ?? TASK_PASS_BUDGET_MS;
  /* The longest waiting first — never the same wallets first every day by the order of their keys. */
  const due = [...(await listDueTasks(deps.store, deps.nowMs))].sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt) || Date.parse(a.last?.at ?? a.createdAt) - Date.parse(b.last?.at ?? b.createdAt));
  const tally = { due: due.length, ran: 0, delivered: 0, quiet: 0, paused: 0, failed: 0 };
  const queued = new Set<string>();
  for (const task of due) {
    if (Date.now() - started > budget) break;
    const outcome = await runOne(deps, task, queued);
    if (outcome === "ran") tally.ran += 1;
    if (outcome === "delivered") {
      tally.ran += 1;
      tally.delivered += 1;
    }
    if (outcome === "quiet") tally.quiet += 1;
    if (outcome === "paused") tally.paused += 1;
    if (outcome === "failed") tally.failed += 1;
  }
  /* The notes are written; their Telegram and push go now, past the short hold — a row a retry wrote stays with the monitoring cron. */
  if (deps.deliver && queued.size > 0) await deps.deliver(queued, deps.nowMs + TASK_DELIVERY_HOLD_MS).catch(() => undefined);
  return tally;
}
