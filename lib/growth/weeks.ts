/**
 * Weeks and seasons — the calendar of the leaderboards.
 *
 * ## One week for everybody
 *
 * A week is Monday 00:00 UTC to the next Monday, the same for every person
 * wherever they are, so a place on a board means the same seven days to
 * everyone who reads it. The page writes the dates in the reader's language;
 * the boundaries never move with the reader's clock.
 *
 * ## Seasons follow one another
 *
 * A season is {@link SEASON_WEEKS} weeks. The first begins on the Monday of
 * the week the leaderboards first came into force (written once in the store,
 * like the moment rules 2.0.0 began); every later season begins the moment
 * the one before it ends. Nobody sets a date, and no gap or overlap can be
 * chosen by accident.
 *
 * Pure: no clock, no store.
 */

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;
/** Weeks in one season. */
export const SEASON_WEEKS = 8;

export type WeekRange = Readonly<{ start: string; end: string }>;

function readable(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error("A week needs a readable moment.");
  return ms;
}

/** The Monday 00:00 UTC that begins the week holding `iso`. */
export function weekStartOf(iso: string): string {
  const ms = readable(iso);
  const day = new Date(ms);
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  /* getUTCDay: Sunday 0 … Saturday 6; Monday begins the week. */
  const back = (day.getUTCDay() + 6) % 7;
  return new Date(midnight - back * DAY_MS).toISOString();
}

/** The week that begins at `start` (itself a week start). */
export function weekRange(start: string): WeekRange {
  const ms = readable(start);
  return { start: new Date(ms).toISOString(), end: new Date(ms + WEEK_MS).toISOString() };
}

/** The week holding `iso`, and the one before it. */
export function currentWeek(iso: string): WeekRange {
  return weekRange(weekStartOf(iso));
}

export function previousWeek(iso: string): WeekRange {
  return weekRange(new Date(readable(weekStartOf(iso)) - WEEK_MS).toISOString());
}

/** Inside a range: from its start, inclusive, to its end, exclusive. */
export function within(iso: string, range: WeekRange): boolean {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms >= Date.parse(range.start) && ms < Date.parse(range.end);
}

/** Whether `start` is a week start this module would produce. */
export function isWeekStart(start: string): boolean {
  try {
    return weekStartOf(start) === new Date(readable(start)).toISOString();
  } catch {
    return false;
  }
}

export type SeasonRange = Readonly<{
  /** 1 for the first season. */
  number: number;
  start: string;
  end: string;
  /** The week starts of the season, in order. */
  weeks: readonly string[];
}>;

/** Season `number`, counted from the first season's start. */
export function seasonRange(firstStart: string, number: number): SeasonRange {
  if (!Number.isInteger(number) || number < 1) throw new Error("Seasons are counted from 1.");
  const first = readable(weekStartOf(firstStart));
  const start = first + (number - 1) * SEASON_WEEKS * WEEK_MS;
  const weeks = Array.from({ length: SEASON_WEEKS }, (_, index) => new Date(start + index * WEEK_MS).toISOString());
  return { number, start: new Date(start).toISOString(), end: new Date(start + SEASON_WEEKS * WEEK_MS).toISOString(), weeks };
}

/** The season holding `iso`, or null before the first one began. */
export function seasonAt(firstStart: string, iso: string): SeasonRange | null {
  const first = readable(weekStartOf(firstStart));
  const at = readable(iso);
  if (at < first) return null;
  return seasonRange(firstStart, Math.floor((at - first) / (SEASON_WEEKS * WEEK_MS)) + 1);
}

/** Which week of its season a week start is, 1 to {@link SEASON_WEEKS}; null outside it. */
export function weekOfSeason(season: SeasonRange, weekStart: string): number | null {
  const index = season.weeks.indexOf(new Date(readable(weekStart)).toISOString());
  return index < 0 ? null : index + 1;
}
