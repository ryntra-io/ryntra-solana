/**
 * When an autoinvest rule falls due — «Регулярно».
 *
 * A person says «щотижня в четвер о 19:00» on their own clock, so a rule
 * keeps the day and the time as a wall clock in an IANA time zone and a due
 * instant is the moment that wall clock names there: 19:00 in Kyiv is 16:00
 * UTC in summer and 17:00 UTC in winter, and the reminder follows the clock on
 * the wall, not a fixed offset. A month shorter than the rule's day falls on
 * its last day (the 31st in February is the 28th or the 29th). The hour the
 * clocks skip in spring is read as the hour after it; the hour they repeat in
 * autumn is read once.
 *
 * Pure and client-safe: no store, no `process.env`; the clock is always an
 * argument. The sheet that writes a rule and the tick that reminds of it read
 * the same functions, so «Перша купівля: чт, 25 вер. о 19:00» on the screen is
 * the instant the server will remind at.
 */

export const RULE_CADENCES = ["daily", "weekly", "monthly"] as const;
export type RuleCadence = (typeof RULE_CADENCES)[number];

/** How long a reminder stays open for the purchase it names; after it — or at the next due, when that comes sooner — the occurrence is missed. */
export const RULE_REMINDER_HOURS = 24;
const REMINDER_MS = RULE_REMINDER_HOURS * 3_600_000;

export type RuleSchedule = Readonly<{
  cadence: RuleCadence;
  /** ISO weekday, 1 Monday … 7 Sunday; a weekly rule's, null otherwise. */
  weekday: number | null;
  /** 1–31; a monthly rule's, null otherwise. */
  monthDay: number | null;
  /** «HH:MM», 24-hour, on the wall clock of `timeZone`. */
  time: string;
  /** An IANA name, e.g. «Europe/Kyiv». */
  timeZone: string;
}>;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True for an IANA time zone this runtime knows. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The wall clock at an instant, in a zone. */
export type WallClock = Readonly<{ year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }>;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

const WEEKDAYS: Readonly<Record<string, number>> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function wallClockAt(ms: number, timeZone: string): WallClock {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday] ?? isoWeekday(Number(parts.year), Number(parts.month), Number(parts.day)),
  };
}

/** How far the zone's wall clock is ahead of UTC at an instant, in milliseconds. */
function offsetAt(ms: number, timeZone: string): number {
  const wall = wallClockAt(ms, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant a wall-clock minute names in a zone. */
export function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const first = asUtc - offsetAt(asUtc, timeZone);
  /* A second pass settles the offset of the instant itself — they differ only across a change of the clocks. */
  return asUtc - offsetAt(first, timeZone);
}

function isoWeekday(year: number, month: number, day: number): number {
  const sunday0 = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return sunday0 === 0 ? 7 : sunday0;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A calendar date `days` away from another, in the calendar alone (no zone). */
function shifted(year: number, month: number, day: number, days: number): Readonly<{ year: number; month: number; day: number }> {
  const at = new Date(Date.UTC(year, month - 1, day + days));
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}

function clockOf(schedule: RuleSchedule): Readonly<{ hour: number; minute: number }> {
  const match = TIME.exec(schedule.time);
  if (!match) throw new RangeError(`Not a time of day: ${schedule.time}`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Whether a calendar date is one the rule falls on. */
function fallsOn(schedule: RuleSchedule, year: number, month: number, day: number): boolean {
  if (schedule.cadence === "daily") return true;
  if (schedule.cadence === "weekly") return isoWeekday(year, month, day) === schedule.weekday;
  const wanted = Math.min(schedule.monthDay ?? 1, daysInMonth(year, month));
  return day === wanted;
}

/** A schedule the functions below can read: a known zone, a time of day, and the day its cadence needs. */
export function isReadableSchedule(schedule: RuleSchedule): boolean {
  if (!isTimeZone(schedule.timeZone) || !TIME.test(schedule.time)) return false;
  if (schedule.cadence === "weekly") return schedule.weekday !== null && Number.isInteger(schedule.weekday) && schedule.weekday >= 1 && schedule.weekday <= 7 && schedule.monthDay === null;
  if (schedule.cadence === "monthly") return schedule.monthDay !== null && Number.isInteger(schedule.monthDay) && schedule.monthDay >= 1 && schedule.monthDay <= 31 && schedule.weekday === null;
  return schedule.weekday === null && schedule.monthDay === null;
}

/* A month holds every weekday and every day of the month; a year and a margin covers any date search. */
const SEARCH_DAYS = 400;

/** The first due instant strictly after `afterMs`. */
export function nextDueAfter(schedule: RuleSchedule, afterMs: number): number {
  const { hour, minute } = clockOf(schedule);
  const today = wallClockAt(afterMs, schedule.timeZone);
  for (let offset = -1; offset <= SEARCH_DAYS; offset += 1) {
    const date = shifted(today.year, today.month, today.day, offset);
    if (!fallsOn(schedule, date.year, date.month, date.day)) continue;
    const due = zonedInstant(date.year, date.month, date.day, hour, minute, schedule.timeZone);
    if (due > afterMs) return due;
  }
  throw new RangeError("No due instant within a year.");
}

/** The latest due instant at or before `atMs`, or null when none falls within a year before it. */
export function latestDueAtOrBefore(schedule: RuleSchedule, atMs: number): number | null {
  const { hour, minute } = clockOf(schedule);
  const today = wallClockAt(atMs, schedule.timeZone);
  for (let offset = 1; offset >= -SEARCH_DAYS; offset -= 1) {
    const date = shifted(today.year, today.month, today.day, offset);
    if (!fallsOn(schedule, date.year, date.month, date.day)) continue;
    const due = zonedInstant(date.year, date.month, date.day, hour, minute, schedule.timeZone);
    if (due <= atMs) return due;
  }
  return null;
}

/** Until when a reminder that fell due at `dueMs` stays open: a day, or the next due when that comes sooner. */
export function reminderOpenUntil(schedule: RuleSchedule, dueMs: number): number {
  return Math.min(dueMs + REMINDER_MS, nextDueAfter(schedule, dueMs));
}
