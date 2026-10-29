import type { DraftStore } from '../moments/drafts/store.ts';
import type { XConfig } from './config.ts';
import { LIVE, type XLedger, type XPostStatus } from './ledger.ts';
import { sumUsd } from './pricing.ts';
import { daySlots, localTime } from './schedule.ts';
import type { XPublisher } from './sender.ts';

/**
 * The day's report: each slot and what became of it, the posts made, failed or unsure, what they cost against the
 * day's budget, and how many approved drafts wait. The cron hands it back on every pass; an operator reads it at
 * `GET /api/x/report?day=YYYY-MM-DD`.
 */

export type SlotLine = {
  time: string;
  /** `ahead`, `open` or `over` for a slot with no post; the post's status otherwise. */
  state: XPostStatus | 'ahead' | 'open' | 'missed';
  draftId: string | null;
  postId: string | null;
  error: string | null;
  costUsd: number;
};

export type DayReport = {
  day: string;
  tz: string;
  sender: { connected: boolean; reason: string | null };
  switchOn: boolean;
  slots: SlotLine[];
  posted: number;
  failed: number;
  unsure: number;
  withLink: number;
  costUsd: number;
  budgetUsd: number;
  /** Approved drafts waiting for a slot (up to 50 counted). */
  waiting: number;
  /** The same, in lines a person reads. */
  summary: string[];
};

export const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function dayReport(deps: {
  ledger: XLedger;
  store: DraftStore;
  sender: XPublisher;
  config: Pick<XConfig, 'slots' | 'dailyUsd'>;
  day?: string;
  now?: () => Date;
}): Promise<DayReport> {
  const at = (deps.now ?? (() => new Date()))();
  const day = deps.day ?? localTime(at, deps.config.slots.tz).day;
  const [rows, sw, waiting] = await Promise.all([
    deps.ledger.day(day),
    deps.store.switch(),
    deps.store.list({ status: 'approved', limit: 50 }).then((d) => d.length),
  ]);
  const bySlot = new Map(rows.map((r) => [r.slot.slice(11), r]));
  const slots: SlotLine[] = daySlots(day, at, deps.config.slots).map((s) => {
    const r = bySlot.get(s.time);
    bySlot.delete(s.time);
    if (r) return { time: s.time, state: r.status, draftId: r.draftId, postId: r.postId, error: r.error, costUsd: LIVE.includes(r.status) ? r.costUsd : 0 };
    return { time: s.time, state: s.window === 'over' ? 'missed' : s.window, draftId: null, postId: null, error: null, costUsd: 0 };
  });
  // A post made at a time the schedule no longer has still counts.
  for (const [time, r] of bySlot) slots.push({ time, state: r.status, draftId: r.draftId, postId: r.postId, error: r.error, costUsd: LIVE.includes(r.status) ? r.costUsd : 0 });
  slots.sort((a, b) => a.time.localeCompare(b.time));

  const count = (s: XPostStatus) => rows.filter((r) => r.status === s).length;
  const costUsd = sumUsd(slots.map((s) => s.costUsd));
  const report: Omit<DayReport, 'summary'> = {
    day,
    tz: deps.config.slots.tz,
    sender: { connected: deps.sender.connected, reason: deps.sender.reason },
    switchOn: sw.on,
    slots,
    posted: count('sent'),
    failed: count('failed'),
    unsure: count('unsure'),
    withLink: rows.filter((r) => r.status === 'sent' && r.link).length,
    costUsd,
    budgetUsd: deps.config.dailyUsd,
    waiting,
  };
  const summary = [
    `X, ${day} (${report.tz}): ${report.posted} posted, ${report.failed} failed${report.unsure ? `, ${report.unsure} unsure` : ''}; $${costUsd.toFixed(3)} of $${report.budgetUsd.toFixed(2)}.`,
    report.sender.connected ? (sw.on ? 'Sender connected, switch on.' : 'Sender connected, switch off: nothing posts.') : (report.sender.reason ?? 'X not connected.'),
    ...slots.map((s) => `${s.time} ${s.state}${s.postId ? ` · post ${s.postId}` : ''}${s.error ? ` · ${s.error}` : ''}`),
    `${waiting} approved draft${waiting === 1 ? '' : 's'} waiting.`,
  ];
  return { ...report, summary };
}
