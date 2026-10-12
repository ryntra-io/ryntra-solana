/**
 * The monitoring surface as a wallet reads it, composed from its monitors and
 * its notes — pure, so a test composes exactly what the route answers without
 * a store behind the service (`readMonitoringSurface` reads, syncs and calls
 * this). The shape is the contract's `MonitoringSurfaceResponseSchema` less
 * `preferences`, proven equal at compile time (`lib/api/v1/route-types.test.ts`).
 */

import { words } from "./copy.ts";
import type { MonitorStatus } from "./engine.ts";
import type { InboxFinding, InboxRecord, InboxRuleState, MonitorRecord, MonitorSubject } from "./store.ts";

export type MonitoringSurface = Readonly<{
  attention: readonly SurfaceCard[];
  watching: readonly SurfaceCard[];
  recent: readonly InboxRecord[];
  unread: number;
}>;

export type SurfaceCard = Readonly<{
  monitorId: string;
  label: string;
  status: MonitorStatus;
  title: string;
  reason: string;
  href: string;
  cta: string;
  paper: boolean;
  lastCheckedAt: string | null;
  lastTriggeredAt: string | null;
  /** The exact record the card stands for (2026-09-22): two plans on one symbol are two cards with two ids. */
  subject: MonitorSubject;
  /** The latest unread note's finding as figures, where the note carries one. */
  finding: InboxFinding | null;
}>;

/** A note's words in the reader's language where the note holds both, else as the tick wrote them. */
export function noteInLocale(row: InboxRecord, locale: "en" | "uk"): InboxRecord {
  if (!row.text) return row;
  const words = row.text[locale];
  return words.title === row.title && words.reason === row.reason ? row : { ...row, title: words.title, reason: words.reason };
}

/**
 * `ruleStateOf` (1.13.0) says what became of a rule's reminder as the rule
 * reads it now — the service reads the rules and History for it; a note it
 * says nothing of carries no `ruleState`.
 */
export function composeMonitoringSurface(monitors: readonly MonitorRecord[], notes: readonly InboxRecord[], locale: "en" | "uk", ruleStateOf: (note: InboxRecord) => InboxRuleState | null = () => null): MonitoringSurface {
  /* Every note in the reader's language where it holds both, a rule's reminder with what became of it. */
  const recent = notes.map((row) => {
    const read = noteInLocale(row, locale);
    const ruleState = read.subject?.kind === "autoinvest-rule" ? ruleStateOf(read) : null;
    return ruleState ? { ...read, ruleState } : read;
  });
  const w = words(locale);
  const cards: SurfaceCard[] = monitors.map((row) => {
    const material = recent.find((item) => item.monitorId === row.id && item.unread);
    const needs = row.status === "needs_attention";
    /* 1.21.0: a position under «Ryntra попередить» — the sale when it needs the person, the company otherwise. */
    const cta = row.subjectKind === "position"
      ? needs ? w.openSale : w.openPosition
      : needs
        ? row.paper ? w.reviewPrediction : w.reviewPlan
        : row.paper ? w.openPrediction : w.openPlan;
    const openId = material?.id ?? row.id;
    return {
      monitorId: row.id,
      label: row.label,
      status: row.status,
      title: material?.title ?? (row.status === "watching" ? w.watching : row.status === "paused" ? w.paused : row.status === "unavailable" ? w.unavailable : w.needsAttention),
      reason: material?.reason ?? "",
      href: `/app/alerts/open?n=${openId}`,
      cta,
      paper: row.paper,
      lastCheckedAt: row.lastCheckedAt,
      lastTriggeredAt: row.lastTriggeredAt,
      subject: { kind: row.subjectKind, id: row.subjectId },
      finding: material?.finding ?? null,
    };
  });
  return {
    attention: cards.filter((row) => row.status === "needs_attention"),
    watching: cards.filter((row) => row.status === "watching" || row.status === "unavailable" || row.status === "paused"),
    recent,
    unread: recent.filter((row) => row.unread).length,
  };
}
