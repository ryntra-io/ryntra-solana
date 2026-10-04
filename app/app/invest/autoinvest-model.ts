/**
 * «Автоінвест» on a company page and on Home — the pure half: the schedule a
 * new rule starts from, the rule a company already has, the reminder that is
 * open now, whether a purchase fits the month's budget, and the words a rule
 * is read in. Client-safe; the same schedule functions the server reminds
 * with, so «Перша купівля: чт, 24 вер. о 19:00» is the instant the reminder
 * comes.
 */

import type { AutoinvestRule, RuleBudget, RuleOccurrence } from "../../../lib/api/v1/contract.ts";
import { BUDGET_MAXIMUM_USD, BUDGET_MINIMUM_USD, RULE_MAXIMUM_USD } from "../../../lib/autoinvest/limits.ts";
import { isTimeZone, nextDueAfter, wallClockAt, type RuleCadence, type RuleSchedule } from "../../../lib/autoinvest/schedule.ts";

/** The person's own time zone as the browser reports it; UTC where it reports none the runtime knows. */
export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** The most a rule's purchase is — the contract's own bound, read from the module the contract takes it from. */
export const RULE_MAX_USD = RULE_MAXIMUM_USD;

/**
 * Where a new rule starts: weekly, today, at the next full hour — so the
 * first reminder is near and the person sees it work — or tomorrow when the
 * next hour is past midnight.
 */
export function defaultSchedule(nowMs: number, timeZone: string): RuleSchedule {
  const wall = wallClockAt(nowMs, timeZone);
  const hour = (wall.hour + 1) % 24;
  const weekday = hour === 0 ? (wall.weekday % 7) + 1 : wall.weekday;
  return { cadence: "weekly", weekday, monthDay: null, time: `${pad(hour)}:00`, timeZone };
}

/**
 * The schedule a new rule's sheet opens on: weekly, on today's weekday at the
 * next full hour, beside $10 — a default, not advice; every day, every week
 * or every month, from a dollar, is the person's own choice.
 */
export function openingSchedule(nowMs: number, timeZone: string, cadence: RuleCadence = "weekly"): RuleSchedule {
  return withCadence(defaultSchedule(nowMs, timeZone), cadence, nowMs);
}

/** The same day and time under another cadence: a weekly rule keeps its weekday, a monthly one takes today's date. */
export function withCadence(schedule: RuleSchedule, cadence: RuleCadence, nowMs: number): RuleSchedule {
  const wall = wallClockAt(nowMs, schedule.timeZone);
  if (cadence === "daily") return { ...schedule, cadence, weekday: null, monthDay: null };
  if (cadence === "weekly") return { ...schedule, cadence, weekday: schedule.weekday ?? wall.weekday, monthDay: null };
  return { ...schedule, cadence, weekday: null, monthDay: schedule.monthDay ?? wall.day };
}

/** The first reminder a schedule gives from now, or null when it cannot be read. */
export function firstDue(schedule: RuleSchedule, nowMs: number): number | null {
  try {
    return nextDueAfter(schedule, nowMs);
  } catch {
    return null;
  }
}

/** The rule this company has — the one that is on first, else the newest. One company, one rule on the page. */
export function ruleForMint(rules: readonly AutoinvestRule[], mint: string): AutoinvestRule | null {
  const own = rules.filter((rule) => rule.asset.mint === mint);
  return own.find((rule) => rule.status === "active") ?? own[0] ?? null;
}

/** The occurrence one tap buys under right now, or null. */
export function openOccurrence(rule: AutoinvestRule): RuleOccurrence | null {
  if (rule.status !== "active") return null;
  return rule.occurrences.find((occurrence) => occurrence.state === "due") ?? null;
}

/**
 * The reminder a rule's purchase can be made under right now — open, the rule
 * on, its window not yet passed: while it is, a company's page offers the
 * rule's purchase first and Spot says an ordinary purchase leaves it open.
 * The window is the server's; a reminder whose window passed before the tick
 * wrote it missed is not offered.
 */
export function reminderOpenNow(rule: AutoinvestRule, nowMs: number): RuleOccurrence | null {
  const occurrence = openOccurrence(rule);
  if (!occurrence) return null;
  const until = Date.parse(occurrence.openUntil);
  return Number.isFinite(until) && until > nowMs ? occurrence : null;
}

/**
 * A purchase the rule's price condition holds back right now (1.18.0): the
 * rule on, the occurrence deferred and its window not passed — the page says
 * why and offers nothing; the rule judges it again.
 */
export function deferredNow(rule: AutoinvestRule, nowMs: number): RuleOccurrence | null {
  if (rule.status !== "active") return null;
  const occurrence = rule.occurrences.find((candidate) => candidate.state === "deferred") ?? null;
  if (!occurrence) return null;
  const until = Date.parse(occurrence.openUntil);
  return Number.isFinite(until) && until > nowMs ? occurrence : null;
}

/** The occurrence a reminder's link names. */
export function occurrenceAt(rule: AutoinvestRule, dueAt: string): RuleOccurrence | null {
  const at = Date.parse(dueAt);
  return rule.occurrences.find((occurrence) => Date.parse(occurrence.dueAt) === at) ?? null;
}

/** The last occurrence that is over — bought, on its way, missed or held by the budget — for the rule's one line of history. */
export function lastSettled(rule: AutoinvestRule): RuleOccurrence | null {
  /* A reminder still open, and a purchase still waiting on the price condition, have not settled. */
  return rule.occurrences.find((occurrence) => occurrence.state !== "due" && occurrence.state !== "deferred") ?? null;
}

/** «HH:MM» from a time input, or null. */
export function timeOfInput(value: string): string | null {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

/**
 * The sum a rule's purchase is under one reminder (1.19.0): its own, where a
 * «З кожної оплати» rule gathered it; the rule's everywhere else. The page,
 * the Review and the order route read the same sum.
 */
export function purchaseSumUsd(rule: Pick<AutoinvestRule, "amountUsd">, occurrence?: Pick<RuleOccurrence, "amountUsd"> | null): number {
  return occurrence?.amountUsd ?? rule.amountUsd;
}

/**
 * Whether a rule's purchase fits what is left of the month's budget: always
 * without a ceiling; to the cent under one — the same rule the tick and the
 * order route judge by. Under a reminder, its own sum.
 */
export function fitsMonth(rule: Pick<AutoinvestRule, "amountUsd">, budget: RuleBudget | null, occurrence?: Pick<RuleOccurrence, "amountUsd"> | null): boolean {
  if (!budget || budget.remainingUsd === null) return true;
  return purchaseSumUsd(rule, occurrence) <= budget.remainingUsd + 0.005;
}

/** The rule is on and its purchase does not fit what is left: it stands until the 1st («Бюджет вичерпано»). */
export function heldByBudget(rule: Pick<AutoinvestRule, "amountUsd" | "status">, budget: RuleBudget | null): boolean {
  return rule.status === "active" && !fitsMonth(rule, budget);
}

/** A «З кожної оплати» rule's clock, and every other rule's: the one its words tell time on. */
export function ruleZone(rule: Pick<AutoinvestRule, "schedule" | "dip" | "payments">, fallback = "UTC"): string {
  return rule.schedule?.timeZone ?? rule.dip?.timeZone ?? rule.payments?.timeZone ?? fallback;
}

/** What the month has taken — settled and still unknown alike — and the share of the ceiling it is (0–1); null without a ceiling. */
export function monthUse(budget: RuleBudget): Readonly<{ countedUsd: number; share: number | null }> {
  const countedUsd = Math.round((budget.spentUsd + budget.unknownUsd) * 100) / 100;
  return { countedUsd, share: budget.capUsd === null ? null : Math.min(1, countedUsd / budget.capUsd) };
}

/**
 * The month's budget as its own line: without a ceiling —
 * «Бюджет не задано · Задати»; with one — «$10 з $50» over its bar, and when
 * it is spent, the rules stand until the 1st. Null until the rules' read has
 * said what the budget is. The rule's sum never stands in this line.
 */
export type BudgetView =
  | Readonly<{ kind: "unset" }>
  | Readonly<{ kind: "capped"; countedUsd: number; capUsd: number; percent: number; exhausted: boolean }>;

export function budgetView(budget: RuleBudget | null): BudgetView | null {
  if (!budget) return null;
  if (budget.capUsd === null) return { kind: "unset" };
  const use = monthUse(budget);
  return { kind: "capped", countedUsd: use.countedUsd, capUsd: budget.capUsd, percent: Math.round((use.share ?? 0) * 100), exhausted: budget.exhausted };
}

/** A sum typed for the budget, in dollars and cents within its bounds, or null. */
export function budgetOfInput(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const cents = Math.round(value * 100) / 100;
  return cents >= BUDGET_MINIMUM_USD && cents <= BUDGET_MAXIMUM_USD ? cents : null;
}

/**
 * The rules by their nearest purchase — Home's right column reads them so:
 * an open reminder first, then the scheduled ones by when they come, then
 * those that wait for a fall, the paused ones last.
 */
export function byNextPurchase(rules: readonly AutoinvestRule[], nowMs: number): AutoinvestRule[] {
  const rank = (rule: AutoinvestRule): number => {
    if (rule.status !== "active") return Number.MAX_SAFE_INTEGER;
    if (reminderOpenNow(rule, nowMs)) return -1;
    const next = rule.nextDueAt ? Date.parse(rule.nextDueAt) : Number.NaN;
    return Number.isFinite(next) ? next : Number.MAX_SAFE_INTEGER - 1;
  };
  return [...rules].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
