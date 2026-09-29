/**
 * Quiet hours — local wall-clock window in the person's timezone.
 * Inbox still records; Telegram and push wait.
 */

export type QuietHours = Readonly<{ start: string; end: string; timezone: string }>;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidQuietHours(value: QuietHours | null | undefined): value is QuietHours {
  if (!value) return false;
  return CLOCK.test(value.start) && CLOCK.test(value.end) && value.timezone.length > 0 && value.timezone.length <= 64;
}

function minutesOnClock(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function localMinutes(nowMs: number, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(nowMs));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

/** True when `nowMs` falls inside the window in `timezone`. Overnight windows wrap midnight. */
export function inQuietHours(nowMs: number, hours: QuietHours | null | undefined): boolean {
  if (!isValidQuietHours(hours)) return false;
  const local = localMinutes(nowMs, hours.timezone);
  if (local === null) return false;
  const start = minutesOnClock(hours.start);
  const end = minutesOnClock(hours.end);
  if (start === end) return false;
  if (start < end) return local >= start && local < end;
  return local >= start || local < end;
}

/** Instant the current quiet window ends, or null when it is not quiet. */
export function nextQuietEndMs(nowMs: number, hours: QuietHours | null | undefined): number | null {
  if (!isValidQuietHours(hours) || !inQuietHours(nowMs, hours)) return null;
  const local = localMinutes(nowMs, hours.timezone);
  if (local === null) return null;
  const start = minutesOnClock(hours.start);
  const end = minutesOnClock(hours.end);
  let minutesUntilEnd: number;
  if (start < end) minutesUntilEnd = end - local;
  else minutesUntilEnd = local >= start ? 24 * 60 - local + end : end - local;
  if (minutesUntilEnd <= 0) minutesUntilEnd = 1;
  return nowMs + minutesUntilEnd * 60_000;
}
