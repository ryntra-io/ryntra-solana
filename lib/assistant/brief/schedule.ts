/**
 * When «Ранковий огляд» comes (AI-10) — pure: no store, no clock of its own.
 *
 * A person who turned the brief on gets it once a day at their time, 09:00
 * Kyiv time unless they chose another, on the clock of their timezone. The
 * quiet hours of Нагляд hold it: a time that falls inside them moves to the
 * moment they end, so nothing of the brief arrives while it is quiet — not a
 * message, not a push, not even the note. A day whose brief could not be
 * made within `BRIEF_CATCH_UP_MS` of its time is skipped: a morning brief is
 * never sent in the evening.
 *
 * Every day is a calendar day of the person's timezone (`YYYY-MM-DD`), and a
 * brief is keyed by it, so a second pass on the same day finds it made.
 */

import { inQuietHours, isValidQuietHours, nextQuietEndMs, type QuietHours } from "../../monitoring/quiet-hours.ts";

export const BRIEF_DEFAULT_TIME = "09:00";
export const BRIEF_DEFAULT_ZONE = "Europe/Kyiv";
/** How long after its time a brief may still be made; past it the day is skipped. */
export const BRIEF_CATCH_UP_MS = 3 * 3_600_000;

/** A clock time on the quarter hour: the cron passes every five minutes, so a quarter is what a person can rely on. */
const QUARTER = /^([01]\d|2[0-3]):(00|15|30|45)$/;

export function isBriefTime(value: unknown): value is string {
  return typeof value === "string" && QUARTER.test(value);
}

/** An IANA zone the runtime knows; anything else is not a zone. */
export function isZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

type Parts = Readonly<{ day: string; minutes: number }>;

/** The calendar day and the minute of the day at `nowMs` on `zone`'s clock. */
export function localParts(nowMs: number, zone: string): Parts {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** `zone`'s offset from UTC at `ms`, in minutes. */
function offsetMinutes(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** The instant `day` at `hhmm` happens on `zone`'s clock (a time a clock change skips lands just after it). */
export function instantOf(day: string, hhmm: string, zone: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const first = wall - offsetMinutes(wall, zone) * 60_000;
  const second = wall - offsetMinutes(first, zone) * 60_000;
  return second;
}

export function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
}

export type BriefClock = Readonly<{ time: string; zone: string }>;

/** When `day`'s brief is made: its time, or the end of the quiet hours it falls in. */
export function scheduledFor(day: string, clock: BriefClock, quiet: QuietHours | null): number {
  const at = instantOf(day, clock.time, clock.zone);
  if (!isValidQuietHours(quiet) || !inQuietHours(at, quiet)) return at;
  return nextQuietEndMs(at, quiet) ?? at;
}

/**
 * The day whose brief is due at `nowMs`, or null: its moment has come, it is
 * within the catch-up, and it is not quiet now. Yesterday is asked too — a
 * late evening time moved past midnight by the quiet hours is still that
 * day's brief.
 */
export function dueDay(nowMs: number, clock: BriefClock, quiet: QuietHours | null): Readonly<{ day: string; at: number }> | null {
  if (isValidQuietHours(quiet) && inQuietHours(nowMs, quiet)) return null;
  const today = localParts(nowMs, clock.zone).day;
  for (const day of [shiftDay(today, -1), today]) {
    const at = scheduledFor(day, clock, quiet);
    if (nowMs >= at && nowMs < at + BRIEF_CATCH_UP_MS) return { day, at };
  }
  return null;
}

/** The next moment a brief will be made, given the last day one was: for the page's «Наступний огляд». */
export function nextBriefAt(nowMs: number, clock: BriefClock, quiet: QuietHours | null, lastDay: string | null): number {
  const today = localParts(nowMs, clock.zone).day;
  for (const day of [shiftDay(today, -1), today, shiftDay(today, 1), shiftDay(today, 2)]) {
    if (lastDay !== null && day <= lastDay) continue;
    const at = scheduledFor(day, clock, quiet);
    if (nowMs < at + BRIEF_CATCH_UP_MS && (nowMs < at || !(isValidQuietHours(quiet) && inQuietHours(nowMs, quiet)))) return Math.max(at, nowMs);
  }
  return scheduledFor(shiftDay(today, 1), clock, quiet);
}

/** Whether the person's time itself falls in their quiet hours — the page says when the brief will come instead. */
export function timeIsQuiet(clock: BriefClock, quiet: QuietHours | null, nowMs: number): boolean {
  if (!isValidQuietHours(quiet)) return false;
  const day = localParts(nowMs, clock.zone).day;
  return inQuietHours(instantOf(day, clock.time, clock.zone), quiet);
}
