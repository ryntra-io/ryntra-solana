/**
 * Launch windows (MC-2, decision 68): missions lift off together on a published schedule — a small window every hour
 * and a big one every evening — so people come to the start the way they come to a match.
 *
 * A window is only a time: Ryntra holds nothing and signs nothing for it. A creator who picks a window signs their
 * own launch once it opens; a launch is in a window when its launch time — the one Ryntra's record keeps, taken when
 * its creation is sent — falls while the window is open; never a creator's claim. The equal start inside a window is the curve's own anti-sniper fee (DBC's fee
 * scheduler, `presets.ts` `sniperFee`): every curve opens high and falls to its base in its first minutes, whoever
 * buys. Alpha Vault is not used here — Meteora documents it for DLMM and DAMM, not for DBC (MC-5 takes it for teams
 * on DAMM v2).
 *
 * Pure and client-safe: UTC only, no clock unless given.
 */

export const WINDOW_KINDS = ["hourly", "evening"] as const;
export type WindowKind = (typeof WINDOW_KINDS)[number];

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** The small window: at the top of every hour UTC, open this many minutes. */
export const HOURLY_WINDOW_MINUTES = 10;
/** The big window: every evening at this hour UTC (it takes that hour's place), open longer. */
export const EVENING_WINDOW_HOUR_UTC = 20;
export const EVENING_WINDOW_MINUTES = 30;

export type LaunchWindow = Readonly<{
  /** The opening as ISO 8601 to the minute, `2026-10-25T20:00Z`: one window per hour, so the opening names it. */
  id: string;
  kind: WindowKind;
  opensAt: number;
  closesAt: number;
}>;

function isoMinute(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

/** The window that opens at the top of the hour holding `ms`. */
function windowOfHour(ms: number): LaunchWindow {
  const opensAt = Math.floor(ms / HOUR_MS) * HOUR_MS;
  const kind: WindowKind = new Date(opensAt).getUTCHours() === EVENING_WINDOW_HOUR_UTC ? "evening" : "hourly";
  const minutes = kind === "evening" ? EVENING_WINDOW_MINUTES : HOURLY_WINDOW_MINUTES;
  return { id: isoMinute(opensAt), kind, opensAt, closesAt: opensAt + minutes * MINUTE_MS };
}

/** The window open at `now`, or null between windows. */
export function windowOpenAt(now: number): LaunchWindow | null {
  if (!Number.isFinite(now)) return null;
  const window = windowOfHour(now);
  return now >= window.opensAt && now < window.closesAt ? window : null;
}

/** The next window to open strictly after `now`; `kind` — the next of that kind (the next evening). */
export function nextWindow(now: number, kind?: WindowKind): LaunchWindow {
  let window = windowOfHour(now);
  if (window.opensAt <= now) window = windowOfHour(window.opensAt + HOUR_MS);
  while (kind && window.kind !== kind) window = windowOfHour(window.opensAt + HOUR_MS);
  return window;
}

/** The window a launch went in, by its launch time (the record's, taken at the send); null between windows. */
export function windowOfLaunch(launchedAt: string | number | null): LaunchWindow | null {
  const ms = typeof launchedAt === "number" ? launchedAt : launchedAt ? Date.parse(launchedAt) : NaN;
  return windowOpenAt(ms);
}

const WINDOW_ID = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00Z$/;

/** A window from its id, when the id is one the schedule has. */
export function windowById(id: string): LaunchWindow | null {
  if (!WINDOW_ID.test(id)) return null;
  const ms = Date.parse(id);
  if (!Number.isFinite(ms)) return null;
  const window = windowOfHour(ms);
  return window.id === id ? window : null;
}

/** «20:00 UTC». */
export function windowClock(window: Pick<LaunchWindow, "opensAt">): string {
  return `${new Date(window.opensAt).toISOString().slice(11, 16)} UTC`;
}

/** «Evening window · 20:00 UTC» — as the scene and a post say it. */
export function windowLabel(window: Pick<LaunchWindow, "opensAt" | "kind">): string {
  return `${window.kind === "evening" ? "Evening window" : "Hourly window"} · ${windowClock(window)}`;
}

/** «T-04:12», «T-1:02:09» — the time to an opening, whole seconds, never below zero. */
export function tMinus(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `T-${hours}:${mm}:${ss}` : `T-${mm}:${ss}`;
}

/** The tokens of a list that launched inside a window, by each one's launch time. */
export function launchedIn<T extends Readonly<{ launchedAt: string | null }>>(window: LaunchWindow, rows: readonly T[]): T[] {
  return rows.filter((row) => windowOfLaunch(row.launchedAt)?.id === window.id);
}
