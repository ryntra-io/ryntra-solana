import { parseExplicitInstant } from "../portfolio/freshness.ts";

/**
 * Scheduler truth, and the line this module exists to hold.
 *
 * The canon is exact: *last/next check values come from real scheduler
 * records*. The temptation is to compute a plausible "last run" from a cron
 * expression — the schedule says 07:00 daily, it is now 09:00, therefore it ran
 * at 07:00. That sentence is a guess wearing a timestamp, and a monitoring
 * surface that shows it will tell a reader the world was checked when nothing
 * checked it.
 *
 * So the two halves are typed differently and can never be confused:
 *
 *   **`last`** is `OBSERVED` only when a real record carries a real instant in
 *   the past. Absent, unparsable or future ⇒ `UNKNOWN` with the reason. There
 *   is no third state and no fallback.
 *
 *   **`next`** is at best `DECLARED` — derived from a schedule the deployment
 *   actually declares — and it says so in its own reason. A declaration is a
 *   real artifact, which is why it may be shown at all; it is still not an
 *   observation, which is why it is never labelled as one.
 *
 * A record can also be real and yet carry no run time. That is the current
 * shape of this product's own scheduler rows: they hold a *watermark* the cron
 * advances, not a clock reading. Such a record proves enrolment and is reported
 * as enrolment — `enrolled: true`, the watermark shown — while `last` stays
 * `UNKNOWN`. Two different facts, two different fields, neither borrowed to
 * cover for the other.
 */

export type SchedulerRecord = Readonly<{
  ruleId: string;
  lastRunAt: string | null;
  lastSuccessfulEvidenceRefreshAt: string | null;
  runCount: number | null;
  /** Opaque progress marker a real job advanced, e.g. `sequence:412`. */
  watermark: string | null;
  /** Which real record this came from, named so a reader can go and check it. */
  source: string;
}>;

export type ObservedInstant = Readonly<{
  state: "OBSERVED" | "UNKNOWN";
  at: string | null;
  reason: string | null;
  source: string | null;
}>;

export type DeclaredInstant = Readonly<{
  state: "DECLARED" | "UNKNOWN";
  at: string | null;
  reason: string | null;
}>;

export type RunProjection = Readonly<{
  last: ObservedInstant;
  lastEvidenceRefresh: ObservedInstant;
  next: DeclaredInstant;
  enrolled: boolean;
  watermark: string | null;
  runCount: number | null;
}>;

/* ------------------------------------------------------------------ cron */

type Field = Readonly<{ min: number; max: number }>;

const MINUTE: Field = { min: 0, max: 59 };
const HOUR: Field = { min: 0, max: 23 };
const DAY_OF_MONTH: Field = { min: 1, max: 31 };
const MONTH: Field = { min: 1, max: 12 };
const DAY_OF_WEEK: Field = { min: 0, max: 6 };

/**
 * A deliberately small cron subset: `*`, `n`, `a-b`, `a,b,c` and a step form.
 *
 * Named months and weekdays, `@daily`, `L`, `#` and `?` are **not** parsed and
 * return `null`. Failing closed here is the whole point — an expression this
 * parser half-understands would produce a confident wrong time, and the caller
 * cannot tell a wrong time from a right one. `null` becomes `UNKNOWN` on the
 * surface, which a reader can act on.
 */
function parseField(raw: string, field: Field): readonly number[] | null {
  if (raw.length === 0 || raw.length > 64) return null;
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    if (part.length === 0) return null;
    let range = part;
    let step = 1;
    const slash = part.indexOf("/");
    if (slash !== -1) {
      range = part.slice(0, slash);
      const stepText = part.slice(slash + 1);
      if (!/^\d{1,2}$/.test(stepText)) return null;
      step = Number(stepText);
      if (step < 1) return null;
    }

    let from = field.min;
    let to = field.max;
    if (range !== "*") {
      const dash = range.indexOf("-");
      if (dash === -1) {
        if (!/^\d{1,2}$/.test(range)) return null;
        from = Number(range);
        to = from;
      } else {
        const left = range.slice(0, dash);
        const right = range.slice(dash + 1);
        if (!/^\d{1,2}$/.test(left) || !/^\d{1,2}$/.test(right)) return null;
        from = Number(left);
        to = Number(right);
      }
    }
    if (from < field.min || to > field.max || from > to) return null;
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values.size === 0 ? null : [...values].sort((a, b) => a - b);
}

type CronSchedule = Readonly<{
  minutes: readonly number[];
  hours: readonly number[];
  daysOfMonth: readonly number[];
  months: readonly number[];
  daysOfWeek: readonly number[];
  restrictsDayOfMonth: boolean;
  restrictsDayOfWeek: boolean;
}>;

export function parseCron(expression: string): CronSchedule | null {
  if (typeof expression !== "string") return null;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 || parts.some((part) => part.length === 0)) return null;
  const minutes = parseField(parts[0], MINUTE);
  const hours = parseField(parts[1], HOUR);
  const daysOfMonth = parseField(parts[2], DAY_OF_MONTH);
  const months = parseField(parts[3], MONTH);
  const daysOfWeek = parseField(parts[4], DAY_OF_WEEK);
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;
  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    restrictsDayOfMonth: parts[2] !== "*",
    restrictsDayOfWeek: parts[4] !== "*",
  };
}

/** How far forward the search will look before admitting it found nothing. */
const SEARCH_DAYS = 400;

/**
 * The next occurrence strictly after `asOf`, in UTC.
 *
 * Strictly after, because "the next run" of a job that is running right now is
 * the following one. Day-of-month and day-of-week follow cron's own rule: when
 * both are restricted either may match, and when only one is restricted it must.
 */
export function nextCronOccurrence(expression: string, asOf: string): string | null {
  const schedule = parseCron(expression);
  const from = parseExplicitInstant(asOf);
  if (schedule === null || from === null) return null;

  const cursor = new Date(from);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const limit = from + SEARCH_DAYS * 24 * 60 * 60 * 1000;
  while (cursor.getTime() <= limit) {
    const month = cursor.getUTCMonth() + 1;
    if (!schedule.months.includes(month)) {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(schedule, cursor)) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!schedule.hours.includes(cursor.getUTCHours())) {
      cursor.setUTCHours(cursor.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!schedule.minutes.includes(cursor.getUTCMinutes())) {
      cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return cursor.toISOString();
  }
  return null;
}

function dayMatches(schedule: CronSchedule, cursor: Date): boolean {
  const dayOfMonth = schedule.daysOfMonth.includes(cursor.getUTCDate());
  const dayOfWeek = schedule.daysOfWeek.includes(cursor.getUTCDay());
  if (schedule.restrictsDayOfMonth && schedule.restrictsDayOfWeek) return dayOfMonth || dayOfWeek;
  if (schedule.restrictsDayOfMonth) return dayOfMonth;
  if (schedule.restrictsDayOfWeek) return dayOfWeek;
  return true;
}

/* ------------------------------------------------------------ projection */

const unknown = (reason: string): ObservedInstant => ({ state: "UNKNOWN", at: null, reason, source: null });

function observed(value: string | null, asOf: number, source: string, label: string): ObservedInstant {
  if (value === null) {
    return unknown(`The scheduler record for this rule stores a watermark, not a ${label} time.`);
  }
  const parsed = parseExplicitInstant(value);
  if (parsed === null) {
    return unknown(`The recorded ${label} time is not an explicit instant, so it is not shown.`);
  }
  if (parsed > asOf) {
    return unknown(`The recorded ${label} time is in the future, which no record can observe.`);
  }
  return { state: "OBSERVED", at: value, reason: null, source };
}

export type SchedulableRule = Readonly<{
  ruleId: string;
  mode: "SCHEDULE" | "EVENT";
  schedule: string | null;
}>;

export function projectRuleRun(input: Readonly<{
  rule: SchedulableRule;
  record: SchedulerRecord | null;
  asOf: string;
}>): RunProjection {
  const asOf = parseExplicitInstant(input.asOf);
  /* A record for another rule is not this rule's evidence. Adopting it is how a
     surface ends up reporting one job's run as another job's. */
  const record = input.record !== null && input.record.ruleId === input.rule.ruleId ? input.record : null;

  const noClock = asOf === null;
  const last = record === null || noClock
    ? unknown(noClock ? "The reading clock is not an explicit instant." : "No scheduler record exists for this rule.")
    : observed(record.lastRunAt, asOf, record.source, "run");
  const lastEvidenceRefresh = record === null || noClock
    ? unknown(noClock ? "The reading clock is not an explicit instant." : "No scheduler record exists for this rule.")
    : observed(record.lastSuccessfulEvidenceRefreshAt, asOf, record.source, "evidence refresh");

  let next: DeclaredInstant;
  if (input.rule.mode === "EVENT") {
    next = { state: "UNKNOWN", at: null, reason: "This rule runs on an event, so there is no next time to declare." };
  } else if (input.rule.schedule === null) {
    next = { state: "UNKNOWN", at: null, reason: "This rule declares no schedule." };
  } else {
    const at = nextCronOccurrence(input.rule.schedule, input.asOf);
    next = at === null
      ? { state: "UNKNOWN", at: null, reason: "The declared schedule is not one this product parses, so no time is claimed." }
      : { state: "DECLARED", at, reason: "Derived from the declared schedule, not from an observed run." };
  }

  return {
    last,
    lastEvidenceRefresh,
    next,
    enrolled: record !== null,
    watermark: record?.watermark ?? null,
    runCount: record?.runCount ?? null,
  };
}
