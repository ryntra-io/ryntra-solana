/**
 * When a «Доручення» runs next (AI-19) — pure, no store, no network.
 *
 * Four rhythms, as a person says them: every 10 minutes, every 30 minutes,
 * every hour, every day at a time on their own clock. A run is never earlier
 * than its slot and never two for one slot: the next slot is always after the
 * moment the last one ran.
 */

export const TASK_EVERY = ["10m", "30m", "1h", "1d"] as const;
export type TaskEvery = (typeof TASK_EVERY)[number];

export const EVERY_MS: Readonly<Record<Exclude<TaskEvery, "1d">, number>> = { "10m": 10 * 60_000, "30m": 30 * 60_000, "1h": 60 * 60_000 };

/** How many times a day a rhythm runs — the price shown before turning it on is this times the price of one run. */
export function runsPerDay(every: TaskEvery): number {
  return every === "1d" ? 1 : Math.round(86_400_000 / EVERY_MS[every]);
}

/** The wall clock of `ms` in `zone`: the day as `YYYY-MM-DD` and the minutes past midnight. */
function wall(ms: number, zone: string): Readonly<{ day: string; minutes: number }> {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/**
 * The first moment after `afterMs` whose wall clock in `zone` reads `time` (HH:MM) — found by stepping a minute at a
 * time from the nearest candidate, so a change of summer time never skips a day or runs one twice.
 */
export function nextDailyAt(afterMs: number, time: string, zone: string): number {
  const [h, m] = time.split(":").map(Number);
  const target = h * 60 + m;
  const now = wall(afterMs, zone);
  let candidate = afterMs - (now.minutes - target) * 60_000;
  candidate -= candidate % 60_000;
  if (candidate <= afterMs) candidate += 86_400_000;
  /* Within a few hours of the guess, the minute whose wall clock is the target. */
  for (let step = -180; step <= 180; step += 1) {
    const at = candidate + step * 60_000;
    if (at > afterMs && wall(at, zone).minutes === target) return at;
  }
  return candidate;
}

/** The next run after the one at `lastMs` (or, for a new task, after `nowMs`). */
export function nextRunAt(every: TaskEvery, time: string | null, zone: string, fromMs: number): number {
  if (every === "1d") return nextDailyAt(fromMs, time ?? "09:00", zone);
  return fromMs + EVERY_MS[every];
}

/** A task is due when its slot has come; a slot missed while the server slept runs once, never once per missed slot. */
export function isDue(nextAtMs: number, nowMs: number): boolean {
  return nextAtMs <= nowMs;
}
