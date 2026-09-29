/**
 * Durable write of an evaluation: claim each crossing once, inbox, outbox.
 * Nothing here talks to Telegram, a push provider or a wallet account.
 */

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { nextObservations, type Finding, type MonitorStatus } from "./engine.ts";
import { words } from "./copy.ts";
import {
  claimTrigger,
  inboxOf,
  monitorKey,
  monitorsOf,
  newInboxId,
  outboxKey,
  outboxOf,
  readPreferences,
  type InboxRecord,
  type MonitorRecord,
  type OutboxRecord,
} from "./store.ts";

export function inboxKeyOf(owner: string, id: string): string {
  return `solana:mainnet:${owner}:${id}`;
}

export function pushDeliveryState(deviceCount: number, hasProvider: boolean): OutboxRecord["state"] {
  if (deviceCount === 0) return "skipped_no_destination";
  if (!hasProvider) return "skipped_no_provider";
  return "pending";
}

/** One delivery of a note on one channel, claimed once per crossing: a retried tick is not a second message. */
export async function enqueue(
  store: GuardStore,
  owner: string,
  triggerId: string,
  inboxId: string,
  channel: "telegram" | "push",
  at: string,
): Promise<void> {
  const id = outboxKey(owner, triggerId, channel);
  const row: OutboxRecord = {
    id,
    owner,
    triggerId,
    inboxId,
    channel,
    state: "pending",
    attempts: 0,
    nextAttemptAt: at,
    lastError: null,
    createdAt: at,
    updatedAt: at,
  };
  await outboxOf(store).insertIfAbsent(id, row);
}

/** Write observations, claim each crossing once, enqueue at most one row per channel. */
export async function applyMonitorResult(
  store: GuardStore,
  monitor: MonitorRecord,
  status: MonitorStatus,
  findings: readonly Finding[],
  crossings: readonly { identity: string; finding: Finding }[],
  nowMs: number,
  locale: "en" | "uk",
  href: string,
  /** 1.21.0: the note's one action where it is not a plan's Review — «Відкрити продаж» for a position under «Ryntra попередить». */
  options: Readonly<{ cta?: string }> = {},
): Promise<void> {
  const at = new Date(nowMs).toISOString();
  let lastTriggeredAt = monitor.lastTriggeredAt;
  const w = words(locale);
  for (const crossing of crossings) {
    const claimed = await claimTrigger(store, crossing.identity, at);
    if (!claimed) continue;
    lastTriggeredAt = at;
    const inboxId = newInboxId();
    const title = crossing.finding.title[locale];
    const reason = crossing.finding.reason[locale];
    const cta = options.cta ?? (monitor.paper ? w.reviewPrediction : w.reviewPlan);
    const deep = `/app/alerts/open?n=${inboxId}`;
    const inbox: InboxRecord = {
      id: inboxId,
      owner: monitor.owner,
      monitorId: monitor.id,
      triggerId: crossing.identity,
      title,
      reason,
      context: monitor.label,
      href: deep,
      cta,
      paper: monitor.paper,
      unread: true,
      createdAt: at,
      locale,
      /* The exact record the note is about, both languages of its words and the figures behind them (2026-09-22). */
      subject: { kind: monitor.subjectKind, id: monitor.subjectId },
      text: { en: { title: crossing.finding.title.en, reason: crossing.finding.reason.en }, uk: { title: crossing.finding.title.uk, reason: crossing.finding.reason.uk } },
      ...(crossing.finding.facts ? { finding: { kind: crossing.finding.kind, outcome: crossing.finding.outcome, facts: crossing.finding.facts } } : {}),
    };
    await inboxOf(store).insertIfAbsent(inboxKeyOf(monitor.owner, inboxId), inbox);
    const prefs = await readPreferences(store, monitor.owner);
    if (prefs.telegram) {
      await enqueue(store, monitor.owner, crossing.identity, inboxId, "telegram", at);
    }
    if (prefs.push) {
      await enqueue(store, monitor.owner, crossing.identity, inboxId, "push", at);
    }
  }
  await withBoundedCasRetry(async () => {
    const current = await monitorsOf(store).get(monitorKey(monitor.owner, monitor.id));
    if (!current || current.owner !== monitor.owner) return true;
    return monitorsOf(store).compareAndSet(monitorKey(monitor.owner, monitor.id), current.version, {
      ...current,
      version: current.version + 1,
      status,
      observations: nextObservations(at, findings),
      lastCheckedAt: at,
      lastTriggeredAt,
      href,
      updatedAt: at,
    });
  });
}
