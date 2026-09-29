/**
 * Overview command-centre projection.
 *
 * Every cell carries a status beside its value: `measured` is a real count
 * over an applied source (zero included), `unknown` is a source that answered
 * without this figure, `not_collected` is a store that is not applied yet,
 * `unavailable` is a source that failed on this read, `insufficient` is a
 * rate whose denominator is zero or whose cohort has not completed, and `none`
 * is a measured absence (no open thread has an age). A surface never draws
 * any of the last five as a number.
 *
 * One failing source hides nothing else: the projection is pure over whatever
 * the route managed to read.
 */

import type { ActivityRead, ActivitySummary } from "./activity.ts";
import type { BroadcastListRow } from "./broadcast.ts";
import type { FeedbackListRow } from "./feedback.ts";
import type { MetricId } from "./metrics.ts";

export type CellStatus = "measured" | "unknown" | "not_collected" | "unavailable" | "insufficient" | "none";

export type Cell = Readonly<{
  value: number | undefined;
  status: CellStatus;
  /** Sample size behind a rate, when the metric has one. */
  n?: number;
  /** Which cohort or period the value belongs to, when that matters. */
  period?: string;
}>;

export function measured(value: number, extra: { n?: number; period?: string } = {}): Cell {
  return { value, status: "measured", ...extra };
}
export function unknownCell(): Cell {
  return { value: undefined, status: "unknown" };
}
export function notCollected(): Cell {
  return { value: undefined, status: "not_collected" };
}
export function unavailable(): Cell {
  return { value: undefined, status: "unavailable" };
}
export function insufficient(n = 0): Cell {
  return { value: undefined, status: "insufficient", n };
}
/** A measured absence: the source answered and there is no such fact (no open thread has an age). */
export function none(): Cell {
  return { value: undefined, status: "none" };
}

export type ServiceCell = Readonly<{
  id: string;
  label: string;
  state: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN" | "UNCONFIGURED";
}>;

export type AttentionTone = "ok" | "warn" | "risk" | "muted";

export type AttentionItem = Readonly<{
  id: string;
  label: string;
  value: number | undefined;
  tone: AttentionTone;
  href: string;
}>;

export type OverviewModel = Readonly<{
  generatedAt: string;
  coverage: Readonly<{
    activity: "measured" | "not_collected" | "unavailable";
    loginsSince: string | null;
    eventsSince: string | null;
  }>;
  accounts: Readonly<{
    total: Cell;
    new7d: Cell;
    signedIn7d: Cell;
    acted7d: Cell;
    activation14d: Cell;
    retentionW1: Cell;
    operators: Cell;
  }>;
  funnel: Readonly<{
    botStarts: Cell;
    accessConfirmed: Cell;
    firstLogin: Cell;
    firstAction: Cell;
    returnedW1: Cell;
  }>;
  support: Readonly<{ open: Cell; waiting: Cell; oldestOpenHours: Cell; securityOpen: Cell }>;
  problems: Readonly<{
    errors7d: Cell;
    accountsWithErrors7d: Cell;
    errorClasses: readonly { name: string; count: number }[];
    broadcastFailures: Cell;
  }>;
  demand: Readonly<{
    paperActive: Cell;
    paperActions24h: Cell;
    journalNoteRows: Cell;
    watchedAddresses: Cell;
    siteCta14d: Cell;
    siteWorkspaceCta14d: Cell;
  }>;
  daily30d: readonly { day: string; signedIn: number; acted: number; errors: number }[];
  services: readonly ServiceCell[];
  attention: readonly AttentionItem[];
}>;

/** Which definition each cell on the Overview renders from. */
export const OVERVIEW_METRIC_IDS: Readonly<Record<string, MetricId>> = {
  "accounts.total": "accounts_total",
  "accounts.new7d": "accounts_new_7d",
  "accounts.signedIn7d": "signed_in_7d",
  "accounts.acted7d": "acted_7d",
  "accounts.activation14d": "activation_14d",
  "accounts.retentionW1": "retention_w1",
  "accounts.operators": "operators_accounts",
  "funnel.botStarts": "funnel_bot_starts",
  "funnel.accessConfirmed": "funnel_access_confirmed",
  "funnel.firstLogin": "funnel_first_login",
  "funnel.firstAction": "funnel_first_action",
  "funnel.returnedW1": "funnel_returned_w1",
  "support.open": "support_open",
  "support.waiting": "support_waiting",
  "support.oldestOpenHours": "support_oldest_open_hours",
  "support.securityOpen": "support_security_open",
  "problems.errors7d": "errors_7d",
  "problems.accountsWithErrors7d": "accounts_with_errors_7d",
  "problems.broadcastFailures": "broadcast_failures",
  "demand.paperActive": "paper_active",
  "demand.paperActions24h": "paper_actions_24h",
  "demand.journalNoteRows": "journal_note_rows",
  "demand.watchedAddresses": "watched_addresses",
  "demand.siteCta14d": "site_cta_14d",
  "demand.siteWorkspaceCta14d": "site_workspace_cta_14d",
};

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cellFrom(value: unknown, sourceOk: boolean): Cell {
  if (!sourceOk) return unavailable();
  const n = num(value);
  return n === undefined ? unknownCell() : measured(n);
}

function activityCell(read: ActivityRead, pick: (summary: ActivitySummary) => number): Cell {
  if (read.status === "not_collected") return notCollected();
  if (read.status === "unavailable") return unavailable();
  return measured(pick(read.summary));
}

function rateCell(read: ActivityRead, pick: (summary: ActivitySummary) => { n: number; hit: number; period?: string } | null): Cell {
  if (read.status === "not_collected") return notCollected();
  if (read.status === "unavailable") return unavailable();
  const picked = pick(read.summary);
  if (!picked || picked.n <= 0) return insufficient(picked?.n ?? 0);
  return measured(picked.hit / picked.n, { n: picked.n, period: picked.period });
}

function latestCompleteCohort(summary: ActivitySummary) {
  const complete = summary.cohorts.filter((cohort) => cohort.complete && cohort.n > 0);
  if (complete.length === 0) return null;
  const last = complete[complete.length - 1];
  return { n: last.n, hit: last.returnedW1, period: last.week };
}

/** Thirty calendar days ending today (UTC), zeros where the store measured nothing. */
export function fillDaily30d(
  rows: readonly { day: string; signedIn: number; acted: number; errors: number }[],
  now: Date,
): { day: string; signedIn: number; acted: number; errors: number }[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const out: { day: string; signedIn: number; acted: number; errors: number }[] = [];
  const cursor = new Date(now);
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() - 29);
  for (let i = 0; i < 30; i += 1) {
    const day = cursor.toISOString().slice(0, 10);
    const row = byDay.get(day);
    out.push(row ? { ...row } : { day, signedIn: 0, acted: 0, errors: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function hoursBetween(from: string, now: Date): number | undefined {
  const start = Date.parse(from);
  if (!Number.isFinite(start)) return undefined;
  return Math.max(0, Math.round((now.getTime() - start) / 3_600_000));
}

export function projectOverview(input: {
  metrics: Record<string, unknown> | null;
  extra: Record<string, unknown> | null;
  feedback: { rows: FeedbackListRow[] | null };
  broadcasts: BroadcastListRow[] | null;
  activity: ActivityRead;
  services?: readonly ServiceCell[];
  /** Attention rows from sources the overview does not read itself — the money's (RYN-ADMIN-FEEDBACK-LOOP-001). */
  extraAttention?: readonly AttentionItem[];
  now?: Date;
}): OverviewModel {
  const now = input.now ?? new Date();
  const metrics = input.metrics;
  const extra = input.extra;
  const metricsOk = metrics !== null;
  const extraOk = extra !== null;
  const tasks = (metrics?.tasks ?? {}) as Record<string, unknown>;
  const cta = (metrics?.cta_events_14d ?? {}) as Record<string, unknown>;
  const paper = (extra?.paper ?? {}) as Record<string, unknown>;
  const live = (extra?.live ?? {}) as Record<string, unknown>;
  const activity = input.activity;

  /* Accounts: the activity store owns the operator-free total; beta_metrics
     only knows every account, operators included. */
  const total =
    activity.status === "measured"
      ? measured(activity.summary.accounts.total)
      : cellFrom(metrics?.users_total, metricsOk);

  const feedbackRows = input.feedback.rows;
  const feedbackOk = feedbackRows !== null;
  const openRows = feedbackOk ? feedbackRows.filter((row) => row.status === "OPEN") : [];
  const waitingRows = feedbackOk ? feedbackRows.filter((row) => row.status === "WAITING") : [];
  const securityRows = feedbackOk
    ? feedbackRows.filter((row) => row.priority === "SECURITY" && row.status !== "CLOSED")
    : [];
  const oldestOpen = openRows
    .map((row) => hoursBetween(row.created_at, now))
    .filter((hours): hours is number => hours !== undefined)
    .sort((a, b) => b - a)[0];

  const broadcastsOk = input.broadcasts !== null;
  const broadcastFailures = broadcastsOk
    ? (input.broadcasts ?? [])
        .filter((row) => row.state === "SENDING" || row.state === "PARTIAL" || row.state === "QUEUED")
        .reduce((sum, row) => sum + (num(row.failed_count) ?? 0) + (num(row.blocked_count) ?? 0), 0)
    : undefined;

  const errorClasses =
    activity.status === "measured"
      ? Object.entries(activity.summary.events.errorClasses7d)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
      : [];

  const model: OverviewModel = {
    generatedAt: now.toISOString(),
    coverage: {
      activity: activity.status,
      loginsSince: activity.status === "measured" ? activity.summary.coverage.loginsSince : null,
      eventsSince: activity.status === "measured" ? activity.summary.coverage.eventsSince : null,
    },
    accounts: {
      total,
      new7d: activityCell(activity, (s) => s.accounts.new7d),
      signedIn7d: activityCell(activity, (s) => s.accounts.signedIn7d),
      acted7d: activityCell(activity, (s) => s.accounts.acted7d),
      activation14d: rateCell(activity, (s) => ({ n: s.activation14d.n, hit: s.activation14d.activated })),
      retentionW1: rateCell(activity, latestCompleteCohort),
      operators: activityCell(activity, (s) => s.operators.accounts),
    },
    funnel: {
      botStarts:
        activity.status === "measured"
          ? measured(activity.summary.accounts.total)
          : cellFrom(metrics?.users_total, metricsOk),
      accessConfirmed: cellFrom(tasks.telegram_verified, metricsOk),
      firstLogin: activityCell(activity, (s) => s.accounts.everSignedIn),
      firstAction: activityCell(activity, (s) => s.accounts.activated),
      returnedW1:
        activity.status === "measured"
          ? (() => {
              const cohort = latestCompleteCohort(activity.summary);
              return cohort ? measured(cohort.hit, { n: cohort.n, period: cohort.period }) : insufficient(0);
            })()
          : activityCell(activity, () => 0),
    },
    support: {
      open: feedbackOk ? measured(openRows.length) : unavailable(),
      waiting: feedbackOk ? measured(waitingRows.length) : unavailable(),
      oldestOpenHours: feedbackOk ? (oldestOpen === undefined ? none() : measured(oldestOpen)) : unavailable(),
      securityOpen: feedbackOk ? measured(securityRows.length) : unavailable(),
    },
    problems: {
      errors7d: activityCell(activity, (s) => s.events.error7d),
      accountsWithErrors7d: activityCell(activity, (s) => s.accounts.withErrors7d),
      errorClasses,
      broadcastFailures: broadcastsOk ? measured(broadcastFailures ?? 0) : unavailable(),
    },
    demand: {
      paperActive: cellFrom(paper.traders, extraOk),
      paperActions24h: cellFrom(paper.trades_24h, extraOk),
      journalNoteRows: cellFrom(live.journal_notes, extraOk),
      watchedAddresses: cellFrom(live.watched_addresses, extraOk),
      siteCta14d: metricsOk ? measured(num(cta.telegram_cta_click) ?? 0) : unavailable(),
      siteWorkspaceCta14d: metricsOk ? measured(num(cta.workspace_cta_click) ?? 0) : unavailable(),
    },
    daily30d: activity.status === "measured" ? fillDaily30d(activity.summary.daily30d, now) : [],
    services: input.services ?? [],
    attention: [],
  };

  return { ...model, attention: [...attentionItems(model), ...(input.extraAttention ?? [])] };
}

/** What needs the operator today, each with the filtered list it opens. */
export function attentionItems(model: OverviewModel): AttentionItem[] {
  const items: AttentionItem[] = [];
  const push = (item: AttentionItem) => items.push(item);

  if (model.support.securityOpen.status === "measured" && (model.support.securityOpen.value ?? 0) > 0) {
    push({ id: "security", label: "Security-звернення без закриття", value: model.support.securityOpen.value, tone: "risk", href: "/admin/feedback?status=OPEN" });
  }
  if (model.support.open.status === "measured" && (model.support.open.value ?? 0) > 0) {
    push({ id: "feedback_open", label: "Звернення без відповіді", value: model.support.open.value, tone: "warn", href: "/admin/feedback?status=OPEN" });
  }
  if (model.problems.errors7d.status === "measured" && (model.problems.errors7d.value ?? 0) > 0) {
    push({ id: "errors", label: "Серверні помилки за 7 днів", value: model.problems.errors7d.value, tone: "warn", href: "/admin/users?filter=errors_7d" });
  }
  if (model.problems.broadcastFailures.status === "measured" && (model.problems.broadcastFailures.value ?? 0) > 0) {
    push({ id: "broadcast", label: "Недоставлені розсилки", value: model.problems.broadcastFailures.value, tone: "warn", href: "/admin/broadcasts" });
  }
  const unhealthy = model.services.filter((service) => service.state === "UNAVAILABLE" || service.state === "DEGRADED" || service.state === "UNKNOWN");
  if (unhealthy.length > 0) {
    push({
      id: "services",
      label: unhealthy.some((s) => s.state === "UNAVAILABLE") ? "Провайдери недоступні" : "Провайдери потребують уваги",
      value: unhealthy.length,
      tone: unhealthy.some((s) => s.state === "UNAVAILABLE") ? "risk" : "warn",
      href: "/admin/operations",
    });
  }
  if (model.coverage.activity === "not_collected") {
    push({ id: "coverage", label: "Історія входів і дій ще не збирається", value: undefined, tone: "muted", href: "/admin/operations#coverage" });
  } else if (model.coverage.activity === "unavailable") {
    push({ id: "coverage_unavailable", label: "Сховище активності не відповіло", value: undefined, tone: "risk", href: "/admin/operations#coverage" });
  }
  for (const [key, cell] of [
    ["feedback", model.support.open],
    ["broadcasts", model.problems.broadcastFailures],
  ] as const) {
    if (cell.status === "unavailable") {
      push({ id: `${key}_unavailable`, label: key === "feedback" ? "Інбокс звернень не відповів" : "Broadcast Center не відповів", value: undefined, tone: "risk", href: key === "feedback" ? "/admin/feedback" : "/admin/broadcasts" });
    }
  }
  return items;
}
